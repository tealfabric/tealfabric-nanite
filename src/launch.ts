import { DEFAULT_HEALTH_PORT } from "./constants.js";
import { startHealthServer } from "./health.js";
import type { HealthState } from "./health.js";
import { logEvent } from "./log.js";
import { readSpkiPin } from "./pin.js";
import { EnrollmentFailed, sayGoodbyeAndClose, startSession } from "./runtime.js";
import { StateStore } from "./state-store.js";
import { caPinConflict, startupPlan } from "./startup.js";
import { packageVersion } from "./version.js";

export async function launch(options: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  start?: typeof startSession;
}): Promise<number> {
  const env = options.env;
  const pin = readSpkiPin(env);
  if (caPinConflict(env.TF_NANITE_CA_BUNDLE, pin)) {
    logEvent("error", "nanite.config", { message: "TF_NANITE_CA_BUNDLE and the SPKI pin cannot both be set" });
    return 1;
  }
  const stateDir = (env.TF_NANITE_STATE_DIR ?? "").trim();
  if (!stateDir) {
    logEvent("error", "nanite.config", { message: "TF_NANITE_STATE_DIR is required" });
    return 1;
  }
  const store = new StateStore(stateDir);
  if (options.argv.includes("revoke-local")) {
    return revokeLocal(store, env);
  }
  const state = store.load();
  const token = (env.TF_NANITE_ENROLLMENT_TOKEN ?? "").trim() || null;
  const plan = startupPlan(state, token);
  if (plan.action === "refuse") {
    logEvent("error", "nanite.already_enrolled", { tenant_id: state.tenantId });
    return 1;
  }
  if (plan.action === "missing_credentials") {
    logEvent("error", "nanite.config", { message: "enrollment token or bearer secret is required" });
    return 1;
  }
  const platformUrl = (env.TF_NANITE_PLATFORM_URL ?? "").trim();
  if (!platformUrl) {
    logEvent("error", "nanite.config", { message: "TF_NANITE_PLATFORM_URL is required" });
    return 1;
  }
  const health: HealthState = {
    enrolled: Boolean(state.tenantId),
    tenantId: state.tenantId,
    connected: false,
    lastHeartbeat: null,
    inFlight: 0,
    upgradeDeferred: store.upgradeDeferred()
  };
  const port = Number(env.TF_NANITE_LOCAL_HEALTH_PORT ?? DEFAULT_HEALTH_PORT);
  const server = Number.isInteger(port) && port > 0 ? startHealthServer(port, () => ({
    ...health,
    upgradeDeferred: store.upgradeDeferred()
  })) : null;
  const stop = new AbortController();
  const onStop = () => stop.abort();
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
  try {
    const start = options.start ?? startSession;
    await start({
      platformUrl,
      state: store,
      mode: plan.action,
      secret: plan.action === "enroll" ? (token ?? "") : (state.bearer ?? ""),
      version: packageVersion(),
      env,
      health,
      signal: stop.signal
    });
    return 0;
  } catch (error) {
    if (error instanceof EnrollmentFailed) {
      logEvent("error", "nanite.enrollment_failed", { code: error.code });
      return 1;
    }
    logEvent("error", "nanite.fatal", { message: error instanceof Error ? error.message : "failed" });
    return 1;
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    server?.close();
  }
}

async function revokeLocal(store: StateStore, env: NodeJS.ProcessEnv): Promise<number> {
  const state = store.load();
  const platformUrl = (env.TF_NANITE_PLATFORM_URL ?? "").trim();
  if (platformUrl && state.bearer && state.naniteId) {
    try {
      await sayGoodbyeAndClose({
        platformUrl,
        naniteId: state.naniteId,
        bearer: state.bearer,
        version: packageVersion(),
        env
      });
    } catch (error) {
      logEvent("warn", "nanite.revoke_local", { message: error instanceof Error ? error.message : "goodbye failed" });
    }
  }
  store.wipe();
  logEvent("info", "nanite.revoke_local", { message: "state directory cleared" });
  return 0;
}
