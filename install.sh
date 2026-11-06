#!/bin/sh
# Install Tealfabric Nanite from a CDN gzip image archive (.tar.gz) or an OCI pull ref.
#
# On a Nanite VM (no local checkout required):
#   export TF_NANITE_ENROLLMENT_TOKEN='paste-once'
#   curl -fsSL https://cdn.tealfabric.io/nanite/install.sh | sh -
#
# CDN archives are gzip-compressed docker/podman save streams:
#   https://cdn.tealfabric.io/nanite/<channel>/tealfabric-nanite-linux-<arch>.tar.gz
# install.sh downloads, verifies SHA256SUMS, gunzips, then podman/docker load.
#
# Optional overrides:
#   TF_NANITE_PLATFORM_URL  (default wss://tealfabric.io/api/v1/nanites/session)
#   NANITE_IMAGE_REF / TF_NANITE_IMAGE / --image
#     (default: latest semver from CDN latest/release.json)
#   TF_NANITE_CHANNEL / --channel  (optional pin: 0.1.0 | nightly-build | …)
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
# Empty channel → resolve the latest published release (CDN nanite/latest/).
CHANNEL=${TF_NANITE_CHANNEL:-}
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

# Resolve default image: pinned channel, else latest/release.json → release_key,
# else fall back to nightly-build (common before the first semver / latest pointer).
resolve_default_image() {
  arch=$(default_archive_arch)
  if [ -n "$CHANNEL" ]; then
    IMAGE="${CDN_BASE}/${CHANNEL}/tealfabric-nanite-linux-${arch}.tar.gz"
    return
  fi

  latest_meta="${CDN_BASE}/latest/release.json"
  latest_archive="${CDN_BASE}/latest/tealfabric-nanite-linux-${arch}.tar.gz"
  nightly_archive="${CDN_BASE}/nightly-build/tealfabric-nanite-linux-${arch}.tar.gz"

  if [ "${TF_NANITE_INSTALL_DRY_RUN:-}" = "1" ]; then
    IMAGE=$latest_archive
    return
  fi

  meta_tmp=$(mktemp)
  if download "$latest_meta" "$meta_tmp" 2>/dev/null; then
    release_key=$(sed -n 's/.*"release_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta_tmp" | head -n 1)
    archive_url=$(sed -n 's/.*"archive_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$meta_tmp" | head -n 1)
    rm -f "$meta_tmp"
    if [ -n "$release_key" ]; then
      IMAGE="${CDN_BASE}/${release_key}/tealfabric-nanite-linux-${arch}.tar.gz"
      echo "Using latest release ${release_key}"
      return
    fi
    if [ -n "$archive_url" ]; then
      IMAGE=$(printf '%s\n' "$archive_url" | sed "s|tealfabric-nanite-linux-[A-Za-z0-9_]*\.tar\(\.gz\)\{0,1\}|tealfabric-nanite-linux-${arch}.tar.gz|")
      echo "Using latest archive ${IMAGE}"
      return
    fi
  else
    rm -f "$meta_tmp"
  fi

  # HEAD-check latest archive; if missing, use nightly-build.
  if command -v curl >/dev/null 2>&1 && curl -fsSI "$latest_archive" >/dev/null 2>&1; then
    IMAGE=$latest_archive
    return
  fi
  if command -v wget >/dev/null 2>&1 && wget -q --spider "$latest_archive" 2>/dev/null; then
    IMAGE=$latest_archive
    return
  fi

  echo "CDN latest/ not published yet; falling back to nightly-build" >&2
  IMAGE=$nightly_archive
}

if [ -z "$IMAGE" ]; then
  resolve_default_image
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
  # iptables: netavark needs the iptables binary for the default bridge network.
  # Nanite itself uses --network=host (below); still install iptables for tooling.
  apk add --no-cache podman iptables ip6tables
  # cgroups are required for both rootful and rootless on Alpine.
  if command -v rc-update >/dev/null 2>&1; then
    rc-update add cgroups default 2>/dev/null || rc-update add cgroups boot 2>/dev/null || true
    rc-service cgroups start 2>/dev/null || true
  fi
  # apk's post-install warns about rootless (subuid/subgid). This installer runs
  # rootful Podman when uid 0; ignore that warning. Non-root needs subordinate ids.
  if [ "$(id -u)" -ne 0 ]; then
    user=$(id -un)
    if ! grep -q "^${user}:" /etc/subuid 2>/dev/null \
      || ! grep -q "^${user}:" /etc/subgid 2>/dev/null; then
      cat >&2 <<EOF
Podman was installed, but this process is not root and ${user} has no
/etc/subuid + /etc/subgid ranges (needed for rootless Podman).
Re-run as root (recommended), or configure subordinate ids then re-run:
  echo '${user}:100000:65536' >> /etc/subuid
  echo '${user}:100000:65536' >> /etc/subgid
EOF
      exit 1
    fi
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

# Alpine may already have podman from a prior attempt without iptables.
if [ -f /etc/alpine-release ] && [ "$runtime" = podman ] && ! command -v iptables >/dev/null 2>&1; then
  ensure_alpine_apk_repos
  apk add --no-cache iptables ip6tables
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

is_http=0
case "$IMAGE" in
  http://*|https://*) is_http=1 ;;
esac

# Host network: Nanite only dials outbound (and binds health on 127.0.0.1). Avoids
# netavark bridge/NAT, which fails on Alpine when iptables is missing.
args="run -d --name $CONTAINER_NAME --restart=always --network=host"
args="$args -v $STATE_DIR:/var/lib/tealfabric-nanite"
# Host syslog socket so JSON events reach local syslog (TF_NANITE_LOG includes syslog).
if [ -e /dev/log ]; then
  args="$args -v /dev/log:/dev/log"
fi
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

load_archive() {
  archive_url=$1
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  case "$archive_url" in
    *.tar.gz|*.tgz) archive_file="$tmp/nanite.tar.gz" ;;
    *.tar) archive_file="$tmp/nanite.tar" ;;
    *)
      echo "CDN image URL must end in .tar.gz (or legacy .tar): ${archive_url}" >&2
      exit 1
      ;;
  esac

  echo "Downloading ${archive_url}"
  download "$archive_url" "$archive_file"

  sums_url=$(printf '%s' "$archive_url" | sed 's|/[^/]*$|/SHA256SUMS|')
  if download "$sums_url" "$tmp/SHA256SUMS" 2>/dev/null; then
    # SHA256SUMS names the published archive; rename to match before checking.
    # Prefer .tar.gz; accept legacy plain .tar. Do not use a subshell for the rename.
    published=$(awk '/tealfabric-nanite-linux-.*\.tar\.gz/{print $2; exit}' "$tmp/SHA256SUMS")
    if [ -z "$published" ]; then
      published=$(awk '/tealfabric-nanite-linux-.*\.tar$/{print $2; exit}' "$tmp/SHA256SUMS")
    fi
    if [ -n "$published" ]; then
      mv "$archive_file" "$tmp/$published"
      archive_file="$tmp/$published"
      (cd "$tmp" && sha256sum -c SHA256SUMS)
    fi
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

  load_file=$archive_file
  case "$archive_file" in
    *.tar.gz|*.tgz)
      if ! command -v gzip >/dev/null 2>&1; then
        echo "gzip is required to decompress ${archive_file}" >&2
        exit 1
      fi
      load_file="$tmp/nanite.tar"
      echo "Decompressing gzip archive"
      gzip -dc "$archive_file" > "$load_file"
      ;;
  esac

  echo "Loading image archive into ${runtime}"
  "$runtime" load -i "$load_file"
  # Drop the download temp dir only after a successful load (EXIT trap would fire on
  # function return in ash and delete the archive mid-load if set earlier).
  trap - EXIT
  rm -rf "$tmp"
}

if [ "${TF_NANITE_INSTALL_DRY_RUN:-}" = "1" ]; then
  if [ "$is_http" -eq 1 ]; then
    printf '%s\n' "download $IMAGE && gunzip && $runtime load && $runtime $args \${image_tag}"
  else
    printf '%s\n' "$runtime pull $IMAGE"
    printf '%s\n' "$runtime $args $IMAGE"
  fi
  exit 0
fi

if [ "$is_http" -eq 1 ]; then
  load_archive "$IMAGE"
else
  "$runtime" pull "$IMAGE"
fi

# Replace a previous container of this name so a new enrollment token reaches the process.
# The state directory is a volume and is kept. Removal happens after the image is loaded.
"$runtime" rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

if [ "$is_http" -eq 1 ]; then
  # shellcheck disable=SC2086
  "$runtime" $args "$RUN_TAG"
else
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
