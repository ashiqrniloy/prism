import { expect, test } from "bun:test";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import { createExchangeArchive } from "../exchanges.js";
import { createMemory, createLongTermMemory } from "../../index.js";

const context = { sessionId: "caller", runId: "run", toolCallId: "call" };
async function harness(fallback = false) {
  const stores = await createSqliteMemoryStores({ path: ":memory:" });
  const store = fallback ? createMemoryVectorStore() : stores.vectorStore;
  const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "archive", vectorStore: store });
  const warnings: string[] = [];
  const fabric = createLongTermMemory({ memory, vectorStore: store, consolidate: false, notify: (message) => warnings.push(message) });
  for (let i = 11; i >= 0; i--) {
    await fabric.remember({
      kind: "exchange",
      id: i.toString(16).padStart(12, "0"),
      session: "past",
      content: `round ${i}`,
      tRef: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    });
  }
  const tool = fabric.tools().find((tool) => tool.name === "memory.read")!;
  return {
    stores,
    memory,
    fabric,
    warnings,
    read: async (args: Record<string, string | number>) =>
      (await tool.execute(args, context)).value as { notes: { id: string; session: string }[]; reason?: string },
  };
}

test("read_session_pages_in_time_order", async () => {
  const h = await harness();
  try {
    const first = await h.read({ session: "past" });
    const second = await h.read({ session: "past", page: 1 });
    expect(first.notes.map((note) => note.id)).toEqual(Array.from({ length: 8 }, (_, i) => i.toString(16).padStart(12, "0")));
    expect(second.notes).toHaveLength(4);
    expect(second.notes[0].id).toBe("000000000008");
    expect(first.notes[0].session).toBe("past");
    expect((await h.read({ session: "past", page: 2 })).reason).toBe("not_found");
    await expect(h.read({ session: "past", page: -1 })).rejects.toThrow();
    await expect(h.read({ session: "past", id: "000000000000" })).rejects.toThrow();
  } finally {
    h.stores.close();
  }
});

test("read_around_returns_same_session_neighbours_in_scope_only", async () => {
  const h = await harness();
  try {
    const result = await h.read({ around: "000000000005" });
    expect(result.notes.map((note) => note.id)).toEqual([3, 4, 5, 6, 7].map((i) => i.toString(16).padStart(12, "0")));
    await h.memory.forget({ ids: ["000000000004"] });
    expect((await h.read({ around: "000000000005" })).notes.some((note) => note.id === "000000000004")).toBe(false);
    await h.memory.setConsent("000000000006", { visible: false });
    expect((await h.read({ session: "past" })).notes.some((note) => note.id === "000000000006")).toBe(false);
    await h.fabric.remember({ kind: "exchange", id: "eeeeeeeeeeee", session: "another", content: "other session" });
    expect((await h.read({ around: "000000000005" })).notes.some((note) => note.id === "eeeeeeeeeeee")).toBe(false);
    const foreign = createMemory({ tenantId: "foreign", resourceId: "r", threadId: "archive", vectorStore: h.stores.vectorStore });
    const other = createLongTermMemory({ memory: foreign, consolidate: false });
    await other.remember({ kind: "exchange", id: "ffffffffffff", session: "past", content: "foreign data" });
    expect((await h.read({ around: "ffffffffffff" })).reason).toBe("not_found");
    expect((await h.read({ session: "past" })).notes.some((note) => note.id === "ffffffffffff")).toBe(false);
  } finally {
    h.stores.close();
  }
});

test("legacy_store_navigation_uses_status_emitting_scan", async () => {
  const h = await harness(true);
  try {
    expect((await h.read({ session: "past" })).notes).toHaveLength(8);
    expect(h.warnings.some((message) => message.includes("metadata scan"))).toBe(true);
  } finally {
    h.stores.close();
  }
});

test("preset_makes_no_embedding_or_write_path_model_call", async () => {
  const h = await harness();
  try {
    expect(h.memory.retrieval).toBe("lexical");
    const archive = createExchangeArchive({ remember: h.fabric.remember, maxTextChars: 16384, scope: "project" });
    const entry = (id: string, role: "user" | "assistant", text: string) => ({
      id,
      sessionId: "new-session",
      timestamp: "2026-01-01T00:00:00Z",
      kind: "message" as const,
      message: { role, content: [{ type: "text" as const, text }] },
    });
    const report = await archive.pair({
      user: entry("u", "user", "My flight to Paris was delayed."),
      assistant: entry("a", "assistant", "Noted."),
    });
    expect(report.archived).toBe(1);
    const result = await h.read({ session: "new-session" });
    expect(result.notes).toHaveLength(1);
    const recalled = await h.fabric.recall("flight", { kinds: ["exchange"], minSimilarity: 0 });
    expect(recalled.hits.some((hit) => hit.id === result.notes[0].id)).toBe(true);
  } finally {
    h.stores.close();
  }
});

// Plan 210 Task 2: the package builds its own tool set; it must route navigation, pinning and note lookup
// the way `createLongTermMemory().tools()` does. Before the fix, `around`/`session` always returned not_found here.
test("package_memory_read_navigates_and_replace_pins_across_scopes", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createAgent } = await import("@arnilo/prism");
  const { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } = await import("@arnilo/prism/testing");
  const { default: memorySystem } = await import("../../index.js");
  const root = await mkdtemp(join(tmpdir(), "fabric-nav-"));
  try {
    const path = join(root, "memory.sqlite");
    const stores = await createSqliteMemoryStores({ path });
    const scope = { tenantId: "nav", resourceId: "projects/nav--01234567", threadId: "default" };
    const memory = createMemory({ ...scope, ...stores });
    const writer = createLongTermMemory({ memory, vectorStore: stores.vectorStore, consolidate: false });
    for (let i = 0; i < 5; i++)
      await writer.remember({
        kind: "exchange",
        id: `00000000000${i}`,
        session: "past",
        content: `round ${i}`,
        tRef: `2026-01-0${i + 1}T00:00:00Z`,
      });
    const fact = await writer.remember({ kind: "fact", content: "the canary pool drains first" });
    stores.close();
    const results: { name: string; value: unknown }[] = [];
    const step = (id: string, name: string, args: import("@arnilo/prism").JsonObject) => [
      providerToolCall(toolCallContent(id, name, args)),
      providerDone(),
    ];
    const agent = await createAgent({
      model: "mock/main",
      packages: [
        mockProvider([
          step("a", "memory.read", { around: "000000000002" }),
          step("b", "memory.read", { session: "past" }),
          step("c", "memory.replace", { id: fact.id, old: "first", new: "first always", pin: true }),
          [providerTextDelta("ok"), providerDone()],
        ]),
        memorySystem({ ltm: {
          tools: { root },
          store: { sqlite: { path } },
          scopes: { tenantId: "nav", project: { id: "nav--01234567", root }, agent: false, user: false },
        } }),
      ],
    });
    const session = await agent.session({ id: "s", create: true });
    const pump = (async () => {
      for await (const event of session.subscribe())
        if (event.type === "tool.completed") results.push({ name: event.name ?? "", value: event.result.value });
    })();
    await session.run("navigate");
    await session.close();
    await agent.dispose();
    await pump;
    const [around, paged, replaced] = results as { value: { notes?: { id: string }[]; found?: boolean } }[];
    expect(around!.value.notes?.map((note) => note.id)).toEqual([
      "000000000000",
      "000000000001",
      "000000000002",
      "000000000003",
      "000000000004",
    ]);
    expect(paged!.value.notes).toHaveLength(5);
    expect(replaced!.value.found).toBe(true);
    const reopened = await createSqliteMemoryStores({ path });
    const row = await createMemory({ ...scope, ...reopened }).getEntry(fact.id);
    expect((row?.metadata?.fabric as { pinned?: boolean } | undefined)?.pinned).toBe(true);
    reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
