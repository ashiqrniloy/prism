#!/usr/bin/env node
/**
 * Plan 074 Further Actions P1: the attention-compiler measurement scenario is registered,
 * network-free, bounded by frozen floors, and its numbers in
 * docs/_evidence/phase74-attention-measurements.md are the ones the scenario prints today.
 *
 * The evidence doc embeds the scenario's `{ fixture, results }` in a fenced json block; this
 * gate re-runs the scenario and compares, so a doc number can never drift from the code.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./benchmark.mjs";
import { loadBudgets } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "benchmark.mjs");
const evidence = join(here, "..", "docs", "_evidence", "phase74-attention-measurements.md");
const budgets = loadBudgets().attentionCompiler;

function runScenario() {
  const run = spawnSync(process.execPath, [runner, "--scenario", "attention-compiler"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function embeddedNumbers(markdown) {
  const block = markdown.match(/```json\n([\s\S]*?)```/);
  assert.ok(block, `${evidence} must embed the scenario output in a fenced json block`);
  const parsed = JSON.parse(block[1]);
  return { fixture: parsed.fixture, results: parsed.results };
}

describe("attention-compiler measurement scenario (plan 074 Further Actions P1)", () => {
  it("is registered, unprotected, and network-free by construction", () => {
    const scenario = SCENARIOS["attention-compiler"];
    assert.ok(scenario, "attention-compiler missing from the parameterized runner");
    assert.equal(scenario.protected, false);
    assert.ok(existsSync(join(here, scenario.module)));
  });

  it("passes every envelope check and matches the numbers recorded in the evidence doc", () => {
    const report = runScenario();
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.doesNotMatch(JSON.stringify(report), /sk-|postgresql:\/\/|api[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i);
    for (const check of report.checks ?? []) assert.equal(check.pass, true, `scenario check failed: ${check.name}`);

    const rows = Object.fromEntries(report.results.map((row) => [row.name, row.value]));
    assert.ok(rows.token_reduction >= budgets.tokenReductionFloor, `token_reduction ${rows.token_reduction} below floor`);
    assert.ok(rows.prefix_busts_on <= budgets.maxOnBusts, `prefix_busts_on ${rows.prefix_busts_on} above ceiling`);
    assert.equal(rows.prefix_busts_off, 0, "the compiler-off prefix is append-only");
    assert.ok(rows.resume_churn_avoided_bytes >= budgets.minChurnAvoidedBytes, "restored frontier must avoid re-stub churn");
    assert.ok(
      rows.volatile_block_resend_bytes >= budgets.minVolatileResendBytes,
      "a volatile prefix block must demonstrably re-send everything behind it",
    );

    assert.ok(existsSync(evidence), `${evidence} is missing`);
    const documented = embeddedNumbers(readFileSync(evidence, "utf8"));
    assert.deepEqual(documented.fixture, report.fixture, "evidence doc fixture drifted from the scenario");
    assert.deepEqual(documented.results, report.results, "evidence doc numbers drifted from the scenario");
  });
});
