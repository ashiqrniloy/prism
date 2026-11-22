/**
 * Plan 217 Task 5: STM mechanism probes over the offline long-session fixture (`../long-session.mjs`).
 *
 * The fixture is replayed through a real agent with the memory system's session tiers: the main model is scripted
 * from `session.json` (tool calls and replies), the probe tools answer with the fixture's outputs, and the STM worker
 * is scripted from `annotations.json`: per batch it records the annotated events whose last source is in the batch,
 * citing the batch's own entry ids. Everything between those two scripts is product code: batching, validation,
 * redaction, caps, habituation, boundaries, the ledger, the render and recall of the original entries.
 *
 *   timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm
 *
 * Rows carry counts, hashes and verdicts only (the plan 210 harness rule).
 */
import { join, resolve } from "node:path";
import { loadLongSessionFixture } from "../long-session.mjs";
import { digest, events, packages, receivedText, responder } from "./harness.mjs";

export const STM_MODEL = "worker/stm";
const SCOPE_SENTINEL = "EPISODE-SCOPE-SENTINEL-217";
const LTM_SENTINEL = "LTM-NOTE-SENTINEL-217";
const WM_SENTINEL = "WM-ITEM-SENTINEL-217";
/** A user turn after the replay: the main model recalls the annotated records by id. */
const RECALL_TURN = "What exactly did the verbose test run and parse.ts say?";
/** A fixture turn makes up to 13 tool calls and re-sends a 118 KB read; the default per-run counters would end it early. Byte caps stay. */
const RUN_LIMITS = { maxTurns: 64, maxToolRounds: 64, maxToolCalls: 64, maxInputTokens: null, maxTotalTokens: null };
const ROOT = resolve(import.meta.dir, "../../..");
/** The pre-redesign observer: plan 216 Task 4's pinned worktree (`baselines.json` `omBefore.revision`). */
export const OM_BEFORE_WORKTREE = join(ROOT, ".cache/memory-bench/216/om-before");

let fixture;
export const longSession = () => (fixture ??= loadLongSessionFixture());

const tokens = (value) => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);
const textOf = (content) =>
  Array.isArray(content) ? content.map((block) => (block.type === "text" ? block.text : "")).join("\n") : String(content ?? "");

/**
 * Map each entry of a worker batch to its fixture step. A batch line is `[time] [entryId] kind: <json>`; a tool
 * result names its call id, an assistant tool call carries it, and user turns and replies are matched by text.
 */
export function batchSteps(text, fx = longSession()) {
  const users = new Map(fx.turns.map((turn) => [turn.user, `${turn.id}:user`]));
  const replies = new Map(fx.turns.map((turn) => [turn.reply, `${turn.id}:reply`]));
  const steps = new Map();
  for (const line of text.split("\n")) {
    const match = /^\[[^\]]+\] \[([^\]]+)\] (?:message|user|assistant|tool|system): (.*)$/.exec(line);
    if (!match) continue;
    const [, entryId, body] = match;
    const role = /^\{"role":"(\w+)"/.exec(body)?.[1];
    const callId = /"(?:toolCallId|id)":"(c\d{3})"/.exec(body)?.[1];
    let step;
    if (role === "tool" && callId) step = callId;
    else if (role === "assistant" && callId) step = `${callId}:call`;
    else {
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      const said = textOf(message.content);
      step = role === "user" ? users.get(said) : role === "assistant" ? replies.get(said) : undefined;
    }
    if (step) steps.set(step, entryId);
  }
  return steps;
}

/** Recent-index lines (`[id] kind ×N: description…`) of an STM request, by description prefix. */
function indexIds(text) {
  const ids = [];
  for (const match of text.matchAll(/^\[([0-9a-f]{12})\] (\w+)(?: ×\d+)?: (.*)$/gm))
    ids.push({ id: match[1], kind: match[2], prefix: match[3].replace(/…$/, "") });
  return ids;
}

/**
 * The scripted STM worker. `shape: "event"` answers with `record_event` (this tree); `shape: "observation"` answers
 * with the pre-redesign `record_observation` (no kind, no chunks), for the OM-before cost arm. `log` collects what it
 * did: emitted events, rejected tool results and output tokens (the mock provider's counter: tokens of its calls).
 */
/** Fixture events the scripted STM marks `durable` (plan 218.2 Task 3): e102, "use pnpm, never npm", binds later work. */
export const DURABLE_EVENTS = Object.freeze({ e102: "constraint" });

export function scriptedStm(log, { shape = "event", fx = longSession(), testing } = {}) {
  const emitted = new Set();
  return (request) => {
    const tools = (request.tools ?? []).map((tool) => tool.name);
    const prompt = receivedText({ messages: request.messages.filter((message) => message.role === "user") });
    const answered = request.messages.filter((message) => message.role === "tool");
    if (answered.length) {
      for (const message of answered)
        for (const block of message.content ?? []) {
          const value = block.result ?? block.value;
          const text = JSON.stringify(block);
          if (value?.ok === false || /"ok":false/.test(text)) log.rejected.push(/"reason":"(\w+)"/.exec(text)?.[1] ?? "unknown");
        }
      return [testing.providerTextDelta(""), testing.providerDone()];
    }
    const recordTool = shape === "event" ? "record_event" : "record_observation";
    if (!tools.includes(recordTool)) return [testing.providerDone()];
    // Plan 218.2 Task 2: an outcome carries `status` when the tool offers it (every fixture outcome names its passing check).
    const offersStatus = Boolean(request.tools?.find((tool) => tool.name === recordTool)?.parameters?.properties?.status);
    // Plan 218.2 Task 3: the user's standing pnpm rule is a durable constraint when the tool offers `durable`.
    const offersDurable = Boolean(request.tools?.find((tool) => tool.name === recordTool)?.parameters?.properties?.durable);
    const steps = batchSteps(prompt, fx);
    const index = indexIds(prompt);
    const calls = [];
    for (const event of fx.events) {
      if (emitted.has(event.id)) continue;
      const last = event.sources.at(-1);
      if (!steps.has(last)) continue;
      emitted.add(event.id);
      log.emitted.push(event.id);
      const sourceEntryIds = event.sources.filter((source) => steps.has(source)).map((source) => steps.get(source));
      const supersededEvent = event.supersedes && fx.events.find((other) => other.id === event.supersedes);
      const supersedes = supersededEvent
        ? index.find((line) => supersededEvent.description.startsWith(line.prefix.slice(0, 60)))?.id
        : undefined;
      if (event.supersedes && !supersedes) log.missingSupersedes.push(event.id);
      const args =
        shape === "event"
          ? {
              kind: event.kind,
              description: event.description,
              relevance: event.relevance,
              sourceEntryIds,
              ...(offersStatus && event.kind === "outcome" ? { status: "passed" } : {}),
              ...(offersDurable && DURABLE_EVENTS[event.id] ? { durable: DURABLE_EVENTS[event.id] } : {}),
              ...(supersedes ? { supersedes } : {}),
            }
          : {
              content: event.kind === "outcome" ? `completed: ${event.description}` : event.description,
              relevance: event.relevance,
              sourceEntryIds,
              ...(supersedes ? { supersedes } : {}),
            };
      log.outputTokens += tokens(args);
      calls.push(testing.providerToolCall(testing.toolCallContent(`${event.id}`, recordTool, args)));
    }
    if (tools.includes("record_task_state"))
      for (const state of fx.taskStates) {
        const key = `state:${state.turn}`;
        if (emitted.has(key) || !steps.has(state.source)) continue;
        emitted.add(key);
        const { turn: _turn, source: _source, ...taskState } = state;
        log.outputTokens += tokens(taskState);
        calls.push(testing.providerToolCall(testing.toolCallContent(key.replace(":", "-"), "record_task_state", taskState)));
      }
    log.passes += 1;
    log.inputTokens += tokens({ system: request.system, messages: request.messages, tools: request.tools });
    return [...calls, testing.providerDone()];
  };
}

/** Probe tools answering with the fixture's outputs, keyed by the call id the scripted main model chose. */
function fixtureTools(prism, fx, toolLog) {
  const names = [...new Set([...fx.calls.values()].map((call) => call.tool))];
  return prism.definePackage({
    name: "@probe/long-session-tools",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      for (const name of names)
        api.tools.register({
          name,
          description: `Fixture ${name}.`,
          parameters: { type: "object", additionalProperties: true, properties: {} },
          execute(_args, context) {
            const output = fx.calls.get(context.toolCallId)?.output ?? `unknown fixture call ${context.toolCallId}`;
            return { toolCallId: context.toolCallId, name, value: output, content: [{ type: "text", text: output }] };
          },
        });
      api.hooks.on("tool.call", (payload) => {
        toolLog.push({ name: payload.name, sessionId: payload.sessionId, turn: toolLog.turn });
        return undefined;
      });
    },
  })();
}

/** Scope and LTM reach the main model the way those tiers do: as `context.build` blocks (probe 3). */
function sentinelTiers(prism) {
  return prism.definePackage({
    name: "@probe/scope-and-ltm",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      api.hooks.on("context.build", (draft) => ({
        ...draft,
        context: [
          ...(draft.context ?? []),
          { title: "scope", content: SCOPE_SENTINEL },
          { title: "Long-term memory", content: LTM_SENTINEL },
        ],
      }));
    },
  })();
}

/**
 * Replay the fixture through one agent. `config` overlays the memory-system options; `sentinels` adds the scope/LTM blocks and a WM reflection carrying a sentinel. Plan 218
 * Task 5: `wmWorker` answers WM requests (`config.wm` then configures WM, on by default with it), and `beforeTurn`
 * runs before a turn with the harness (to set the episode scope with `memory:scope`).
 */
export async function replayLongSession({
  config = {},
  sentinels = false,
  secrets = true,
  turns,
  wmWorker,
  beforeTurn,
  keepRecentEntries,
} = {}) {
  const { prism, testing } = await packages();
  const memory = await import("@arnilo/prism-memory-system");
  const fx = longSession();
  const ev = await events();
  const mainRequests = [];
  const workerRequests = [];
  const toolLog = [];
  const stmLog = { emitted: [], rejected: [], missingSupersedes: [], outputTokens: 0, inputTokens: 0, passes: 0 };
  const stm = scriptedStm(stmLog, { testing });
  let current;
  let step = 0;
  const recallIds = [];
  const main = await responder(
    "mock",
    (request) => {
      const toolTurn = request.messages.at(-1)?.role === "tool";
      if (!toolTurn) step = 0;
      if (current === "recall") {
        // Plan 218.3 Task 4: a recall page that names where to read on is followed before the next call.
        const more = toolTurn
          ? JSON.stringify(request.messages.at(-1)).match(/continue with recall \{ entry: \\"([^"\\]+)\\", offset: (\d+) \}/)
          : null;
        if (more) return ev.call("recall", { entry: more[1], offset: Number(more[2]) }, `recall-more-${step}-${more[2]}`);
        if (toolTurn && step >= recallIds.length) return ev.say("Recalled.");
        const id = recallIds[step++];
        // A string recalls by id; an object is the recall call's arguments (plan 218.2 Task 7: `{ query }`).
        return id ? ev.call("recall", typeof id === "string" ? { id } : id, `recall-${step}`) : ev.say("Nothing to recall.");
      }
      const call = current.calls[step++];
      return call ? ev.call(call.tool, call.args, call.id) : ev.say(current.reply);
    },
    (request) =>
      mainRequests.push({
        ...structuredClone({ context: request.context, messages: request.messages, tools: request.tools?.map((t) => t.name) }),
        compactions: compactionCount.n,
      }),
  );
  const worker = await responder("worker", (request) => {
    const tools = (request.tools ?? []).map((tool) => tool.name);
    const kind = tools.includes("record_event")
      ? "stm"
      : tools.includes("judge")
        ? "wm"
        : tools.includes("drop_observations")
          ? "rehearsal"
          : "other";
    workerRequests.push({ kind, text: JSON.stringify({ system: request.system, messages: request.messages }) });
    if (kind === "stm") return stm(request);
    if (kind === "wm" && wmWorker) return wmWorker(request, { testing, ev });
    if (kind === "wm" && sentinels && !request.messages.some((message) => message.role === "tool")) {
      const of = [...receivedText({ messages: request.messages }).matchAll(/^- \[r([0-9]+)\] \d{4}-/gm)].map((m) => Number(m[1]));
      return of.length
        ? ev.call("judge", { summaries: [{ of: of.slice(0, 2), text: `${WM_SENTINEL} summary`, relevance: "medium" }] })
        : ev.say("");
    }
    return ev.say("");
  });
  const failures = [];
  const active = new Set();
  // Completed compactions so far, stamped on each main request: a prompt prefix may change only across one (plan 218 M4).
  const compactionCount = { n: 0 };
  const compactionCounter = prism.definePackage({
    name: "@probe/compaction-counter",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      api.hooks.on("compaction.completed", (event) => {
        if (!event.error) compactionCount.n += 1;
      });
    },
  })();
  const memoryConfig = {
    enabled: true,
    stm: { model: STM_MODEL, triggerTokens: 1, ...(config.stm ?? {}) },
    wm: wmWorker
      ? config.wm === false
        ? false
        : { model: STM_MODEL, triggerTokens: 1, ...(config.wm ?? {}) }
      : sentinels
        ? { model: STM_MODEL, triggerTokens: 1 }
        : false,
    ...(sentinels && config.scope === undefined ? { scope: { text: "Probe session scope." } } : {}),
    context: { compactAfterRun: { maxTokens: 9_999_999 }, ...(config.context ?? {}) },
    worker: { maxTurns: 2, ...(config.worker ?? {}) },
    ...Object.fromEntries(Object.entries(config).filter(([key]) => !["stm", "wm", "context", "worker"].includes(key))),
  };
  const extra = [];
  if (sentinels) extra.push(sentinelTiers(prism));
  const agent = await prism.createAgent({
    model: { provider: "mock", model: "main", limits: { contextWindow: 10_000_000, maxOutputTokens: 0 } },
    packages: [main, worker, fixtureTools(prism, fx, toolLog), compactionCounter, ...extra, memory.default(memoryConfig)],
    slots: { store: prism.createMemorySessionStore() },
    // Plan 218.3 Task 2 retired `context.recentMessages`; a probe that needs a bare cut sets the kernel's keep instead.
    ...(keepRecentEntries === undefined ? {} : { compaction: { keepRecentEntries } }),
    limits: RUN_LIMITS,
  });
  const stream = agent.subscribe();
  const collecting = (async () => {
    for await (const event of stream) {
      if (event.type === "background.started") active.add(event.taskId);
      if (event.type === "background.completed" || event.type === "background.failed") {
        active.delete(event.taskId);
        if (event.type === "background.failed") failures.push(String(event.reason?.message ?? event.reason).slice(0, 200));
      }
    }
  })();
  const settle = async () => {
    for (let i = 0; i < 4000; i++) {
      await new Promise((done) => setTimeout(done, 0));
      if (!active.size) {
        await new Promise((done) => setTimeout(done, 1));
        if (!active.size) return;
      }
    }
    throw new Error("stm probe background timeout");
  };
  const session = await agent.session({ id: "long-session", create: true });
  const ledger = async () => memory.foldObservationalMemoryLedger(await session.entries());
  const turnMarks = {};
  const runFailures = [];
  const runTurn = async (turn) => {
    if (turn.gapMinutes) globalThis.Date.advance?.(turn.gapMinutes * 60_000);
    else globalThis.Date.advance?.(60_000);
    current = turn;
    toolLog.turn = turn.id;
    const passes = () => workerRequests.filter((r) => r.kind === "stm" && !r.text.includes('"role":"tool"')).length;
    turnMarks[turn.id] = { stmBefore: passes() };
    const result = await session.run(turn.user);
    if (result?.status && result.status !== "completed")
      runFailures.push(`${turn.id}: ${result.status} ${result.error?.code ?? ""} ${result.error?.message ?? ""}`.trim());
    await settle();
    turnMarks[turn.id].stmAfter = passes();
  };
  const harness = { agent, session, settle, mainRequests, workerRequests };
  for (const [index, turn] of fx.turns.entries()) {
    if (turns && !turns.includes(turn.id)) continue;
    await beforeTurn?.(turn, harness);
    await runTurn(turn);
    // The kernel hands the compaction slot the run's secret set; the memory system keeps it for later passes.
    if (index === 0 && secrets) {
      await session.compact({ secrets: [fx.secret] });
      await settle();
    }
  }
  return {
    fx,
    agent,
    session,
    memory,
    mainRequests,
    workerRequests,
    stmRequests: () => workerRequests.filter((request) => request.kind === "stm"),
    /** STM passes: a pass's first request (its follow-up carries the tool results). */
    stmPasses: () => workerRequests.filter((request) => request.kind === "stm" && !request.text.includes('"role":"tool"')),
    toolLog,
    stmLog,
    failures,
    runFailures,
    turnMarks,
    ledger,
    settle,
    /** Find the ledger record of an annotated event by its description. */
    async recordOf(eventId) {
      const event = fx.events.find((item) => item.id === eventId);
      return (await ledger()).observations.find((item) => item.description === event.description);
    },
    /** After the replay: compact the transcript away, then let the main model recall `eventIds` by record id. */
    async recallTurn(eventIds, args = {}) {
      const ids = [];
      for (const id of eventIds) ids.push({ id: (await this.recordOf(id))?.id ?? "000000000000", ...args });
      return this.recallCalls(ids);
    },
    /** After the replay: compact the transcript away, then let the main model call `recall` once per entry (an id or the call's arguments). */
    async recallCalls(calls) {
      recallIds.push(...calls);
      await session.compact();
      await settle();
      const before = toolLog.length;
      const results = [];
      const pump = (async () => {
        for await (const event of session.subscribe())
          if (event.type === "tool.completed") results.push({ name: event.name, text: textOf(event.result?.content) });
      })();
      current = "recall";
      toolLog.turn = "recall";
      await session.run(RECALL_TURN);
      await pump;
      await settle();
      return { results, calls: toolLog.slice(before).filter((call) => call.sessionId === session.id), request: mainRequests.at(-1) };
    },
    async close() {
      await session.close();
      await agent.dispose();
      await collecting;
    },
  };
}

/** Eligible tokens of the replayed transcript: the message entries STM reads, at the package's ceil(len/4). */
async function eligibleTokens(session) {
  return (await session.entries()).filter((entry) => entry.kind === "message").reduce((sum, entry) => sum + tokens(entry.message), 0);
}

/**
 * The OM-before cost arm: the pinned pre-216 tree's observational package and kernel, loaded from the worktree,
 * replaying the same fixture with the same scripted events in the old shape. Null when the worktree is absent.
 */
export async function replayOmBefore() {
  const { existsSync } = await import("node:fs");
  const kernelPath = join(OM_BEFORE_WORKTREE, "src/index.ts");
  const omPath = join(OM_BEFORE_WORKTREE, "packages/memory/observational/src/index.ts");
  if (!existsSync(kernelPath) || !existsSync(omPath)) return null;
  const prism = await import(kernelPath);
  const kit = await import(join(OM_BEFORE_WORKTREE, "src/provider-kit/index.ts"));
  const om = await import(omPath);
  const fx = longSession();
  const testing = {
    providerDone: prism.providerDone,
    providerTextDelta: prism.providerTextDelta,
    providerToolCall: prism.providerToolCall,
    toolCallContent: prism.toolCallContent,
  };
  const log = { emitted: [], rejected: [], missingSupersedes: [], outputTokens: 0, inputTokens: 0, passes: 0 };
  const stm = scriptedStm(log, { shape: "observation", testing });
  let current;
  let step = 0;
  const provider = (id, respond) => ({
    id,
    async *generate(request) {
      for (const event of respond(request)) yield event;
    },
  });
  const main = provider("mock", (request) => {
    if (request.messages.at(-1)?.role !== "tool") step = 0;
    const call = current.calls[step++];
    return call
      ? [prism.providerToolCall(prism.toolCallContent(call.id, call.tool, call.args)), prism.providerDone()]
      : [prism.providerTextDelta(current.reply), prism.providerDone()];
  });
  const worker = provider("worker", (request) =>
    (request.tools ?? []).some((tool) => tool.name === "record_observation") ? stm(request) : [prism.providerDone()],
  );
  const tools = prism.definePackage({
    name: "@probe/long-session-tools",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      for (const name of new Set([...fx.calls.values()].map((call) => call.tool)))
        api.tools.register({
          name,
          description: `Fixture ${name}.`,
          parameters: { type: "object", additionalProperties: true, properties: {} },
          execute(_args, context) {
            const output = fx.calls.get(context.toolCallId)?.output ?? "";
            return { toolCallId: context.toolCallId, name, value: output, content: [{ type: "text", text: output }] };
          },
        });
    },
  })();
  const agent = await prism.createAgent({
    model: { provider: "mock", model: "main", limits: { contextWindow: 10_000_000, maxOutputTokens: 0 } },
    packages: [
      kit.providerPackage("probe-mock", [main]),
      kit.providerPackage("probe-worker", [worker]),
      tools,
      om.default({ enabled: true, observer: { model: STM_MODEL, messageTokens: 1 }, context: { compactAt: { maxTokens: 9_999_999 } } }),
    ],
    slots: { store: prism.createMemorySessionStore() },
    limits: RUN_LIMITS,
  });
  const active = new Set();
  const stream = agent.subscribe();
  const collecting = (async () => {
    for await (const event of stream) {
      if (event.type === "background.started") active.add(event.taskId);
      if (event.type === "background.completed" || event.type === "background.failed") active.delete(event.taskId);
    }
  })();
  const settle = async () => {
    for (let i = 0; i < 4000; i++) {
      await new Promise((done) => setTimeout(done, 0));
      if (!active.size) {
        await new Promise((done) => setTimeout(done, 1));
        if (!active.size) return;
      }
    }
    throw new Error("om-before probe background timeout");
  };
  const session = await agent.session({ id: "long-session", create: true });
  try {
    for (const turn of fx.turns) {
      globalThis.Date.advance?.((turn.gapMinutes ?? 1) * 60_000);
      current = turn;
      await session.run(turn.user);
      await settle();
    }
    return { log, eligibleTokens: await eligibleTokens(session) };
  } finally {
    await session.close();
    await agent.dispose();
    await collecting;
  }
}

const per10k = (value, eligible) => (eligible ? Math.round((value / eligible) * 10_000 * 10) / 10 : null);
const isStmRow = (row) => row?.kind && row.description;

export const probes = [
  {
    // Probe 1: every task ends with an outcome naming its changes and its verification.
    id: "stm.outcome",
    async run() {
      const h = await replayLongSession();
      try {
        const ledger = await h.ledger();
        const outcomes = ledger.observations.filter((item) => item.kind === "outcome");
        const checks = h.fx.tasks.map((task) => {
          const event = h.fx.events.find((item) => item.id === task.outcome);
          const record = outcomes.find((item) => item.description === event.description);
          const named = (values) => values.every((value) => record?.description.includes(value));
          return Boolean(record) && named(task.changes) && named(task.verification);
        });
        const boundaries = (ledger.boundaries ?? []).filter((item) => item.reason === "outcome").length;
        const instruction = h.stmRequests().every((request) => /is one outcome event: what was asked, what changed/.test(request.text));
        return {
          surface: "ledger",
          property: "every task of the long-session fixture ends with an outcome event that names what changed and how it was verified",
          control: "trigger-absent",
          fires: outcomes.length,
          reaches: outcomes.length > 0,
          correct: checks.every(Boolean) && boundaries === outcomes.length && instruction && h.failures.length === 0,
          on: digest(outcomes.map((item) => item.description)),
          off: digest([]),
          counts: {
            tasks: h.fx.tasks.length,
            outcomes: outcomes.length,
            outcomeBoundaries: boundaries,
            rejected: h.stmLog.rejected.length,
          },
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    // Probe 2 (S2, plan 218.3 Task 4): recall returns the original source entries, the large tool output and the code
    // read byte-equal (the large one in pages, following each page's continuation); no other tool runs.
    id: "stm.recall-verbatim",
    async run() {
      const ids = h0Ids();
      const h = await replayLongSession();
      try {
        const runsBefore = h.toolLog.filter((call) => call.name !== "recall").length;
        const out = await h.recallTurn(ids, { detail: "full" });
        const recalled = out.results.filter((row) => row.name === "recall").map((row) => row.text);
        const pages = originalPages(recalled);
        const sources = [...new Set(ids.flatMap((id) => h.fx.events.find((event) => event.id === id).chunks.map((chunk) => chunk.source)))];
        const exact = sources.filter((source) => {
          const output = h.fx.calls.get(source)?.output;
          return output !== undefined && [...pages.values()].some((text) => text.endsWith(output));
        });
        const leftContext = !receivedText(out.request ?? {}).includes(h.fx.calls.get("c209").output.slice(0, 2000));
        const others = out.calls.filter((call) => call.name !== "recall");
        return {
          surface: "tool-result",
          property:
            "recall by STM id with detail full returns the large tool output and the code read byte-equal from the session store (the large one paged by offset), after the source left context, with no other tool run",
          control: "trigger-absent",
          fires: recalled.length,
          reaches: exact.length > 0,
          correct:
            exact.length === sources.length &&
            others.length === 0 &&
            leftContext &&
            h.toolLog.filter((c) => c.name !== "recall").length === runsBefore,
          on: digest(recalled),
          off: digest([]),
          counts: { sources: sources.length, byteEqual: exact.length, recallCalls: recalled.length, otherToolCalls: others.length },
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    // Probe 3: no STM request carries scope, WM or LTM text.
    id: "stm.scope-blind",
    async run() {
      const h = await replayLongSession({ sentinels: true, turns: ["t0", "t1", "t1b", "t2"] });
      try {
        const stm = h.stmRequests();
        const leaks = stm.filter((request) => [SCOPE_SENTINEL, LTM_SENTINEL, WM_SENTINEL].some((s) => request.text.includes(s)));
        const scopeLive = h.mainRequests.some((request) => JSON.stringify(request).includes(SCOPE_SENTINEL));
        const wmLive = (await h.ledger()).wmItems.some((item) => item.text.includes(WM_SENTINEL));
        return {
          surface: "worker-request",
          property:
            "an STM request carries only the batch, the task state and the recent STM index: never the episode scope, a WM item or an LTM note",
          control: "trigger-absent",
          fires: stm.length,
          reaches: scopeLive && wmLive,
          correct: leaks.length === 0 && stm.length > 0 && scopeLive && wmLive,
          on: digest(stm.length),
          off: digest(leaks.length),
          counts: { stmRequests: stm.length, leaks: leaks.length },
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    // Probe 4: polling and the repeated identical failure collapse into one record each, with a count.
    id: "stm.habituation",
    async run() {
      const arm = async (habituation) => {
        const h = await replayLongSession({ config: { stm: { habituation } }, turns: ["t4", "t5", "t5b"] });
        try {
          const ledger = await h.ledger();
          return h.fx.expected.habituated.map((want) => {
            const rows = ledger.observations.filter((item) => item.kind === want.kind && item.description === want.description);
            return { want: want.count, rows: rows.length, count: rows.reduce((max, row) => Math.max(max, row.count ?? 1), 0) };
          });
        } finally {
          await h.close();
        }
      };
      const on = await arm({ windowEvents: 50 });
      const off = await arm(false);
      return {
        surface: "ledger",
        property:
          "repeated identical events (polling, an identical failure) collapse into one record whose count is the repeats; habituation off records each",
        fires: on.filter((row) => row.count > 1).length,
        reaches: digest(on) !== digest(off),
        correct: on.every((row) => row.rows === 1 && row.count === row.want) && off.every((row) => row.rows === row.want),
        on: digest(on),
        off: digest(off),
        counts: { records: on.map((row) => row.rows), counts: on.map((row) => row.count), recordsWithout: off.map((row) => row.rows) },
      };
    },
  },
  {
    // Probe 5: every boundary leaves a marker; with stm.boundaries the idle gap alone runs a pass.
    id: "stm.boundaries",
    async run() {
      const h = await replayLongSession();
      let markers;
      let outcomes;
      let states;
      try {
        const ledger = await h.ledger();
        markers = ledger.boundaries ?? [];
        outcomes = ledger.observations.filter((item) => item.kind === "outcome").length;
        states = h.fx.taskStates.length;
      } finally {
        await h.close();
      }
      const gapArm = async (boundaries) => {
        const g = await replayLongSession({ config: { stm: { triggerTokens: 50_000_000, boundaries } }, turns: ["t5b", "t6"] });
        try {
          const ledger = await g.ledger();
          return {
            passes: g.stmPasses().length,
            idle: (ledger.boundaries ?? []).filter((item) => item.reason === "idle_gap").length,
            t6: g.turnMarks.t6,
          };
        } finally {
          await g.close();
        }
      };
      const on = await gapArm(true);
      const off = await gapArm(false);
      const count = (reason) => markers.filter((item) => item.reason === reason).length;
      return {
        surface: "ledger",
        property:
          "outcome, task-state and idle-gap boundaries each leave a marker; with stm.boundaries an idle-gap user turn runs an STM pass below the trigger",
        fires: markers.length,
        reaches: on.passes !== off.passes,
        correct:
          count("outcome") === outcomes &&
          count("task_state") === states &&
          count("idle_gap") === 1 &&
          on.idle === 1 &&
          off.idle === 1 &&
          on.passes === 1 &&
          on.t6.stmAfter - on.t6.stmBefore === 1 &&
          off.passes === 0,
        on: digest(on),
        off: digest(off),
        counts: {
          outcome: count("outcome"),
          taskState: count("task_state"),
          idleGap: count("idle_gap"),
          gapPassesOn: on.passes,
          gapPassesOff: off.passes,
        },
      };
    },
  },
  {
    // Probe 6: a tail larger than the worker message budget is batched and cut; no pass throws.
    id: "stm.oversized-tail",
    async run() {
      const h = await replayLongSession({ config: { worker: { maxMessageBytes: 65_536 } }, turns: ["t7", "t8"] });
      try {
        const ledger = await h.ledger();
        const entries = await h.session.entries();
        const position = (id) => entries.findIndex((entry) => entry.id === id);
        // The oversized read and everything after it in its turn are covered (the closing turn's own tail waits for a
        // later pass, as every last turn does).
        const reply = h.fx.turns.find((turn) => turn.id === "t7").reply;
        const afterOversized = entries.findIndex((entry) => entry.kind === "message" && textOf(entry.message?.content) === reply);
        const covered = afterOversized > 0 && position(ledger.latestObservationCoverageId) >= afterOversized;
        const truncated = h.stmPasses().filter((request) => /\[truncated: entry /.test(request.text)).length;
        return {
          surface: "ledger",
          property:
            "an unread tail larger than the worker budget is split into batches and an oversized entry is cut with a marker; every pass completes",
          fires: truncated,
          reaches: covered,
          correct: h.failures.length === 0 && h.runFailures.length === 0 && truncated >= 1 && covered && ledger.observations.length > 0,
          on: digest({ truncated, covered: true }),
          off: digest({ failures: h.failures.length }),
          counts: { stmPasses: h.stmPasses().length, truncatedBatches: truncated, failures: h.failures.length },
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    // Probe 7 (plan 218.3 Task 4): STM keeps no copy of session content; a superseded record's evidence stays readable.
    id: "stm.no-session-copy",
    async run() {
      const h = await replayLongSession();
      try {
        const entries = await h.session.entries();
        const ledgerText = JSON.stringify(entries.filter((entry) => entry.kind !== "message").map((entry) => entry.data ?? null));
        // Every tool output long enough to be unmistakable, by its first 120 characters.
        const outputs = [...h.fx.calls.values()].map((call) => call.output ?? "").filter((output) => output.length >= 200);
        const copied = outputs.filter((output) => ledgerText.includes(JSON.stringify(output.slice(0, 120)).slice(1, -1)));
        const ledger = await h.ledger();
        const superseded = h.fx.expected.superseded.map(({ event }) => h.fx.events.find((item) => item.id === event));
        const records = superseded.flatMap((event) => ledger.observations.filter((item) => item.description === event.description));
        const ids = new Set(entries.map((entry) => entry.id));
        const unreadable = records.flatMap((record) => record.sourceEntryIds.filter((id) => !ids.has(id)));
        return {
          surface: "ledger",
          property:
            "no ledger record carries a tool output (records cite entry ids), and a superseded record's source entries stay on the branch for recall",
          fires: outputs.length,
          reaches: records.length > 0 && outputs.length > 0,
          correct: copied.length === 0 && unreadable.length === 0,
          on: digest({ copied: copied.length }),
          off: digest({ unreadable: unreadable.length }),
          counts: {
            outputs: outputs.length,
            copied: copied.length,
            supersededRecords: records.length,
            unreadableSources: unreadable.length,
          },
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    // Cost on the fixture (moved from Tasks 1 and 2): worker tokens per 10k eligible tokens against the pre-redesign
    // observer, and chunk bytes per 10k eligible tokens with their share of the transcript bytes they cover.
    id: "stm.cost",
    async run() {
      const h = await replayLongSession();
      let stm;
      try {
        const eligible = await eligibleTokens(h.session);
        const ledger = await h.ledger();
        stm = {
          eligibleTokens: eligible,
          passes: h.stmLog.passes,
          outputTokens: h.stmLog.outputTokens,
          inputTokens: h.stmLog.inputTokens,
          outputPer10k: per10k(h.stmLog.outputTokens, eligible),
          inputPer10k: per10k(h.stmLog.inputTokens, eligible),
          records: ledger.observations.filter(isStmRow).length,
          savedByHabituation: ledger.observations.reduce((sum, item) => sum + Math.max(0, (item.count ?? 1) - 1), 0),
        };
      } finally {
        await h.close();
      }
      const before = await replayOmBefore();
      const omBefore = before && {
        eligibleTokens: before.eligibleTokens,
        passes: before.log.passes,
        outputTokens: before.log.outputTokens,
        inputTokens: before.log.inputTokens,
        outputPer10k: per10k(before.log.outputTokens, before.eligibleTokens),
        inputPer10k: per10k(before.log.inputTokens, before.eligibleTokens),
      };
      return {
        surface: "worker-request",
        property:
          "on the long-session fixture, STM worker tokens per 10k eligible tokens against the pre-redesign observer (plan 218.3 Task 4: no chunk store, so no stored bytes)",
        control: "trigger-absent",
        fires: stm.passes,
        reaches: stm.records > 0,
        correct: stm.records > 0 && omBefore !== null,
        on: digest(stm),
        off: digest(omBefore),
        counts: { stm, omBefore: omBefore ?? "worktree-missing" },
      };
    },
  },
];

/**
 * The original content each recalled page carries, by entry id: page headers (`[time] [entry] role (bytes a–b of N…):`)
 * mark where a slice starts; slices of one entry are put in offset order and joined (plan 218.3 Task 4).
 */
export function originalPages(texts) {
  const header = /^\[[^\]\n]+\] \[([^\]\n]+)\] \w+ \((?:bytes (\d+)–\d+ of \d+[^)\n]*|\d+ bytes[^)\n]*)\):$/gm;
  const slices = new Map();
  for (const text of texts) {
    const marks = [...text.matchAll(header)];
    for (const [index, mark] of marks.entries()) {
      const start = mark.index + mark[0].length + 1;
      const end = index + 1 < marks.length ? marks[index + 1].index - 1 : text.length;
      const offset = Number(mark[2] ?? 0);
      const byEntry = slices.get(mark[1]) ?? new Map();
      // The last slice of a record's evidence may be followed by the line listing entries past the page.
      byEntry.set(offset, text.slice(start, end).replace(/\n\[\d+ more source entr(?:y|ies) past this page[^\n]*\]$/, ""));
      slices.set(mark[1], byEntry);
    }
  }
  return new Map(
    [...slices].map(([entry, byOffset]) => [
      entry,
      [...byOffset]
        .sort((a, b) => a[0] - b[0])
        .map(([, slice]) => slice)
        .join(""),
    ]),
  );
}

/** The events probe 2 recalls: the large tool result and the code read (`expected.recall`). */
function h0Ids() {
  return longSession().expected.recall.map((item) => item.event);
}
