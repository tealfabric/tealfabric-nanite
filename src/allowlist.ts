import type { AllowlistEntry } from "./types.js";

export function parseAllowlistEntries(value: unknown): AllowlistEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: AllowlistEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const scheme = String(row.scheme ?? "").trim().toLowerCase();
    const host = String(row.host ?? "").trim().toLowerCase();
    const port = Number(row.port);
    if (scheme !== "http" && scheme !== "https") return null;
    if (!host || host.includes("/") || host.includes("@") || host.includes(" ") || host.includes("[")) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    entries.push({ scheme, host, port });
  }
  return entries;
}

export function urlMatchesAllowlist(url: string, entries: AllowlistEntry[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  const scheme = parsed.protocol === "https:" ? "https" : parsed.protocol === "http:" ? "http" : "";
  if (!scheme) return false;
  const host = parsed.hostname.trim().toLowerCase();
  const port = parsed.port ? Number(parsed.port) : scheme === "https" ? 443 : 80;
  return entries.some((entry) => entry.scheme === scheme && entry.host === host && entry.port === port);
}
