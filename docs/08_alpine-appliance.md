# Alpine appliance

The appliance is a dedicated Alpine disk that runs Tealfabric Nanite and little else. Weekly `apk` writes to that disk. A container on another Linux distribution or macOS does **not** run this job and does **not** reboot the host.

## Layout

| Path | Contents |
|------|----------|
| `/etc/tealfabric-nanite/config.env` | Platform URL, extra CA path, proxy variables |
| `/etc/tealfabric-nanite/upgrade.schedule` | Five cron fields. Default `0 3 * * 0` (Sunday 03:00, host local time) |
| `/etc/tealfabric-nanite/extra-ca.pem` | Corporate CA, when supplied |
| `/etc/tealfabric-nanite/spki.sha256` | Optional pin from the package or image build |
| `/etc/init.d/tealfabric-nanite` | OpenRC service |
| `/usr/lib/tealfabric-nanite/` | App, `upgrade.sh`, run wrapper |
| `/usr/local/` | Official Node.js 26 musl build |
| `/var/lib/tealfabric-nanite/` | Bearer secret, ids, allowlist cache. Mode `0700`. Not part of the package payload. |

The package does not depend on Alpine's `nodejs` package. Node stays under `/usr/local`.

## OpenRC

```sh
rc-update add tealfabric-nanite default
rc-service tealfabric-nanite start
rc-service tealfabric-nanite status
```

The service runs as user `tealfabric-nanite` when that account exists. `start_pre` ensures the state directory mode and seeds `upgrade.schedule` when missing. It also installs a minute cron line that calls `upgrade.sh --tick` when that line is absent.

Edit `/etc/tealfabric-nanite/config.env` for `TF_NANITE_PLATFORM_URL` and related variables. Editing `upgrade.schedule` does not restart Node. Reload cron after changing the schedule file if your Alpine cron setup requires it.

## Upgrade job

`scripts/upgrade.sh` (installed as `/usr/lib/tealfabric-nanite/upgrade.sh`):

1. Cron invokes `--tick` every minute.
2. The job exits unless `upgrade.schedule` matches the current local time, or a deferred run is due (`upgrade.deferred` present and the minute is aligned to `TF_NANITE_UPGRADE_RETRY`, default every 5 minutes).
3. Read localhost health. Use `in_flight`.
4. When `in_flight` is greater than zero (or health is unreadable), write `upgrade.deferred` and exit. Do not run `apk`, do not restart Node, do not reboot.
5. When `in_flight` is zero, clear the deferred marker and run `apk update && apk upgrade`.
6. If the log shows `tealfabric-nanite` or `node-v26` changed, check `in_flight` again, then restart the OpenRC service. SIGTERM finishes a call that already reached the endpoint.
7. If a newer kernel package appears in the log and `in_flight` is still zero, reboot. OpenRC starts the process after boot from the same state directory.

A process that stays busy keeps deferring. The job never forces a restart or reboot. Health reports `upgrade_deferred: true` while that wait is outstanding.

## `/etc/apk/repositories`

List the Alpine mirrors and the signed repository that publishes `tealfabric-nanite`. Packaging details for that repository are site-specific; the APKBUILD under `packaging/alpine/` is the package definition in this tree.

## Building the package

Before `abuild`:

```sh
npm ci
npm run build
npm prune --omit=dev
```

Keep production `node_modules` and `dist` available to `APKBUILD` as described in that file. The package downloads the official Node 26 musl tarball for the target architecture (`x86_64` / `aarch64`).

## Container on Alpine vs appliance

| | Container via `install.sh` | OpenRC appliance |
|--|----------------------------|------------------|
| Node | Inside the image (`node:26-alpine`) | `/usr/local` from the package |
| Host `apk upgrade` | Not run by Nanite | Weekly job |
| Host reboot | Not triggered by Nanite | Only after idle + kernel package |
| Update Nanite itself | Pull a new image tag | `apk upgrade` of `tealfabric-nanite` |

Both keep `/var/lib/tealfabric-nanite` across updates when that path is preserved.
