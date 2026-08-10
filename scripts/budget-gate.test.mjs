#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
// evidence runner scripts/benchmark.mjs (timing is machine-dependent).

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
    const phase7 = budgets.phase7Postgres;
    assert.deepEqual(phase7.fixture, {
      tenants: 10,
      principalsPerTenant: 10,
      eventsPerOwner: 1000,
      producers: 16,
      subscribers: 16,
      warmups: 100,
      measuredOperations: 1000,
      sustainedStreamEvents: 10000,
      cleanupBatch: 100,
      reconnectSamples: 20,
    });
    for (const [name, ceiling] of Object.entries(phase7.p95CeilingsMs)) {
      assert.ok(Number.isFinite(ceiling) && ceiling >= 50 && ceiling <= 2000, `${name} must use an approved Phase 7 ceiling`);
    }
    const enterprise = budgets.enterprisePostgres;
    assert.deepEqual(enterprise.fixture, {
      tenants: 10,
      principalsPerTenant: 10,
      recordsPerOwner: 1000,
      policyRows: 100000,
      evaluationRows: 100000,
      routerKeys: 10000,
      clients: 16,
      warmups: 100,
      measuredOperations: 1000,
      cleanupBatch: 100,
    });
    const enterpriseScenarios = Object.entries(enterprise.p95CeilingsMs);
    assert.equal(enterpriseScenarios.length, 10, "expected ten protected enterprise PostgreSQL ceilings");
    for (const [name, ceiling] of enterpriseScenarios) {
      assert.ok(Number.isFinite(ceiling) && ceiling >= 50 && ceiling <= 100, `${name} must use the approved 50ms/100ms ceiling`);
    }
  });

  it("checks the recorded protected Phase 7 PostgreSQL evidence", () => {
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.24.json", "utf8"));
    assert.equal(evidence.version, "0.0.24");
    assert.deepEqual(evidence.fixture, budgets.phase7Postgres.fixture);
    for (const [name, ceiling] of Object.entries(budgets.phase7Postgres.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing Phase 7 result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 exceeded its frozen ceiling`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
    assert.deepEqual(evidence.plans.map((plan) => plan.name).sort(), [
      "effect-expiry-cleanup",
      "effect-key-lookup",
      "event-replay",
      "event-retention-cleanup",
      "event-sequence-allocation",
    ]);
    assert.ok(evidence.plans.every((plan) => plan.sequentialScan === false && plan.indexes.length > 0));
    assert.equal(evidence.sustainedStream.events, 10000);
    assert.equal(evidence.sustainedStream.subscribers, 16);
    assert.equal(evidence.sustainedStream.deliveries, 160000);
    assert.ok(evidence.sustainedStream.throughputPerSecond > 0);
    for (const table of ["prism_agent_events", "prism_tool_effects"]) {
      assert.equal(
        evidence.storageBeforeCleanup[table].rows - evidence.storageAfterCleanup[table].rows,
        evidence.fixture.cleanupBatch,
        `${table} cleanup did not remove one full batch`,
      );
    }
  });

  it("checks the recorded Phase 8 durable-loop / HITL / A2UI evidence", () => {
    const phase8 = budgets.phase8LoopsHitl;
    assert.deepEqual(phase8.fixture, {
      warmups: 20,
      measuredOperations: 100,
      pendingDecisions: 32,
      snapshotBytes: 250000,
      a2uiOpsPerMessage: 64,
    });
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.25.json", "utf8"));
    assert.equal(evidence.version, "0.0.25");
    assert.deepEqual(evidence.fixture, phase8.fixture);
    assert.deepEqual(evidence.ceilingsMs, phase8.p95CeilingsMs);
    for (const [name, ceiling] of Object.entries(phase8.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing Phase 8 result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 ${result.p95Ms} exceeded ceiling ${ceiling}`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
  });

  it("checks the recorded Phase 9 coding-intelligence / process / forge / egress evidence", () => {
    const phase9 = budgets.phase9;
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.26.json", "utf8"));
    assert.equal(evidence.version, "0.0.26");
    assert.deepEqual(evidence.fixture, phase9.fixture);
    assert.deepEqual(evidence.ceilingsMs, phase9.p95CeilingsMs);
    for (const [name, ceiling] of Object.entries(phase9.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing Phase 9 result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 ${result.p95Ms} exceeded ceiling ${ceiling}`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
    const enumeration = evidence.results.find((entry) => entry.name === "enumerationList");
    assert.equal(enumeration.gitInvocationsPerList, 1, "enumeration must use ≤ 2 git invocations");
    const forge = evidence.results.find((entry) => entry.name === "forgePagination");
    assert.equal(forge.pages, 100, "forge pagination must cover 100 pages");
    const proxy = evidence.results.find((entry) => entry.name === "proxyDownload");
    assert.ok(proxy.residentDeltaBytes <= 2 * 64 * 1024 ** 2, "proxy resident buffering must stay ≤ 2× maxBytes");
  });

  it("checks the recorded Phase 10 ACP evidence", () => {
    const phase10 = budgets.phase10;
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.27.json", "utf8"));
    assert.equal(evidence.version, "0.0.27");
    assert.deepEqual(evidence.fixture, phase10.fixture);
    assert.deepEqual(evidence.ceilingsMs, phase10.p95CeilingsMs);
    for (const [name, ceiling] of Object.entries(phase10.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing Phase 10 result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 ${result.p95Ms} exceeded ceiling ${ceiling}`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
  });

  it("checks the recorded Phase 11 enterprise adapter evidence", () => {
    const phase11 = budgets.phase11;
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.28.json", "utf8"));
    assert.equal(evidence.version, "0.0.28");
    assert.deepEqual(evidence.fixture, phase11.fixture);
    assert.deepEqual(evidence.ceilingsMs, phase11.p95CeilingsMs);
    for (const [name, ceiling] of Object.entries(phase11.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing Phase 11 result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 ${result.p95Ms} exceeded ceiling ${ceiling}`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
  });

  it("checks the recorded protected enterprise PostgreSQL evidence", () => {
    const evidence = JSON.parse(readFileSync("scripts/benchmark-0.0.23.json", "utf8"));
    assert.equal(evidence.version, "0.0.23");
    assert.deepEqual(evidence.fixture, budgets.enterprisePostgres.fixture);
    for (const [name, ceiling] of Object.entries(budgets.enterprisePostgres.p95CeilingsMs)) {
      const result = evidence.results.find((entry) => entry.name === name);
      assert.ok(result, `missing protected result for ${name}`);
      assert.ok(result.p95Ms <= ceiling, `${name} p95 exceeded its frozen ceiling`);
      assert.ok(result.throughputPerSecond > 0, `${name} throughput missing`);
    }
    assert.deepEqual(evidence.assertions, { acceptedRateContention: 1000, budgetTokenSum: 16000, circuitProbeCount: 1000 });
    assert.equal(evidence.plans.length, 14, "all frozen indexed query shapes need recorded plans");
    assert.ok(evidence.plans.every((plan) => plan.sequentialScan === false && plan.indexes.length > 0));
    assert.equal(
      evidence.storageBeforeCleanup.prism_model_router_rates.rows - evidence.storageAfterCleanup.prism_model_router_rates.rows,
      (evidence.fixture.warmups + evidence.fixture.measuredOperations) * evidence.fixture.cleanupBatch,
      "cleanup evidence must remove every warmup and measured capped batch",
    );
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
