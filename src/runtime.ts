import { readFileSync } from "node:fs";
import tls from "node:tls";
import { HttpsProxyAgent } from "https-proxy-agent";
import { WebSocket } from "ws";
import { backoffMs, helloRejectDisposition } from "./backoff.js";
import { BODY_MAX_BYTES, WS_MAX_PAYLOAD } from "./constants.js";
import { forwardHttp } from "./forward.js";
import { callLogFields, logEvent } from "./log.js";
import { readSpkiPin } from "./pin.js";
import { controlProxyUrl, endpointProxyUrl } from "./proxy-select.js";
import { SessionMachine, type Directive } from "./session-machine.js";
import { sha256Hex, type StateStore } from "./state-store.js";
import { assertPeerCertificate, PeerRejected } from "./tls-peer.js";
import type { HealthState } from "./health.js";

export class EnrollmentFailed extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EnrollmentFailed";
  }
}

function platformCa(env: NodeJS.ProcessEnv): string[] | undefined {
  if ((env.NODE_EXTRA_CA_CERTS ?? "").trim()) return undefined;
  const bundle = (env.TF_NANITE_CA_BUNDLE ?? "").trim();
  if (!bundle) return undefined;
  return [...tls.rootCertificates, readFileSync(bundle, "utf8")];
}

export async function startSession(input: {
  platformUrl: string;
  state: StateStore;
  mode: "enroll" | "resume";
  secret: string;
  version: string;
  env: NodeJS.ProcessEnv;
  health: HealthState;
  signal: AbortSignal;
}): Promise<void> {
  let mode = input.mode;
  let secret = input.secret;
  let attempt = 0;
  while (!input.signal.aborted) {
    const outcome = await connectOnce({ ...input, mode, secret });
    if (outcome.kind === "stop") return;
    if (outcome.kind === "enrollment_failed") throw new EnrollmentFailed(outcome.code);
    const stored = input.state.load();
    if (mode === "enroll" && stored.bearer && stored.consumedEnrollmentSha256 === sha256Hex(secret)) {
      mode = "resume";
      secret = stored.bearer;
    } else if (mode !== "enroll" && stored.bearer) {
      mode = "resume";
      secret = stored.bearer;
    }
    const waitMs = backoffMs(attempt);
    logEvent("warn", "nanite.session.reconnect", { nanite_id: stored.naniteId, wait_ms: waitMs });
    await sleep(waitMs, input.signal);
    attempt += 1;
  }
}

async function connectOnce(input: {
  platformUrl: string;
  state: StateStore;
  mode: "enroll" | "resume";
  secret: string;
  version: string;
  env: NodeJS.ProcessEnv;
  health: HealthState;
  signal: AbortSignal;
}): Promise<{ kind: "stop" } | { kind: "retry" } | { kind: "enrollment_failed"; code: string }> {
  const stored = input.state.load();
  const restored = input.mode === "resume" && stored.naniteId && stored.tenantId
    ? {
        naniteId: stored.naniteId,
        tenantId: stored.tenantId,
        generation: stored.allowlist.generation,
        entries: stored.allowlist.entries
      }
    : undefined;
  const machine = new SessionMachine(input.version, input.mode, input.secret, restored);
  const target = new URL(input.platformUrl);
  logEvent("info", "nanite.session.connecting", {
    platform_host: target.hostname,
    mode: input.mode,
    nanite_id: machine.naniteId || null
  });
  const pin = readSpkiPin(input.env);
  const ca = platformCa(input.env);
  const proxy = controlProxyUrl(input.env, target.hostname);
  const endpointProxy = endpointProxyUrl(input.env);
  const ws = new WebSocket(input.platformUrl, {
    agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
    maxPayload: WS_MAX_PAYLOAD,
    perMessageDeflate: false,
    handshakeTimeout: 20_000,
    servername: target.hostname,
    ...(ca ? { ca } : {}),
    checkServerIdentity: (host: string, cert: tls.PeerCertificate) => {
      try {
        assertPeerCertificate(host, cert, pin);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error : new PeerRejected("pin", "SPKI pin mismatch");
      }
    }
  } as never);
  const controllers = new Map<string, AbortController>();
  let lastInbound = Date.now();
  let lastHeartbeatSent = 0;
  let stopped = false;

  const outcome = new Promise<{ kind: "stop" } | { kind: "retry" } | { kind: "enrollment_failed"; code: string }>((resolve) => {
    const finish = (value: { kind: "stop" } | { kind: "retry" } | { kind: "enrollment_failed"; code: string }) => {
      if (stopped) return;
      stopped = true;
      input.health.connected = false;
      clearInterval(timer);
      ws.close();
      resolve(value);
    };
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || !machine.tenantId) return;
      const now = Date.now();
      if (now - lastHeartbeatSent >= machine.heartbeatSeconds * 1000) {
        lastHeartbeatSent = now;
        ws.send(JSON.stringify({ type: "heartbeat", sent_at: new Date(now).toISOString() }));
      }
      if (now - lastInbound > machine.heartbeatSeconds * 3 * 1000) {
        logEvent("warn", "nanite.session.dead", { nanite_id: machine.naniteId });
        finish({ kind: "retry" });
      }
    }, 1000);

    input.signal.addEventListener("abort", () => {
      machine.goodbye = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "goodbye" }));
      const wait = setInterval(() => {
        if (machine.inFlight === 0) {
          clearInterval(wait);
          finish({ kind: "stop" });
        }
      }, 50);
    }, { once: true });

    ws.on("open", () => {
      input.health.connected = true;
      lastInbound = Date.now();
      logEvent("info", "nanite.session.open", {
        platform_host: target.hostname,
        mode: input.mode,
        nanite_id: machine.naniteId || null
      });
      ws.send(JSON.stringify(machine.buildHello(new Date().toISOString())));
    });
    ws.on("message", (data) => {
      lastInbound = Date.now();
      input.health.lastHeartbeat = new Date().toISOString();
      const directives = machine.onMessage(String(data), Date.now());
      input.health.inFlight = machine.inFlight;
      input.health.tenantId = machine.tenantId || input.health.tenantId;
      input.health.enrolled = Boolean(machine.tenantId);
      for (const directive of directives) applyDirective(directive, finish);
    });
    ws.on("error", (error) => {
      const reason = error instanceof PeerRejected ? error.reason : "socket";
      logEvent("warn", "nanite.session.error", { reason, message: error.message });
    });
    ws.on("close", () => finish({ kind: "retry" }));

    function applyDirective(
      directive: Directive,
      done: (value: { kind: "stop" } | { kind: "retry" } | { kind: "enrollment_failed"; code: string }) => void
    ): void {
      if (directive.op === "send") {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(directive.frame));
        return;
      }
      if (directive.op === "store_identity") {
        input.state.saveIdentity(directive.naniteId, directive.tenantId);
        input.health.enrolled = true;
        input.health.tenantId = directive.tenantId;
        logEvent("info", "nanite.session.hello", { nanite_id: directive.naniteId, tenant_id: directive.tenantId, role: machine.role });
        return;
      }
      if (directive.op === "store_bearer") {
        input.state.saveBearer(directive.secret);
        if (directive.reason === "enroll") input.state.saveConsumedEnrollment(sha256Hex(input.secret));
        delete input.env.TF_NANITE_ENROLLMENT_TOKEN;
        if (directive.reason === "renew") {
          logEvent("info", "nanite.credential.renewed", { nanite_id: machine.naniteId, tenant_id: machine.tenantId });
        }
        return;
      }
      if (directive.op === "set_role") {
        logEvent("info", "nanite.session.role", {
          nanite_id: machine.naniteId || null,
          tenant_id: machine.tenantId || null,
          role: directive.role
        });
        return;
      }
      if (directive.op === "store_allowlist") {
        input.state.saveAllowlist(directive.generation, directive.entries);
        logEvent("info", "nanite.allowlist", {
          nanite_id: machine.naniteId,
          generation: directive.generation,
          entries: directive.entries.length
        });
        return;
      }
      if (directive.op === "abort") {
        controllers.get(directive.callId)?.abort("cancel");
        return;
      }
      if (directive.op === "exit") {
        done({ kind: "stop" });
        return;
      }
      if (directive.op === "reconnect") {
        logEvent("warn", "nanite.session.reject", { code: directive.code, nanite_id: machine.naniteId });
        if (helloRejectDisposition(input.mode) === "exit" && !machine.bearer) {
          done({ kind: "enrollment_failed", code: directive.code });
          return;
        }
        done({ kind: "retry" });
        return;
      }
      const controller = new AbortController();
      controllers.set(directive.callId, controller);
      const expires = Date.parse(String(directive.source.expires_at ?? ""));
      const budget = Number.isFinite(expires) ? Math.max(1, expires - Date.now()) : 60_000;
      const timerId = setTimeout(() => controller.abort("timeout"), budget);
      const started = Date.now();
      void forwardHttp({
        method: directive.request.method,
        url: directive.request.url,
        headers: directive.request.headers,
        body: directive.request.body,
        signal: controller.signal,
        proxyUrl: endpointProxy,
        maxBytes: BODY_MAX_BYTES,
        ca
      }).then((result) => {
        clearTimeout(timerId);
        controllers.delete(directive.callId);
        machine.finishCall(directive.callId);
        input.health.inFlight = machine.inFlight;
        const byteCount = result.body.length;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(machine.resultFrame(directive.source, {
            status: result.status,
            headers: result.headers,
            body_base64: byteCount ? result.body.toString("base64") : "",
            duration_ms: Date.now() - started,
            error: result.error
          })));
        }
        logEvent("info", "nanite.call", callLogFields({
          callId: directive.callId,
          naniteId: machine.naniteId,
          tenantId: machine.tenantId,
          integrationId: String(directive.source.integration_id ?? ""),
          url: directive.request.url,
          status: result.status,
          durationMs: Date.now() - started,
          byteCount,
          errorCode: result.error?.code ?? null
        }));
      }).catch((error: unknown) => {
        clearTimeout(timerId);
        machine.finishCall(directive.callId);
        input.health.inFlight = machine.inFlight;
        logEvent("error", "nanite.call", { call_id: directive.callId, message: error instanceof Error ? error.message : "forward failed" });
      });
    }
  });
  return outcome;
}

export async function sayGoodbyeAndClose(input: {
  platformUrl: string;
  naniteId: string;
  bearer: string;
  version: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const machine = new SessionMachine(input.version, "resume", input.bearer, {
    naniteId: input.naniteId,
    tenantId: "",
    generation: 0,
    entries: []
  });
  const target = new URL(input.platformUrl);
  const pin = readSpkiPin(input.env);
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(input.platformUrl, {
      handshakeTimeout: 10_000,
      servername: target.hostname,
      checkServerIdentity: (host: string, cert: tls.PeerCertificate) => {
        try {
          assertPeerCertificate(host, cert, pin);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error : new Error("tls");
        }
      }
    } as never);
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 10_000);
    ws.on("error", () => undefined);
    ws.on("open", () => ws.send(JSON.stringify(machine.buildHello(new Date().toISOString()))));
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as { type?: string };
      if (frame.type === "hello_ok" || frame.type === "hello_reject") {
        if (frame.type === "hello_ok" && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "goodbye" }));
        }
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
