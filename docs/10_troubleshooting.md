# Troubleshooting

## Enrollment fails immediately

| Log / symptom | What to check |
|---------------|---------------|
| `TF_NANITE_PLATFORM_URL is required` | Export the `wss://…/api/v1/nanites/session` URL from the Tealfabric snippet. |
| `TF_NANITE_STATE_DIR is required` | Set a writable directory. |
| `enrollment token or bearer secret is required` | Pass `TF_NANITE_ENROLLMENT_TOKEN` on first enroll, or keep an existing `bearer` file. |
| `nanite.already_enrolled` | State directory already has `tenant_id` without a usable bearer. Wipe with `revoke-local` or use a fresh directory. Do not paste a second tenant's token into an existing install. |
| `nanite.enrollment_failed` with `expired` | Token older than 15 minutes or already used. Issue a new token in Tealfabric. |
| `unauthorized` / `revoked` | Wrong token, wrong Nanite, or console revoke. |
| `clock_skew` | Host clock off by more than 60 seconds from Tealfabric. Sync NTP. |
| `unsupported_protocol` | Client protocol version is not accepted. Upgrade the Nanite package/image. |
| Pin and CA both set | Remove `TF_NANITE_CA_BUNDLE` or rebuild without `NANITE_SPKI_SHA256`. |

## Connected briefly, then offline

1. Confirm outbound 443 still reaches the platform host.
2. Confirm the edge in front of Tealfabric keeps `/api/v1/nanites/session` idle longer than three heartbeats (floor 90 seconds with a 30-second heartbeat). That setting is on the platform edge, not on this host.
3. Watch logs for `nanite.session.dead` (three missed heartbeats) or `nanite.session.reconnect`.
4. Confirm the bearer file is still mode `0600` and readable by the process user.

## TLS errors

| Symptom | Action |
|---------|--------|
| Hostname mismatch | `TF_NANITE_PLATFORM_URL` host must match the certificate. |
| Corporate proxy MITM | Pass `--ca-file` / `TF_NANITE_CA_BUNDLE` with the intercepting CA PEM. |
| SPKI pin mismatch | Rebuild with the current pin, or run without a pin during rotate. |
| Pin + CA refused at start | Choose one trust model. |

## Integration calls fail while health says connected

| Platform / Nanite code | Meaning |
|------------------------|---------|
| `allowlist_denied` | URL scheme/host/port not on the Tealfabric allowlist, or userinfo present. Update the Nanite allowlist in the console. |
| `allowlist_stale` | Call generation does not match the last acked allowlist. Reconnect or wait for a fresh allowlist push. |
| `busy` | Above `max_in_flight`. Reduce concurrency or raise the Nanite cap in Tealfabric (max 16). |
| `expired` | Call arrived after `expires_at`. Check clock skew and worker timeout. |
| `body_too_large` | Request or response over 536870912 decoded bytes. |
| `timeout` / `dns` / `connect_failed` / `tls` | Endpoint network from the Nanite host. Health of Tealfabric is unrelated. |
| `nanite_offline` (platform) | Presence missing. Nanite not connected when the worker dispatched. |

Redirects: a 302 is a successful forward of the response. The Nanite does not follow `Location`. If the client expected a followed redirect, change the integration URL to the final host and allowlist that host.

## `netavark: iptables: No such file or directory`

Podman's default bridge network calls `iptables` via netavark. Alpine's `podman` package does not always pull in `iptables`, so `podman run` fails after a successful image load.

Current `install.sh` starts the Nanite with `--network=host` (outbound-only; health stays on `127.0.0.1`) and installs `iptables` / `ip6tables` on Alpine. Until that installer is on the CDN:

```sh
apk add iptables ip6tables
podman rm -f tealfabric-nanite 2>/dev/null || true
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
# or: podman run ... --network=host ...
```

## Alpine apk warns about rootless Podman / subuid

After `apk add podman`, Alpine prints how to configure **rootless** Podman (`/etc/subuid`, `/etc/subgid`, `rc-service cgroups start`).

`install.sh` is meant to run as **root** and uses **rootful** Podman. In that case you can ignore the subuid/subgid part of the message. The script already starts the `cgroups` service.

Only act on that warning if you install as a non-root user; then either re-run as root or add subordinate id ranges for that user.

## Alpine apk: `podman (no such package)` or missing `so:libglib` / `gpg`

Podman is in Alpine **community**, not **main**. After an ISO install, `/etc/apk/repositories` often lists only `/media/cdrom/apks`. Adding **community** from the internet while **main** stays on the CD breaks dependency resolution (`so:libglib-2.0.so.0`, `gpg`, …).

Fix: use matching online mirrors for both (same `vX.Y` as `/etc/alpine-release`):

```sh
ver=$(cut -d. -f1,2 /etc/alpine-release)
cat >/etc/apk/repositories <<EOF
https://dl-cdn.alpinelinux.org/alpine/v${ver}/main
https://dl-cdn.alpinelinux.org/alpine/v${ver}/community
EOF
apk update
apk add podman
```

Current `install.sh` does this before installing Podman. See [Install](02_install.md) Path A step 2.

## `NANITE_IMAGE_REF is unset` from `curl … \| sh -`

The CDN is serving an old `install.sh` that required `--image` and did not read `NANITE_IMAGE_REF`. Confirm:

```sh
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | head -n 20
```

A current script mentions `NANITE_IMAGE_REF` in the header and defaults the image when unset. Until CDN is republished (`tealfabric-nanite-ci` → `deploy-nanite.yml`), either:

```sh
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
export NANITE_IMAGE_REF='…from Tealfabric snippet…'
# Temporary: pass --image explicitly for the old CDN script
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -s -- --image "$NANITE_IMAGE_REF"
```

or copy this repository's `install.sh` onto the host and run `sh ./install.sh`.

Also set `TF_NANITE_PLATFORM_URL` when the snippet does not (default on the new script is `wss://tealfabric.io/api/v1/nanites/session`).

## Container will not start

```sh
# Print the planned commands
TF_NANITE_INSTALL_DRY_RUN=1 ./install.sh --image registry.example/tealfabric-nanite:0.1.0

podman logs tealfabric-nanite   # or docker logs
```

Confirm the state directory is mounted and mode `0700`, and that `TF_NANITE_PLATFORM_URL` is in the container environment.

## Alpine upgrade never runs

1. Read `/etc/tealfabric-nanite/upgrade.schedule` (five cron fields, host local time).
2. Confirm cron runs `/usr/lib/tealfabric-nanite/upgrade.sh --tick` every minute.
3. Check health: if `in_flight` is greater than zero, the job defers (`upgrade_deferred`).
4. Confirm `/etc/alpine-release` exists; non-appliance hosts exit without `apk`.
5. Look for a stale lock directory under `$TF_NANITE_STATE_DIR/upgrade.lock` after a crash; remove it only when no upgrade is running.

## `revoke-local` left the console showing the Nanite

Local wipe clears the host. Revoke separately in the Tealfabric Nanites screen so the platform stops accepting the old bearer.

## Contract / contributor tests

If `test/contract-copy.test.ts` fails, place or clone `dev.tealfabric.io` as a sibling of this repository and ensure the platform plan's session contract bytes match this app plan's copy for revision `2026-11-04.1`.
