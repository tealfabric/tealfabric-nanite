# Install

Preferred host: **Alpine Linux**, as a virtual machine or as a dedicated appliance disk. Both shapes need outbound TCP 443 to Tealfabric and a writable state directory. Neither needs an inbound port from the internet.

Default platform URL host is `tealfabric.io`:

```text
wss://tealfabric.io/api/v1/nanites/session
```

Replace that host only when Tealfabric (or your operator) gives you a different hostname.

## Recommended host resources

Size a dedicated Alpine VM or appliance for Nanite alone. The process holds one control session and forwards one HTTP call at a time; it does not need a large host.

| Resource | Recommended | Minimum | Notes |
|----------|-------------|---------|-------|
| **vCPU** | 1 | 1 | A second vCPU is optional headroom for OS and container runtime; Nanite itself is not CPU-bound. |
| **RAM** | 1 GiB | 512 MiB | Use **1 GiB** for Path A (Podman/Docker). **512 MiB** can work for Path B (OpenRC package, no container runtime) on a quiet host. |
| **Disk** | 8 GiB | 4 GiB | Covers Alpine, the Nanite image or package, `apk` upgrades, and logs. The state directory (`/var/lib/tealfabric-nanite`) stays small (identity, bearer, allowlist cache). |

Network: outbound TCP 443 to Tealfabric; LAN reachability to the private HTTP endpoint. No inbound ports for the Nanite.

## Before you start

1. In the Tealfabric console, create the Nanite.
2. Copy the install snippet when it appears. For Path A it is the enrollment token plus the CDN `curl … | sh -` line below.
3. The enrollment token is shown once and expires after 15 minutes. Tealfabric stores only a hash of that token. Paste it into the host within that window.

Prerequisites on the host:

- Reach the private HTTP endpoint the Nanite will call.
- Outbound TCP 443 to the platform host (default `tealfabric.io`).
- Disk for the state directory (default `/var/lib/tealfabric-nanite`), mode `0700`.
- Root (or equivalent) for package install and service start.

Local health binds `127.0.0.1` only. No inbound firewall opening is required for the Nanite itself.

## Choose an install shape

| Shape | Use when |
|-------|----------|
| **Alpine VM + container (`install.sh`)** | Fastest path. A normal Alpine VM (or any Alpine guest) runs Podman/Docker and the published image. |
| **Alpine appliance (OpenRC package)** | A dedicated Alpine disk that runs Nanite under OpenRC and self-upgrades with weekly `apk`. |

Both keep identity in `/var/lib/tealfabric-nanite`. Day-2 appliance behavior is in [Alpine appliance](08_alpine-appliance.md).

---

## Path A — Alpine VM with `install.sh` (recommended)

The installer is published at:

```text
https://cdn.tealfabric.io/nanite/install.sh
```

Run it on the Nanite VM with `curl … | sh -`. No repository checkout is required. On Alpine, `install.sh` installs Podman with `apk` when neither Docker nor Podman is present.

### 1. Boot Alpine and become root

Install Alpine as a VM (or use an existing Alpine guest). Log in and become root:

```sh
su -
```

### 2. Bring networking and base tools online

```sh
setup-interfaces
setup-dns
rc-service networking start
rc-update add networking boot
apk update
apk add curl ca-certificates
```

Confirm the host can reach the CDN and Tealfabric:

```sh
curl -fsSI https://cdn.tealfabric.io/nanite/install.sh >/dev/null && echo ok
```

### 3. Install and enroll (one shot)

Paste the enrollment token from the Tealfabric console (valid for 15 minutes). Prefer the full console snippet: it sets `NANITE_IMAGE_REF` (and usually `TF_NANITE_PLATFORM_URL`) for you. Platform URL otherwise defaults to `wss://tealfabric.io/api/v1/nanites/session`. With no image override, the script downloads the CDN `nightly-build` archive for this architecture (`amd64` or `arm64`).

```sh
# Minimal (uses CDN nightly-build when NANITE_IMAGE_REF is unset)
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
```

```sh
# Console snippet shape (recommended)
export TF_NANITE_PLATFORM_URL='wss://tealfabric.io/api/v1/nanites/session'
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
export NANITE_IMAGE_REF='registry.example/tealfabric-nanite:0.1.0'   # from Tealfabric
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
```

(`bash -` works the same if bash is installed; Alpine ships `sh`.)

What the script does, in order:

1. Selects Podman or Docker, or installs Podman with `apk` on Alpine.
2. Resolves the image, in order: `--image`, `TF_NANITE_IMAGE`, `NANITE_IMAGE_REF`, else `https://cdn.tealfabric.io/nanite/<channel>/tealfabric-nanite-linux-<arch>.tar` (`channel` default `nightly-build`).
3. For an `https://` image URL: downloads the archive, verifies `SHA256SUMS` when present, reads `image_tag` from sibling `release.json`, and loads the image. For a non-URL reference: `pull`.
4. Creates `/var/lib/tealfabric-nanite` mode `0700`.
5. Starts the container with `--restart=always`, mounts the state directory, and passes the platform URL and enrollment token for the first run.
6. Waits for `nanite_id` in the state directory and prints it.

After enrollment, the bearer secret is on disk. The enrollment token is not required again. Restart policy keeps the process reconnecting after a reboot.

The CDN must serve this repository's `install.sh` at `https://cdn.tealfabric.io/nanite/install.sh` (published by `tealfabric-nanite-ci` / `deploy-nanite.yml`). An older CDN copy that only accepts `--image` prints `NANITE_IMAGE_REF is unset` and ignores the env var — republish after merging, or pipe a local checkout: `sh ./install.sh`.

### Optional overrides

Set these before the `curl | sh -` line when needed:

```sh
export TF_NANITE_PLATFORM_URL='wss://tealfabric.io/api/v1/nanites/session'   # default already
export NANITE_IMAGE_REF='https://cdn.tealfabric.io/nanite/0.1.0/tealfabric-nanite-linux-amd64.tar'
export TF_NANITE_CHANNEL=nightly-build
export TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite
export TF_NANITE_CONTAINER_NAME=tealfabric-nanite
```

Or pass flags after `sh -s --`:

```sh
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -s -- \
  --image https://cdn.tealfabric.io/nanite/0.1.0/tealfabric-nanite-linux-amd64.tar
```

| Flag / env | Purpose |
|------------|---------|
| `--image` / `TF_NANITE_IMAGE` / `NANITE_IMAGE_REF` | CDN archive URL or OCI pull reference. Default: CDN `nightly-build` for this arch. |
| `--channel` / `TF_NANITE_CHANNEL` | CDN channel folder when no image is set (default `nightly-build`). |
| `--ca-file` | Corporate PEM mounted read-only as `TF_NANITE_CA_BUNDLE`. |
| `--state-dir` / `TF_NANITE_STATE_DIR` | Host path for identity and bearer (default `/var/lib/tealfabric-nanite`). |
| `--name` / `TF_NANITE_CONTAINER_NAME` | Container name (default `tealfabric-nanite`). |
| `TF_NANITE_PLATFORM_URL` | Control-channel URL (default `wss://tealfabric.io/api/v1/nanites/session`). |
| `TF_NANITE_CDN_BASE` | CDN prefix (default `https://cdn.tealfabric.io/nanite`). |

### 4. Confirm (Path A)

```sh
wget -qO- http://127.0.0.1:8787/health
cat /var/lib/tealfabric-nanite/nanite_id
```

In Tealfabric, open **Nanites**. The record should show **Connected**. `enrolled` and `connected` should be `true`, and `nanite_id` should match the console.

### Corporate TLS inspection (optional)

```sh
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -s -- --ca-file /path/to/corp.pem
```

The entrypoint appends that PEM to the public roots and sets `NODE_EXTRA_CA_CERTS`. The Nanite still checks the Tealfabric hostname. A release that ships an SPKI pin refuses to start when `TF_NANITE_CA_BUNDLE` is also set. See [Security](05_security.md).

### Dry run (optional)

```sh
TF_NANITE_INSTALL_DRY_RUN=1 curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
```

Prints the planned `pull`/`load` and `run` lines without calling the container runtime. From a local checkout: `TF_NANITE_INSTALL_DRY_RUN=1 ./install.sh`.

### Update a container install

Re-run the same `curl | sh -` flow (or pin `TF_NANITE_IMAGE` to a newer archive) and recreate the container with the **same** state directory. That host does not run `apk upgrade` for Nanite updates and does not reboot for Nanite updates.

---

## Path B — Alpine appliance (OpenRC package)

Use this when the disk should do little else and should self-upgrade with weekly `apk`. Layout and upgrade behavior: [Alpine appliance](08_alpine-appliance.md).

### 1. Install Alpine on the appliance disk

Install Alpine to persistent storage (not a ramdisk-only live system). Boot, become root, and configure networking the same way as Path A steps 1–2.

### 2. Add the Tealfabric Nanite apk repository

List Alpine mirrors and the signed repository that publishes `tealfabric-nanite` in `/etc/apk/repositories`. Exact lines are site-specific; use the repository URL and signing key from your Tealfabric operator or release notes.

```sh
# Example shape — replace with the published repo URL and key from your release notes
# echo 'https://cdn.tealfabric.io/apk/v3.22/main' >> /etc/apk/repositories
# wget -O /etc/apk/keys/tealfabric@….rsa.pub 'https://cdn.tealfabric.io/apk/…'
apk update
```

### 3. Install the package

```sh
apk add tealfabric-nanite
```

The package installs the app under `/usr/lib/tealfabric-nanite`, the official Node.js 26 musl build under `/usr/local` (it does **not** depend on Alpine's `nodejs` package), OpenRC unit `/etc/init.d/tealfabric-nanite`, and example config under `/etc/tealfabric-nanite`.

### 4. Configure platform URL

```sh
cp /etc/tealfabric-nanite/config.env.example /etc/tealfabric-nanite/config.env
```

Edit `/etc/tealfabric-nanite/config.env` so at least the platform URL is set (default host `tealfabric.io`):

```sh
TF_NANITE_PLATFORM_URL=wss://tealfabric.io/api/v1/nanites/session
TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite
TF_NANITE_LOCAL_HEALTH_PORT=8787
```

For a corporate intercepting CA, place the PEM at `/etc/tealfabric-nanite/extra-ca.pem` and set `TF_NANITE_CA_BUNDLE` in that file.

### 5. Enroll on first start

Export the one-time token for the first start only (OpenRC inherits the environment for that invocation, or set it in a one-shot wrapper your site uses). Then enable and start the service:

```sh
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
rc-update add tealfabric-nanite default
rc-service tealfabric-nanite start
rc-service tealfabric-nanite status
```

After a successful enroll, the bearer secret lives under `/var/lib/tealfabric-nanite`. Do not leave the enrollment token in `config.env`.

### 6. Confirm (Path B)

```sh
wget -qO- http://127.0.0.1:8787/health
cat /var/lib/tealfabric-nanite/nanite_id
rc-service tealfabric-nanite status
```

In Tealfabric, open **Nanites** and confirm **Connected**.

Weekly idle-gated `apk upgrade` (and optional reboot after a kernel update) is described in [Alpine appliance](08_alpine-appliance.md).

---

## Build the image yourself

```sh
docker build -t tealfabric-nanite:0.1.0 .
# Optional pin supplied at build. Do not commit the pin value.
docker build --build-arg NANITE_SPKI_SHA256="$NANITE_SPKI_SHA256" -t tealfabric-nanite:0.1.0 .
```

The image is based on `node:26-alpine`. It includes this app, the entrypoint, `wget`, and Alpine `ca-certificates`. Leave `NANITE_SPKI_SHA256` empty when the release has no pin.

Then point `install.sh` at your local tag:

```sh
export TF_NANITE_PLATFORM_URL='wss://tealfabric.io/api/v1/nanites/session'
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
./install.sh --image tealfabric-nanite:0.1.0
```

## Run without a container

Node.js 26 is required (see `.nvmrc`). Prefer Path A or B on Alpine for production.

```sh
npm ci
npm run build
export TF_NANITE_PLATFORM_URL='wss://tealfabric.io/api/v1/nanites/session'
export TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
mkdir -p "$TF_NANITE_STATE_DIR"
chmod 700 "$TF_NANITE_STATE_DIR"
node dist/main.js
```

For development without a build step:

```sh
node --import tsx src/main.ts
```

CDN publishes are built by the GitLab project `tealfabric-nanite-ci` and published with `tealfabric-infra` `deploy-nanite.yml`.
