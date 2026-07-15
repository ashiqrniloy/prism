import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyExecutionDecision,
  assertExecutionAllowed,
  checkExecution,
  ExecutionDeniedError,
  type ExecutionAction,
  type ExecutionPolicy,
} from "../execution-policy.js";

describe("execution policy", () => {
  const action: ExecutionAction = {
    kind: "shell",
    operation: "execute",
    command: "echo hi",
    paths: ["/tmp"],
    risk: "high",
  };

  it("allows when policy is undefined", async () => {
    const decision = await checkExecution(undefined, action);
    assert.equal(decision.allowed, true);
    const allowed = await assertExecutionAllowed(undefined, action);
    assert.deepEqual(allowed, action);
  });

  it("throws ExecutionDeniedError when denied", async () => {
    const policy: ExecutionPolicy = {
      check: () => ({ allowed: false, reason: "nope" }),
    };
    await assert.rejects(() => assertExecutionAllowed(policy, action), ExecutionDeniedError);
  });

  it("applies modified action fields", async () => {
    const policy: ExecutionPolicy = {
      check: () => ({
        allowed: true,
        modified: { command: "echo safe" },
      }),
    };
    const allowed = await assertExecutionAllowed(policy, action);
    assert.equal(allowed.command, "echo safe");
    assert.equal(allowed.kind, "shell");
  });

  it("applyExecutionDecision merges partial updates", () => {
    const merged = applyExecutionDecision(action, {
      allowed: true,
      modified: { command: "ls" },
    });
    assert.equal(merged.command, "ls");
    assert.equal(merged.paths?.[0], "/tmp");
  });
});
