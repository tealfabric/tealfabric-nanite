import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  const url = "https://cdn.tealfabric.io/nanite/0.1.0/tealfabric-nanite-linux-amd64.tar.gz";
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
  assert.match(result.stdout.toString(), /download https:\/\/cdn\.tealfabric\.io.*\.tar\.gz/);
  assert.match(result.stdout.toString(), /gunzip/);
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
    /download https:\/\/cdn\.tealfabric\.io\/nanite\/latest\/tealfabric-nanite-linux-(amd64|arm64)\.tar\.gz/
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
    /download https:\/\/cdn\.tealfabric\.io\/nanite\/0\.1\.0\/tealfabric-nanite-linux-(amd64|arm64)\.tar\.gz/
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

function writeExe(path: string, body: string) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

const runtimeStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$NANITE_PODMAN_LOG"
if [ "$1" = "run" ]; then
  prev=
  for arg in "$@"; do
    if [ "$prev" = "-v" ]; then
      case "$arg" in
        *:/var/lib/tealfabric-nanite)
          host=\${arg%%:*}
          printf '%s\\n' nanite-test > "$host/nanite_id"
          ;;
      esac
    fi
    prev=$arg
  done
fi
exit 0
`;

test("install enables an OpenRC service that starts the container on boot", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-openrc-"));
  const bin = join(dir, "bin");
  const initDir = join(dir, "init.d");
  mkdirSync(bin);
  writeExe(join(bin, "podman"), runtimeStub);
  writeExe(join(bin, "rc-update"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NANITE_RC_UPDATE_LOG\"\nexit 0\n");
  writeExe(join(bin, "rc-service"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NANITE_RC_SERVICE_LOG\"\nexit 0\n");
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
        TF_NANITE_BOOT_MANAGER: "openrc",
        TF_NANITE_INIT_DIR: initDir,
        NANITE_PODMAN_LOG: join(dir, "podman.log"),
        NANITE_RC_UPDATE_LOG: join(dir, "rc-update.log"),
        NANITE_RC_SERVICE_LOG: join(dir, "rc-service.log")
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  const initFile = join(initDir, "tealfabric-nanite");
  const script = readFileSync(initFile, "utf8");
  assert.match(script, /tealfabric-nanite-install\.sh/);
  assert.match(script, /name="\$RC_SVCNAME"/);
  assert.match(script, /need net/);
  assert.match(script, /\$running/);
  assert.match(script, /start 'tealfabric-nanite'/);
  assert.match(script, /stop -t 20 'tealfabric-nanite'/);
  assert.equal(statSync(initFile).mode & 0o111, 0o111);
  const syntax = spawnSync("sh", ["-n", initFile]);
  assert.equal(syntax.status, 0, syntax.stderr.toString());
  assert.match(readFileSync(join(dir, "rc-update.log"), "utf8"), /add tealfabric-nanite default/);
  assert.match(readFileSync(join(dir, "rc-service.log"), "utf8"), /tealfabric-nanite start/);
  assert.equal(readFileSync(join(dir, "state", "nanite_id"), "utf8").trim(), "nanite-test");
});

test("install dry run plans the OpenRC boot service and does not install it", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-openrc-dry-"));
  const bin = join(dir, "bin");
  const initDir = join(dir, "init.d");
  mkdirSync(bin);
  writeExe(join(bin, "podman"), "#!/bin/sh\nexit 0\n");
  writeExe(join(bin, "rc-update"), "#!/bin/sh\nexit 0\n");
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TF_NANITE_INSTALL_DRY_RUN: "1",
        TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
        TF_NANITE_BOOT_MANAGER: "openrc",
        TF_NANITE_INIT_DIR: initDir
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /rc-update add tealfabric-nanite default/);
  assert.match(result.stdout.toString(), /rc-service tealfabric-nanite start/);
  assert.equal(existsSync(join(initDir, "tealfabric-nanite")), false);
});

test("install does not replace an OpenRC service it did not create", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-openrc-foreign-"));
  const bin = join(dir, "bin");
  const initDir = join(dir, "init.d");
  mkdirSync(bin);
  mkdirSync(initDir);
  writeExe(join(bin, "podman"), runtimeStub);
  writeExe(join(bin, "rc-update"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NANITE_RC_UPDATE_LOG\"\nexit 0\n");
  writeExe(join(bin, "rc-service"), "#!/bin/sh\nexit 0\n");
  const initFile = join(initDir, "tealfabric-nanite");
  writeFileSync(initFile, "#!/sbin/openrc-run\n# appliance unit\n");
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
        TF_NANITE_BOOT_MANAGER: "openrc",
        TF_NANITE_INIT_DIR: initDir,
        NANITE_PODMAN_LOG: join(dir, "podman.log"),
        NANITE_RC_UPDATE_LOG: join(dir, "rc-update.log")
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(readFileSync(initFile, "utf8"), "#!/sbin/openrc-run\n# appliance unit\n");
  assert.equal(existsSync(join(dir, "rc-update.log")), false);
  assert.match(result.stderr.toString(), /leaving it in place/);
});

test("install enables the Docker daemon on OpenRC", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-docker-openrc-"));
  const bin = join(dir, "bin");
  const hostBin = join(dir, "host-bin");
  const initDir = join(dir, "init.d");
  mkdirSync(bin);
  mkdirSync(hostBin);
  mkdirSync(initDir);
  writeExe(join(bin, "docker"), runtimeStub);
  writeExe(join(bin, "rc-update"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NANITE_RC_UPDATE_LOG\"\nexit 0\n");
  // Host podman is preferred when both exist. This stub must not be selected.
  writeExe(join(hostBin, "podman"), "#!/bin/sh\necho host-podman >&2\nexit 125\n");
  writeExe(join(initDir, "docker"), "#!/sbin/openrc-run\n");
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${hostBin}:/usr/bin:/bin`,
        TF_NANITE_RUNTIME: "docker",
        TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
        TF_NANITE_BOOT_MANAGER: "openrc",
        TF_NANITE_INIT_DIR: initDir,
        NANITE_PODMAN_LOG: join(dir, "podman.log"),
        NANITE_RC_UPDATE_LOG: join(dir, "rc-update.log")
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(existsSync(join(initDir, "tealfabric-nanite")), false);
  assert.match(readFileSync(join(dir, "rc-update.log"), "utf8"), /add docker default/);
});

test("install enables a systemd unit that starts the Podman container on boot", () => {
  const dir = mkdtempSync(join(tmpdir(), "nanite-install-systemd-"));
  const bin = join(dir, "bin");
  const unitDir = join(dir, "systemd");
  mkdirSync(bin);
  writeExe(join(bin, "podman"), runtimeStub);
  writeExe(join(bin, "systemctl"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$NANITE_SYSTEMCTL_LOG\"\nexit 0\n");
  const result = spawnSync(
    "sh",
    [join(root, "install.sh"), "--image", "registry.example/tealfabric-nanite:1", "--state-dir", join(dir, "state")],
    {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TF_NANITE_PLATFORM_URL: "wss://platform.example/api/v1/nanites/session",
        TF_NANITE_BOOT_MANAGER: "systemd",
        TF_NANITE_SYSTEMD_DIR: unitDir,
        NANITE_PODMAN_LOG: join(dir, "podman.log"),
        NANITE_SYSTEMCTL_LOG: join(dir, "systemctl.log")
      }
    }
  );
  assert.equal(result.status, 0, result.stderr.toString());
  const unit = readFileSync(join(unitDir, "tealfabric-nanite.service"), "utf8");
  assert.match(unit, /tealfabric-nanite-install\.sh/);
  assert.match(unit, /WantedBy=multi-user\.target/);
  assert.match(unit, /\$running/);
  assert.match(unit, /start tealfabric-nanite/);
  assert.match(readFileSync(join(dir, "systemctl.log"), "utf8"), /daemon-reload/);
  assert.match(readFileSync(join(dir, "systemctl.log"), "utf8"), /enable --now tealfabric-nanite\.service/);
});
