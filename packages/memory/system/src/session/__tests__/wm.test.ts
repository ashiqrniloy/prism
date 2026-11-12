/**
 * Plan 218 Task 2: the WM pass gives verdicts on named STM records, incrementally (I6). It tombstones what it
 * processed (I2), moves chunk referrers from STM to the WM items that cite them (I3), and leaves records without a
 * verdict on the STM surface for the next pass.
 */
import { it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { JsonValue, ModelClient, ProviderEvent, SessionContext, SessionEntry, SessionLog } from "@arnilo/prism";

type ProviderRequest = Parameters<ModelClient["generate"]>[0];

import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { type ChunkStore, createChunkStoreHandle, createSqliteChunkStore, type PreparedChunk } from "../../chunks.js";
import { resolveMemorySystemConfig } from "../config.js";
import { observationalMemoryBlock } from "../context.js";
import { createObservationalFlush } from "../flush.js";
import { activeObservations, activeWmItems, foldObservationalMemoryLedger } from "../ledger.js";
import { recallObservationalMemory } from "../recall.js";
import { renderObservationalMemory } from "../render.js";
import { prepareScope, SCOPE_SET } from "../scope.js";
import {
  BOUNDARY_RECORDED,
  type MemoryObservation,
  MemorySessionLedgerError,
  type MemoryWmItem,
  OBSERVATIONS_RECORDED,
  WM_RECORDED,
} from "../types.js";
import { runDropper } from "../workers/dropper.js";
import { DEFAULT_WM_INSTRUCTION, runWm } from "../workers/wm.js";

const record = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind: "result",
  description,
  timestamp: "2026-11-12T10:00:00.000Z",
  observedAt: `2026-11-12T10:0${id.charCodeAt(0) % 10}:00.000Z`,
  relevance: "medium",
  sourceEntryIds: [`e-${id.slice(0, 2)}`],
  tokenCount: 10,
  ...extra,
});
const A = record("aaaaaaaaaaaa", "Ran the campaign suite one; 12 pass");
const B = record("bbbbbbbbbbbb", "Ran the campaign suite two; 11 pass");
const C = record("cccccccccccc", "Ran the campaign suite three; 12 pass");
const D = record("dddddddddddd", "Read the README");
const recorded = (...observations: MemoryObservation[]) => ({ type: OBSERVATIONS_RECORDED, observations });
const item = (id: string, text: string, citedIds: readonly string[]): MemoryWmItem => ({
  id,
  kind: "summary",
  text,
  relevance: "medium",
  citedIds,
  tokenCount: 4,
});

const done: ModelClient = {
  model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
  async *generate() {
    yield providerDone();
  },
};

/** A WM model that answers the first request with `calls`, then nothing. */
function scripted(calls: readonly [string, Record<string, unknown>][], requests: ProviderRequest[] = []): ModelClient {
  return {
    ...done,
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool"))
        for (const [index, [name, args]] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, name, args as never));
      yield providerDone();
    },
  };
}

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
    deps: { log, readState: () => ({ enabled: true }), clientFor: () => client, onStatus: () => {} },
    flush: createObservationalFlush({
      log,
      config: resolveMemorySystemConfig({
        wm: { triggerTokens: 1 },
        rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
        ...config,
      }),
      readState: () => ({ enabled: true }),
      clientFor: () => client,
      onStatus: () => {},
    }),
  };
}

const replies = (request: ProviderRequest) =>
  request.messages
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
    .map((part) => JSON.stringify(part));

it("every_processed_stm_record_has_exactly_one_verdict", async () => {
  const requests: ProviderRequest[] = [];
  const h = harness(
    [recorded(A, B, C, D)],
    scripted(
      [
        ["summarize", { stmIds: [A.id, B.id], text: "Ran suites one and two; 23 pass.", relevance: "medium" }],
        ["keep", { stmId: A.id, reason: "twice" }],
        ["keep", { stmId: C.id, reason: "step 4 needs it" }],
        ["discard", { stmId: B.id, reason: "duplicate" }],
        ["discard", { stmId: D.id, reason: "finished" }],
      ],
      requests,
    ),
    { worker: { maxTurns: 2 } },
  );
  const result = await h.flush.flush(h.session);
  assert.equal(result.processed, 4);
  assert.equal(result.wmItems, 2);
  const ledger = h.ledger();
  // One tombstone per record, carrying its verdict; the second verdict on A and B was refused.
  assert.deepEqual(Object.keys(ledger.tombstones ?? {}).sort(), [A.id, B.id, C.id, D.id]);
  assert.match(ledger.tombstones![A.id]!.reason, /^wm summarize [a-f0-9]{12}$/);
  assert.match(ledger.tombstones![C.id]!.reason, /^wm keep [a-f0-9]{12}$/);
  assert.equal(ledger.tombstones![D.id]!.reason, "wm discard finished");
  assert.equal(
    (
      replies(requests[1]!)
        .join("\n")
        .match(/already_processed/g) ?? []
    ).length,
    2,
  );
  const wm = h.data.find((value) => (value as { type?: string }).type === WM_RECORDED) as { processedIds: string[] };
  assert.deepEqual(wm.processedIds.sort(), [A.id, B.id, C.id, D.id]);
  // The kept record is an `event` citing it with its chunks and time; the summary cites both records it replaced.
  const [summary, event] = activeWmItems(ledger);
  assert.equal(summary?.kind, "summary");
  assert.deepEqual(summary?.citedIds, [A.id, B.id]);
  assert.equal(event?.kind, "event");
  assert.equal(event?.text, C.description);
  assert.equal(event?.reason, "step 4 needs it");
});

it("partial_pass_keeps_unprocessed_records_rendered", async () => {
  const h = harness(
    [recorded(A, B, C, D)],
    scripted([
      ["keep", { stmId: A.id, reason: "needed" }],
      ["discard", { stmId: B.id, reason: "finished" }],
    ]),
  );
  await h.flush.flush(h.session);
  const ledger = h.ledger();
  assert.deepEqual(
    activeObservations(ledger).map((item) => item.id),
    [C.id, D.id],
  );
  const block = String(observationalMemoryBlock(ledger)[0]!.content);
  assert.match(block, /suite three/);
  assert.match(block, /Read the README/);
  assert.match(block, /## Working memory\n- \[[a-f0-9]{12}\] .*event: Ran the campaign suite one/);
  assert.doesNotMatch(block, /suite two/);
  // No whole-set rewrite: no WM record names an item it was not told to supersede.
  assert.ok(h.data.every((value) => !(value as { supersededItemIds?: unknown }).supersededItemIds));
});

it("only_named_items_are_superseded", async () => {
  const one = item("111111111111", "Old summary one", [A.id]);
  const two = item("222222222222", "Old summary two", [A.id]);
  const h = harness(
    [recorded(A, B, C), { type: WM_RECORDED, items: [one, two] }],
    scripted([
      ["summarize", { stmIds: [B.id], text: "Suite two: 11 → 12 pass after the retry fix.", relevance: "high", supersedes: [one.id] }],
      ["derive", { text: "The retry fix is in.", supportingIds: [C.id, two.id], relevance: "high", supersedes: ["333333333333"] }],
    ]),
  );
  await h.flush.flush(h.session);
  const active = activeWmItems(h.ledger()).map((wmItem) => wmItem.text);
  assert.deepEqual(active, ["Old summary two", "Suite two: 11 → 12 pass after the retry fix."]);
  assert.deepEqual(h.ledger().supersededWmItemIds, [one.id]);
});

it("processed_stm_is_tombstoned_and_recallable", async () => {
  const h = harness([recorded(A)], scripted([["discard", { stmId: A.id, reason: "out-of-scope" }]]));
  await h.flush.flush(h.session);
  const entries = h.data.map((value, index) => ({ id: `r${index}`, sessionId: "s", timestamp: A.timestamp, kind: "custom", data: value }));
  const recalled = recallObservationalMemory(entries as SessionEntry[], A.id);
  assert.equal(recalled.found, true);
  assert.equal(recalled.state, "tombstoned");
  assert.match(recalled.text, /tombstoned: wm discard out-of-scope/);
  assert.deepEqual(activeObservations(h.ledger()), []);
});

it("chunk_cited_by_wm_survives_uncited_chunk_deleted", async () => {
  const store: ChunkStore = await createSqliteChunkStore({ path: ":memory:" });
  const chunk = (text: string, sourceEntryId: string): PreparedChunk => {
    const sha256 = createHash("sha256").update(text).digest("hex");
    return { id: sha256.slice(0, 24), sourceEntryId, sha256, bytes: Buffer.byteLength(text), text };
  };
  const kept = chunk("12 passed, 0 failed", "e-aa");
  const dropped = chunk("README text", "e-dd");
  const ref = ({ text: _text, ...rest }: PreparedChunk) => rest;
  await store.put(kept, { kind: "stm", id: A.id, sessionId: "s" });
  await store.put(dropped, { kind: "stm", id: D.id, sessionId: "s" });
  const withChunk = { ...A, chunkRefs: [ref(kept)] };
  const withOther = { ...D, chunkRefs: [ref(dropped)] };
  const h = harness(
    [recorded(withChunk, withOther)],
    scripted([
      ["keep", { stmId: A.id, reason: "result" }],
      ["discard", { stmId: D.id, reason: "finished" }],
    ]),
  );
  const flush = createObservationalFlush({
    ...h.deps,
    config: resolveMemorySystemConfig({ wm: { triggerTokens: 1 }, rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" } }),
    chunks: createChunkStoreHandle("memory", () => store),
  });
  await flush.flush(h.session);
  const [event] = activeWmItems(h.ledger());
  assert.deepEqual(event?.chunkRefs, [ref(kept)]);
  assert.equal((await store.get(kept.id, "s"))?.text, kept.text, "the chunk a WM item cites survives");
  assert.equal(await store.get(dropped.id, "s"), undefined, "the uncited chunk is deleted with its last referrer");
  assert.equal(renderObservationalMemory([event!], []).includes(kept.text), false, "chunk text never renders");
});

it("wm_tools_report_named_rejections", async () => {
  const requests: ProviderRequest[] = [];
  const ledger = foldObservationalMemoryLedger([
    recorded(A, B, C),
    { type: "memory.session.observations.tombstoned", observationIds: [C.id], reason: "wm discard finished", at: A.timestamp },
  ]);
  const { items, verdicts } = await runWm({
    records: [A, B],
    ledger,
    maxTurns: 2,
    client: scripted(
      [
        ["keep", { stmId: "eeeeeeeeeeee", reason: "x" }],
        ["keep", { stmId: C.id, reason: "x" }],
        ["discard", { stmId: B.id, reason: "finished" }],
        ["keep", { stmId: B.id, reason: "x" }],
        ["summarize", { stmIds: [A.id], text: "   ", relevance: "low" }],
        ["derive", { text: "fact", supportingIds: [C.id], relevance: "low" }],
        ["summarize", { stmIds: [A.id], text: "ok", relevance: "low", supersedes: ["ffffffffffff"] }],
      ],
      requests,
    ),
  });
  const text = replies(requests[1]!).join("\n");
  for (const reason of ["unknown_id", "already_processed", "empty_text", "citation_outside_active_set"])
    assert.match(text, new RegExp(`"reason":"${reason}"`), reason);
  assert.equal((text.match(/"ok":false/g) ?? []).length, 6);
  assert.deepEqual(items, []);
  assert.deepEqual([...verdicts.keys()], [B.id]);
});

it("wm_input_is_batched_to_wm_batch_tokens", async () => {
  const requests: ProviderRequest[] = [];
  const h = harness([recorded(D, C, B, A)], scripted([], requests), { wm: { triggerTokens: 1, batchTokens: 20 } });
  await h.flush.flush(h.session);
  const prompt = JSON.stringify(requests[0]!.messages);
  // The oldest two records by time (D at :00, A at :07) fit 20 tokens; B and C wait and stay rendered.
  const sent = [...prompt.matchAll(/- \[([a-f0-9]{12})\] 2026-/g)].map((match) => match[1]);
  assert.deepEqual(sent, [D.id, A.id]);
  assert.match(String(observationalMemoryBlock(h.ledger())[0]!.content), /suite two[\s\S]*suite three/);
  assert.equal(activeObservations(h.ledger()).length, 4, "a pass with no verdict processes nothing");
});

it("wm_items_are_one_subject_and_short", () => {
  assert.match(DEFAULT_WM_INSTRUCTION, /one subject/);
  assert.match(DEFAULT_WM_INSTRUCTION, /old → new with its dates/);
  assert.match(DEFAULT_WM_INSTRUCTION, /later planned steps/);
  assert.doesNotMatch(DEFAULT_WM_INSTRUCTION, /entire memory log|rewrite/i);
});

it("wm_prompt_carries_scope_task_state_and_salience_never_to_stm", async () => {
  const requests: ProviderRequest[] = [];
  const scope = prepareScope("Ship suites, then step 4 needs the retry fix.", { maxBytes: 4_096, at: A.timestamp });
  assert.ok(scope.ok);
  const error = { ...B, kind: "error" as const, description: "Retry counter overflowed" };
  await runWm({
    records: [A, error],
    ledger: foldObservationalMemoryLedger([recorded(A, error)]),
    scope: scope.scope,
    taskState: { id: "999999999999", goal: "Ship the campaign suites", sourceEntryIds: ["e-aa"] },
    salience: new Map([[error.id, ["error"] as const]]),
    maxTurns: 1,
    client: scripted([], requests),
  });
  const user = JSON.stringify(requests[0]!.messages.filter((message) => message.role === "user"));
  assert.match(user, /<episode_scope>/);
  assert.match(user, /## Current task/);
  assert.match(user, /Ship the campaign suites/);
  assert.match(user, /salient: error: Retry counter overflowed/);
  assert.deepEqual(
    requests[0]!.tools?.map((tool) => tool.name),
    ["keep", "summarize", "derive", "discard"],
  );
});

it("a_new_boundary_triggers_wm_below_the_token_trigger", async () => {
  let calls = 0;
  const client: ModelClient = {
    ...done,
    async *generate() {
      calls++;
      yield providerDone();
    },
  };
  const boundary = (entryId: string) => ({ type: BOUNDARY_RECORDED, reason: "outcome", entryId, recordId: A.id, at: A.timestamp });
  const h = harness([recorded(A)], client, {
    wm: { triggerTokens: 1_000 },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  await h.flush.flush(h.session);
  assert.equal(calls, 0, "below the trigger and no boundary");
  h.data.push(boundary("x1") as unknown as JsonValue);
  await h.flush.flush(h.session);
  assert.equal(calls, 1, "a new boundary runs WM");
  await h.flush.flush(h.session);
  assert.equal(calls, 1, "the same boundary does not run it again");
});

it("rehearse_only_wm_runs_a_pass_below_the_trigger", async () => {
  const { createMemorySystemService } = await import("../../service.js");
  const h = harness([recorded(A)], scripted([["keep", { stmId: A.id, reason: "needed" }]]), {
    wm: { triggerTokens: 1_000 },
    rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" },
  });
  const service = createMemorySystemService({ stm: true, wm: true, rehearsal: false, ltm: false, sleep: false }, () => ({
    setScope: async () => {
      throw new Error("unused");
    },
    runWm: (session, signal) => h.flush.flush(session, { forceWm: true, ...(signal ? { signal } : {}) }),
  }));
  assert.deepEqual(await service.rehearse(h.session, { only: "wm" }), { items: 1, processed: 1 });
  await assert.rejects(service.rehearse(h.session, {} as never), /plan 219/);
});

it("retired_reflection_records_and_config_fail_closed", () => {
  assert.throws(
    () => foldObservationalMemoryLedger([{ type: "memory.session.reflections.recorded", reflections: [] }]),
    (error: unknown) => error instanceof MemorySessionLedgerError && /working-memory items replace reflections/.test(error.message),
  );
  assert.throws(
    () => resolveMemorySystemConfig({ wm: { observationTokens: 1 } } as never),
    /"wm.observationTokens" was retired; use "wm.triggerTokens/,
  );
  assert.equal(resolveMemorySystemConfig().wm.triggerTokens, 10_000);
  assert.throws(() => resolveMemorySystemConfig({ rehearsal: { targetTokens: 10 } }), /rehearsal.targetTokens.*wm.triggerTokens/);
});

it("dropper_tool_declares_its_argument_schema", async () => {
  const seen: string[][] = [];
  const client: ModelClient = {
    ...done,
    async *generate(request) {
      seen.push(request.tools![0]!.parameters!.required as string[]);
      yield providerDone();
    },
  };
  await runDropper({ client, observations: [A], targetTokens: 1, maxTurns: 1 });
  assert.deepEqual(seen, [["observationIds"]]);
});

it("render_truncation_drops_oldest_observations_first", () => {
  const summary = item("bbbbbbbbbbbb", "durable knowledge", [A.id]);
  const old = { ...A, observedAt: "2026-01-01T00:00:00.000Z", description: "old evidence" };
  const newest = { ...D, observedAt: "2026-02-01T00:00:00.000Z", description: "new evidence" };
  const budget = Buffer.byteLength(renderObservationalMemory([summary], [newest]), "utf8");
  const text = renderObservationalMemory([summary], [newest, old], { maxBytes: budget });
  assert.match(text, /durable knowledge/);
  assert.match(text, /new evidence/);
  assert.doesNotMatch(text, /old evidence/);
  assert.ok(Buffer.byteLength(text, "utf8") <= budget);
});

// Plan 217 Task 6 (gate M-1): a WM pass sent a closing turn, re-ran every STM pass after an attempt that did nothing,
// and failed outright past the per-turn call limit.
it("wm_refuses_calls_past_the_per_turn_limit_and_keeps_the_rest", async () => {
  let requests = 0;
  const keep = (id: string, stmId: string) => providerToolCall(toolCallContent(id, "keep", { stmId, reason: "needed" }));
  const client: ModelClient = {
    ...done,
    async *generate() {
      requests++;
      if (requests === 1) yield* [keep("r1", A.id), keep("r2", B.id), keep("r3", C.id)];
      else if (requests === 2) yield keep("r4", C.id);
      yield providerDone();
    },
  };
  const { items } = await runWm({
    client,
    records: [A, B, C],
    ledger: foldObservationalMemoryLedger([recorded(A, B, C)]),
    maxTurns: 4,
    maxToolCallsPerTurn: 2,
  });
  assert.deepEqual(
    items.map((wmItem) => wmItem.citedIds[0]),
    [A.id, B.id, C.id],
  );
});

it("wm_pass_ends_after_a_clean_turn", async () => {
  let requests = 0;
  const client: ModelClient = {
    ...done,
    async *generate() {
      requests++;
      yield providerToolCall(toolCallContent(`r${requests}`, "keep", { stmId: A.id, reason: "needed" }));
      yield providerDone();
    },
  };
  const { items } = await runWm({ client, records: [A], ledger: foldObservationalMemoryLedger([recorded(A)]), maxTurns: 4 });
  assert.equal(requests, 1, "no closing turn after a clean one");
  assert.equal(items.length, 1);
});

it("wm_waits_for_new_records_after_an_empty_or_failed_attempt", async () => {
  let calls = 0;
  let mode: "empty" | "fail" = "empty";
  const client: ModelClient = {
    ...done,
    async *generate() {
      calls++;
      if (mode === "fail") {
        // An unknown tool name no longer fails a pass (plan 218 Task 1.1); a provider error still does.
        yield { type: "error", error: new Error("provider failed") } as ProviderEvent;
        return;
      }
      yield providerDone();
    },
  };
  const h = harness([recorded({ ...A, tokenCount: 5 })], client, {
    wm: { triggerTokens: 5 },
    rehearsal: { targetTokens: 1_000, policy: "lowest-relevance" },
  });
  await h.flush.flush(h.session);
  assert.equal(calls, 1, "the first attempt runs");
  await h.flush.flush(h.session);
  assert.equal(calls, 1, "an empty attempt is not repeated over the same records");
  const fresh = (id: string) => recorded({ ...A, id, tokenCount: 5 }) as unknown as JsonValue;
  h.data.push(fresh("dddddddddddd"));
  mode = "fail";
  await assert.rejects(h.flush.flush(h.session), /provider failed/);
  assert.equal(calls, 2, "a fresh trigger of records runs WM again");
  await h.flush.flush(h.session).catch(() => {});
  assert.equal(calls, 2, "a failed attempt also waits for new records");
  h.data.push(fresh("eeeeeeeeeeee"));
  mode = "empty";
  await h.flush.flush(h.session);
  assert.equal(calls, 3);
});

it("scope_change_rejudges_live_tombstones", async () => {
  const store: ChunkStore = await createSqliteChunkStore({ path: ":memory:" });
  const chunk = (text: string, sourceEntryId: string): PreparedChunk => {
    const sha256 = createHash("sha256").update(text).digest("hex");
    return { id: sha256.slice(0, 24), sourceEntryId, sha256, bytes: Buffer.byteLength(text), text };
  };
  const ref = ({ text: _text, ...rest }: PreparedChunk) => rest;
  const live = chunk("baseline: 12 passed in 41 s", "e-aa");
  const gone = chunk("README text", "e-dd");
  await store.put(live, { kind: "stm", id: A.id, sessionId: "s" });
  // A second referrer in this session (a WM item elsewhere cites the chunk), so it outlives A's discard.
  await store.ref(live.id, { kind: "wm", id: "eeeeeeeeeeee", sessionId: "s" });
  await store.put(gone, { kind: "stm", id: D.id, sessionId: "s" });
  const withLive = { ...A, chunkRefs: [ref(live)] };
  const withGone = { ...D, chunkRefs: [ref(gone)] };
  const plain = record("ffffffffffff", "Timed the baseline run at 41 s");
  let calls: [string, Record<string, unknown>][] = [
    ["discard", { stmId: A.id, reason: "finished" }],
    ["discard", { stmId: D.id, reason: "finished" }],
    ["discard", { stmId: plain.id, reason: "out-of-scope" }],
  ];
  const requests: ProviderRequest[] = [];
  const client: ModelClient = {
    ...done,
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool"))
        for (const [index, [name, args]] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, name, args as never));
      yield providerDone();
    },
  };
  const h = harness([recorded(withLive, withGone, plain)], client);
  const flush = createObservationalFlush({
    ...h.deps,
    config: resolveMemorySystemConfig({ wm: { triggerTokens: 1 }, rehearsal: { targetTokens: 1_000_000, policy: "lowest-relevance" } }),
    chunks: createChunkStoreHandle("memory", () => store),
  });
  await flush.flush(h.session);
  assert.deepEqual(activeObservations(h.ledger()), [], "all three discarded");
  assert.equal(await store.get(gone.id, "s"), undefined, "D's chunk lost its last referrer");

  // The re-plan: a new step needs the baseline result. The next pass is sent the discarded records whose chunks live.
  h.data.push({ type: SCOPE_SET, hash: "1111111111111111", bytes: 40, at: A.timestamp } as unknown as JsonValue);
  calls = [
    ["keep", { stmId: A.id, reason: "step 4 compares against the baseline" }],
    ["discard", { stmId: plain.id, reason: "finished" }],
    ["summarize", { stmIds: [plain.id], text: "Baseline timing", relevance: "low" }],
  ];
  requests.length = 0;
  await flush.flush(h.session, { forceWm: true });
  const prompt = JSON.stringify(requests[0]?.messages);
  assert.match(prompt, /Earlier discarded records \(2; the episode scope changed\)/);
  assert.match(prompt, new RegExp(A.id));
  assert.match(prompt, new RegExp(plain.id));
  assert.equal(prompt.includes(`[${D.id}]`), false, "a record whose chunks were deleted is not offered");
  assert.match(replies(requests[1]!).join("\n"), /already_processed.*already_processed/s, "only keep applies to re-judged records");
  const recordedPass = h.data.filter((value) => (value as { type?: string }).type === WM_RECORDED).at(-1) as unknown as {
    rejudge: { scopeHash: string; offered: number; kept: string[]; chunkDropped: string[] };
    processedIds?: string[];
  };
  assert.deepEqual(recordedPass.rejudge, { scopeHash: "1111111111111111", offered: 2, kept: [A.id], chunkDropped: [D.id] });
  assert.equal(recordedPass.processedIds, undefined, "a kept-back record is not processed again");
  const [event] = activeWmItems(h.ledger());
  assert.deepEqual(event?.citedIds, [A.id]);
  assert.deepEqual(event?.chunkRefs, [ref(live)]);
  assert.match(h.ledger().tombstones?.[A.id]?.reason ?? "", /^wm discard finished$/, "the record stays tombstoned");
  await store.unref(live.id, { kind: "wm", id: "eeeeeeeeeeee", sessionId: "s" });
  assert.equal((await store.get(live.id, "s"))?.text, live.text, "the new WM item holds the chunk");

  // Re-judged once: the next pass, and the same scope set again, offer nothing.
  requests.length = 0;
  await flush.flush(h.session, { forceWm: true });
  assert.equal(requests.length, 0, "no surface and no pending scope change: no pass");
  h.data.push({ type: SCOPE_SET, hash: "1111111111111111", bytes: 40, at: A.timestamp } as unknown as JsonValue);
  await flush.flush(h.session, { forceWm: true });
  assert.equal(requests.length, 0, "the same scope again re-judges nothing");
});

// Plan 218 Task 6 (gate M-2): Muse Spark spent WM's output limit on reasoning before any verdict in half its calls.
it("wm_retries_the_older_half_after_an_output_cap_stop_with_no_verdict", async () => {
  // Explicit times: A and B are the older half.
  const at = (r: MemoryObservation, minute: number) => ({ ...r, observedAt: `2026-11-12T10:0${minute}:00.000Z` });
  const [a, b, c, d] = [at(A, 1), at(B, 2), at(C, 3), at(D, 4)];
  const prompts: string[] = [];
  const client: ModelClient = {
    ...done,
    async *generate(request) {
      const prompt = JSON.stringify(request.messages);
      if (request.messages.some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      prompts.push(prompt);
      if (prompts.length === 1) {
        yield providerDone(undefined, "max_output_tokens");
        return;
      }
      for (const [index, id] of [A.id, B.id, C.id, D.id].entries())
        if (prompt.includes(id)) yield providerToolCall(toolCallContent(`k${index}`, "keep", { stmId: id, reason: "needed" }));
      yield providerDone();
    },
  };
  const h = harness([recorded(a, b, c, d)], client);
  const result = await h.flush.flush(h.session);
  assert.equal(prompts.length, 2, "one retry");
  assert.ok([A.id, B.id, C.id, D.id].every((id) => prompts[0]!.includes(id)));
  assert.ok(prompts[1]!.includes(A.id) && prompts[1]!.includes(B.id), "the retry sends the older half");
  assert.ok(!prompts[1]!.includes(C.id) && !prompts[1]!.includes(D.id));
  assert.equal(result.processed, 2);
  assert.deepEqual(
    activeObservations(h.ledger()).map((observation) => observation.id),
    [C.id, D.id],
    "the newer half stays on the STM surface for the next pass",
  );
});

it("wm_does_not_retry_an_empty_reply_that_stopped_normally_or_a_capped_reply_with_verdicts", async () => {
  let calls = 0;
  const empty: ModelClient = {
    ...done,
    async *generate() {
      calls++;
      yield providerDone(undefined, "end_turn");
    },
  };
  const h = harness([recorded(A, B)], empty);
  await h.flush.flush(h.session);
  assert.equal(calls, 1);
  let capped = 0;
  const partial: ModelClient = {
    ...done,
    async *generate(request) {
      capped++;
      if (!request.messages.some((message) => message.role === "tool"))
        yield providerToolCall(toolCallContent("k", "keep", { stmId: A.id, reason: "needed" }));
      yield providerDone(undefined, "max_output_tokens");
    },
  };
  const p = harness([recorded(A, B)], partial);
  const result = await p.flush.flush(p.session);
  assert.equal(result.processed, 1, "a capped reply that gave a verdict keeps it; no retry");
  assert.ok(capped <= 2);
});

it("memory_workers_default_to_low_thinking_and_config_overrides_it", () => {
  const resolved = resolveMemorySystemConfig({});
  assert.deepEqual([resolved.stm.thinkingLevel, resolved.wm.thinkingLevel, resolved.rehearsal.thinkingLevel], ["low", "low", "low"]);
  const set = resolveMemorySystemConfig({ stm: { thinkingLevel: "none" }, wm: { thinkingLevel: "high" } });
  assert.deepEqual([set.stm.thinkingLevel, set.wm.thinkingLevel, set.rehearsal.thinkingLevel], ["none", "high", "low"]);
});
