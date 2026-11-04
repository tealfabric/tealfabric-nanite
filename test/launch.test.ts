import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launch } from "../src/launch.js";
import { startSession } from "../src/runtime.js";
import { StateStore } from "../src/state-store.js";

test("already_enrolled opens no session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-state-"));
  writeFileSync(join(dir, "tenant_id"), "tenant-1\n", { mode: 0o600 });
  let started = false;
  const code = await launch({
    argv: ["tealfabric-nanite"],
    env: {
      TF_NANITE_STATE_DIR: dir,
      TF_NANITE_ENROLLMENT_TOKEN: "second-token",
      TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
      TF_NANITE_LOCAL_HEALTH_PORT: "0"
    },
    start: (async () => {
      started = true;
    }) as typeof startSession
  });
  assert.equal(code, 1);
  assert.equal(started, false);
});

test("ca bundle and pin together refuse to start", async () => {
  let started = false;
  const code = await launch({
    argv: ["tealfabric-nanite"],
    env: {
      TF_NANITE_CA_BUNDLE: "/tmp/corp.pem",
      TF_NANITE_SPKI_SHA256: "abc123",
      TF_NANITE_LOCAL_HEALTH_PORT: "0"
    },
    start: (async () => {
      started = true;
    }) as typeof startSession
  });
  assert.equal(code, 1);
  assert.equal(started, false);
});

test("state files are mode 0600 and revoke-local wipes them without a platform URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-wipe-"));
  const store = new StateStore(dir);
  store.saveIdentity("nanite-1", "tenant-1");
  store.saveBearer("bearer-secret");
  assert.equal(statSync(join(dir, "bearer")).mode & 0o777, 0o600);
  const code = await launch({
    argv: ["tealfabric-nanite", "revoke-local"],
    env: { TF_NANITE_STATE_DIR: dir, TF_NANITE_LOCAL_HEALTH_PORT: "0" }
  });
  assert.equal(code, 0);
  const loaded = store.load();
  assert.equal(loaded.tenantId, null);
  assert.equal(loaded.bearer, null);
});
