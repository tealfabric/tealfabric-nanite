#!/bin/sh
# Container entrypoint. Trusts the public roots and appends TF_NANITE_CA_BUNDLE.
# A built-in SPKI pin and that bundle cannot both be set.
set -eu

NODE_BIN=${TF_NANITE_NODE:-node}
MAIN=${TF_NANITE_MAIN:-/opt/tealfabric-nanite/dist/main.js}
PIN_FILE=${TF_NANITE_PIN_FILE:-/etc/tealfabric-nanite/spki.sha256}
SYSTEM_CA=${TF_NANITE_SYSTEM_CA:-/etc/ssl/certs/ca-certificates.crt}

pin_set=0
if [ -s "$PIN_FILE" ]; then
  pin_set=1
fi

if [ -n "${TF_NANITE_CA_BUNDLE:-}" ] && [ "$pin_set" -eq 1 ]; then
  echo "TF_NANITE_CA_BUNDLE and the SPKI pin cannot both be set" >&2
  exit 1
fi

if [ -n "${TF_NANITE_CA_BUNDLE:-}" ]; then
  if [ ! -s "$SYSTEM_CA" ]; then
    echo "public CA bundle is missing at $SYSTEM_CA" >&2
    exit 1
  fi
  bundle=${TF_NANITE_COMBINED_CA:-/tmp/tealfabric-nanite-ca.pem}
  cat "$SYSTEM_CA" "$TF_NANITE_CA_BUNDLE" > "$bundle"
  export NODE_EXTRA_CA_CERTS="$bundle"
fi

exec "$NODE_BIN" "$MAIN" "$@"
