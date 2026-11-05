# Tealfabric Nanite documentation

Tealfabric Nanite is a tenant-installed Node.js 26 process that dials Tealfabric over TLS, holds one control session, and forwards prepared HTTP calls to private endpoints on the tenant network. It does not accept inbound connections.

| Guide | Audience |
|-------|----------|
| [Overview](01_overview.md) | Anyone deciding whether a Nanite fits |
| [Install](02_install.md) | Tenant operators |
| [Configuration](03_configuration.md) | Operators and integrators |
| [Operations](04_operations.md) | Day-2 runbooks |
| [Security](05_security.md) | Security and platform reviewers |
| [Architecture](06_architecture.md) | Maintainers |
| [Session contract](07_session-contract.md) | Protocol implementers |
| [Alpine appliance](08_alpine-appliance.md) | Appliance operators |
| [Development](09_development.md) | Contributors |
| [Troubleshooting](10_troubleshooting.md) | Operators |

The product design and phase plan live in [`PLANS/TEALFABRIC_NANITE_APP_PLAN.md`](PLANS/TEALFABRIC_NANITE_APP_PLAN.md). That plan also carries a copy of the session contract. The authoritative contract text is in the Tealfabric platform repository (`dev.tealfabric.io`, `docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md`). When the two differ, the platform text wins.

Platform storage, the console, the session gateway, Redis, MySQL, and worker routing are documented only in the platform repository. This repository documents the process that runs on the tenant host.
