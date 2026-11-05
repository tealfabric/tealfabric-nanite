import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");

test("entrypoint trusts public roots plus an extra PEM and refuses a pin", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-entry-"));
  const system = join(dir, "public.pem");
  const extra = join(dir, "corp.pem");
  const combined = join(dir, "combined.pem");
  const marker = join(dir, "node-env");
  const nodeBin = join(dir, "node");
  writeFileSync(system, "PUBLIC-ROOT\n");
  writeFileSync(extra, "CORP-CA\n");
  writeFileSync(nodeBin, `#!/bin/sh\nprintf '%s' "$NODE_EXTRA_CA_CERTS" > "${marker}"\n`);
  chmodSync(nodeBin, 0o755);
  const ok = spawnSync("sh", [join(root, "scripts/entrypoint.sh")], {
    env: {
      ...process.env,
      TF_NANITE_NODE: nodeBin,
      TF_NANITE_MAIN: join(dir, "main.js"),
      TF_NANITE_SYSTEM_CA: system,
      TF_NANITE_CA_BUNDLE: extra,
      TF_NANITE_COMBINED_CA: combined,
      TF_NANITE_PIN_FILE: join(dir, "missing-pin")
    }
  });
  assert.equal(ok.status, 0, ok.stderr.toString());
  const bundlePath = readFileSync(marker, "utf8");
  const bundle = readFileSync(bundlePath, "utf8");
  assert.match(bundle, /PUBLIC-ROOT/);
  assert.match(bundle, /CORP-CA/);

  writeFileSync(join(dir, "pin"), "abc\n");
  const refused = spawnSync("sh", [join(root, "scripts/entrypoint.sh")], {
    env: {
      ...process.env,
      TF_NANITE_NODE: nodeBin,
      TF_NANITE_MAIN: join(dir, "main.js"),
      TF_NANITE_SYSTEM_CA: system,
      TF_NANITE_CA_BUNDLE: extra,
      TF_NANITE_PIN_FILE: join(dir, "pin")
    }
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr.toString(), /cannot both be set/);
});

test("upgrade skips apk while in_flight is positive and runs it at zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-upgrade-"));
  const etc = join(dir, "etc");
  const state = join(dir, "state");
  mkdirSync(etc);
  mkdirSync(state);
  writeFileSync(join(etc, "keep"), "config");
  writeFileSync(join(state, "keep"), "bearer-file");
  const apkMarker = join(dir, "apk-ran");
  const busy = join(dir, "busy.json");
  const idle = join(dir, "idle.json");
  writeFileSync(busy, JSON.stringify({ in_flight: 2 }));
  writeFileSync(idle, JSON.stringify({ in_flight: 0 }));
  const env = {
    ...process.env,
    TF_NANITE_STATE_DIR: state,
    TF_NANITE_ETC: etc,
    TF_NANITE_APK_CMD: `touch ${apkMarker}`,
    TF_NANITE_LOCK_DIR: join(dir, "lock")
  };
  const deferred = spawnSync("sh", [join(root, "scripts/upgrade.sh"), "--run"], {
    env: { ...env, TF_NANITE_HEALTH_FILE: busy }
  });
  assert.equal(deferred.status, 0, deferred.stderr.toString());
  assert.equal(existsSync(apkMarker), false);
  assert.equal(existsSync(join(etc, "keep")), true);
  assert.equal(existsSync(join(state, "keep")), true);
  assert.equal(existsSync(join(state, "upgrade.deferred")), true);

  const ran = spawnSync("sh", [join(root, "scripts/upgrade.sh"), "--run"], {
    env: { ...env, TF_NANITE_HEALTH_FILE: idle }
  });
  assert.equal(ran.status, 0, ran.stderr.toString());
  assert.equal(existsSync(apkMarker), true);
  assert.equal(existsSync(join(etc, "keep")), true);
  assert.equal(readFileSync(join(state, "keep"), "utf8"), "bearer-file");
});

test("install dry run names the image and does not pull it", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "podman"), "#!/bin/sh\necho podman-called >> \"$NANITE_PODMAN_LOG\"\n");
  chmodSync(join(bin, "podman"), 0o755);
  const log = join(dir, "podman.log");
  const result = spawnSync("sh", [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TF_NANITE_INSTALL_DRY_RUN: "1",
      TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
      TF_NANITE_ENROLLMENT_TOKEN: "once",
      NANITE_PODMAN_LOG: log
    }
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /podman pull registry.example\/tealfabric-nanite:1/);
  assert.match(result.stdout.toString(), /TF_NANITE_ENROLLMENT_TOKEN/);
  assert.equal(existsSync(log), false);
});

test("install dry run accepts a CDN archive URL without downloading", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-cdn-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "podman"), "#!/bin/sh\necho podman-called >> \"$NANITE_PODMAN_LOG\"\n");
  chmodSync(join(bin, "podman"), 0o755);
  const log = join(dir, "podman.log");
  const url = "https://cdn.tealfabric.io/nanite/0.1.0/tealfabric-nanite-linux-amd64.tar";
  const result = spawnSync("sh", [join(root, "install.sh"), "--image", url, "--state-dir", join(dir, "state")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TF_NANITE_INSTALL_DRY_RUN: "1",
      TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
      NANITE_PODMAN_LOG: log
    }
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /download https:\/\/cdn\.tealfabric\.io/);
  assert.match(result.stdout.toString(), /load/);
  assert.equal(existsSync(log), false);
});

test("install dry run defaults to CDN latest archive and platform URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-default-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "podman"), "#!/bin/sh\necho podman-called >> \"$NANITE_PODMAN_LOG\"\n");
  chmodSync(join(bin, "podman"), 0o755);
  const log = join(dir, "podman.log");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    TF_NANITE_INSTALL_DRY_RUN: "1",
    NANITE_PODMAN_LOG: log
  };
  delete env.TF_NANITE_PLATFORM_URL;
  delete env.TF_NANITE_IMAGE;
  delete env.NANITE_IMAGE_REF;
  delete env.TF_NANITE_CHANNEL;
  const result = spawnSync("sh", [join(root, "install.sh"), "--state-dir", join(dir, "state")], { env });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(
    result.stdout.toString(),
    /download https:\/\/cdn\.tealfabric\.io\/nanite\/latest\/tealfabric-nanite-linux-(amd64|arm64)\.tar/
  );
  assert.match(result.stdout.toString(), /TF_NANITE_PLATFORM_URL/);
  assert.equal(existsSync(log), false);
});

test("install dry run accepts an explicit CDN channel", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-channel-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "podman"), "#!/bin/sh\necho podman-called >> \"$NANITE_PODMAN_LOG\"\n");
  chmodSync(join(bin, "podman"), 0o755);
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--channel", "0.1.0", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TF_NANITE_INSTALL_DRY_RUN: "1",
        TF_NANITE_PLATFORM_URL: "wss://tealfabric.io/api/v1/nanites/session"
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(
    result.stdout.toString(),
    /download https:\/\/cdn\.tealfabric\.io\/nanite\/0\.1\.0\/tealfabric-nanite-linux-(amd64|arm64)\.tar/
  );
});

test("install dry run accepts NANITE_IMAGE_REF from the Tealfabric snippet", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-ref-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "podman"), "#!/bin/sh\necho podman-called >> \"$NANITE_PODMAN_LOG\"\n");
  chmodSync(join(bin, "podman"), 0o755);
  const log = join(dir, "podman.log");
  const result = spawnSync("sh", [join(root, "install.sh"), "--state-dir", join(dir, "state")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TF_NANITE_INSTALL_DRY_RUN: "1",
      NANITE_PODMAN_LOG: log,
      TF_NANITE_PLATFORM_URL: "wss://tealfabric.io/api/v1/nanites/session",
      NANITE_IMAGE_REF: "registry.example/tealfabric-nanite:0.1.0"
    }
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /podman pull registry\.example\/tealfabric-nanite:0\.1\.0/);
  assert.equal(existsSync(log), false);
});
