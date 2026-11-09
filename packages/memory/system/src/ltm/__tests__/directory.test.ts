import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextDraft, HookContext, JsonObject, ToolExecutionContext } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createFabricContext } from "../context.js";
import {
  createFabricDirectory,
  type FabricDirectoryHandle,
  pageFabricDirectory,
  type ResolvedFabricDirectoryOptions,
  renderFabricDirectory,
  resolveFabricDirectoryOptions,
} from "../directory.js";
import { createFabricFileJail } from "../files.js";
import { createMemory, createLongTermMemory } from "../../index.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
const hook = {} as HookContext;
const toolContext: ToolExecutionContext = { sessionId: "s", runId: "r", toolCallId: "c" };
const defaults = resolveFabricDirectoryOptions(true, true) as ResolvedFabricDirectoryOptions;

function harness(threadId = "th") {
  const vectorStore = createMemoryVectorStore();
  const make = (thread: string) =>
    createMemory({ tenantId: "t", resourceId: "r", threadId: thread, embedder: createHashEmbedder(), vectorStore });
  const memory = make(threadId);
  const fabric = createLongTermMemory({ memory, consolidate: false });
  return { memory, fabric, make, directory: createFabricDirectory({ memory }) };
}

async function directoryText(memory: ReturnType<typeof createMemory>, directory: FabricDirectoryHandle["source"], options = defaults) {
  const projection = createFabricContext(memory, async () => ({ hits: [], explain: [] }), false, {}, { source: directory, options });
  const built = await projection.build(draft, hook);
  const block = built.context?.find((item) => item.metadata?.source === "fabric-directory");
  return block && { title: block.title, content: String(block.content), metadata: block.metadata };
}

describe("memory directory", () => {
  it("directory_counts_match_recallable_notes", async () => {
    const { memory, fabric, directory } = harness();
    await fabric.remember({ kind: "fact", content: "deploys run on friday", tags: ["deploy"] });
    await fabric.remember({ kind: "fact", content: "billing uses stripe", tags: ["billing"] });
    const stale = await fabric.remember({ kind: "fact", content: "old fact", tags: ["stale"], validTo: "2000-01-01T00:00:00.000Z" });
    const revoked = await fabric.remember({ kind: "fact", content: "revoked fact", tags: ["revoked"] });
    const candidate = await fabric.remember({ kind: "procedure", content: "candidate procedure", tags: ["candidate"] });
    await memory.setConsent(revoked.id, { visible: false });
    const row = await memory.getEntry(candidate.id);
    await memory.remember(
      { entries: [{ id: candidate.id, text: row!.text, metadata: { ...row!.metadata, status: "candidate" } }] },
      { wait: true },
    );
    const snapshot = await directory.snapshot();
    assert.deepEqual(snapshot.counts, { fact: 2 });
    assert.deepEqual(snapshot.topics, [
      { tag: "billing", count: 1 },
      { tag: "deploy", count: 1 },
    ]);
    assert.ok(!snapshot.topics.some((topic) => ["stale", "revoked", "candidate"].includes(topic.tag)));
    assert.equal(stale.kind, "fact");
    const block = await directoryText(memory, directory);
    assert.equal(block?.title, "Long-term memory");
    assert.match(block!.content, /^2 facts\. Recall with memory\.recall\./);
    assert.match(block!.content, /Topics: billing \(1\), deploy \(1\)/);
    assert.doesNotMatch(block!.content, /deploys run on friday/, "the directory names no note content");
  });

  it("directory_bytes_stable_without_writes", async () => {
    const { memory, fabric, directory } = harness();
    await fabric.remember({ kind: "fact", content: "one", tags: ["alpha"] });
    let queries = 0;
    const original = memory.countByKind;
    (memory as { countByKind: typeof original }).countByKind = (query) => {
      queries += 1;
      return original(query);
    };
    const seen = new Set<string>();
    const projection = createFabricContext(
      memory,
      async () => ({ hits: [], explain: [] }),
      false,
      {},
      { source: directory, options: defaults },
    );
    for (let turn = 0; turn < 10; turn += 1) seen.add(String((await projection.build(draft, hook)).context?.[0]?.content));
    assert.equal(seen.size, 1);
    assert.equal(queries, 1, "ten turns without a write run one aggregate query");
  });

  it("directory_updates_after_remember_and_forget", async () => {
    const { memory, fabric, directory } = harness();
    assert.equal(await directoryText(memory, directory), undefined, "an empty fabric renders no block");
    const first = await fabric.remember({ kind: "fact", content: "first fact", tags: ["alpha"] });
    assert.match((await directoryText(memory, directory))!.content, /^1 fact\./);
    await fabric.remember({ kind: "procedure", content: "do the thing", tags: ["alpha"] });
    assert.match((await directoryText(memory, directory))!.content, /^1 fact, 1 procedure\..*Topics: alpha \(2\)/s);
    await fabric.forget({ id: first.id });
    assert.match((await directoryText(memory, directory))!.content, /^1 procedure\..*Topics: alpha \(1\)/s);
    await memory.correct((await fabric.remember({ kind: "fact", content: "x", tags: ["beta"] })).id, "y");
    assert.match((await directoryText(memory, directory))!.content, /beta/);
  });

  it("directory_respects_scope_and_share_grants", async () => {
    const { memory, fabric, make, directory } = harness("parent");
    const child = make("child");
    const childFabric = createLongTermMemory({ memory: child, consolidate: false });
    const shared = await fabric.remember({ kind: "fact", content: "parent shared fact", tags: ["secret"] });
    await childFabric.remember({ kind: "fact", content: "child fact", tags: ["child"] });
    await memory.shareWith("child", [shared.id]);
    const childDirectory = createFabricDirectory({ memory: child });
    assert.deepEqual((await childDirectory.snapshot()).topics, [{ tag: "child", count: 1 }], "a share grant widens recall, not the index");
    assert.deepEqual((await directory.snapshot()).topics, [{ tag: "secret", count: 1 }]);
    const revoked = await fabric.remember({ kind: "fact", content: "revoked note", tags: ["gone"] });
    await memory.setConsent(revoked.id, { visible: false });
    assert.ok(!(await directory.snapshot()).topics.some((topic) => topic.tag === "gone"));
  });

  it("directory_capped_at_max_tokens", async () => {
    const { memory, fabric, directory } = harness();
    for (let index = 0; index < 20; index += 1) {
      await fabric.remember({
        kind: "fact",
        content: `fact ${index}`,
        tags: [`a-rather-long-topic-name-${String(index).padStart(2, "0")}`],
      });
    }
    const wide = { maxTopics: 20, maxFiles: 10, maxTokens: 40, stopWords: false };
    const block = await directoryText(memory, directory, wide);
    assert.ok(Math.ceil(block!.content.length / 4) <= 40);
    assert.ok(block!.content.startsWith("20 facts."), "counts survive the shrink");
    assert.equal(block!.metadata?.tokens, Math.ceil(block!.content.length / 4));
    assert.throws(() => resolveFabricDirectoryOptions({ maxTokens: 501 }, true), /maxTokens/);
    assert.throws(() => resolveFabricDirectoryOptions({ maxTopics: 0 }, true), /maxTopics/);
  });

  it("directory_off_renders_nothing", async () => {
    const { memory, fabric } = harness();
    await fabric.remember({ kind: "fact", content: "something", tags: ["x"] });
    assert.equal(resolveFabricDirectoryOptions(false, true), false);
    assert.equal(resolveFabricDirectoryOptions(undefined, false), false);
    const projection = createFabricContext(memory, async () => ({ hits: [], explain: [] }), false, {});
    assert.equal((await projection.build(draft, hook)).context, undefined);
  });

  it("lists recent files without the store file, redacts, and pages the full lists", async () => {
    const root = await mkdtemp(join(tmpdir(), "fabric-directory-"));
    tempDirs.push(root);
    await mkdir(join(root, "notes"), { recursive: true });
    for (const [path, age] of [
      ["notes/deploy.md", 300],
      ["notes/billing.md", 100],
      ["top.md", 200],
      [".hidden.md", 1],
      ["store.sqlite", 1],
      ["store.sqlite-wal", 1],
    ] as const) {
      await writeFile(join(root, path), "x");
      const when = new Date(Date.now() - age * 1000);
      await utimes(join(root, path), when, when);
    }
    const { memory, fabric } = harness();
    await fabric.remember({ kind: "file", path: "notes/deploy.md", content: "deploy" });
    const directory = createFabricDirectory({
      memory,
      files: createFabricFileJail(root),
      exclude: (path) => path === "store.sqlite" || path.startsWith("store.sqlite-"),
    });
    const snapshot = await directory.snapshot();
    assert.deepEqual(snapshot.files, ["notes/billing.md", "top.md", "notes/deploy.md"], "most recently modified first");
    const block = renderFabricDirectory(snapshot, { ...defaults, maxFiles: 2 });
    assert.match(block!.content, /^1 file\. Recall with memory\.recall; read files with memory\.read\./);
    assert.match(block!.content, /Files: notes\/billing\.md, top\.md, … \(\+1\)$/m);

    const page = pageFabricDirectory({ ...snapshot, files: Array.from({ length: 120 }, (_, index) => `f${index}`) }, 0);
    assert.equal(page.files.length, 50);
    assert.equal(page.nextOffset, 50);
    assert.equal(
      pageFabricDirectory({ ...snapshot, files: Array.from({ length: 120 }, (_, index) => `f${index}`) }, 100).nextOffset,
      undefined,
    );
  });

  it("memory_view_without_path_pages_full_directory", async () => {
    const { memory, fabric, directory } = harness();
    for (let index = 0; index < 60; index += 1)
      await fabric.remember({ kind: "fact", content: `fact ${index}`, tags: [`topic-${String(index).padStart(2, "0")}`] });
    const tools = createLongTermMemory({ memory, consolidate: false }).tools();
    const view = tools.find((tool) => tool.name === "memory.view")!;
    // The package passes its directory to the tool set; build the same wiring directly.
    const { createLongTermMemoryTools } = await import("../tools.js");
    const wired = createLongTermMemoryTools({
      memory,
      remember: fabric.remember,
      recall: fabric.recall,
      forget: fabric.forget,
      directory: { source: directory, options: { ...defaults, maxTopics: 3 } },
    })();
    const first = await wired.find((tool) => tool.name === "memory.view")!.execute({} as JsonObject, toolContext);
    const value = (first as { value: { topics: unknown[]; totals: { topics: number }; nextOffset?: number } }).value;
    assert.equal(value.topics.length, 50);
    assert.equal(value.totals.topics, 60);
    assert.equal(value.nextOffset, 50);
    assert.match(
      (first.content![0] as { text: string }).text,
      /^60 facts\..*Topics: topic-00 \(1\), topic-01 \(1\), topic-02 \(1\)\n.*Topics 1-50 of 60.*More: call memory\.view with offset 50\./s,
    );
    const second = (await wired
      .find((tool) => tool.name === "memory.view")!
      .execute({ offset: 50 } as JsonObject, toolContext)) as unknown as { value: { topics: unknown[]; nextOffset?: number } };
    assert.equal(second.value.topics.length, 10);
    assert.equal(second.value.nextOffset, undefined);
    // Without a directory (or with a path) the tool keeps listing the memory root.
    const plain = await view.execute({} as JsonObject, toolContext);
    assert.ok(plain.error, "no root and no directory: file access fails closed");
  });
  // Plan 210 Task 3.1: `directory.stopWords` drops topics made only of stop words. Off by default, so nothing moves.
  it("topic_list_drops_stop_words_and_keeps_content_words", async () => {
    const { fabric, memory } = harness();
    await fabric.remember({ kind: "fact", content: "billing uses stripe", tags: ["i", "it", "we", "billing", "hey john"] });
    const topicsOf = async (source: ReturnType<typeof createFabricDirectory>) => (await source.snapshot()).topics.map((topic) => topic.tag).sort();
    const off = await topicsOf(createFabricDirectory({ memory }));
    assert.deepEqual(off, ["billing", "hey john", "i", "it", "we"], "unset keeps every topic, as before");
    const on = await topicsOf(createFabricDirectory({ memory, stopWords: true }));
    assert.deepEqual(on, ["billing", "hey john"], "a topic of stop words only is dropped; a phrase with a content word stays");
  });

  it("directory_stop_words_field_is_off_by_default_and_fails_closed_on_a_non_boolean", () => {
    assert.equal((resolveFabricDirectoryOptions(true, true) as ResolvedFabricDirectoryOptions).stopWords, false);
    assert.equal((resolveFabricDirectoryOptions({ stopWords: true }, true) as ResolvedFabricDirectoryOptions).stopWords, true);
    assert.throws(() => resolveFabricDirectoryOptions({ stopWords: "yes" as unknown as boolean }, true), /directory\.stopWords must be a boolean/);
  });
});
