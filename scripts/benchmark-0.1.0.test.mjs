#!/usr/bin/env node
/**
 * Release 0.1.0 capacity-envelope regression gate (plan 012 Task 5).
 *
 * Reads the checked-in scripts/benchmark-0.1.0.json and asserts every
 * envelope against the Task 0 freeze-manifest capacity contract: the 24
 * named p95 ceilings (network-free), the protected PostgreSQL legs against
 * their budgets.json ceilings, startup import and root pack diet rows, and
 * result-name drift. No live timing here — the JSON is the frozen evidence;
 * regenerate it with scripts/benchmark-0.1.0.mjs.
 *
 * Test cases (plan): real recorded results pass; a synthetic over-ceiling
 * fixture fails the gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkUpperBound, loadBudgets } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const freeze = JSON.parse(readFileSync(join(here, "phase12-freeze-manifest.json"), "utf8"));
const budgets = loadBudgets();
const capacity = freeze.capacity;

const protectedCeilings = {
  ...budgets.enterprisePostgres.p95CeilingsMs,
  ...budgets.phase7Postgres.p95CeilingsMs,
};
const knownNames = new Set([...Object.keys(capacity.ceilingsMs), ...Object.keys(protectedCeilings)]);

export function assertEnvelope(evidence) {
  assert.equal(evidence.version, "0.1.0", "evidence must be the 0.1.0 envelope");
  const rows = evidence.results;
  const byName = new Map(rows.map((row) => [row.name, row]));

  // Every frozen network-free ceiling must be measured, within ceiling.
  for (const [name, ceiling] of Object.entries(capacity.ceilingsMs)) {
    const row = byName.get(name);
    assert.ok(row, `missing frozen envelope row ${name}`);
    assert.ok(row.p95Ms <= ceiling, `${name} p95 ${row.p95Ms}ms exceeds frozen ceiling ${ceiling}ms`);
    assert.ok(row.throughputPerSecond > 0, `${name} throughput missing`);
  }

  // Protected PostgreSQL rows (enterprise + Phase 7) recorded within budgets ceilings.
  for (const [name, ceiling] of Object.entries(protectedCeilings)) {
    const row = byName.get(name);
    assert.ok(row, `missing protected envelope row ${name}`);
    assert.ok(row.protected, `${name} must be labeled protected`);
    assert.ok(row.p95Ms <= ceiling, `${name} p95 ${row.p95Ms}ms exceeds protected ceiling ${ceiling}ms`);
  }

  // No drift: every row is a known envelope.
  for (const row of rows) {
    assert.ok(knownNames.has(row.name), `unexpected envelope row ${row.name}`);
  }

  // Both protected legs must have been measured (evidence completeness).
  assert.ok(
    evidence.legs.every((leg) => leg.status === "run"),
    "all six benchmark legs must be recorded as run",
  );

  // Install/startup rows from the shared budget-gate helpers, within frozen bounds.
  const { installSize } = evidence;
  assert.ok(Number.isFinite(installSize.startupImportMs), "startupImportMs missing");
  assert.ok(
    installSize.startupImportMs <= capacity.startupImportMsCeiling,
    `startup ${installSize.startupImportMs}ms > ${capacity.startupImportMsCeiling}ms`,
  );
  for (const [key, baseline, tolerance] of [
    ["rootPackedBytes", capacity.rootPackedBytes.baseline, capacity.rootPackedBytes.tolerance],
    ["rootFileCount", capacity.rootFileCount.baseline, capacity.rootFileCount.tolerance],
  ]) {
    const check = checkUpperBound(key, installSize[key], baseline, tolerance);
    assert.ok(check.ok, check.message);
  }
}

describe("benchmark-0.1.0 capacity envelope", () => {
  it("recorded 0.1.0 envelope passes the frozen contract", () => {
    const evidence = JSON.parse(readFileSync(join(here, "benchmark-0.1.0.json"), "utf8"));
    assertEnvelope(evidence);
  });

  it("synthetic over-ceiling fixture fails the gate", () => {
    const evidence = JSON.parse(readFileSync(join(here, "benchmark-0.1.0.json"), "utf8"));
    const victim = evidence.results.find((row) => capacity.ceilingsMs[row.name] !== undefined);
    victim.p95Ms = capacity.ceilingsMs[victim.name] * 2;
    assert.throws(() => assertEnvelope(evidence), new RegExp(victim.name));
  });
});
