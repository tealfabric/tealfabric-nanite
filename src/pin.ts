import { existsSync, readFileSync } from "node:fs";

const DEFAULT_PIN_FILE = "/etc/tealfabric-nanite/spki.sha256";

export function readSpkiPin(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env.TF_NANITE_SPKI_SHA256 ?? "").trim();
  if (fromEnv) return fromEnv.toLowerCase();
  const file = (env.TF_NANITE_PIN_FILE ?? DEFAULT_PIN_FILE).trim();
  if (!file || !existsSync(file)) return null;
  const value = readFileSync(file, "utf8").trim().toLowerCase();
  return value || null;
}
