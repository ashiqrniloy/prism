/**
 * Plan 218.1 Task 3, Step 1: the WM engagement probe (the gate before any screen spend).
 *
 * The 30 drawn retention sessions are replayed through the `WM` arm with the live memory worker, and only the
 * engagement counts and cost are kept: STM passes and events, WM passes, items per pass, `budget_unmet` passes and
 * compactions. Nothing is scored. S is discarded unread, no S reaches `seam.py`, and no annotated detail is opened,
 * so the screen's rule cannot be fitted to results already seen.
 *
 * Engagement: a session engages WM when it records at least one WM pass that writes at least one item. The branch rule
 * (owner, 2026-11-13: "15 of 30 is fine, run the WM probe"): at least 15 engaged sessions → Branch A (four-arm retention
 * screen); fewer → Branch B (reduced STM screen, M5 stays `missing`). The probe stops, and selects no branch, when its
 * input-token ceiling is hit or the worker fails on more than 3 sessions.
 *
 * The rule lives in the gate record (`owner-gate-m2.json` `compactBenchWmProbe`) and is hashed; the probe refuses to
 * start, and the verdict refuses to read, under a different rule.
 *
 * ```sh
 * bun scripts/memory-bench/external/compact-bench/wm-probe.mjs [--limit N]
 * ```
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stableHash } from "../../journal.mjs";
import { loadDrawnHistories, summarizeHistory, wmEngaged } from "./adapter.mjs";
import { COMPACT_BENCH_DRAW_FILE } from "./draw.mjs";
import { COMPACT_BENCH_PIN, compactBenchPaths, verifyCompactBenchCode } from "./fetch.mjs";

export const WM_PROBE_GATE = "docs/_evidence/memory-bench/218/gates/owner-gate-m2.json";
export const WM_PROBE_EVIDENCE = "docs/_evidence/memory-bench/218/compact-bench-wm-probe.json";
/** The pre-registered rule. Changing any field changes its hash, which the gate record pins. */
export const WM_PROBE_RULE = Object.freeze({
  suite: "compact-bench-retention",
  sessions: 30,
  arm: "WM",
  armConfig:
    "gate M-2's armMemory WM arm (stm.triggerTokens 1,000; WM defaults: triggerTokens 10,000, batchTokens 3,000); no trigger changed for the probe",
  worker: "opencode-go/muse-spark-1.3-contributor",
  engagement: "a session engages WM when it records at least one WM pass that writes at least one item",
  threshold: 15,
  branches: {
    A: "engaged >= 15: Step 2 runs the four-arm retention screen (memory-off, OM-before, STM-only, WM, plus references)",
    B: "engaged < 15: Step 2 runs the reduced STM screen (memory-off, OM-before, session, plus references); M5 stays missing; the owner decides the WM default",
  },
  stop: "the input-token ceiling is hit or the worker fails on more than 3 sessions: no branch, the finding goes to the owner",
  maxInputTokens: 8_000_000,
  maxFailedSessions: 3,
  scoring: "none: S is discarded unread and never scored",
});
export const wmProbeRuleHash = (rule = WM_PROBE_RULE) => stableHash(rule);
/** The plan's all-in Muse rate from gate M-2's wire logs (subscription billing; an estimate, not an invoice). */
const MUSE_ALL_IN_USD_PER_M_INPUT = 0.065;
/**
 * How long one session may wait for the worker to finish after the replay. A harness limit, not part of the rule: the
 * first run's 10-minute default timed out on the four largest sessions while every worker request still returned 200.
 */
export const WM_PROBE_SETTLE_MS = 2_700_000;

/** The gate record must carry the owner's approval of exactly this rule. */
export function assertWmProbeGate(gate, rule = WM_PROBE_RULE) {
  const probe = gate?.compactBenchWmProbe;
  if (!probe) throw new Error("WmProbeGate: the gate record has no compactBenchWmProbe section");
  if (probe.approved !== true || probe.approvedBy !== "owner" || typeof probe.text !== "string" || !probe.text.trim())
    throw new Error("WmProbeGate: the probe is not approved on the owner's word");
  if (probe.ruleHash !== wmProbeRuleHash(rule))
    throw new Error("WmProbeGate: the rule differs from the approved one; a changed rule is a refusal, not a re-approval");
  if (JSON.stringify(probe.rule) !== JSON.stringify(rule)) throw new Error("WmProbeGate: the recorded rule text differs");
  return probe;
}

/** The branch the probe selects: `A`, `B`, or `stop` (with the reason). */
export function wmProbeBranch({ rows, failures = 0, ceilingHit = false }, rule = WM_PROBE_RULE) {
  if (ceilingHit) return { branch: "stop", reason: "input-token ceiling hit" };
  if (failures > rule.maxFailedSessions) return { branch: "stop", reason: `worker failed on ${failures} sessions` };
  if (rows.length + failures < rule.sessions)
    return { branch: "stop", reason: `${rows.length + failures} of ${rule.sessions} sessions ran` };
  const engaged = rows.filter((row) => row.engaged).length;
  return { branch: engaged >= rule.threshold ? "A" : "B", engaged, of: rows.length };
}

/** One session's evidence row: ids and counts only. */
export function wmProbeRow(result, usage) {
  const { counts } = result;
  return {
    id: result.id,
    viewChars: counts.viewChars,
    turns: counts.turns,
    stm: counts.stm ?? null,
    wm: counts.wm
      ? { passes: counts.wm.passes, items: counts.wm.items, budgetUnmet: counts.wm.budgetUnmet, compactions: counts.wm.compactions }
      : null,
    engaged: wmEngaged(counts.wm),
    sChars: counts.sChars,
    blockChars: counts.blockChars,
    worker: usage,
  };
}

/**
 * Run the probe over `histories`. `summarize` is the adapter (injected in tests); `usageNow` returns cumulative worker
 * usage and throws `WmProbeTokenCeiling` past the ceiling; `checkpoint` resumes a session already done.
 */
export async function runWmProbe({
  histories,
  workerProviders,
  workerModel,
  summarize = summarizeHistory,
  usageNow = async () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }),
  checkpoint,
  rule = WM_PROBE_RULE,
  settleMs = WM_PROBE_SETTLE_MS,
  log = () => {},
}) {
  const rows = [];
  const failed = [];
  let ceilingHit = false;
  for (const { id, H } of histories) {
    const saved = await checkpoint?.load(id);
    if (saved) {
      rows.push(saved);
      continue;
    }
    let before;
    try {
      before = await usageNow();
      const result = await summarize({ H, track: "retention", arm: rule.arm, id, workerProviders, workerModel, settleMs });
      const after = await usageNow();
      const usage = {
        inputTokens: after.inputTokens - before.inputTokens,
        outputTokens: after.outputTokens - before.outputTokens,
        cacheReadTokens: after.cacheReadTokens - before.cacheReadTokens,
      };
      const row = wmProbeRow(result, usage);
      rows.push(row);
      await checkpoint?.save(id, row);
      log(`${id}: engaged=${row.engaged} wmPasses=${row.wm?.passes ?? 0} stmEvents=${row.stm?.events ?? 0} in=${usage.inputTokens}`);
    } catch (error) {
      if (/WmProbeTokenCeiling/.test(String(error?.message))) {
        ceilingHit = true;
        break;
      }
      // A failed session still spent worker tokens; keep them so the totals are the real spend.
      const after = await usageNow().catch(() => null);
      const worker =
        before && after
          ? {
              inputTokens: after.inputTokens - before.inputTokens,
              outputTokens: after.outputTokens - before.outputTokens,
              cacheReadTokens: after.cacheReadTokens - before.cacheReadTokens,
            }
          : null;
      failed.push({ id, error: String(error?.name ?? "Error"), message: String(error?.message ?? "").slice(0, 200), worker });
      log(`${id}: failed ${String(error?.message ?? "").slice(0, 200)}`);
      if (failed.length > rule.maxFailedSessions) break;
    }
  }
  return { rows, failed, ceilingHit, verdict: wmProbeBranch({ rows, failures: failed.length, ceilingHit }, rule) };
}

/** The evidence file: rule hash, pins, per-session counts, totals and the branch. No text. */
/** The session id as the worker's cache key carries it (the adapter's session id sanitization). */
export const wireSessionKey = (id) => id.replace(/[^A-Za-z0-9_.-]/g, "_");

export function wmProbeEvidence({ run, draw, criteriaHash, startedAt, finishedAt, wire, rule = WM_PROBE_RULE }) {
  const sum = (items) =>
    items.reduce(
      (acc, worker) => ({
        inputTokens: acc.inputTokens + (worker?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (worker?.outputTokens ?? 0),
        cacheReadTokens: acc.cacheReadTokens + (worker?.cacheReadTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    );
  const failedWorker = sum(run.failed.map((entry) => entry.worker));
  // Everything spent: the wire log of this rule's state (every attempt, failed ones included) plus finished sessions
  // carried in from an earlier log. Without a wire log, the finished and failed sessions of this run.
  const outsideLog = wire ? sum(run.rows.filter((row) => !wire.sessions.includes(wireSessionKey(row.id))).map((row) => row.worker)) : null;
  const total = run.rows.reduce(
    (sum, row) => ({
      inputTokens: sum.inputTokens + (row.worker?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (row.worker?.outputTokens ?? 0),
      cacheReadTokens: sum.cacheReadTokens + (row.worker?.cacheReadTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  );
  const engagedRows = run.rows.filter((row) => row.engaged);
  return {
    kind: "compact-bench-wm-probe-v1",
    plan: "218.1",
    task: 3,
    step: 1,
    ruleHash: wmProbeRuleHash(rule),
    rule,
    memoryModelCriteriaHash: criteriaHash,
    draw: { file: COMPACT_BENCH_DRAW_FILE, sha256: draw.sha256, retentionIdsHash: draw.retentionIdsHash },
    upstream: { codeRevision: COMPACT_BENCH_PIN.code.commit, datasetRevision: COMPACT_BENCH_PIN.dataset.revision },
    startedAt,
    finishedAt,
    verdict: run.verdict,
    summary: {
      sessions: run.rows.length,
      failed: run.failed.length,
      engaged: engagedRows.length,
      wmPasses: run.rows.reduce((n, row) => n + (row.wm?.passes ?? 0), 0),
      wmItems: run.rows.reduce((n, row) => n + (row.wm?.items ?? []).reduce((a, b) => a + b, 0), 0),
      budgetUnmet: run.rows.reduce((n, row) => n + (row.wm?.budgetUnmet ?? 0), 0),
      stmEvents: run.rows.reduce((n, row) => n + (row.stm?.events ?? 0), 0),
      engagedViewCharsMin: engagedRows.length ? Math.min(...engagedRows.map((row) => row.viewChars)) : null,
      worker: total,
      failedWorker,
      spent: wire ? sum([wire.totals, outsideLog]) : sum([total, failedWorker]),
      spentBasis: wire
        ? "the wire log of every attempt under this rule (failed and retried sessions included) plus finished sessions carried from an earlier log"
        : "finished and failed sessions of this run",
      costEstimateUsd:
        Math.round(
          (wire ? wire.totals.inputTokens + outsideLog.inputTokens : total.inputTokens + failedWorker.inputTokens) *
            MUSE_ALL_IN_USD_PER_M_INPUT,
        ) / 1_000_000,
      costBasis: `input tokens x $${MUSE_ALL_IN_USD_PER_M_INPUT} per 1M (the plan's all-in Muse rate; OpenCode Go bills a subscription)`,
    },
    failed: run.failed,
    sessions: run.rows,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const { liveProviders, loadEnv, refOf } = await import("../../run.mjs");
  const { frozenMemoryModelHash } = await import("../../robustness.mjs");
  const gate = JSON.parse(readFileSync(WM_PROBE_GATE, "utf8"));
  assertWmProbeGate(gate);
  const criteriaHash = frozenMemoryModelHash();
  const paths = compactBenchPaths(COMPACT_BENCH_PIN);
  verifyCompactBenchCode({ dir: paths.code });
  const drawText = readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8");
  const drawSha = createHash("sha256").update(drawText).digest("hex");
  if (drawSha !== gate.compactBenchWmProbe.drawSha256) throw new Error("WmProbeGate: the draw differs from the approved one");
  const draw = JSON.parse(drawText);
  const histories = loadDrawnHistories({ track: "retention", draw, dataDir: paths.data, limit: Number(flag("--limit") ?? 0) });
  loadEnv();
  const state = join(paths.root, "wm-probe", wmProbeRuleHash().slice(0, 16));
  await mkdir(join(state, "sessions"), { recursive: true, mode: 0o700 });
  const live = await liveProviders([refOf(WM_PROBE_RULE.worker)], join(state, "wire"), { maxOutputTokens: 8192 });
  const readWire = async () => {
    const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const sessions = new Set();
    for (const { proxy, usageLog } of live.proxies) {
      await proxy.drain();
      if (!existsSync(usageLog)) continue;
      for (const line of (await readFile(usageLog, "utf8")).split("\n").filter(Boolean)) {
        const row = JSON.parse(line);
        totals.inputTokens += row.inputTokens ?? 0;
        totals.outputTokens += row.outputTokens ?? 0;
        totals.cacheReadTokens += row.cacheReadTokens ?? 0;
        const key = /^memory\.session:cb-WM-(.+)$/.exec(row.cacheKey ?? "");
        if (key) sessions.add(key[1]);
      }
    }
    return { totals, sessions: [...sessions] };
  };
  const usageNow = async () => {
    const { totals } = await readWire();
    if (totals.inputTokens >= WM_PROBE_RULE.maxInputTokens) throw new Error("WmProbeTokenCeiling");
    return totals;
  };
  const checkpoint = {
    async load(id) {
      const file = join(state, "sessions", `${id}.json`);
      return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
    },
    save: (id, row) => writeFile(join(state, "sessions", `${id}.json`), JSON.stringify(row)),
  };
  const startedAt = new Date().toISOString();
  try {
    const run = await runWmProbe({
      histories,
      workerProviders: live.providers,
      workerModel: WM_PROBE_RULE.worker,
      usageNow,
      checkpoint,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    const evidence = wmProbeEvidence({
      run,
      draw: { sha256: drawSha, retentionIdsHash: draw.retention.idsHash },
      criteriaHash,
      startedAt,
      finishedAt: new Date().toISOString(),
      wire: await readWire(),
    });
    if (!flag("--limit")) await writeFile(WM_PROBE_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ verdict: evidence.verdict, summary: evidence.summary }, null, 2)}\n`);
  } finally {
    for (const { proxy } of live.proxies) proxy.stop();
  }
}
