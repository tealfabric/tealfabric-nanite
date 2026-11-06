import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllowlistEntries } from "./allowlist.js";
import type { AllowlistDocument, AllowlistEntry } from "./types.js";

export type StoredState = {
  tenantId: string | null;
  naniteId: string | null;
  bearer: string | null;
  consumedEnrollmentSha256: string | null;
  allowlist: AllowlistDocument;
};

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readTrim(path: string): string | null {
  if (!existsSync(path)) return null;
  const value = readFileSync(path, "utf8").trim();
  return value || null;
}

export class StateStore {
  constructor(readonly dir: string) {}

  ensure(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
  }

  load(): StoredState {
    this.ensure();
    let allowlist: AllowlistDocument = { generation: 0, entries: [] };
    const raw = readTrim(this.file("allowlist.json"));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { generation?: unknown; entries?: unknown };
        const entries = parseAllowlistEntries(parsed.entries) ?? [];
        const generation = Number(parsed.generation);
        allowlist = { generation: Number.isInteger(generation) ? generation : 0, entries };
      } catch {
        allowlist = { generation: 0, entries: [] };
      }
    }
    return {
      tenantId: readTrim(this.file("tenant_id")),
      naniteId: readTrim(this.file("nanite_id")),
      bearer: readTrim(this.file("bearer")),
      consumedEnrollmentSha256: readTrim(this.file("enrollment_token.sha256")),
      allowlist
    };
  }

  saveIdentity(naniteId: string, tenantId: string): void {
    this.write("nanite_id", naniteId);
    this.write("tenant_id", tenantId);
  }

  saveBearer(secret: string): void {
    this.write("bearer", secret);
  }

  saveConsumedEnrollment(tokenSha256: string): void {
    this.write("enrollment_token.sha256", tokenSha256);
  }

  saveAllowlist(generation: number, entries: AllowlistEntry[]): void {
    this.write("allowlist.json", JSON.stringify({ generation, entries }));
  }

  upgradeDeferred(): boolean {
    return existsSync(this.file("upgrade.deferred"));
  }

  wipe(): void {
    this.ensure();
    for (const name of ["tenant_id", "nanite_id", "bearer", "enrollment_token.sha256", "allowlist.json", "upgrade.deferred"]) {
      rmSync(this.file(name), { force: true });
    }
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  private write(name: string, contents: string): void {
    this.ensure();
    const finalPath = this.file(name);
    const tmp = `${finalPath}.tmp`;
    writeFileSync(tmp, contents, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, finalPath);
    chmodSync(finalPath, 0o600);
  }
}
