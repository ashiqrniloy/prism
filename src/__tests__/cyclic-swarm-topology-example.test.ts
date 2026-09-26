import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

// Event-Driven Swarm Topology example smoke test:
// Verifies topic subscriptions, swarm router node dynamic dispatching,
// per-agent state scoping via withNodeScope, and clean cyclic termination on idle drain.
test("cyclic_swarm_topology_example_runs_offline_with_topic_routing_and_scoped_state", () => {
  const result = spawnSync(process.execPath, ["examples/cyclic-swarm-topology.ts"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `cyclic-swarm-topology.ts exited ${result.status}\n${result.stderr}`);

  const lines = result.stdout.trim().split("\n");
  const jsonLine = lines.find((line) => line.startsWith('{"status"'));
  assert.ok(jsonLine, "Expected JSON output line from example");

  const payload = JSON.parse(jsonLine) as {
    status: string;
    incidentId: string;
    triageCategory: string;
    findingsCount: number;
    verified: boolean;
    totalWaves: number;
    finalState: Record<string, unknown>;
  };

  // 1. Workflow completes successfully on mock provider
  assert.equal(payload.status, "succeeded");

  // 2. Incident triaged and research completed
  assert.equal(payload.incidentId, "INC-8802");
  assert.equal(payload.triageCategory, "security_vulnerability");
  assert.equal(payload.findingsCount, 2);

  // 3. Verifier agent confirmed fix and concluded
  assert.equal(payload.verified, true);

  // 4. Executed multi-wave supersteps
  assert.ok(payload.totalWaves >= 5);

  // 5. Scoped state isolated across namespaces
  assert.ok(payload.finalState.triage);
  assert.ok(payload.finalState.researcher);
  assert.ok(payload.finalState.verifier);
});
