# Overview

## What a Nanite does

Some systems accept HTTP only from the tenant network. Tealfabric cannot open that path. A Nanite runs next to those systems, opens an outbound WebSocket to Tealfabric on port 443, and waits. When an integration is bound to that Nanite, Tealfabric sends a prepared HTTP request down the session. The Nanite dials the URL, then returns status, headers, and body in one envelope.

ProcessFlow, agents, and the Tealfabric console keep calling the integration the same way they do for a public URL. The Nanite does not introduce a new tool name. It does not read a connector identifier. It forwards the URL in the envelope when the allowlist matches.

## What a Nanite does not do

- Accept inbound connections for the control channel or for endpoint traffic.
- Act as a VPN, SSH jump host, or arbitrary TCP/UDP tunnel.
- Stream, chunk, or open a WebSocket to the endpoint.
- Store endpoint passwords on disk. Credentials in a call exist only in memory for that call.
- Host Autonomic Agents or run Tealfabric platform code.
- Load-balance one URL across many Nanites. Two sites that host the same API are two Nanites and two integrations.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Tealfabric Nanite** | This process, image, package, and OpenRC service. |
| **`nanite_id`** | UUID written at enrollment. Sent on later `hello` frames. |
| **`tenant_id`** | Tenant written at enrollment. Fixed for the life of the state directory. |
| **Control channel** | The WebSocket this process opens to Tealfabric. |
| **Enrollment token** | One-time secret from the Tealfabric Nanites screen. Used on the first `hello` only. |
| **Bearer secret** | Secret returned on the enrollment `hello_ok`. Stored mode `0600`. |
| **Allowlist** | Scheme, host, and port list edited in Tealfabric. The Nanite caches and enforces it. |
| **Active / standby** | One socket for a `nanite_id` is `active` and may dial. A second authenticated socket is `standby` until Tealfabric sends `role` `active`. |

## Install shapes

| Shape | Use when |
|-------|----------|
| Container (`install.sh` + Docker or Podman) | The site already runs containers. Updates are new image tags. |
| Alpine appliance (OpenRC package) | A dedicated Alpine host should stay small and self-upgrading with `apk`. |

Both shapes need outbound TCP 443 to Tealfabric and a state directory. Neither needs an inbound port from the internet. Recommended dedicated host size is **1 vCPU, 1 GiB RAM, 8 GiB disk** (see [Install](02_install.md)).

## One process, one tenant

The state directory binds the process to one `tenant_id` and one `nanite_id`. A second enrollment token is refused locally (`already_enrolled`) and does not open a session. Two tenants on one host are two state directories and two processes. Wiping the state directory retires the install. A new token then enrolls a new `nanite_id`.

## Where the allowlist lives

The admin edits destinations only in Tealfabric. The Nanite receives the document on `hello_ok` and on later `allowlist` frames, writes a cache for reconnect, and acks the generation. There is no second admin-edited allowlist file on the host.

## Next steps

- Install: [Install](02_install.md)
- Environment and health: [Configuration](03_configuration.md)
- Wire protocol: [Session contract](07_session-contract.md)
