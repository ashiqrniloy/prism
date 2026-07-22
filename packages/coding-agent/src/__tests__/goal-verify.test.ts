import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createMemoryCheckpointStore,
  createSecretRedactor,
  type JsonObject,
} from "@arnilo/prism";
import { createWorkflowCheckpoints } from "@arnilo/prism-workflows";
import {
  CODING_GOAL_VERIFY_SUSPEND_REASON,
  CodingGoalVerifyError,
  runCodingGoalVerify,
  type CodingCheckSummary,
  type CodingHandoffSummary,
} from "../index.js";

describe("runCodingGoalVerify", () => {
  it("fails_closed_without_approval_policy", async () => {
    await assert.rejects(
      () =>
        runCodingGoalVerify({
          goal: "x",
          cwd: "/tmp",
          checks: ["test"],
          runCheck: async () => ({ name: "test", exitCode: 0, summary: "ok" }),
          buildHandoff: async () => ({
            base: "a".repeat(40),
            head: "b".repeat(40),
            changedPathCount: 0,
            checkCount: 1,
          }),
          // @ts-expect-error intentional missing approval
          approval: {},
          checkpoints: createWorkflowCheckpoints({ store: createMemoryCheckpointStore() }),
        }),
      (error: unknown) =>
        error instanceof CodingGoalVerifyError
        && /approval\.validateResume/.test(error.message),
    );
  });

  it("failing_check_suspends_approve_resumes_to_bounded_handoff", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prism-goal-verify-"));
    try {
      const redactor = createSecretRedactor([]);
      const checkpoints = createWorkflowCheckpoints({
        store: createMemoryCheckpointStore(),
        redactor,
      });
      const ownership = { tenantId: "t1", userId: "u1" };
      let checkCalls = 0;

      const runCheck = async (name: string): Promise<CodingCheckSummary> => {
        checkCalls += 1;
        return { name, exitCode: 1, summary: "failed once" };
      };

      const buildHandoff = async (input: {
        readonly checks: readonly CodingCheckSummary[];
      }): Promise<CodingHandoffSummary> => ({
        base: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        changedPathCount: 1,
        checkCount: input.checks.length,
      });

      const validateResume = async (input: {
        readonly value: unknown;
        readonly suspension: { readonly reason: string };
      }) => {
        if (input.suspension.reason !== CODING_GOAL_VERIFY_SUSPEND_REASON) {
          throw new Error("unexpected suspension");
        }
        const value = input.value as { reviewer?: string } | undefined;
        if (!value || typeof value.reviewer !== "string" || value.reviewer.length < 1) {
          throw new Error("reviewer required");
        }
      };

      const suspended = await runCodingGoalVerify({
        goal: "Fix flaky auth",
        cwd,
        taskId: "auth-fix",
        checks: ["test"],
        runCheck,
        buildHandoff,
        approval: { validateResume },
        checkpoints,
        ownership,
        redactor,
      });

      assert.equal(suspended.status, "suspended");
      assert.equal(suspended.suspension?.reason, CODING_GOAL_VERIFY_SUSPEND_REASON);
      assert.equal(checkCalls, 1);

      const stateJson = JSON.stringify(suspended.state ?? {});
      assert.equal(stateJson.includes("password"), false);
      assert.equal(stateJson.includes("secret"), false);

      const completed = await runCodingGoalVerify({
        goal: "Fix flaky auth",
        cwd,
        taskId: "auth-fix",
        checks: ["test"],
        runCheck,
        buildHandoff,
        approval: { validateResume },
        checkpoints,
        ownership,
        redactor,
        resume: {
          runId: suspended.runId,
          decision: "approve",
          expectedVersion: suspended.version,
          input: { reviewer: "alice" },
        },
      });

      assert.equal(completed.status, "succeeded");
      const handoffOut = completed.outputs.handoff as
        | { handoff?: CodingHandoffSummary; codingStatus?: string }
        | undefined;
      assert.equal(handoffOut?.codingStatus, "completed");
      assert.equal(handoffOut?.handoff?.changedPathCount, 1);
      assert.ok(
        Buffer.byteLength(JSON.stringify(handoffOut?.handoff ?? {}), "utf8") < 64 * 1024,
      );

      const coding = (completed.state as JsonObject).coding as JsonObject | undefined;
      assert.ok(coding);
      assert.equal(JSON.stringify(coding).includes("password"), false);
      // Checks run once before suspend; resume continues from review (no re-run).
      assert.equal(checkCalls, 1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("passing_checks_skip_suspend", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "prism-goal-verify-pass-"));
    try {
      const checkpoints = createWorkflowCheckpoints({
        store: createMemoryCheckpointStore(),
      });
      const completed = await runCodingGoalVerify({
        goal: "Ship green",
        cwd,
        checks: ["test"],
        runCheck: async (name) => ({ name, exitCode: 0, summary: "ok" }),
        buildHandoff: async ({ checks }) => ({
          base: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          changedPathCount: 0,
          checkCount: checks.length,
        }),
        approval: {
          validateResume: async () => {
            throw new Error("should not resume");
          },
        },
        checkpoints,
      });
      assert.equal(completed.status, "succeeded");
      assert.equal(completed.suspension, undefined);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
