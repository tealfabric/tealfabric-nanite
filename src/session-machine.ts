import { parseAllowlistEntries } from "./allowlist.js";
import { evaluateCall, type CallDecision } from "./call-policy.js";
import { PROTOCOL_VERSION, type ResultErrorCode } from "./constants.js";
import type { AllowlistEntry, PreparedRequest } from "./types.js";

export type Directive =
  | { op: "send"; frame: Record<string, unknown> }
  | { op: "dial"; callId: string; request: PreparedRequest; source: Record<string, unknown> }
  | { op: "abort"; callId: string }
  | { op: "store_bearer"; secret: string; reason: "enroll" | "renew" }
  | { op: "store_identity"; naniteId: string; tenantId: string }
  | { op: "store_allowlist"; generation: number; entries: AllowlistEntry[] }
  | { op: "set_role"; role: "active" | "standby" }
  | { op: "exit" }
  | { op: "reconnect"; code: string };

export class SessionMachine {
  role: "active" | "standby" = "standby";
  goodbye = false;
  inFlight = 0;
  maxInFlight = 4;
  heartbeatSeconds = 30;
  naniteId = "";
  tenantId = "";
  bearer: string | null = null;
  enrollmentToken: string | null = null;
  generation = 0;
  entries: AllowlistEntry[] = [];
  readonly seen = new Set<string>();
  constructor(readonly version: string, mode: "enroll" | "resume", secret: string, restored?: { naniteId: string; tenantId: string; generation: number; entries: AllowlistEntry[] }) {
    if (mode === "enroll") this.enrollmentToken = secret;
    else this.bearer = secret;
    if (restored) {
      this.naniteId = restored.naniteId;
      this.tenantId = restored.tenantId;
      this.generation = restored.generation;
      this.entries = restored.entries;
    }
  }

  buildHello(sentAt: string): Record<string, unknown> {
    const auth = this.bearer
      ? { method: "bearer", secret: this.bearer }
      : { method: "enrollment_token", secret: this.enrollmentToken ?? "" };
    return {
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      nanite_id: this.naniteId,
      sent_at: sentAt,
      nanite_version: this.version,
      auth
    };
  }

  onMessage(raw: string, nowMs: number): Directive[] {
    let frame: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      frame = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return [];
    }
    const type = String(frame.type ?? "");
    if (type === "hello_ok") return this.onHelloOk(frame);
    if (type === "hello_reject") return [{ op: "reconnect", code: String(frame.code ?? "") }];
    if (type === "heartbeat") return [];
    if (type === "allowlist") return this.onAllowlist(frame);
    if (type === "role") {
      const role = frame.role === "standby" ? "standby" : frame.role === "active" ? "active" : "";
      if (!role) return [];
      this.role = role;
      return [{ op: "set_role", role }];
    }
    if (type === "credential") return this.onCredential(frame);
    if (type === "cancel") {
      const callId = String(frame.call_id ?? "");
      return callId ? [{ op: "abort", callId }] : [];
    }
    if (type === "goodbye") {
      this.goodbye = true;
      return [{ op: "exit" }];
    }
    if (type === "call") return this.onCall(frame, nowMs);
    return [];
  }

  finishCall(callId: string): void {
    this.seen.add(callId);
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  resultFrame(source: Record<string, unknown>, response: Record<string, unknown>): Record<string, unknown> {
    return { ...source, type: "result", response };
  }

  rejectResponse(code: ResultErrorCode): Record<string, unknown> {
    return { status: 0, headers: [], body_base64: "", duration_ms: 0, error: { code } };
  }

  private onHelloOk(frame: Record<string, unknown>): Directive[] {
    const directives: Directive[] = [];
    const naniteId = String(frame.nanite_id ?? "");
    const tenantId = String(frame.tenant_id ?? "");
    if (naniteId && tenantId) {
      this.naniteId = naniteId;
      this.tenantId = tenantId;
      directives.push({ op: "store_identity", naniteId, tenantId });
    }
    const secret = frame.bearer_secret;
    if (typeof secret === "string" && secret) {
      this.bearer = secret;
      this.enrollmentToken = null;
      directives.push({ op: "store_bearer", secret, reason: "enroll" });
    }
    this.role = frame.role === "standby" ? "standby" : "active";
    directives.push({ op: "set_role", role: this.role });
    const heartbeat = Number(frame.heartbeat_interval_seconds);
    if (Number.isFinite(heartbeat) && heartbeat > 0) this.heartbeatSeconds = heartbeat;
    const maxInFlight = Number(frame.max_in_flight);
    if (Number.isInteger(maxInFlight) && maxInFlight >= 1 && maxInFlight <= 16) this.maxInFlight = maxInFlight;
    const allowlist = frame.allowlist && typeof frame.allowlist === "object" ? (frame.allowlist as Record<string, unknown>) : null;
    if (allowlist) directives.push(...this.cacheAllowlist(allowlist.generation, allowlist.entries));
    return directives;
  }

  private onAllowlist(frame: Record<string, unknown>): Directive[] {
    return this.cacheAllowlist(frame.generation, frame.entries);
  }

  private cacheAllowlist(generationValue: unknown, entriesValue: unknown): Directive[] {
    const entries = parseAllowlistEntries(entriesValue);
    const generation = Number(generationValue);
    if (!entries || !Number.isInteger(generation) || generation < 0) return [];
    this.generation = generation;
    this.entries = entries;
    return [
      { op: "store_allowlist", generation, entries },
      { op: "send", frame: { type: "allowlist_ack", generation } }
    ];
  }

  private onCredential(frame: Record<string, unknown>): Directive[] {
    const secret = String(frame.bearer_secret ?? "");
    if (!secret) return [];
    this.bearer = secret;
    this.enrollmentToken = null;
    return [
      { op: "store_bearer", secret, reason: "renew" },
      { op: "send", frame: { type: "credential_ack" } }
    ];
  }

  private onCall(frame: Record<string, unknown>, nowMs: number): Directive[] {
    const decision: CallDecision = evaluateCall({
      role: this.role,
      goodbye: this.goodbye,
      inFlight: this.inFlight,
      maxInFlight: this.maxInFlight,
      tenantId: this.tenantId,
      naniteId: this.naniteId,
      allowlistGeneration: this.generation,
      entries: this.entries,
      seenCallIds: this.seen,
      nowMs,
      frame
    });
    if (decision.kind === "ignore") return [];
    this.seen.add(decision.callId);
    if (decision.kind === "reject") {
      return [{ op: "send", frame: this.resultFrame(frame, this.rejectResponse(decision.code)) }];
    }
    this.inFlight += 1;
    return [{ op: "dial", callId: decision.callId, request: decision.request, source: frame }];
  }
}
