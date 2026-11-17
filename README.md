# Tealfabric Nanite

Tenant-installed Node.js 26 process that dials Tealfabric and forwards prepared HTTP calls to private endpoints. Outbound control channel only.

**Documentation:** [`docs/README.md`](docs/README.md)

## Install from the CDN

Pre-built images are published at `https://cdn.tealfabric.io/nanite/`. On the Nanite host (root; Podman or Docker — Alpine installs Podman when neither is present):

```sh
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
```

The script reads `latest/release.json`, downloads `tealfabric-nanite-linux-<arch>.tar.gz` (`amd64` or `arm64`), checks `SHA256SUMS`, starts the container, and enables it to start on boot. Pin a release with `TF_NANITE_CHANNEL=0.1.0`. The enrollment token is shown once in the Tealfabric console and expires after 15 minutes. Full steps: [Install](docs/02_install.md).

| Start here | |
|------------|--|
| Operators | [Install](docs/02_install.md) · [Configuration](docs/03_configuration.md) · [Operations](docs/04_operations.md) |
| Security | [Security](docs/05_security.md) |
| Contributors | [Development](docs/09_development.md) |
| Design plan | [docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md](docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md) |

```sh
nvm use          # Node 26
npm ci && npm test
```
