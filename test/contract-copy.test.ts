import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("this copy's contract revision text equals the platform plan", () => {
  const app = readFileSync(join(import.meta.dirname, "../docs/PLANS/TEALFABRIC_NANITE_APP_PLAN.md"), "utf8");
  const platform = readFileSync(join(import.meta.dirname, "../../dev.tealfabric.io/docs/PLANS/TEALFABRIC_NANITE_PLATFORM_PLAN.md"), "utf8");
  const start = "**Contract revision: 2026-11-04.1**";
  const end = "End of session contract.";
  const appSlice = app.slice(app.indexOf(start), app.indexOf(end) + end.length);
  const platformSlice = platform.slice(platform.indexOf(start), platform.indexOf(end) + end.length);
  assert.equal(appSlice, platformSlice);
  assert.ok(appSlice.includes("2026-11-04.1"));
});
