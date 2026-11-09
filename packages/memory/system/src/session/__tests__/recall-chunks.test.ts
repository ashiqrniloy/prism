/**
 * Plan 217 Task 4: recall reads events, chunks and tombstones.
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
  type ToolDefinition,
  type ToolExecutionContext,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { type ChunkStoreHandle, createSqliteChunkStore, MEMORY_CHUNK_STORE_SERVICE, type SqliteChunkStore } from "../../chunks.js";
import memorySystem from "../../index.js";
import { activeObservations, foldObservationalMemoryLedger } from "../ledger.js";
import { recallObservationalMemory } from "../recall.js";
import { createObservationalRecallTool } from "../recall-tool.js";
import { renderObservationalMemory } from "../render.js";
import { type MemoryObservation, OBSERVATIONS_RECORDED, OBSERVATIONS_TOMBSTONED } from "../types.js";

/** The large tool result: the chunk is its first lines; the padding pushes it well past a summary. */
const BUILD_LINES = "BUILD-OK 35 tests across 3 files\n0 fail";
const BUILD_OUTPUT = `${BUILD_LINES}\n${"log line ".repeat(400)}`;
const CHUNK = "BUILD-OK 35 tests across 3 files";

const ref = { id: "c".repeat(24), sourceEntryId: "e47", sha256: "d".repeat(64), bytes: CHUNK.length };
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "result",
  description: "Build passed",
  timestamp: "2026-11-09T10:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["e47"],
  tokenCount: 3,
  chunkRefs: [ref],
  count: 1,
};
const toolEntry: SessionEntry = {
  id: "e47",
  sessionId: "s1",
  kind: "message",
  timestamp: observation.timestamp,
  message: { role: "tool", content: [{ type: "text", text: BUILD_OUTPUT }] },
} as SessionEntry;
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

/** The first chunk-bearing STM record id the session's ledger holds, once its background pass settles. */
async function waitForRecord(session: { entries(): Promise<readonly SessionEntry[]> }): Promise<string> {
  let id: string | undefined;
  await waitUntil(async () => {
    for (const entry of await session.entries()) {
      const value = (entry.data as { value?: { type?: string; observations?: { id: string; chunkRefs?: unknown[] }[] } } | undefined)
        ?.value;
      if (value?.type === OBSERVATIONS_RECORDED) id ??= value.observations?.find((item) => item.chunkRefs?.length)?.id;
    }
    return id !== undefined;
  });
  assert.ok(id);
  return id;
}

/**
 * A live agent. The main model calls `run_build` on "build", then answers; on "what did the build print", it reads the
 * `[chunk]` record id from the memory block and calls `recall`. The STM worker records the build output as a `result`
 * with a verbatim chunk; with `supersede`, every later pass supersedes that record.
 */
async function liveAgent(options: { readonly supersede?: boolean } = {}) {
  const store = await createSqliteChunkStore({ path: ":memory:" });
  const toolCalls: { name: string; sessionId: string }[] = [];
  const mainRequests: ProviderRequest[] = [];
  let builds = 0;
  const provider: ModelProvider = {
    id: "scripted",
    async *generate(request) {
      const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
      const answered = request.messages.at(-1)?.role === "tool";
      if (names.has("record_event")) {
        if (!request.messages.some((message) => message.role === "tool")) {
          const batch = userLines(request);
          const ids = [...batch.matchAll(/^\[[^\]]+\] \[([^\]]+)\]/gm)].map((match) => match[1] ?? "");
          const indexed = batch.match(/^\[([a-f0-9]{12})\] result:/m)?.[1];
          const toolLine = batch.split("\n").find((line) => line.includes("BUILD-OK") && line.includes('"role":"tool"'));
          const toolId = toolLine?.match(/^\[[^\]]+\] \[([^\]]+)\]/)?.[1];
          const args =
            indexed && options.supersede
              ? { kind: "statement", description: `Moved on from ${indexed}`, sourceEntryIds: ids, supersedes: indexed }
              : !indexed && toolId
                ? { kind: "result", description: "Build passed", sourceEntryIds: ids, chunks: [{ sourceEntryId: toolId, text: CHUNK }] }
                : undefined;
          if (args) yield providerToolCall(toolCallContent("o0", "record_event", args as never));
        }
        yield providerDone();
        return;
      }
      mainRequests.push(request);
      const last = userLines(request).split("\n").at(-1) ?? "";
      if (!answered && last.includes("build it")) {
        yield providerToolCall(toolCallContent("b1", "run_build", {}));
      } else if (!answered && last.includes("what did the build print")) {
        const id = text(request).match(/- \[([a-f0-9]{12})\][^"]*?result: Build passed[^"]*?\[chunk\]/)?.[1];
        if (id) yield providerToolCall(toolCallContent("r1", "recall", { id }));
        else yield providerTextDelta("no memory");
      } else {
        yield providerTextDelta("ok");
      }
      yield providerDone();
    },
  };
  const runBuild: ToolDefinition = {
    name: "run_build",
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => {
      builds++;
      return { toolCallId: context.toolCallId, name: "run_build", value: BUILD_OUTPUT, content: [{ type: "text", text: BUILD_OUTPUT }] };
    },
  };
  const probe = definePackage({
    name: "@test/recall-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide(MEMORY_CHUNK_STORE_SERVICE, store);
      prism.tools.register(runBuild);
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
        context: { recentMessages: 0, compactAt: { maxTokens: 999_999 } },
        worker: { maxTurns: 2 },
      }),
    ],
    slots: { store: createMemorySessionStore() },
  });
  return {
    agent,
    store,
    toolCalls,
    mainRequests,
    builds: () => builds,
    cleanup: async () => {
      await agent.dispose();
      store.close();
    },
  };
}

/** The recall tool over `store`, executed directly as `session`. */
async function recallAs(
  store: SqliteChunkStore,
  session: { readonly id: string; entries(): Promise<readonly SessionEntry[]> },
  args: Record<string, unknown>,
) {
  const handle: ChunkStoreHandle = { run: (fn) => fn(store), close: async () => {} };
  const result = await createObservationalRecallTool({ chunks: handle }).execute(
    args as never,
    {
      toolCallId: "t",
      session,
    } as unknown as ToolExecutionContext,
  );
  return result.value as ReturnType<typeof recallObservationalMemory>;
}

describe("recall reads events, chunks and tombstones (plan 217 Task 4)", () => {
  it("recall_returns_tool_result_chunk_without_rerunning_any_tool", async () => {
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      const id = await waitForRecord(session);
      // The original tool result leaves the provider view.
      await session.compact();
      const before = live.toolCalls.length;
      await session.run("what did the build print");
      const after = live.mainRequests.at(-2);
      assert.ok(after, "the main model saw the post-compaction request");
      assert.doesNotMatch(text(after), /log line log line/, "the original tool output left context");
      assert.match(text(after), new RegExp(`\\[${id}\\][^"]*\\[chunk\\]`), "the block marks the record");

      const mainCalls = live.toolCalls.slice(before).filter((call) => call.sessionId === session.id);
      assert.deepEqual(
        mainCalls.map((call) => call.name),
        ["recall"],
        "no tool other than recall ran",
      );
      assert.equal(live.builds(), 1, "the build ran once, in the first turn");
      const answered = text(live.mainRequests.at(-1)!);
      assert.ok(answered.includes(CHUNK), "the recall result carries the chunk verbatim");
      assert.match(answered, /result: Build passed/);
      assert.match(answered, /sources: /);
    } finally {
      await live.cleanup();
    }
  });

  it("recall_reports_dropped_chunk_with_reason", async () => {
    // Live: a later pass supersedes the record, its last referrer goes, and recall says why the chunk is gone.
    const live = await liveAgent({ supersede: true });
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      const id = await waitForRecord(session);
      const chunkId = (await live.store.list("s1"))[0]?.id;
      assert.ok(chunkId);
      await session.run("moving on");
      await waitUntil(async () => (await live.store.get(chunkId, "s1")) === undefined);
      let value!: Awaited<ReturnType<typeof recallAs>>;
      await waitUntil(async () => {
        value = await recallAs(live.store, session, { id });
        return value.state === "dropped";
      });
      assert.equal(value.found, true);
      assert.match(value.chunks?.[0]?.dropped ?? "", /^record superseded by [a-f0-9]{12}$/);
      assert.match(value.text, /chunk dropped: record superseded by /);
      assert.ok(!value.text.includes(CHUNK));
    } finally {
      await live.cleanup();
    }

    // An active record whose chunk the session's store no longer holds (a process restart with the memory store).
    const active = recallObservationalMemory(
      [toolEntry, custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] })],
      observation.id,
      [],
      {
        chunkTexts: new Map([[ref.id, undefined]]),
      },
    );
    assert.equal(active.state, "active");
    assert.match(active.text, /chunk dropped: no referrer in this session's chunk store/);
  });

  it("tombstoned_record_found_by_id", () => {
    const entries = [
      toolEntry,
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

    const value = recallObservationalMemory(entries, observation.id, [], { chunkTexts: new Map([[ref.id, { text: CHUNK }]]) });
    assert.equal(value.found, true);
    assert.equal(value.state, "tombstoned");
    assert.equal(value.tombstone?.reason, "folded into WM item");
    assert.match(value.text, /\(tombstoned: folded into WM item\)/);
    assert.ok(value.text.includes(CHUNK), "a chunk still referenced elsewhere stays readable");
    assert.ok(!value.text.includes("log line"), "summary detail leaves the raw source out");
    assert.ok(recallObservationalMemory(entries, observation.id, [], { detail: "full" }).text.includes("log line"), "full adds it");

    // A tombstone whose chunk is gone names the tombstone, and a malformed tombstone record is ignored.
    assert.match(
      recallObservationalMemory(entries, observation.id, [], { chunkTexts: new Map([[ref.id, undefined]]) }).text,
      /chunk dropped: record tombstoned \(folded into WM item\)/,
    );
    const malformed = [
      ...entries.slice(0, 2),
      custom("t", { type: OBSERVATIONS_TOMBSTONED, observationIds: [observation.id], reason: "" }),
    ];
    assert.equal(recallObservationalMemory(malformed, observation.id).state, "active");
  });

  it("context_block_never_renders_chunk_text", async () => {
    const block = renderObservationalMemory([], [observation]);
    assert.match(block, /\[aaaaaaaaaaaa\] .*result: Build passed \[chunk\]/);
    assert.ok(!block.includes(CHUNK));

    // Live: after compaction the provider view carries the block's marker and never the chunk text.
    const live = await liveAgent();
    try {
      const session = await live.agent.session({ id: "s1", create: true });
      await session.run("build it");
      await waitForRecord(session);
      await session.compact();
      await session.run("hello");
      const request = text(live.mainRequests.at(-1)!);
      assert.match(request, /\[chunk\]/);
      assert.ok(!request.includes(CHUNK), "no chunk text in the provider view");
    } finally {
      await live.cleanup();
    }
  });

  it("forged_id_from_other_session_is_unknown", async () => {
    const live = await liveAgent();
    try {
      const owner = await live.agent.session({ id: "s1", create: true });
      await owner.run("build it");
      const id = await waitForRecord(owner);
      assert.equal((await recallAs(live.store, owner, { id })).chunks?.[0]?.text, CHUNK, "the owner reads it");

      const other = await live.agent.session({ id: "s2", create: true });
      await other.run("hello");
      const forged = await recallAs(live.store, other, { id });
      const never = await recallAs(live.store, other, { id: "0123456789ab" });
      assert.equal(forged.found, false);
      assert.equal(forged.reason, "unknown_id");
      assert.equal(
        forged.text.replace(id, "<id>"),
        never.text.replace("0123456789ab", "<id>"),
        "indistinguishable from an id that never existed",
      );
      assert.deepEqual(Object.keys(forged).sort(), Object.keys(never).sort());
    } finally {
      await live.cleanup();
    }
  });
});
