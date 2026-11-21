import assert from "node:assert/strict";
import { test } from "node:test";
import { isOrphanStep, isSlowStep, SLOW_STEP_MS } from "./stepStuck.ts";
import { stepPhase } from "./toolLabels.ts";

test("a step in flight turns slow after a minute; a finished or waiting one never does", () => {
  const at = 1_000;
  assert.equal(isSlowStep({ status: "running", requestedMs: at }, at + SLOW_STEP_MS - 1), false);
  assert.equal(isSlowStep({ status: "running", requestedMs: at }, at + SLOW_STEP_MS), true);
  assert.equal(isSlowStep({ status: "done", requestedMs: at }, at + SLOW_STEP_MS * 5), false);
  assert.equal(isSlowStep({ status: "awaiting_approval", requestedMs: at }, at + SLOW_STEP_MS * 5), false);
});

test("an in-flight step of a chain that is over is an orphan, not a spinner", () => {
  assert.equal(isOrphanStep("running", false), true);
  assert.equal(isOrphanStep("requested", false), true);
  assert.equal(isOrphanStep("running", true), false);
  assert.equal(isOrphanStep("done", false), false);
});

test("a call waiting for the owner never uses the done wording", () => {
  assert.equal(stepPhase("awaiting_approval"), "running");
});
