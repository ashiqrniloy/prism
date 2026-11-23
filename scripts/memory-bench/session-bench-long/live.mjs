/**
 * Plan 218.5 Tasks 6–8: the long bench's frozen rule and its live runner (paid, on the owner's word).
 *
 *   bun scripts/memory-bench/session-bench-long/live.mjs --rule                  # the rule and its hash (no call)
 *   bun scripts/memory-bench/session-bench-long/live.mjs --write-gate            # writes the rule to the gate, unapproved
 *   # the gate's `sessionBenchLong` must approve the rule's hash on the owner's word first; run as a systemd --user unit:
 *   bun scripts/memory-bench/session-bench-long/live.mjs --live --pilot          # Task 7: smoke, calibration, 3 sessions
 *   bun scripts/memory-bench/session-bench-long/live.mjs --live                  # Task 8: the pilot, then the other 9
 *   bun scripts/memory-bench/session-bench-long/live.mjs --live --status | --report [--pilot] | --pause | --resume
 *
 * Session-Bench v3's live helpers (`../session-bench/live.mjs`: quota waits, stall guard, one call per turn, fault and
 * stop classes, pause files) are imported, never edited; the job, the rows, the report and the stages are the long
 * bench's. A row holds ids, counts and hashes only; each memory-system row's session ledger is kept in the run root
 * (`ledgers/`), never in evidence.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, wireUsage } from "../external/loca-bench/pilot.mjs";
import { stableHash } from "../journal.mjs";
import { configHash } from "../session-bench/arms/prism.mjs";
import { LOCAL_EMBEDDER, localEmbedder, localEmbedderStatus, mem0Status } from "../session-bench/arms/third-party.mjs";
import {
  faultedTasks,
  haltReason,
  isPaused,
  LIVE_LIMITS,
  pauseFile,
  quotaWaitFetch,
  SessionBenchIncomplete,
  SessionBenchPaused,
  SessionBenchProviderFault,
  SessionBenchStop,
  SessionBenchWorkerFault,
  serialToolCallsFetch,
  stallGuardFetch,
  WORKER_FAULT_LIMIT,
  workerFailure,
} from "../session-bench/live.mjs";
import { accumulateArm, emptyArmTotals, MAX_OUTPUT_TOKENS, sharedConfig } from "../session-bench/run.mjs";
import {
  assertLongEqualTreatment,
  LONG_CALIBRATION_ARMS,
  LONG_DECISION_ARMS,
  LONG_SIDE_ARMS,
  longArmConfig,
  MEMORY_SYSTEM_ARMS,
  WM_TRIGGER_TOKENS,
} from "./arms.mjs";
import { createSession, partitionIds, sessionBenchLongPartitions, sessionSizes, WINDOW_TOKENS } from "./generate.mjs";
import { LIVE_GUARDRAILS, LONG_GATE_FILE, liveLongGuardrails } from "./guardrails.mjs";
import { firstAfterTask } from "./instrument.mjs";
import { longReport, runLongArmSession } from "./run.mjs";
import { ANALYSIS_LONG, compareLong, LONG_DECISION, longUnits, longVerdict } from "./score.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const file = sessionBenchLongPartitions();

/** The memory system's product source (tests excluded): the rule pins its hash, so a product edit is a new rule. */
export const PRODUCT_DIR = "packages/memory/system/src";
/** The harness files the run executes beyond the frozen core (`templateHash`): an edit to any is a new rule. */
export const HARNESS_FILES = Object.freeze([
  "scripts/memory-bench/session-bench-long/agents.mjs",
  "scripts/memory-bench/session-bench-long/arms.mjs",
  "scripts/memory-bench/session-bench-long/guardrails.mjs",
  "scripts/memory-bench/session-bench-long/instrument.mjs",
  "scripts/memory-bench/session-bench-long/live.mjs",
  "scripts/memory-bench/session-bench-long/run.mjs",
  "scripts/memory-bench/session-bench-long/score.mjs",
  "scripts/memory-bench/session-bench/arms/prism.mjs",
  "scripts/memory-bench/session-bench/arms/third-party.mjs",
  "scripts/memory-bench/session-bench/live.mjs",
  "scripts/memory-bench/session-bench/run.mjs",
  "scripts/memory-bench/session-bench/score.mjs",
  "scripts/memory-bench/run.mjs",
  "scripts/memory-bench/stats.mjs",
]);

/** sha256 over `path:sha256(content)` lines, path-sorted. */
export function filesHash(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort())
    hash.update(
      `${path}:${createHash("sha256")
        .update(readFileSync(join(REPO, path)))
        .digest("hex")}\n`,
    );
  return hash.digest("hex");
}
export function productFiles(dir = PRODUCT_DIR) {
  return readdirSync(join(REPO, dir), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(".ts") && !path.split("/").includes("__tests__"))
    .map((path) => relative(REPO, join(REPO, dir, path)))
    .sort();
}

/** The dev sessions, and the pilot's: the first dev session of each family in the partition file's label-blind order. */
export const devIds = (partitions = file) => partitionIds(partitions, "dev");
export const pilotIds = (partitions = file) => Object.values(partitions.abilities.dev).map((list) => list[0]);
/** The decision and side arms: every session. The calibration arms: the pilot sessions only. */
export const LONG_RUN_ARMS = Object.freeze([...LONG_DECISION_ARMS, ...LONG_SIDE_ARMS]);

const MODEL = "opencode-go/hy4-flash-free";
const WORKER = "opencode-go/muse-spark-1.3-contributor";
const SAMPLING = Object.freeze({
  temperature: 0,
  thinkingLevel: "low",
  parallelToolCalls: false,
  toolCallsPerTurn: 1,
  workerReasoningEffort: "low",
  workerOutput: "window",
});
const LIMITS = Object.freeze({ ...LIVE_LIMITS, maxToolCalls: 60, maxTurns: 60 });

/** The live shared config (G6) for a rule's model, sampling, window and limits. */
function liveShared({ model, sampling, window, limits }) {
  const [provider, ...rest] = model.split("/");
  return sharedConfig({ model: { provider, model: rest.join("/") }, window, limits, ...sampling });
}
/** Each arm's config hash on the live model, and the shared hash the decision and side arms hold in common (G6). */
export function liveArmHashes({ model = MODEL, sampling = SAMPLING, window = WINDOW_TOKENS, limits = LIMITS } = {}) {
  const shared = liveShared({ model, sampling, window, limits });
  const configs = [...LONG_RUN_ARMS, ...LONG_CALIBRATION_ARMS].map((arm) => longArmConfig(arm, shared));
  return {
    configHashes: Object.fromEntries(configs.map((config) => [config.arm, configHash(config)])),
    sharedConfigHash: assertLongEqualTreatment(configs),
  };
}

/** The pre-registered long run (plan 218.5 Task 6). Changing any field changes its hash, which the gate must approve. */
export function buildLongRule() {
  const product = productFiles();
  return {
    suite: "session-bench-long",
    plan: "218.5 Task 6",
    gateSection: "sessionBenchLong",
    evidence: {
      pilot: "docs/_evidence/memory-bench/218.5/session-bench-long-pilot.json",
      run: "docs/_evidence/memory-bench/218.5/session-bench-long.json",
    },
    benchmark: {
      version: file.version,
      seed: file.seed,
      templateHash: file.templateHash,
      sessionsHash: file.sessionsHash,
      scopesHash: file.scopesHash,
      idsHash: file.idsHash,
    },
    product: {
      package: "@arnilo/prism-memory-system",
      dir: PRODUCT_DIR,
      files: product.length,
      hash: filesHash(product),
      note: "the package's src after plan 218.5 Tasks 1 and 3 (tests excluded); the kernel and providers are the tree's at the run",
    },
    harness: { files: [...HARNESS_FILES], hash: filesHash(HARNESS_FILES) },
    partition: "dev",
    sessions: devIds(),
    pilotSessions: pilotIds(),
    selection:
      "every dev session (12: 4 per family; owner, Task 2); heldout-a and heldout-b stay unread. The pilot is the first dev session of each family in the label-blind order",
    arms: [...LONG_RUN_ARMS],
    decisionArms: [...LONG_DECISION_ARMS],
    sideArms: [...LONG_SIDE_ARMS],
    armsNote:
      "each arm differs only in `memory` (arms.mjs). STM-only: the 0.14.0 defaults (WM off) with Task 1's fixes, context.eviction relevance; STM-only-protect: protect-user; STM+WM: WM on, model policy, each phase's scope through memory:scope; STM+WM-deterministic: the same, deterministic policy; mem0: the side arm (owner, Task 2), reported beside the decision arms and never read by the verdict",
    calibration: {
      arms: [...LONG_CALIBRATION_ARMS],
      sessions: pilotIds(),
      text: "amnesic (the floor: a fresh session per task) and oracle-notes (the ceiling: memory-off-llm plus every dependency's current evidence) on the 3 pilot sessions",
    },
    ...liveArmHashes(),
    wm: {
      triggerTokens: WM_TRIGGER_TOKENS,
      text: "both WM arms pin wm.triggerTokens 3,000 (one wm.batchTokens batch per pass; Task 3 finding 1). At the product default 10,000 WM's first pass comes at about task 89, after the pool overflows at about task 53. Offline (Task 5) the first pass comes at task 33-34, 2-4 passes per session. Live G11 applies to the STM arms only; the WM arms report their first pass and whether the pool overflowed",
    },
    rehearsal:
      "no arm runs the Rehearsal drop: the memory system turns it on only when wm and ltm are both on, and no arm turns ltm on (Task 5 finding 1); the rows count the drops (0 expected)",
    model: MODEL,
    worker: WORKER,
    modelChoice:
      "the screen's models (rule a1c6df8d, plan 218.3 Task 12): the main agent on hy4-flash-free, every memory worker (STM, WM, LLM-compaction summaries, Mem0) on muse-spark-1.3-contributor at reasoning low; the same worker serves every arm",
    sampling: { ...SAMPLING },
    samplingNote:
      "the screen's: temperature 0; the agent at thinkingLevel low; one tool call per main-agent turn (the harness answers the others with a fixed text); workerReasoningEffort low; workerOutput window (a worker call may write what W leaves after its input)",
    window: WINDOW_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    limits: { ...LIMITS },
    limitsNote: "the screen's live limits: maxToolCalls and maxTurns 60 for every arm",
    embedder: JSON.parse(JSON.stringify(LOCAL_EMBEDDER)),
    embedderNote: "mem0's embedder is the screen's: BGE-M3 on llama.cpp (Vulkan), local",
    concurrency: 6,
    ceilingInputTokens: 2_300_000_000,
    ceilingBasis:
      "owner, Task 2: 2.3B input tokens (cached included) across every usage log under the run's wire directory, for the pilot and the full run under one hash; no new job starts at or above it, jobs in flight finish",
    faults:
      "the screen's: a 429/5xx/transport answer that outlasts the patient retries waits 15 minutes inside the request and is sent again (quota waits never fail a task); a job a provider error still reaches is a fault: no row, wait 15 minutes, the session runs again from its start. Task 7 (owner, 2026-11-23: the run must survive model call failures and an internet outage): a job whose provider setup fails for any reason but a credential, model or provider error (the catalog fetch timing out, the network down) is a provider fault too, never a dropped job; a stage that ends with a job missing is a restart (exit 6, the unit restarts and resumes from the rows), never a guardrail read off missing rows",
    workerFaults:
      "the screen's (owner, 2026-11-21): a job with any memory-worker call that failed after every retry (meter.workerErrors), or any STM batch recorded without the model (meter.stmFallbacks), leaves no row and runs again; a job's third worker fault, or a provider's usage-limit answer, halts the run with STOP: for the owner. workerAborts are not faults",
    overflow:
      "the harness rejects a request over W's input cap as a provider would (context_overflow). That is the arm's scored outcome, as in the screen (the task fails, the row stays, meter.overflows counts it); it is not a fault, because a rerun would meet the same block and reach the third-fault stop. The pilot's live guardrail allows no overflow on any row (Task 7: a miss stops the run, the fix is a new hash). Task 5 finding 2: the WM arms' block is not bounded by the pool (16,217 rendered tokens offline, a worst request near 98.5% of the cap), so a WM arm can overflow where the STM arms do not",
    smokeOutcomes: ["ERR_PRISM_RUN_LIMIT", "context_overflow"],
    liveGuardrails: { ...LIVE_GUARDRAILS, amnesicFailRateMin: { ...LIVE_GUARDRAILS.amnesicFailRateMin } },
    order: [
      "pre-run: the offline guardrails G1-G11 pass with nothing pending (guardrails.mjs); the gate approves this hash",
      "smoke: memory-off-llm on the smallest pilot session, alone; no fault, no provider error, no task failed outside the arm's outcomes, and a projected total within the ceiling; a miss stops the run",
      "calibration: amnesic and oracle-notes on the pilot sessions; oracle-notes passes >= 60% of tasks and amnesic fails >= 70% of D2, D4 and D2R, or the run stops",
      "pilot: the decision arms and mem0 on the pilot sessions; then live G11 (STM-only's pool overflows before the first after dependent in >= 2 of 3) and no overflow on any row, or the run stops (Task 7)",
      "the rest (Task 8, on the owner's word): the decision arms and mem0 on the other 9 dev sessions; the pilot's rows count",
    ],
    checkins: "every 30 minutes and after every job: rows done, input tokens spent, projected total",
    instrumentation:
      "each memory-system row carries, per task, block tokens (rendered and description), active STM tokens, fullFold, records left out by relevance and how many were durable or user statements, Rehearsal drops, WM items, tombstones and passes; per dependent, whether its sources' records were in the block (ids only)",
    analysis: JSON.parse(JSON.stringify(ANALYSIS_LONG)),
    decision: JSON.parse(JSON.stringify(LONG_DECISION)),
  };
}

export const SESSION_BENCH_LONG_RULE = Object.freeze(buildLongRule());
export const longRuleHash = (rule = SESSION_BENCH_LONG_RULE) => stableHash(rule);

/** The gate must approve exactly this rule on the owner's word; a changed rule is a refusal, not a re-approval. */
export function assertLongGate(gate, rule = SESSION_BENCH_LONG_RULE) {
  const section = gate?.[rule.gateSection];
  if (!section) throw new Error(`SessionBenchLongLive: the gate record has no ${rule.gateSection} section`);
  if (
    section.approved !== true ||
    section.approvedBy !== "owner" ||
    typeof section.text !== "string" ||
    !section.text.trim() ||
    typeof section.approvedAt !== "string" ||
    !section.approvedAt
  )
    throw new Error(`SessionBenchLongLive: ${rule.gateSection} is not approved on the owner's word`);
  if (section.ruleHash !== longRuleHash(rule) || stableHash(section.rule) !== longRuleHash(rule))
    throw new Error("SessionBenchLongLive: the rule differs from the approved one (its hash is not the gate's)");
  for (const id of [...rule.sessions, ...rule.pilotSessions])
    if (!devIds().includes(id)) throw new Error(`SessionBenchLongLive: ${id} is not a dev session (G2)`);
  return section;
}

/** `--write-gate`: the rule and its hash in the gate record, unapproved; every other section stays as it is. */
export function writeGate(path = LONG_GATE_FILE, rule = SESSION_BENCH_LONG_RULE) {
  const gate = JSON.parse(readFileSync(path, "utf8"));
  gate[rule.gateSection] = {
    benchmark: { ...rule.benchmark },
    ruleHash: longRuleHash(rule),
    rule,
    approved: false,
    approvedBy: "",
    approvedAt: "",
    text: "",
    pending:
      "the owner's word on this hash (plan 218.5 Task 7). Owner calls folded into the rule as recommended: wm.triggerTokens 3,000; after pools D1-D4, D2R its own metric; a W overflow is the arm's scored outcome",
  };
  writeFileSync(path, `${JSON.stringify(gate, null, 2)}\n`);
  return gate[rule.gateSection];
}

// --- rows ------------------------------------------------------------------------------------------------------------

export const liveRoot = (rule = SESSION_BENCH_LONG_RULE, env = process.env) =>
  join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "session-bench-long", "live", longRuleHash(rule).slice(0, 16));
const safe = (arm) => arm.replace(/[^A-Za-z0-9._-]/g, "_");
const rowFile = (root, arm, session) => join(root, "rows", safe(arm), `${session}.json`);
const progressFile = (root, arm, session) => join(root, "progress", safe(arm), `${session}.json`);
const ledgerFile = (root, arm, session) => join(root, "ledgers", safe(arm), `${session}.ledger.json`);

const ROW_FIELDS = [
  "arm",
  "session",
  "checks",
  "tasks",
  "status",
  "meter",
  "configHash",
  "instrumentation",
  "wallMs",
  "quotaWaitMs",
  "quotaWaits",
  "finishedAt",
];
const CHECK_FIELDS = ["session", "task", "check", "class", "dep", "bucket", "pass"];
const MAX_ROW_STRING = 64;
const strings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) strings([key, item], out);
  return out;
};
/** A row holds ids, counts and hashes only: known fields, and no string longer than an id anywhere in it. */
export function assertLongRowHoldsNoText(row) {
  for (const key of Object.keys(row))
    if (!ROW_FIELDS.includes(key)) throw new Error(`SessionBenchLongLive: row field ${key} is not allowed`);
  for (const check of row.checks)
    for (const key of Object.keys(check)) if (!CHECK_FIELDS.includes(key)) throw new Error(`SessionBenchLongLive: check field ${key}`);
  for (const text of strings(row))
    if (text.length > MAX_ROW_STRING) throw new Error("SessionBenchLongLive: a row holds a string longer than an id (text?)");
  return row;
}
export function readLongRows(root) {
  const dir = join(root, "rows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => assertLongRowHoldsNoText(JSON.parse(readFileSync(join(dir, entry), "utf8"))));
}

/** One (arm, session) on the live models: progress after each task, the ledger in the run root, a row at the end. */
export async function runLongLiveJob({ root, rule, arm, sessionId, embedder, log }) {
  const { liveProviders, refOf } = await import("../run.mjs");
  const ref = refOf(rule.model);
  const workerRef = refOf(rule.worker);
  const clock = { waits: 0, waitMs: 0 };
  const wire = join(root, "wire", safe(arm), sessionId);
  mkdirSync(wire, { recursive: true, mode: 0o700 });
  let live;
  try {
    live = await liveProviders([ref, workerRef], wire, {
      maxOutputTokens: rule.maxOutputTokens,
      patient: true,
      wrapFetch: (base) =>
        quotaWaitFetch(stallGuardFetch(serialToolCallsFetch(base)), { clock, log: (line) => log(`${arm} ${sessionId}: ${line}`) }),
    });
  } catch (error) {
    // A setup error (credential, model, provider) fails the same way again. Anything else at setup (the catalog fetch
    // timing out or the network down) is a provider fault: no row, wait 15 minutes, start the job again, never dropped.
    if (/^MemoryBench/.test(error?.message ?? "")) throw new SessionBenchStop(`${arm} ${sessionId}: ${error.message}`);
    throw new SessionBenchProviderFault(
      `${arm} ${sessionId}: provider setup failed (${error?.name ?? "Error"}: ${error?.message ?? error})`,
    );
  }
  const session = createSession(sessionId);
  const started = performance.now();
  let result;
  try {
    result = await runLongArmSession({
      session,
      arm,
      providers: () => live.providers,
      model: live.models.get(rule.model),
      workerModel: rule.worker,
      workerSpec: live.models.get(rule.worker),
      window: rule.window,
      temperature: rule.sampling.temperature,
      thinkingLevel: rule.sampling.thinkingLevel,
      limits: rule.limits,
      embedder,
      parallelToolCalls: rule.sampling.parallelToolCalls,
      toolCallsPerTurn: rule.sampling.toolCallsPerTurn,
      workerReasoningEffort: rule.sampling.workerReasoningEffort,
      workerOutput: rule.sampling.workerOutput,
      onTask: ({ task, of, status, meter, pressure }) => {
        const path = progressFile(root, arm, sessionId);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(
          path,
          `${JSON.stringify({ arm, session: sessionId, task, of, status, meter, pressure, quotaWaitMs: clock.waitMs })}\n`,
        );
      },
      inspect: MEMORY_SYSTEM_ARMS.includes(arm)
        ? async ({ store, sessionIds }) => {
            const path = ledgerFile(root, arm, sessionId);
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            const stored = {};
            for (const id of sessionIds) stored[id] = await store.list(id);
            writeFileSync(path, JSON.stringify(stored));
            chmodSync(path, 0o600);
          }
        : undefined,
    });
  } finally {
    for (const { proxy } of live.proxies) {
      let timer;
      const drained = await Promise.race([
        proxy.drain().then(() => true),
        new Promise((done) => {
          timer = setTimeout(() => done(false), 60_000);
        }),
      ]);
      clearTimeout(timer);
      if (!drained) log(`${arm} ${sessionId}: the wire proxy did not drain in 60 s; usage of that exchange is unlogged`);
      proxy.stop();
    }
  }
  if (clock.usageLimit) throw new SessionBenchStop(`${arm} ${sessionId}: a provider answered ${clock.usageLimit} with a usage limit`);
  if (result.configHash !== rule.configHashes[arm])
    throw new SessionBenchStop(`${arm} ${sessionId}: the run's config hash is not the rule's (G6)`);
  const worker = workerFailure(result.meter);
  if (worker) throw new SessionBenchWorkerFault(`${arm} ${sessionId}: ${worker}`);
  const faulted = faultedTasks(result.status);
  if (faulted.length)
    throw new SessionBenchProviderFault(
      `${arm} ${sessionId}: ${result.meter.providerErrors} provider errors, ${faulted.length} tasks failed outside the arm's outcomes (${[...new Set(faulted.map((row) => row.code ?? row.status))].join(", ")})`,
    );
  if (clock.waitMs > 0 && Object.values(result.status).some((row) => row.code === "ERR_PRISM_RUN_LIMIT"))
    throw new SessionBenchProviderFault(`${arm} ${sessionId}: a run limit after quota waits`);
  const row = assertLongRowHoldsNoText({
    arm,
    session: sessionId,
    checks: result.checks,
    tasks: result.tasks,
    status: result.status,
    meter: result.meter,
    configHash: result.configHash,
    instrumentation: result.instrumentation,
    wallMs: Math.round(performance.now() - started - clock.waitMs),
    quotaWaitMs: clock.waitMs,
    quotaWaits: clock.waits,
    finishedAt: new Date().toISOString(),
  });
  const path = rowFile(root, arm, sessionId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

// --- report ----------------------------------------------------------------------------------------------------------

const inputOf = (meter) => meter.main.inputTokens + meter.workers.inputTokens + meter.embeddings.inputTokens;

/** The jobs of a stage set: `{ arm, session }` for the rule's arms on `sessions`, plus the calibration arms. */
export function longJobs(rule, { pilot = false } = {}) {
  const sessions = pilot ? rule.pilotSessions : rule.sessions;
  return [
    ...rule.calibration.arms.flatMap((arm) => rule.calibration.sessions.map((session) => ({ arm, session }))),
    ...rule.arms.flatMap((arm) => sessions.map((session) => ({ arm, session }))),
  ];
}

/** Spend so far and the projected total over the stage's jobs (an arm with no row is projected at the arms' mean). */
export function longProjection(rows, rule = SESSION_BENCH_LONG_RULE, { pilot = false, spentInput } = {}) {
  const jobs = longJobs(rule, { pilot });
  const perArm = {};
  for (const row of rows) (perArm[row.arm] ??= []).push(inputOf(row.meter));
  const all = rows.filter((row) => !LONG_CALIBRATION_ARMS.includes(row.arm)).map((row) => inputOf(row.meter));
  const fallback = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  let projected = 0;
  for (const { arm, session } of jobs) {
    const row = rows.find((r) => r.arm === arm && r.session === session);
    const own = perArm[arm] ?? [];
    projected += row ? inputOf(row.meter) : own.length ? own.reduce((a, b) => a + b, 0) / own.length : fallback;
  }
  return {
    rows: rows.filter((row) => jobs.some((job) => job.arm === row.arm && job.session === row.session)).length,
    of: jobs.length,
    spentInputTokens: spentInput ?? rows.reduce((sum, row) => sum + inputOf(row.meter), 0),
    projectedInputTokens: Math.round(projected),
    ceilingInputTokens: rule.ceilingInputTokens,
  };
}

/** Each arm's blind units from rows (G7: the scorer never sees the arm). */
export function unitsFromLongRows(rows) {
  const byArm = {};
  for (const row of rows) {
    const own = (byArm[row.arm] ??= { checks: [], tasks: [] });
    own.checks.push(...row.checks);
    own.tasks.push(...row.tasks);
  }
  return Object.fromEntries(Object.entries(byArm).map(([arm, own]) => [arm, longUnits(own).units]));
}

/**
 * The evidence report over `rows` on `sessions`: the descriptive report (`run.mjs` `longReport`), every pre-registered
 * comparison (G8), the live guardrails over the pilot sessions, and the verdict.
 */
export function longLiveReport(rows, rule = SESSION_BENCH_LONG_RULE, { pilot = false, root, approval } = {}) {
  const sessions = pilot ? rule.pilotSessions : rule.sessions;
  const allArms = [...rule.arms, ...rule.calibration.arms];
  const kept = rows.filter(
    (row) => allArms.includes(row.arm) && (sessions.includes(row.session) || rule.calibration.sessions.includes(row.session)),
  );
  const arms = allArms.filter((arm) => kept.some((row) => row.arm === arm));
  const ids = [...new Set([...sessions, ...rule.calibration.sessions])].filter((id) => kept.some((row) => row.session === id));
  const byArm = Object.fromEntries(arms.map((arm) => [arm, emptyArmTotals()]));
  const instrumentation = Object.fromEntries(arms.map((arm) => [arm, []]));
  for (const id of ids)
    for (const arm of arms) {
      const row = kept.find((r) => r.arm === arm && r.session === id);
      if (!row) continue;
      accumulateArm(byArm[arm], id, row);
      if (row.instrumentation) instrumentation[arm].push([id, row.instrumentation]);
    }
  const shared = liveShared(rule);
  const configs = arms.map((arm) => longArmConfig(arm, shared));
  const report = longReport({
    mode: pilot ? "live-pilot" : "live",
    file,
    window: rule.window,
    arms,
    configs,
    sharedHash: assertLongEqualTreatment(configs),
    ids,
    byArm,
    instrumentation,
    wallMs: kept.reduce((sum, row) => sum + row.wallMs, 0),
    extra: {
      plan: rule.plan,
      model: rule.model,
      worker: rule.worker,
      ruleHash: longRuleHash(rule),
      ...(approval ? { approvedAt: approval.approvedAt } : {}),
      rows: kept.length,
      complete: longJobs(rule, { pilot }).every((job) => kept.some((row) => row.arm === job.arm && row.session === job.session)),
      firstAfterTask: Object.fromEntries(ids.map((id) => [id, firstAfterTask(createSession(id, { verify: false }))])),
      quotaWaitMs: kept.reduce((sum, row) => sum + row.quotaWaitMs, 0),
      ...(root ? { wireUsage: wireUsage(join(root, "wire")) } : {}),
    },
  });
  // The live guardrails read the pilot sessions only (the calibration arms ran nowhere else).
  const pilotRows = kept.filter((row) => rule.pilotSessions.includes(row.session));
  const pilotReport = pilotRows.length && pilot ? report : pilotRows.length ? longLiveReport(pilotRows, rule, { pilot: true }) : null;
  report.liveGuardrails = pilotReport
    ? liveLongGuardrails({ ...pilotReport, sessions: rule.pilotSessions }, rule.liveGuardrails)
    : { complete: false, pass: false, rows: [] };
  // The analysis and the verdict read the decision and side arms on the sessions every one of them finished.
  const runRows = kept.filter((row) => rule.arms.includes(row.arm));
  const units = unitsFromLongRows(runRows);
  report.comparisons = ANALYSIS_LONG.comparisons.map((pair) => compareLong(units, pair));
  report.verdict = longVerdict({
    units,
    costPerPassedTask: Object.fromEntries(rule.arms.map((arm) => [arm, report.cost[arm]?.wholeRunTokensPerPassedTask ?? null])),
  });
  return report;
}

// --- the run ---------------------------------------------------------------------------------------------------------

const defaultLog = (line) => process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);

/** The stages' pending jobs (smoke, calibration, pilot, rest), from the rows already written. */
export function longStages(rule, done) {
  const pending = (arm, ids) => ids.filter((id) => !done.has(`${arm}:${id}`)).map((session) => ({ arm, session }));
  const sizes = Object.fromEntries(rule.pilotSessions.map((id) => [id, sessionSizes(createSession(id)).total]));
  const smallest = [...rule.pilotSessions].sort((a, b) => sizes[a] - sizes[b])[0];
  const rest = rule.sessions.filter((id) => !rule.pilotSessions.includes(id));
  return {
    smoke: pending("memory-off-llm", [smallest]),
    smokeSession: smallest,
    calibration: rule.calibration.arms.flatMap((arm) => pending(arm, rule.calibration.sessions)),
    pilot: rule.arms.flatMap((arm) => pending(arm, rule.pilotSessions)),
    rest: rule.arms.flatMap((arm) => pending(arm, rest)),
  };
}

export async function runLongLive({ rule = SESSION_BENCH_LONG_RULE, pilot = false, log = defaultLog } = {}) {
  const approval = assertLongGate(JSON.parse(readFileSync(LONG_GATE_FILE, "utf8")), rule);
  const { checkLongGuardrails } = await import("./guardrails.mjs");
  const pre = await checkLongGuardrails({ probe: true, pressure: true, jobs: 6 });
  if (!pre.pass || pre.pending.length)
    throw new SessionBenchStop(
      `a pre-run guardrail failed or is pending (${pre.pending.join(", ") || "see guardrails.mjs"}); no arm may run`,
    );
  if (rule.arms.includes("mem0") && !mem0Status().installed) throw new SessionBenchStop(`Mem0: ${mem0Status().reason}`);
  const { loadEnv } = await import("../run.mjs");
  loadEnv();
  let embedder;
  if (rule.arms.includes("mem0")) {
    const status = localEmbedderStatus();
    if (!status.installed) throw new SessionBenchStop(`local embedder: ${status.reason}`);
    embedder = await localEmbedder();
  }
  const root = liveRoot(rule);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const checkin = () => {
    const p = longProjection(readLongRows(root), rule, { pilot, spentInput: wireUsage(join(root, "wire")).inputTokens });
    log(
      `check-in: ${p.rows}/${p.of} rows; ${(p.spentInputTokens / 1e6).toFixed(1)}M input spent; projected ${(p.projectedInputTokens / 1e6).toFixed(1)}M of the ${(p.ceilingInputTokens / 1e6).toFixed(0)}M ceiling`,
    );
    return p;
  };
  const timer = setInterval(checkin, 30 * 60_000);
  const pausePoint = () => {
    const reason = haltReason(root);
    if (reason) throw new SessionBenchStop(reason);
    if (isPaused(root)) throw new SessionBenchPaused(`paused at ${readLongRows(root).length} rows`);
  };
  const workerFaults = new Map();
  const halt = (reason) => {
    writeFileSync(pauseFile(root), `${new Date().toISOString()} STOP: ${reason}\n`);
    log(`STOP: ${reason}`);
    throw new Error("SessionBenchPaused");
  };
  const jobs = (list) =>
    list.map(({ arm, session }) => async () => {
      if (isPaused(root)) throw new Error("SessionBenchPaused");
      if (wireUsage(join(root, "wire")).inputTokens >= rule.ceilingInputTokens) throw new Error("SessionBenchTokenCeiling");
      log(`start ${arm} ${session}`);
      let row;
      try {
        row = await runLongLiveJob({ root, rule, arm, sessionId: session, embedder, log });
      } catch (error) {
        if (error instanceof SessionBenchStop) halt(error.message);
        if (error instanceof SessionBenchWorkerFault) {
          const faults = (workerFaults.get(`${arm}:${session}`) ?? 0) + 1;
          workerFaults.set(`${arm}:${session}`, faults);
          if (faults >= WORKER_FAULT_LIMIT) halt(`${error.message}; the memory worker failed this job ${faults} times`);
        }
        throw error;
      }
      const summary = row.instrumentation?.summary;
      log(
        `done ${arm} ${session}: ${row.checks.filter((c) => c.pass).length}/${row.checks.length} checks, ${(inputOf(row.meter) / 1e6).toFixed(2)}M input, ${row.meter.overflows} overflows, ${Math.round(row.wallMs / 60_000)} min${summary ? `; first overflow ${summary.firstOverflowTask}; first WM pass ${summary.firstWmPassTask}` : ""}`,
      );
      checkin();
    });
  const options = {
    isFault: (error) => error instanceof SessionBenchProviderFault,
    isCeiling: (error) => ["SessionBenchTokenCeiling", "SessionBenchPaused"].includes(error?.message),
  };
  const done = () => new Set(readLongRows(root).map((row) => `${row.arm}:${row.session}`));
  try {
    let stages = longStages(rule, done());
    await pool(jobs(stages.smoke), 1, log, options);
    pausePoint();
    const smoke = readLongRows(root).find((row) => row.arm === "memory-off-llm" && row.session === stages.smokeSession);
    if (!smoke) throw new SessionBenchIncomplete("the smoke job left no row");
    if (faultedTasks(smoke.status).length || smoke.meter.providerErrors)
      throw new SessionBenchStop(
        `smoke: ${faultedTasks(smoke.status).length} faulted tasks, ${smoke.meter.providerErrors} provider errors`,
      );
    if (checkin().projectedInputTokens > rule.ceilingInputTokens)
      throw new SessionBenchStop("smoke: the projected total exceeds the ceiling");
    stages = longStages(rule, done());
    await pool(jobs(stages.calibration), rule.concurrency, log, options);
    pausePoint();
    // A calibration job that left no row is a restart, never a guardrail miss read off missing rows.
    if (longStages(rule, done()).calibration.length) throw new SessionBenchIncomplete("a calibration job left no row");
    const calibration = longLiveReport(readLongRows(root), rule, { pilot: true }).liveGuardrails;
    const early = calibration.rows.filter((row) => row.id === "oracle-notes-solvable" || row.id.startsWith("amnesic-fails-"));
    if (early.some((row) => !row.pass)) throw new SessionBenchStop(`a calibration guardrail missed: ${JSON.stringify(early)}`);
    log(`calibration holds: ${JSON.stringify(early)}`);
    stages = longStages(rule, done());
    await pool(jobs(stages.pilot), rule.concurrency, log, options);
    pausePoint();
    const guardrails = longLiveReport(readLongRows(root), rule, { pilot: true }).liveGuardrails;
    if (!guardrails.complete) throw new SessionBenchIncomplete("the pilot did not finish; re-run --live to resume");
    if (!guardrails.pass) throw new SessionBenchStop(`a pilot guardrail missed: ${JSON.stringify(guardrails.rows)}`);
    log(`pilot guardrails hold: ${JSON.stringify(guardrails.rows)}`);
    if (!pilot) {
      stages = longStages(rule, done());
      await pool(jobs(stages.rest), rule.concurrency, log, options);
      pausePoint();
    }
  } finally {
    clearInterval(timer);
    await embedder?.stop?.();
  }
  return writeLongEvidence({ rule, root, approval, pilot, log });
}

export function writeLongEvidence({
  rule = SESSION_BENCH_LONG_RULE,
  root = liveRoot(rule),
  approval,
  pilot = false,
  log = defaultLog,
} = {}) {
  const report = longLiveReport(readLongRows(root), rule, { pilot, root, approval });
  writeFileSync(
    join(REPO, pilot ? rule.evidence.pilot : rule.evidence.run),
    `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  log(
    `evidence: ${report.rows} rows; complete ${report.complete}; guardrails ${report.liveGuardrails.pass ? "hold" : "miss"}; verdict ${JSON.stringify(report.verdict.summary)}`,
  );
  return report;
}

export async function main(argv, { rule = SESSION_BENCH_LONG_RULE } = {}) {
  const pilot = argv.includes("--pilot");
  const root = liveRoot(rule);
  if (argv.includes("--status")) {
    console.log(
      JSON.stringify(longProjection(readLongRows(root), rule, { pilot, spentInput: wireUsage(join(root, "wire")).inputTokens }), null, 2),
    );
    return;
  }
  if (argv.includes("--report")) {
    writeLongEvidence({ rule, pilot });
    return;
  }
  if (argv.includes("--pause")) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(pauseFile(root), `${new Date().toISOString()}\n`);
    console.log("paused: no new job starts; jobs in flight finish and checkpoint. Resume: --resume, then --live again.");
    return;
  }
  if (argv.includes("--resume")) {
    if (isPaused(root)) unlinkSync(pauseFile(root));
    console.log("pause cleared; start the run again with --live (it resumes from the rows)");
    return;
  }
  process.on("exit", (code) => defaultLog(`exit ${code}`));
  process.on("uncaughtException", (error) => {
    defaultLog(`uncaughtException: ${error?.stack ?? error}`);
    process.exit(4);
  });
  process.on("unhandledRejection", (error) => defaultLog(`unhandledRejection: ${error?.stack ?? error}`));
  if (isPaused(root)) {
    defaultLog("the run is paused (PAUSE file); clear it with --resume first");
    process.exit(5);
  }
  try {
    const report = await runLongLive({ rule, pilot });
    if (!report.complete && wireUsage(join(root, "wire")).inputTokens < rule.ceilingInputTokens && !isPaused(root)) {
      defaultLog(`INCOMPLETE: ${report.rows} rows; exit 6 so the unit restarts and resumes`);
      process.exit(6);
    }
  } catch (error) {
    if (error instanceof SessionBenchPaused) {
      defaultLog(`PAUSED: ${error.message}; resume with --resume, then --live`);
      return;
    }
    if (error instanceof SessionBenchIncomplete) {
      if (wireUsage(join(root, "wire")).inputTokens < rule.ceilingInputTokens && !isPaused(root)) {
        defaultLog(`INCOMPLETE: ${error.message}; exit 6 so the unit restarts and resumes`);
        process.exit(6);
      }
      defaultLog(`STOP at the ceiling or a pause: ${error.message}`);
      writeLongEvidence({ rule, pilot });
      process.exit(3);
    }
    if (error instanceof SessionBenchStop) {
      defaultLog(`STOP: ${error.message}`);
      writeLongEvidence({ rule, pilot });
      process.exit(3);
    }
    throw error;
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--rule")) console.log(JSON.stringify({ ruleHash: longRuleHash(), rule: SESSION_BENCH_LONG_RULE }, null, 2));
  else if (argv.includes("--write-gate")) {
    const section = writeGate();
    console.log(`wrote sessionBenchLong (unapproved): ruleHash ${section.ruleHash}`);
  } else if (
    argv.includes("--live") ||
    argv.includes("--status") ||
    argv.includes("--report") ||
    argv.includes("--pause") ||
    argv.includes("--resume")
  )
    await main(argv);
  else {
    console.error("live.mjs: --rule | --write-gate | --live [--pilot] | --status | --report [--pilot] | --pause | --resume");
    process.exit(2);
  }
}
