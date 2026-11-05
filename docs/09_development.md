# Development

## Requirements

- Node.js 26 (see `.nvmrc`). Example: `nvm use`.
- npm (lockfile is `package-lock.json`).
- OpenSSL for the TLS peer unit test (`openssl req`).

## Setup

```sh
git clone <this-repo>
cd tealfabric-nanite
nvm use
npm ci
npm run build
npm test
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile `src/` to `dist/` with `tsc`. |
| `npm start` | `node dist/main.js`. |
| `npm test` | `node --import tsx --test test/**/*.test.ts`. |

During development you can run without a build:

```sh
export TF_NANITE_PLATFORM_URL='wss://…/api/v1/nanites/session'
export TF_NANITE_STATE_DIR=/tmp/nanite-state
export TF_NANITE_ENROLLMENT_TOKEN='…'
node --import tsx src/main.ts
```

## Tests

Coverage includes:

| Area | File |
|------|------|
| Allowlist, body cap, standby, logging redaction | `test/policy.test.ts` |
| Session machine: bearer, role, duplicate `call_id`, cancel | `test/session-machine.test.ts` |
| Redirect not followed, cancel abort, `file:` denied | `test/forward.test.ts` |
| Hostname and SPKI pin | `test/tls-peer.test.ts` |
| `already_enrolled`, pin+CA refuse, `revoke-local` | `test/launch.test.ts` |
| Entrypoint CA merge, upgrade idle gate, install dry run | `test/scripts.test.ts` |
| Contract copy equals platform plan | `test/contract-copy.test.ts` |

`test/contract-copy.test.ts` expects the platform repository at `../dev.tealfabric.io` with `docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md`. When that sibling is missing, that one test fails until the path is available.

## Image build

```sh
docker build -t tealfabric-nanite:dev .
docker build --build-arg NANITE_SPKI_SHA256="$NANITE_SPKI_SHA256" -t tealfabric-nanite:dev .
```

Do not commit pin material. `.gitignore` ignores `spki.sha256`.

## Contract changes

1. Edit the authoritative **Session contract** section in the platform plan.
2. Replace the copy in `docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md` with the same bytes from `**Contract revision: …**` through `End of session contract.`
3. Bump the revision string when the wire rules change.
4. Update `src/constants.ts` and frame handling to match.
5. Run `npm test`.

Do not put Redis, MySQL, worker, or console internals into the app plan or into this repository's operator docs.

## Design plan

[`PLANS/TEALFABRIC_NANITE_APP_PLAN.md`](PLANS/TEALFABRIC_NANITE_APP_PLAN.md) is the product and phase plan for this repository. Phases 1–4 cover enroll/heartbeat, HTTP forward, operations (`credential`, standby, `revoke-local`, `install.sh`), and hardening (pin, proxies, upgrade idle gate).
