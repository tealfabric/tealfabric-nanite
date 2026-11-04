const SECRET_KEYS = new Set([
  "secret",
  "bearer_secret",
  "enrollment_token",
  "authorization",
  "proxy-authorization",
  "body",
  "body_base64"
]);

export function logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = { time: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else console.log(line);
}

export function callLogFields(input: {
  callId: string;
  naniteId: string;
  tenantId: string;
  integrationId: string;
  url: string;
  status?: number;
  durationMs?: number;
  byteCount?: number;
  errorCode?: string | null;
}): Record<string, unknown> {
  let host = "";
  try {
    host = new URL(input.url).hostname;
  } catch {
    host = "";
  }
  return {
    call_id: input.callId,
    nanite_id: input.naniteId,
    tenant_id: input.tenantId,
    integration_id: input.integrationId,
    host,
    status: input.status ?? null,
    duration_ms: input.durationMs ?? null,
    byte_count: input.byteCount ?? null,
    error_code: input.errorCode ?? null
  };
}
