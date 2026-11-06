# Operations

## Day-one checklist

1. Create the Nanite and allowlist in Tealfabric.
2. Run `install.sh` (or the appliance package) with the snippet.
3. Confirm **Connected** in the console and `connected: true` on localhost health.
4. Bind a generic REST API integration to that Nanite (or leave **Direct from Tealfabric** for public URLs).
5. Run the integration test from Tealfabric.

## Health

```sh
wget -qO- http://127.0.0.1:8787/health
```

| Symptom | Likely cause |
|---------|--------------|
| `enrolled: false` | Enrollment never completed. Check token expiry and logs. |
| `connected: false` | Outbound 443 blocked, TLS trust failure, or platform downtime. |
| `in_flight` stuck high | Endpoint is slow or hung. Calls expire at `expires_at`. `cancel` aborts the socket. |
| `upgrade_deferred: true` | Alpine upgrade waited because a call was in progress. |

## Reconnect

When the control session drops, the process reconnects with exponential backoff and jitter, capped at 60 seconds, using the stored bearer secret. Missing three heartbeat intervals also ends the session and triggers reconnect. Heartbeat interval comes from `hello_ok` (default 30 seconds).

In-flight endpoint calls on a dead active socket are not retried by the Nanite. Tealfabric marks those executions failed. The endpoint may already have applied the request.

## Credential renewal

Bearer lifetime is 30 days. Tealfabric offers a new secret on the live session when 7 days or less remain (`credential` frame). The Nanite stores it and replies `credential_ack`. The new secret works immediately. The previous secret remains valid on `hello` for 24 hours on the platform side. Operators do not rotate the bearer by hand.

## Standby

A second process that enrolls with the same `nanite_id` and bearer receives `role` `standby`. It heartbeats and does not dial. When the active socket closes, Tealfabric sends `{ "type": "role", "role": "active" }` to the standby. Until that frame arrives, `call` frames are ignored.

## Revoke on the host

```sh
TF_NANITE_PLATFORM_URL='wss://…/api/v1/nanites/session' \
TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite \
node dist/main.js revoke-local
```

Sends `goodbye` when possible, then deletes identity and bearer files. Tealfabric still shows the Nanite until an admin revokes it in the console. After a local wipe, a new enrollment token creates a new `nanite_id`.

## Revoke in Tealfabric

Revoke in the console ends acceptance of the bearer and drops the live session. Integrations that still select that Nanite fail until the selector is cleared or a new Nanite is enrolled.

## Offline behavior

When the Nanite is offline, Tealfabric fails the integration call immediately (`nanite_offline`). It does not fall through to a direct platform HTTP call to the same URL. The console shows offline presence. One tenant notification is created on the transition to offline (platform side).

## Limits that affect a call

| Limit | Value |
|-------|--------|
| Schemes | `http`, `https` only |
| Redirects | Returned as the response. The Nanite does not follow them. |
| `max_in_flight` | From `hello_ok`, 1–16, default 4. Above the cap returns `busy`. |
| Decoded body | At most `536870912` bytes on request or response. Over that: `body_too_large`. |
| Allowlist | Scheme, host, and port must match. URL userinfo is denied. |
| Envelope version | Unsupported `envelope_version` returns `unsupported_envelope` and does not dial. |
| `expires_at` | Absolute UTC. After that instant the Nanite returns `expired` and does not dial. |
| Duplicate `call_id` | Remembered until expiry. A repeat does not dial again. |

## Signals

`SIGTERM` and `SIGINT` set goodbye, send `{ "type": "goodbye" }` when the socket is open, finish an endpoint call that has already started, and exit. OpenRC and container stop use this path. A new call is not started after goodbye.

## Logs

```sh
podman logs -f tealfabric-nanite          # container stdout JSON
logread | grep tealfabric-nanite          # Alpine BusyBox syslog, when enabled
```

## Support data

When collecting logs for support, strip or avoid pasting:

- Enrollment tokens
- Bearer secrets
- Endpoint bodies
- `Authorization` and similar headers

Safe fields: `call_id`, `nanite_id`, `tenant_id`, `integration_id`, host, status, duration, byte counts, `error_code`.
