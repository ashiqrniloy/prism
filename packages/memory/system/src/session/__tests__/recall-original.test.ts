/**
 * Plan 218.3 Task 4: `recall` returns the original content from the session store. STM keeps no copy (the chunk store
 * is gone); recall reads the cited entries, pages one entry by byte offset, survives a resume, and resolves a parent's
 * entry ids in a fork.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  type SessionStore,
  type ToolDefinition,
  type ToolExecutionContext,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem from "../../index.js";
import { unscannedEntries } from "../coverage-helpers.js";
import { activeObservations, foldObservationalMemoryLedger } from "../ledger.js";
import { DEFAULT_RECALL_PAGE_BYTES } from "../limits.js";
import { originalEntryText } from "../original.js";
import { recallObservationalMemory } from "../recall.js";
import { createObservationalRecallTool } from "../recall-tool.js";
import { ledgerOf, SESSION_LEDGER_KEY } from "../state.js";
import { type MemoryObservation, OBSERVATIONS_RECORDED, OBSERVATIONS_TOMBSTONED } from "../types.js";

/** The large tool result; the padding pushes it well past a summary. */
const BUILD_OUTPUT = `BUILD-OK 35 tests across 3 files\n0 fail\n${"log line ".repeat(400)}`;
const DEPLOY_OUTPUT = "DEPLOY-OK release 7 is live";

const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "result",
  description: "Build passed",
  timestamp: "2026-11-09T10:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["e47"],
  tokenCount: 3,
  count: 1,
};
const toolEntry = (id: string, output: string): SessionEntry =>
  ({
    id,
    sessionId: "s1",
    kind: "message",
    timestamp: observation.timestamp,
    message: { role: "tool", content: [{ type: "tool_result", toolCallId: "b1", name: "run_build", result: output }] },
  }) as SessionEntry;
const custom = (id: string, data: unknown): SessionEntry =>
  ({ id, sessionId: "s1", timestamp: observation.timestamp, kind: "custom", data }) as SessionEntry;

const text = (request: ProviderRequest): string => JSON.stringify(request);
const userLines = (request: ProviderRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 500 && !(await check()); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(await check(), "condition settled");
}

/** The id of the STM record whose description is `description`, once the session's background pass recorded it. */
async function waitForRecord(session: { entries(): Promise<readonly SessionEntry[]> }, description: string): Promise<string> {
  let id: string | undefined;
  await waitUntil(async () => {
    id = foldObservationalMemoryLedger(await session.entries()).observations.find((item) => item.description === description)?.id;
    return id !== undefined;
  });
  return id!;
}

/**
 * A live agent. The main model calls `run_build` on "build it" and `run_deploy` on "deploy it"; on "what did the build
 * print" it reads the record id from the memory block and calls `recall` with `detail: "full"`. The STM worker records
 * each tool output as a `result` citing the batch.
 */
async function liveAgent(store: SessionStore = createMemorySessionStore()) {
  const toolCalls: { name: string; sessionId: string }[] = [];
  const mainRequests: ProviderRequest[] = [];
  const stmBatches: string[] = [];
  let builds = 0;
  const provider: ModelProvider = {
    id: "scripted",
    async *generate(request) {
      const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
      const answered = request.messages.at(-1)?.role === "tool";
      if (names.has("record_event")) {
        if (!request.messages.some((message) => message.role === "tool")) {
          const batch = userLines(request);
          stmBatches.push(batch);
          const ids = [...batch.matchAll(/^\[[^\]]+\] \[([^\]]+)\]/gm)].map((match) => match[1] ?? "");
          const description = batch.includes("DEPLOY-OK") ? "Deploy passed" : batch.includes("BUILD-OK") ? "Build passed" : "Chatted";
          yield providerToolCall(toolCallContent("o0", "record_event", { kind: "result", description, sourceEntryIds: ids } as never));
        }
        yield providerDone();
        return;
      }
      mainRequests.push(request);
      const last = userLines(request).split("\n").at(-1) ?? "";
      if (!answered && last.includes("build it")) {
        yield providerToolCall(toolCallContent("b1", "run_build", {}));
      } else if (!answered && last.includes("deploy it")) {
        yield providerToolCall(toolCallContent("d1", "run_deploy", {}));
      } else if (!answered && last.includes("what did the build print")) {
        const id = text(request).match(/- \[([a-f0-9]{12})\][^"\\]*?result: Build passed/)?.[1];
        if (id) yield providerToolCall(toolCallContent("r1", "recall", { id, detail: "full" }));
        else yield providerTextDelta("no memory");
      } else {
        yield providerTextDelta("ok");
      }
      yield providerDone();
    },
  };
  const tool = (name: string, output: string, onRun = () => {}): ToolDefinition => ({
    name,
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => {
      onRun();
      return { toolCallId: context.toolCallId, name, value: output, content: [{ type: "text", text: output }] };
    },
  });
  const chunkServiceCalls: string[] = [];
  const probe = definePackage({
    name: "@test/recall-probe",
    version: "0.0.0",
    requires: { api: 2 },
    setup(prism) {
      // The retired `memory.chunks` service: nothing may consume or call it.
      prism.services.provide("memory.chunks", {
        apply: async () => void chunkServiceCalls.push("apply"),
        get: async () => void chunkServiceCalls.push("get"),
      });
      prism.tools.register(tool("run_build", BUILD_OUTPUT, () => builds++));
      prism.tools.register(tool("run_deploy", DEPLOY_OUTPUT));
      prism.hooks.on("tool.call", (payload) => {
        toolCalls.push({ name: payload.name, sessionId: payload.sessionId });
        return undefined;
      });
    },
  })();
  const agent = await createAgent({
    model: { provider: "scripted", model: "main" },
    packages: [
      providerPackage("scripted", [provider]),
      probe,
      memorySystem({
        enabled: true,
        stm: { model: "scripted/stm", triggerTokens: 1 },
        wm: false,
        context: { compactAfterRun: { maxTokens: 999_999 } },
        worker: { maxTurns: 2 },
      }),
    ],
    slots: { store },
  });
  return { agent, store, toolCalls, mainRequests, stmBatches, chunkServiceCalls, builds: () => builds };
}

/** The recall tool executed directly as `session`; returns the tool's `value` (what the model receives). */
async function recallAs(
  session: { readonly id: string; entries(): Promise<readonly SessionEntry[]> },
  args: Record<string, unknown>,
  options: { readonly pageBytes?: number } = {},
) {
  const result = await createObservationalRecallTool(options).execute(
    args as never,
    {
      toolCallId: "t",
      session,
    } as unknown as ToolExecutionContext,
  );
  return result.value as Record<string, unknown> & { readonly text: string; readonly found: boolean };
}

/** The tool entry that holds `output`. */
async function toolEntryOf(session: { entries(): Promise<readonly SessionEntry[]> }, output: string): Promise<SessionEntry> {
  const entry = (await session.entries()).find((item) => item.message?.role === "tool" && originalEntryText(item).includes(output));
  assert.ok(entry, "the tool entry is on the branch");
  return entry;
}

describe("recall returns the original content from the session store (plan 218.3 Task 4)", () => {
  it("recall_returns_a_removed_tool_output_verbatim", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      const id = await waitForRecord(session, "Build passed");
      // The original tool result leaves the provider view.
      await session.compact();
      const before = live.toolCalls.length;
      await session.run("what did the build print");
      const after = live.mainRequests.at(-2);
      assert.ok(after, "the main model saw the post-compaction request");
      assert.doesNotMatch(text(after), /log line log line/, "the original tool output left context");

      const mainCalls = live.toolCalls.slice(before).filter((call) => call.sessionId === session.id);
      assert.deepEqual(
        mainCalls.map((call) => call.name),
        ["recall"],
        "no tool other than recall ran",
      );
      assert.equal(live.builds(), 1, "the build ran once, in the first turn");
      assert.ok(text(live.mainRequests.at(-1)!).includes("BUILD-OK 35 tests across 3 files"), "the model received the output");

      // Byte for byte: the record's evidence carries the removed output as it was stored.
      const value = await recallAs(session, { id, detail: "full" });
      assert.ok(value.text.includes(BUILD_OUTPUT), "the whole output, verbatim");
      assert.ok(!("sourceEntries" in value), "the value names entries by id instead of carrying them");
      assert.deepEqual(value.sourceEntryIds, [...new Set(value.sourceEntryIds as string[])]);
      assert.ok(Buffer.byteLength(value.text, "utf8") <= DEFAULT_RECALL_PAGE_BYTES);
    } finally {
      await live.agent.dispose();
    }
  });

  it("recall_pages_inside_one_large_entry", async () => {
    // About 1 MB with 2-, 3- and 4-byte characters, so a page cut can land inside a character.
    const big = "héllo wörld ✓ 𝄞 log ".repeat(42_000);
    assert.ok(Buffer.byteLength(big, "utf8") > 1_000_000);
    const entry = toolEntry("e47", big);
    const entries = [entry, custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] })];
    const session = { id: "s1", entries: async () => entries };
    const original = originalEntryText(entry);

    for (const pageBytes of [DEFAULT_RECALL_PAGE_BYTES, 4_099]) {
      const pages: string[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const value = await recallAs(session, { entry: "e47", offset }, { pageBytes });
        assert.equal(value.found, true);
        assert.ok(Buffer.byteLength(value.text, "utf8") <= pageBytes, "a page never exceeds the page bytes");
        assert.ok(!value.text.includes("�"), "no character is cut");
        pages.push(value.text.slice(value.text.indexOf("\n") + 1));
        assert.equal(value.offset, offset);
        offset = value.nextOffset as number | undefined;
        if (offset !== undefined) assert.match(value.text, new RegExp(`recall \\{ entry: "e47", offset: ${offset} \\}`));
      }
      assert.equal(pages.join(""), original, "the pages concatenate to the original");
      assert.ok(pages.length > 1_000_000 / pageBytes);
    }

    // A record citing the entry, and a full cursor page, stay within the page and name where to read on.
    for (const value of [
      await recallAs(session, { id: observation.id, detail: "full" }),
      await recallAs(session, { cursor: "e47", detail: "full" }),
    ]) {
      assert.ok(Buffer.byteLength(value.text, "utf8") <= DEFAULT_RECALL_PAGE_BYTES, "bounded");
      assert.match(value.text, /continue with recall \{ entry: "e47", offset: \d+ \}/);
      assert.ok(Buffer.byteLength(JSON.stringify(value), "utf8") < 3 * DEFAULT_RECALL_PAGE_BYTES, "the value carries no whole entry");
    }

    // Refusals: a past-the-end offset, a limit over the page, an entry that is not a message, an unknown entry.
    assert.equal((await recallAs(session, { entry: "e47", offset: 10_000_000 })).reason, "invalid_offset");
    assert.equal((await recallAs(session, { entry: "e47", limit: DEFAULT_RECALL_PAGE_BYTES + 1 })).reason, "limit_exceeded");
    assert.equal((await recallAs(session, { entry: "o" })).reason, "entry_not_message");
    assert.equal((await recallAs(session, { entry: "nope" })).reason, "entry_not_found");
    assert.equal((await recallAs(session, { entry: "e47", id: observation.id })).reason, "invalid_request");
  });

  it("recall_survives_resume", async () => {
    const store = createMemorySessionStore();
    const first = await liveAgent(store);
    let id: string;
    let entryId: string;
    try {
      const session = await first.agent.session({ id: "s1", create: true });
      await session.run("build it");
      id = await waitForRecord(session, "Build passed");
      entryId = (await toolEntryOf(session, BUILD_OUTPUT)).id;
      await session.compact();
      await session.close();
    } finally {
      await first.agent.dispose();
    }
    // A new agent over the same store reopens the session: the ledger and the originals come back from the store.
    const second = await liveAgent(store);
    try {
      const session = await second.agent.session({ id: "s1" });
      const value = await recallAs(session, { id, detail: "full" });
      assert.equal(value.found, true);
      assert.ok(value.text.includes(BUILD_OUTPUT));
      const page = await recallAs(session, { entry: entryId });
      assert.equal(page.found, true);
      assert.ok(page.text.endsWith(BUILD_OUTPUT));
    } finally {
      await second.agent.dispose();
    }
  });

  it("stm_writes_no_session_content_copy", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      await waitForRecord(session, "Build passed");
      await session.compact();
      assert.deepEqual(live.chunkServiceCalls, [], "no chunk store is read or written");
      // The ledger cites the output by id; no ledger record carries its bytes.
      const ledgerEntries = (await session.entries()).filter((entry) => JSON.stringify(entry.data ?? null).includes(SESSION_LEDGER_KEY));
      assert.ok(ledgerEntries.length > 0);
      for (const entry of ledgerEntries) assert.ok(!JSON.stringify(entry.data).includes("log line"), "no copy of the output");
    } finally {
      await live.agent.dispose();
    }
  });

  it("fork_cannot_recall_past_its_fork_point", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      await waitForRecord(session, "Build passed");
      const forkPoint = (await session.entries()).at(-1)?.id;
      await session.run("deploy it");
      const deployId = await waitForRecord(session, "Deploy passed");
      const deployEntry = await toolEntryOf(session, DEPLOY_OUTPUT);

      const fork = await session.fork({ at: forkPoint });
      const unknown = await recallAs(fork, { id: deployId, detail: "full" });
      assert.equal(unknown.found, false);
      assert.equal(unknown.reason, "unknown_id");
      assert.equal((await recallAs(fork, { entry: deployEntry.id })).reason, "entry_not_found");
      assert.equal((await recallAs(fork, { cursor: deployEntry.id })).reason, "cursor_not_found");
      const full = JSON.stringify(await recallAs(fork, { query: "deploy" }));
      assert.ok(!full.includes("DEPLOY-OK"), "nothing after the fork point is readable");
    } finally {
      await live.agent.dispose();
    }
  });

  it("fork_recalls_entries_before_its_fork_point", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      const id = await waitForRecord(session, "Build passed");
      const parentEntry = await toolEntryOf(session, BUILD_OUTPUT);
      await session.compact();

      const fork = await session.fork();
      const copy = await toolEntryOf(fork, BUILD_OUTPUT);
      assert.notEqual(copy.id, parentEntry.id, "the fork holds a copy under a new id");
      const value = await recallAs(fork, { id, detail: "full" });
      assert.equal(value.found, true);
      assert.ok(value.text.includes(BUILD_OUTPUT), "the record's parent ids resolve to the fork's copies");
      assert.deepEqual(value.missingSourceEntryIds, []);
      assert.ok((value.sourceEntryIds as string[]).includes(copy.id));
      // A parent's entry id (as the record's sources list it) pages the fork's copy.
      const page = await recallAs(fork, { entry: parentEntry.id });
      assert.equal(page.entry, copy.id);
      assert.ok(page.text.endsWith(BUILD_OUTPUT));
    } finally {
      await live.agent.dispose();
    }
  });

  it("fork_does_not_rescan_copied_entries", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      await waitForRecord(session, "Build passed");
      const fork = await session.fork();
      const forkEntries = await fork.entries();
      const parentEntries = await session.entries();
      const parentTail = unscannedEntries(parentEntries, foldObservationalMemoryLedger(parentEntries).latestObservationCoverageId);
      const tail = unscannedEntries(forkEntries, foldObservationalMemoryLedger(forkEntries).latestObservationCoverageId);
      assert.ok(tail.length < forkEntries.length, "STM coverage resolves to the fork's copies");
      assert.equal(tail.length, parentTail.length, "the fork's unscanned tail is the parent's");
      assert.ok(!tail.some((entry) => originalEntryText(entry).includes("BUILD-OK")));

      const batches = live.stmBatches.length;
      await fork.run("hello");
      await waitForRecord(fork, "Chatted");
      const forkBatches = live.stmBatches.slice(batches);
      assert.ok(forkBatches.length > 0);
      for (const batch of forkBatches) assert.ok(!batch.includes("BUILD-OK"), "the copied build output is not rescanned");
    } finally {
      await live.agent.dispose();
    }
  });

  it("tombstoned_record_found_by_id", () => {
    const entries = [
      toolEntry("e47", BUILD_OUTPUT),
      custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      custom("t", {
        type: OBSERVATIONS_TOMBSTONED,
        observationIds: [observation.id],
        reason: "folded into WM item",
        at: "2026-11-09T11:00:00.000Z",
      }),
    ];
    const ledger = foldObservationalMemoryLedger(entries);
    assert.deepEqual(ledger.tombstones?.[observation.id], { reason: "folded into WM item", at: "2026-11-09T11:00:00.000Z" });
    assert.deepEqual(activeObservations(ledger), [], "the surface no longer shows it");

    const value = recallObservationalMemory(entries, observation.id);
    assert.equal(value.found, true);
    assert.equal(value.state, "tombstoned");
    assert.equal(value.tombstone?.reason, "folded into WM item");
    assert.match(value.text, /\(tombstoned: folded into WM item\)/);
    assert.ok(!value.text.includes("log line"), "summary detail leaves the original out");
    assert.ok(recallObservationalMemory(entries, observation.id, [], { detail: "full" }).text.includes(BUILD_OUTPUT), "full adds it");

    const malformed = [
      ...entries.slice(0, 2),
      custom("t", { type: OBSERVATIONS_TOMBSTONED, observationIds: [observation.id], reason: "" }),
    ];
    assert.equal(recallObservationalMemory(malformed, observation.id).state, "active");
  });

  it("older_records_with_chunk_refs_are_read_without_them", () => {
    // A record written before plan 218.3 Task 4 may carry `chunkRefs`: it still folds, and recall ignores them.
    const old = { ...observation, chunkRefs: [{ id: "c".repeat(24), sourceEntryId: "e47", sha256: "d".repeat(64), bytes: 9 }] };
    const entries = [toolEntry("e47", BUILD_OUTPUT), custom("o", { type: OBSERVATIONS_RECORDED, observations: [old] })];
    assert.equal(ledgerOf([{ type: OBSERVATIONS_RECORDED, observations: [old] }] as never).observations.length, 1);
    const value = recallObservationalMemory(entries, observation.id, [], { detail: "full" });
    assert.equal(value.found, true);
    assert.ok(!/chunk/i.test(value.text));
    assert.ok(value.text.includes(BUILD_OUTPUT));
  });

  it("forged_id_from_other_session_is_unknown", async () => {
    const live = await liveAgent();
    try {
      const owner = await live.agent.session({ id: "s1", create: true });
      await owner.run("build it");
      const id = await waitForRecord(owner, "Build passed");
      assert.ok((await recallAs(owner, { id, detail: "full" })).text.includes(BUILD_OUTPUT), "the owner reads it");

      const other = await live.agent.session({ id: "s2", create: true });
      await other.run("hello");
      const forged = await recallAs(other, { id });
      const never = await recallAs(other, { id: "0123456789ab" });
      assert.equal(forged.found, false);
      assert.equal(forged.reason, "unknown_id");
      assert.equal(
        forged.text.replace(id, "<id>"),
        never.text.replace("0123456789ab", "<id>"),
        "indistinguishable from an id that never existed",
      );
      assert.deepEqual(Object.keys(forged).sort(), Object.keys(never).sort());
      const entryId = (await toolEntryOf(owner, BUILD_OUTPUT)).id;
      assert.equal((await recallAs(other, { entry: entryId })).reason, "entry_not_found", "another session's entry is not readable");
    } finally {
      await live.agent.dispose();
    }
  });
});
