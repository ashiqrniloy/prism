/**
 * Plan 218.5 Task 5: the long bench's runner.
 *
 *   timeout 1800 bun scripts/memory-bench/session-bench-long/run.mjs --offline [--arms a,b] [--sessions id,id]
 *                                                                    [--max-tasks n] [--output report.json]
 *
 * Offline, the answer model and every memory worker are request-driven mocks, so the run validates the harness end to
 * end and costs nothing. The live run is plan 218.5 Task 6's `live.mjs`, on the owner's word.
 *
 * Session-Bench v3's runner (`../session-bench/run.mjs`) is extended by import, never edited: its window and meter
 * (`windowedProviders`), shared config (G6), system prompt and scope message, the deferred-call package and its
 * accumulators are reused. What differs here:
 *
 * - **Phases.** A long session has four phase scopes. The runner sends each before the phase's first task (1, 26, 51,
 *   76) to every arm, and through `memory:scope` to the WM arms. `amnesic` opens every task with its phase's scope.
 * - **Calibration.** `oracle-notes` gets `arms.mjs` `oracleNotes` before every task, through `state.memoryBlock`.
 * - **The offline mock** knows a dependency only when every string of `dependencyEvidence(dep)` is visible, so a `D2R`
 *   needs the revoke and the standing rule. Its STM worker records at plan 218.5 Task 2's measured rates (G11).
 * - **Instrumentation** (`instrument.mjs`): per task, counts of the block, the pool, what the bound left out, the
 *   Rehearsal drops and WM; per dependent, whether its sources' records were in the block (ids only). Each row's session
 *   ledger can be kept in the run root through `inspect`, never in evidence.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { configHash } from "../session-bench/arms/prism.mjs";
import { createMem0Session, hashEmbedder, startModelEndpoint } from "../session-bench/arms/third-party.mjs";
import { createWorkspace, WORKSPACE_TOOL_NAMES, WORKSPACE_TOOL_SCHEMAS } from "../session-bench/env/workspace.mjs";
import {
  accumulateArm,
  armCost,
  countStmFallbacks,
  DEFERRED_TOOL_CALL_TEXT,
  deferredCallsPackage,
  emptyArmTotals,
  emptyMeter,
  MAX_OUTPUT_TOKENS,
  RUN_LIMITS,
  SYSTEM_PROMPT,
  scopeMessage,
  sessionBenchWorkerMock,
  sessionFaults,
  sharedConfig,
  windowedProviders,
} from "../session-bench/run.mjs";
import { scoreRows } from "../session-bench/score.mjs";
import { dependencyEvidence, doneText, planCalls, rederivationCounts, taskDependencies } from "./agents.mjs";
import {
  assertLongEqualTreatment,
  LONG_ARMS,
  LONG_CALIBRATION_ARMS,
  LONG_DECISION_ARMS,
  longArmConfig,
  longArmMemoryConfig,
  longArmPackages,
  MEMORY_SYSTEM_ARMS,
  oracleNotes,
} from "./arms.mjs";
import { LONG_CHECK_CLASSES, taskCheckRows } from "./checks.mjs";
import { createSession, partitionIds, sessionBenchLongPartitions, WINDOW_TOKENS } from "./generate.mjs";
import { dependentBlocks, firstAfterTask, foldStoredSession, sessionPressureSummary, taskPressure } from "./instrument.mjs";
import { FIXED_REQUEST_PARTS, FIXED_REQUEST_TOKENS, GATE_FILE, LIVE_FIXED_REQUEST_TOKENS, PRODUCT_CHARS_PER_TOKEN } from "./pressure.mjs";

export const SESSION_BENCH_LONG_REPORT_KIND = "session-bench-long-report-v1";
const OFFLINE_MAIN = { provider: "mock", model: "main" };
const OFFLINE_WORKER = "worker/session-bench";

/**
 * The offline STM worker's record rates, in description tokens per task: plan 218.5 Task 2's measurement (the gate
 * record's `design.pressure`). The product keeps each short user message word for word on its own (`verbatim`, `high`),
 * so the worker adds the rest of `high` as one user statement, and `medium` as the task's outcome plus one tool result.
 */
export function workerRates(gate = JSON.parse(readFileSync(GATE_FILE, "utf8"))) {
  const pressure = gate.design.pressure;
  return Object.freeze({
    mediumTokens: pressure.tokensPerTaskByRelevance.medium,
    statementTokens: Math.max(0, Math.round((pressure.tokensPerTaskByRelevance.high - pressure.verbatimTokensPerTask) * 10) / 10),
  });
}

const plain = (content) =>
  Array.isArray(content) ? content.map((block) => (block.type === "text" ? block.text : "")).join("") : String(content ?? "");
function leaves(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) leaves(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) leaves(item, out);
  return out;
}

/**
 * The offline answer model: v3's (`sessionBenchAgentMock`), except that it knows a dependency only when every string of
 * `dependencyEvidence(dep)` is visible in the request (the transcript, a compaction summary or a context block), never
 * in the current task's own prompt.
 */
export function longAgentMock(state) {
  let ids = 0;
  return {
    id: "mock",
    async *generate(request) {
      const { session, ws } = state;
      if (!state.task) {
        yield providerTextDelta("OK.");
        yield providerDone();
        return;
      }
      const task = session.tasks[state.task - 1];
      if (state.knows?.task !== task.n) {
        const prompt = `Task ${task.n}.`;
        const visible = leaves([
          (request.messages ?? []).filter((message) => !(message.role === "user" && plain(message.content).startsWith(prompt))),
          request.context ?? [],
        ]).join("\n");
        const known = new Set(
          taskDependencies(session, task).flatMap((dep) =>
            dependencyEvidence(dep).every((text) => visible.includes(text)) ? [dep.id] : [],
          ),
        );
        state.knows = { task: task.n, known, check: (id) => known.has(id) };
      }
      const calls = planCalls(task, state.knows.check);
      const done = ws.calls.filter((call) => call.task === task.n).length;
      if (done < calls.length) yield providerToolCall(toolCallContent(`sbl-${++ids}`, calls[done][0], calls[done][1]));
      else yield providerTextDelta(doneText(task, state.knows.check));
      yield providerDone();
    },
  };
}

const LINE = /^\[[^\]]+\] \[([^\]]+)\] (user|assistant): (\{.*)$/;
const FILLER_PREFIX = "Tool results of task";
const prompt = (request) =>
  (request.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => plain(message.content))
    .join("\n");
const filler = (n, chars) => {
  const words = ["checked", "workspace", "output", "lines", "listed", "values", "entries", "matched", "reviewed", "state"];
  let text = `${FILLER_PREFIX} ${n}:`;
  for (let i = 0; text.length < chars; i++) text += ` ${words[(n + i) % words.length]}`;
  return text;
};

/**
 * The offline workers. Summaries and Mem0's extraction are v3's (`sessionBenchWorkerMock`). WM keeps every record
 * it is offered but the tool-result padding. The STM
 * recorder writes, per task, at `rates`: one user `statement` (high) citing the task prompt, the task's closing line as
 * an `outcome` (medium) and one tool-result `result` (medium) that brings the task's medium tokens to the measured rate.
 * It writes no `request`: the product keeps each short user message word for word.
 */
export function longWorkerMock(rates = workerRates()) {
  const v3 = sessionBenchWorkerMock();
  const statementChars = Math.round(rates.statementTokens * PRODUCT_CHARS_PER_TOKEN);
  const mediumChars = Math.round(rates.mediumTokens * PRODUCT_CHARS_PER_TOKEN);
  return {
    id: "worker",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (tools.includes("judge")) {
        // WM keeps what it is offered except the tool-result padding, so its items stay near the pool's size; v3's
        // mock keeps every record, which a 100-task session cannot carry (its block outgrows the window).
        const keep = [...prompt(request).matchAll(/^- \[([rja])([0-9]+)\] (.*)$/gm)]
          .filter((match) => !match[3].includes(FILLER_PREFIX))
          .map((match) => ({ [match[1]]: Number(match[2]), reason: "kept offline" }));
        if (keep.length && !(request.messages ?? []).some((message) => message.role === "tool"))
          yield providerToolCall(toolCallContent("k1", "judge", { keep }));
        yield providerDone();
        return;
      }
      if (!tools.includes("record_event")) {
        yield* v3.generate(request);
        return;
      }
      if ((request.messages ?? []).some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      const offersStatus = Boolean(request.tools.find((tool) => tool.name === "record_event")?.parameters?.properties?.status);
      let k = 0;
      const record = (args) => providerToolCall(toolCallContent(`w${++k}`, "record_event", args));
      for (const line of prompt(request).split("\n")) {
        const match = LINE.exec(line);
        if (!match) continue;
        let message;
        try {
          message = JSON.parse(match[3]);
        } catch {
          continue;
        }
        const text = plain(message.content).replace(/\s+/g, " ").trim();
        const task = /^Task (\d+)(?:\.| done:)/.exec(text);
        if (!task) continue;
        const n = Number(task[1]);
        if (match[2] === "user" && statementChars > 0)
          yield record({
            kind: "statement",
            description: `User asked in task ${n}: ${text}`.slice(0, statementChars),
            sourceEntryIds: [match[1]],
            relevance: "high",
          });
        else if (match[2] === "assistant") {
          const outcome = text.slice(0, 400);
          yield record({
            kind: "outcome",
            description: outcome,
            sourceEntryIds: [match[1]],
            relevance: "medium",
            ...(offersStatus ? { status: "passed" } : {}),
          });
          if (mediumChars - outcome.length > 0)
            yield record({
              kind: "result",
              description: filler(n, mediumChars - outcome.length),
              sourceEntryIds: [match[1]],
              relevance: "medium",
            });
        }
      }
      yield providerDone();
    },
  };
}

/** The workspace tools as Prism tools over one live workspace (v3's, with the deferred answer). */
function prismTools(state, meter) {
  return WORKSPACE_TOOL_NAMES.map((name) => ({
    name,
    ...WORKSPACE_TOOL_SCHEMAS[name],
    execute(args, context) {
      if (state.deferred?.has(context.toolCallId)) {
        meter.deferredToolCalls++;
        const text = DEFERRED_TOOL_CALL_TEXT;
        return { toolCallId: context.toolCallId, name, value: text, content: [{ type: "text", text }] };
      }
      const text = state.ws.call(name, args);
      return { toolCallId: context.toolCallId, name, value: text, content: [{ type: "text", text }] };
    },
  }));
}

/** The phase that opens at task `n`, if one does. */
const phaseOpening = (session, n) => session.phases.find((phase) => phase.from === n);
const phaseOf = (session, n) => session.phases.find((phase) => phase.from <= n && n <= phase.to);

/**
 * One long session on one arm. Returns check rows and task rows WITHOUT the arm (G7), the per-task status, the meter,
 * and the instrumentation (`pressure`: one row per task; `dependents`: one row per dependent; `summary`). `maxTasks`
 * stops after that many tasks (the guardrails' probes); a row that stops early never counts toward a score.
 */
/**
 * Task 7 (owner, 2026-11-24): the main agent's own output reserve. The input cap stays W minus the harness's 2,048-token
 * reserve (29,952 at W 32,000), so the pool, the kept tail, the mid-loop trigger and the job sizes stay the design's,
 * and the main agent's model window grows by what its reserve grows (46,336 at 16,384): hy4-flash-free at thinking low
 * spent the whole 2,048 on reasoning on hard turns and ended its task with no answer. The memory worker keeps W and its
 * `workerOutput` room. At the default (2,048) the shared config, and so every offline hash, is unchanged.
 */
export function longSharedConfig({ mainOutputTokens = MAX_OUTPUT_TOKENS, ...options }) {
  const shared = sharedConfig(options);
  return mainOutputTokens === MAX_OUTPUT_TOKENS ? shared : { ...shared, mainOutputTokens };
}
/** The main agent's model: its window is the input cap plus its own reserve, and every request asks for that reserve. */
export function mainModel(model, { window, mainOutputTokens = MAX_OUTPUT_TOKENS }) {
  const limits = { contextWindow: window - MAX_OUTPUT_TOKENS + mainOutputTokens, maxOutputTokens: mainOutputTokens };
  if (mainOutputTokens === MAX_OUTPUT_TOKENS) return { ...model, limits };
  return { ...model, limits, parameters: { ...model.parameters, maxTokens: mainOutputTokens } };
}

export async function runLongArmSession({
  session,
  arm,
  providers,
  model,
  workerModel,
  window = WINDOW_TOKENS,
  mainOutputTokens = MAX_OUTPUT_TOKENS,
  temperature = 0,
  embedder = hashEmbedder(),
  thinkingLevel,
  limits = RUN_LIMITS,
  workerSpec,
  parallelToolCalls,
  toolCallsPerTurn,
  workerReasoningEffort,
  workerOutput,
  maxTasks = session.tasks.length,
  onTask = () => {},
  trace,
  inspect,
}) {
  const config = longArmConfig(
    arm,
    longSharedConfig({
      mainOutputTokens,
      model,
      temperature,
      window,
      thinkingLevel,
      limits,
      parallelToolCalls,
      toolCallsPerTurn,
      workerReasoningEffort,
      workerOutput,
    }),
  );
  const memory = config.memory;
  const ws = createWorkspace(session.env);
  const deferred = toolCallsPerTurn === 1 ? new Set() : undefined;
  const state = { session, ws, task: 0, knows: null, memoryBlock: null, deferred };
  const meter = emptyMeter();
  if (trace) Object.defineProperty(meter, "trace", { value: trace, enumerable: false });
  const wrapped = windowedProviders(providers(state), {
    window,
    meter,
    deferred,
    workerReasoningEffort,
    workerOutput,
    workerMaxOutputTokens: workerSpec?.limits?.maxOutputTokens,
  });
  const thirdParty = memory.thirdParty
    ? await startThirdParty({ session, arm, wrapped, workerModel, workerSpec, thinkingLevel, window, embedder, meter })
    : null;
  const packageWorker = workerSpec ? { ...workerSpec, limits: { contextWindow: window, maxOutputTokens: MAX_OUTPUT_TOKENS } } : workerModel;
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: mainModel(model, { window, mainOutputTokens }),
    instructions: SYSTEM_PROMPT,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    packages: [
      providerPackage("session-bench-long-providers", wrapped),
      ...(await longArmPackages(arm, { workerModel: packageWorker, inputCap: window - MAX_OUTPUT_TOKENS, state })),
      ...(deferred ? [deferredCallsPackage(state, meter)] : []),
    ],
    tools: { add: prismTools(state, meter) },
    slots: { store },
    limits: { ...limits },
  });
  const instrumented = MEMORY_SYSTEM_ARMS.includes(arm);
  const status = {};
  const checks = [];
  const pressure = [];
  const dependents = [];
  let handle;
  let opened = 0;
  const sessionId = (index) => `${session.id}-${arm}-${index}`;
  const open = async () => {
    if (handle) await handle.close();
    handle = await agent.session({ id: sessionId(opened++), create: true });
  };
  const sendScope = async (phase) => {
    state.task = 0;
    const intro = scopeMessage(phase.scope);
    const answer = await handle.run(intro);
    await thirdParty?.add(intro, answer);
    if (memory.setScope) await agent.commands.run("memory:scope", { text: phase.scope }, { session: handle });
  };
  let folded;
  try {
    const tasks = session.tasks.slice(0, maxTasks);
    for (const task of tasks) {
      if (memory.freshSessionPerTask) {
        await open();
        await sendScope(phaseOf(session, task.n));
      } else {
        if (!handle) await open();
        const phase = phaseOpening(session, task.n);
        if (phase) await sendScope(phase);
      }
      ws.task = task.n;
      state.task = task.n;
      state.knows = null;
      state.memoryBlock = thirdParty ? await thirdParty.retrieve(task.prompt) : memory.oracleNotes ? oracleNotes(session, task.n) : null;
      const result = await handle.run(task.prompt);
      const limit = result?.error?.breach?.limit ?? /^Run limit exceeded: (\w+)$/.exec(String(result?.error?.message ?? ""))?.[1];
      status[task.n] = {
        status: result?.status ?? "unknown",
        ...(result?.error?.code ? { code: result.error.code } : {}),
        ...(limit ? { limit } : {}),
      };
      checks.push(...taskCheckRows(session, task, ws.state));
      await thirdParty?.add(task.prompt, result);
      if (instrumented) {
        folded = foldStoredSession(await store.list(sessionId(0)));
        pressure.push(taskPressure(folded, task.n));
        dependents.push(...dependentBlocks(folded, session, task.n));
      }
      await onTask({ task: task.n, of: tasks.length, status: status[task.n], meter, pressure: pressure.at(-1) });
    }
    await handle?.close();
    for (let index = 0; index < opened; index++) countStmFallbacks(await store.list(sessionId(index)), meter.stmFallbacks);
    // The run root keeps the ledger (never evidence): the session store after the run.
    if (inspect) await inspect({ store, sessionIds: Array.from({ length: opened }, (_, index) => sessionId(index)) });
  } finally {
    await agent.dispose();
    thirdParty?.close();
  }
  const counts = rederivationCounts(ws.calls);
  return {
    checks,
    tasks: session.tasks.slice(0, maxTasks).map((task) => ({
      session: session.id,
      task: task.n,
      ...(counts[task.n] ?? { rederivations: 0, toolCalls: 0 }),
    })),
    status,
    meter,
    configHash: configHash(config),
    instrumentation: instrumented ? { pressure, dependents, summary: sessionPressureSummary(pressure, folded) } : null,
  };
}

/** A third-party arm's runtime for one session: v3's `startThirdParty`, which v3 does not export (same code path). */
async function startThirdParty({ session, arm, wrapped, workerModel, workerSpec, thinkingLevel, window, embedder, meter }) {
  const { applyDefaultProviderRequestOptions } = await import("@arnilo/prism/provider-kit");
  const [providerId, ...rest] = String(workerModel).split("/");
  const worker = wrapped.find((provider) => provider.id === providerId);
  if (!worker) throw new Error(`SessionBenchLongRun: ${arm} needs the worker provider ${providerId}`);
  const spec = {
    ...(workerSpec ?? {}),
    provider: providerId,
    model: rest.join("/"),
    limits: { contextWindow: window, maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
  const chat = async ({ messages }) => {
    const request = applyDefaultProviderRequestOptions(
      {
        model: spec,
        messages: messages.map((message) => ({
          role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
          content: [{ type: "text", text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }],
        })),
      },
      { sessionId: `${session.id}-${arm}-mem0`, ...(thinkingLevel ? { thinkingLevel } : {}) },
    );
    let text = "";
    let usage;
    for await (const chunk of worker.generate(request)) {
      if (chunk.type === "error") throw new Error(chunk.error?.message ?? "provider error");
      if (chunk.type === "content_delta" && chunk.content?.type === "text") text += chunk.content.text;
      else if (chunk.type === "usage" || chunk.type === "done") usage = chunk.usage ?? usage;
    }
    return { text, usage };
  };
  const endpoint = startModelEndpoint({ chat, embed: (texts) => embedder.embed(texts), meter });
  let system;
  try {
    system = await createMem0Session({ sessionId: session.id, baseURL: endpoint.baseURL, dims: embedder.dims, workerModel: spec.model });
  } catch (error) {
    endpoint.stop();
    throw error;
  }
  const guard = async (work) => {
    try {
      return await work();
    } catch {
      meter.thirdPartyErrors++;
      return null;
    }
  };
  return {
    add: (prompt, result) =>
      guard(() =>
        system.add([
          { role: "user", content: prompt },
          { role: "assistant", content: typeof result?.text === "string" ? result.text : "" },
        ]),
      ),
    retrieve: (query) => guard(() => system.retrieve(query)),
    close() {
      system.close();
      endpoint.stop();
    },
  };
}

/** Pass counts per class and bucket (descriptive; plan 218.5 Task 6 owns the analysis). */
export function bucketScores(checks) {
  const out = {};
  for (const row of checks) {
    const key = row.bucket ?? "none";
    const cell = ((out[key] ??= {})[row.class] ??= { pass: 0, total: 0 });
    cell.total++;
    if (row.pass) cell.pass++;
  }
  return out;
}

/** An arm's instrumentation over its sessions, as per-session summaries (counts only). */
const pressureBySession = (rows) => Object.fromEntries(rows.map(([id, instrumentation]) => [id, instrumentation.summary]));

/**
 * The long report over accumulated arms: descriptive scores (blind, G7), pass counts per bucket, cost, faults and the
 * instrumentation summaries. The pre-registered comparisons and the verdict are plan 218.5 Task 6's.
 */
export function longReport({ mode, file, window, arms, configs, sharedHash, ids, byArm, instrumentation, wallMs, extra = {} }) {
  const scores = Object.fromEntries(arms.map((arm) => [arm, scoreRows({ checks: byArm[arm].checks, tasks: byArm[arm].tasks })]));
  return {
    kind: SESSION_BENCH_LONG_REPORT_KIND,
    mode,
    partition: "dev",
    benchmark: { version: file.version, templateHash: file.templateHash, idsHash: file.idsHash, sessionsHash: file.sessionsHash },
    window,
    fixedRequestTokens: { offline: FIXED_REQUEST_TOKENS, live: LIVE_FIXED_REQUEST_TOKENS, toolList: FIXED_REQUEST_PARTS.toolList },
    arms,
    classes: LONG_CHECK_CLASSES,
    configHashes: Object.fromEntries(configs.map((config) => [config.arm, configHash(config)])),
    sharedConfigHash: sharedHash,
    sessions: ids,
    scores: Object.fromEntries(arms.map((arm) => [arm, { overall: scores[arm].overall, sessions: scores[arm].sessions }])),
    buckets: Object.fromEntries(arms.map((arm) => [arm, bucketScores(byArm[arm].checks)])),
    cost: Object.fromEntries(arms.map((arm) => [arm, armCost(byArm[arm].meter, scores[arm].overall.tasksPassed)])),
    faults: Object.fromEntries(arms.map((arm) => [arm, sessionFaults(byArm[arm].status)])),
    pressure: Object.fromEntries(
      arms.filter((arm) => instrumentation[arm]?.length).map((arm) => [arm, pressureBySession(instrumentation[arm])]),
    ),
    wallMs,
    ...extra,
  };
}

/** One session on each arm, offline, in arm order: `{ id, arm, result }` rows. */
async function runOfflineSession(id, { arms, maxTasks, window, onSession }) {
  const session = createSession(id);
  const rows = [];
  for (const arm of arms) {
    const result = await runLongArmSession({
      session,
      arm,
      providers: (state) => [longAgentMock(state), longWorkerMock()],
      model: OFFLINE_MAIN,
      workerModel: OFFLINE_WORKER,
      window,
      maxTasks,
    }).catch((error) => {
      throw new Error(`SessionBenchLongRun: ${id} on ${arm}: ${error instanceof Error ? error.message : String(error)}`);
    });
    rows.push({ id, arm, result });
    await onSession({ id, arm, result });
  }
  return rows;
}

/**
 * The same sessions in `jobs` child processes (`--child`), each writing its rows to a scratch file; the rows come back
 * in session order, so the report does not depend on `jobs`. Offline only: the mocks are CPU-bound.
 */
async function runOfflineChildren(ids, { arms, maxTasks, jobs }) {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "session-bench-long-"));
  try {
    const chunks = Array.from({ length: Math.min(jobs, ids.length) }, (_, k) => ids.filter((_, i) => i % jobs === k));
    await Promise.all(
      chunks.map(async (chunk, k) => {
        const out = join(dir, `rows-${k}.json`);
        const child = Bun.spawn(
          [
            process.execPath,
            new URL(import.meta.url).pathname,
            "--offline",
            "--child",
            out,
            "--sessions",
            chunk.join(","),
            "--arms",
            arms.join(","),
            ...(maxTasks ? ["--max-tasks", String(maxTasks)] : []),
          ],
          { stdout: "inherit", stderr: "inherit" },
        );
        if ((await child.exited) !== 0) throw new Error(`SessionBenchLongRun: child ${k} (${chunk.join(", ")}) failed`);
      }),
    );
    const rows = [];
    for (let k = 0; k < Math.min(jobs, ids.length); k++) rows.push(...JSON.parse(await readFile(join(dir, `rows-${k}.json`), "utf8")));
    return ids.flatMap((id) => arms.map((arm) => rows.find((row) => row.id === id && row.arm === arm)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run the dev partition (or `sessions`) on the chosen arms, offline; `jobs` > 1 splits the sessions across processes. */
export async function runLongBench({ arms = LONG_ARMS, sessions, maxTasks, window = WINDOW_TOKENS, jobs = 1, onSession = () => {} } = {}) {
  for (const arm of arms) if (!LONG_ARMS.includes(arm)) throw new Error(`SessionBenchLongRun: unknown arm ${arm}`);
  if (window !== WINDOW_TOKENS && jobs > 1) throw new Error("SessionBenchLongRun: --jobs runs at the bench's window only");
  const file = sessionBenchLongPartitions();
  const dev = partitionIds(file, "dev");
  const ids = sessions ?? dev;
  for (const id of ids)
    if (!dev.includes(id)) throw new Error(`SessionBenchLongRun: ${id} is not a dev session (G2: heldout stays unread)`);
  const configs = arms.map((arm) => longArmConfig(arm, sharedConfig({ window })));
  const sharedHash = assertLongEqualTreatment(configs);
  const started = performance.now();
  const rows = [];
  if (jobs > 1) rows.push(...(await runOfflineChildren(ids, { arms, maxTasks, jobs })));
  else for (const id of ids) rows.push(...(await runOfflineSession(id, { arms, maxTasks, window, onSession })));
  const byArm = Object.fromEntries(arms.map((arm) => [arm, emptyArmTotals()]));
  const instrumentation = Object.fromEntries(arms.map((arm) => [arm, []]));
  for (const { id, arm, result } of rows) {
    accumulateArm(byArm[arm], id, result);
    if (result.instrumentation) instrumentation[arm].push([id, result.instrumentation]);
  }
  return longReport({
    mode: "offline",
    file,
    window,
    arms,
    configs,
    sharedHash,
    ids,
    byArm,
    instrumentation,
    wallMs: Math.round(performance.now() - started),
    extra: {
      maxTasks: maxTasks ?? null,
      firstAfterTask: Object.fromEntries(ids.map((id) => [id, firstAfterTask(createSession(id, { verify: false }))])),
    },
  });
}

function parseArgs(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return {
    arms: value("--arms")?.split(",").filter(Boolean),
    sessions: value("--sessions")?.split(",").filter(Boolean),
    maxTasks: value("--max-tasks") ? Number(value("--max-tasks")) : undefined,
    jobs: value("--jobs") ? Number(value("--jobs")) : 1,
    child: value("--child"),
    output: value("--output"),
  };
}

const progress = ({ id, arm, result }) => {
  const summary = result.instrumentation?.summary;
  console.error(
    `${id} ${arm}: ${result.checks.filter((row) => row.pass).length}/${result.checks.length} checks${summary ? `; first overflow ${summary.firstOverflowTask}; first WM pass ${summary.firstWmPassTask}` : ""}`,
  );
};

if (import.meta.main && process.argv.includes("--live")) {
  console.error("session-bench-long: the live run is plan 218.5 Task 6's live.mjs, on the owner's word with its rule in the gate record");
  process.exit(2);
} else if (import.meta.main && process.argv.includes("--child")) {
  const args = parseArgs(process.argv.slice(2));
  const rows = [];
  for (const id of args.sessions)
    rows.push(...(await runOfflineSession(id, { arms: args.arms, maxTasks: args.maxTasks, window: WINDOW_TOKENS, onSession: progress })));
  await writeFile(args.child, JSON.stringify(rows));
} else if (import.meta.main) {
  const { child: _child, output, ...args } = parseArgs(process.argv.slice(2));
  const report = await runLongBench({ ...args, onSession: progress });
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`session-bench-long ${report.mode} dev: ${report.sessions.length} sessions, ${report.wallMs} ms`);
  for (const arm of report.arms) {
    const o = report.scores[arm].overall;
    const c = report.cost[arm];
    const cls = LONG_CHECK_CLASSES.map((name) => `${name} ${o.classes[name]?.pass ?? 0}/${o.classes[name]?.total ?? 0}`).join(" ");
    console.log(
      `${arm}: tasks ${o.tasksPassed}/${o.tasks}; ${cls}; tokens ${c.wholeRunTokens}; overflows ${c.overflows}; faults ${report.faults[arm].length}`,
    );
  }
}

export { LONG_ARMS, LONG_CALIBRATION_ARMS, LONG_DECISION_ARMS, longArmMemoryConfig };
