# Configuration

All runtime configuration is environment variables. The Alpine appliance also loads `/etc/tealfabric-nanite/config.env` through the OpenRC wrapper.

## Required

| Variable | Purpose |
|----------|---------|
| `TF_NANITE_PLATFORM_URL` | WebSocket URL, for example `wss://example.tealfabric.io/api/v1/nanites/session`. |
| `TF_NANITE_STATE_DIR` | Directory for bearer secret, `nanite_id`, `tenant_id`, and allowlist cache. Mode `0700`. |

## Enrollment and identity

| Variable | Required | Purpose |
|----------|----------|---------|
| `TF_NANITE_ENROLLMENT_TOKEN` | First enroll only | One-time token from Tealfabric. Ignored once a bearer secret exists on disk. Cleared from the process environment after a successful enroll. |
| `TF_NANITE_CONTAINER_NAME` | No | Container name used by `install.sh`. Default `tealfabric-nanite`. |

## TLS and proxies

| Variable | Purpose |
|----------|---------|
| `TF_NANITE_CA_BUNDLE` | Extra PEM (corporate intercepting CA). The entrypoint appends it to the public roots. Mutually exclusive with a built-in SPKI pin. |
| `TF_NANITE_SPKI_SHA256` | Optional pin override for tests. Production pins arrive as `/etc/tealfabric-nanite/spki.sha256` from the image build. |
| `TF_NANITE_PIN_FILE` | Path to the pin file. Default `/etc/tealfabric-nanite/spki.sha256`. |
| `HTTPS_PROXY` / `HTTP_PROXY` | Proxy for the control channel only. |
| `NO_PROXY` / `no_proxy` | Hosts that skip the control-channel proxy. |
| `TF_NANITE_ENDPOINT_PROXY` | Proxy for endpoint HTTP calls. Leave unset when those calls stay on the LAN. |

## Local health

| Variable | Purpose |
|----------|---------|
| `TF_NANITE_LOCAL_HEALTH_PORT` | Bind port on `127.0.0.1`. Default `8787`. Set to `0` or a non-integer to disable. |

Example response:

```json
{
  "enrolled": true,
  "tenant_id": "uuid",
  "connected": true,
  "last_heartbeat": "2026-11-04T12:00:00.000Z",
  "in_flight": 0,
  "upgrade_deferred": false
}
```

| Field | Meaning |
|-------|---------|
| `enrolled` | State directory has a `tenant_id`. |
| `tenant_id` | Bound tenant, or `null` before enroll. |
| `connected` | Control WebSocket is open. |
| `last_heartbeat` | Last inbound control frame time, UTC. |
| `in_flight` | Endpoint calls started and not yet finished with a `result`. |
| `upgrade_deferred` | Alpine upgrade job is waiting because `in_flight` was greater than zero. |

## Alpine upgrade variables

These apply to the appliance job (`scripts/upgrade.sh`), not to a container on another distribution.

| Variable | Purpose |
|----------|---------|
| `TF_NANITE_UPGRADE_SCHEDULE` | Written to `upgrade.schedule` on first appliance install when used by packaging. Default cron fields `0 3 * * 0`. Later edits of the file win. |
| `TF_NANITE_UPGRADE_RETRY` | Retry interval in minutes while a weekly run is deferred. Default `5`. |
| `TF_NANITE_ETC` | Config directory. Default `/etc/tealfabric-nanite`. |
| `TF_NANITE_HEALTH_FILE` | Test hook: read health JSON from a file instead of localhost. |
| `TF_NANITE_APK_CMD` | Test hook: replace `apk update && apk upgrade`. |
| `TF_NANITE_RESTART_CMD` | Test hook: replace OpenRC restart. |
| `TF_NANITE_REBOOT_CMD` | Test hook: replace `reboot`. |
| `TF_NANITE_LOCK_DIR` | Upgrade lock directory. Default `$TF_NANITE_STATE_DIR/upgrade.lock`. |
| `TF_NANITE_INSTALL_DRY_RUN` | When `1`, `install.sh` prints commands and exits. |

## State directory layout

Default path: `/var/lib/tealfabric-nanite` (mode `0700`).

| File | Mode | Contents |
|------|------|----------|
| `tenant_id` | `0600` | Bound tenant UUID. |
| `nanite_id` | `0600` | Bound Nanite UUID. |
| `bearer` | `0600` | Current bearer secret. |
| `allowlist.json` | `0600` | Last acked generation and entries. Not edited by hand. |
| `upgrade.deferred` | marker | Present while the Alpine upgrade job is waiting for idle. |

Do not put endpoint passwords in this directory. Do not point two processes at the same directory.

## Logging

Logs are one JSON object per line on stdout/stderr. Fields include `call_id`, `nanite_id`, `tenant_id`, `integration_id`, destination host, HTTP status, duration, and byte counts. Logs omit enrollment tokens, bearer secrets, endpoint bodies, and `Authorization` headers.

## Commands

```sh
node dist/main.js                 # run the Nanite
node dist/main.js revoke-local    # goodbye (when possible) then wipe the state directory
```

`revoke-local` needs `TF_NANITE_STATE_DIR`. When `TF_NANITE_PLATFORM_URL` and a bearer are present, it tries to send `goodbye` before wiping.
