import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "bun:test";

interface Leg {
  readonly name: string;
  readonly status: "passed" | "skipped";
  readonly reason?: string;
}

/**
 * The Phase 13 Done record's conformance criterion. `examples/external-agent.ts --conformance` runs
 * `driverConformance` on its own driver, once per reference dialect. Every leg passes; the only skip is the
 * `json-rpc` fail-closed leg, because a client-request dialect has no relay to break.
 */
it("external_agent_example_passes_driver_conformance_on_both_dialects", () => {
  const result = spawnSync(process.execPath, ["examples/external-agent.ts", "--conformance"], {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 180_000,
  });
  assert.equal(result.status, 0, `conformance run exited ${result.status}\n${result.stderr}`);
  const report = JSON.parse(result.stdout) as Record<string, Leg[]>;
  assert.deepEqual(Object.keys(report).sort(), ["json-rpc", "jsonl-stream"]);
  const expectedSkips: Record<string, string[]> = { "jsonl-stream": [], "json-rpc": ["fail_closed"] };
  for (const [dialect, legs] of Object.entries(report)) {
    assert.deepEqual(
      legs.filter((leg) => leg.status === "skipped").map((leg) => leg.name),
      expectedSkips[dialect],
      `${dialect} skipped legs`,
    );
    assert.ok(
      legs.some((leg) => leg.name === "credential_canary" && leg.status === "passed"),
      `${dialect} ran the canary`,
    );
  }
}, 180_000);
