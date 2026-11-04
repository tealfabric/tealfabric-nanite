import { urlMatchesAllowlist } from "./allowlist.js";
import { decodedBase64ByteLength, exceedsBodyCap } from "./body.js";
import { BODY_MAX_BYTES, ENVELOPE_VERSION, type ResultErrorCode } from "./constants.js";
import { stripHopByHop } from "./headers.js";
import type { AllowlistEntry, Header, PreparedRequest } from "./types.js";

export type CallInput = {
  role: "active" | "standby";
  goodbye: boolean;
  inFlight: number;
  maxInFlight: number;
  tenantId: string;
  naniteId: string;
  allowlistGeneration: number;
  entries: AllowlistEntry[];
  seenCallIds: ReadonlySet<string>;
  nowMs: number;
  maxBytes?: number;
  frame: Record<string, unknown>;
};

export type CallDecision =
  | { kind: "ignore" }
  | { kind: "reject"; code: ResultErrorCode; callId: string; fields: Record<string, unknown> }
  | { kind: "dial"; callId: string; request: PreparedRequest; fields: Record<string, unknown> };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function headersOf(value: unknown): Header[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return { name: String(row.name ?? ""), value: String(row.value ?? "") };
  });
}

export function evaluateCall(input: CallInput): CallDecision {
  if (input.goodbye || input.role !== "active") return { kind: "ignore" };
  const frame = input.frame;
  const callId = String(frame.call_id ?? "");
  const request = asRecord(frame.request);
  const url = String(request.url ?? "");
  const fields = {
    call_id: callId,
    nanite_id: input.naniteId,
    tenant_id: input.tenantId,
    integration_id: String(frame.integration_id ?? ""),
    url
  };
  if (!callId) return { kind: "reject", code: "unsupported_envelope", callId, fields };
  const version = Number(frame.envelope_version);
  if (version !== ENVELOPE_VERSION) return { kind: "reject", code: "unsupported_envelope", callId, fields };
  if (String(frame.tenant_id ?? "") !== input.tenantId || String(frame.nanite_id ?? "") !== input.naniteId) {
    return { kind: "reject", code: "unsupported_envelope", callId, fields };
  }
  if (input.seenCallIds.has(callId)) return { kind: "ignore" };
  const expires = Date.parse(String(frame.expires_at ?? ""));
  if (!Number.isFinite(expires) || expires <= input.nowMs) {
    return { kind: "reject", code: "expired", callId, fields };
  }
  if (Number(frame.allowlist_generation) !== input.allowlistGeneration) {
    return { kind: "reject", code: "allowlist_stale", callId, fields };
  }
  const bodyBase64 = String(request.body_base64 ?? "");
  const maxBytes = input.maxBytes ?? BODY_MAX_BYTES;
  if (exceedsBodyCap(decodedBase64ByteLength(bodyBase64), maxBytes)) {
    return { kind: "reject", code: "body_too_large", callId, fields };
  }
  if (!urlMatchesAllowlist(url, input.entries)) {
    return { kind: "reject", code: "allowlist_denied", callId, fields };
  }
  if (input.inFlight >= input.maxInFlight) {
    return { kind: "reject", code: "busy", callId, fields };
  }
  let body = Buffer.alloc(0);
  if (bodyBase64) {
    body = Buffer.from(bodyBase64, "base64");
    if (body.length > maxBytes) return { kind: "reject", code: "body_too_large", callId, fields };
  }
  return {
    kind: "dial",
    callId,
    fields,
    request: {
      method: String(request.method ?? "GET").toUpperCase(),
      url,
      headers: stripHopByHop(headersOf(request.headers)),
      body
    }
  };
}
