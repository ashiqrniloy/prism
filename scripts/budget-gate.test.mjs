#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertAll,
  checkCeiling,
  checkExportBudget,
  checkThroughput,
  checkUpperBound,
  evaluateNonNullBudget,
  isMachineLoaded,
  LOADED_LOADAVG_PER_CPU,
  loadBudgets,
  loadNonNullPolicy,
  loadPerCpu,
  measureExportCounts,
  measureNonNullAssertions,
  measureProcessStartupMs,
  measureRootPack,
  measureStartupMs,
  selectStartupRatioCeiling,
} from "./budget-gates.mjs";
import { packedFilePaths } from "./release-gates.mjs";

// Fast performance-budget gate (plan 079, Task 8). Runs in `npm test`: gates the
// deterministic root artifact size and a non-flaky startup bound against
// scripts/budgets.json. The six benchmark medians are gated by the release
// evidence runner scripts/benchmark.mjs (timing is machine-dependent).
//
// Plan 071 Task 3 (plan 070 FA 4): the startup bound is a *ratio* — import wall
// time over an empty-process start measured on the same machine in the same run —
// because external CPU load inflates both numbers together (measured: ratio
// 3.45-4.05 while a full `npm test` ran concurrently and up to 7.2 with 40
// competing processes, against 3.3 idle, while the absolute import went 60ms ->
// 258ms). The absolute ceiling in budgets.json is the tight bound off load and the
// evidence-of-record bound (scripts/benchmark.mjs) either way.

const budgets = loadBudgets();

describe("performance budget gate", () => {
  it("budgets.json is well-formed", () => {
    for (const key of ["packedBytes", "unpackedBytes", "fileCount"]) {
      const entry = budgets.root[key];
      assert.ok(entry.baseline > 0, `root.${key}.baseline must be positive`);
      assert.ok(entry.tolerance > 0 && entry.tolerance < 1, `root.${key}.tolerance must be in (0,1)`);
    }
    assert.ok(budgets.startup.importMsCeiling > budgets.startup.importMsBaseline, "startup ceiling must exceed baseline");
    assert.ok(
      budgets.startup.importRatioCeiling > budgets.startup.importRatioBaseline && budgets.startup.importRatioBaseline > 0,
      "startup ratio ceiling must exceed the ratio baseline",
    );
    assert.ok(
      budgets.startup.importRatioCeilingUnderLoad >= budgets.startup.importRatioCeiling,
      "the loaded ratio ceiling must not be tighter than the idle one",
    );
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

  it("per-package export counts stay at the plan 058 post-cut ceiling", () => {
    const entries = Object.entries(budgets.exportCounts).filter(([key]) => key !== "$comment");
    assert.ok(entries.length >= 10, "every publishable package needs an export ceiling");
    for (const [name, entry] of entries) {
      assert.ok(Number.isInteger(entry.baseline) && entry.baseline > 0, `exportCounts.${name}.baseline must be a positive integer`);
      assert.ok(typeof entry.reason === "string" && entry.reason.length > 0, `exportCounts.${name} must record a reason`);
    }
    const measured = measureExportCounts();
    assertAll(entries.map(([name, entry]) => checkExportBudget(name, measured[name], entry.baseline)));
  });

  it("dry pack ships every docs/index.md page and excludes evidence/maps/tests", () => {
    const packed = packedFilePaths(process.cwd(), ".");
    const packedSet = new Set(packed);
    const index = readFileSync("docs/index.md", "utf8");
    for (const match of index.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1].split("#")[0];
      // docs/_evidence is deliberately tarball-excluded (in-repo audit trail);
      // its links resolve in the repo, not in the shipped pack.
      if (!href.endsWith(".md") || href.startsWith("http") || href.startsWith("../") || href.includes("_evidence/")) continue;
      const path = `docs/${href.replace(/^\.\//, "")}`;
      assert.ok(packedSet.has(path), `shipped index links ${path} missing from pack`);
    }
    assert.ok(packedSet.has("docs/index.md"));
    assert.ok(!packed.some((path) => path.includes("_evidence") || /release-.*-evidence\.md$/.test(path)));
    assert.ok(!packed.includes("docs/api-page-template.md"));
    assert.ok(!packed.some((path) => path.includes("__tests__") || path.endsWith(".map")));
  });

  // Plan 071 Task 3: always-on ratio assertion with a load-aware ceiling; the
  // absolute ceiling is asserted only when nothing else is eating the machine (see
  // the budgets.json comment).
  it("root import startup stays under the sanity bound", () => {
    const importMs = measureStartupMs();
    const processMs = measureProcessStartupMs();
    assert.ok(Number.isFinite(importMs) && Number.isFinite(processMs), "startup measurement failed");
    const loaded = isMachineLoaded();
    const load = loadPerCpu();
    const ceiling = selectStartupRatioCeiling(budgets.startup, loaded);
    const relative = checkCeiling("startup ratio import/process-start", importMs / processMs, ceiling);
    assert.ok(
      relative.ok,
      `${relative.message} (import ${importMs.toFixed(1)}ms, process start ${processMs.toFixed(1)}ms, load/cpu ${load.toFixed(2)})`,
    );
    const absolute = checkCeiling("startup import", importMs, budgets.startup.importMsCeiling);
    if (loaded) {
      console.log(
        `[budget-gate] load/cpu ${load.toFixed(2)} >= ${LOADED_LOADAVG_PER_CPU}: ratio ceiling widened to ${ceiling}, absolute bound not asserted (${absolute.message})`,
      );
    } else {
      assert.ok(absolute.ok, `${absolute.message} (load/cpu ${load.toFixed(2)})`);
    }
  });

  it("startup sampling drops the min and max samples (injected spawn)", () => {
    const samples = ["10\n", "20\n", "30\n", "40\n", "100\n"];
    let call = 0;
    const fakeSpawn = () => ({ stdout: samples[call++] });
    assert.equal(measureStartupMs(process.cwd(), samples.length, fakeSpawn), 30, "min 10 and max 100 must be trimmed");
    assert.equal(
      measureStartupMs(process.cwd(), 1, () => ({ stdout: "12.5\n" })),
      12.5,
      "a single sample averages as-is",
    );
    assert.ok(Number.isNaN(measureStartupMs(process.cwd(), 1, () => ({ stdout: "not-a-number" }))), "garbage output is not a measurement");
  });

  // Negative control: a planted slow import must fail the ratio gate on this very
  // machine under either ceiling, so the gate can never pass by measuring nothing
  // (the fixture is a throwaway cwd; the real dist/ is untouched).
  it("startup ratio rejects a planted slow import", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-startup-"));
    try {
      mkdirSync(join(dir, "dist"));
      writeFileSync(
        join(dir, "dist", "index.js"),
        "const until = Date.now() + 800; while (Date.now() < until); module.exports = { planted: true };\n",
      );
      const importMs = measureStartupMs(dir, 1);
      const processMs = measureProcessStartupMs(1);
      // 750, not 800: Date.now() is millisecond-granular while the sample uses
      // hrtime, so the planted loop can exit a fraction of a millisecond early.
      assert.ok(importMs >= 750, `planted import must measure its own delay, got ${importMs}ms`);
      // Denominator floor: an empty node start measured 17-19ms idle here and cannot
      // realistically go below 20ms anywhere, so importMs/20 is an *upper* bound on
      // the real ratio — the control stays deterministic whatever the load is, and it
      // is judged against the widest ceiling the gate could apply.
      const ceiling = selectStartupRatioCeiling(budgets.startup, true);
      const check = checkCeiling("startup ratio", importMs / 20, ceiling);
      assert.equal(
        check.ok,
        false,
        `planted slow import (${importMs.toFixed(0)}ms import, ${processMs.toFixed(1)}ms measured process start) must fail the ratio gate: ${check.message}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("comparison helpers reject regressions (negative fixtures)", () => {
    assert.equal(checkUpperBound("x", 200, 100, 0.05).ok, false, "inflated pack size must fail");
    assert.equal(checkUpperBound("x", 104, 100, 0.05).ok, true, "within-tolerance pack size must pass");
    assert.equal(checkThroughput("x", 500, 1000, 0.25).ok, false, "halved throughput must fail");
    assert.equal(checkThroughput("x", 800, 1000, 0.25).ok, true, "within-tolerance throughput must pass");
    assert.equal(checkCeiling("x", 300, 250).ok, false, "above-ceiling startup must fail");
    assert.throws(() => assertAll([checkUpperBound("x", 200, 100, 0.05)]), /budget regression/);
  });

  it("export budget rejects growth and names the delta (negative fixtures)", () => {
    const grown = checkExportBudget("@arnilo/prism", 1148, 1147);
    assert.equal(grown.ok, false, "one export beyond ceiling must fail");
    assert.match(grown.message, /@arnilo\/prism/);
    assert.match(grown.message, /\(\+1\)/, "failure must name the exact delta");
    assert.throws(() => assertAll([grown]), /budget regression/);
    assert.equal(checkExportBudget("@arnilo/prism", 1147, 1147).ok, true, "at-ceiling must pass");
    assert.equal(checkExportBudget("@arnilo/prism", 1146, 1147).ok, true, "shrinking the surface must pass");
  });
});

// Plan 071 Task 9 (plan 070 FA 2): the non-null assertion allowance. The rule is an
// error repo-wide in biome.json and switched back off per directory via `overrides`;
// budgets.json records the sites still in each allowlisted directory so the allowance
// can only shrink. One biome pass measures everything (`--only` reports inside the
// allowlisted directories too).
describe("non-null assertion budget gate", () => {
  const budget = budgets.nonNullAssertions;
  const measured = measureNonNullAssertions();
  const measuredFixture = (overrides = {}) => ({
    total: 10,
    byPath: { src: 4, examples: 6 },
    outside: [],
    enforced: [{ pattern: "src/agent-loops.ts", files: 1, sites: 0 }],
    ...overrides,
  });

  it("keeps every allowlisted directory at or under its recorded count", () => {
    assert.ok(measured.total > 0, "measurement must see the repository's remaining sites");
    assertAll(evaluateNonNullBudget({ budget, measured }));
  });

  it("biome.json allowlist and budgets.json rows describe the same directories", () => {
    const policy = loadNonNullPolicy();
    assert.ok(policy.enforced.length > 0, "the swept clusters must stay re-enabled as errors");
    assert.deepEqual(
      [...policy.allowlisted].sort(),
      Object.keys(budget.byPath)
        .map((dir) => `${dir}/**`)
        .sort(),
      "every allowlist entry needs a budget row and vice versa",
    );
  });

  it("fails when a recorded count is one below the live measurement (positive control)", () => {
    const dir = Object.keys(budget.byPath).find((key) => measured.byPath[key] > 0);
    assert.ok(dir, "expected at least one allowlisted directory with remaining sites");
    const lowered = { ...budget, byPath: { ...budget.byPath, [dir]: budget.byPath[dir] - 1 } };
    const checks = evaluateNonNullBudget({ budget: lowered, measured });
    assert.ok(
      checks.some((check) => !check.ok && check.message.includes(dir)),
      "lowering a recorded count below the measurement must fail and name the directory",
    );
    assert.throws(() => assertAll(checks), /budget regression/);
  });

  it("rejects growth, stale rows, outside sites, and regressed clusters (negative fixtures)", () => {
    const fixtureBudget = { ceiling: 10, byPath: { src: 4, examples: 6 } };
    assertAll(evaluateNonNullBudget({ budget: fixtureBudget, measured: measuredFixture() }));
    const growth = evaluateNonNullBudget({
      budget: fixtureBudget,
      measured: measuredFixture({ byPath: { src: 5, examples: 6 }, total: 11 }),
    });
    assert.ok(
      growth.some((check) => !check.ok && /src: measured 5 non-null assertion\(s\) vs recorded 4/.test(check.message)),
      "growth must fail",
    );
    const stale = evaluateNonNullBudget({
      budget: { ceiling: 10, byPath: { src: 0, examples: 6 } },
      measured: measuredFixture({ byPath: { src: 0, examples: 6 }, total: 6 }),
    });
    assert.ok(
      stale.some((check) => !check.ok && /drop the biome.json allowlist entry/.test(check.message)),
      "a zero-site row must fail",
    );
    const extraRow = evaluateNonNullBudget({
      budget: { ceiling: 10, byPath: { src: 4, examples: 6, docs: 1 } },
      measured: measuredFixture(),
    });
    assert.ok(
      extraRow.some((check) => !check.ok && /budgets.json records docs/.test(check.message)),
      "an unallowlisted row must fail",
    );
    const outside = evaluateNonNullBudget({ budget: fixtureBudget, measured: measuredFixture({ outside: ["scripts/foo.mjs"] }) });
    assert.ok(
      outside.some((check) => !check.ok && /outside the allowlist/.test(check.message)),
      "an outside site must fail",
    );
    const regressed = evaluateNonNullBudget({
      budget: fixtureBudget,
      measured: measuredFixture({ enforced: [{ pattern: "src/agent-loops.ts", files: 1, sites: 2 }] }),
    });
    assert.ok(
      regressed.some((check) => !check.ok && /must stay clean/.test(check.message)),
      "a regressed cluster must fail",
    );
    const renamed = evaluateNonNullBudget({
      budget: fixtureBudget,
      measured: measuredFixture({ enforced: [{ pattern: "src/agent-loops.ts", files: 0, sites: 0 }] }),
    });
    assert.ok(
      renamed.some((check) => !check.ok && /no file matches/.test(check.message)),
      "a renamed cluster file must fail",
    );
  });
});
