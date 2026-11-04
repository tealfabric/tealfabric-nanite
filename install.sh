#!/bin/sh
# Install Tealfabric Nanite from the image named in the Tealfabric snippet.
# Usage: install.sh --image REGISTRY/tealfabric-nanite:TAG [--ca-file PEM] [--state-dir DIR]
set -eu

IMAGE=""
CA_FILE=""
STATE_DIR=${TF_NANITE_STATE_DIR:-/var/lib/tealfabric-nanite}
CONTAINER_NAME=${TF_NANITE_CONTAINER_NAME:-tealfabric-nanite}

while [ $# -gt 0 ]; do
  case "$1" in
    --image)
      IMAGE=${2:-}
      shift 2
      ;;
    --ca-file)
      CA_FILE=${2:-}
      shift 2
      ;;
    --state-dir)
      STATE_DIR=${2:-}
      shift 2
      ;;
    --name)
      CONTAINER_NAME=${2:-}
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$IMAGE" ]; then
  echo "NANITE_IMAGE_REF is unset. Pass --image with the registry reference from Tealfabric." >&2
  exit 1
fi
if [ -z "${TF_NANITE_PLATFORM_URL:-}" ]; then
  echo "TF_NANITE_PLATFORM_URL is required" >&2
  exit 1
fi

runtime=""
if command -v podman >/dev/null 2>&1; then
  runtime=podman
elif command -v docker >/dev/null 2>&1; then
  runtime=docker
elif [ -f /etc/alpine-release ]; then
  apk add --no-cache podman
  runtime=podman
else
  cat >&2 <<'EOF'
Docker or Podman is required.
Debian or Ubuntu: sudo apt-get update && sudo apt-get install -y docker.io
Fedora: sudo dnf install -y podman
macOS: brew install --cask docker
EOF
  exit 1
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

args="run -d --name $CONTAINER_NAME --restart=always"
args="$args -v $STATE_DIR:/var/lib/tealfabric-nanite"
args="$args -e TF_NANITE_PLATFORM_URL"
args="$args -e TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite"
if [ -n "${TF_NANITE_ENROLLMENT_TOKEN:-}" ]; then
  args="$args -e TF_NANITE_ENROLLMENT_TOKEN"
fi
if [ -n "${TF_NANITE_ENDPOINT_PROXY:-}" ]; then
  args="$args -e TF_NANITE_ENDPOINT_PROXY"
fi
if [ -n "${HTTPS_PROXY:-}" ]; then
  args="$args -e HTTPS_PROXY"
fi
if [ -n "${NO_PROXY:-}" ]; then
  args="$args -e NO_PROXY"
fi
if [ -n "$CA_FILE" ]; then
  args="$args -v $CA_FILE:/etc/tealfabric-nanite/extra-ca.pem:ro"
  args="$args -e TF_NANITE_CA_BUNDLE=/etc/tealfabric-nanite/extra-ca.pem"
fi

if [ "${TF_NANITE_INSTALL_DRY_RUN:-}" = "1" ]; then
  printf '%s\n' "$runtime pull $IMAGE"
  printf '%s\n' "$runtime $args $IMAGE"
  exit 0
fi

"$runtime" pull "$IMAGE"
# shellcheck disable=SC2086
"$runtime" $args "$IMAGE"

i=0
while [ "$i" -lt 90 ]; do
  if [ -s "$STATE_DIR/nanite_id" ]; then
    echo "nanite_id=$(cat "$STATE_DIR/nanite_id")"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "container started; nanite_id is not in $STATE_DIR yet" >&2
exit 0
