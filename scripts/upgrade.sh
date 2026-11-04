#!/bin/sh
# Weekly Alpine appliance upgrade.
# Cron runs this with --tick every minute. upgrade.schedule decides the weekly minute.
# While a call is in flight the job defers and retries, default every five minutes.
# It does not run apk on a host that is not the Alpine appliance.
set -eu

STATE_DIR=${TF_NANITE_STATE_DIR:-/var/lib/tealfabric-nanite}
ETC_DIR=${TF_NANITE_ETC:-/etc/tealfabric-nanite}
RETRY_MINUTES=${TF_NANITE_UPGRADE_RETRY:-5}
HEALTH_PORT=${TF_NANITE_LOCAL_HEALTH_PORT:-8787}
LOCK_DIR=${TF_NANITE_LOCK_DIR:-$STATE_DIR/upgrade.lock}
MODE=${1:-}

field_match() {
  if [ "$1" = "*" ] || [ "$1" = "$2" ]; then
    return 0
  fi
  return 1
}

clock_part() {
  date "+$1" | sed 's/^0//'
}

schedule_due() {
  schedule_file=$ETC_DIR/upgrade.schedule
  if [ ! -s "$schedule_file" ]; then
    return 1
  fi
  # shellcheck disable=SC2046
  set -- $(head -n 1 "$schedule_file")
  field_match "$1" "$(clock_part %M)" || return 1
  field_match "$2" "$(clock_part %H)" || return 1
  field_match "$3" "$(clock_part %d)" || return 1
  field_match "$4" "$(clock_part %m)" || return 1
  field_match "$5" "$(clock_part %w)" || return 1
  return 0
}

retry_due() {
  [ -f "$STATE_DIR/upgrade.deferred" ] || return 1
  minute=$(clock_part %M)
  [ $((minute % RETRY_MINUTES)) -eq 0 ]
}

if [ "$MODE" != "--run" ] && [ "$MODE" != "--retry" ]; then
  if ! schedule_due && ! retry_due; then
    exit 0
  fi
fi

mkdir -p "$(dirname "$LOCK_DIR")" "$STATE_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

read_health() {
  if [ -n "${TF_NANITE_HEALTH_FILE:-}" ]; then
    cat "$TF_NANITE_HEALTH_FILE"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "http://127.0.0.1:${HEALTH_PORT}/health" && return
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${HEALTH_PORT}/health" && return
  fi
  if command -v podman >/dev/null 2>&1; then
    podman exec tealfabric-nanite wget -qO- "http://127.0.0.1:${HEALTH_PORT}/health" && return
  fi
  echo "{}"
}

in_flight_of() {
  printf '%s' "$1" | sed -n 's/.*"in_flight"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

health=$(read_health || true)
in_flight=$(in_flight_of "$health")
if [ -z "$in_flight" ] || [ "$in_flight" -gt 0 ]; then
  touch "$STATE_DIR/upgrade.deferred"
  exit 0
fi

rm -f "$STATE_DIR/upgrade.deferred"

apk_log=$(mktemp)
if [ -n "${TF_NANITE_APK_CMD:-}" ]; then
  sh -c "$TF_NANITE_APK_CMD" > "$apk_log" 2>&1
elif [ -f /etc/alpine-release ]; then
  apk update && apk upgrade > "$apk_log" 2>&1
else
  echo "upgrade job runs on the Alpine appliance" >&2
  rm -f "$apk_log"
  exit 0
fi

health=$(read_health || true)
in_flight=$(in_flight_of "$health")
if [ "${in_flight:-1}" -gt 0 ]; then
  touch "$STATE_DIR/upgrade.deferred"
  rm -f "$apk_log"
  exit 0
fi

if grep -E -q 'tealfabric-nanite|node-v26' "$apk_log"; then
  health=$(read_health || true)
  in_flight=$(in_flight_of "$health")
  if [ "${in_flight:-1}" -eq 0 ]; then
    if [ -n "${TF_NANITE_RESTART_CMD:-}" ]; then
      sh -c "$TF_NANITE_RESTART_CMD"
    elif command -v rc-service >/dev/null 2>&1; then
      rc-service tealfabric-nanite restart
    fi
  else
    touch "$STATE_DIR/upgrade.deferred"
  fi
fi

health=$(read_health || true)
in_flight=$(in_flight_of "$health")
if [ "${in_flight:-1}" -eq 0 ] && grep -E -q '^linux-| linux-' "$apk_log"; then
  if [ -n "${TF_NANITE_REBOOT_CMD:-}" ]; then
    sh -c "$TF_NANITE_REBOOT_CMD"
  else
    reboot
  fi
fi

rm -f "$apk_log"
exit 0
