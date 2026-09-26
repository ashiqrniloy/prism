import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

// Cyclic Reflection + Dynamic Routing example smoke test:
// Verifies worker iterative drafting, reviewer agent structured state evaluation,
// routeNode dynamic branch selection, and fail-closed budget breach limit.
test("cyclic_reflection_example_runs_offline_with_reflection_routing_and_budget_breach", () => {
  const result = spawnSync(process.execPath, ["examples/cyclic-reflection.ts"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `cyclic-reflection.ts exited ${result.status}\n${result.stderr}`);

  const lines = result.stdout.trim().split("\n");
  const jsonLine = lines.find((line) => line.startsWith('{"status"'));
  assert.ok(jsonLine, "Expected JSON output line from example");

  const payload = JSON.parse(jsonLine) as {
    status: string;
    rounds: number;
    finalScore: number;
    finalDeliverable: {
      title: string;
      finalDraft: string;
      qualityScore: number;
      totalRounds: number;
      approved: boolean;
      publishedAt: string;
    };
    budgetBreachObserved: boolean;
    breachErrorCode: string;
    wavesExecuted: number;
  };

  // 1. Workflow completes successfully on mock provider
  assert.equal(payload.status, "succeeded");

  // 2. Iterative reflection refined until approved score reached
  assert.equal(payload.rounds, 3);
  assert.ok(payload.finalScore >= 90);
  assert.equal(payload.finalDeliverable.approved, true);

  // 3. Superstep budget breach path demonstrated fail-closed
  assert.equal(payload.budgetBreachObserved, true);
  assert.equal(payload.breachErrorCode, "ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT");

  // 4. Multiple waves executed across cycles
  assert.ok(payload.wavesExecuted >= 10);
});
