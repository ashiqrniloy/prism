#!/usr/bin/env node
/**
 * Plan 045 Task 3: workflow-loop benchmark schema, frozen limits, and
 * network-free runtime invariants.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SCENARIOS } from "./benchmark.mjs";
import { LOOP_ITERATIONS, runWorkflowLoop } from "./benchmark-scenarios/workflow-loop.mjs";
import { loadBudgets } from "./budget-gates.mjs";

const runner = join(import.meta.dirname, "benchmark.mjs");
const budgets = loadBudgets().workflowLoop;

describe("workflow-loop benchmark scenario (plan 045)", () => {
  it("is registered, unprotected, and has a checked-in scenario module", () => {
    const scenario = SCENARIOS["workflow-loop"];
    assert.ok(scenario, "workflow-loop missing from the parameterized runner");
    assert.equal(scenario.protected, false);
    assert.equal(scenario.phase, 45);
    assert.ok(existsSync(join(import.meta.dirname, scenario.module)));
  });

  it("executes the frozen five-iteration mock-provider loop without leakage", async () => {
    const row = await runWorkflowLoop({ iterations: LOOP_ITERATIONS });
    assert.equal(row.status, "succeeded");
    assert.equal(row.iterations, budgets.fixture.iterations);
    assert.equal(row.providerCalls, budgets.fixture.iterations);
    assert.equal(row.finishedIterations, budgets.fixture.iterations);
    assert.equal(row.peakActiveProviderCalls, 1);
    assert.equal(row.activeAfter, 0);
  });

  it("reports the frozen budget and stays network-free", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "workflow-loop"], {
      env: { ...process.env, PRISM_BENCH_WARMUPS: "1", PRISM_BENCH_ITERATIONS: "2" },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.version, "0.3.2");
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.deepEqual(report.fixture, { ...budgets.fixture, warmups: 1, measuredOperations: 2 });
    assert.equal(report.ceilingsMs.workflowLoop, budgets.p95CeilingMs);
    assert.equal(report.ceilingsMs.perIteration, budgets.nodeExecutionP95CeilingMs);
    assert.deepEqual(
      report.results.map((row) => row.name),
      ["workflowLoop"],
    );
    const row = report.results[0];
    assert.ok(row.p95Ms <= budgets.p95CeilingMs, `p95 ${row.p95Ms}ms > ${budgets.p95CeilingMs}ms`);
    assert.ok(row.p95PerIterationMs <= budgets.nodeExecutionP95CeilingMs);
    assert.equal(row.iterations, budgets.fixture.iterations);
    assert.equal(row.providerCallsPerRun, budgets.fixture.iterations);
    assert.equal(row.finishedIterationsPerRun, budgets.fixture.iterations);
    assert.equal(row.peakActiveProviderCalls, 1);
    assert.equal(row.activeAfter, 0);
    assert.doesNotMatch(JSON.stringify(report), /sk-|postgresql:\/\/|api[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i);
  });
});
