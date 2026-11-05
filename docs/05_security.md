# Security

## Trust boundary

The Nanite is code that runs on the tenant network. It receives prepared HTTP requests that may include endpoint credentials for one call. Those credentials are not written to the state directory. The allowlist from Tealfabric is the destination control for which hosts the Nanite will dial.

## Authentication

| Stage | Mechanism |
|-------|-----------|
| Transport | TLS to the hostname in `TF_NANITE_PLATFORM_URL`. |
| First enroll | One-time enrollment token in `hello.auth` with `method: enrollment_token`. |
| Later sessions | Bearer secret in `hello.auth` with `method: bearer`. |
| Platform storage | Tealfabric stores SHA-256 hashes of enrollment tokens and bearer secrets. The hash algorithm is not a wire field. |

There is no Nanite client certificate in v1. Clock skew over 60 seconds on `hello.sent_at` is rejected with `clock_skew`.

## Enrollment binding

When `tenant_id` already exists in the state directory and no bearer is present, a new enrollment token is refused locally (`already_enrolled`) and no WebSocket is opened. That prevents a second tenant from claiming an installed state directory by pasting another token.

## Allowlist

- Default deny.
- Match is scheme, host, and port after URL parse.
- URL userinfo is rejected.
- Schemes other than `http` and `https` are denied.
- Redirects are not followed. A `Location` to another host is not dialed as a second connection.
- A `call` with a generation that is not the acked generation returns `allowlist_stale` and does not dial.

The admin edits the allowlist only in Tealfabric. The on-disk `allowlist.json` is a cache.

## TLS options

1. **Public roots** — default. Hostname check against `TF_NANITE_PLATFORM_URL`.
2. **Corporate CA** — `TF_NANITE_CA_BUNDLE` / `--ca-file`. Entrypoint concatenates the public bundle with the extra PEM and sets `NODE_EXTRA_CA_CERTS`. Hostname check remains.
3. **SPKI pin** — optional release pin written to `/etc/tealfabric-nanite/spki.sha256` at image build (`NANITE_SPKI_SHA256`). Pin and `TF_NANITE_CA_BUNDLE` together refuse to start. The pin value is not committed in this repository.

## Proxies

| Variable | Scope |
|----------|--------|
| `HTTPS_PROXY` / `HTTP_PROXY` | Control channel to Tealfabric. |
| `NO_PROXY` | Hosts that skip the control proxy. |
| `TF_NANITE_ENDPOINT_PROXY` | Endpoint calls only. Leave unset for LAN endpoints. |

Do not route private endpoint calls through an untrusted proxy unless that is an explicit network design.

## Secrets on disk

| Path | Sensitivity |
|------|-------------|
| `bearer` | High. Mode `0600`. |
| `tenant_id` / `nanite_id` | Identifiers. Mode `0600`. |
| `allowlist.json` | Destination metadata. Mode `0600`. |
| Enrollment token | Environment only for first run. Not written to disk by this process. |

State directory mode is `0700`. Prefer a dedicated OS user for the Alpine package (`tealfabric-nanite`).

## Logging

Logs omit enrollment tokens, bearer secrets, endpoint bodies, and `Authorization` headers. Prefer that policy when shipping logs to a central collector.

## Network exposure

- Control channel: outbound only.
- Health: `127.0.0.1` only. Do not publish that port on a public interface.
- Endpoint sockets: outbound from the Nanite to allowlisted hosts.

## Threat notes for operators

- A compromised Nanite host can dial any allowlisted host with credentials Tealfabric places in envelopes for that Nanite's integrations. Keep allowlists tight.
- Revoke in Tealfabric ends the bearer immediately. Follow with `revoke-local` or wipe the state directory if the host is being decommissioned.
- Two state directories on one host keep two tenants separate. Sharing a state directory shares the bearer.
