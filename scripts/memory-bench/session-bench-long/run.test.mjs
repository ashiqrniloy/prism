import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolveMemorySystemComponents } from "../../../packages/memory/system/src/components.ts";
import { isDurableOrUserStatement as productIsDurableOrUserStatement } from "../../../packages/memory/system/src/session/attribution.ts";
import { dependencyEvidence } from "./agents.mjs";
import { LONG_ARMS, longArmMemoryConfig, MEMORY_SYSTEM_ARMS, oracleNotes, WM_ARMS, WM_TRIGGER_TOKENS } from "./arms.mjs";
import { REVOKE_CLASS } from "./checks.mjs";
import { createSession, partitionIds, sessionBenchLongPartitions } from "./generate.mjs";
import { AMNESIC_FAIL_CLASSES, checkLongGuardrails, liveLongGuardrails, pressureViolations } from "./guardrails.mjs";
import { firstAfterTask, isDurableOrUserStatement } from "./instrument.mjs";
import { longAgentMock, longWorkerMock, runLongArmSession, workerRates } from "./run.mjs";

const DEV = partitionIds(sessionBenchLongPartitions(), "dev");
const offline = (session, arm, maxTasks) =>
  runLongArmSession({
    session,
    arm,
    providers: (state) => [longAgentMock(state), longWorkerMock()],
    model: { provider: "mock", model: "main" },
    workerModel: "worker/session-bench",
    ...(maxTasks ? { maxTasks } : {}),
  });

test("g11_fails_when_sessions_are_too_short", async () => {
  const session = createSession(DEV[0]);
  const firstAfter = firstAfterTask(session);
  // Stopped at task 40, STM-only has not overflowed the pool: G11 must fail.
  const short = await offline(session, "STM-only", 40);
  assert.equal(short.instrumentation.summary.firstOverflowTask, null);
  const violations = pressureViolations([session], { [session.id]: short.instrumentation.summary });
  assert.deepEqual(
    violations.map((row) => [row.session, row.overflow]),
    [[session.id, null]],
  );
  // An overflow at or after the first `after` dependent fails too; one before it passes.
  assert.equal(pressureViolations([session], { [session.id]: { firstOverflowTask: firstAfter } }).length, 1);
  assert.equal(pressureViolations([session], { [session.id]: { firstOverflowTask: firstAfter - 1 } }).length, 0);
  assert.equal(pressureViolations([session], {}).length, 1);
}, 120_000);

test("oracle_notes_carries_current_values_only", () => {
  for (const id of DEV) {
    const session = createSession(id);
    assert.equal(oracleNotes(session, 1), null);
    for (const dep of session.deps) {
      const notes = oracleNotes(session, dep.dependent);
      for (const text of dependencyEvidence(dep)) assert.ok(notes.includes(text), `${id} ${dep.id} notes miss its evidence`);
      // No other value of the same story: a changed ship day shows its current form only.
      for (const other of session.deps.filter((row) => row.group === dep.group && row.class === "D4" && row.evidence !== dep.evidence))
        assert.ok(!notes.includes(other.evidence), `${id} ${dep.id} notes carry the stale ${other.id}`);
      // Nothing from a source still to come.
      for (const later of session.deps.filter((row) => Math.min(...row.sources) >= dep.dependent))
        for (const text of dependencyEvidence(later)) assert.ok(!notes.includes(text), `${id} ${dep.id} notes carry ${later.id} early`);
    }
    const revoke = session.deps.find((dep) => dep.class === REVOKE_CLASS);
    assert.ok(!oracleNotes(session, Math.max(...revoke.sources)).includes(revoke.evidence));
  }
});

test("row_counts_hold_no_text", async () => {
  const session = createSession(DEV[1]);
  const run = await offline(session, "STM-only", 26);
  const row = { checks: run.checks, tasks: run.tasks, status: run.status, meter: run.meter, instrumentation: run.instrumentation };
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        strings.push(key);
        walk(item);
      }
  };
  walk(row);
  for (const text of strings) assert.match(text, /^[A-Za-z0-9_.:+-]{1,48}$/, `a row holds text: ${text.slice(0, 60)}`);
  const json = JSON.stringify(row);
  // Whole tokens only: a numeric answer ("490") may sit inside a count ("2490") by chance.
  const holds = (text) => new RegExp(`(^|[^A-Za-z0-9])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`).test(json);
  for (const dep of session.deps) for (const text of [dep.answer, ...dependencyEvidence(dep)]) assert.ok(!holds(text), `${dep.id} ${text}`);
  // The instrumentation saw the session: blocks, records, and a source check for each dependent so far.
  const last = run.instrumentation.pressure.at(-1);
  assert.equal(run.instrumentation.pressure.length, 26);
  assert.ok(last.block.renderedTokens > last.block.descriptionTokens);
  assert.ok(last.activeRecords > 0);
  const dependents = run.instrumentation.dependents;
  assert.deepEqual(
    dependents.map((dep) => dep.dep),
    session.deps.filter((dep) => dep.dependent <= 26).map((dep) => dep.id),
  );
  for (const dep of dependents) {
    assert.ok(dep.sourceRecords.length > 0);
    for (const id of dep.inBlock) assert.ok(dep.sourceRecords.includes(id));
  }
}, 120_000);

test("amnesic_fails_every_d2_d4_revoke_check_offline", async () => {
  const session = createSession(DEV[2]);
  const run = await offline(session, "amnesic");
  assert.equal(run.instrumentation, null);
  for (const row of run.checks) {
    if (AMNESIC_FAIL_CLASSES.includes(row.class)) assert.equal(row.pass, false, `${row.check} (${row.class}) passed amnesic`);
    if (row.class === "C") assert.equal(row.pass, true, `${row.check} (C) failed amnesic`);
  }
  assert.deepEqual([...new Set(run.checks.map((row) => row.class))].sort(), ["C", "D1", "D2", "D2R", "D3", "D4"]);
  assert.equal(run.meter.overflows, 0);
}, 120_000);

test("instrument_mirrors_the_products_user_statement_rule", () => {
  const cases = [];
  for (const kind of ["statement", "request", "result"])
    for (const attribution of ["user", "mixed", "assistant", "tool", undefined])
      for (const verbatim of [true, undefined])
        for (const durable of ["constraint", undefined]) cases.push({ kind, attribution, verbatim, durable });
  for (const record of cases)
    assert.equal(isDurableOrUserStatement(record), productIsDurableOrUserStatement(record), JSON.stringify(record));
});

test("memory_arms_differ_only_in_eviction_and_wm_and_run_no_rehearsal", () => {
  for (const arm of MEMORY_SYSTEM_ARMS) {
    const { config } = longArmMemoryConfig(arm);
    // Rehearsal needs `wm` and `ltm`; no arm turns `ltm` on, so no arm runs the Rehearsal drop.
    assert.equal(resolveMemorySystemComponents(config).rehearsal, false, arm);
    assert.equal(resolveMemorySystemComponents(config).wm, WM_ARMS.includes(arm), arm);
  }
  assert.equal(longArmMemoryConfig("STM-only").config.context.eviction, "relevance");
  assert.equal(longArmMemoryConfig("STM-only-protect").config.context.eviction, "protect-user");
  assert.equal(longArmMemoryConfig("STM+WM").config.wm.policy, "model");
  assert.equal(longArmMemoryConfig("STM+WM-deterministic").config.wm.policy, "deterministic");
  for (const arm of WM_ARMS) {
    assert.equal(longArmMemoryConfig(arm).config.wm.triggerTokens, WM_TRIGGER_TOKENS);
    assert.equal(longArmMemoryConfig(arm).setScope, true);
  }
  assert.equal(longArmMemoryConfig("oracle-notes").oracleNotes, true);
  assert.equal(LONG_ARMS.length, 8);
});

test("worker_mock_records_at_the_design_reviews_rates", () => {
  const rates = workerRates();
  // The Task 7 pilot's live STM-only ledgers (benchmark version 2): medium 65.7, high 38.4 less verbatim 37.6.
  assert.equal(rates.mediumTokens, 65.7);
  assert.equal(rates.statementTokens, 0.8);
});

// Plan 218.5 Task 6: `score.mjs` `ANALYSIS_LONG` ends G8's pending state (Task 5 asserted it pending).
test("offline_guardrails_pass_with_nothing_pending", async () => {
  const report = await checkLongGuardrails({ probe: false, pressure: false });
  assert.equal(report.pass, true, JSON.stringify(report.guardrails.filter((row) => !row.pass)));
  assert.deepEqual(report.pending, []);
  assert.equal(report.guardrails.find((row) => row.id === "G8").analysis, "session-bench-long-analysis-v3");
  assert.deepEqual(
    report.guardrails.map((row) => row.id),
    ["G1", "G2", "G3", "G4", "G5", "sizes", "G6", "G7", "G8", "G9", "G10", "G11"],
  );
}, 120_000);

test("live_guardrails_read_the_calibration_and_pressure_rows", () => {
  const sessions = ["a", "b", "c"];
  const classes = (pass) => Object.fromEntries(AMNESIC_FAIL_CLASSES.map((cls) => [cls, { pass, total: 10 }]));
  const report = (over) => ({
    sessions,
    scores: {
      "oracle-notes": { overall: { taskRate: 0.7 }, sessions: { a: {}, b: {}, c: {} } },
      amnesic: { overall: { classes: classes(2) }, sessions: { a: {}, b: {}, c: {} } },
      "STM-only": { overall: {}, sessions: { a: {}, b: {}, c: {} } },
    },
    // Analysis v3: a session counts when at least half its `after` dependents sit at or past overflow + 10.
    pressure: { "STM-only": { a: { firstOverflowTask: 95 }, b: { firstOverflowTask: 100 }, c: { firstOverflowTask: 115 } } },
    afterTasks: { a: [111, 120, 130, 140], b: [111, 120, 130, 140], c: [111, 120, 130, 140] },
    cost: { "STM-only": { overflows: 0 } },
    faults: { "STM-only": [] },
    ...over,
  });
  const g11 = (r) => liveLongGuardrails(r).rows.find((row) => row.id === "G11-live");
  assert.equal(liveLongGuardrails(report({})).pass, true);
  assert.deepEqual(g11(report({})).scoredShare, { a: 1, b: 1, c: 0.5 });
  // Overflow at 125.5 and 130 leaves 1 of 4 scored in each: one session reaches, under the 2 of 3.
  const late = { "STM-only": { a: { firstOverflowTask: 95 }, b: { firstOverflowTask: 125.5 }, c: { firstOverflowTask: 130 } } };
  assert.equal(liveLongGuardrails(report({ pressure: late })).pass, false);
  // A session where STM-only never overflowed scores nothing.
  assert.equal(
    g11(report({ pressure: { "STM-only": { a: { firstOverflowTask: null }, b: {}, c: { firstOverflowTask: 95 } } } })).reached,
    1,
  );
  // An overflow the kernel compacted around is reported, not a miss; a task that ended on one is a miss.
  const recovered = liveLongGuardrails(report({ cost: { mem0: { overflows: 4 } } }));
  assert.equal(recovered.pass, true);
  assert.equal(recovered.rows.find((row) => row.id === "no-window-overflow").overflows, 4);
  assert.equal(
    liveLongGuardrails(report({ faults: { mem0: [{ session: "a", task: 3, status: "error", code: "context_overflow" }] } })).pass,
    false,
  );
  const weak = report({});
  weak.scores.amnesic.overall.classes.D4 = { pass: 5, total: 10 }; // fails 50%, under the 60% D4 floor
  assert.equal(liveLongGuardrails(weak).pass, false);
  const partial = report({});
  delete partial.scores.amnesic.sessions.c;
  assert.equal(liveLongGuardrails(partial).complete, false);
});

test("the amnesic D4 floor is 60%, D2 and D2R stay at 70% (plan 218.5 Task 7, owner 2026-11-25)", async () => {
  const { LIVE_GUARDRAILS } = await import("./guardrails.mjs");
  assert.deepEqual({ ...LIVE_GUARDRAILS.amnesicFailRateMin }, { D2: 0.7, D4: 0.6, [REVOKE_CLASS]: 0.7 });
});
