# Tealfabric Nanite

Tealfabric Nanite is a Node.js 26 process a tenant runs beside a private HTTP endpoint. It dials Tealfabric, holds one control session, and forwards the prepared HTTP request in each envelope. It does not accept inbound connections.

The session rules are copied in [`docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md`](docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md). The authoritative copy is the platform plan in the Tealfabric repository. When the two differ, the platform text wins.

## Run

Node.js 26 is required.

```sh
export TF_NANITE_PLATFORM_URL='wss://example.tealfabric.io/api/v1/nanites/session'
export TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
node --import tsx src/main.ts
```

After `hello_ok`, the state directory holds `nanite_id`, `tenant_id`, and the bearer secret. Later starts use the bearer secret. A second enrollment token is refused with `already_enrolled` and does not open a session.

`node dist/main.js revoke-local` sends `goodbye` and clears that state directory.

`TF_NANITE_CA_BUNDLE` adds a corporate PEM to the public roots. A release may include an SPKI pin at image build (`NANITE_SPKI_SHA256`). Those two cannot be set together. The pin value is not stored in this repository.

`HTTPS_PROXY` applies to the control session. `TF_NANITE_ENDPOINT_PROXY` applies to endpoint calls. Leave the endpoint proxy unset when those calls stay on the LAN.

Local health listens on `127.0.0.1` and `TF_NANITE_LOCAL_HEALTH_PORT` (default `8787`):

```sh
wget -qO- http://127.0.0.1:8787/health
```

## Install

`install.sh` pulls the image from the Tealfabric snippet and starts it with Docker or Podman:

```sh
export TF_NANITE_PLATFORM_URL='wss://example.tealfabric.io/api/v1/nanites/session'
export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
./install.sh --image registry.example/tealfabric-nanite:0.1.0
```

`--ca-file corp.pem` mounts a corporate CA. On Alpine, a missing container runtime is installed with `apk add podman`. On any other distribution the script prints that distribution's install command and stops.

The image is `node:26-alpine` plus this program and the public CA bundle. Build it with:

```sh
docker build --build-arg NANITE_SPKI_SHA256="$NANITE_SPKI_SHA256" -t tealfabric-nanite:0.1.0 .
```

Leave the build arg empty when the release has no pin.

## Alpine appliance

`packaging/alpine` is the OpenRC package. It installs the official Node.js 26 musl build under `/usr/local` and does not depend on Alpine's `nodejs` package. Configuration stays in `/etc/tealfabric-nanite`. The bearer secret stays in `/var/lib/tealfabric-nanite`.

`/etc/tealfabric-nanite/upgrade.schedule` defaults to `0 3 * * 0` (Sunday 03:00, host local time). Cron calls `upgrade.sh --tick` every minute, and that file decides when the weekly run starts. Editing the schedule does not restart Node. The job runs `apk update && apk upgrade` only when health reports `in_flight` 0. A busy process defers the run and retries every five minutes. It does not force a restart or a reboot.

A container on another distribution updates by pulling a newer image tag. That install does not upgrade or reboot the host.

## Tests

```sh
npm test
```
