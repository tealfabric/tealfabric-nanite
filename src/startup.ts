import { sha256Hex } from "./state-store.js";

export type StartupPlan = { action: "enroll" } | { action: "resume" } | { action: "missing_credentials" };

export function startupPlan(
  state: { bearer: string | null; consumedEnrollmentSha256: string | null },
  enrollmentToken: string | null
): StartupPlan {
  const token = enrollmentToken?.trim() || null;
  if (token) {
    const alreadyUsed = state.consumedEnrollmentSha256 === sha256Hex(token);
    if (!alreadyUsed) return { action: "enroll" };
    if (state.bearer) return { action: "resume" };
    return { action: "missing_credentials" };
  }
  if (state.bearer) return { action: "resume" };
  return { action: "missing_credentials" };
}

export function caPinConflict(caBundle: string | null | undefined, pin: string | null | undefined): boolean {
  return Boolean(caBundle && caBundle.trim() && pin && pin.trim());
}
