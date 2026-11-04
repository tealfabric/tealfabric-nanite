import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { forwardHttp } from "../src/forward.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

test("a redirect is returned and the Location host is not dialed", async () => {
  let redirectedHits = 0;
  const other = http.createServer((_request, response) => {
    redirectedHits += 1;
    response.writeHead(200);
    response.end("nope");
  });
  const otherPort = await listen(other);
  const origin = http.createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${otherPort}/secret` });
    response.end();
  });
  const originPort = await listen(origin);
  try {
    const result = await forwardHttp({
      method: "GET",
      url: `http://127.0.0.1:${originPort}/start`,
      headers: [],
      body: Buffer.alloc(0),
      signal: new AbortController().signal,
      maxBytes: 1024
    });
    assert.equal(result.status, 302);
    assert.equal(result.error, null);
    assert.equal(redirectedHits, 0);
  } finally {
    origin.close();
    other.close();
  }
});

test("cancel aborts an open endpoint socket", async () => {
  let destroyed = false;
  const server = http.createServer(() => undefined);
  server.on("connection", (socket) => {
    socket.on("close", () => {
      destroyed = true;
    });
  });
  const port = await listen(server);
  const controller = new AbortController();
  const pending = forwardHttp({
    method: "GET",
    url: `http://127.0.0.1:${port}/hang`,
    headers: [],
    body: Buffer.alloc(0),
    signal: controller.signal,
    maxBytes: 1024
  });
  await new Promise<void>((resolve) => server.once("connection", () => resolve()));
  controller.abort("cancel");
  const result = await pending;
  assert.equal(result.error?.code, "timeout");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(destroyed, true);
  server.close();
});

test("a file URL does not open a socket", async () => {
  const result = await forwardHttp({
    method: "GET",
    url: "file:///tmp/nanite-secret",
    headers: [],
    body: Buffer.alloc(0),
    signal: new AbortController().signal,
    maxBytes: 1024
  });
  assert.equal(result.error?.code, "allowlist_denied");
});
