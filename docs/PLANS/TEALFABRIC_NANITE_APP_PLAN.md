# Tealfabric Nanite

**Status:** implemented in this repository. The session contract below stays a copy of the platform plan.  
**Created:** 2026-11-04  
**Repository:** this file moves to the open-source repository `tealfabric-nanite`.  
**Audience:** Nanite maintainers and tenant operators

This file specifies the Tealfabric Nanite process: the Node.js 26 program a tenant runs beside a private HTTP endpoint, the image and installer, and the Alpine appliance.

The session contract below is a copy. The authoritative text is section "Session contract" in `docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md` in the Tealfabric platform repository `dev.tealfabric.io`. When this copy and that section differ, the platform section wins. Change the platform section first, then replace this copy so the contract revision line matches.

Platform storage, the session handler, console screens, worker routing, and platform secrets are specified only in that platform plan.

---

## 1) What this repository builds

Tealfabric Nanite dials the platform, holds one control session, and forwards one prepared HTTP request at a time to an endpoint on the tenant network. It returns the endpoint status, headers, and body in one envelope.

The process is unattended after enrollment. Reconnect, heartbeat, and credential renewal run without an operator at the keyboard.

Package, container image, Alpine package, and OpenRC service are all named `tealfabric-nanite`. Node.js is 26. This repository has its own `package.json` and lockfile.

One process is bound to one tenant for the lifetime of its state directory. One active session forwards calls. A second session for the same `nanite_id` stays standby until the platform sends `role` `active`.

v1 forwards HTTP and HTTPS. The process does not read a connector identifier. It dials the URL in the envelope when the allowlist matches.

---

## 2) Vocabulary

| Term | Meaning |
|------|---------|
| **Tealfabric Nanite** | This process. |
| **`nanite_id`** | UUID written at enrollment. Sent on later `hello` frames. |
| **`tenant_id`** | Tenant written at enrollment. Fixed until the state directory is wiped. |
| **Control channel** | The WebSocket this process opens to the platform. |
| **Enrollment token** | One-time secret the tenant admin copies from Tealfabric. Used on the first `hello` only. |
| **Bearer secret** | Secret returned on the enrollment `hello_ok`. Stored in the state directory mode `0600`. |
| **Allowlist cache** | The last allowlist generation this process has acked. The admin edits the list in Tealfabric. This host has no second copy to edit. |
| **Session contract** | The copied wire rules in this file. |

---

## 3) Host and image

Outbound TCP 443 and a state directory. No inbound port, no database, and no platform checkout on the site.

The runtime base is Alpine with the official Node.js 26 musl build and Alpine `ca-certificates`.

| Install | What runs |
|---------|-----------|
| Container on an existing server | Docker or Podman. The image is based on `node:26-alpine` and already contains Node 26, this app, and the public CA bundle. |
| Alpine appliance | A persistent Alpine disk that does nothing else. Podman runs the same image, or the `tealfabric-nanite` package runs the process under OpenRC. `apk` maintains Alpine and the CA bundle. Node 26 stays the official musl build under `/usr/local`. The package does not depend on Alpine's `nodejs` package. |

The image contains the app, the entrypoint, and the public CA bundle. The entrypoint creates the state-directory mode, appends an optional corporate PEM, and starts the process.

### `install.sh`

`install.sh` is the supported installer.

1. If `docker` or `podman` is missing and the host is Alpine, install Podman with `apk`. On any other distribution, print that distribution's Docker or Podman install command and stop.
2. Pull the image tag the admin pasted from Tealfabric. The snippet names the registry and the tag. This repository publishes the image as `tealfabric-nanite`.
3. Create the state directory mode `0700`. Do not write an allowlist file.
4. When the admin passed `--ca-file`, mount that PEM read-only. The entrypoint appends it and sets `NODE_EXTRA_CA_CERTS`. The public roots stay in place.
5. Start the container with the enrollment token in the environment for the first run. Restart policy is always. After enroll, the token is not required again.
6. Print `nanite_id` when `hello_ok` succeeds.

A container on a distribution other than the Alpine appliance updates by pulling a newer image tag. That install does not run `apk upgrade` on the host and does not reboot the host.

Corporate intercepting proxies use `--ca-file`. That file and an SPKI pin shipped in a release are mutually exclusive. The process refuses to start when both are set. The pin bytes are supplied at image build and are not committed in this repository.

---

## 4) Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `TF_NANITE_PLATFORM_URL` | yes | `wss://…/api/v1/nanites/session` |
| `TF_NANITE_STATE_DIR` | yes | Bearer secret, `nanite_id`, `tenant_id`, cached allowlist. Mode `0700`. |
| `TF_NANITE_ENROLLMENT_TOKEN` | enroll only | Removed from the environment after a successful enroll. Ignored once a bearer secret exists. |
| `TF_NANITE_CA_BUNDLE` | no | Extra PEM appended by the entrypoint. Mutually exclusive with a built-in SPKI pin. |
| `HTTPS_PROXY` / `NO_PROXY` | no | Proxy for the control channel only. |
| `TF_NANITE_ENDPOINT_PROXY` | no | Proxy for endpoint calls. Leave unset when endpoint calls stay on the LAN. |
| `TF_NANITE_LOCAL_HEALTH_PORT` | no | Binds `127.0.0.1` only. |
| `TF_NANITE_UPGRADE_SCHEDULE` | no | Written to `upgrade.schedule` on first appliance install. Default `0 3 * * 0`. Later edits of the file win. |
| `TF_NANITE_UPGRADE_RETRY` | no | Retry interval while a weekly run is deferred. Default every five minutes. |

Local health JSON:

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

`in_flight` counts endpoint calls that have started and have not yet produced a `result`.

Logs include `call_id`, `nanite_id`, `tenant_id`, `integration_id`, destination host, HTTP status, duration, and byte counts. Logs omit enrollment tokens, bearer secrets, endpoint bodies, and `Authorization` headers. A support bundle is header-stripped.

---

## 5) One process, one tenant

| File in the state directory | Rule |
|-----------------------------|------|
| `tenant_id` | Written from `hello_ok`. A later enrollment token is refused locally with `already_enrolled` and does not open a session. |
| `nanite_id` | Written at the same time. Later `hello` frames send this id. |
| Bearer secret | Mode `0600`. Presented as `auth.method` `bearer`. |
| Allowlist cache | Last acked generation. The admin does not edit this file. |

Wiping the directory is how an admin retires the install. A new token then enrolls a new `nanite_id`. Two tenants on one host are two state directories and two processes.

`tealfabric-nanite revoke-local` sends `goodbye` and then wipes the state directory.

---

## 6) Forwarding

1. Resolve `TF_NANITE_PLATFORM_URL` and open TLS. Check the hostname. Use the SPKI pin when the release includes one and `TF_NANITE_CA_BUNDLE` is unset.
2. Send `hello` with an empty `nanite_id` and the enrollment token, or with the stored `nanite_id` and the bearer secret.
3. On `hello_ok`, store `nanite_id`, `tenant_id`, and, on first enroll, the bearer secret. Cache the allowlist and ack its generation.
4. Heartbeat at `heartbeat_interval_seconds`. Reconnect with exponential backoff and jitter, capped at 60 seconds, using the stored bearer secret.
5. On `call`, check `tenant_id`, `nanite_id`, `expires_at`, `allowlist_generation`, and the parsed URL. Perform one HTTP request. Write `result`.
6. On `cancel`, abort the endpoint socket if it is still open.
7. Ignore `call` frames while `role` is `standby`. After a `role` frame sets `active`, accept calls.

The process applies the URL the envelope contains. It follows no redirects. It strips hop-by-hop headers named in the session contract. It stores endpoint credentials only in memory for that call.

A `call` whose generation is not the acked generation returns `allowlist_stale` and does not dial.

---

## 7) Unattended upgrade on the Alpine appliance

The appliance root is a normal Alpine disk. Weekly `apk` writes to that disk. A container on another distribution does not run this job and does not reboot that host.

`/etc/apk/repositories` lists the Alpine mirrors and the signed repository that publishes `tealfabric-nanite`. The package installs the app and, when the release needs it, the Node 26 musl build under `/usr/local`.

Paths the package leaves in place:

| Path | Contents |
|------|----------|
| `/etc/tealfabric-nanite/config.env` | Platform URL, extra CA path, proxy variables |
| `/etc/tealfabric-nanite/upgrade.schedule` | Cron line. Default `0 3 * * 0` (Sunday 03:00, host local time) |
| `/etc/tealfabric-nanite/extra-ca.pem` | Corporate CA, when supplied |
| `/var/lib/tealfabric-nanite/` | Bearer secret, `nanite_id`, `tenant_id`, allowlist cache. Mode `0700` |

The `/etc/tealfabric-nanite` files are protected configuration. The state directory is not part of the package.

Alpine `crond` runs the schedule. The admin edits `upgrade.schedule` and reloads cron. That edit does not restart Node. The install snippet from Tealfabric does not set this file.

The job:

1. Read localhost health. Use `in_flight`.
2. When `in_flight` is greater than zero, exit. Do not run `apk`, do not restart Node, and do not reboot. A retry schedule, default every five minutes, stays enabled only while that weekly run is deferred. The deferred run does not start a second `apk`.
3. When `in_flight` is zero, run `apk update && apk upgrade`.
4. When the `tealfabric-nanite` package or the Node binary changed, check `in_flight` again, then restart the OpenRC service `tealfabric-nanite`. SIGTERM sends `goodbye`, finishes a call that has already reached the endpoint, and exits. OpenRC starts the process from the same state directory.
5. When `apk` installed a newer kernel than `uname -r`, reboot only after `in_flight` is zero again. OpenRC starts the process after boot from the same configuration.

A process that stays busy keeps deferring. The job does not force a restart or a reboot. Health reports `upgrade_deferred` while that wait is outstanding.

The `hello` version string is the installed package version.

---

## 8) Session contract

**Status:** copy. Contract revision must equal the authoritative section in `dev.tealfabric.io` `docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md`. If the texts differ, the platform section wins.

**Contract revision: 2026-11-04.1**

### Transport

- The Nanite opens a WebSocket over TLS to `wss://<platform-host>/api/v1/nanites/session` on port 443.
- Each WebSocket text message is one JSON object with a string `type`.
- Endpoint bodies travel as base64 inside the envelope.
- The Nanite checks the server certificate against the hostname in `TF_NANITE_PLATFORM_URL`.
- A release may include an SPKI pin of the platform certificate, supplied at image build. `TF_NANITE_CA_BUNDLE` and that pin are mutually exclusive. The process refuses to start when both are set. The pin value is not part of this contract and is not stored in the Nanite source repository.
- v1 does not stream, chunk, or open a WebSocket to the endpoint.

### Protocol version

- `protocol_version` is an integer. This contract is version `1`.
- The platform accepts version `1`. After a future bump it also accepts the previous version.
- A Nanite that receives an `envelope_version` it does not implement returns `result` with `error.code` `unsupported_envelope` and does not dial.

### Frames

| `type` | Direction | Purpose |
|--------|-----------|---------|
| `hello` | Nanite → platform | Authenticate. |
| `hello_ok` | platform → Nanite | Session accepted. |
| `hello_reject` | platform → Nanite | Session refused. The platform then closes the socket. |
| `heartbeat` | both | Liveness. |
| `allowlist` | platform → Nanite | Replace the cached allowlist. |
| `allowlist_ack` | Nanite → platform | Cache updated to this generation. |
| `call` | platform → Nanite | One envelope. `response` is null. |
| `result` | Nanite → platform | Same `call_id`, response filled. |
| `cancel` | platform → Nanite | Caller timed out. Abort the endpoint socket if it is still open. |
| `role` | platform → Nanite | Change `active` / `standby`. |
| `credential` | platform → Nanite | New bearer secret on an authenticated session. |
| `credential_ack` | Nanite → platform | New secret stored. |
| `goodbye` | both | Intentional shutdown. |

A reader ignores an unknown `type`, except `call`, which must be understood.

### `hello`

```json
{
  "type": "hello",
  "protocol_version": 1,
  "nanite_id": "",
  "sent_at": "2026-11-04T12:00:00.000Z",
  "auth": { "method": "enrollment_token", "secret": "" }
}
```

- `nanite_id` is an empty string on first enrollment and the stored UUID after that.
- `sent_at` is the Nanite clock, UTC, RFC 3339.
- `auth.method` is `enrollment_token` or `bearer`. The message contains one method.
- The platform rejects `hello` with `clock_skew` when `sent_at` differs from platform time by more than 60 seconds.
- The Nanite does not send a spent enrollment token.

`hello_ok`:

```json
{
  "type": "hello_ok",
  "protocol_version": 1,
  "nanite_id": "uuid",
  "tenant_id": "uuid",
  "session_id": "uuid",
  "role": "active",
  "heartbeat_interval_seconds": 30,
  "max_in_flight": 4,
  "bearer_secret": null,
  "allowlist": {
    "generation": 1,
    "entries": [{ "scheme": "https", "host": "device.lan", "port": 443 }]
  }
}
```

- `role` is `active` or `standby`.
- `bearer_secret` is a string on the enrollment `hello_ok` and null on later sessions. The Nanite stores it mode `0600` and records `tenant_id` and `nanite_id`.
- Both sides send `heartbeat` every `heartbeat_interval_seconds`. Missing three intervals makes that session dead.
- Reconnect uses exponential backoff with jitter, capped at 60 seconds.
- `max_in_flight` is the cap for endpoint calls on the active session. Above it, the Nanite returns `busy` and does not dial. The platform sends a value from 1 through 16. The first-release default is 4.

`hello_reject`:

```json
{ "type": "hello_reject", "code": "unauthorized" }
```

Closed set: `unauthorized`, `revoked`, `expired`, `clock_skew`, `unsupported_protocol`. A tenant mismatch uses `unauthorized`.

### Heartbeat

```json
{ "type": "heartbeat", "sent_at": "2026-11-04T12:00:00.000Z" }
```

### Allowlist

- The platform document is the only allowlist. The Nanite has no second file for an admin to edit.
- `hello_ok` carries the current document. A later `allowlist` frame replaces it.
- The Nanite replies with `allowlist_ack` for the generation it cached.
- A `call` names `allowlist_generation`. When that value is not the acked generation, the Nanite returns `allowlist_stale` and does not dial.
- The Nanite persists the last acked document and enforces it on reconnect until a newer generation is acked.

```json
{
  "type": "allowlist",
  "generation": 2,
  "entries": [{ "scheme": "https", "host": "device.lan", "port": 443 }]
}
```

```json
{ "type": "allowlist_ack", "generation": 2 }
```

An entry matches scheme, host, and port after the Nanite parses `request.url`. Host comparison uses the host in that URL. Default deny. URL userinfo is rejected. Schemes are `http` and `https`.

### Standby

A second authenticated socket for the same `nanite_id` receives `role` `standby`. It heartbeats and does not perform endpoint calls. The platform promotes it with:

```json
{ "type": "role", "role": "active" }
```

The Nanite accepts `call` frames only while its latest role is `active`. Calls in flight on a dead active socket are not retried by the Nanite. The endpoint may already have applied the request.

### Call envelope

`call`:

```json
{
  "type": "call",
  "envelope_version": 1,
  "call_id": "uuid",
  "tenant_id": "uuid",
  "nanite_id": "uuid",
  "integration_id": "uuid",
  "execution_id": "uuid",
  "allowlist_generation": 1,
  "issued_at": "2026-11-04T12:00:00.000Z",
  "expires_at": "2026-11-04T12:01:00.000Z",
  "request": {
    "method": "POST",
    "url": "https://device.lan/api/v1/reading",
    "headers": [{ "name": "content-type", "value": "application/json" }],
    "body_base64": ""
  },
  "response": null
}
```

`result` uses the same fields. `response` is:

```json
{
  "status": 200,
  "headers": [{ "name": "content-type", "value": "application/json" }],
  "body_base64": "",
  "duration_ms": 40,
  "error": null
}
```

- `call_id` is a UUID the platform creates for this attempt. The Nanite echoes it. The platform drops a result for an unknown or expired `call_id`.
- The Nanite remembers `call_id` until `expires_at` and does not dial that id twice.
- `tenant_id` and `nanite_id` match `hello_ok`.
- `integration_id` and `execution_id` are platform identifiers. The Nanite echoes them and does not interpret them.
- `expires_at` is absolute UTC. The Nanite does not start an endpoint call after that instant and returns `error.code` `expired`.
- Header names are lowercase. The Nanite strips `connection`, `transfer-encoding`, `keep-alive`, `upgrade`, and `proxy-authorization` before it dials.
- Redirects are off. A 3xx is returned as `response.status`.
- An HTTP 4xx or 5xx is `response.status` with `error` null.
- `error` is null or `{ "code": "<code>" }`. Closed set when no HTTP status was received: `dns`, `connect_failed`, `tls`, `timeout`, `allowlist_denied`, `body_too_large`, `expired`, `busy`, `unsupported_envelope`, `allowlist_stale`.
- Decoded `body_base64` on the request and on the response must be at most `536870912` bytes. Over that size the Nanite returns `body_too_large`, does not dial when the request is over the cap, and stops reading when the response crosses the cap.
- The Nanite does not parse the endpoint body.

### `cancel` and `goodbye`

```json
{ "type": "cancel", "call_id": "uuid" }
```

```json
{ "type": "goodbye" }
```

On process stop the Nanite sends `goodbye`, finishes an endpoint call that has already started, and exits. It does not start a new call after `goodbye`.

### Credential life

- Enrollment token lifetime is 15 minutes, single use. Issuing a new token invalidates the previous unused token.
- Bearer lifetime is 30 days. The platform offers a new secret on the live session when 7 days or less remain.
- The new secret works immediately. The previous secret is still accepted on `hello` for 24 hours.
- Revoke ends acceptance immediately and drops the live session.

```json
{
  "type": "credential",
  "bearer_secret": "",
  "not_after": "2026-12-04T12:00:00.000Z"
}
```

```json
{ "type": "credential_ack" }
```

The platform stores only a hash of the enrollment token and only a hash of the bearer secret. The hash algorithm is chosen in the platform repository and is not a wire field.

### Enrollment state on the Nanite

`already_enrolled` is not a frame. When the state directory already contains `tenant_id`, the process refuses another enrollment token locally and does not open a session.

### Limits

| Limit | Value |
|-------|--------|
| Clock skew | 60 seconds |
| Heartbeat | `heartbeat_interval_seconds` from `hello_ok`; session dead after 3 missed intervals |
| First-release heartbeat | 30 seconds |
| Reconnect backoff cap | 60 seconds |
| `max_in_flight` | Integer 1 through 16, sent in `hello_ok`; default 4 |
| Decoded body | 536870912 bytes |
| Enrollment token | 15 minutes, single use |
| Bearer secret | 30 days |
| Renewal offered | At 7 days remaining |
| Previous bearer still accepted | 24 hours |

End of session contract.


---

## 9) Non-goals

- A VPN, or arbitrary TCP, UDP, or SSH.
- A public listener.
- Streaming, server-sent events, or a WebSocket to the endpoint.
- Persisting endpoint passwords. They exist in the envelope for one call and are not written to the state directory.
- Forcing a Node restart or a host reboot while `in_flight` is greater than zero.
- Running this `apk` job on a host that is not the Alpine appliance.
- Active-active forwarding for one `nanite_id`.
- Installing Alpine's `nodejs` package or a second Node build beside `/usr/local`.
- Changing `tenant_id` while the state directory still has a tenant file.
- Platform session-handler source, platform secrets, or tenant data in this repository.

---

## 10) Work in this repository

### Phase 1 — Enroll and heartbeat

Image, state directory, `hello` / `hello_ok` / heartbeat, `already_enrolled` when the directory is already bound.

**Exit:** the image enrolls, survives a dropped session by reconnecting with the bearer secret, and refuses a second enrollment token without opening a socket.

### Phase 2 — HTTP forward

Allowlist enforcement, one synchronous HTTP call, envelope limits, `result` error codes from the session contract.

**Exit:** an allowed URL returns the endpoint status. A different host, port, `file:` URL, or redirect `Location` does not open a second connection. An expired envelope does not open a socket. A repeated `call_id` does not dial twice.

### Phase 3 — Operations

`credential` / `credential_ack`, standby `role`, `revoke-local`, `install.sh`.

**Exit:** a new bearer is what the next `hello` sends. A standby socket performs no endpoint call until `role` is `active`.

### Phase 4 — Hardening

SPKI pin supplied at build, proxy environment variables, `clock_skew` when `sent_at` is off by more than 60 seconds, upgrade job idle gate.

**Exit:** a pin and `TF_NANITE_CA_BUNDLE` together refuse to start. The upgrade job exits while `in_flight` is greater than zero and runs `apk` when `in_flight` is zero.

---

## 11) Tests

- Reject a TLS certificate for a different hostname. Reject a pin mismatch.
- `already_enrolled` opens no session.
- Allowlist: matching host succeeds. Another host, another port, a `file:` URL, and a redirect off the list do not dial the second host.
- Expired `expires_at` does not open an endpoint socket.
- Duplicate `call_id` does not call the endpoint twice.
- `cancel` aborts an open endpoint socket.
- A decoded body over `536870912` bytes returns `body_too_large` and is not written to logs.
- Only `role` `active` performs endpoint calls.
- Entrypoint trusts the public roots and an extra PEM from `TF_NANITE_CA_BUNDLE`.
- Upgrade fixture: `in_flight` greater than zero skips `apk`. `in_flight` zero runs it. Files under `/etc/tealfabric-nanite` and `/var/lib/tealfabric-nanite` are still present afterward.
- This copy's contract revision line equals the platform plan.
