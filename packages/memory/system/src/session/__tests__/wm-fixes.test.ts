/**
 * Plan 218.5 Task 3: working memory's seven mechanical fixes (the 2026-11-22 critique). Each test fails on the code
 * before the task: a summary replaced a protected event, one fact replaced 25 items, the model set an item's relevance,
 * a replaced item's dates passed to its successor, a boundary ran a pass with no pressure, a tool-sourced fact replaced
 * a user item, and a user statement was tombstoned with a verdict.
 */
import { it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonValue, ModelClient, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { isDurableOrUserStatement, isUserStatement } from "../attribution.js";
import { resolveMemorySystemConfig } from "../config.js";
import { createObservationalFlush } from "../flush.js";
import { activeObservations, activeWmItems, foldObservationalMemoryLedger } from "../ledger.js";
import { prepareScope } from "../scope.js";
import {
  BOUNDARY_RECORDED,
  type MemoryObservation,
  type MemoryWmItem,
  OBSERVATIONS_RECORDED,
  OBSERVATIONS_TOMBSTONED,
  WM_RECORDED,
} from "../types.js";
import { MAX_WM_SUPERSEDES, runWm } from "../workers/wm.js";

type ProviderRequest = Parameters<ModelClient["generate"]>[0];

const T0 = "2026-11-12T10:00:00.000Z";
const at = (minute: number) => `2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`;
const record = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind: "result",
  description,
  timestamp: T0,
  relevance: "medium",
  sourceEntryIds: [`e-${id.slice(0, 2)}`],
  tokenCount: 10,
  ...extra,
});
const item = (id: string, text: string, citedIds: readonly string[], extra: Partial<MemoryWmItem> = {}): MemoryWmItem => ({
  id,
  kind: "summary",
  text,
  relevance: "medium",
  citedIds,
  tokenCount: 4,
  ...extra,
});
const recorded = (...observations: MemoryObservation[]) => ({ type: OBSERVATIONS_RECORDED, observations });
const tombstoned = (reason: string, ...observationIds: string[]) => ({ type: OBSERVATIONS_TOMBSTONED, observationIds, reason, at: T0 });

const done: ModelClient = {
  model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
  async *generate() {
    yield providerDone();
  },
};

/** A WM model that answers its first request with one `judge` call, then nothing. */
function judging(args: Record<string, unknown>, requests: ProviderRequest[] = []): ModelClient {
  return {
    ...done,
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool"))
        yield providerToolCall(toolCallContent("j0", "judge", args as never));
      yield providerDone();
    },
  };
}

const promptOf = (request: ProviderRequest) =>
  request.messages
    .find((message) => message.role === "user")!
    .content.map((block) => (block.type === "text" ? block.text : ""))
    .join("");

interface Refusal {
  readonly entry: string;
  readonly reason: string;
  readonly ordinal?: string;
  readonly protection?: string;
}
const refusals = (request: ProviderRequest | undefined): readonly Refusal[] => {
  const tool = [...(request?.messages ?? [])].reverse().find((message) => message.role === "tool");
  const block = tool?.content.find((part: { type: string }) => part.type === "tool_result") as
    | { result?: { refused?: Refusal[] } }
    | undefined;
  return block?.result?.refused ?? [];
};

/** One WM pass over `records` on the ledger `sources` fold to; `requests[1]` carries the `judge` result. */
async function pass(sources: readonly unknown[], records: readonly MemoryObservation[], args: Record<string, unknown>) {
  const requests: ProviderRequest[] = [];
  const output = await runWm({
    client: judging(args, requests),
    records,
    ledger: foldObservationalMemoryLedger(sources),
    maxTurns: 2,
    endAfterCleanTurn: false,
  });
  return { output, refused: refusals(requests[1]), requests };
}

const A = record("aaaaaaaaaaaa", "Ran the suite; 12 pass", { observedAt: at(1) });
const B = record("bbbbbbbbbbbb", "Read src/config.ts", { observedAt: at(2), relevance: "high" });

it("wm_cannot_supersede_a_protected_record", async () => {
  // A user constraint and an unresolved error, each kept as a WM event by an earlier pass.
  const rule = record("111111111111", "Always label tickets cobalt47", { kind: "statement", durable: "constraint", attribution: "user" });
  const error = record("222222222222", "The deploy script exited 1", { kind: "error" });
  const ruleEvent = item("aaaaaaaaaa01", rule.description, [rule.id], { kind: "event", reason: "protected: constraint" });
  const errorEvent = item("aaaaaaaaaa02", error.description, [error.id], { kind: "event", reason: "the next step fixes it" });
  const plain = item("aaaaaaaaaa03", "Earlier work", [A.id]);
  const sources = [
    recorded(rule, error, A, B),
    { type: WM_RECORDED, items: [ruleEvent, errorEvent, plain], processedIds: [rule.id, error.id] },
    tombstoned(`wm keep ${ruleEvent.id}`, rule.id),
    tombstoned(`wm keep ${errorEvent.id}`, error.id),
  ];
  const { output, refused } = await pass(sources, [A, B], {
    summaries: [
      { of: [1], text: "Task 2 done; tickets carry cobalt47.", supersedes: ["w1"] },
      { of: [2], text: "Deploy failed once.", supersedes: ["w2"] },
    ],
    facts: [{ text: "Earlier work is done.", support: ["r1"], supersedes: ["w3"] }],
  });
  // The code refuses both, naming the protection; the unprotected item is still replaced.
  assert.deepEqual(
    refused.map(({ entry, reason, ordinal, protection }) => ({ entry, reason, ordinal, protection })),
    [
      { entry: "summaries[0]", reason: "protected", ordinal: "w1", protection: "constraint" },
      { entry: "summaries[1]", reason: "protected", ordinal: "w2", protection: "unresolved_error" },
    ],
  );
  assert.deepEqual(output.supersededItemIds, [plain.id]);
  assert.equal(output.verdicts.size, 0, "a refused summary gives its records no verdict");

  // The protection is read from the ledger now, not from the item's reason: a passed outcome that resolves the error
  // frees its event, and the constraint's stays.
  const fixed = record("333333333333", "Deploy passes after the fix", { kind: "outcome", status: "passed", resolves: [error.id] });
  const later = await pass([...sources, recorded(fixed)], [A, B], {
    summaries: [
      { of: [1], text: "Tickets carry cobalt47.", supersedes: ["w1"] },
      { of: [2], text: "Deploy failed once, then passed.", supersedes: ["w2"] },
    ],
  });
  assert.deepEqual(
    later.refused.map(({ entry, protection }) => ({ entry, protection })),
    [{ entry: "summaries[0]", protection: "constraint" }],
  );
  assert.deepEqual(later.output.supersededItemIds, [errorEvent.id]);
});

it("supersedes_per_item_are_capped", async () => {
  assert.equal(MAX_WM_SUPERSEDES, 3);
  const items = [1, 2, 3, 4].map((n) => item(`aaaaaaaaaa0${n}`, `Old summary ${n}`, [A.id]));
  const sources = [recorded(A, B), { type: WM_RECORDED, items }];
  const { output, refused, requests } = await pass(sources, [A, B], {
    summaries: [{ of: [1], text: "Everything so far.", supersedes: ["w1", "w2", "w3", "w4"] }],
    facts: [{ text: "Three is the cap.", support: ["r2"], supersedes: ["w1", "w2", "w3"] }],
  });
  assert.deepEqual(
    refused.map(({ entry, reason }) => ({ entry, reason })),
    [{ entry: "summaries[0]", reason: "too_many_supersedes" }],
  );
  assert.deepEqual(
    output.supersededItemIds,
    items.slice(0, 3).map((made) => made.id),
  );
  assert.deepEqual(
    output.items.map((made) => made.kind),
    ["fact"],
  );
  // The tool states the cap, so a model reads it before it is refused.
  assert.match(requests[0]!.tools![0]!.description ?? "", /at most 3/);
});

it("wm_item_relevance_is_max_of_sources", async () => {
  const low = record("cccccccccccc", "Listed the directory", { relevance: "low", observedAt: at(3) });
  const support = item("aaaaaaaaaa01", "The loader is in src/config.ts", [B.id], { kind: "fact", relevance: "high" });
  const sources = [recorded(A, B, low), { type: WM_RECORDED, items: [support] }];
  const { output, requests } = await pass(sources, [A, B, low], {
    summaries: [
      // The model's own rating is ignored either way: too high, then too low.
      { of: [1, 3], text: "Suite ran; directory listed.", relevance: "critical" },
      { of: [2], text: "Config read.", relevance: "low" },
    ],
    facts: [{ text: "The loader's directory was listed.", support: ["r3", "w1"], relevance: "low" }],
  });
  assert.deepEqual(
    output.items.map((made) => [made.kind, made.relevance]),
    [
      ["summary", "medium"],
      ["summary", "high"],
      // A fact's sources are the records and the items it cites.
      ["fact", "high"],
    ],
  );
  // The model is no longer asked for it.
  const schema = requests[0]!.tools![0]!.parameters as {
    properties: Record<string, { items: { properties: Record<string, unknown>; required: string[] } }>;
  };
  for (const key of ["summaries", "facts"]) {
    assert.equal("relevance" in schema.properties[key]!.items.properties, false, key);
    assert.equal(schema.properties[key]!.items.required.includes("relevance"), false, key);
  }
});

it("wm_span_from_cited_records_only", async () => {
  const early = record("cccccccccccc", "Planned ship day is Thursday", { observedAt: at(0) });
  // The item a new summary replaces carries a later span than anything the summary cites.
  const replaced = item("aaaaaaaaaa01", "Ship day moved to Tuesday", [B.id], {
    observedFrom: "2026-11-20T09:00:00.000Z",
    observedTo: "2026-11-20T09:00:00.000Z",
  });
  // An item with a wrong stored span (written before this fix): a fact citing it reads the item's records, not its span.
  const cited = item("aaaaaaaaaa02", "The suite passes", [A.id], {
    observedFrom: "2026-11-21T09:00:00.000Z",
    observedTo: "2026-11-21T09:00:00.000Z",
  });
  const sources = [recorded(early, A, B), { type: WM_RECORDED, items: [replaced, cited] }];
  const { output } = await pass(sources, [early], {
    summaries: [{ of: [1], text: "Planned ship day is Thursday.", supersedes: ["w1"] }],
    facts: [{ text: "The suite passes.", support: ["w2"] }],
  });
  const [summary, fact] = output.items;
  assert.deepEqual([summary?.observedFrom, summary?.observedTo], [at(0), at(0)], "a re-asserted old value keeps its own date");
  assert.deepEqual([fact?.observedFrom, fact?.observedTo], [at(1), at(1)], "a cited item gives its records' span");
});

it("fact_supersedes_user_item_only_with_newer_user_citation", async () => {
  // The user's own decision, kept as a WM event; then a tool result and, later, the user's change.
  const older = record("111111111111", "User asked for a Thursday ship day", { kind: "request", attribution: "user" });
  const decision = record("222222222222", "User decided: ship on Thursday", { kind: "decision", attribution: "user" });
  const doc = record("333333333333", "docs/release-process.md says the ship day is Tuesday", { attribution: "tool" });
  const change = record("444444444444", "User moved the ship day to Friday", { kind: "decision", attribution: "user" });
  const userItem = item("aaaaaaaaaa01", decision.description, [decision.id], { kind: "event", attribution: "user" });
  const plain = item("aaaaaaaaaa02", "Earlier work", [A.id]);
  const sources = [
    recorded(A, older, decision),
    { type: WM_RECORDED, items: [userItem, plain], processedIds: [decision.id] },
    tombstoned(`wm keep ${userItem.id}`, decision.id),
    recorded(doc, change),
  ];
  const run = (support: readonly string[], supersedes: readonly string[]) =>
    pass(sources, [older, doc, change], { facts: [{ text: "Ship day.", support, supersedes }] });

  // A stale document may not replace what the user said (the screen's D4 failure in id-19 and sc-08).
  const fromTool = await run(["r2"], ["w1"]);
  assert.deepEqual(
    fromTool.refused.map(({ entry, reason, ordinal }) => ({ entry, reason, ordinal })),
    [{ entry: "facts[0]", reason: "user_item_needs_newer_user_record", ordinal: "w1" }],
  );
  assert.deepEqual(fromTool.output.supersededItemIds, []);
  // Nor may a user record older than the item's own.
  assert.equal((await run(["r1"], ["w1"])).refused[0]?.reason, "user_item_needs_newer_user_record");
  // The user's later change may, and an item that is not the user's needs no such citation.
  assert.deepEqual((await run(["r2", "r3"], ["w1"])).output.supersededItemIds, [userItem.id]);
  assert.deepEqual((await run(["r2"], ["w2"])).output.supersededItemIds, [plain.id]);
});

const SCOPE = (() => {
  const prepared = prepareScope("1. Run the suites\n2. Ship", { maxBytes: 4_096, at: T0 });
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.scope;
})();

function harness(records: unknown[], client: ModelClient, config: Parameters<typeof resolveMemorySystemConfig>[0] = {}) {
  const data = structuredClone(records) as JsonValue[];
  const session = { id: "s", entries: async () => [] as SessionEntry[] } as unknown as SessionContext;
  const log = {
    entries: () => data,
    append: async (_session: SessionContext, value: JsonValue) => {
      data.push(value);
    },
  } as unknown as SessionLog<JsonValue>;
  return {
    data,
    session,
    ledger: () => foldObservationalMemoryLedger(data),
    flush: createObservationalFlush({
      log,
      config: resolveMemorySystemConfig({
        wm: { policy: "model", triggerTokens: 1 },
        rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
        ...config,
      }),
      readState: () => ({ enabled: true }),
      scopeFor: () => SCOPE,
      clientFor: () => client,
      onStatus: () => {},
    }),
  };
}

it("wm_runs_on_pressure_only", async () => {
  let calls = 0;
  const client: ModelClient = {
    ...done,
    async *generate() {
      calls++;
      yield providerDone();
    },
  };
  const h = harness([recorded(A)], client, {
    wm: { policy: "model", triggerTokens: 15 },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  h.data.push({ type: BOUNDARY_RECORDED, reason: "outcome", entryId: "x1", recordId: A.id, at: T0 } as unknown as JsonValue);
  await h.flush.flush(h.session);
  assert.equal(calls, 0, "a new boundary below the trigger runs no pass");
  h.data.push(recorded(B) as unknown as JsonValue);
  await h.flush.flush(h.session);
  assert.equal(calls, 1, "the surface reaching wm.triggerTokens does");
  const wm = h.data.find((value) => (value as { type?: string }).type === WM_RECORDED) as Record<string, unknown>;
  assert.equal("boundaries" in wm, false, "the pass no longer counts boundaries");
  assert.equal("wmBoundariesSeen" in h.ledger(), false);
  // A ledger written before this task still folds: its count is ignored.
  assert.doesNotThrow(() => foldObservationalMemoryLedger([{ type: WM_RECORDED, items: [], boundaries: 3 }]));
});

it("durable_and_user_records_never_tombstoned", async () => {
  const statement = record("111111111111", "The release channel is #release", {
    kind: "statement",
    attribution: "user",
    observedAt: at(0),
  });
  const verbatim = record("222222222222", "User said: ship on Tuesday, not Thursday", {
    kind: "request",
    attribution: "user",
    verbatim: true,
    relevance: "high",
    observedAt: at(1),
  });
  const preference = record("333333333333", "Prefers short commit messages", {
    kind: "decision",
    durable: "preference",
    observedAt: at(2),
  });
  const mixed = record("444444444444", "User agreed to the assistant's plan", {
    kind: "statement",
    attribution: "mixed",
    observedAt: at(3),
  });
  const request = record("555555555555", "Rename the config loader", { kind: "request", attribution: "user", observedAt: at(4) });
  const proposal = record("666666666666", "Suggest moving the loader", { kind: "statement", attribution: "assistant", observedAt: at(5) });
  const held = [statement, verbatim, preference, mixed];
  const judged = [request, proposal, A];
  assert.deepEqual([...held, ...judged].map(isDurableOrUserStatement), [true, true, true, true, false, false, false]);
  assert.equal(isUserStatement(preference), false, "a durable mark holds a record on its own");

  // The model tries to discard everything it can name. It is sent the three judgeable records only.
  const requests: ProviderRequest[] = [];
  const h = harness([recorded(...held, ...judged)], judging({ discard: { finished: [1, 2, 3, 4, 5, 6, 7] } }, requests));
  await h.flush.flush(h.session);
  const prompt = promptOf(requests[0]!);
  for (const kept of held) assert.equal(prompt.includes(kept.description), false, kept.description);
  assert.match(prompt, /## New STM records \(3;/);
  assert.deepEqual(Object.keys(h.ledger().tombstones ?? {}).sort(), judged.map((made) => made.id).sort());
  assert.deepEqual(
    activeObservations(h.ledger()).map((made) => made.id),
    held.map((made) => made.id),
  );
  assert.deepEqual(activeWmItems(h.ledger()), []);

  // The deterministic policy reads the same surface: at a target that discards all it can, the four stay.
  const deterministic = harness([recorded(...held, ...judged)], done, {
    wm: { policy: "deterministic", triggerTokens: 1, targetRatio: 0.01 },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  await deterministic.flush.flush(deterministic.session);
  assert.deepEqual(
    activeObservations(deterministic.ledger()).map((made) => made.id),
    held.map((made) => made.id),
  );

  // Records WM cannot judge are no pressure it can relieve: alone they run no pass, even a forced one.
  let calls = 0;
  const idle = harness([recorded(...held)], {
    ...done,
    async *generate() {
      calls++;
      yield providerDone();
    },
  });
  await idle.flush.flush(idle.session, { forceWm: true });
  assert.equal(calls, 0);
  assert.equal(idle.data.length, 1, "no wm.recorded record");
});
