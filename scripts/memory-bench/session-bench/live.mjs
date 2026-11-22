/**
 * Plan 218.3 Task 11: Session-Bench's live test run (paid, on the owner's word).
 *
 *   # the rule must be approved in the gate record (`sessionBenchTest`) first; run as a systemd --user unit:
 *   bun scripts/memory-bench/session-bench/run.mjs --live            # runs (resumes) the approved rule
 *   bun scripts/memory-bench/session-bench/run.mjs --live --status   # check-in: rows, spend, projected total
 *   bun scripts/memory-bench/session-bench/run.mjs --live --report   # writes the evidence from the checkpoints
 *   bun scripts/memory-bench/session-bench/run.mjs --live --pause    # graceful pause: in-flight jobs finish, then exit
 *   bun scripts/memory-bench/session-bench/run.mjs --live --resume   # clear the pause; then start --live again
 *   bun scripts/memory-bench/session-bench/live.mjs --rule           # prints the rule and its hash (no call)
 *
 * The run reuses the LOCA-Bench pilot's job pool (checkpoints, fault waits, token ceiling: `external/loca-bench/pilot.mjs`
 * `pool`, `wireUsage`). One job is one (arm, session): its own live provider and wire proxy (so usage is per job), a
 * progress file after every task, and a checkpoint row when the session ends. A quota or overload answer waits inside
 * the request (`quotaWaitFetch`: 15 minutes, again, as long as it takes) and never fails a task; a job a provider error
 * still reaches is a fault, re-run from its start after a wait. Order: a smoke job, then the calibration arms, whose
 * live guardrails must hold before any other arm starts (a miss stops the run for the owner), then the rest.
 * Rows and the evidence hold ids, counts and hashes only, never prompt, tool output or model text.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, wireUsage } from "../external/loca-bench/pilot.mjs";
import { stableHash } from "../journal.mjs";
import { armConfig, assertEqualTreatment, CALIBRATION_ARMS, configHash, SESSION_BENCH_ARMS } from "./arms/prism.mjs";
import { GEMINI_EMBEDDER, geminiEmbedder, LOCAL_EMBEDDER, localEmbedder, localEmbedderStatus, mem0Status } from "./arms/third-party.mjs";
import { WORKSPACE_TOOL_NAMES } from "./env/workspace.mjs";
import { createSession, sessionBenchPartitions, sessionSizes, WINDOW_TOKENS } from "./generate.mjs";
import { liveGuardrails } from "./guardrails.mjs";
import { accumulateArm, emptyArmTotals, MAX_OUTPUT_TOKENS, RUN_LIMITS, runArmSession, sessionBenchReport, sharedConfig } from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
export const SESSION_BENCH_TEST_GATE = join(REPO, "docs/_evidence/memory-bench/218/gates/owner-gate-m2.json");
export const SESSION_BENCH_TEST_EVIDENCE = join(REPO, "docs/_evidence/memory-bench/218/session-bench-test.json");

/** The slice: the first two `dev` sessions of each family, in the partition file's label-blind order. */
export const sliceIds = (file = sessionBenchPartitions(), perFamily = 2) =>
  Object.values(file.abilities.dev).flatMap((list) => list.slice(0, perFamily));

/**
 * Live limits: RUN_LIMITS with two fences widened for every arm alike. Wall time: a quota wait happens inside a task, so
 * the fence is a hang guard only. Input tokens per run: oracle-context re-sends a session of up to 260K tokens on every
 * turn, so a late task's dozen turns pass 2M; the windowed arms cannot reach it (W x maxTurns < 1M).
 */
export const LIVE_LIMITS = Object.freeze({
  ...RUN_LIMITS,
  maxInputTokens: 12_000_000,
  maxTotalTokens: 12_100_000,
  maxWallTimeMs: 12 * 3_600_000,
});
const file = sessionBenchPartitions();

/** The pre-registered test rule (owner decisions 2026-11-18). Changing any field changes its hash, which the gate pins. */
export const SESSION_BENCH_TEST_RULE = Object.freeze({
  suite: "session-bench",
  plan: "218.3 Task 11",
  // Frozen at the v2 pins the test ran on (plan 218.3 Task 12 made v3; the approved rule and its hash stay as run).
  benchmark: {
    version: 2,
    templateHash: "da493266ba03396884e4a16a4996da200c89b396e00f75a75a6315c6241cff80",
    idsHash: "1937178f6107526c04e10b2bf0357f20bd106874f25fe1caf1c0495ee0738bda",
    sessionsHash: "89cd48d9a5050392a85ea0855f26c4229e267f5edb9454d91f3e2a848bff526c",
  },
  partition: "dev",
  sessions: sliceIds(file),
  selection: "the first two dev sessions of each family in the partition file's label-blind order (6 sessions)",
  // Task 11's approved arms (memory-off-drop came in Task 12, 2026-11-20).
  arms: SESSION_BENCH_ARMS.filter((arm) => arm !== "memory-off-drop"),
  model: "opencode-go/deepseek-v4.1-flash",
  worker: "opencode-go/deepseek-v4.1-flash",
  modelChoice:
    "owner, 2026-11-18: DeepSeek V4.1 Flash (1M window), not Muse: Muse's OpenCode Go window is 200K and dev sessions reach 260K, so oracle-context could not hold a session",
  sampling: { temperature: 0, thinkingLevel: "low", parallelToolCalls: false },
  samplingNote:
    "temperature 0 for every call; the agent at thinkingLevel low (the memory workers' own default since gate M-2), so the 2,048-token output reserve is not spent thinking; Mem0's calls at low too; parallel_tool_calls false on the main agent's requests only, those that carry the workspace tools (owner, 2026-11-18, after the v2 smoke: DeepSeek read two ~18K artifacts in one round, over W, and no compaction can shrink fresh tool results; the benchmark assumes one artifact per round). Memory workers keep parallel calls: STM and WM record and judge through several tool calls in one turn and end after one clean turn (owner, 2026-11-18, after the first version of this rule sent the flag to every request with tools and STM recorded one event per batch)",
  window: WINDOW_TOKENS,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  oracleWindow: "oracle-context's 1,000,000 (the model's window): no session compacts",
  limits: LIVE_LIMITS,
  embedder: { ...GEMINI_EMBEDDER },
  concurrency: 4,
  ceilingInputTokens: 300_000_000,
  ceilingBasis:
    "input tokens (cached included) across every usage log under the run's wire directory; no new job starts at or above it, jobs in flight finish",
  faults:
    "a 429/5xx/transport answer that outlasts the patient retries waits 15 minutes inside the request and is sent again, as often as needed (quota waits never fail a task); a job a provider error still reaches is a fault: no row, wait 15 minutes, the session runs again from its start",
  order: [
    "smoke: memory-off-llm on the smallest session of the slice, alone; it must finish with no fault, no provider error and no task failed for a reason other than its own limits, and its tokens give the projected total; a miss or a projected total over the ceiling stops the run for the owner",
    "calibration: oracle-context and amnesic on every session; the live guardrails must hold before any other arm starts; a miss stops the run for the owner",
    "the rest: memory-off-llm, STM-only, STM+WM, claude-code-prompt, codex-prompt, mem0 on every session",
  ],
  liveGuardrails: {
    oracleTaskRateMin: 0.6,
    amnesicFailRateMin: { D2: 0.7, D4: 0.7 },
    text: "oracle-context passes at least 60% of tasks (the benchmark is solvable on this model); amnesic fails at least 70% of D2 checks and at least 70% of D4 checks (the dependencies are real)",
  },
  checkins: "every 30 minutes and after every job: rows done, input tokens spent, projected total, quota waits",
  reports:
    "per arm: tasks passed, dependency checks by class, re-derivation calls, whole-run tokens (agent, workers and embeddings apart), cache share, wall time without quota waits; the live guardrails; the screen size",
  screen: {
    metric: "per-session dependency-check success (D1-D4 pooled), paired by session",
    comparisons: [
      ["memory-off-llm", "STM-only"],
      ["STM-only", "STM+WM"],
    ],
    effect: 0.1,
    alpha: 0.05,
    power: 0.8,
    method:
      "n = ceil(((z_0.975 + z_0.8) * sd / effect)^2) with sd the larger of the two comparisons' standard deviation of per-session paired differences; at least 6; the dev partition holds 36 sessions, so n > 36 goes to the owner; cost = n x the measured mean input tokens per session summed over the decision and side arms; the effect detectable at n = 36 is reported beside it",
  },
});
export const testRuleHash = (rule = SESSION_BENCH_TEST_RULE) => stableHash(rule);

/**
 * Where a rule lives: Task 11's test rule in `sessionBenchTest` with `session-bench-test.json`; a later rule (Task 12's
 * screen, `screen.mjs`) names its own `gateSection` and `evidence` path, so the runner below serves both.
 */
export const gateSectionOf = (rule) => rule.gateSection ?? "sessionBenchTest";
export const evidenceOf = (rule) => (rule.evidence ? join(REPO, rule.evidence) : SESSION_BENCH_TEST_EVIDENCE);

/**
 * A rule's calibration stage (Task 12's screen, owner 2026-11-19): its own arms and sessions (`rule.calibration`), or,
 * for Task 11's rule, the calibration arms on the rule's sessions. `calibrationRule` is the rule narrowed to that stage.
 */
export function calibrationRule(rule) {
  if (rule.calibration) {
    const { calibration, ...rest } = rule;
    return { ...rest, arms: [...calibration.arms], sessions: [...calibration.sessions] };
  }
  return { ...rule, arms: CALIBRATION_ARMS.filter((arm) => rule.arms.includes(arm)) };
}

/** The gate must approve exactly this rule on the owner's word (a changed rule is a refusal, not a re-approval). */
export function assertTestGate(gate, rule = SESSION_BENCH_TEST_RULE) {
  const name = gateSectionOf(rule);
  const section = gate?.[name];
  if (!section) throw new Error(`SessionBenchLive: the gate record has no ${name} section`);
  if (section.approved !== true || section.approvedBy !== "owner" || typeof section.text !== "string" || !section.text.trim())
    throw new Error(`SessionBenchLive: ${name} is not approved on the owner's word`);
  if (section.ruleHash !== testRuleHash(rule) || JSON.stringify(section.rule) !== JSON.stringify(rule))
    throw new Error("SessionBenchLive: the rule differs from the approved one");
  // Task 11's rule reads `sessionBench.live`; a later rule on another model names its own pin (`livePinKey`).
  const pinKey = rule.livePinKey ?? "live";
  const pinned = gate.sessionBench?.[pinKey];
  if (!pinned || pinned.sharedConfigHash !== liveConfigHashes(rule).sharedConfigHash)
    throw new Error(`SessionBenchLive: sessionBench.${pinKey} does not pin this rule's configHashes (G6)`);
  return section;
}

/** The live shared config (G6) and each arm's config hash on the live model. */
export function liveConfigs(rule = SESSION_BENCH_TEST_RULE) {
  const [provider, ...rest] = rule.model.split("/");
  const shared = sharedConfig({
    model: { provider, model: rest.join("/") },
    temperature: rule.sampling.temperature,
    thinkingLevel: rule.sampling.thinkingLevel,
    window: rule.window,
    limits: rule.limits,
    parallelToolCalls: rule.sampling.parallelToolCalls,
    toolCallsPerTurn: rule.sampling.toolCallsPerTurn,
    workerReasoningEffort: rule.sampling.workerReasoningEffort,
    workerOutput: rule.sampling.workerOutput,
  });
  // A separate calibration slice (Task 12) is pinned with the rule's arms; calibration arms are exempt from G6.
  return [...new Set([...rule.arms, ...(rule.calibration?.arms ?? [])])].map((arm) => armConfig(arm, shared));
}
export function liveConfigHashes(rule = SESSION_BENCH_TEST_RULE) {
  const configs = liveConfigs(rule);
  return {
    model: rule.model,
    configHashes: Object.fromEntries(configs.map((config) => [config.arm, configHash(config)])),
    sharedConfigHash: assertEqualTreatment(configs),
  };
}

// --- checkpoints ---------------------------------------------------------------------------------------------------

export const liveRoot = (rule = SESSION_BENCH_TEST_RULE, env = process.env) =>
  join(env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "session-bench", "live", testRuleHash(rule).slice(0, 16));
const rowFile = (root, arm, session) => join(root, "rows", arm.replace(/[^A-Za-z0-9._-]/g, "_"), `${session}.json`);
const progressFile = (root, arm, session) => join(root, "progress", arm.replace(/[^A-Za-z0-9._-]/g, "_"), `${session}.json`);

const ROW_FIELDS = [
  "arm",
  "session",
  "checks",
  "tasks",
  "status",
  "meter",
  "configHash",
  "wallMs",
  "quotaWaitMs",
  "quotaWaits",
  "finishedAt",
];
const CHECK_FIELDS = ["session", "task", "check", "class", "dep", "pass"];
/** A checkpoint row holds ids, counts and hashes only (no prompt, tool output or model text). */
export function assertRowHoldsNoText(row) {
  for (const key of Object.keys(row)) if (!ROW_FIELDS.includes(key)) throw new Error(`SessionBenchLive: row field ${key} is not allowed`);
  for (const check of row.checks)
    for (const key of Object.keys(check)) if (!CHECK_FIELDS.includes(key)) throw new Error(`SessionBenchLive: check field ${key}`);
  for (const status of Object.values(row.status))
    for (const [key, value] of Object.entries(status))
      if (!["status", "code", "limit"].includes(key) || typeof value !== "string" || value.length > 64)
        throw new Error("SessionBenchLive: a task status holds more than a status and a code");
  return row;
}

export function readLiveRows(root) {
  const dir = join(root, "rows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => assertRowHoldsNoText(JSON.parse(readFileSync(join(dir, entry), "utf8"))));
}

// --- faults and quota waits ----------------------------------------------------------------------------------------

export class SessionBenchProviderFault extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionBenchProviderFault";
  }
}
/**
 * A memory worker failed (owner, 2026-11-21: "worker failure is not a valid finding and defeats the purpose of the
 * screen"): a worker call that ended in a provider error after every retry, or an STM batch recorded without the model.
 * No row; the job runs again from its start, and `WORKER_FAULT_LIMIT` faults of one job stop the run for the owner.
 */
export class SessionBenchWorkerFault extends SessionBenchProviderFault {
  constructor(message) {
    super(message);
    this.name = "SessionBenchWorkerFault";
  }
}
export const WORKER_FAULT_LIMIT = 3;
/** A provider's usage-limit answer (a monthly or credit limit, 2026-11-21 on Ollama Cloud): waiting never clears it. */
export const USAGE_LIMIT =
  /usage limit|monthly limit|insufficient (credit|balance|funds|quota)|quota exceeded|exceeded your (current )?quota|add (usage )?credits|billing/i;
/** The worker side of a finished job: why it is not a valid row, or undefined. */
export function workerFailure(meter) {
  const errors = meter.workerErrors ?? 0;
  const fallbacks = (meter.stmFallbacks?.output_cap ?? 0) + (meter.stmFallbacks?.worker_error ?? 0);
  if (!errors && !fallbacks) return undefined;
  const kinds = meter.workerErrorKinds ? `; kinds ${JSON.stringify(meter.workerErrorKinds)}` : "";
  return `${errors} worker calls failed, ${fallbacks} STM batches recorded without the model (output_cap ${meter.stmFallbacks?.output_cap ?? 0}, worker_error ${meter.stmFallbacks?.worker_error ?? 0})${kinds}`;
}
/** A graceful pause (`--pause`): no new job starts; jobs in flight finish and checkpoint; the run exits 0. */
export class SessionBenchPaused extends Error {
  constructor(message = "SessionBenchPaused") {
    super(message);
    this.name = "SessionBenchPaused";
  }
}
/** The pause flag: a file in the run's root. `--pause` writes it, `--resume` removes it. */
export const pauseFile = (root) => join(root, "PAUSE");
export const isPaused = (root) => existsSync(pauseFile(root));
/** A stop for the owner raised inside a job (a usage limit, a job's worker faults): the pause file names it. */
export const haltReason = (root) => {
  if (!isPaused(root)) return undefined;
  const text = readFileSync(pauseFile(root), "utf8");
  return text.includes("STOP: ") ? text.slice(text.indexOf("STOP: ") + 6).trim() : undefined;
};

export class SessionBenchStop extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionBenchStop";
  }
}
/** Jobs are missing below the ceiling (dropped after their retries): restart and resume, never a stop for the owner. */
export class SessionBenchIncomplete extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionBenchIncomplete";
  }
}
const WORKSPACE_TOOLS = new Set(WORKSPACE_TOOL_NAMES);
// Transient answers that wait and resend, never fail a task: rate limits, overloads, gateway and origin timeouts
// (408, 425 and Cloudflare's 520-524 added in plan 218.3 Task 12 for the free route).
export const WAIT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
const TRANSPORT =
  /SessionBenchStall|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|EPIPE|ENOTFOUND|socket hang up|fetch failed|connection was closed|network/i;

/**
 * The outer fetch: after the patient retries (`benchmarkFetch`), a quota, overload or transport answer waits `waitMs`
 * and the same request is sent again, until `maxWaitMs` in all. `clock.waitMs` and `clock.waits` count it.
 */
export function quotaWaitFetch(
  inner,
  { waitMs = 900_000, maxWaitMs = 10 * 3_600_000, clock, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) },
) {
  return async (input, init) => {
    if (clock.usageLimit) throw new Error("SessionBenchUsageLimit: the provider is at its usage limit");
    let waited = 0;
    for (;;) {
      let response;
      try {
        response = await inner(input, init);
      } catch (error) {
        if (init?.signal?.aborted || !TRANSPORT.test(`${error?.message ?? ""} ${error?.code ?? ""}`) || waited >= maxWaitMs) throw error;
        response = null;
      }
      // A usage limit (a monthly or credit limit) is never waited out: the answer goes on and the job stops the run.
      if (response && [402, 403, 429].includes(response.status)) {
        const text = await response
          .clone()
          .text()
          .catch(() => "");
        if (USAGE_LIMIT.test(text)) {
          clock.usageLimit = response.status;
          log(`provider answered ${response.status}: a usage limit; the run stops`);
          return response;
        }
      }
      if (response && (!WAIT_STATUSES.has(response.status) || waited >= maxWaitMs)) return response;
      await response?.body?.cancel();
      log(`provider answered ${response ? response.status : "a transport error"}; waiting ${Math.round(waitMs / 60_000)} min`);
      clock.waits++;
      clock.waitMs += waitMs;
      waited += waitMs;
      await sleep(waitMs);
    }
  };
}

/**
 * The stall guard (2026-11-18, after two jobs hung 80 minutes on open, silent upstream streams following connection
 * resets): no response headers within `headersMs` aborts the request with a `SessionBenchStall` error, which
 * `quotaWaitFetch` retries as a transport error (nothing was delivered); a body that sends no bytes for `idleMs` is
 * ended with a `SessionBenchStall` error, which reaches the run as a provider error (the job is a fault and reruns).
 */
export function stallGuardFetch(inner, { headersMs = 300_000, idleMs = 300_000 } = {}) {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal;
    const relay = () => controller.abort(outer.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    else outer?.addEventListener("abort", relay, { once: true });
    let timer = setTimeout(() => controller.abort(new Error("SessionBenchStall: no response headers")), headersMs);
    let response;
    try {
      response = await inner(input, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      outer?.removeEventListener("abort", relay);
      if (!outer?.aborted && controller.signal.aborted) throw new Error(`SessionBenchStall: no response headers in ${headersMs} ms`);
      throw error;
    }
    clearTimeout(timer);
    if (!response.body) {
      outer?.removeEventListener("abort", relay);
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(stream) {
        timer = setTimeout(() => {
          stream.error(new Error(`SessionBenchStall: no bytes for ${idleMs} ms`));
          controller.abort(new Error("SessionBenchStall"));
        }, idleMs);
        try {
          const { done, value } = await reader.read();
          clearTimeout(timer);
          if (done) {
            outer?.removeEventListener("abort", relay);
            stream.close();
          } else stream.enqueue(value);
        } catch (error) {
          clearTimeout(timer);
          outer?.removeEventListener("abort", relay);
          try {
            stream.error(error);
          } catch {}
        }
      },
      cancel(reason) {
        clearTimeout(timer);
        outer?.removeEventListener("abort", relay);
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

/**
 * Serial tool calls (rule `sampling.parallelToolCalls: false`): the main agent's chat requests (those that carry a
 * workspace tool) get `parallel_tool_calls: false` in their JSON body, for every arm alike. Memory workers and every
 * request without a workspace tool pass unchanged: STM and WM record through several tool calls in one turn and end
 * after one clean turn, so a serial flag there cuts each batch to one record (found 2026-11-18).
 */
export function serialToolCallsFetch(inner) {
  return (input, init) => {
    if (typeof init?.body !== "string") return inner(input, init);
    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return inner(input, init);
    }
    const main = Array.isArray(body?.tools) && body.tools.some((tool) => WORKSPACE_TOOLS.has(tool?.function?.name ?? tool?.name));
    if (!main) return inner(input, init);
    return inner(input, { ...init, body: JSON.stringify({ ...body, parallel_tool_calls: false }) });
  };
}

/** A job's tasks that neither completed nor stopped on the agent's own limits. */
const failedTasks = (status) =>
  Object.values(status).filter((row) => !["completed", "stopped"].includes(row.status) && row.code !== "ERR_PRISM_RUN_LIMIT");
/** Outcomes the arm owns (scored, never re-run): the window overflowed, or the agent hit one of its own limits. */
const OUTCOME_CODES = new Set(["context_overflow", "ERR_PRISM_RUN_LIMIT"]);
/** Tasks that failed for any other reason: a provider or harness fault. */
export const faultedTasks = (status) =>
  Object.values(status).filter((row) => !["completed", "stopped"].includes(row.status) && !OUTCOME_CODES.has(row.code));

/** One (arm, session) on the live model: its own providers, progress after each task, a checkpoint row at the end. */
export async function runLiveJob({ root, rule, arm, sessionId, embedder, log, trace, inspect, wrapProviders }) {
  const { liveProviders, refOf } = await import("../run.mjs");
  const ref = refOf(rule.model);
  const clock = { waits: 0, waitMs: 0 };
  const wire = join(root, "wire", arm.replace(/[^A-Za-z0-9._-]/g, "_"), sessionId);
  mkdirSync(wire, { recursive: true, mode: 0o700 });
  // A rule may run the memory workers on their own model (Task 12, owner 2026-11-20); its provider joins the run's.
  const workerRef = rule.worker && rule.worker !== rule.model ? refOf(rule.worker) : undefined;
  const live = await liveProviders(workerRef ? [ref, workerRef] : [ref], wire, {
    maxOutputTokens: rule.maxOutputTokens,
    patient: true,
    wrapFetch: (base) =>
      quotaWaitFetch(stallGuardFetch(rule.sampling.parallelToolCalls === false ? serialToolCallsFetch(base) : base), {
        clock,
        log: (line) => log(`${arm} ${sessionId}: ${line}`),
      }),
  });
  const model = live.models.get(rule.model);
  const session = createSession(sessionId);
  const started = performance.now();
  let result;
  try {
    result = await runArmSession({
      session,
      arm,
      // Diagnostics only: a replay may wrap the providers (to keep what the main agent was sent in its scratchpad).
      providers: () => (wrapProviders ? wrapProviders(live.providers) : live.providers),
      model,
      workerModel: rule.worker,
      workerSpec: workerRef ? live.models.get(rule.worker) : model,
      window: rule.window,
      temperature: rule.sampling.temperature,
      thinkingLevel: rule.sampling.thinkingLevel,
      limits: rule.limits,
      embedder,
      ...(trace ? { trace } : {}),
      ...(inspect ? { inspect } : {}),
      // Rules from Task 12 hash the row's run config with these (Task 11's rows did not: their hash omitted the flag).
      ...(rule.sampling.workerReasoningEffort ? { workerReasoningEffort: rule.sampling.workerReasoningEffort } : {}),
      ...(rule.sampling.workerOutput ? { workerOutput: rule.sampling.workerOutput } : {}),
      ...(rule.sampling.toolCallsPerTurn
        ? { parallelToolCalls: rule.sampling.parallelToolCalls, toolCallsPerTurn: rule.sampling.toolCallsPerTurn }
        : {}),
      onTask: ({ task, of, status, meter }) => {
        const file = progressFile(root, arm, sessionId);
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, `${JSON.stringify({ arm, session: sessionId, task, of, status, meter, quotaWaitMs: clock.waitMs })}\n`);
      },
    });
  } finally {
    for (const { proxy } of live.proxies) {
      // Bounded: the proxy reads the upstream to its end for the usage log, and a silent upstream never ends.
      let timer;
      const drained = await Promise.race([
        proxy.drain().then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 60_000);
        }),
      ]);
      clearTimeout(timer);
      if (!drained)
        log(`${arm} ${sessionId}: the wire proxy did not drain in 60 s (a silent upstream); usage of that exchange is unlogged`);
      proxy.stop();
    }
  }
  // An embedder at its daily cap leaves the third-party arm without memory: never a row; pause the run (no new job).
  if (embedder?.dailyCap && arm === "mem0") {
    writeFileSync(pauseFile(root), `${new Date().toISOString()} embedder daily cap\n`);
    log(`${arm} ${sessionId}: the embedder is at its daily cap; no row; the run pauses`);
    throw new Error("SessionBenchPaused");
  }
  // A provider at its usage limit: no row; the run stops for the owner (waiting would only spend the main model).
  if (clock.usageLimit) throw new SessionBenchStop(`${arm} ${sessionId}: a provider answered ${clock.usageLimit} with a usage limit`);
  const worker = workerFailure(result.meter);
  if (worker) throw new SessionBenchWorkerFault(`${arm} ${sessionId}: ${worker}`);
  const failed = failedTasks(result.status);
  // A fault only when a task failed for a non-outcome reason (an overflow or a run limit is the arm's, and scored).
  const faulted = faultedTasks(result.status);
  if (faulted.length)
    throw new SessionBenchProviderFault(
      `${arm} ${sessionId}: ${result.meter.providerErrors} provider errors, ${faulted.length} tasks failed outside the arm's outcomes (${[...new Set(faulted.map((row) => row.code ?? row.status))].join(", ")}); ${failed.length} failed in all`,
    );
  const limitAfterWait = clock.waitMs > 0 && Object.values(result.status).some((row) => row.code === "ERR_PRISM_RUN_LIMIT");
  if (limitAfterWait) throw new SessionBenchProviderFault(`${arm} ${sessionId}: a run limit after quota waits`);
  const row = assertRowHoldsNoText({
    arm,
    session: sessionId,
    checks: result.checks,
    tasks: result.tasks,
    status: result.status,
    meter: result.meter,
    configHash: result.configHash,
    wallMs: Math.round(performance.now() - started - clock.waitMs),
    quotaWaitMs: clock.waitMs,
    quotaWaits: clock.waits,
    finishedAt: new Date().toISOString(),
  });
  const file = rowFile(root, arm, sessionId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

// --- report, guardrails, screen size -----------------------------------------------------------------------------------

const inputOf = (meter) => meter.main.inputTokens + meter.workers.inputTokens + meter.embeddings.inputTokens;

/** Spend so far and the projected total, from checkpoint rows (by arm: the measured mean per session x the slice). */
export function projection(rows, rule = SESSION_BENCH_TEST_RULE, spentInput = undefined) {
  const perArm = {};
  for (const row of rows) (perArm[row.arm] ??= []).push(inputOf(row.meter));
  const all = rows.map((row) => inputOf(row.meter));
  // An arm with no row yet is projected at the windowed arms' mean (the calibration ceiling re-sends whole sessions
  // and would inflate every other arm); with none measured, at the largest row.
  const windowed = rows.filter((row) => !CALIBRATION_ARMS.includes(row.arm)).map((row) => inputOf(row.meter));
  const fallback = windowed.length ? windowed.reduce((a, b) => a + b, 0) / windowed.length : all.length ? Math.max(...all) : 0;
  let projected = 0;
  // Every stage's jobs: the rule's arms on its sessions, plus a separate calibration slice when the rule names one.
  const stages = [{ arms: rule.arms, sessions: rule.sessions }];
  if (rule.calibration) stages.push(rule.calibration);
  for (const stage of stages)
    for (const arm of stage.arms) {
      const done = perArm[arm] ?? [];
      const mean = done.length ? done.reduce((a, b) => a + b, 0) / done.length : arm === "oracle-context" ? fallback * 5 : fallback;
      projected += done.reduce((a, b) => a + b, 0) + mean * (stage.sessions.length - done.length);
    }
  return {
    rows: rows.length,
    of: stages.reduce((sum, stage) => sum + stage.arms.length * stage.sessions.length, 0),
    spentInputTokens: spentInput ?? all.reduce((a, b) => a + b, 0),
    projectedInputTokens: Math.round(projected),
    ceilingInputTokens: rule.ceilingInputTokens,
  };
}

const Z = { 0.975: 1.959963984540054, 0.8: 0.8416212335729143 };
const sd = (values) => {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};
const depRate = (session, classes = ["D1", "D2", "D3", "D4"]) => {
  let pass = 0;
  let total = 0;
  for (const cls of classes) {
    pass += session?.classes?.[cls]?.pass ?? 0;
    total += session?.classes?.[cls]?.total ?? 0;
  }
  return total ? pass / total : null;
};

/** The screen's size from the measured variance (the rule's `screen`) and its cost from the measured tokens. */
export function screenSize(report, rows, rule = SESSION_BENCH_TEST_RULE, devSessions = 36, classes = ["D1", "D2", "D3", "D4"]) {
  const { effect, comparisons } = rule.screen;
  const z = Z[0.975] + Z[0.8];
  const readings = comparisons.map(([a, b]) => {
    const left = report.scores[a]?.sessions ?? {};
    const right = report.scores[b]?.sessions ?? {};
    const diffs = Object.keys(left)
      .filter((id) => right[id])
      .map((id) => depRate(right[id], classes) - depRate(left[id], classes))
      .filter((value) => Number.isFinite(value));
    const s = sd(diffs);
    return {
      a,
      b,
      sessions: diffs.length,
      meanDiff: diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null,
      sd: s,
      detectableAt36: s === null ? null : (z * s) / Math.sqrt(devSessions),
    };
  });
  const sds = readings.map((row) => row.sd).filter((value) => value !== null);
  if (!sds.length) return { readings, n: null, verdict: "not enough paired sessions" };
  const worst = Math.max(...sds);
  const n = Math.max(6, Math.ceil(((z * worst) / effect) ** 2));
  const screenArms = rule.arms.filter((arm) => !CALIBRATION_ARMS.includes(arm));
  const perSession = {};
  for (const arm of screenArms) {
    const own = rows.filter((row) => row.arm === arm);
    perSession[arm] = own.length ? Math.round(own.reduce((sum, row) => sum + inputOf(row.meter), 0) / own.length) : null;
  }
  const known = Object.values(perSession).filter((value) => value !== null);
  const sessionsRun = Math.min(n, devSessions);
  return {
    readings,
    sd: worst,
    effect,
    n,
    fitsDev: n <= devSessions,
    verdict: n <= devSessions ? "fits the dev partition" : `needs ${n} sessions; dev holds ${devSessions}: to the owner`,
    arms: screenArms,
    inputTokensPerSessionByArm: perSession,
    estimatedInputTokens: known.length === screenArms.length ? known.reduce((a, b) => a + b, 0) * sessionsRun : null,
  };
}

/** The evidence report over the checkpoint rows. */
export function liveReport(rows, rule = SESSION_BENCH_TEST_RULE, { root, approval } = {}) {
  const arms = rule.arms.filter((arm) => rows.some((row) => row.arm === arm));
  const byArm = Object.fromEntries(arms.map((arm) => [arm, emptyArmTotals()]));
  const ids = rule.sessions.filter((id) => rows.some((row) => row.session === id));
  for (const id of ids)
    for (const arm of arms) {
      const row = rows.find((r) => r.arm === arm && r.session === id);
      if (row) accumulateArm(byArm[arm], id, row);
    }
  const configs = liveConfigs(rule).filter((config) => arms.includes(config.arm));
  const sizes = Object.fromEntries(ids.map((id) => [id, sessionSizes(createSession(id)).total]));
  const timing = Object.fromEntries(
    arms.map((arm) => {
      const own = rows.filter((row) => row.arm === arm);
      return [
        arm,
        {
          wallMs: own.reduce((sum, row) => sum + row.wallMs, 0),
          wallMsPerSession: own.length ? Math.round(own.reduce((sum, row) => sum + row.wallMs, 0) / own.length) : null,
          quotaWaitMs: own.reduce((sum, row) => sum + row.quotaWaitMs, 0),
        },
      ];
    }),
  );
  const report = sessionBenchReport({
    mode: "live",
    partition: rule.partition,
    file: sessionBenchPartitions(),
    window: rule.window,
    arms,
    configs,
    sharedHash: assertEqualTreatment(configs),
    ids,
    sizes,
    byArm,
    wallMs: Object.values(timing).reduce((sum, row) => sum + row.wallMs, 0),
    extra: {
      plan: rule.plan,
      model: rule.model,
      ruleHash: testRuleHash(rule),
      ...(approval ? { approvedAt: approval.approvedAt } : {}),
      complete:
        arms.length === rule.arms.length &&
        rows.filter((row) => rule.arms.includes(row.arm)).length === rule.arms.length * rule.sessions.length,
      rows: rows.length,
      timing,
      ...(root ? { wireUsage: wireUsage(join(root, "wire")) } : {}),
    },
  });
  if (rule.calibration) {
    // The calibration slice is reported apart: its arms are not screen arms and its sessions are a subset.
    const cal = calibrationRule(rule);
    const calRows = rows.filter((row) => cal.arms.includes(row.arm) && cal.sessions.includes(row.session));
    const calReport = calRows.length ? liveReport(calRows, cal, {}) : null;
    report.calibration = {
      arms: cal.arms,
      sessions: cal.sessions,
      scores: calReport?.scores ?? {},
      cost: calReport?.cost ?? {},
      liveGuardrails: calReport ? liveGuardrails(calReport, rule.liveGuardrails) : { complete: false, pass: false, rows: [] },
    };
  } else if (rule.liveGuardrails) report.liveGuardrails = liveGuardrails(report, rule.liveGuardrails);
  if (rule.screen) {
    report.screen = screenSize(report, rows, rule);
    // Owner, 2026-11-18 (mid-run): the D4 check penalizes a correct answer that mentions the old value (it must exclude
    // it), so D4 is reported as confounded and the screen is sized on D1-D3; the pre-registered D1-D4 sizing stays above.
    report.screenD1toD3 = { ...screenSize(report, rows, rule, 36, ["D1", "D2", "D3"]), classes: ["D1", "D2", "D3"] };
    report.d4Confound =
      "the D4 check requires the announcement to include the new value and exclude the old one, so a correct answer that mentions the change fails; D4 rates in this report are confounded (fixed as Session-Bench v3 before Task 12)";
  }
  return report;
}

// --- the run ---------------------------------------------------------------------------------------------------------

function ordered(rule, done) {
  const sizes = Object.fromEntries(rule.sessions.map((id) => [id, sessionSizes(createSession(id)).total]));
  const smallest = [...rule.sessions].sort((a, b) => sizes[a] - sizes[b])[0];
  const pending = (arm, ids) => ids.filter((id) => !done.has(`${arm}:${id}`)).map((session) => ({ arm, session }));
  return {
    smoke: pending("memory-off-llm", [smallest]),
    calibration: (() => {
      const cal = calibrationRule(rule);
      return cal.arms.flatMap((arm) => pending(arm, cal.sessions));
    })(),
    rest: rule.arms.filter((arm) => !CALIBRATION_ARMS.includes(arm)).flatMap((arm) => pending(arm, rule.sessions)),
  };
}

/**
 * The rule's embedder for the Mem0 arm: Task 12's BGE-M3 on llama.cpp when the rule names it, Gemini when the rule
 * names Gemini (Task 11); any other embedder is refused, never a silent fallback.
 */
async function ruleEmbedder(rule) {
  if (!rule.arms.includes("mem0")) return undefined;
  if (rule.embedder?.provider === LOCAL_EMBEDDER.provider) {
    const status = localEmbedderStatus();
    if (!status.installed) throw new SessionBenchStop(`local embedder: ${status.reason}`);
    return localEmbedder();
  }
  if (rule.embedder?.provider !== GEMINI_EMBEDDER.provider) throw new SessionBenchStop(`unknown embedder ${rule.embedder?.provider}`);
  return geminiEmbedder();
}

export async function runLive({ rule = SESSION_BENCH_TEST_RULE, log = defaultLog, extendReport } = {}) {
  const gate = JSON.parse(readFileSync(SESSION_BENCH_TEST_GATE, "utf8"));
  const approval = assertTestGate(gate, rule);
  const { checkGuardrails } = await import("./guardrails.mjs");
  const pre = await checkGuardrails({ probe: false });
  if (!pre.pass) throw new SessionBenchStop("a pre-run guardrail failed (guardrails.mjs); no arm may run");
  if (rule.arms.includes("mem0") && !mem0Status().installed) throw new SessionBenchStop(`Mem0: ${mem0Status().reason}`);
  const { loadEnv } = await import("../run.mjs");
  loadEnv();
  const embedder = await ruleEmbedder(rule);
  const root = liveRoot(rule);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const checkin = () => {
    const p = projection(readLiveRows(root), rule, wireUsage(join(root, "wire")).inputTokens);
    log(
      `check-in: ${p.rows}/${p.of} rows; ${(p.spentInputTokens / 1e6).toFixed(1)}M input spent; projected ${(p.projectedInputTokens / 1e6).toFixed(1)}M of the ${(p.ceilingInputTokens / 1e6).toFixed(0)}M ceiling`,
    );
    return p;
  };
  const timer = setInterval(checkin, 30 * 60_000);
  const beforeEach = () => {
    if (isPaused(root)) throw new Error("SessionBenchPaused");
    if (wireUsage(join(root, "wire")).inputTokens >= rule.ceilingInputTokens) throw new Error("SessionBenchTokenCeiling");
  };
  // After each stage: a pause raised during it ends the run here (the stage's in-flight jobs have checkpointed).
  const pausePoint = () => {
    const reason = haltReason(root);
    if (reason) throw new SessionBenchStop(reason);
    if (isPaused(root))
      throw new SessionBenchPaused(`paused at ${readLiveRows(root).length}/${rule.arms.length * rule.sessions.length} rows`);
  };
  // A stop raised inside a job ends the run for the owner: the pause file names it, no new job starts, and
  // `pausePoint` turns it into a SessionBenchStop (exit 3) once the stage's jobs in flight end.
  const workerFaults = new Map();
  const halt = (reason) => {
    writeFileSync(pauseFile(root), `${new Date().toISOString()} STOP: ${reason}\n`);
    log(`STOP: ${reason}`);
    throw new Error("SessionBenchPaused");
  };
  const jobs = (list) =>
    list.map(({ arm, session }) => async () => {
      beforeEach();
      log(`start ${arm} ${session}`);
      let row;
      try {
        row = await runLiveJob({ root, rule, arm, sessionId: session, embedder, log });
      } catch (error) {
        if (error instanceof SessionBenchStop) halt(error.message);
        if (error instanceof SessionBenchWorkerFault) {
          const faults = (workerFaults.get(`${arm}:${session}`) ?? 0) + 1;
          workerFaults.set(`${arm}:${session}`, faults);
          if (faults >= WORKER_FAULT_LIMIT) halt(`${error.message}; the memory worker failed this job ${faults} times`);
        }
        throw error;
      }
      const passed = Object.values(row.status).filter((s) => s.status === "completed").length;
      log(
        `done ${arm} ${session}: ${row.checks.filter((c) => c.pass).length}/${row.checks.length} checks, ${passed}/${Object.keys(row.status).length} runs completed, ${(inputOf(row.meter) / 1e6).toFixed(2)}M input, ${Math.round(row.wallMs / 60_000)} min`,
      );
      checkin();
    });
  const options = {
    isFault: (error) => error instanceof SessionBenchProviderFault,
    isCeiling: (error) => ["SessionBenchTokenCeiling", "SessionBenchPaused"].includes(error?.message),
  };
  try {
    const done = () => new Set(readLiveRows(root).map((row) => `${row.arm}:${row.session}`));
    let plan = ordered(rule, done());
    await pool(jobs(plan.smoke), 1, log, options);
    pausePoint();
    const [{ session: smokeSession }] = ordered(rule, new Set()).smoke;
    const smoke = readLiveRows(root).find((row) => row.arm === "memory-off-llm" && row.session === smokeSession);
    if (!smoke) throw new SessionBenchIncomplete("the smoke job left no row");
    // Task 11's rule allows only the agent's own limits; a rule naming `smokeOutcomes` (Task 12) allows every outcome the
    // arm owns and is scored on (a window overflow included), as the job's fault rule does.
    const smokeFailed = rule.smokeOutcomes ? faultedTasks(smoke.status) : failedTasks(smoke.status);
    if (smokeFailed.length || smoke.meter.providerErrors)
      throw new SessionBenchStop(`smoke: ${smokeFailed.length} failed tasks, ${smoke.meter.providerErrors} provider errors`);
    const projected = checkin();
    if (projected.projectedInputTokens > rule.ceilingInputTokens)
      throw new SessionBenchStop("smoke: the projected total exceeds the ceiling");
    plan = ordered(rule, done());
    // A rule without calibration arms (Task 12's screen: Task 11 checked the live guardrails) skips this stage.
    if (rule.liveGuardrails) {
      await pool(jobs(plan.calibration), rule.concurrency, log, options);
      pausePoint();
      const calibration = liveReport(readLiveRows(root), rule, { root });
      const g = calibration.calibration?.liveGuardrails ?? calibration.liveGuardrails;
      if (!g.complete) throw new SessionBenchIncomplete("calibration did not finish (ceiling or failed jobs); re-run --live to resume");
      if (!g.pass) throw new SessionBenchStop(`a live guardrail missed: ${JSON.stringify(g.rows)}`);
      log(`live guardrails hold: ${JSON.stringify(g.rows)}`);
    }
    plan = ordered(rule, done());
    await pool(jobs(plan.rest), rule.concurrency, log, options);
    pausePoint();
  } finally {
    clearInterval(timer);
    // The local embedder is a child server: left running, it holds the process after a pause or a stop (2026-11-19).
    await embedder?.stop?.();
  }
  return writeEvidence({ rule, root, approval, log, extendReport });
}

export function writeEvidence({
  rule = SESSION_BENCH_TEST_RULE,
  root = liveRoot(rule),
  approval,
  log = defaultLog,
  extendReport = (report) => report,
} = {}) {
  const report = extendReport(liveReport(readLiveRows(root), rule, { root, approval }), rule);
  writeFileSync(evidenceOf(rule), `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  const parts = [`evidence: ${report.rows} rows`, `complete ${report.complete}`];
  if (report.liveGuardrails) parts.push(`guardrails ${report.liveGuardrails.pass ? "hold" : "miss"}`);
  if (report.screen) parts.push(`screen n ${report.screen.n}`);
  if (report.verdict) parts.push(`verdict ${JSON.stringify(report.verdict.summary)}`);
  log(parts.join("; "));
  return report;
}

const defaultLog = (line) => process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);

export async function main(argv, { rule = SESSION_BENCH_TEST_RULE, extendReport } = {}) {
  // A run once ended with exit 0 mid-jobs and no log line (2026-11-18, plan 218.3 Task 11): log how the process ends.
  process.on("beforeExit", (code) => defaultLog(`beforeExit ${code}: the event loop drained`));
  process.on("exit", (code) => defaultLog(`exit ${code}`));
  process.on("uncaughtException", (error) => {
    defaultLog(`uncaughtException: ${error?.stack ?? error}`);
    process.exit(4);
  });
  process.on("unhandledRejection", (error) => defaultLog(`unhandledRejection: ${error?.stack ?? error}`));
  if (argv.includes("--status")) {
    const root = liveRoot(rule);
    console.log(JSON.stringify(projection(readLiveRows(root), rule, wireUsage(join(root, "wire")).inputTokens), null, 2));
    return;
  }
  if (argv.includes("--report")) {
    writeEvidence({ rule, extendReport });
    return;
  }
  if (argv.includes("--pause")) {
    const root = liveRoot(rule);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(pauseFile(root), `${new Date().toISOString()}\n`);
    console.log(
      `paused: no new job starts; jobs in flight finish and checkpoint, then the run exits. Resume: --resume, then start --live again.`,
    );
    return;
  }
  if (argv.includes("--resume")) {
    const root = liveRoot(rule);
    if (isPaused(root)) unlinkSync(pauseFile(root));
    console.log("pause cleared; start the run again with --live (it resumes from the checkpoint rows)");
    return;
  }
  if (isPaused(liveRoot(rule))) {
    defaultLog("the run is paused (PAUSE file); clear it with --resume first");
    process.exit(5);
  }
  try {
    const report = await runLive({ rule, extendReport });
    // A run that ends with jobs missing below the ceiling (a job dropped after its retries in this process) exits 6, so
    // the systemd unit restarts it (Restart=on-failure) and it resumes from the checkpoint rows. The ceiling, a pause
    // (exit 0 / 5) and a stop for the owner (exit 3) do not restart.
    const root = liveRoot(rule);
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
      const root = liveRoot(rule);
      if (wireUsage(join(root, "wire")).inputTokens < rule.ceilingInputTokens && !isPaused(root)) {
        defaultLog(`INCOMPLETE: ${error.message}; exit 6 so the unit restarts and resumes`);
        process.exit(6);
      }
      defaultLog(`STOP at the ceiling or a pause: ${error.message}`);
      writeEvidence({ rule, extendReport });
      process.exit(3);
    }
    if (error instanceof SessionBenchStop) {
      defaultLog(`STOP: ${error.message}`);
      writeEvidence({ rule, extendReport });
      process.exit(3);
    }
    throw error;
  }
}

if (import.meta.main) {
  if (process.argv.includes("--rule"))
    console.log(JSON.stringify({ ruleHash: testRuleHash(), rule: SESSION_BENCH_TEST_RULE, live: liveConfigHashes() }, null, 2));
  else await main(process.argv.slice(2));
}
