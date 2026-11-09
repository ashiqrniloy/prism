/**
 * Plan 217 Task 2: the chunk store — verbatim, redacted, capped, deletable, reference-counted (design I2–I3).
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  capChunk,
  createSqliteChunkStore,
  MEMORY_CHUNK_STORE_SERVICE,
  type PreparedChunk,
  prepareChunks,
  type SqliteChunkStore,
} from "../chunks.js";
import memorySystem from "../index.js";
import { clientFor } from "../session/__tests__/helpers.js";
import { SESSION_LEDGER_KEY } from "../session/state.js";
import { OBSERVATIONS_RECORDED } from "../session/types.js";
import { runStm } from "../session/workers/stm.js";

const BUILD = "Ran 35 tests across 3 files.\n0 fail";
const toolEntry: SessionEntry = {
  id: "e47",
  sessionId: "s",
  kind: "message",
  timestamp: "2026-11-09T10:00:00.000Z",
  message: { role: "tool", content: [{ type: "text", text: `${BUILD}\nDone in 2.1s` }] },
} as SessionEntry;
const userEntry: SessionEntry = {
  id: "e41",
  sessionId: "s",
  kind: "message",
  timestamp: "2026-11-09T09:59:00.000Z",
  message: { role: "user", content: [{ type: "text", text: "Run the campaign tests" }] },
} as SessionEntry;

/** A worker provider that makes the scripted calls on its first turn and keeps the tool results. */
function scripted(calls: readonly Record<string, unknown>[], results: unknown[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      const answered = request.messages.filter((message) => message.role === "tool");
      if (!answered.length) {
        for (const [index, args] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, "record_event", args as never));
      } else {
        for (const message of answered) results.push(...message.content);
      }
      yield providerDone();
    },
  };
}

const okValues = (results: unknown[]): unknown[] => results.map((part) => (part as { result?: unknown }).result);

async function stmWith(calls: readonly Record<string, unknown>[], extra: Partial<Parameters<typeof runStm>[0]> = {}) {
  const results: unknown[] = [];
  const chunks: PreparedChunk[] = [];
  const events = await runStm({
    entries: [userEntry, toolEntry],
    client: clientFor(scripted(calls, results)),
    maxTurns: 2,
    onChunks: (_id, accepted) => chunks.push(...accepted),
    ...extra,
  });
  return { events, chunks, results: okValues(results) };
}

const event = (chunks: unknown, description = "Ran the campaign tests") => ({
  kind: "result",
  description,
  sourceEntryIds: ["e41", "e47"],
  chunks,
});

describe("chunk store (plan 217 Task 2)", () => {
  it("chunk_must_be_verbatim_substring_of_cited_entry", async () => {
    // Accepted: the tool output's own text (unescaped newlines), and the serialized form with whitespace changed.
    const accepted = await stmWith([
      event([{ sourceEntryId: "e47", text: BUILD }]),
      event([{ sourceEntryId: "e47", text: "35   tests across\t3 files." }], "b"),
    ]);
    assert.deepEqual(
      accepted.results.map((value) => (value as { ok: boolean }).ok),
      [true, true],
    );
    assert.equal(accepted.events[0]?.chunkRefs?.[0]?.sourceEntryId, "e47");
    assert.equal(accepted.chunks[0]?.text, BUILD, "stored verbatim");
    assert.equal(accepted.events[0]?.chunkRefs?.[0]?.sha256, accepted.chunks[0]?.sha256);

    const rejected = await stmWith([
      event([{ sourceEntryId: "e47", text: "Ran 36 tests across 3 files" }]),
      event([{ sourceEntryId: "e41", text: BUILD }], "c"),
      event([{ sourceEntryId: "nope", text: BUILD }], "d"),
      event(
        [
          { sourceEntryId: "e47", text: "Ran" },
          { sourceEntryId: "e47", text: "tests" },
          { sourceEntryId: "e47", text: "fail" },
        ],
        "e",
      ),
    ]);
    assert.deepEqual(
      rejected.results.map((value) => (value as { reason: string }).reason),
      ["chunk_not_verbatim", "chunk_not_verbatim", "chunk_unknown_entry", "too_many_chunks"],
    );
    assert.equal(rejected.events.length, 0, "a bad chunk rejects the whole event");
    assert.equal(rejected.chunks.length, 0);

    // The record_event schema offers chunks only when chunks are on.
    const off = await stmWith([event([{ sourceEntryId: "e47", text: BUILD }])], { maxChunksPerEvent: 0 });
    assert.equal(off.events[0]?.chunkRefs, undefined, "with chunks off the argument is ignored");
  });

  it("chunk_is_redacted_capped_and_never_on_the_branch", async () => {
    const SECRET = "sk-live-0123456789abcdef";
    const entry = { ...toolEntry, message: { role: "tool", content: [{ type: "text", text: `token=${SECRET} ok` }] } } as SessionEntry;
    const redacted = prepareChunks([{ sourceEntryId: "e47", text: `token=${SECRET} ok` }], {
      entries: [entry],
      secrets: [SECRET],
      maxChunks: 2,
      maxChunkBytes: 4096,
    });
    assert.ok(redacted.ok);
    assert.ok(!redacted.chunks[0]?.text.includes(SECRET), "redacted before it is written");

    const long = `${"x".repeat(300)}TAIL-BYTES`;
    const capped = capChunk(long, 256);
    assert.ok(Buffer.byteLength(capped, "utf8") <= 256);
    assert.match(capped, /\[chunk truncated: 310 bytes/);
    assert.ok(!capped.includes("TAIL-BYTES"), "the marker never carries the cut bytes");

    // The batch budget: chunks may take at most a quarter of the batch's transcript bytes.
    const big = await stmWith([event([{ sourceEntryId: "e47", text: BUILD }])], { sourceText: "x".repeat(40) });
    assert.equal((big.results[0] as { reason: string }).reason, "chunk_budget_exceeded");

    // Live: the ledger carries only chunkRefs; the text sits in the store.
    const { agent, store, cleanup } = await chunkAgent((request, ids) => {
      const line = userText(request)
        .split("\n")
        .find((text) => text.includes("BUILD-OK"));
      const id = line?.match(/^\[[^\]]+\] \[([^\]]+)\]/)?.[1];
      return id
        ? [{ kind: "result", description: "Build passed", sourceEntryIds: ids, chunks: [{ sourceEntryId: id, text: "BUILD-OK 35 tests" }] }]
        : [];
    });
    try {
      const session = await agent.session({ id: "s1", create: true });
      await session.run("Here is the output: BUILD-OK 35 tests passed");
      const ref = await waitForRef(session);
      const ledger = (await session.entries()).filter(
        (entry) => entry.kind === "package_state" && JSON.stringify(entry.data).includes(SESSION_LEDGER_KEY),
      );
      assert.ok(ledger.length > 0);
      assert.ok(!JSON.stringify(ledger).includes("BUILD-OK 35 tests"), "no chunk text on the branch");
      assert.equal((await store.get(ref, "s1"))?.text, "BUILD-OK 35 tests");
    } finally {
      await cleanup();
    }
  });

  it("zero_referrers_hard_deletes_and_bytes_leave_the_file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-chunks-"));
    try {
      const path = join(dir, "chunks.sqlite");
      const store = await createSqliteChunkStore({ path });
      assert.equal(statSync(path).mode & 0o777, 0o600, "created 0600");
      const prepared = prepareChunks([{ sourceEntryId: "e47", text: "UNIQUE-CHUNK-BYTES-0042 payload" }], {
        entries: [
          { ...toolEntry, message: { role: "tool", content: [{ type: "text", text: "UNIQUE-CHUNK-BYTES-0042 payload" }] } } as SessionEntry,
        ],
        maxChunks: 1,
        maxChunkBytes: 4096,
      });
      assert.ok(prepared.ok);
      const chunk = prepared.chunks[0];
      assert.ok(chunk);
      const a = { kind: "stm", id: "r1", sessionId: "s1" } as const;
      const b = { kind: "wm", id: "w1", sessionId: "s1" } as const;
      await store.put(chunk, a);
      assert.equal(await store.ref(chunk.id, b), true);
      assert.ok(readFileSync(path).includes("UNIQUE-CHUNK-BYTES-0042"));
      assert.deepEqual(await store.unref(chunk.id, a), { deleted: false }, "one referrer left");
      assert.ok(await store.get(chunk.id, "s1"));
      assert.deepEqual(await store.unref(chunk.id, b), { deleted: true });
      assert.equal(await store.get(chunk.id, "s1"), undefined);
      assert.equal(await store.ref(chunk.id, a), false, "a referrer never resurrects a deleted chunk");
      store.close();
      for (const file of readdirSync(dir))
        assert.ok(!readFileSync(join(dir, file)).includes("UNIQUE-CHUNK-BYTES-0042"), `${file} still holds the bytes`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fork_referrers_keep_parent_dropped_chunk_alive", async () => {
    const { agent, store, deletes, cleanup } = await supersedingAgent();
    try {
      const parent = await agent.session({ id: "parent", create: true });
      await parent.run("Here is the output: BUILD-OK 35 tests passed");
      const ref = await waitForRef(parent);
      const child = await parent.fork();
      await waitUntil(async () => (await store.get(ref, child.id)) !== undefined);
      await parent.run("Parent moves on");
      await waitUntil(async () => (await store.get(ref, "parent")) === undefined);
      assert.ok(await store.get(ref, child.id), "the child's referrer keeps the chunk");
      assert.equal(deletes.length, 0);
      await child.run("Child moves on");
      await waitUntil(() => deletes.length > 0);
      assert.deepEqual(deletes, [ref]);
      assert.equal(await store.get(ref, child.id), undefined);
    } finally {
      await cleanup();
    }
  });

  it("only_referrer_removal_reaches_delete", async () => {
    // Across the live fixture, every delete is a zero-referrer transition of `apply`.
    const { agent, store, deletes, unrefDeleted, cleanup } = await supersedingAgent();
    try {
      const session = await agent.session({ id: "s1", create: true });
      await session.run("Here is the output: BUILD-OK 35 tests passed");
      const ref = await waitForRef(session);
      await session.run("Moving on");
      await waitUntil(() => deletes.length > 0);
      assert.deepEqual(deletes, [ref]);
      assert.deepEqual(unrefDeleted, [ref], "the delete came from the unref path");
      assert.equal(await store.get(ref, "s1"), undefined);
    } finally {
      await cleanup();
    }
    // And no source outside chunks.ts reaches the store's delete.
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders = sources(root).filter(
      (file) => !file.endsWith("chunks.ts") && /\b(store|chunks)\.delete\(/.test(readFileSync(file, "utf8")),
    );
    assert.deepEqual(offenders, []);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "__tests__"
        ? []
        : sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

const userText = (request: ProviderRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 500 && !(await check()); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(await check(), "condition settled");
}

/** The first chunk ref the session's ledger records, once its background pass settles. */
async function waitForRef(session: { entries(): Promise<readonly SessionEntry[]> }): Promise<string> {
  let ref: string | undefined;
  await waitUntil(async () => {
    for (const entry of await session.entries()) {
      const value = (entry.data as { value?: { type?: string; observations?: { chunkRefs?: { id: string }[] }[] } } | undefined)?.value;
      if (value?.type === OBSERVATIONS_RECORDED) ref ??= value.observations?.find((item) => item.chunkRefs?.length)?.chunkRefs?.[0]?.id;
    }
    return ref !== undefined;
  });
  assert.ok(ref);
  return ref;
}

/**
 * An agent whose STM worker answers each request with `respond(request, entryIds)`, over a chunk store a test package
 * provides through the `memory.chunks` service (the host-supplied path), with `delete` spied.
 */
async function chunkAgent(respond: (request: ProviderRequest, ids: string[]) => Record<string, unknown>[]) {
  const store = await createSqliteChunkStore({ path: ":memory:" });
  const deletes: string[] = [];
  const unrefDeleted: string[] = [];
  const original = store.delete.bind(store);
  (store as { delete: SqliteChunkStore["delete"] }).delete = (id) => {
    deletes.push(id);
    original(id);
  };
  const apply = store.apply.bind(store);
  store.apply = async (ops) => {
    const result = await apply(ops);
    unrefDeleted.push(...result.deleted);
    return result;
  };
  const provider: ModelProvider = {
    id: "scripted",
    async *generate(request) {
      const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
      const answered = request.messages.some((message) => message.role === "tool");
      if (names.has("record_event")) {
        if (!answered) {
          const ids = [...userText(request).matchAll(/^\[[^\]]+\] \[([^\]]+)\]/gm)].map((match) => match[1] ?? "");
          for (const [index, args] of respond(request, ids).entries())
            yield providerToolCall(toolCallContent(`o${index}`, "record_event", args as never));
        }
      } else {
        yield providerTextDelta("ok");
      }
      yield providerDone();
    },
  };
  const chunkService = definePackage({
    name: "@test/chunk-store",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide(MEMORY_CHUNK_STORE_SERVICE, store);
    },
  })();
  const agent = await createAgent({
    model: { provider: "scripted", model: "main" },
    packages: [
      providerPackage("scripted", [provider]),
      chunkService,
      memorySystem({
        enabled: true,
        stm: { model: "scripted/stm", triggerTokens: 1 },
        wm: false,
        context: { compactAt: { maxTokens: 999_999 } },
        worker: { maxTurns: 2 },
      }),
    ],
    slots: { store: createMemorySessionStore() },
  });
  return {
    agent,
    store,
    deletes,
    unrefDeleted,
    cleanup: async () => {
      await agent.dispose();
      store.close();
    },
  };
}

/** First pass: a `result` event with a chunk of the build output. Every later pass supersedes the indexed record. */
function supersedingAgent() {
  return chunkAgent((request, ids) => {
    const text = userText(request);
    const indexed = text.match(/^\[([a-f0-9]+)\] result:/m)?.[1];
    if (indexed) return [{ kind: "statement", description: `Moved on from ${indexed}`, sourceEntryIds: ids, supersedes: indexed }];
    const line = text.split("\n").find((value) => value.includes("BUILD-OK"));
    const id = line?.match(/^\[[^\]]+\] \[([^\]]+)\]/)?.[1];
    return id
      ? [{ kind: "result", description: "Build passed", sourceEntryIds: ids, chunks: [{ sourceEntryId: id, text: "BUILD-OK 35 tests" }] }]
      : [];
  });
}
