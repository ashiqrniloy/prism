import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryCheckpointStore,
  createSecretRedactor,
  type JsonObject,
} from "@arnilo/prism";
import {
  CODING_GOAL_VERIFY_SUSPEND_REASON,
  runCodingGoalVerify,
  type CodingCheckSummary,
  type CodingHandoffSummary,
} from "@arnilo/prism-coding-agent";
import { createWorkflowCheckpoints } from "@arnilo/prism-workflows";

/**
 * Network-free goal→verify composition.
 *
 * Plan Markdown + named checks + workflow suspend/approve + bounded handoff.
 * No Goal table, no second agent runtime, no network.
 */
export async function demo() {
  const cwd = await mkdtemp(join(tmpdir(), "prism-coding-goal-verify-"));
  try {
    const redactor = createSecretRedactor([]);
    const checkpoints = createWorkflowCheckpoints({
      store: createMemoryCheckpointStore(),
      redactor,
    });
    const ownership = { tenantId: "demo", userId: "coder-1" };

    const runCheck = async (name: string): Promise<CodingCheckSummary> => ({
      name,
      exitCode: 1,
      summary: "demo check failed (host would re-run after fix)",
    });

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
      signal: AbortSignal.timeout(30_000),
    });

    if (suspended.status !== "suspended") {
      throw new Error(`expected suspension, got ${suspended.status}`);
    }

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

    const handoff = completed.outputs.handoff as
      | { handoff?: CodingHandoffSummary; codingStatus?: string }
      | undefined;
    const stateText = JSON.stringify(completed.state ?? {});

    return {
      status: completed.status,
      suspendedAt: suspended.suspension?.reason,
      codingStatus: handoff?.codingStatus,
      changedPathCount: handoff?.handoff?.changedPathCount,
      noCredentialsInState: !stateText.includes("password") && !stateText.includes("secret"),
      codingKeys: Object.keys(((completed.state as JsonObject).coding ?? {}) as object).sort(),
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
