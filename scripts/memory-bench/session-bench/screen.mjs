/**
 * Plan 218.3 Task 12: Session-Bench's decision screen (paid, on the owner's word; moved from plan 218.1 Tasks 5-6).
 *
 *   # the rule must be approved in the gate record (`sessionBenchScreen`) first; run as a systemd --user unit:
 *   bun scripts/memory-bench/session-bench/screen.mjs --live            # runs (resumes) the approved screen
 *   bun scripts/memory-bench/session-bench/screen.mjs --live --status   # check-in: rows, spend, projected total
 *   bun scripts/memory-bench/session-bench/screen.mjs --live --report   # writes the evidence and the verdict
 *   bun scripts/memory-bench/session-bench/screen.mjs --live --pause | --resume
 *   bun scripts/memory-bench/session-bench/screen.mjs --rule            # prints the rule and its hash (no call)
 *
 * The runner is Task 11's (`live.mjs`): per-(arm, session) jobs, checkpoints, quota waits, the token ceiling. This
 * module adds the screen's rule (fixed before the run, its hash in the gate record), the held-out refusal and the
 * pre-registered verdict (`screenVerdict`). It is its own entry, never imported by `live.mjs` (an entry module waiting
 * in its top-level await cannot be imported back).
 */
import { readFileSync } from "node:fs";
import { stableHash } from "../journal.mjs";
import { pairedClusterPermutation } from "../stats.mjs";
import { LOCAL_EMBEDDER } from "./arms/third-party.mjs";
import { sessionBenchPartitions, WINDOW_TOKENS } from "./generate.mjs";
import {
  assertTestGate,
  LIVE_LIMITS,
  liveConfigHashes,
  liveRoot,
  main,
  readLiveRows,
  SESSION_BENCH_TEST_GATE,
  SESSION_BENCH_TEST_RULE,
} from "./live.mjs";
import { ANALYSIS, scoreRows } from "./score.mjs";

const file = sessionBenchPartitions();
const DEPENDENCY_CLASSES = Object.freeze(["D1", "D2", "D3", "D4"]);
export const SCREEN_ARMS = Object.freeze([
  "memory-off-llm",
  "STM-only",
  "STM+WM",
  "claude-code-prompt",
  "codex-prompt",
  "mem0",
  "memory-off-drop",
]);
export const SCREEN_SIDE_ARMS = Object.freeze(["claude-code-prompt", "codex-prompt", "mem0", "memory-off-drop"]);

/** Every dev session id, in the partition file's label-blind order. */
export const devIds = (partitions = file) => Object.values(partitions.abilities.dev).flat();

/** The screen reads `dev` only: a held-out id (or any id outside dev) is refused before any job is planned. */
export function assertDevOnly(ids, partitions = file) {
  const dev = new Set(devIds(partitions));
  const heldout = new Set(["heldout-a", "heldout-b"].flatMap((part) => Object.values(partitions.abilities[part] ?? {}).flat()));
  for (const id of ids) {
    if (heldout.has(id)) throw new Error(`SessionBenchScreen: ${id} is a held-out session; the screen reads dev only (G2)`);
    if (!dev.has(id)) throw new Error(`SessionBenchScreen: ${id} is not a dev session`);
  }
  return ids;
}

/** The pre-registered screen (owner decisions 2026-11-19). Changing any field changes its hash, which the gate pins. */
export const SESSION_BENCH_SCREEN_RULE = Object.freeze({
  suite: "session-bench",
  plan: "218.3 Task 12",
  gateSection: "sessionBenchScreen",
  livePinKey: "screenLive",
  evidence: "docs/_evidence/memory-bench/218/session-bench-screen.json",
  benchmark: { version: file.version, templateHash: file.templateHash, idsHash: file.idsHash, sessionsHash: file.sessionsHash },
  partition: "dev",
  sessions: assertDevOnly(devIds(file)),
  selection: "every dev session (36: 12 per family); heldout-a and heldout-b stay unread until gate A",
  arms: [...SCREEN_ARMS],
  armsChoice:
    "owner, 2026-11-19: 36 dev sessions, all six decision and side arms; the calibration arms run on a 6-session slice only, as a gate (see calibration). Owner, 2026-11-20: a seventh arm, memory-off-drop ('no compacted summary or STM or WM'): memory-off-llm's session and cut, the dropped messages replaced by one fixed line; amnesic stays the floor (a fresh session per task)",
  model: "opencode-go/hy4-flash-free",
  worker: "opencode-go/muse-spark-1.3-contributor",
  workerChoice:
    "owner, 2026-11-20: 'pick a cheap and small model from either opencode go or ollama cloud and run the memory worker on that model. This cheap and small model should also accept low reasoning'. A replay of six captured STM requests at reasoning low and a 2,048-token output (scratchpad, counts only): gpt-oss:20b 6/6 recorded, 136-774 output tokens, 2-5 s; glm-5.3-flash 6/6; inkling-2-small 6/6; qwen3.8-flash 5/6 (up to 1,787 reasoning tokens); mimo-v2.6-flash 5/6 (one at the cap); minimax-m3.1-flash and deepseek-v4.1-flash 6/6 with 1,000-1,300 reasoning tokens on some calls. Every arm's memory workers (STM, WM, LLM compaction summaries, Mem0) run on it; the main agent stays on hy4-flash-free. Owner, 2026-11-21 ('stop the arm and rerun the whole thing. You should use Muse Spark Contributor-1.3 as the worker model. Check if it supports low thinking first'): rule aff9613b stopped at 69/264 rows when Ollama Cloud answered 429 'monthly usage limit' to every gpt-oss:20b call from about 09:30Z (STM-only sb-id-01/02/03/16 were written from fallback records alone). muse-spark-1.3-contributor on OpenCode Go: catalog effort minimal/low/medium/high/xhigh, and a live probe (scratchpad, counts only: one arithmetic task, two pairs) spent 1,147 and 1,530 output tokens at low against 2,353 and 3,045 at high, so low reaches the model",
  workerFaults:
    "owner, 2026-11-21 ('worker failure is not a valid finding and defeats the purpose of the screen entirely'): a job with any memory-worker call that failed after every retry and wait (meter.workerErrors), or any STM batch recorded without the model (meter.stmFallbacks), leaves no row and runs again from its start after the fault wait; a third worker fault of one job stops the run for the owner; a provider's usage-limit answer (402/403/429 naming a usage, credit or quota limit) is never waited out and stops the run",
  modelChoice:
    "owner, 2026-11-19, at the launch approval: \"use hy4 flash free model from opencode go instead of deepseek-v4.1-flash\"; every arm and every memory worker on it. OpenCode Go's live catalog: 1,048,576 context (983,040 input), 65,536 output, price 0 (Prism's opencode-go provider has no static row for it and falls back to 200K; the harness window W is the same for every arm either way). Task 11's live guardrails were measured on deepseek-v4.1-flash, so the calibration stage re-checks them on this model (owner, 2026-11-19)",
  sampling: { ...SESSION_BENCH_TEST_RULE.sampling, toolCallsPerTurn: 1, workerReasoningEffort: "low", workerOutput: "window" },
  workerSamplingNote:
    "owner, 2026-11-20: workerReasoningEffort low is the default of every arm's memory-worker calls that set no effort of their own (a worker's own level wins, so STM's retry with thinking off reaches the wire); workerOutput window: a worker call may write what W leaves after its input (as a provider serving a W-token model allows), the main agent keeps the 2,048-token reserve. Found 2026-11-20: on rule 1a22763d hy4-flash-free ignored low and about 90% of STM worker calls (and memory-off-llm's summary calls) spent the whole 2,048 output reasoning, so the verdict measured a broken worker",
  toolCallsPerTurnNote:
    'owner, 2026-11-19 ("Pause; harness enforces one call per round"): hy4-flash-free ignores parallel_tool_calls:false (a scratchpad diagnostic on sb-rt-11 saw main-agent turns of 2 and 4 calls, e.g. a 3K file and a 17K artifact together), and Session-Bench assumes one artifact per round. The harness runs only the first tool call of each main-agent turn and answers the others with a fixed text (DEFERRED_TOOL_CALL_TEXT), for every arm alike; memory workers keep parallel calls; the model\'s output is never changed. Rule 77d8c3d4 was paused at 79/228 rows; its screen rows are superseded',
  oracleWindow: SESSION_BENCH_TEST_RULE.oracleWindow,
  samplingModelNote:
    "thinkingLevel low is kept for equal treatment with Task 11's rule; Prism's catalog row for hy4-flash-free declares no reasoning-effort family, so the provider sends no effort and the model runs at its own default, the same for every arm",
  samplingNote: SESSION_BENCH_TEST_RULE.samplingNote,
  window: WINDOW_TOKENS,
  maxOutputTokens: SESSION_BENCH_TEST_RULE.maxOutputTokens,
  limits: { ...LIVE_LIMITS, maxToolCalls: 60, maxTurns: 60 },
  limitsNote:
    "owner, 2026-11-19 (\"Raise maxToolCalls for all arms\"): the kernel charges maxToolCalls at dispatch, so a deferred call (one tool call per turn) uses a slot; maxToolCalls goes from 30 to 60 for every arm. The smoke job of rule 14a65904 (memory-off-llm sb-rt-12) hit maxToolCalls on 2 of its 3 unfinished tasks with 7 deferred calls. maxTurns goes from 30 to 60 too (owner, 2026-11-19: 'Also raise maxTurns to 60'): one real call per turn would otherwise cap real calls at 30; the other limits are Task 11's",
  productFixes: [
    {
      date: "2026-11-19",
      package: "@arnilo/prism-memory-system",
      change: "session memory's folded observation pool is min(20,000, 30% of the input cap) tokens (was a fixed 20,000)",
      reason:
        "owner, 2026-11-19 ('Pause now and fix the STM overflow first'): rule 14de8907 paused at 84/228 rows; on the 34 sessions both arms had finished, STM-only overflowed W on 154 of 362 task runs (6% at task 1, 59% at task 8, nearly all later) and memory-off-llm on none: a 20,000-token pool plus the 20% kept tail and the prompt left a compacted request over the 80% mid-loop trigger at W = 32K",
      rerunArms: ["STM-only", "STM+WM"],
      carriedArms: ["memory-off-llm", "oracle-context", "amnesic"],
    },
    {
      date: "2026-11-19",
      package: "@arnilo/prism-memory-system",
      change:
        "an STM source batch takes at most half the worker model's input cap (a larger entry is cut with its marker); recall { query } and recall { cursor } at summary detail stay within the page bytes; a compaction reads STM coverage recorded past its snapshot as covering the snapshot; recall { entry } carries its page once (the value doubled it); harness: one tool call per main-agent turn covers memory-package tools (recall) through tool.call respond, not only the workspace tools",
      reason:
        "owner, 2026-11-19 ('Run the diagnostic', then 'Go ahead and fix it'): rule 59864e7c's early check (41/63 STM-only task runs over W) and a counts-only diagnostic of sb-sc-18 showed (1) one ~60K-character tool result sent whole to the STM worker overflowed it on every pass, so coverage never moved and every later task failed; (2) recall answers of 180K-214K characters; (3) a background STM pass in flight at a mid-loop compaction recorded coverage past the snapshot, read as none, so the compaction declined and the next request overflowed; (4) the validation of those fixes (sb-sc-18: 10/11 tasks completed, 0 worker overflows) overflowed once, on three ~33K-character recall entry pages in one turn",
      rerunArms: ["STM-only", "STM+WM"],
      carriedArms: ["memory-off-llm", "oracle-context", "amnesic"],
    },
    {
      date: "2026-11-20",
      package: "@arnilo/prism-memory-system",
      change:
        "an STM source batch keeps a tool call with its results (an oversized result travels with its call, cut to fit); a background pass leaves an unanswered tool call for the next pass; a batch without the user's request carries it as context (no entry id); a record citing a tool call also cites its results; a cut recall page names how to read the entry whole",
      reason:
        "owner, 2026-11-20 ('investigate the reasons', then 'Do the proposed fixes'): rule 1a22763d finished with STM-only at 187/384 tasks against memory-off-llm's 206/384; a paired diagnostic (sb-rt-11, sb-sc-18, counts only) showed STM batches that split a call from its output, background passes run before the output existed, and batches that never showed the request they served",
      rerunArms: [...SCREEN_ARMS],
      carriedArms: [],
    },
    {
      date: "2026-11-20",
      package: "@arnilo/prism-memory-system",
      change:
        "an STM pass whose model ends at its output cap before any call is asked once more with thinking off; a second miss records the batch without the model (one bounded event per request, assistant text and tool call, marked fallback output_cap, citing the entries); a compaction's coverage pass whose model fails records the batch the same way (fallback worker_error) instead of declining",
      reason:
        "owner, 2026-11-20 ('How can we fix this?', then 'Build all three'): a worker model that ignores a low reasoning setting left STM with nothing recorded and the window full; the product must hold whatever the host's worker model does. The harness reports each row's fallback count (meter.stmFallbacks)",
      rerunArms: [...SCREEN_ARMS],
      carriedArms: [],
    },
  ],
  rerun:
    "owner, 2026-11-20 ('setup the new rule and launch it'): every arm and the calibration slice re-run under this rule; no row of rule 1a22763d is carried (the worker model, its effort and its output changed for every arm). Owner, 2026-11-21 ('rerun the whole thing'): no row of rule aff9613b is carried either (the worker model changed for every arm)",
  embedder: JSON.parse(JSON.stringify(LOCAL_EMBEDDER)),
  embedderChoice:
    'owner, 2026-11-19: a local embedder, recorded as a G10 deviation (Gemini\'s free tier caps at 1,000 requests a day); then "I want BGE-M3 for retrieval quality": BGE-M3 on the GPU through llama.cpp/Vulkan',
  concurrency: 6,
  ceilingInputTokens: 1_200_000_000,
  ceilingBasis:
    "input tokens (cached included) across every usage log under the run's wire directory; no new job starts at or above it, jobs in flight finish; Task 11 projected about 520M for this screen; owner, 2026-11-19 ('Raise ceiling to 1.2B now'): one tool call per turn re-sends the context more often (the smoke job used 2.44M input, 0.88M before) and rule 14a65904 projected 616M of 650M after its smoke job",
  faults: SESSION_BENCH_TEST_RULE.faults,
  smokeOutcomes: ["ERR_PRISM_RUN_LIMIT", "context_overflow"],
  smokeOutcomesNote:
    "2026-11-19, from the paused smoke on hy4 (sb-rt-12: task 7 maxToolCalls, task 8 context_overflow, 0 provider errors): a window overflow is memory-off-llm's scored outcome (Task 11 finding 1: LLM compaction does not recover after an over-window turn), not a harness failure",
  calibration: {
    arms: ["oracle-context", "amnesic"],
    sessions: [...SESSION_BENCH_TEST_RULE.sessions],
    selection: "Task 11's slice (the first two dev sessions of each family), so the reading compares with Task 11's on deepseek-v4.1-flash",
    choice: "owner, 2026-11-19: re-check solvability and dependency reality on hy4-flash-free before the screen",
  },
  liveGuardrails: { ...SESSION_BENCH_TEST_RULE.liveGuardrails },
  order: [
    "smoke: memory-off-llm on the smallest dev session, alone; it must finish with no fault, no provider error and no task failed for a reason other than an outcome the arm owns (smokeOutcomes); a miss or a projected total over the ceiling stops the run for the owner",
    "calibration: oracle-context and amnesic on the 6-session calibration slice; the live guardrails must hold before the other screen jobs start; a miss stops the run for the owner",
    "the rest: memory-off-llm, STM-only, STM+WM, claude-code-prompt, codex-prompt, mem0 on every dev session",
  ],
  checkins: SESSION_BENCH_TEST_RULE.checkins,
  analysis: {
    unit: "per check (dependency) or per task (task, control), paired by id; sessions are the clusters",
    statistic: ANALYSIS.statistic,
    iterations: ANALYSIS.iterations,
    seed: ANALYSIS.seed,
    dependency: "D1-D4 checks pooled (Session-Bench v3: the D4 check requires the new value only)",
    control: "C checks",
    reported:
      "every arm's scores, the pre-registered comparisons (score.mjs ANALYSIS), each decision arm against each side arm (sideComparisons) with the same statistic, cost per passed task, and the effect detectable at N",
  },
  decision: {
    stm: {
      comparison: ["memory-off-llm", "STM-only"],
      text: "STM is worth shipping if STM-only beats memory-off-llm on dependency checks (95% interval lower bound > 0) and is not worse on control checks (lower bound of the C difference > -0.05)",
      dependencyLowerAbove: 0,
      controlLowerAbove: -0.05,
    },
    wm: {
      comparison: ["STM-only", "STM+WM"],
      text: "WM's model policy is the default under a host scope only if STM+WM beats STM-only on dependency checks (lower bound > 0) and its whole-run input tokens per passed task are at most 1.5x STM-only's; otherwise the deterministic policy is the default (without a scope the session is STM-only)",
      dependencyLowerAbove: 0,
      maxCostRatio: 1.5,
      cost: "whole-run input tokens (main + workers + embeddings, cached included) / tasks passed",
      costChoice: "owner, 2026-11-19: at most 1.5x STM-only",
    },
    side: "a Prism decision arm below a side arm (the side arm's 95% interval of the difference entirely above 0 on task or dependency checks) goes to the owner as a finding",
  },
  detectable: {
    method: "(z_0.975 + z_0.8) x sd of per-session paired dependency-rate differences / sqrt(N), from this run's sessions",
    task11: "at N = 36, about 23 points (memory-off-llm -> STM-only) and 8-12 points (STM-only -> STM+WM), from Task 11's 6 sessions",
  },
});
export const screenRuleHash = (rule = SESSION_BENCH_SCREEN_RULE) => stableHash(rule);

/** The gate must approve exactly this rule; the live pins (G6) must be the rule's; the sessions must be dev. */
export function assertScreenGate(gate, rule = SESSION_BENCH_SCREEN_RULE) {
  assertDevOnly(rule.sessions);
  if (rule.calibration) assertDevOnly(rule.calibration.sessions);
  const section = assertTestGate(gate, rule);
  const pinned = gate.sessionBench;
  if (pinned.templateHash !== rule.benchmark.templateHash || pinned.idsHash !== rule.benchmark.idsHash)
    throw new Error("SessionBenchScreen: sessionBench does not pin the rule's benchmark (G1)");
  return section;
}

const inputOf = (cost) => cost.main.inputTokens + cost.workers.inputTokens + cost.embeddings.inputTokens;
const Z = 1.959963984540054 + 0.8416212335729143;
const sdOf = (values) => {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

/** Units for one arm: pooled dependency checks and control checks, from the report's per-arm unit lists. */
function armUnits(report, arm) {
  const units = report.units?.[arm];
  if (!units) return null;
  return { dependency: DEPENDENCY_CLASSES.flatMap((cls) => units[cls] ?? []), control: units.C ?? [], task: units.task ?? [] };
}

/** One pre-registered comparison: pooled dependency, control and task differences, with the detectable effect. */
export function compareForScreen(report, [a, b], { iterations = ANALYSIS.iterations, seed = ANALYSIS.seed } = {}) {
  const fullLeft = armUnits(report, a);
  const fullRight = armUnits(report, b);
  if (!fullLeft || !fullRight) return { a, b, status: "not-run" };
  // Paired on the sessions both arms finished (a run read mid-way has arms at different counts).
  const shared = new Set(fullLeft.task.map((unit) => unit.cluster).filter((id) => fullRight.task.some((unit) => unit.cluster === id)));
  if (!shared.size) return { a, b, status: "not-run" };
  const only = (units) => Object.fromEntries(Object.entries(units).map(([key, list]) => [key, list.filter((u) => shared.has(u.cluster))]));
  const left = only(fullLeft);
  const right = only(fullRight);
  const stat = (metric) =>
    left[metric].length ? { n: left[metric].length, ...pairedClusterPermutation(left[metric], right[metric], { iterations, seed }) } : null;
  const sessionRate = (units) => {
    const by = {};
    for (const unit of units) {
      const row = (by[unit.cluster] ??= { pass: 0, total: 0 });
      row.total++;
      row.pass += unit.value;
    }
    return by;
  };
  const l = sessionRate(left.dependency);
  const r = sessionRate(right.dependency);
  const diffs = Object.keys(l)
    .filter((id) => r[id])
    .map((id) => r[id].pass / r[id].total - l[id].pass / l[id].total);
  const sd = sdOf(diffs);
  return {
    a,
    b,
    status: "compared",
    dependency: stat("dependency"),
    control: stat("control"),
    task: stat("task"),
    sessions: diffs.length,
    detectableEffect: sd === null ? null : (Z * sd) / Math.sqrt(diffs.length),
  };
}

/** Whole-run input tokens per passed task, per arm (the WM cost bar). */
export function costPerPassedTask(report, arm) {
  const cost = report.cost?.[arm];
  const passed = report.scores?.[arm]?.overall?.tasksPassed;
  if (!cost || !passed) return null;
  return inputOf(cost) / passed;
}

/**
 * The verdict from the rule (pure: synthetic reports test every branch). `report.units[arm]` holds each arm's paired
 * units (`scoreRows(...).units`), `report.scores` and `report.cost` the run's totals.
 */
export function screenVerdict(report, rule = SESSION_BENCH_SCREEN_RULE) {
  const { stm, wm } = rule.decision;
  const stmRow = compareForScreen(report, stm.comparison);
  const wmRow = compareForScreen(report, wm.comparison);
  const lower = (row, metric) => row?.[metric]?.ci95?.[0];
  const stmShip =
    stmRow.status === "compared" &&
    lower(stmRow, "dependency") > stm.dependencyLowerAbove &&
    lower(stmRow, "control") > stm.controlLowerAbove;
  const stmCost = costPerPassedTask(report, "STM-only");
  const wmCost = costPerPassedTask(report, "STM+WM");
  const costRatio = stmCost && wmCost ? wmCost / stmCost : null;
  const wmBeats = wmRow.status === "compared" && lower(wmRow, "dependency") > wm.dependencyLowerAbove;
  const wmDefault = wmBeats && costRatio !== null && costRatio <= wm.maxCostRatio;
  const side = [];
  for (const prism of ["memory-off-llm", "STM-only", "STM+WM"])
    for (const other of SCREEN_SIDE_ARMS) {
      const row = compareForScreen(report, [prism, other]);
      if (row.status !== "compared") {
        side.push({ prism, side: other, status: "not-run" });
        continue;
      }
      const below = ["task", "dependency"].filter((metric) => lower(row, metric) > 0);
      side.push({ prism, side: other, status: "compared", task: row.task, dependency: row.dependency, prismBelow: below });
    }
  const findings = side
    .filter((row) => row.prismBelow?.length)
    .map((row) => `${row.prism} below ${row.side} on ${row.prismBelow.join(", ")}`);
  return {
    ruleHash: screenRuleHash(rule),
    stm: { ...stmRow, ship: stmShip, rule: stm.text },
    wm: {
      ...wmRow,
      beats: wmBeats,
      costPerPassedTask: { "STM-only": stmCost, "STM+WM": wmCost },
      costRatio,
      default: wmDefault,
      rule: wm.text,
    },
    side,
    findings,
    summary: {
      stm: stmShip ? "ship" : "not shown",
      wmPolicy: wmDefault ? "model" : "deterministic",
      findings: findings.length,
    },
  };
}

/** Each arm's paired units from checkpoint rows, scored blind (G7: the scorer never sees the arm). */
export function unitsFromRows(rows) {
  const byArm = {};
  for (const row of rows) {
    const own = (byArm[row.arm] ??= { checks: [], tasks: [] });
    own.checks.push(...row.checks);
    own.tasks.push(...row.tasks);
  }
  return Object.fromEntries(Object.entries(byArm).map(([arm, own]) => [arm, scoreRows(own).units]));
}

/** `extendReport` for the runner: the verdict over the run's checkpoint rows, added to Task 11's report shape. */
export function withVerdict(report, rule = SESSION_BENCH_SCREEN_RULE, rows = readLiveRows(liveRoot(rule))) {
  return { ...report, verdict: screenVerdict({ ...report, units: unitsFromRows(rows) }, rule) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--rule"))
    console.log(
      JSON.stringify(
        { ruleHash: screenRuleHash(), rule: SESSION_BENCH_SCREEN_RULE, live: liveConfigHashes(SESSION_BENCH_SCREEN_RULE) },
        null,
        2,
      ),
    );
  else if (argv.includes("--live")) {
    assertScreenGate(JSON.parse(readFileSync(SESSION_BENCH_TEST_GATE, "utf8")));
    await main(argv, { rule: SESSION_BENCH_SCREEN_RULE, extendReport: withVerdict });
  } else {
    console.error("screen.mjs: --rule | --live [--status | --report | --pause | --resume]");
    process.exit(2);
  }
}
