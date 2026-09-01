#!/usr/bin/env node
/**
 * Plan 041 Task 3: tool-search scenario registration, report schema, network-free
 * posture, and frozen caps from scripts/budgets.json#toolSearch. Mirrors the
 * multi-agent scenario gate (scripts/benchmark-multi-agent.test.mjs).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./benchmark.mjs";
import { loadBudgets } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "benchmark.mjs");
const budgets = loadBudgets().toolSearch;

describe("tool-search benchmark scenario (plan 041)", () => {
  it("is registered, unprotected, and network-free by construction", () => {
    const scenario = SCENARIOS["tool-search"];
    assert.ok(scenario, "tool-search missing from the parameterized runner");
    assert.equal(scenario.protected, false);
    assert.ok(existsScenarioModule(scenario.module));
  });

  it("runs through the parameterized runner within the frozen caps", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "tool-search"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.deepEqual(report.fixture, {
      toolCount: budgets.fixture.toolCount,
      topK: budgets.fixture.topK,
      searchToolsCount: budgets.fixture.toolCount + 1,
      minReduction: budgets.fixture.minReduction,
    });
    const blob = JSON.stringify(report);
    assert.doesNotMatch(blob, /sk-|postgresql:\/\/|api[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i);
    for (const check of report.checks ?? []) {
      assert.equal(check.pass, true, `scenario check failed: ${check.name}`);
    }
    const rows = Object.fromEntries(report.results.map((row) => [row.name, row]));
    const reduction = rows.tool_request_reduction?.value;
    assert.ok(
      typeof reduction === "number" && reduction >= budgets.toolRequestReductionFloor,
      `request-byte reduction ${reduction} below frozen floor ${budgets.toolRequestReductionFloor}`,
    );
    const indexScore = rows.index_score_ms?.value;
    assert.ok(
      typeof indexScore === "number" && indexScore <= budgets.indexScoreCeilingMs,
      `index+score ${indexScore}ms above frozen ceiling ${budgets.indexScoreCeilingMs}ms`,
    );
    const disclosed = rows.disclosed_tool_count_search?.value;
    assert.ok(
      disclosed <= budgets.disclosedToolCountCeiling,
      `disclosed ${disclosed} above frozen ceiling ${budgets.disclosedToolCountCeiling}`,
    );
    assert.ok(disclosed !== 0, "disclosed zero tools; fail closed forbids empty disclosure");
  });
});

function existsScenarioModule(relative) {
  return existsSync(join(here, relative));
}
