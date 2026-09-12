#!/usr/bin/env node
/**
 * Plan 070 Task 9: redaction scenario registration, report schema, network-free posture,
 * byte-identical output, and frozen caps from scripts/budgets.json#redaction. Mirrors the
 * tool-search gate (scripts/benchmark-tool-search.test.mjs).
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
const budgets = loadBudgets().redaction;

describe("redaction benchmark scenario (plan 070)", () => {
  it("is registered, unprotected, and network-free by construction", () => {
    const scenario = SCENARIOS.redaction;
    assert.ok(scenario, "redaction missing from the parameterized runner");
    assert.equal(scenario.protected, false);
    assert.ok(existsSync(join(here, scenario.module)), `module ${scenario.module} exists`);
  });

  it("runs through the parameterized runner within the frozen caps", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "redaction"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.equal(report.fixture.needleCount, budgets.fixture.needleCount);
    assert.equal(report.fixture.smallEntryStrings, budgets.fixture.smallEntryStrings);
    assert.ok(report.fixture.transcriptBytes >= 1024 * 1024, `transcript fixture ${report.fixture.transcriptBytes} bytes`);
    // The report itself must never carry a needle (or anything needle-shaped).
    assert.doesNotMatch(JSON.stringify(report), /sk-live-|api[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i);
    const checks = report.checks ?? [];
    assert.ok(
      checks.some((check) => check.name === "ordered_loop_identical"),
      "byte-equality check is present",
    );
    assert.ok(
      checks.some((check) => check.name === "no_needle_survives"),
      "no-leak check is present",
    );
    for (const check of checks) assert.equal(check.pass, true, `scenario check failed: ${check.name}`);
    const rows = Object.fromEntries(report.results.map((row) => [row.name, row]));
    const speedup = rows.redaction_speedup?.value;
    assert.ok(
      typeof speedup === "number" && speedup >= budgets.minSpeedup,
      `single-scan speedup ${speedup} below frozen floor ${budgets.minSpeedup}`,
    );
    const transcript = rows.redact_transcript_single_scan;
    assert.ok(transcript.p95Ms <= budgets.transcriptP95CeilingMs, `transcript p95 ${transcript.p95Ms}ms above ceiling`);
    const small = rows.redact_small_entry;
    assert.ok(small.p95Ms <= budgets.smallP95CeilingMs, `small-entry p95 ${small.p95Ms}ms above ceiling`);
    assert.ok(small.p50Ms > 0, "small-entry timing was measured");
  });
});
