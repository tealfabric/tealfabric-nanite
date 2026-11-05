#!/bin/sh
# Install Tealfabric Nanite from a CDN image archive (preferred) or an OCI pull ref.
#
# On a Nanite VM (no local checkout required):
#   export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
#   curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
#
# Optional overrides:
#   TF_NANITE_PLATFORM_URL  (default wss://tealfabric.io/api/v1/nanites/session)
#   NANITE_IMAGE_REF / TF_NANITE_IMAGE / --image
#     (default CDN nightly-build archive for this arch)
#   TF_NANITE_CHANNEL / --channel  (default nightly-build)
#   curl … | sh -s -- --image REGISTRY/tealfabric-nanite:TAG
#   [--ca-file PEM] [--state-dir DIR] [--name NAME]
set -eu

CDN_BASE=${TF_NANITE_CDN_BASE:-https://cdn.tealfabric.io/nanite}
# Prefer --image; else TF_NANITE_IMAGE; else platform snippet NANITE_IMAGE_REF.
IMAGE=${TF_NANITE_IMAGE:-${NANITE_IMAGE_REF:-}}
CA_FILE=""
STATE_DIR=${TF_NANITE_STATE_DIR:-/var/lib/tealfabric-nanite}
CONTAINER_NAME=${TF_NANITE_CONTAINER_NAME:-tealfabric-nanite}
RUN_TAG=${TF_NANITE_IMAGE_TAG:-}
CHANNEL=${TF_NANITE_CHANNEL:-nightly-build}
TF_NANITE_PLATFORM_URL=${TF_NANITE_PLATFORM_URL:-wss://tealfabric.io/api/v1/nanites/session}
export TF_NANITE_PLATFORM_URL

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
    --channel)
      CHANNEL=${2:-}
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

default_archive_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' amd64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *)
      echo "unsupported architecture: $(uname -m); pass --image or set NANITE_IMAGE_REF" >&2
      exit 1
      ;;
  esac
}

if [ -z "$IMAGE" ]; then
  IMAGE="${CDN_BASE}/${CHANNEL}/tealfabric-nanite-linux-$(default_archive_arch).tar"
fi

if [ -z "${TF_NANITE_PLATFORM_URL:-}" ]; then
  echo "TF_NANITE_PLATFORM_URL is required" >&2
  exit 1
fi

# Podman (and Docker) live in Alpine *community*, not main.
# Fresh ISO installs often keep only /media/cdrom/apks for main. Adding community
# alone then fails with missing so:libglib… because deps must come from matching
# online *main* + *community* for the same vX.Y.
ensure_alpine_apk_repos() {
  repos=/etc/apk/repositories
  if [ ! -f "$repos" ]; then
    echo "Alpine apk repositories file missing: $repos" >&2
    exit 1
  fi
  if [ ! -f /etc/alpine-release ]; then
    echo "Alpine release file missing: /etc/alpine-release" >&2
    exit 1
  fi

  version=$(cut -d. -f1,2 /etc/alpine-release)
  mirror_base=${TF_NANITE_ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}
  main_url="${mirror_base}/v${version}/main"
  community_url="${mirror_base}/v${version}/community"

  tmp=$(mktemp)
  has_net_main=0
  has_net_community=0

  # Rewrite repos: comment install media; uncomment network main/community lines.
  while IFS= read -r line || [ -n "$line" ]; do
    trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//')
    case "$trimmed" in
      \#*)
        rest=$(printf '%s' "$trimmed" | sed 's/^#[[:space:]]*//')
        case "$rest" in
          http://*/main|http://*/main/*|https://*/main|https://*/main/*|ftp://*/main|ftp://*/main/*)
            printf '%s\n' "$rest" >> "$tmp"
            has_net_main=1
            ;;
          http://*/community|http://*/community/*|https://*/community|https://*/community/*|ftp://*/community|ftp://*/community/*)
            printf '%s\n' "$rest" >> "$tmp"
            has_net_community=1
            ;;
          *)
            printf '%s\n' "$line" >> "$tmp"
            ;;
        esac
        ;;
      */media/*|*cdrom*)
        printf '%s\n' "#${trimmed}" >> "$tmp"
        ;;
      http://*/main|http://*/main/*|https://*/main|https://*/main/*|ftp://*/main|ftp://*/main/*)
        printf '%s\n' "$trimmed" >> "$tmp"
        has_net_main=1
        ;;
      http://*/community|http://*/community/*|https://*/community|https://*/community/*|ftp://*/community|ftp://*/community/*)
        printf '%s\n' "$trimmed" >> "$tmp"
        has_net_community=1
        ;;
      *)
        printf '%s\n' "$line" >> "$tmp"
        ;;
    esac
  done < "$repos"

  if [ "$has_net_main" -eq 0 ]; then
    printf '%s\n' "$main_url" >> "$tmp"
    echo "Enabled Alpine main repository: $main_url"
  fi
  if [ "$has_net_community" -eq 0 ]; then
    printf '%s\n' "$community_url" >> "$tmp"
    echo "Enabled Alpine community repository: $community_url"
  fi

  cat "$tmp" > "$repos"
  rm -f "$tmp"

  apk update
}

install_alpine_podman() {
  ensure_alpine_apk_repos
  apk add --no-cache podman
  # Rootful podman needs cgroups on Alpine.
  if command -v rc-update >/dev/null 2>&1; then
    rc-update add cgroups default 2>/dev/null || rc-update add cgroups boot 2>/dev/null || true
    rc-service cgroups start 2>/dev/null || true
  fi
}

runtime=""
if command -v podman >/dev/null 2>&1; then
  runtime=podman
elif command -v docker >/dev/null 2>&1; then
  runtime=docker
elif [ -f /etc/alpine-release ]; then
  install_alpine_podman
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

is_http=0
case "$IMAGE" in
  http://*|https://*) is_http=1 ;;
esac

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

download() {
  url=$1
  dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "curl or wget is required to download ${url}" >&2
    exit 1
  fi
}

load_archive() {
  archive_url=$1
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  archive_file="$tmp/nanite.tar"
  echo "Downloading ${archive_url}"
  download "$archive_url" "$archive_file"

  sums_url=$(printf '%s' "$archive_url" | sed 's|/[^/]*$|/SHA256SUMS|')
  if download "$sums_url" "$tmp/SHA256SUMS" 2>/dev/null; then
    (
      cd "$tmp"
      # SHA256SUMS names the published archive; rename to match before checking.
      published=$(awk '/tealfabric-nanite-linux-.*\.tar/{print $2; exit}' SHA256SUMS)
      if [ -n "$published" ]; then
        mv "$archive_file" "$tmp/$published"
        archive_file="$tmp/$published"
        sha256sum -c SHA256SUMS
      fi
    )
  else
    echo "SHA256SUMS not found next to the archive; continuing without checksum verify" >&2
  fi

  if [ -z "$RUN_TAG" ]; then
    meta_url=$(printf '%s' "$archive_url" | sed 's|/[^/]*$|/release.json|')
    if download "$meta_url" "$tmp/release.json" 2>/dev/null; then
      RUN_TAG=$(sed -n 's/.*"image_tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp/release.json" | head -n 1)
    fi
  fi
  if [ -z "$RUN_TAG" ]; then
    RUN_TAG=tealfabric-nanite:latest
  fi

  echo "Loading image archive into ${runtime}"
  "$runtime" load -i "$archive_file"
}

if [ "${TF_NANITE_INSTALL_DRY_RUN:-}" = "1" ]; then
  if [ "$is_http" -eq 1 ]; then
    printf '%s\n' "download $IMAGE && $runtime load && $runtime $args \${image_tag}"
  else
    printf '%s\n' "$runtime pull $IMAGE"
    printf '%s\n' "$runtime $args $IMAGE"
  fi
  exit 0
fi

if [ "$is_http" -eq 1 ]; then
  load_archive "$IMAGE"
  # shellcheck disable=SC2086
  "$runtime" $args "$RUN_TAG"
else
  "$runtime" pull "$IMAGE"
  # shellcheck disable=SC2086
  "$runtime" $args "$IMAGE"
fi

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
