# Tealfabric Nanite v0.1.0

**First production release** — 10 November 2026

Tealfabric Nanite is a tenant-installed Node.js 26 process that opens an **outbound-only** WebSocket to Tealfabric and forwards prepared HTTP calls to private endpoints on the tenant network. Integrations, ProcessFlow, and agents keep calling the same way they do for a public URL; the Nanite does not introduce a new tool surface.

## Highlights

- **Outbound control channel** — TLS WebSocket to Tealfabric on port 443; no inbound ports required for the control path
- **Enrollment and resume** — one-time enrollment token on first connect; bearer secret persisted for later sessions; platform-driven credential renewal
- **Allowlist enforcement** — destinations edited only in Tealfabric; cached and enforced locally (scheme, host, port); default deny; no redirects followed
- **Prepared call forwarding** — HTTP/HTTPS dial with status, headers, and body returned in one envelope; hop-by-hop headers stripped; concurrent dials capped by `max_in_flight` (default 4, max 16)
- **Active / standby** — a second authenticated session can sit standby and take over when Tealfabric promotes it
- **Local health** — JSON health on `127.0.0.1` (default port 8787)
- **Logging** — JSON on stdout and optional syslog; secrets and endpoint bodies omitted
- **TLS options** — public roots, corporate CA bundle, or optional SPKI pin (pin and CA bundle are mutually exclusive)
- **Proxy support** — control-channel proxy (`HTTPS_PROXY` / `HTTP_PROXY`) and optional endpoint proxy

## Install shapes

| Shape | When to use |
|-------|-------------|
| **Container** (`install.sh` + Docker or Podman) | Site already runs containers; updates via image tags / CDN `release.json` |
| **Alpine appliance** (OpenRC + `apk`) | Dedicated Alpine host with idle-gated weekly upgrades |

Installer: `https://cdn.tealfabric.io/nanite/install.sh`  
Default session URL: `wss://tealfabric.io/api/v1/nanites/session`

Recommended dedicated host: **1 vCPU, 1–2 GiB RAM, 8 GiB disk**, Alpine in sys mode on a persistent disk.

## Security (first release)

- Outbound-only control path; health bound to localhost
- Bearer and identity files mode `0600` in a `0700` state directory
- Endpoint credentials exist only in memory for the duration of a call
- Allowlist is the destination control plane; revoke in Tealfabric ends the bearer; `revoke-local` wipes host state

## Requirements

- Node.js **≥ 26** (image / appliance packages include the runtime)
- Outbound TCP **443** to Tealfabric
- LAN reachability to allowlisted private HTTP endpoints

## Documentation

Operator and security guides live under [`docs/`](README.md): install, configuration, operations, security, architecture, session contract, Alpine appliance, and troubleshooting.
