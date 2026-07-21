#!/usr/bin/env node
/**
 * Schema/bounds tests for scripts/benchmark-0.0.10.mjs.
 * Runs with a tiny iteration count and asserts required evidence fields.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "benchmark-0.0.10.mjs");

const REQUIRED = [
  "scenario",
  "mode",
  "iterations",
  "throughputPerSecond",
  "p50Ms",
  "p95Ms",
  "memoryBytes",
  "diskBytes",
  "processCount",
  "estimatedCostUsd",
  "backpressureSignals",
  "resourceLimitSignals",
];

describe("benchmark-0.0.10 schema", () => {
  it("rejects invalid iteration bounds", () => {
    const low = spawnSync(process.execPath, [script], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "5" },
      encoding: "utf8",
    });
    assert.notEqual(low.status, 0);
    assert.match(low.stderr + low.stdout, /PRISM_BENCH_ITERATIONS/);

    const high = spawnSync(process.execPath, [script], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "100001" },
      encoding: "utf8",
    });
    assert.notEqual(high.status, 0);
  });

  it("emits required fields for host and sandbox composition scenarios", () => {
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "10" },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.release, "0.0.10");
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.ok(Array.isArray(report.results));
    assert.ok(report.results.length >= 4);
    const names = new Set(report.results.map((r) => r.scenario));
    assert.ok(names.has("host-composition-write-read"));
    assert.ok(names.has("host-composition-list"));
    assert.ok(names.has("sandbox-composition-write-read"));
    assert.ok(names.has("sandbox-composition-list-search"));
    for (const row of report.results) {
      for (const field of REQUIRED) assert.ok(field in row, `missing ${field} in ${row.scenario}`);
      assert.equal(row.iterations, 10);
      assert.equal(row.estimatedCostUsd, 0);
      assert.ok(row.mode === "host" || row.mode === "sandbox-fake");
    }
  });
});
