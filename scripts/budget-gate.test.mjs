#!/usr/bin/env node
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAll,
  checkCeiling,
  checkThroughput,
  checkUpperBound,
  loadBudgets,
  measureRootPack,
  measureStartupMs,
} from "./budget-gates.mjs";

// Fast performance-budget gate (plan 079, Task 8). Runs in `npm test`: gates the
// deterministic root artifact size and a non-flaky startup ceiling against
// scripts/budgets.json. The six benchmark medians are gated by the release
// evidence runner scripts/benchmark-0.0.16.mjs (timing is machine-dependent).

const budgets = loadBudgets();

describe("performance budget gate", () => {
  it("budgets.json is well-formed", () => {
    for (const key of ["packedBytes", "unpackedBytes", "fileCount"]) {
      const entry = budgets.root[key];
      assert.ok(entry.baseline > 0, `root.${key}.baseline must be positive`);
      assert.ok(entry.tolerance > 0 && entry.tolerance < 1, `root.${key}.tolerance must be in (0,1)`);
    }
    assert.ok(budgets.startup.importMsCeiling > budgets.startup.importMsBaseline, "startup ceiling must exceed baseline");
    const scenarios = Object.entries(budgets.benchmarkMedians.scenarios);
    assert.equal(scenarios.length, 6, "expected six benchmark scenario baselines");
    for (const [name, median] of scenarios) {
      for (const field of ["throughputPerSecond", "p50Ms", "p95Ms"]) {
        assert.ok(Number.isFinite(median[field]) && median[field] > 0, `${name}.${field} must be a positive number`);
      }
    }
  });

  it("root tarball stays within the artifact diet budget", () => {
    const pack = measureRootPack();
    assertAll([
      checkUpperBound("root packedBytes", pack.packedBytes, budgets.root.packedBytes.baseline, budgets.root.packedBytes.tolerance),
      checkUpperBound("root unpackedBytes", pack.unpackedBytes, budgets.root.unpackedBytes.baseline, budgets.root.unpackedBytes.tolerance),
      checkUpperBound("root fileCount", pack.fileCount, budgets.root.fileCount.baseline, budgets.root.fileCount.tolerance),
    ]);
  });

  it("root import startup stays under the sanity ceiling", () => {
    const ms = measureStartupMs();
    assert.ok(Number.isFinite(ms), "startup measurement failed");
    assert.ok(checkCeiling("startup import", ms, budgets.startup.importMsCeiling).ok, `startup ${ms.toFixed(1)}ms exceeded ceiling`);
  });

  it("comparison helpers reject regressions (negative fixtures)", () => {
    assert.equal(checkUpperBound("x", 200, 100, 0.05).ok, false, "inflated pack size must fail");
    assert.equal(checkUpperBound("x", 104, 100, 0.05).ok, true, "within-tolerance pack size must pass");
    assert.equal(checkThroughput("x", 500, 1000, 0.25).ok, false, "halved throughput must fail");
    assert.equal(checkThroughput("x", 800, 1000, 0.25).ok, true, "within-tolerance throughput must pass");
    assert.equal(checkCeiling("x", 300, 250).ok, false, "above-ceiling startup must fail");
    assert.throws(() => assertAll([checkUpperBound("x", 200, 100, 0.05)]), /budget regression/);
  });
});
