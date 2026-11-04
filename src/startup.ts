export type StartupPlan =
  | { action: "refuse"; reason: "already_enrolled" }
  | { action: "enroll" }
  | { action: "resume" }
  | { action: "missing_credentials" };

export function startupPlan(
  state: { tenantId: string | null; bearer: string | null },
  enrollmentToken: string | null
): StartupPlan {
  if (state.bearer) return { action: "resume" };
  if (state.tenantId && enrollmentToken) return { action: "refuse", reason: "already_enrolled" };
  if (state.tenantId) return { action: "missing_credentials" };
  if (enrollmentToken) return { action: "enroll" };
  return { action: "missing_credentials" };
}

export function caPinConflict(caBundle: string | null | undefined, pin: string | null | undefined): boolean {
  return Boolean(caBundle && caBundle.trim() && pin && pin.trim());
}
