#!/usr/bin/env node
/**
 * Parameterized benchmark runner tests (plan 015 Task 1).
 * Replaces the per-version benchmark schema test as the CI "benchmark schema
 * (network-free)" leg. Asserts the scenario registry is complete and coherent
 * with the 0.1.0 orchestrator, the runner fails loud on unknown and protected
 * scenarios (blocked-gate semantics, never a silent skip), and a network-free
 * scenario emits the legacy report shape with a tiny iteration count.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./benchmark.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "benchmark.mjs");

describe("benchmark.mjs scenario registry", () => {
  it("registry modules exist and cover the orchestrator legs", () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      assert.ok(existsSync(join(here, scenario.module)), `${name} module ${scenario.module} exists`);
    }
    const orchestrator = readFileSync(join(here, "benchmark-0.1.0.mjs"), "utf8");
    const legs = [...orchestrator.matchAll(/scenario: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(legs.length, 6, "orchestrator names six scenarios");
    for (const leg of legs) {
      assert.ok(SCENARIOS[leg], `orchestrator scenario ${leg} is registered`);
    }
    assert.deepEqual([...Object.keys(SCENARIOS)].sort(), [...legs].sort(), "registry and orchestrator agree");
  });

  it("--list prints every scenario and exits 0", () => {
    const run = spawnSync(process.execPath, [runner, "--list"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    for (const name of Object.keys(SCENARIOS)) {
      assert.ok(run.stdout.includes(name), `--list names ${name}`);
    }
  });

  it("unknown scenario fails loud", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "nope"], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unknown scenario/);
  });

  it("protected scenario without PRISM_TEST_POSTGRES_URL fails loud (blocked gate, not a skip)", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "phase6-postgres"], {
      env: { ...process.env, PRISM_TEST_POSTGRES_URL: "" },
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /PRISM_TEST_POSTGRES_URL/);
  });

  it("network-free scenario emits the legacy report shape with tiny iterations", () => {
    const run = spawnSync(process.execPath, [runner, "--scenario", "phase10-acp"], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "10", PRISM_BENCH_WARMUPS: "2" },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.environment.network, false);
    assert.ok(report.fixture && typeof report.fixture === "object", "fixture present");
    assert.ok(Array.isArray(report.results) && report.results.length >= 1, "results present");
    for (const row of report.results) {
      for (const field of ["name", "p50Ms", "p95Ms", "throughputPerSecond", "operations"]) {
        assert.ok(field in row, `missing ${field} in ${row.name}`);
      }
    }
  });
});
