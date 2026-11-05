# Architecture

## Runtime shape

```
Tealfabric API  <---wss TLS--->  Nanite process  --->  private HTTP endpoint
                                 |
                                 +-- state dir (bearer, ids, allowlist cache)
                                 +-- 127.0.0.1 health
```

The Nanite is the only process in this repository that speaks the session contract. Tealfabric's gateway, Redis inbox, MySQL tables, and worker transport live in the platform repository.

## Source layout

| Path | Role |
|------|------|
| `src/main.ts` | CLI entry. |
| `src/launch.ts` | Env validation, health server, enroll vs resume, `revoke-local`. |
| `src/runtime.ts` | WebSocket session loop, reconnect, dial orchestration. |
| `src/session-machine.ts` | Frame handling: hello, allowlist, role, credential, call, cancel, goodbye. |
| `src/call-policy.ts` | Pure rules for whether a `call` may dial. |
| `src/forward.ts` | One HTTP/HTTPS request. No redirects. Abortable. |
| `src/state-store.ts` | Atomic writes to the state directory. |
| `src/tls-peer.ts` | Hostname and optional SPKI pin checks. |
| `src/allowlist.ts` | Parse and match allowlist entries. |
| `src/health.ts` | Localhost JSON health. |
| `scripts/entrypoint.sh` | Container entry: CA merge, pin conflict, exec Node. |
| `scripts/upgrade.sh` | Alpine appliance idle-gated `apk`. |
| `install.sh` | Pull image and start container. |
| `packaging/alpine/` | OpenRC service and APKBUILD. |

## Session lifecycle

1. **Startup** — `startupPlan` chooses enroll, resume, refuse (`already_enrolled`), or missing credentials.
2. **Connect** — TLS WebSocket to `TF_NANITE_PLATFORM_URL`. Optional control proxy. Peer check: hostname, then pin when present.
3. **Hello** — Enrollment token with empty `nanite_id`, or bearer with stored `nanite_id`.
4. **Hello OK** — Store identity and optional bearer. Cache allowlist and send `allowlist_ack`. Adopt `role` and `max_in_flight`.
5. **Steady state** — Heartbeats both ways. `call` → policy → dial → `result`. `cancel` aborts. `credential` replaces the bearer. `allowlist` replaces the cache.
6. **Drop** — Close or three missed heartbeats → reconnect with backoff using the bearer.
7. **Stop** — SIGTERM → `goodbye` → finish in-flight dial → exit.

## Call path

```
call frame
  → role must be active
  → not goodbye
  → envelope_version == 1
  → tenant_id / nanite_id match
  → call_id not already seen
  → expires_at in the future
  → allowlist_generation matches acked generation
  → body under 536870912 bytes
  → URL matches allowlist
  → in_flight < max_in_flight
  → strip hop-by-hop headers
  → HTTP request (redirect: off)
  → result frame (status / headers / body_base64 / duration_ms / error)
```

Hop-by-hop headers stripped before dial: `connection`, `transfer-encoding`, `keep-alive`, `upgrade`, `proxy-authorization`.

HTTP 4xx and 5xx are normal `response.status` values with `error` null. Transport failures use the closed error code set in the session contract (`dns`, `connect_failed`, `tls`, `timeout`, …).

## Concurrency

`max_in_flight` caps concurrent endpoint dials on the active session. The platform sends a value from 1 through 16 (default 4). Above the cap the Nanite returns `busy` and does not dial. Standby sockets never dial.

## Version string

`hello` includes `nanite_version` from `package.json` (the installed package version on the appliance).

## What stays out of this repo

- Platform gateway code and Redis key layout
- Enrollment token issuance and bearer hashing
- Console UI and Notifications
- Connector packages and worker `httpTransport`
- The SPKI pin value itself (build-time inject only)
