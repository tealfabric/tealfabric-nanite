# Session contract

**Revision:** `2026-11-04.1`

This repository implements the wire protocol Tealfabric Nanite uses with the platform. The full frame definitions, limits, and credential rules are copied in [`PLANS/TEALFABRIC_NANITE_APP_PLAN.md`](PLANS/TEALFABRIC_NANITE_APP_PLAN.md) under **Session contract**.

The authoritative text is section **Session contract** in the Tealfabric platform plan:

`dev.tealfabric.io` → `docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md`

When the copy in this repository and that section differ, the platform section wins. Change the platform section first, then replace the copy in the app plan so the revision line still matches. The test `test/contract-copy.test.ts` compares both files when the platform repository is a sibling checkout at `../dev.tealfabric.io`.

## Transport summary

- WebSocket over TLS to `wss://<platform-host>/api/v1/nanites/session` on port 443.
- One JSON object per text frame, with a string `type`.
- Endpoint bodies travel as base64 inside the envelope.
- The Nanite checks the server certificate against the hostname in `TF_NANITE_PLATFORM_URL`.
- An optional SPKI pin may ship at image build. `TF_NANITE_CA_BUNDLE` and that pin are mutually exclusive.
- v1 does not stream, chunk, or open a WebSocket to the endpoint.

## Frame types

| `type` | Direction | Purpose |
|--------|-----------|---------|
| `hello` | Nanite → platform | Authenticate. |
| `hello_ok` | platform → Nanite | Session accepted. |
| `hello_reject` | platform → Nanite | Session refused; socket closes. |
| `heartbeat` | both | Liveness. |
| `allowlist` | platform → Nanite | Replace cached allowlist. |
| `allowlist_ack` | Nanite → platform | Cache updated to this generation. |
| `call` | platform → Nanite | One HTTP envelope. |
| `result` | Nanite → platform | Same `call_id`, response filled. |
| `cancel` | platform → Nanite | Abort the endpoint socket if still open. |
| `role` | platform → Nanite | `active` or `standby`. |
| `credential` | platform → Nanite | New bearer secret. |
| `credential_ack` | Nanite → platform | New secret stored. |
| `goodbye` | both | Intentional shutdown. |

Unknown `type` values are ignored, except `call`, which must be understood.

## `hello_reject` codes

Closed set: `unauthorized`, `revoked`, `expired`, `clock_skew`, `unsupported_protocol`. A tenant mismatch uses `unauthorized`.

## Result `error.code` when no HTTP status was received

Closed set: `dns`, `connect_failed`, `tls`, `timeout`, `allowlist_denied`, `body_too_large`, `expired`, `busy`, `unsupported_envelope`, `allowlist_stale`.

## Limits (contract)

| Limit | Value |
|-------|--------|
| Protocol version | `1` |
| Clock skew | 60 seconds |
| Heartbeat | From `hello_ok`; dead after 3 missed intervals; first-release default 30 seconds |
| Reconnect backoff cap | 60 seconds |
| `max_in_flight` | 1–16 from `hello_ok`; default 4 |
| Decoded body | 536870912 bytes |
| Enrollment token | 15 minutes, single use |
| Bearer secret | 30 days; renewal offered at ≤7 days remaining; previous accepted 24 hours |

## Local-only rule

`already_enrolled` is not a wire frame. When the state directory already contains `tenant_id` and no bearer is present, the process refuses another enrollment token locally and does not open a session.

## Full text

See the section from `**Contract revision: 2026-11-04.1**` through `End of session contract.` in [`PLANS/TEALFABRIC_NANITE_APP_PLAN.md`](PLANS/TEALFABRIC_NANITE_APP_PLAN.md).
