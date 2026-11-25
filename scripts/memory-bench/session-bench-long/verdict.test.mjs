/**
 * Plan 218.5 Task 6: the long bench's verdict (`score.mjs` `longVerdict`) on synthetic units for every branch, and the
 * live runner's refusals (`live.mjs`). No call.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLongGate,
  assertLongRowHoldsNoText,
  liveArmHashes,
  longJobs,
  longRuleHash,
  pilotIds,
  SESSION_BENCH_LONG_RULE,
  writeGate,
} from "./live.mjs";
import { ANALYSIS_LONG, clusterInterval, longUnits, longVerdict, POOLED_CLASSES } from "./score.mjs";

const SESSIONS = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, "0")}`);
const FAST = { iterations: 2_000, seed: 7 };

/**
 * One arm's blind rows. `after(i)` / `before(i)` / `control(i)`: how many checks pass in session `i` (of 16 after, 8
 * before and 10 control). Classes follow the bench's 1 : 3 : 1 : 3 mix; every check is its own task.
 */
function armRows({ after = () => 8, before = () => 4, control = () => 10 }) {
  const checks = [];
  SESSIONS.forEach((session, i) => {
    let task = 0;
    const add = (cls, bucket, pass) =>
      checks.push({ session, task: ++task, check: `c${task}`, class: cls, ...(bucket ? { bucket } : {}), pass });
    const mix = (n) => Array.from({ length: n }, (_, k) => POOLED_CLASSES[[0, 1, 1, 1, 2, 3, 3, 3][k % 8]]);
    for (const [k, cls] of mix(8).entries()) add(cls, "before", k < before(i));
    for (const [k, cls] of mix(16).entries()) add(cls, "after", k < after(i));
    add("D2R", "after", true);
    for (let k = 0; k < 10; k++) add("C", undefined, k < control(i));
  });
  return longUnits({ checks }).units;
}

const base = () => armRows({});
const better = (extra = 6) => armRows({ after: () => 8 + extra });
const cost = (overrides = {}) => ({
  "memory-off-llm": 100,
  "STM-only": 100,
  "STM-only-protect": 100,
  "STM+WM": 120,
  "STM+WM-deterministic": 110,
  ...overrides,
});
const verdictOf = (units, costs = cost()) => longVerdict({ units, costPerPassedTask: costs }, FAST);
const allBase = (overrides = {}) => ({
  "memory-off-llm": base(),
  "STM-only": base(),
  "STM-only-protect": base(),
  "STM+WM": base(),
  "STM+WM-deterministic": base(),
  mem0: base(),
  ...overrides,
});

describe("longVerdict", () => {
  test("protect_becomes_reference_only_on_gain", () => {
    expect(verdictOf(allBase({ "STM-only-protect": better() })).step1.reference).toBe("STM-only-protect");
    expect(verdictOf(allBase({ "STM-only-protect": better() })).step1.evictionDefault).toBe("protect-user");
    expect(verdictOf(allBase()).step1.reference).toBe("STM-only");
    // A gain on after with a control loss below -5 points keeps STM-only.
    const lossy = armRows({ after: () => 14, control: () => 7 });
    expect(verdictOf(allBase({ "STM-only-protect": lossy })).step1.reference).toBe("STM-only");
  });

  test("verdict_keeps_wm_when_bound_cost_and_control_hold", () => {
    const v = verdictOf(allBase({ "STM+WM": better() }));
    expect(v.step2.outcome).toBe("keep");
    expect(v.step2.wmDefaultPolicy).toBe("model");
    expect(v.step2.arms.find((row) => row.arm === "STM+WM").keeps).toBe(true);
    // The deterministic arm wins the policy when it is the keeper.
    expect(verdictOf(allBase({ "STM+WM-deterministic": better() })).step2.wmDefaultPolicy).toBe("deterministic");
    // Cost over 1.5x the reference: no keep, and the upper bound is not under +5 points: the owner decides.
    expect(verdictOf(allBase({ "STM+WM": better() }), cost({ "STM+WM": 151 })).step2.outcome).toBe("owner");
    // A control loss below -5 points: no keep.
    const lossy = armRows({ after: () => 14, control: () => 7 });
    expect(verdictOf(allBase({ "STM+WM": lossy })).step2.outcome).toBe("owner");
    // Against the reference step 1 chose: WM equal to protect, which beats STM-only, is no keep.
    expect(verdictOf(allBase({ "STM-only-protect": better(), "STM+WM": better() })).step2.reference).toBe("STM-only-protect");
    expect(verdictOf(allBase({ "STM-only-protect": better(), "STM+WM": better() })).step2.outcome).toBe("drop");
  });

  test("verdict_drops_wm_when_both_upper_bounds_under_five_points", () => {
    const v = verdictOf(allBase());
    expect(v.step2.outcome).toBe("drop");
    expect(v.step2.arms.every((row) => row.underDropBound)).toBe(true);
    expect(v.step2.wmDefaultPolicy).toBeNull();
  });

  test("verdict_goes_to_owner_in_between", () => {
    // Half the sessions gain 6 of 16 after checks, half lose 4: the interval spans 0 and reaches past +5 points.
    const mixed = armRows({ after: (i) => (i % 2 ? 14 : 4) });
    const v = verdictOf(allBase({ "STM+WM": mixed }));
    const row = v.step2.arms.find((r) => r.arm === "STM+WM");
    expect(row.after.ci[0]).toBeLessThanOrEqual(0);
    expect(row.after.ci[1]).toBeGreaterThanOrEqual(0.05);
    expect(v.step2.outcome).toBe("owner");
    // The owner's report: the bucket interaction, the detectable effect and the cost are there.
    expect(row.interaction.sessions).toBe(12);
    expect(typeof row.detectableEffect).toBe("number");
    expect(row.costRatio).toBeCloseTo(1.2);
  });

  test("holm_adjusts_over_two_wm_arms", () => {
    // One strong arm, one null arm: the strong arm (smaller p) reads 97.5%; it is rejected, so the other reads 95%.
    const strong = verdictOf(allBase({ "STM+WM": better() }));
    const level = (v, arm) => v.step2.arms.find((row) => row.arm === arm).level;
    expect(level(strong, "STM+WM")).toBe(0.975);
    expect(level(strong, "STM+WM-deterministic")).toBe(0.95);
    expect(strong.step2.arms.find((row) => row.arm === "STM+WM").adjustedP).toBeLessThan(0.05);
    // Neither rejected: both read 97.5%.
    const none = verdictOf(allBase());
    expect(level(none, "STM+WM")).toBe(0.975);
    expect(level(none, "STM+WM-deterministic")).toBe(0.975);
    // A 97.5% interval is at least as wide as the 95% one on the same differences.
    const rows = SESSIONS.map((cluster, i) => ({ cluster, value: (i % 3) - 1 }));
    const [l95, u95] = clusterInterval(rows, { level: 0.95, ...FAST });
    const [l975, u975] = clusterInterval(rows, { level: 0.975, ...FAST });
    expect(l975).toBeLessThanOrEqual(l95);
    expect(u975).toBeGreaterThanOrEqual(u95);
  });

  test("stm_at_length_finding_fires", () => {
    // memory-off-llm equal to STM after the overflow, worse before it: the P1 STM finding.
    const offLate = armRows({ before: () => 1 });
    const fired = verdictOf(allBase({ "memory-off-llm": offLate }));
    expect(fired.stmAtLength.finding?.finding).toBe("P1");
    expect(fired.summary.stmAtLengthFinding).toBe(true);
    // STM ahead in both buckets: no finding.
    const offBoth = armRows({ before: () => 1, after: () => 2 });
    expect(verdictOf(allBase({ "memory-off-llm": offBoth })).stmAtLength.finding).toBeNull();
  });

  test("an arm that did not run leaves the verdict incomplete", () => {
    const units = allBase();
    delete units["STM+WM-deterministic"];
    expect(verdictOf(units).step2.outcome).toBe("incomplete");
  });

  test("the analysis covers every decision arm, every class and both buckets (G8)", () => {
    for (const metric of ["task", "C", "D2R", "before", "after", "after:D4"]) expect(ANALYSIS_LONG.metrics).toContain(metric);
    for (const arm of ["memory-off-llm", "STM-only", "STM-only-protect", "STM+WM", "STM+WM-deterministic"])
      expect(ANALYSIS_LONG.comparisons.flat()).toContain(arm);
  });
});

describe("live.mjs", () => {
  const rule = SESSION_BENCH_LONG_RULE;
  const approved = (overrides = {}) => ({
    sessionBenchLong: {
      ruleHash: longRuleHash(rule),
      rule: JSON.parse(JSON.stringify(rule)),
      approved: true,
      approvedBy: "owner",
      approvedAt: "2026-11-24",
      text: "yes",
      ...overrides,
    },
  });

  test("live_refuses_an_unapproved_rule_hash", () => {
    expect(assertLongGate(approved())).toBeTruthy();
    expect(() => assertLongGate({})).toThrow(/no sessionBenchLong/);
    expect(() => assertLongGate(approved({ approved: false }))).toThrow(/owner's word/);
    expect(() => assertLongGate(approved({ approvedAt: "" }))).toThrow(/owner's word/);
    expect(() => assertLongGate(approved({ ruleHash: "0".repeat(64) }))).toThrow(/differs/);
    expect(() => assertLongGate(approved({ rule: { ...rule, ceilingInputTokens: 1 } }))).toThrow(/differs/);
    expect(() => assertLongGate(approved(), { ...rule, concurrency: 7 })).toThrow(/differs/);
    // `--write-gate` writes the rule unapproved, and the live run refuses it until the owner's word.
    const dir = mkdtempSync(join(tmpdir(), "sbl-gate-"));
    const path = join(dir, "gate.json");
    writeFileSync(path, JSON.stringify({ design: { kept: true } }));
    writeGate(path);
    const gate = JSON.parse(readFileSync(path, "utf8"));
    expect(gate.design).toEqual({ kept: true });
    expect(gate.sessionBenchLong.ruleHash).toBe(longRuleHash(rule));
    expect(() => assertLongGate(gate)).toThrow(/owner's word/);
  });

  test("the rule pins the benchmark, the product, the arms and the owner's decisions", () => {
    expect(rule.sessions).toHaveLength(12);
    expect(rule.pilotSessions).toEqual(pilotIds());
    expect(rule.pilotSessions.map((id) => id.slice(0, 6))).toEqual(["sbl-sc", "sbl-id", "sbl-rt"]);
    expect(rule.window).toBe(32_000);
    expect(rule.concurrency).toBe(6);
    expect(rule.ceilingInputTokens).toBe(2_300_000_000);
    expect(rule.worker).toBe("opencode-go/muse-spark-1.3-contributor");
    expect(rule.sampling).toMatchObject({ workerReasoningEffort: "low", workerOutput: "window" });
    expect(rule.wm.triggerTokens).toBe(3_000);
    expect(rule.product.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rule.configHashes).toEqual(liveArmHashes().configHashes);
    expect(Object.keys(rule.configHashes).sort()).toEqual([...rule.arms, ...rule.calibration.arms].sort());
    // 6 arms x 12 sessions + 2 calibration arms x 3 pilot sessions; the pilot is 6 x 3 + 6.
    expect(longJobs(rule)).toHaveLength(78);
    expect(longJobs(rule, { pilot: true })).toHaveLength(24);
  });

  test("a live row holds ids and counts only", () => {
    const row = {
      arm: "STM-only",
      session: "sbl-sc-05",
      checks: [{ session: "sbl-sc-05", task: 1, check: "t1.0.0", class: "C", bucket: "after", pass: true }],
      tasks: [],
      status: { 1: { status: "completed" } },
      meter: { main: { inputTokens: 1 } },
      configHash: "a".repeat(64),
      instrumentation: { summary: { firstOverflowTask: 57 }, dependents: [{ dep: "d1", sourceRecords: ["r1"] }] },
    };
    expect(assertLongRowHoldsNoText(row)).toBe(row);
    expect(() => assertLongRowHoldsNoText({ ...row, prompt: "x" })).toThrow(/row field prompt/);
    expect(() => assertLongRowHoldsNoText({ ...row, instrumentation: { note: "x".repeat(65) } })).toThrow(/longer than an id/);
  });
});

describe("the control guard leaves out count-errors (plan 218.5 Task 7, owner 2026-11-25)", () => {
  test("C-stable holds the C checks of every job but count-errors; C and task keep them all", async () => {
    const { CONTROL_METRIC, longUnits, NOISY_JOBS } = await import("./score.mjs");
    expect(CONTROL_METRIC).toBe("C-stable");
    expect([...NOISY_JOBS]).toEqual(["count-errors"]);
    const row = (task, job, pass) => ({ session: "s1", task, check: `t${task}.0.0`, class: "C", job, pass });
    const checks = [row(1, "count-errors", false), row(2, "close-resolved", true), row(3, "owner-assign", true)];
    const { units } = longUnits({ checks });
    expect(units.C.length).toBe(3);
    expect(units[CONTROL_METRIC].map((unit) => unit.id)).toEqual(["s1:t2.0.0", "s1:t3.0.0"]);
    expect(units.task.length).toBe(3);
  });
});
