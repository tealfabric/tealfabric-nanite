import { RECONNECT_CAP_MS } from "./constants.js";

export function backoffMs(attempt: number, random = Math.random()): number {
  const bounded = Math.max(0, Math.floor(attempt));
  const exp = Math.min(RECONNECT_CAP_MS, 1000 * 2 ** Math.min(bounded, 6));
  const jittered = exp * 0.8 + exp * 0.2 * random;
  return Math.min(RECONNECT_CAP_MS, Math.max(200, Math.floor(jittered)));
}

export function helloRejectDisposition(mode: "enroll" | "resume"): "exit" | "retry" {
  return mode === "enroll" ? "exit" : "retry";
}
