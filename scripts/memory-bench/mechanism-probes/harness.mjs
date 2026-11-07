/**
 * Plan 210 Task 2: shared harness for the offline mechanism probes.
 *
 * Every probe drives the real memory packages (fabric, observational, wiki) through a scripted
 * scenario on a scripted provider and answers three questions about one mechanism:
 *   fires   — it ran (a count, from an observable effect: a note field, an event, a tool result row);
 *   reaches — its output changed something the agent receives (request bytes or tool results, on vs off);
 *   correct — the effect is the documented one.
 * Evidence is hashes, counts and verdicts only; fixture text never leaves the process.
 */
// Must stay the first import: it transforms the id sources before any memory module loads.
import "./deterministic-ids.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeRequests } from "../prefix-probe.mjs";

export const VERDICTS = ["works", "never-fires", "no-effect", "wrong-effect"];
export const PROBE_EPOCH = "2026-01-01T00:00:00.000Z";
export const PROJECT_ID = "probe--01234567";
export const TENANT = "mechanism-probe";
export const SCOPE = { tenantId: TENANT, resourceId: `projects/${PROJECT_ID}`, threadId: "default" };

const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

/**
 * Note ids, UUIDs and ISO stamps are run-local, so two arms of one probe would differ in bytes even
 * when the mechanism changed nothing. They are replaced by first-appearance tokens before hashing.
 */
export function canonical(value) {
  const seen = new Map();
  const token = (kind) => (match) => {
    if (!seen.has(match)) seen.set(match, `<${kind}${seen.size}>`);
    return seen.get(match);
  };
  return JSON.stringify(value ?? null)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, token("uuid"))
    // Hex lookarounds, not \b: in JSON an id often follows an escaped newline (`\nab12…`).
    .replace(/(?<![0-9a-f])[0-9a-f]{12}(?![0-9a-f])/g, token("id"))
    // A note file name carries its id's first 8 hex digits (`<slug>--<id8>.md`).
    .replace(/--[0-9a-f]{8}(?=\.md)/g, token("id8"))
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, token("t"));
}

export const digest = (value) => sha256(canonical(value));

/**
 * The verdict order is the plan's: a mechanism that never ran cannot have reached anything, and one
 * that ran without changing what the agent receives is `no-effect` even when its own state moved.
 */
export function verdict({ fires, reaches, correct }) {
  if (!fires) return "never-fires";
  if (!reaches) return "no-effect";
  return correct ? "works" : "wrong-effect";
}

/** Normalize one probe's raw outcome to the public row shape (hashes, counts, verdict). */
export function probeRow(id, outcome) {
  const fires = Number(outcome.fires ?? 0);
  const row = {
    id,
    fires,
    reaches: Boolean(outcome.reaches),
    correct: Boolean(outcome.correct),
    verdict: outcome.verdict ?? verdict({ fires: fires > 0, reaches: outcome.reaches, correct: outcome.correct }),
    surface: outcome.surface ?? "unspecified",
    property: outcome.property,
    ...(outcome.on === undefined ? {} : { onSha256: outcome.on }),
    ...(outcome.off === undefined ? {} : { offSha256: outcome.off }),
    ...(outcome.counts === undefined ? {} : { counts: outcome.counts }),
    ...(outcome.finding === undefined ? {} : { finding: outcome.finding }),
    ...(outcome.fixed === undefined ? {} : { fixed: outcome.fixed }),
    ...(outcome.config === undefined ? {} : { config: outcome.config }),
  };
  assert.ok(VERDICTS.includes(row.verdict), `${id}: unknown verdict ${row.verdict}`);
  assert.equal(typeof row.property, "string", `${id}: a probe names the documented property it checks`);
  return row;
}

let envDepth = 0;
/** Fixed clock and no network for the whole probe run; restored on exit. */
export async function withProbeEnv(fn) {
  const RealDate = globalThis.Date;
  const realFetch = globalThis.fetch;
  if (envDepth++ === 0) {
    if (globalThis.__prismMechanismProbe) globalThis.__prismMechanismProbe.n = 0;
    let offset = 0;
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [RealDate.parse(PROBE_EPOCH) + offset]));
      }
      static now() {
        return RealDate.parse(PROBE_EPOCH) + offset;
      }
    };
    globalThis.Date.advance = (ms) => {
      offset += ms;
    };
    globalThis.fetch = () => {
      throw new Error("mechanism probes forbid network access");
    };
  }
  try {
    return await fn();
  } finally {
    if (--envDepth === 0) {
      globalThis.Date = RealDate;
      globalThis.fetch = realFetch;
    }
  }
}

/** Advance the fixed clock (days), for decay and grace windows. */
export const advanceDays = (days) => globalThis.Date.advance?.(days * 86_400_000);

/** A temporary root removed on exit, whatever the probe did. */
export async function withTempRoot(fn) {
  const dir = await mkdtemp(join(tmpdir(), "prism-mechanism-probe-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const tick = () => new Promise((done) => setTimeout(done, 0));

let modules;
async function load() {
  modules ??= {
    prism: await import("@arnilo/prism"),
    testing: await import("@arnilo/prism/testing"),
    kit: await import("@arnilo/prism/provider-kit"),
    fabric: await import("@arnilo/prism-memory-fabric"),
    sqlite: await import("@arnilo/prism-memory-core/sqlite"),
  };
  return modules;
}

export async function packages() {
  return load();
}

/** Provider events for a text reply and for one tool call. */
export async function events() {
  const { testing } = await load();
  return {
    say: (text) => [testing.providerTextDelta(text), testing.providerDone()],
    call: (name, args, id = `call-${name}`) => [testing.providerToolCall(testing.toolCallContent(id, name, args)), testing.providerDone()],
  };
}

/** A provider whose reply is a function of the request: probes script behaviour, not a fixed tape. */
export async function responder(id, respond, onRequest) {
  const { kit } = await load();
  let calls = 0;
  const provider = {
    id,
    async *generate(request) {
      onRequest?.(request);
      const step = await respond(request, calls++);
      for (const event of step) yield event;
    },
  };
  return kit.providerPackage(`probe-${id}`, [provider], "Mechanism probe scripted provider");
}

const isToolTurn = (request) => request.messages.at(-1)?.role === "tool";

/**
 * One agent with the real fabric package on a SQLite store under `dir`. `respond(request, ctx)`
 * returns the main model's events; `worker` answers every other model ref (extractor, curator,
 * observer). The writer is a second fabric over the same store, for seeding notes.
 */
export async function fabricAgent(
  dir,
  { config = {}, respond, worker, extraPackages = [], afterPackages = [], seed, agentOptions = {}, projectRoot, writerOptions = {} } = {},
) {
  const { prism, fabric, sqlite } = await load();
  const ev = await events();
  await mkdir(dir, { recursive: true });
  const path = join(dir, "memory.sqlite");
  const stores = await sqlite.createSqliteMemoryStores({ path });
  const memory = fabric.createMemory({ ...SCOPE, ...stores });
  const writer = fabric.createMemoryFabric({ memory, vectorStore: stores.vectorStore, consolidate: false, ...writerOptions });
  if (seed) await seed({ writer, memory, stores });
  const requests = [];
  const workerRequests = [];
  const toolResults = [];
  const agentEvents = [];
  const active = new Set();
  const failures = [];
  const completed = [];
  let turnState = { sessionKey: undefined, turn: 0 };
  const main = await responder(
    "mock",
    (request, call) => {
      const ctx = { ...turnState, call, toolTurn: isToolTurn(request), ev };
      return respond ? respond(request, ctx) : ev.say("ok");
    },
    (request) => requests.push({ ...turnState, request: structuredClone({ context: request.context, messages: request.messages, tools: request.tools?.map((tool) => tool.name) }) }),
  );
  const workers = await responder(
    "worker",
    (request, call) => (worker ? worker(request, { call, toolTurn: isToolTurn(request), ev }) : ev.say("")),
    (request) => workerRequests.push(structuredClone({ system: request.system, messages: request.messages, tools: request.tools?.map((tool) => tool.name) })),
  );
  const root = projectRoot ?? dir;
  const fabricConfig = {
    tools: { root: dir },
    store: { sqlite: { path } },
    scopes: { tenantId: TENANT, project: { id: PROJECT_ID, root }, agent: false, user: false },
    ...config,
    ...(config.scopes ? { scopes: { tenantId: TENANT, project: { id: PROJECT_ID, root }, agent: false, user: false, ...config.scopes } } : {}),
  };
  const agent = await prism.createAgent({
    model: "mock/main",
    packages: [main, workers, ...extraPackages, fabric.default(fabricConfig), ...afterPackages],
    ...agentOptions,
  });
  const stream = agent.subscribe();
  const collection = (async () => {
    for await (const event of stream) {
      agentEvents.push({ type: event.type, ...(event.name === undefined ? {} : { name: event.name }) });
      if (event.type === "background.started") active.add(event.taskId);
      if (event.type === "background.completed" || event.type === "background.failed") {
        active.delete(event.taskId);
        if (event.type === "background.failed") failures.push(String(event.reason?.message ?? event.reason));
        else completed.push(event.name);
      }
    }
  })();
  async function settle() {
    for (let i = 0; i < 2000; i++) {
      await tick();
      if (!active.size) {
        await tick();
        if (!active.size) return;
      }
    }
    throw new Error("mechanism probe background timeout");
  }
  const sessions = new Map();
  return {
    agent,
    memory,
    writer,
    stores,
    requests,
    workerRequests,
    toolResults,
    events: agentEvents,
    completed,
    failures,
    async session(key) {
      if (!sessions.has(key)) sessions.set(key, await agent.session({ id: key, create: true }));
      return sessions.get(key);
    },
    async closeSession(key) {
      const session = sessions.get(key);
      if (!session) return;
      sessions.delete(key);
      await session.close();
      await settle();
    },
    async run(key, text) {
      const session = await this.session(key);
      turnState = { sessionKey: key, turn: turnState.turn + 1 };
      // A session stream ends with its run, so each run gets its own subscription.
      const pump = (async () => {
        for await (const event of session.subscribe())
          if (event.type === "tool.completed") toolResults.push({ ...turnState, name: event.name, result: structuredClone(event.result) });
      })();
      const result = await session.run(text);
      await pump;
      await settle();
      return result;
    },
    async command(name, args = {}, key = "commands") {
      return agent.commands.run(name, args, { session: await this.session(key) });
    },
    async notes() {
      const rows = await stores.vectorStore.getByThread(SCOPE);
      return rows.map((row) => ({ id: row.id, text: row.text, metadata: fabric.parseMemoryNoteMetadata(row.metadata) }));
    },
    settle,
    async close() {
      for (const key of [...sessions.keys()]) await this.closeSession(key);
      await agent.dispose();
      await collection;
      stores.close();
    },
  };
}

/** Note ids the agent was shown in the newest message (tool JSON or rendered `[id]` lines). */
export function shownIds(request) {
  const text = receivedText({ messages: request.messages.slice(-1) });
  return [...new Set([...text.matchAll(/\[([0-9a-f]{12})\]|"id":"([0-9a-f]{12})"/g)].map((m) => m[1] ?? m[2]))];
}

/** Text of a tool result, for in-process assertions only (never emitted). */
export const resultText = (result) => (result?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");

/** The context blocks and the semantic tail of a captured request, with a hash per fabric source. */
export function requestShape(request) {
  const summary = summarizeRequests([{ request, turn: 0, writes: [] }]).requests[0];
  const sources = {};
  for (const block of request.context ?? []) {
    const source = block.metadata?.source ?? "other";
    sources[source] = (sources[source] ?? 0) + 1;
  }
  const tail = (request.messages ?? []).flatMap((message) => message.metadata?.contextBlocks ?? []);
  return { sources, tailBlocks: tail.length, tailPresent: summary.tailPresent };
}

/** Text the agent receives on a request: context blocks plus message text (in-process only). */
export function receivedText(request) {
  const blocks = (request.context ?? []).map((block) => (typeof block.content === "string" ? block.content : JSON.stringify(block.content)));
  const messages = (request.messages ?? []).map((message) =>
    typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((block) => (block.type === "text" ? block.text : block.type === "tool_result" ? JSON.stringify(block) : "")).join("\n"),
  );
  return [...blocks, ...messages].join("\n");
}

/** Everything one arm delivered to the agent, as one digest: every request plus every tool result. */
export function armDigest(h) {
  return digest({
    requests: h.requests.map(({ request }) => ({ context: request.context, messages: request.messages, tools: request.tools })),
    tools: h.toolResults.map(({ name, result }) => ({ name, content: result?.content })),
  });
}

/**
 * Run the same scenario with the mechanism on and off. `scenario(h)` drives the agent and returns
 * the probe's own observations; both arms get identical scripts, so any digest difference is the
 * mechanism's.
 */
export async function onOff(root, { on, off, scenario, ...shared }) {
  const arms = {};
  for (const [name, config] of [
    ["on", on],
    ["off", off],
  ]) {
    const h = await fabricAgent(join(root, name), { ...shared, config });
    try {
      const observed = await scenario(h, name);
      arms[name] = { digest: armDigest(h), observed, h: { requests: h.requests, toolResults: h.toolResults, completed: [...h.completed] } };
    } finally {
      await h.close();
    }
  }
  return { on: arms.on, off: arms.off, reaches: arms.on.digest !== arms.off.digest };
}

/**
 * A turn script: `queue(plan)` sets what the main model does on its next user turn. A plan is
 * `{ calls: [{ name, args }], cite: boolean | string }`: the calls run in order, then the model
 * answers, citing every id it was shown when `cite` is true, or replying with `cite` when a string.
 */
export function scripted() {
  const plans = [];
  let current;
  let step = 0;
  let shown = [];
  return {
    queue(...items) {
      plans.push(...items);
      return this;
    },
    respond(request, ctx) {
      if (!ctx.toolTurn) {
        current = plans.shift() ?? { calls: [], cite: false };
        step = 0;
        shown = [];
      } else shown.push(...shownIds(request));
      const call = current.calls?.[step++];
      if (call) return ctx.ev.call(call.name, call.args, `c${ctx.turn}-${step}`);
      if (typeof current.cite === "string") return ctx.ev.say(current.cite);
      if (current.cite) return ctx.ev.say(`Answer ${[...new Set(shown)].map((id) => `[${id}]`).join(" ")}`.trim());
      return ctx.ev.say("ok");
    },
  };
}

/** Hit ids of the newest result of `name` (default `memory.recall`), in returned order. */
export function lastHits(h, name = "memory.recall") {
  const row = h.toolResults.findLast((item) => item.name === name);
  return (row?.result?.value?.hits ?? []).map((hit) => hit.id);
}

/** The newest structured value of `name`. */
export function lastValue(h, name = "memory.recall") {
  return h.toolResults.findLast((item) => item.name === name)?.result?.value;
}

/** A decisions-capable provider (`decider/d1`): `answer(request)` maps question keys to answers. */
export async function decider(answer) {
  const { kit } = await load();
  const calls = [];
  const provider = {
    id: "decider",
    async *generate() {
      yield { type: "done" };
    },
    decisions: () => ({
      id: "decider",
      async decide(request) {
        calls.push(Object.keys(request.questions ?? {}));
        return { model: "decider/d1", answers: answer(request), timingMs: 1 };
      },
    }),
  };
  return { pkg: kit.providerPackage("probe-decider", [provider], "Mechanism probe decisions"), calls };
}

/** Answer every question of a decisions request with one noul probability (choice questions get `choice`). */
export const answerAll = (noul, choice) => (request) =>
  Object.fromEntries(
    Object.entries(request.questions ?? {}).map(([key, question]) => [
      key,
      question.type === "choice" ? { type: "choice", choice: choice ?? "unrelated", confidence: 0.99 } : { type: "noul", noul },
    ]),
  );

/** Context blocks of `source` on a captured request, and the semantic tail's text. */
export function blocksOf(request, source) {
  return (request.context ?? []).filter((block) => block.metadata?.source === source);
}

export function tailText(request) {
  return (request.messages ?? [])
    .filter((message) => message.metadata?.contextBlocks?.some((block) => block.source === "fabric-semantic"))
    .map((message) => receivedText({ messages: [message] }))
    .join("\n");
}

/** Text of the tail messages that carry a context block of `source` (working memory, lesson nudges). */
export function tailSourceText(request, source) {
  return (request.messages ?? [])
    .filter((message) => message.metadata?.contextBlocks?.some((block) => block.source === source))
    .map((message) => receivedText({ messages: [message] }))
    .join("\n");
}
