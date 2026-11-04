import { CLOCK_SKEW_MS } from "./constants.js";

export function clockSkewed(sentAt: string, nowMs: number): boolean {
  const sent = Date.parse(sentAt);
  if (!Number.isFinite(sent)) return true;
  return Math.abs(nowMs - sent) > CLOCK_SKEW_MS;
}
