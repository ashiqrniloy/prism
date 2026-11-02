import { test } from "bun:test";
import assert from "node:assert/strict";
import { summarizeRole } from "./observational-role.mjs";

test("observational_role_summary_keeps_promotion_and_use_separate", () => {
  const row = (arm, taskSuccess, promoted, verified, used) => ({
    arm,
    status: "completed",
    taskSuccess,
    rightTimeRecall: 1,
    promotion: { promoted, notesPerSession: promoted / 24, verifiedShare: verified / promoted, usedShare: used / promoted },
    workerUsage: { observer: { calls: 2, inputTokens: 100 }, reflector: { calls: 0, inputTokens: 0 } },
  });
  const result = summarizeRole([
    row("fabric", 0.4, 0, 0, 0),
    row("fabric+promotion", 0.3, 3, 1, 1),
    row("om+fabric", 0.8, 0, 0, 0),
    row("om+fabric+promotion", 0.7, 3, 1, 1),
  ]);
  assert.equal(result.arms["fabric+promotion"].notesPerSession, 0.125);
  assert.ok(Math.abs(result.arms["fabric+promotion"].verifiedShare - 1 / 3) < 1e-6);
  assert.ok(Math.abs(result.arms["fabric+promotion"].usedShare - 1 / 3) < 1e-6);
  assert.equal(result.comparisons.fabricPromotionMinusOff, -0.1);
  assert.equal(result.comparisons.omFabricMinusFabric, 0.4);
});
