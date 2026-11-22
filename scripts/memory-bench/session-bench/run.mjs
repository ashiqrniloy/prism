/**
 * Plan 218.3 Task 9: Session-Bench's runner.
 *
 *   timeout 1800 bun scripts/memory-bench/session-bench/run.mjs --offline [--partition dev] [--arms a,b] [--per-template n]
 *                                                               [--window 32000] [--output report.json]
 *
 * Offline, the answer model and every memory worker are request-driven mocks, so the run validates the harness end to
 * end and costs nothing. `--live` hands over to `live.mjs` (plan 218.3 Task 11): the paid run, refused unless the gate
 * record approves its rule on the owner's word.
 *
 * The window W lives here, in the harness, never in the product: every provider call goes through `windowedProviders`,
 * which rejects a request over W's input cap as a provider would (`failureClass: "context_overflow"`), and the model the
 * product sees declares W as its window (the LOCA-Bench pilot's finding, plan 218.1 Task 4). The same wrapper meters
 * every call, the main agent's apart from every worker's (G9).
 */
import { writeFile } from "node:fs/promises";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  estimateMessageTokens,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { applyDefaultProviderRequestOptions, providerPackage } from "@arnilo/prism/provider-kit";
import { doneText, planCalls, rederivationCounts, taskDependencies } from "./agents.mjs";
import {
  armConfig,
  armPackages,
  assertEqualTreatment,
  CALIBRATION_ARMS,
  configHash,
  PRISM_ARMS,
  SESSION_BENCH_ARMS,
  SIDE_ARMS,
} from "./arms/prism.mjs";
import { isReferencePrompt } from "./arms/references.mjs";
import { createMem0Session, hashEmbedder, startModelEndpoint } from "./arms/third-party.mjs";
import { taskCheckRows } from "./checks.mjs";
import { createWorkspace, WORKSPACE_TOOL_NAMES, WORKSPACE_TOOL_SCHEMAS } from "./env/workspace.mjs";
import { createSession, partitionIds, sessionBenchPartitions, sessionSizes, WINDOW_TOKENS } from "./generate.mjs";
import { ANALYSIS, assertCompleteReport, compareArms, scoreRows } from "./score.mjs";

export const SESSION_BENCH_REPORT_KIND = "session-bench-report-v1";
/** Output tokens every arm reserves; the input cap is W minus this. */
export const MAX_OUTPUT_TOKENS = 2_048;
export const SYSTEM_PROMPT = [
  "You work in a team's workspace through tools: files, tickets, team channels, the service config and project checks.",
  "Each user message is one task. Do the task with the tools, then reply with one line that starts `Task N done:` and says what you did and anything you learned that later work may need.",
].join("\n");
export const scopeMessage = (scope) => `Here is the plan for this session. Do not act yet; reply OK and wait for each task.\n\n${scope}`;
/** Per-run limits every arm shares (G6). */
export const RUN_LIMITS = Object.freeze({
  maxTurns: 30,
  maxToolCalls: 30,
  maxInputTokens: 2_000_000,
  maxTotalTokens: 2_100_000,
  maxOutputTokens: 60_000,
  maxWallTimeMs: 900_000,
});
const MAIN_TOOLS = new Set(WORKSPACE_TOOL_NAMES);
const OFFLINE_MAIN = { provider: "mock", model: "main" };
const OFFLINE_WORKER = "worker/session-bench";

/**
 * The configuration every decision arm shares (G6): model, sampling, tools, system prompt, scope message, window, limits.
 * Live (plan 218.3 Task 11) adds the agent's `thinkingLevel`, the live limits and serial tool calls
 * (`parallelToolCalls: false`, sent by the harness's fetch); offline leaves them at their defaults, so the offline hash
 * is unchanged.
 */
export function sharedConfig({
  model = OFFLINE_MAIN,
  temperature = 0,
  window = WINDOW_TOKENS,
  thinkingLevel,
  limits = RUN_LIMITS,
  parallelToolCalls,
  toolCallsPerTurn,
  workerReasoningEffort,
  workerOutput,
} = {}) {
  return {
    model: { provider: model.provider, model: model.model },
    sampling: {
      temperature,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(parallelToolCalls === false ? { parallelToolCalls } : {}),
      ...(toolCallsPerTurn ? { toolCallsPerTurn } : {}),
      ...(workerReasoningEffort ? { workerReasoningEffort } : {}),
      ...(workerOutput ? { workerOutput } : {}),
    },
    tools: WORKSPACE_TOOL_NAMES.map((name) => ({ name, ...WORKSPACE_TOOL_SCHEMAS[name] })),
    systemPrompt: SYSTEM_PROMPT,
    scopeMessage: scopeMessage("<scope>"),
    window,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    limits,
  };
}

/** Text of every string leaf (message content, tool results, context blocks), for estimates and the mock's view. */
function leaves(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) leaves(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) leaves(item, out);
  return out;
}

/** The request's size as a provider would count it: Prism's message estimate plus tools and context blocks. */
export function requestTokens(request) {
  const messages = estimateMessageTokens(request.messages ?? []).tokens;
  const extras = JSON.stringify(request.tools ?? []).length + JSON.stringify(request.context ?? []).length;
  return messages + Math.ceil(extras / 3.5);
}

const isMain = (request) => (request.tools ?? []).some((tool) => MAIN_TOOLS.has(tool.name));

const emptySide = () => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
export const emptyMeter = () => ({
  main: emptySide(),
  /** Main-agent tool calls past the first of their turn, answered without running (`toolCallsPerTurn: 1`, Task 12). */
  deferredToolCalls: 0,
  /** STM records written without the model (Task 12 fallback), by reason; counts only. */
  stmFallbacks: { output_cap: 0, worker_error: 0 },
  workers: emptySide(),
  /** A third-party system's embedding calls (G9); its chat calls are worker calls. */
  embeddings: { calls: 0, inputTokens: 0 },
  /** Calls a third-party system made that failed (an overflow, a malformed answer); the run goes on without them. */
  thirdPartyErrors: 0,
  overflows: 0,
  /** Errors the provider itself answered (not the harness window): a live fault, never a score (plan 218.3 Task 11). */
  providerErrors: 0,
  /** Memory-worker calls that ended in a provider error after every retry (owner, 2026-11-21): a live fault, never a score. */
  workerErrors: 0,
  /** Memory-worker calls the session aborted (a background pass cut off when the session closed): never a fault. */
  workerAborts: 0,
  prefix: { sharedChars: 0, chars: 0 },
});

/**
 * Every provider of a run, wrapped: a request over W's input cap is rejected as a provider would reject it; every other
 * call is metered (main or worker, input, cached input, output; estimates when the provider reports no usage), and the
 * main agent's prefix stability is measured (characters each request shares with the previous one: the share a prefix
 * cache could serve, reported offline where mocks report no cache reads).
 */
/** The fixed answer to a main-agent tool call past the first of its turn (`toolCallsPerTurn: 1`). */
export const DEFERRED_TOOL_CALL_TEXT =
  "Session-Bench: one tool call per turn. This call was not run. Make it again on its own in your next turn.";

/**
 * `workerOutput: "window"` (Task 12, owner 2026-11-20): a memory-worker call may write what the window leaves after its
 * input (W minus the request's tokens), at most the worker model's own output limit, as a provider serving a W-token
 * model allows; the main agent keeps the fixed 2,048-token reserve. Without it every call has the fixed reserve.
 */
export function windowedProviders(providers, { window, meter, deferred, workerReasoningEffort, workerOutput, workerMaxOutputTokens }) {
  const cap = window - MAX_OUTPUT_TOKENS;
  let previous = "";
  return providers.map((provider) => ({
    ...provider,
    async *generate(input) {
      // Every arm's memory-worker calls (STM, WM, LLM compaction, Mem0) that set no reasoning effort of their own get the
      // rule's (Task 12, 2026-11-20); one that sets its own keeps it, so STM's retry with thinking off reaches the wire.
      const request =
        workerReasoningEffort && !isMain(input) && input.options?.compat?.reasoning_effort === undefined
          ? { ...input, options: { ...input.options, compat: { ...input.options?.compat, reasoning_effort: workerReasoningEffort } } }
          : { ...input };
      const tokens = requestTokens(request);
      if (workerOutput === "window" && !isMain(request) && tokens <= cap) {
        const room = Math.min(window - tokens, workerMaxOutputTokens ?? Number.POSITIVE_INFINITY);
        request.model = {
          ...request.model,
          parameters: { ...request.model?.parameters, maxTokens: room },
          limits: { ...request.model?.limits, maxOutputTokens: room },
        };
      }
      // Diagnostics only (never in a screen run): counts per request, no content.
      meter.trace?.({ type: "request", main: isMain(request), tokens, cap, overflow: tokens > cap });
      if (tokens > cap) {
        meter.overflows++;
        yield {
          type: "error",
          error: {
            name: "ContextWindowExceeded",
            message: `request of ${tokens} tokens exceeds the ${window}-token window`,
            failureClass: "context_overflow",
          },
        };
        return;
      }
      const main = isMain(request);
      const side = main ? meter.main : meter.workers;
      side.calls++;
      if (main) {
        const text = JSON.stringify(request.messages ?? []);
        let shared = 0;
        const limit = Math.min(text.length, previous.length);
        while (shared < limit && text.charCodeAt(shared) === previous.charCodeAt(shared)) shared++;
        meter.prefix.sharedChars += shared;
        meter.prefix.chars += text.length;
        previous = text;
      }
      let outputChars = 0;
      let usage;
      // One tool call per turn (Task 12, owner 2026-11-19): a main-agent turn's calls after its first are marked here
      // and answered with DEFERRED_TOOL_CALL_TEXT by the workspace tools; the model's own output is never changed.
      const ids = new Set();
      const note = (id) => {
        if (!deferred || !main || !id || ids.has(id)) return;
        if (ids.size >= 1) deferred.add(id);
        ids.add(id);
      };
      try {
        for await (const chunk of provider.generate(request)) {
          if (chunk.type === "tool_call") note(chunk.call?.id);
          else if (chunk.type === "tool_call_delta") note(chunk.delta?.id ?? chunk.id);
          if (chunk.type === "error") {
            meter.providerErrors++;
            if (!main) noteWorkerError(meter, chunk.error, request.signal);
          }
          if (chunk.type === "content_delta" && chunk.content?.type === "text") outputChars += chunk.content.text.length;
          else if (chunk.type === "tool_call") outputChars += JSON.stringify(chunk.call?.arguments ?? {}).length;
          else if (chunk.type === "usage" || chunk.type === "done") usage = chunk.usage ?? usage;
          yield chunk;
        }
      } catch (error) {
        meter.providerErrors++;
        if (!main) noteWorkerError(meter, error, request.signal);
        throw error;
      } finally {
        side.inputTokens += usage?.inputTokens ?? tokens;
        side.cachedInputTokens += usage?.cacheReadTokens ?? 0;
        side.outputTokens += usage?.outputTokens ?? Math.ceil(outputChars / 3.5);
      }
    },
  }));
}

/**
 * A failed memory-worker call (2026-11-21): counted, and its kind kept for the fault line (name, failure class, code or
 * status, and the first 120 characters of the provider's message). Only a faulted job carries `workerErrorKinds`, and a
 * faulted job never writes a row. A call the session aborted (its request signal fired: a background pass still in
 * flight when the session closed after its last task, `background.settle`) is the session's end, not a failed worker:
 * counted apart as `workerAborts`, never a fault.
 */
function noteWorkerError(meter, error, signal) {
  if (signal?.aborted) {
    meter.workerAborts = (meter.workerAborts ?? 0) + 1;
    return;
  }
  meter.workerErrors = (meter.workerErrors ?? 0) + 1;
  const kind = [error?.name, error?.failureClass, error?.code ?? error?.status, String(error?.message ?? "").slice(0, 120)]
    .map((part) => String(part ?? ""))
    .join(" | ");
  meter.workerErrorKinds ??= {};
  meter.workerErrorKinds[kind] = (meter.workerErrorKinds[kind] ?? 0) + 1;
}

/** A session event as counts and codes only (diagnostics): never text, prompts, tool output or summaries. */
export function traceEvent(event) {
  const out = { type: event.type };
  for (const [key, value] of Object.entries(event)) {
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (key === "trigger" || key === "status" || key === "reason")
      out[key] = typeof value === "string" ? value.slice(0, 40) : undefined;
  }
  if (event.type === "tool.completed") {
    // The tool's name and the result's size only.
    out.name = String(event.name ?? event.result?.name ?? "").slice(0, 60);
    out.resultChars = JSON.stringify(event.result?.value ?? event.result ?? "").length;
  }
  const error = event.error;
  if (error)
    out.error = {
      code: error.code,
      name: error.name,
      failureClass: error.failureClass,
      // A compaction's error is the memory system's own sentence (counts and reasons), never content.
      ...(event.type === "compaction.completed" ? { message: String(error.message ?? "").slice(0, 200) } : {}),
    };
  return out;
}

/**
 * One tool call per turn for every tool (2026-11-19): a memory package's tool past the first call of a main-agent turn
 * (STM's `recall`) gets the fixed answer through `tool.call` `respond`, as the workspace tools do in `prismTools`.
 */
export const deferredCallsPackage = (state, meter) =>
  definePackage({
    name: "session-bench-deferred-calls",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("tool.call", (call) => {
        if (!state.deferred?.has(call.callId) || MAIN_TOOLS.has(call.name)) return undefined;
        meter.deferredToolCalls++;
        return { respond: { toolCallId: call.callId, name: call.name, value: DEFERRED_TOOL_CALL_TEXT } };
      });
    },
  })();

const plain = (content) =>
  Array.isArray(content) ? content.map((block) => (block.type === "text" ? block.text : "")).join("") : String(content ?? "");

/**
 * The offline answer model. It acts on the task the harness asked for (`state.task`) with the task's scripted plan,
 * and knows a dependency only when the dependency's evidence string is visible in the request it is sent: in the
 * transcript, a compaction summary or a memory block, never in the current task's own prompt. What an arm keeps in view
 * decides what it knows; what it does not know it re-derives from the workspace when it can.
 */
export function sessionBenchAgentMock(state) {
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
        const known = new Set(taskDependencies(session, task).flatMap((dep) => (visible.includes(dep.evidence) ? [dep.id] : [])));
        state.knows = { task: task.n, known, check: (id) => known.has(id) };
      }
      const calls = planCalls(task, state.knows.check);
      const done = ws.calls.filter((call) => call.task === task.n).length;
      if (done < calls.length) yield providerToolCall(toolCallContent(`sb-${++ids}`, calls[done][0], calls[done][1]));
      else yield providerTextDelta(doneText(task, state.knows.check));
      yield providerDone();
    },
  };
}

const SUMMARY_PROMPT = /^You summarize /;
const systemText = (request) => plain((request.messages ?? []).find((message) => message.role === "system")?.content);
/** The compaction package's own prompts, or a reference compactor's production prompt (`arms/references.mjs`). */
const isSummaryRequest = (request) => SUMMARY_PROMPT.test(systemText(request)) || isReferencePrompt(systemText(request));
/** Mem0's extraction call (`ADDITIVE_EXTRACTION_PROMPT`), routed here through the harness endpoint. */
const isMem0Extraction = (request) => systemText(request).includes("You are a Memory Extractor");
const TASK_LINE = /Task \d+(?:\.| done:)[^\n]*/g;

/**
 * The offline workers: the compaction package's summary keeps every task prompt and closing line it is shown; STM
 * records a `request` per task prompt (in 400-character pieces) and an `outcome` per closing line, citing their entry;
 * WM keeps every record it is offered (`r`, re-judged `j` and look-ahead `a` ordinals); Mem0's extraction returns one
 * memory per task prompt and closing line in its `## New Messages` section, the same lines the summary keeps.
 */
export function sessionBenchWorkerMock() {
  return {
    id: "worker",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (isMem0Extraction(request)) {
        const prompt = plain(request.messages.at(-1)?.content);
        const fresh = /## New Messages\n([\s\S]*?)\n\n## Observation Date/.exec(prompt)?.[1] ?? "";
        const lines = [...new Set([...fresh.matchAll(TASK_LINE)].map((match) => match[0]))];
        yield providerTextDelta(JSON.stringify({ memory: lines.map((text, id) => ({ id: String(id), text, attributed_to: "user" })) }));
        yield providerDone();
        return;
      }
      if (isSummaryRequest(request)) {
        const text = (request.messages ?? [])
          .filter((message) => message.role !== "system")
          .map((message) => plain(message.content))
          .join("\n");
        const lines = [...new Set([...text.matchAll(TASK_LINE)].map((match) => match[0]))];
        yield providerTextDelta(lines.length ? `## Progress\n${lines.join("\n")}` : "## Progress\nNothing to carry.");
        yield providerDone();
        return;
      }
      const prompt = (request.messages ?? [])
        .filter((message) => message.role === "user")
        .map((message) => plain(message.content))
        .join("\n");
      let n = 0;
      if (tools.includes("judge")) {
        const keep = [...prompt.matchAll(/^- \[([rja])([0-9]+)\] /gm)].map((match) => ({
          [match[1]]: Number(match[2]),
          reason: "kept offline",
        }));
        if (keep.length && !(request.messages ?? []).some((message) => message.role === "tool"))
          yield providerToolCall(toolCallContent(`k${++n}`, "judge", { keep }));
        yield providerDone();
        return;
      }
      if (!tools.includes("record_event") || (request.messages ?? []).some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      const offersStatus = Boolean(request.tools.find((tool) => tool.name === "record_event")?.parameters?.properties?.status);
      for (const line of prompt.split("\n")) {
        const match = /^\[[^\]]+\] \[([^\]]+)\] (user|assistant): (\{.*)$/.exec(line);
        if (!match) continue;
        let message;
        try {
          message = JSON.parse(match[3]);
        } catch {
          continue;
        }
        const text = plain(message.content);
        if (match[2] === "user" && /^Task \d+\./.test(text))
          for (let at = 0; at < text.length; at += 400)
            yield providerToolCall(
              toolCallContent(`w${++n}`, "record_event", {
                kind: "request",
                description: text.slice(at, at + 400),
                sourceEntryIds: [match[1]],
                relevance: "high",
              }),
            );
        else if (match[2] === "assistant" && /^Task \d+ done:/.test(text))
          yield providerToolCall(
            toolCallContent(`w${++n}`, "record_event", {
              kind: "outcome",
              description: text.slice(0, 400),
              sourceEntryIds: [match[1]],
              relevance: "high",
              ...(offersStatus ? { status: "passed" } : {}),
            }),
          );
      }
      yield providerDone();
    },
  };
}

/** The workspace tools as Prism tools over one live workspace. */
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

/**
 * One session on one arm. Returns check rows and task rows WITHOUT the arm (the scorer is blind, G7), the per-task run
 * status and the meter.
 */
export async function runArmSession({
  session,
  arm,
  providers,
  model,
  workerModel,
  window = WINDOW_TOKENS,
  temperature = 0,
  embedder = hashEmbedder(),
  thinkingLevel,
  limits = RUN_LIMITS,
  workerSpec,
  parallelToolCalls,
  toolCallsPerTurn,
  workerReasoningEffort,
  workerOutput,
  onTask = () => {},
  trace,
  inspect,
}) {
  const config = armConfig(
    arm,
    sharedConfig({
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
  const effectiveWindow = config.shared.window;
  const ws = createWorkspace(session.env);
  const deferred = toolCallsPerTurn === 1 ? new Set() : undefined;
  const state = { session, ws, task: 0, knows: null, memoryBlock: null, deferred };
  const meter = emptyMeter();
  // `trace` (diagnostics only): request sizes and session events as counts and codes; it never reaches the row or hash.
  if (trace) Object.defineProperty(meter, "trace", { value: trace, enumerable: false });
  const wrapped = windowedProviders(providers(state), {
    window: effectiveWindow,
    meter,
    deferred,
    workerReasoningEffort,
    workerOutput,
    workerMaxOutputTokens: workerSpec?.limits?.maxOutputTokens,
  });
  const thirdParty = config.memory.thirdParty
    ? await startThirdParty({ session, arm, wrapped, workerModel, workerSpec, thinkingLevel, window: effectiveWindow, embedder, meter })
    : null;
  // Live, the memory packages get the worker's catalog spec held to the same window and output reserve as the main
  // agent and Mem0 (Task 12, 2026-11-20: a worker on its own model otherwise took its catalog's output limit, none for
  // gpt-oss:20b, and wrote up to 8K-token answers); offline, the bare `provider/model` ref.
  const packageWorker = workerSpec
    ? { ...workerSpec, limits: { contextWindow: effectiveWindow, maxOutputTokens: MAX_OUTPUT_TOKENS } }
    : workerModel;
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: { ...model, limits: { contextWindow: effectiveWindow, maxOutputTokens: MAX_OUTPUT_TOKENS } },
    instructions: SYSTEM_PROMPT,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    packages: [
      providerPackage("session-bench-providers", wrapped),
      ...(await armPackages(arm, { workerModel: packageWorker, inputCap: effectiveWindow - MAX_OUTPUT_TOKENS, state })),
      ...(deferred ? [deferredCallsPackage(state, meter)] : []),
    ],
    tools: { add: prismTools(state, meter) },
    slots: { store },
    limits: { ...limits },
  });
  const status = {};
  const checks = [];
  let handle;
  let opened = 0;
  const open = async () => {
    if (handle) await handle.close();
    handle = await agent.session({ id: `${session.id}-${arm}-${opened++}`, create: true });
    if (trace)
      void (async () => {
        for await (const event of handle.subscribe({ acrossRuns: true })) trace({ ...traceEvent(event), task: state.task });
      })().catch(() => {});
    state.task = 0;
    const intro = scopeMessage(session.scope);
    const answer = await handle.run(intro);
    await thirdParty?.add(intro, answer);
    if (config.memory.setScope) await agent.commands.run("memory:scope", { text: session.scope }, { session: handle });
  };
  try {
    await open();
    for (const task of session.tasks) {
      if (config.memory.freshSessionPerTask && task.n > 1) await open();
      ws.task = task.n;
      state.task = task.n;
      state.memoryBlock = thirdParty ? await thirdParty.retrieve(task.prompt) : null;
      const result = await handle.run(task.prompt);
      const limit = result?.error?.breach?.limit ?? /^Run limit exceeded: (\w+)$/.exec(String(result?.error?.message ?? ""))?.[1];
      status[task.n] = {
        status: result?.status ?? "unknown",
        ...(result?.error?.code ? { code: result.error.code } : {}),
        ...(limit ? { limit } : {}),
      };
      checks.push(...taskCheckRows(session, task, ws.state));
      await thirdParty?.add(task.prompt, result);
      await onTask({ task: task.n, of: session.tasks.length, status: status[task.n], meter });
    }
    await handle.close();
    for (let index = 0; index < opened; index++) countStmFallbacks(await store.list(`${session.id}-${arm}-${index}`), meter.stmFallbacks);
    // Diagnostics only (never in a screen run): the session store after the run, for a replay that reads the ledger.
    if (inspect) await inspect({ store, sessionIds: Array.from({ length: opened }, (_, index) => `${session.id}-${arm}-${index}`) });
  } finally {
    await agent.dispose();
    thirdParty?.close();
  }
  const counts = rederivationCounts(ws.calls);
  const tasks = session.tasks.map((task) => ({
    session: session.id,
    task: task.n,
    ...(counts[task.n] ?? { rederivations: 0, toolCalls: 0 }),
  }));
  return { checks, tasks, status, meter, configHash: configHash(config) };
}

/** Adds the session's STM records written without the model, by reason (from the ledger's records; counts only). */
export function countStmFallbacks(entries, into) {
  for (const entry of entries) {
    const data = entry.kind === "package_state" ? entry.data : undefined;
    if (data?.key !== "memory.session.ledger") continue;
    for (const observation of data.value?.observations ?? []) if (observation?.fallback in into) into[observation.fallback] += 1;
  }
  return into;
}

/**
 * A third-party arm's runtime for one session: the harness endpoint (its chat calls go to the run's worker provider
 * through `windowedProviders`, so they meet the same window and are metered as worker calls; its embeddings go to
 * `embedder`, metered apart) and the system itself. A failed `add` or `retrieve` is counted, never fatal: the agent's
 * run goes on without that memory, as it would in production.
 */
async function startThirdParty({ session, arm, wrapped, workerModel, workerSpec, thinkingLevel, window, embedder, meter }) {
  const [providerId, ...rest] = String(workerModel).split("/");
  const worker = wrapped.find((provider) => provider.id === providerId);
  if (!worker) throw new Error(`SessionBenchRun: ${arm} needs the worker provider ${providerId}`);
  // Live, the worker is the catalog model (its compat and parameters), held to the same window; offline a bare spec.
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

/** A task that neither completed nor stopped on the agent's own limits is a harness or provider fault, not a score. */
export const sessionFaults = (statusBySession) =>
  Object.entries(statusBySession).flatMap(([session, tasks]) =>
    Object.entries(tasks)
      .filter(([, row]) => !["completed", "stopped"].includes(row.status) && row.code !== "ERR_PRISM_RUN_LIMIT")
      .map(([task, row]) => ({ session, task: Number(task), ...row })),
  );

const add = (a, b) => ({
  calls: a.calls + b.calls,
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/**
 * The side arms' comparisons (plan 218.3 Task 12 reports them beside the decision arms, with the same statistic): each
 * decision arm against each side arm that ran. Kept out of `ANALYSIS` (a core file, frozen by G1).
 */
export const sideComparisons = (arms) =>
  PRISM_ARMS.filter((arm) => arms.includes(arm)).flatMap((arm) =>
    SIDE_ARMS.filter((side) => arms.includes(side)).map((side) => [side, arm]),
  );

/** An empty per-arm accumulator for `accumulateArm` and `sessionBenchReport`. */
export const emptyArmTotals = () => ({ checks: [], tasks: [], status: {}, meter: emptyMeter(), sessions: 0 });

/** Fold one `runArmSession` result (or a live checkpoint row of it) into an arm's totals. */
export function accumulateArm(own, id, result) {
  own.checks.push(...result.checks);
  own.tasks.push(...result.tasks);
  own.status[id] = result.status;
  own.meter.main = add(own.meter.main, result.meter.main);
  own.meter.workers = add(own.meter.workers, result.meter.workers);
  own.meter.embeddings.calls += result.meter.embeddings.calls;
  own.meter.embeddings.inputTokens += result.meter.embeddings.inputTokens;
  own.meter.thirdPartyErrors += result.meter.thirdPartyErrors;
  own.meter.overflows += result.meter.overflows;
  own.meter.deferredToolCalls += result.meter.deferredToolCalls ?? 0;
  own.meter.providerErrors += result.meter.providerErrors ?? 0;
  own.meter.prefix.sharedChars += result.meter.prefix.sharedChars;
  own.meter.prefix.chars += result.meter.prefix.chars;
  own.sessions++;
  return own;
}

/** Whole-run cost of one arm's meter: every token the arm spent (G9) and its cache share. */
export function armCost(meter, passed) {
  const { main, workers, embeddings, thirdPartyErrors, overflows, prefix } = meter;
  const whole = main.inputTokens + main.outputTokens + workers.inputTokens + workers.outputTokens + embeddings.inputTokens;
  return {
    main,
    workers,
    embeddings,
    thirdPartyErrors,
    overflows,
    providerErrors: meter.providerErrors ?? 0,
    deferredToolCalls: meter.deferredToolCalls ?? 0,
    wholeRunTokens: whole,
    wholeRunTokensPerPassedTask: passed ? Math.round(whole / passed) : null,
    cacheShare:
      main.inputTokens + workers.inputTokens
        ? (main.cachedInputTokens + workers.cachedInputTokens) / (main.inputTokens + workers.inputTokens)
        : 0,
    simulatedPrefixShare: prefix.chars ? prefix.sharedChars / prefix.chars : 0,
  };
}

/**
 * Each comparison on the sessions both of its arms finished (a live run read mid-way has arms at different counts;
 * the paired statistic needs the same units on both sides). A full run is unchanged: every arm has every session.
 * `sessions` names how many sessions the pair shares.
 */
export function comparePaired(scores, comparisons) {
  return comparisons.map(([a, b]) => {
    if (!scores[a] || !scores[b]) return compareArms(scores, { comparisons: [[a, b]] })[0];
    const shared = new Set(Object.keys(scores[a].sessions).filter((id) => scores[b].sessions[id]));
    const only = (score) => ({
      ...score,
      units: Object.fromEntries(
        Object.entries(score.units).map(([metric, rows]) => [metric, rows.filter((row) => shared.has(row.cluster))]),
      ),
    });
    if (!shared.size) return { a, b, status: "not-run", sessions: 0 };
    const [row] = compareArms({ [a]: only(scores[a]), [b]: only(scores[b]) }, { comparisons: [[a, b]] });
    return { ...row, sessions: shared.size };
  });
}

/**
 * The report over accumulated arms. Blind scoring (G7): each arm's rows go to the scorer without the arm; the arm is
 * attached to the result. G8: `assertCompleteReport` refuses a report that drops an arm, a comparison or a metric.
 */
export function sessionBenchReport({ mode, partition, file, window, arms, configs, sharedHash, ids, sizes, byArm, wallMs, extra = {} }) {
  const scores = Object.fromEntries(arms.map((arm) => [arm, scoreRows({ checks: byArm[arm].checks, tasks: byArm[arm].tasks })]));
  const report = {
    kind: SESSION_BENCH_REPORT_KIND,
    mode,
    partition,
    benchmark: { version: file.version, templateHash: file.templateHash, idsHash: file.idsHash, sessionsHash: file.sessionsHash },
    window,
    arms,
    configHashes: Object.fromEntries(configs.map((config) => [config.arm, configHash(config)])),
    sharedConfigHash: sharedHash,
    sessions: ids,
    sessionTokens: sizes,
    scores: Object.fromEntries(arms.map((arm) => [arm, { overall: scores[arm].overall, sessions: scores[arm].sessions }])),
    comparisons: comparePaired(scores, ANALYSIS.comparisons),
    sideComparisons: comparePaired(scores, sideComparisons(arms)),
    cost: Object.fromEntries(arms.map((arm) => [arm, armCost(byArm[arm].meter, scores[arm].overall.tasksPassed)])),
    faults: Object.fromEntries(arms.map((arm) => [arm, sessionFaults(byArm[arm].status)])),
    wallMs,
    ...extra,
  };
  assertCompleteReport(report);
  return report;
}

/** Run a partition (or `perTemplate` sessions of each family from it) on the chosen arms, offline. Live: `live.mjs`. */
export async function runSessionBench({
  partition = "dev",
  arms = SESSION_BENCH_ARMS,
  offline = true,
  perTemplate,
  window = WINDOW_TOKENS,
} = {}) {
  if (!offline)
    throw new Error("SessionBenchRun: the live run is `run.mjs --live` (live.mjs), on the owner's word with its rule in the gate record");
  if (partition !== "dev") throw new Error("SessionBenchRun: only dev is read before gate A (G2: heldout-a and heldout-b stay unread)");
  for (const arm of arms) if (!SESSION_BENCH_ARMS.includes(arm)) throw new Error(`SessionBenchRun: unknown arm ${arm}`);
  const file = sessionBenchPartitions();
  let ids = partitionIds(file, partition);
  if (perTemplate) ids = Object.values(file.abilities[partition]).flatMap((list) => list.slice(0, perTemplate));
  const configs = arms.map((arm) => armConfig(arm, sharedConfig({ window })));
  const sharedHash = assertEqualTreatment(configs);
  const started = performance.now();
  const byArm = Object.fromEntries(arms.map((arm) => [arm, emptyArmTotals()]));
  const sizes = {};
  for (const id of ids) {
    const session = createSession(id);
    sizes[id] = sessionSizes(session).total; // the size rules hold for W; --window is a sensitivity reading
    for (const arm of arms) {
      const result = await runArmSession({
        session,
        arm,
        providers: (state) => [sessionBenchAgentMock(state), sessionBenchWorkerMock()],
        model: OFFLINE_MAIN,
        workerModel: OFFLINE_WORKER,
        window,
      }).catch((error) => {
        throw new Error(`SessionBenchRun: ${id} on ${arm}: ${error instanceof Error ? error.message : String(error)}`);
      });
      accumulateArm(byArm[arm], id, result);
    }
  }
  return sessionBenchReport({
    mode: "offline",
    partition,
    file,
    window,
    arms,
    configs,
    sharedHash,
    ids,
    sizes,
    byArm,
    wallMs: Math.round(performance.now() - started),
  });
}

function parseArgs(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return {
    offline: !argv.includes("--live"),
    partition: value("--partition") ?? "dev",
    arms: value("--arms")?.split(",").filter(Boolean),
    perTemplate: value("--per-template") ? Number(value("--per-template")) : undefined,
    window: value("--window") ? Number(value("--window")) : WINDOW_TOKENS,
    output: value("--output"),
  };
}

if (import.meta.main && process.argv.includes("--live")) {
  // A child process, not an import: live.mjs (and the guardrails it runs) import this module, and an entry module
  // suspended in its own top-level await cannot be imported back (the import waits on itself).
  const { spawnSync } = await import("node:child_process");
  const live = new URL("./live.mjs", import.meta.url).pathname;
  const child = spawnSync(process.execPath, [live, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(child.status ?? 1);
} else if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const report = await runSessionBench(args);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) await writeFile(args.output, text);
  const line = (arm) => {
    const o = report.scores[arm].overall;
    const c = report.cost[arm];
    const cls = Object.entries(o.classes)
      .map(([name, row]) => `${name} ${row.pass}/${row.total}`)
      .join(" ");
    const extra = c.embeddings.calls ? `; embeddings ${c.embeddings.inputTokens}; third-party errors ${c.thirdPartyErrors}` : "";
    return `${arm}: tasks ${o.tasksPassed}/${o.tasks}; ${cls}; rederivations ${o.rederivations}; tokens ${c.wholeRunTokens} (workers ${c.workers.inputTokens + c.workers.outputTokens}${extra}); overflows ${c.overflows}; faults ${report.faults[arm].length}`;
  };
  console.log(`session-bench ${report.mode} ${report.partition}: ${report.sessions.length} sessions, ${report.wallMs} ms`);
  for (const arm of report.arms) console.log(line(arm));
}

export { CALIBRATION_ARMS, PRISM_ARMS };
