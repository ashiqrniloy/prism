#!/usr/bin/env node
import { describe, it } from "bun:test";
/**
 * Plan 210 Task 0.1: session-turn-overhead scenario registration, report schema, network-free
 * posture and the deterministic store-read counter, at the reduced gate run count from
 * scripts/budgets.json#sessionTurnOverhead. Plan 210 Task 0.3 freezes its ceilings
 * (`sessionTurnOverhead.ceilings`): store entries read per run after warm-up, the same-process
 * growthRatio per store, and a loose p95 sanity bound (scaled on CI by wallClockBudget).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./benchmark.mjs";
import { checkCeiling, loadBudgets, wallClockBudget } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "benchmark.mjs");
const { fixture, ceilings } = loadBudgets().sessionTurnOverhead;

/** One gate-sized scenario run, shared by the schema and the ceiling tests. */
let gateReport;
function gateRun() {
  if (gateReport) return gateReport;
  const run = spawnSync(process.execPath, [runner, "--scenario", "session-turn-overhead"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PRISM_BENCH_RUNS: String(fixture.gateRuns) },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  gateReport = { stdout: run.stdout, report: JSON.parse(run.stdout) };
  return gateReport;
}

describe("session-turn-overhead benchmark scenario (plan 210 Task 0.1)", () => {
  it("session_turn_overhead_scenario_is_registered_and_network_free", () => {
    const scenario = SCENARIOS["session-turn-overhead"];
    assert.ok(scenario, "session-turn-overhead missing from the parameterized runner");
    assert.equal(scenario.phase, 210);
    assert.equal(scenario.protected, false);
    assert.ok(existsSync(join(here, scenario.module)), `module ${scenario.module} exists`);
  });

  it("session_turn_overhead_reports_growth_and_store_reads_for_both_stores", () => {
    const { stdout, report } = gateRun();
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    assert.equal(report.fixture.runs, fixture.gateRuns);
    assert.equal(report.fixture.payloadBytes, fixture.payloadBytes);
    for (const check of report.checks) assert.equal(check.pass, true, `scenario check failed: ${check.name}`);
    assert.deepEqual(
      report.results.map((variant) => variant.name),
      ["memory", "sqlite"],
    );
    for (const variant of report.results) {
      for (const key of ["p50Ms", "p95Ms", "firstWindowP50Ms", "lastWindowP50Ms", "growthRatio"]) {
        assert.ok(Number.isFinite(variant[key]) && variant[key] > 0, `${variant.name}.${key}`);
      }
      assert.ok(variant.p95Ms >= variant.p50Ms, `${variant.name} p95 >= p50`);
      // The deterministic O(history) signal: present and counted through the wrapping store.
      assert.ok(
        Number.isFinite(variant.storeEntriesReadPerRun) && variant.storeEntriesReadPerRun >= 0,
        `${variant.name}.storeEntriesReadPerRun`,
      );
      assert.deepEqual(Object.keys(variant.storeReads).sort(), ["get", "list", "readBranchPath"]);
    }
    // The report carries no message text: the payload unit never leaks into it.
    assert.doesNotMatch(stdout, /lorem ipsum|run \d+/);
  });

  it("session_turn_overhead_within_frozen_ceilings", () => {
    const { report } = gateRun();
    const failures = [];
    for (const variant of report.results) {
      for (const check of [
        checkCeiling(`${variant.name}.storeEntriesReadPerRun`, variant.storeEntriesReadPerRun, ceilings.maxStoreEntriesReadPerRun),
        checkCeiling(`${variant.name}.growthRatio`, variant.growthRatio, ceilings.maxGrowthRatio[variant.name]),
        checkCeiling(`${variant.name}.p95Ms`, variant.p95Ms, wallClockBudget(ceilings.maxP95Ms)),
      ]) {
        if (!check.ok) failures.push(check.message);
      }
    }
    assert.deepEqual(failures, [], failures.join("\n"));
  });
});

describe("byte accounting budget (plan 228 Task 4)", () => {
  /** Best-of timing, interleaved so machine load hits both sides alike. */
  function bestOf(fns, reps, rounds = 7) {
    const best = fns.map(() => Number.POSITIVE_INFINITY);
    for (let round = 0; round < rounds; round += 1) {
      fns.forEach((fn, i) => {
        const started = performance.now();
        for (let r = 0; r < reps; r += 1) fn(r);
        best[i] = Math.min(best[i], performance.now() - started);
      });
    }
    return best;
  }

  it("benchmark_byte_accounting_budget", async () => {
    const { jsonBytes, providerEventBytes, requestBytes } = await import("../src/agent-session/helpers.ts");
    const { ceilings: byteCeilings } = loadBudgets().byteAccounting;
    // Task 1's workload: a ~200 KiB request (80 unicode messages + 20 tool schemas) re-sized each attempt
    // with one new message, and a turn of 2,000 streamed text deltas.
    const messages = Array.from({ length: 80 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: [{ type: "text", text: `msg ${i} héllo 😀 日本語 ${"lorem ipsum dolor ".repeat(140)}` }],
    }));
    const tools = Array.from({ length: 20 }, (_, i) => ({
      name: `t${i}`,
      description: "d".repeat(400),
      inputSchema: { type: "object", properties: { a: { type: "string", description: "x".repeat(200) } } },
    }));
    const attempt = (r) => ({
      model: { provider: "p", model: "m" },
      messages: [...messages, { role: "user", content: [{ type: "text", text: `next ${r}` }] }],
      tools,
    });
    assert.ok(jsonBytes(attempt(0)) > 200 * 1024);
    const deltas = Array.from({ length: 2000 }, (_, i) => ({ type: "content_delta", content: { type: "text", text: `tok${i} é ` } }));
    const [serialized, sized] = bestOf(
      [
        (r) => {
          jsonBytes(attempt(r));
          for (const event of deltas) jsonBytes(event);
        },
        (r) => {
          requestBytes(attempt(r));
          for (const event of deltas) providerEventBytes(event);
        },
      ],
      10,
    );
    const ratio = sized / serialized;
    assert.ok(
      ratio <= byteCeilings.maxSizedToSerializedRatio,
      `byte accounting ${sized.toFixed(2)} ms vs serialized ${serialized.toFixed(2)} ms (ratio ${ratio.toFixed(3)})`,
    );
  });
});
