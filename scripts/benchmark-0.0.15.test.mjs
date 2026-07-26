#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "benchmark-0.0.15.mjs");
const fields = [
  "scenario", "mode", "iterations", "throughputPerSecond", "p50Ms", "p95Ms",
  "memoryBytes", "peakQueueEvents", "eventBytes", "diskBytes", "processCount",
  "estimatedCostUsd", "backpressureSignals", "resourceLimitSignals",
];
const scenarios = [
  "openai-hosted-continuation",
  "openai-realtime-envelope",
  "ai-sdk-v4-stream-mapping",
  "provider-package-metadata",
  "rag-parse-replace-rerank-retrieve",
  "memory-retention-export-rebuild",
];

describe("benchmark-0.0.15 schema", () => {
  it("rejects invalid iteration bounds", () => {
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, PRISM_BENCH_ITERATIONS: "9" }, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /PRISM_BENCH_ITERATIONS/);
  });

  it("emits bounded network-free Phase 10 evidence", () => {
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "10" }, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.release, "0.0.15");
    assert.deepEqual(report.environment.network, false);
    assert.deepEqual(report.environment.credentials, false);
    assert.equal(report.frozenBudgets.packageInstallDelta, "0 packages, 0 runtime dependencies (43 manifests unchanged)");
    assert.deepEqual(report.results.map((row) => row.scenario), scenarios);
    for (const row of report.results) {
      for (const field of fields) assert.ok(field in row, `${row.scenario} missing ${field}`);
      assert.equal(row.resourceLimitSignals, 0, `${row.scenario} tripped a safety limit`);
      assert.equal(row.backpressureSignals, 0, `${row.scenario} reported backpressure`);
    }
  });
});
