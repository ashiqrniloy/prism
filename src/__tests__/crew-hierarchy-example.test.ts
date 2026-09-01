import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Hierarchical "Crew" workflow pattern smoke test:
// Verifies manager structured output, fan_out specialist dispatch, join aggregation,
// conditional validation/revision routing, attribution per role, and tool narrowing.
test("crew_hierarchy_example_runs_offline_with_manager_fanout_validation_and_narrowed_tools", () => {
  const result = spawnSync(process.execPath, ["examples/crew-hierarchy.ts"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `crew-hierarchy.ts exited ${result.status}\n${result.stderr}`);

  const payload = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
    status: string;
    planTaskCount: number;
    rolesExecuted: string[];
    deliverableStatus: "completed" | "revised";
    validationPassed: boolean;
    attributions: { role: string; agent: string }[];
    specialistBlockedReason: string;
    managerBlockedReason: string;
    revisionBranchTested: boolean;
  };

  // 1. Workflow completes successfully on mock provider
  assert.equal(payload.status, "succeeded");

  // 2. Manager emitted typed tasks via structured output
  assert.equal(payload.planTaskCount, 2);
  assert.deepEqual(payload.rolesExecuted, ["researcher", "writer"]);

  // 3. Specialist outputs attributed per role
  assert.equal(payload.deliverableStatus, "completed");
  assert.equal(payload.validationPassed, true);
  assert.equal(payload.attributions.length, 2);
  assert.deepEqual(payload.attributions, [
    { role: "researcher", agent: "researcher-specialist" },
    { role: "writer", agent: "writer-specialist" },
  ]);

  // 4. Narrowing: specialist attempting manager tool is fail-closed blocked
  assert.equal(payload.specialistBlockedReason, "unknown_tool");

  // 5. Narrowing: manager attempting specialist tool directly is fail-closed blocked
  assert.equal(payload.managerBlockedReason, "unknown_tool");

  // 6. Validation failure fixture routes to revision path
  assert.equal(payload.revisionBranchTested, true);
});
