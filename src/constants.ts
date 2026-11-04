/** Session contract revision 2026-11-04.1. The platform plan is authoritative. */
export const CONTRACT_REVISION = "2026-11-04.1";
export const PROTOCOL_VERSION = 1;
export const ENVELOPE_VERSION = 1;
export const BODY_MAX_BYTES = 536870912;
export const CLOCK_SKEW_MS = 60_000;
export const DEFAULT_HEARTBEAT_SECONDS = 30;
export const DEFAULT_MAX_IN_FLIGHT = 4;
export const RECONNECT_CAP_MS = 60_000;
export const DEFAULT_HEALTH_PORT = 8787;
export const WS_MAX_PAYLOAD = 720_000_000;

export const HOP_BY_HOP = [
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization"
] as const;

export const RESULT_ERROR_CODES = [
  "dns",
  "connect_failed",
  "tls",
  "timeout",
  "allowlist_denied",
  "body_too_large",
  "expired",
  "busy",
  "unsupported_envelope",
  "allowlist_stale"
] as const;

export type ResultErrorCode = (typeof RESULT_ERROR_CODES)[number];
