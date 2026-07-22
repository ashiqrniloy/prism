#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "benchmark-0.0.12.mjs");
const required = [
  "scenario", "mode", "iterations", "throughputPerSecond", "p50Ms", "p95Ms",
  "memoryBytes", "peakQueueEvents", "eventBytes", "diskBytes", "processCount",
  "estimatedCostUsd", "backpressureSignals", "resourceLimitSignals",
];

describe("benchmark-0.0.12 schema", () => {
  it("rejects invalid iteration bounds", () => {
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, PRISM_BENCH_ITERATIONS: "9" }, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /PRISM_BENCH_ITERATIONS/);
  });

  it("emits bounded network-free protocol and compaction evidence", () => {
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "10" }, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.release, "0.0.12");
    assert.deepEqual(report.environment.network, false);
    assert.deepEqual(report.environment.credentials, false);
    assert.deepEqual(new Set(report.results.map((row) => row.scenario)), new Set([
      "ag-ui-mapper", "ag-ui-handler", "ag-ui-replay", "coding-compaction-preparation",
    ]));
    for (const row of report.results) {
      for (const field of required) assert.ok(field in row, `${row.scenario} missing ${field}`);
      assert.ok(row.peakQueueEvents >= 0 && row.eventBytes >= 0);
    }
  });
});
