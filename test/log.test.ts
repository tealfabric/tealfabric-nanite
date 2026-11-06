import assert from "node:assert/strict";
import test from "node:test";
import { configureLog, logEvent, resetLogForTests } from "../src/log.js";

test("configureLog selects stdout only", () => {
  resetLogForTests();
  configureLog({ TF_NANITE_LOG: "stdout" });
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logEvent("info", "nanite.start", { version: "0.1.0" });
  } finally {
    console.log = original;
  }
  assert.match(lines[0] ?? "", /"event":"nanite.start"/);
  assert.match(lines[0] ?? "", /"version":"0.1.0"/);
});

test("logEvent omits secret field names", () => {
  resetLogForTests();
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logEvent("error", "nanite.config", {
      message: "failed",
      enrollment_token: "once",
      bearer_secret: "secret"
    });
  } finally {
    console.error = original;
  }
  assert.equal(lines.join("").includes("once"), false);
  assert.equal(lines.join("").includes("secret"), false);
  assert.match(lines[0] ?? "", /"message":"failed"/);
});
