import assert from "node:assert/strict";
import test from "node:test";
import { SessionMachine } from "../src/session-machine.js";

function machine(): SessionMachine {
  const session = new SessionMachine("0.1.0", "enroll", "enroll-token");
  session.onMessage(JSON.stringify({
    type: "hello_ok",
    protocol_version: 1,
    nanite_id: "nanite-1",
    tenant_id: "tenant-1",
    session_id: "session-1",
    role: "active",
    heartbeat_interval_seconds: 30,
    max_in_flight: 4,
    bearer_secret: "bearer-1",
    allowlist: { generation: 1, entries: [{ scheme: "https", host: "device.lan", port: 443 }] }
  }), Date.parse("2026-11-04T12:00:00.000Z"));
  return session;
}

function call(id: string): string {
  return JSON.stringify({
    type: "call",
    envelope_version: 1,
    call_id: id,
    tenant_id: "tenant-1",
    nanite_id: "nanite-1",
    integration_id: "integration-1",
    execution_id: "exec-1",
    allowlist_generation: 1,
    expires_at: "2026-11-04T12:05:00.000Z",
    request: { method: "GET", url: "https://device.lan/api", headers: [], body_base64: "" }
  });
}

test("hello_ok stores the bearer and the next hello uses it", () => {
  const session = machine();
  const hello = session.buildHello("2026-11-04T12:00:00.000Z");
  const auth = hello.auth as { method: string; secret: string };
  assert.equal(auth.method, "bearer");
  assert.equal(auth.secret, "bearer-1");
  const directives = session.onMessage(JSON.stringify({
    type: "credential",
    bearer_secret: "bearer-2",
    not_after: "2026-12-04T12:00:00.000Z"
  }), Date.now());
  assert.equal(directives.some((item) => item.op === "store_bearer" && item.op === "store_bearer" && item.secret === "bearer-2"), true);
  const next = session.buildHello("2026-11-04T12:10:00.000Z");
  assert.equal((next.auth as { secret: string }).secret, "bearer-2");
});

test("only the active role dials, and a repeated call_id does not dial again", () => {
  const session = machine();
  session.role = "standby";
  assert.equal(session.onMessage(call("c1"), Date.parse("2026-11-04T12:00:30.000Z")).some((item) => item.op === "dial"), false);
  session.onMessage(JSON.stringify({ type: "role", role: "active" }), Date.now());
  const first = session.onMessage(call("c1"), Date.parse("2026-11-04T12:00:30.000Z"));
  assert.equal(first.some((item) => item.op === "dial"), true);
  const second = session.onMessage(call("c1"), Date.parse("2026-11-04T12:00:31.000Z"));
  assert.equal(second.some((item) => item.op === "dial"), false);
});

test("cancel names the call to abort", () => {
  const session = machine();
  const directives = session.onMessage(JSON.stringify({ type: "cancel", call_id: "c9" }), Date.now());
  assert.deepEqual(directives, [{ op: "abort", callId: "c9" }]);
});
