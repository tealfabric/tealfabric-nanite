import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { URL } from "node:url";
import type { ResultErrorCode } from "./constants.js";
import type { Header } from "./types.js";

export type ForwardResult = {
  status: number;
  headers: Header[];
  body: Buffer;
  error: { code: ResultErrorCode } | null;
};

const HOP = new Set(["connection", "transfer-encoding", "keep-alive", "upgrade", "proxy-authorization"]);

function abortError(signal: AbortSignal): NodeJS.ErrnoException {
  return Object.assign(new Error(String(signal.reason ?? "cancel")), { code: "ABORT_ERR" });
}

function mapSocketError(error: NodeJS.ErrnoException): ResultErrorCode {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME") return "dns";
  if (code === "ABORT_ERR" || message === "timeout" || message === "cancel") return "timeout";
  if (/CERT|TLS|altname/i.test(code) || /certificate|tls|hostname/i.test(message)) return "tls";
  return "connect_failed";
}

function responseHeaders(raw: http.IncomingHttpHeaders): Header[] {
  const headers: Header[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (HOP.has(name.toLowerCase()) || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) headers.push({ name: name.toLowerCase(), value: item });
  }
  return headers;
}

function empty(code: ResultErrorCode): ForwardResult {
  return { status: 0, headers: [], body: Buffer.alloc(0), error: { code } };
}

export async function forwardHttp(input: {
  method: string;
  url: string;
  headers: Header[];
  body: Buffer;
  signal: AbortSignal;
  proxyUrl?: string | null;
  maxBytes: number;
  ca?: string[];
}): Promise<ForwardResult> {
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    return empty("allowlist_denied");
  }
  if ((target.protocol !== "http:" && target.protocol !== "https:") || target.username || target.password) {
    return empty("allowlist_denied");
  }
  try {
    return await sendRequest(target, input);
  } catch (error) {
    return empty(mapSocketError(error as NodeJS.ErrnoException));
  }
}

function requestHeaders(inputHeaders: Header[], body: Buffer, transportHeaders?: http.OutgoingHttpHeaders | readonly string[]): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  if (transportHeaders && !Array.isArray(transportHeaders)) {
    for (const [name, value] of Object.entries(transportHeaders)) {
      if (value !== undefined) headers[name] = value;
    }
  }
  for (const header of inputHeaders) {
    const name = header.name.trim().toLowerCase();
    if (!name || HOP.has(name)) continue;
    headers[name] = header.value;
  }
  if (body.length > 0) headers["content-length"] = String(body.length);
  return headers;
}

async function sendRequest(target: URL, input: {
  method: string;
  headers: Header[];
  body: Buffer;
  signal: AbortSignal;
  proxyUrl?: string | null;
  maxBytes: number;
  ca?: string[];
}): Promise<ForwardResult> {
  const opened = await openTransport(target, input.proxyUrl ?? null, input.signal, input.ca);
  const method = input.method.trim().toUpperCase() || "GET";
  const headers = requestHeaders(input.headers, input.body, opened.options.headers);
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = opened.module.request({ ...opened.options, method, headers }, resolve);
    const fail = (error: Error) => {
      request.destroy();
      reject(error);
    };
    if (input.signal.aborted) fail(abortError(input.signal));
    input.signal.addEventListener("abort", () => fail(abortError(input.signal)), { once: true });
    request.on("error", reject);
    if (input.body.length > 0) request.write(input.body);
    request.end();
  });
  const declared = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > input.maxBytes) {
    response.destroy();
    return empty("body_too_large");
  }
  const read = await readLimited(response, input.maxBytes, input.signal);
  if (read.overflow) return empty("body_too_large");
  return { status: response.statusCode ?? 0, headers: responseHeaders(response.headers), body: read.body, error: null };
}

function readLimited(response: http.IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<{ body: Buffer; overflow: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: { body: Buffer; overflow: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };
    if (signal.aborted) {
      fail(abortError(signal));
      return;
    }
    signal.addEventListener("abort", () => fail(abortError(signal)), { once: true });
    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        finish({ body: Buffer.alloc(0), overflow: true });
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => finish({ body: Buffer.concat(chunks), overflow: false }));
    response.on("error", fail);
  });
}

async function openTransport(
  target: URL,
  proxyUrl: string | null,
  signal: AbortSignal,
  ca?: string[]
): Promise<{ module: typeof http | typeof https; options: https.RequestOptions }> {
  if (!proxyUrl) {
    const secure = target.protocol === "https:";
    return {
      module: secure ? https : http,
      options: {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        servername: secure ? target.hostname : undefined,
        ...(ca ? { ca } : {})
      }
    };
  }
  const proxy = new URL(proxyUrl);
  if (target.protocol === "http:") {
    return {
      module: http,
      options: {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        path: target.toString(),
        headers: { host: target.host }
      }
    };
  }
  const socket = await connectTunnel(proxy, target, signal);
  return {
    module: https,
    options: {
      createConnection: () => socket,
      servername: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: { host: target.host },
      ...(ca ? { ca } : {})
    } as https.RequestOptions
  };
}

function connectTunnel(proxy: URL, target: URL, signal: AbortSignal): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const port = target.port || "443";
    const req = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:${port}`
    });
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    signal.addEventListener("abort", () => req.destroy(abortError(signal)), { once: true });
    req.on("error", reject);
    req.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(Object.assign(new Error("connect_failed"), { code: "ECONNREFUSED" }));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", reject);
    });
    req.end();
  });
}
