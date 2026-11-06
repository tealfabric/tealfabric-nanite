import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const SECRET_KEYS = new Set([
  "secret",
  "bearer_secret",
  "enrollment_token",
  "authorization",
  "proxy-authorization",
  "body",
  "body_base64"
]);

const SEVERITY = { info: 6, warn: 4, error: 3 } as const;
const LOGGER_PRIORITY = { info: "local0.info", warn: "local0.warning", error: "local0.err" } as const;
/** syslog facility local0 */
const FACILITY = 16;

export type LogLevel = "info" | "warn" | "error";

type LogTargets = { stdout: boolean; syslog: boolean };

let targets: LogTargets = { stdout: true, syslog: true };
let syslogSocketPath = "/dev/log";
let syslogDisabled = false;
const ident = "tealfabric-nanite";

/**
 * TF_NANITE_LOG: comma list of `stdout` and/or `syslog` (default both).
 * TF_NANITE_SYSLOG_SOCKET: unix path for syslog (default `/dev/log`).
 *
 * Prefer the `logger` CLI (BusyBox/util-linux). If that is missing, write an
 * RFC3164 line to the unix socket path (stream connect; works with many syslogds).
 */
export function configureLog(env: NodeJS.ProcessEnv = process.env): void {
  const raw = (env.TF_NANITE_LOG ?? "stdout,syslog").trim().toLowerCase();
  if (raw === "" || raw === "both") {
    targets = { stdout: true, syslog: true };
  } else {
    const parts = new Set(raw.split(/[,\s]+/).filter(Boolean));
    targets = {
      stdout: parts.has("stdout") || parts.has("console"),
      syslog: parts.has("syslog")
    };
    if (!targets.stdout && !targets.syslog) {
      targets = { stdout: true, syslog: true };
    }
  }
  syslogSocketPath = (env.TF_NANITE_SYSLOG_SOCKET ?? "/dev/log").trim() || "/dev/log";
  syslogDisabled = false;
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = { time: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  const line = JSON.stringify(safe);
  if (targets.stdout) {
    if (level === "error") console.error(line);
    else console.log(line);
  }
  if (targets.syslog) writeSyslog(level, line);
}

function writeSyslog(level: LogLevel, message: string): void {
  if (syslogDisabled) return;
  if (writeSyslogViaLogger(level, message)) return;
  writeSyslogViaUnixSocket(level, message);
}

function writeSyslogViaLogger(level: LogLevel, message: string): boolean {
  try {
    const child = spawn(
      "logger",
      ["-t", ident, "-p", LOGGER_PRIORITY[level], "--", message],
      { stdio: "ignore", detached: true }
    );
    child.unref();
    child.on("error", () => {
      // Fall through to unix socket on next lines if logger is absent.
    });
    return true;
  } catch {
    return false;
  }
}

function writeSyslogViaUnixSocket(level: LogLevel, message: string): void {
  const pri = FACILITY * 8 + SEVERITY[level];
  const packet = `<${pri}>${ident}[${process.pid}]: ${message}\n`;
  try {
    const socket = createConnection({ path: syslogSocketPath });
    socket.unref();
    socket.on("error", () => {
      syslogDisabled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    });
    socket.end(packet, () => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    });
  } catch {
    syslogDisabled = true;
  }
}

/** Test hook: reset syslog failure latch. */
export function resetLogForTests(): void {
  configureLog({ TF_NANITE_LOG: "stdout" });
  syslogDisabled = false;
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
