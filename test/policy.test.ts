import assert from "node:assert/strict";
import test from "node:test";
import { exceedsBodyCap } from "../src/body.js";
import { evaluateCall } from "../src/call-policy.js";
import { BODY_MAX_BYTES } from "../src/constants.js";
import { backoffMs, helloRejectDisposition } from "../src/backoff.js";
import { clockSkewed } from "../src/clock.js";
import { callLogFields, configureLog, logEvent } from "../src/log.js";
import { caPinConflict, startupPlan } from "../src/startup.js";
import type { AllowlistEntry } from "../src/types.js";

const entries: AllowlistEntry[] = [{ scheme: "https", host: "device.lan", port: 443 }];

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "call",
    envelope_version: 1,
    call_id: "call-1",
    tenant_id: "tenant-1",
    nanite_id: "nanite-1",
    integration_id: "integration-1",
    execution_id: "exec-1",
    allowlist_generation: 3,
    issued_at: "2026-11-04T12:00:00.000Z",
    expires_at: "2026-11-04T12:05:00.000Z",
    request: {
      method: "POST",
      url: "https://device.lan/api",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Connection", value: "close" },
        { name: "Authorization", value: "Bearer secret-token" }
      ],
      body_base64: Buffer.from("{}", "utf8").toString("base64")
    },
    response: null,
    ...overrides
  };
}

function decide(overrides: Record<string, unknown> = {}, input: Record<string, unknown> = {}) {
  return evaluateCall({
    role: "active",
    goodbye: false,
    inFlight: 0,
    maxInFlight: 4,
    tenantId: "tenant-1",
    naniteId: "nanite-1",
    allowlistGeneration: 3,
    entries,
    seenCallIds: new Set(),
    nowMs: Date.parse("2026-11-04T12:00:30.000Z"),
    frame: frame(overrides),
    ...input
  });
}

test("allowlist accepts the listed host and strips hop-by-hop headers", () => {
  const decision = decide();
  assert.equal(decision.kind, "dial");
  if (decision.kind !== "dial") return;
  assert.deepEqual(decision.request.headers.map((header) => header.name), ["content-type", "authorization"]);
});

test("another host, another port, a file URL, and userinfo do not dial", () => {
  assert.equal(decide({ request: { method: "GET", url: "https://other.lan/", headers: [], body_base64: "" } }).kind, "reject");
  assert.equal(decide({ request: { method: "GET", url: "https://device.lan:8443/", headers: [], body_base64: "" } }).kind, "reject");
  const fileUrl = decide({ request: { method: "GET", url: "file:///tmp/x", headers: [], body_base64: "" } });
  assert.equal(fileUrl.kind, "reject");
  if (fileUrl.kind === "reject") assert.equal(fileUrl.code, "allowlist_denied");
  const userinfo = decide({ request: { method: "GET", url: "https://user:pw@device.lan/api", headers: [], body_base64: "" } });
  if (userinfo.kind === "reject") assert.equal(userinfo.code, "allowlist_denied");
});

test("expired expires_at does not dial", () => {
  const decision = decide({}, { nowMs: Date.parse("2026-11-04T13:00:00.000Z") });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.code, "expired");
});

test("duplicate call_id does not dial twice", () => {
  const seen = new Set(["call-1"]);
  const decision = decide({}, { seenCallIds: seen });
  assert.equal(decision.kind, "ignore");
});

test("standby does not dial and active does", () => {
  assert.equal(decide({}, { role: "standby" }).kind, "ignore");
  assert.equal(decide({}, { role: "active" }).kind, "dial");
});

test("a body over the contract cap is body_too_large and is not logged", () => {
  assert.equal(exceedsBodyCap(BODY_MAX_BYTES), false);
  assert.equal(exceedsBodyCap(BODY_MAX_BYTES + 1), true);
  const decision = decide({
    request: {
      method: "POST",
      url: "https://device.lan/api",
      headers: [],
      body_base64: Buffer.from("hello", "utf8").toString("base64")
    }
  }, { maxBytes: 4 });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") {
    assert.equal(decision.code, "body_too_large");
    assert.equal(JSON.stringify(decision.fields).includes("aGVsbG8="), false);
  }
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  configureLog({ TF_NANITE_LOG: "stdout" });
  try {
    logEvent("info", "nanite.call", {
      ...callLogFields({
        callId: "call-1",
        naniteId: "nanite-1",
        tenantId: "tenant-1",
        integrationId: "integration-1",
        url: "https://device.lan/api"
      }),
      body_base64: "SECRETDATA",
      authorization: "Bearer secret-token"
    });
  } finally {
    console.log = original;
  }
  assert.equal(lines.join("").includes("SECRETDATA"), false);
  assert.equal(lines.join("").includes("secret-token"), false);
  assert.equal(lines.join("").includes("call-1"), true);
});

test("stale allowlist generation does not dial", () => {
  const decision = decide({ allowlist_generation: 2 });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.code, "allowlist_stale");
});

test("already_enrolled is local and a bearer ignores a new enrollment token", () => {
  assert.deepEqual(startupPlan({ tenantId: "tenant-1", bearer: null }, "token"), { action: "refuse", reason: "already_enrolled" });
  assert.equal(startupPlan({ tenantId: "tenant-1", bearer: "secret" }, "token").action, "resume");
  assert.equal(startupPlan({ tenantId: null, bearer: null }, "token").action, "enroll");
});

test("a pin and a CA bundle together are refused", () => {
  assert.equal(caPinConflict("/tmp/corp.pem", "abc"), true);
  assert.equal(caPinConflict("", "abc"), false);
  assert.equal(caPinConflict("/tmp/corp.pem", ""), false);
});

test("clock skew is more than 60 seconds and reconnect backoff stays within 60 seconds", () => {
  const now = Date.parse("2026-11-04T12:00:00.000Z");
  assert.equal(clockSkewed("2026-11-04T12:01:01.000Z", now), true);
  assert.equal(clockSkewed("2026-11-04T12:00:30.000Z", now), false);
  assert.equal(helloRejectDisposition("enroll"), "exit");
  assert.equal(helloRejectDisposition("resume"), "retry");
  assert.ok(backoffMs(30, 1) <= 60_000);
});
