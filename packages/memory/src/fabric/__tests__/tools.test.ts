import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { readFabricBlock } from "../blocks.js";
import { MemoryValidationError } from "../../errors.js";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { createMemoryFabric, type CreateMemoryFabricOptions, type MemoryFabricToolsOptions } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };
const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function makeMemory(limits?: { readonly maxEntryTextChars?: number }) {
  return createMemory({
    ...scope,
    embedder: createHashEmbedder(),
    vectorStore: createMemoryVectorStore(),
    workingStore: createMemoryWorkingStore(),
    ...(limits === undefined ? {} : { limits }),
  });
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabric-jail-"));
  tempDirs.push(dir);
  return dir;
}

const context = (sessionId = "s1"): ToolExecutionContext => ({ sessionId, runId: "r1", toolCallId: "c1" });

/** Text of a text-only tool result, for assertions on what the model would read. */
function text(result: ToolResult): string {
  const block = result.content?.[0];
  assert.equal(block?.type, "text");
  return (block as { text: string }).text;
}

/** Normalized tool handle: always async, never the sync `ToolResult` half of the signature. */
function find(tools: readonly ToolDefinition[], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return {
    name: tool.name,
    parameters: tool.parameters,
    async execute(args: Record<string, unknown>, _context?: ToolExecutionContext): Promise<ToolResult> {
      return await tool.execute(args as JsonObject, context());
    },
  };
}

/** A fabric whose session gate is open the way a host opens it: `attach`. */
function attached(
  memory: ReturnType<typeof makeMemory>,
  toolOptions: MemoryFabricToolsOptions = {},
  fabricOptions: Omit<CreateMemoryFabricOptions, "memory"> = { consolidate: false },
) {
  const fabric = createMemoryFabric({ memory, ...fabricOptions });
  fabric.attach({ id: "s1" });
  return { fabric, tools: fabric.tools(toolOptions) };
}

describe("memory fabric tools", () => {
  it("exposes fresh inert definitions and refuses to execute until a session is attached", async () => {
    const memory = makeMemory();
    const root = await tempRoot();
    const fabric = createMemoryFabric({ memory });
    const first = fabric.tools({ root });
    const second = fabric.tools({ root });

    assert.deepEqual(
      first.map((tool) => tool.name),
      ["memory.view", "memory.read", "memory.insert", "memory.recall", "memory.forget"],
    );
    assert.equal(fabric.tools().length, 5);
    assert.notEqual(first, second);
    assert.notEqual(first[0], second[0]);

    const recalled = await find(first, "memory.recall").execute({ query: "anything" }, context());
    assert.deepEqual(recalled.value, { found: false, reason: "not_attached" });
    assert.equal(recalled.error?.message.includes("attached"), true);
    const inserted = await find(first, "memory.insert").execute({ text: "likes tea", block: "profile" }, context());
    assert.deepEqual(inserted.value, { found: false, reason: "not_attached" });
    assert.equal(await memory.getWorking(), undefined);
  });

  it("refuses traversal, absolute escapes, and symlink escapes on every path tool", async () => {
    const memory = makeMemory();
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(join(outside, "secret.txt"), "host secret");
    await symlink(outside, join(root, "escape"));
    const { tools } = attached(memory, { root });

    for (const name of ["memory.view", "memory.read"]) {
      await assert.rejects(find(tools, name).execute({ path: "../etc/passwd" }, context()), MemoryValidationError);
      await assert.rejects(find(tools, name).execute({ path: "/etc/passwd" }, context()), MemoryValidationError);
      await assert.rejects(find(tools, name).execute({ path: "escape/secret.txt" }, context()), MemoryValidationError);
    }
    const insert = find(tools, "memory.insert");
    await assert.rejects(insert.execute({ text: "leak", path: "../outside.txt" }, context()), MemoryValidationError);
    await assert.rejects(insert.execute({ text: "leak", path: "escape/secret.txt" }, context()), MemoryValidationError);
    await assert.rejects(insert.execute({ text: "leak", path: "" }, context()), MemoryValidationError);
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "host secret");
  });

  it("appends to a working block, refuses past the char cap, and leaves the version untouched", async () => {
    const memory = makeMemory({ maxEntryTextChars: 32 });
    const { tools } = attached(memory);
    const insert = find(tools, "memory.insert");

    const created = await insert.execute({ text: "likes tea", block: "profile" }, context());
    assert.equal((created.value as { created: boolean }).created, true);
    const appended = await insert.execute({ text: "likes coffee", block: "profile" }, context());
    assert.equal((appended.value as { created: boolean }).created, false);

    const record = await memory.getWorking();
    assert.equal(readFabricBlock(record, "profile")?.content, "likes tea\nlikes coffee");

    await assert.rejects(insert.execute({ text: "x".repeat(64), block: "profile" }, context()), MemoryValidationError);
    const afterCap = await memory.getWorking();
    assert.equal(afterCap?.version, record?.version);
    assert.equal(readFabricBlock(afterCap, "profile")?.content, "likes tea\nlikes coffee");

    await assert.rejects(insert.execute({ text: "orphan" }, context()), MemoryValidationError);
    await assert.rejects(insert.execute({ text: "two targets", block: "profile", path: "a.md" }, context()), MemoryValidationError);
    await assert.rejects(insert.execute({ text: "bad label", block: "Not A Label" }, context()), MemoryValidationError);
  });

  it("writes a file inside the root and refreshes its recallable file note", async () => {
    const memory = makeMemory();
    const root = await tempRoot();
    const { fabric, tools } = attached(memory, { root }, { consolidate: { threshold: 0.4 } });
    const insert = find(tools, "memory.insert");

    const first = await insert.execute({ text: "canary rollout checklist", path: "notes/canary.md" }, context());
    assert.equal((first.value as { bytes: number }).bytes, 24);
    assert.equal(await readFile(join(root, "notes/canary.md"), "utf8"), "canary rollout checklist");
    const noted = await fabric.recall("canary rollout checklist", { kinds: ["file"] });
    assert.equal(noted.hits.length, 1);
    assert.equal(noted.hits[0]?.path, "notes/canary.md");

    await insert.execute({ text: "and rollback steps", path: "notes/canary.md" }, context());
    assert.equal(await readFile(join(root, "notes/canary.md"), "utf8"), "canary rollout checklist\nand rollback steps");
    const current = await fabric.recall("canary rollout checklist", { kinds: ["file"], topK: 5 });
    assert.equal(current.hits.length, 1);
    assert.equal(current.hits[0]?.id, noted.hits[0]?.id, "one file keeps one note id");
    assert.equal(current.hits[0]?.content.includes("rollback steps"), true);
    const stored = await memory.recall("canary rollout checklist", { topK: 5 });
    assert.equal(stored.hits.length, 1, "the refreshed note folds into the same row");
  });

  it("lists the jail and truncates reads at the byte cap", async () => {
    const memory = makeMemory();
    const root = await tempRoot();
    await writeFile(join(root, "a.txt"), "0123456789");
    await mkdir(join(root, "sub"));
    const { tools } = attached(memory, { root, maxFileBytes: 4 });

    const viewed = await find(tools, "memory.view").execute({}, context());
    const listing = viewed.value as { entries: Array<{ name: string; kind: string; bytes?: number }>; truncated: boolean };
    assert.deepEqual(
      listing.entries.map((entry) => [entry.name, entry.kind]),
      [
        ["a.txt", "file"],
        ["sub", "directory"],
      ],
    );
    assert.equal(listing.entries[0]?.bytes, 10);
    assert.equal(listing.truncated, false);
    assert.equal(text(viewed).includes("a.txt (10 bytes)"), true);

    const read = await find(tools, "memory.read").execute({ path: "a.txt" }, context());
    const content = read.value as { text: string; bytes: number; truncated: boolean };
    assert.deepEqual([content.text, content.bytes, content.truncated], ["0123", 10, true]);
    assert.equal(text(read).includes("truncated at 4 bytes"), true);

    const missing = await find(tools, "memory.read").execute({ path: "nope.txt" }, context());
    assert.deepEqual(missing.value, { found: false, reason: "not_found" });
    const missingDir = await find(tools, "memory.view").execute({ path: "nope" }, context());
    assert.deepEqual(missingDir.value, { found: false, reason: "not_found" });

    const rootless = await find(attached(memory).tools, "memory.read").execute({ path: "a.txt" }, context());
    assert.deepEqual(rootless.value, { found: false, reason: "no_root" });
  });

  it("serves recall with filters and renders ids, kinds, and scores", async () => {
    const memory = makeMemory();
    const { fabric, tools } = attached(memory);
    const fact = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    const procedure = await fabric.remember({ kind: "procedure", content: "Canary rollout rollback steps" });
    const recall = find(tools, "memory.recall");

    const defaults = await recall.execute({ query: "canary rollout" }, context());
    const defaultHits = (defaults.value as { hits: Array<{ id: string }> }).hits;
    assert.deepEqual(
      defaultHits.map((hit) => hit.id),
      [fact.id],
    );
    assert.equal(text(defaults).includes(fact.id), true);
    assert.equal(text(defaults).includes("[fact]"), true);

    const procedures = await recall.execute({ query: "canary rollout", kinds: ["procedure"], budget: 100 }, context());
    const procedureHits = (procedures.value as { hits: Array<{ id: string }> }).hits;
    assert.deepEqual(
      procedureHits.map((hit) => hit.id),
      [procedure.id],
    );
    assert.equal(text(procedures).includes("[procedure]"), true);

    const future = await fabric.remember({
      kind: "fact",
      content: "Pricing moves to usage tiers",
      validFrom: "2030-01-01T00:00:00.000Z",
    });
    const ids = (result: ToolResult): string[] => (result.value as { hits: Array<{ id: string }> }).hits.map((hit) => hit.id);
    const beforeWindow = await recall.execute({ query: "pricing usage tiers" }, context());
    assert.equal(ids(beforeWindow).includes(future.id), false);
    const insideWindow = await recall.execute({ query: "pricing usage tiers", asOf: "2030-06-01T00:00:00.000Z" }, context());
    assert.equal(ids(insideWindow).includes(future.id), true);
    await assert.rejects(recall.execute({ query: "   " }, context()), MemoryValidationError);
    await assert.rejects(recall.execute({ query: "canary", kinds: ["nope"] }, context()), MemoryValidationError);
  });

  it("tombstones notes and blocks, and keeps held notes out of recall", async () => {
    const memory = makeMemory();
    const { fabric, tools } = attached(memory);
    const forget = find(tools, "memory.forget");

    const note = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    const dropped = await forget.execute({ id: note.id }, context());
    assert.deepEqual(dropped.value, { found: true, id: note.id, deleted: 1, held: false });
    assert.deepEqual((await fabric.recall("Canary rollout protects deploys")).hits, []);
    assert.deepEqual((await forget.execute({ id: note.id }, context())).value, { found: false, id: note.id, deleted: 0, held: false });

    const held = await fabric.remember({ kind: "fact", content: "Billing moves to usage tiers" });
    const retained = await forget.execute({ id: held.id, hold: true }, context());
    assert.deepEqual(retained.value, { found: true, id: held.id, deleted: 0, held: true });
    assert.equal(text(retained).includes("legal hold"), true);
    assert.deepEqual((await fabric.recall("Billing moves to usage tiers")).hits, []);
    assert.deepEqual((await memory.recall("Billing moves to usage tiers")).hits, []);

    await fabric.remember({ kind: "working", content: "likes tea", block: "profile" });
    const block = await forget.execute({ block: "profile" }, context());
    assert.deepEqual(block.value, { found: true, block: "profile", deleted: 1, held: false });
    assert.equal(readFabricBlock(await memory.getWorking(), "profile"), undefined);
    assert.deepEqual((await forget.execute({ block: "profile" }, context())).value, {
      found: false,
      block: "profile",
      deleted: 0,
      held: false,
    });

    await assert.rejects(forget.execute({}, context()), MemoryValidationError, "empty forget");
    await assert.rejects(forget.execute({ id: note.id, block: "profile" }, context()), MemoryValidationError, "two targets");
    await assert.rejects(forget.execute({ id: "nope" }, context()), MemoryValidationError, "bad id");
    await assert.rejects(forget.execute({ block: "profile", hold: true }, context()), MemoryValidationError, "hold a block");
    await assert.rejects(fabric.forget({ id: note.id, hold: "yes" as unknown as boolean }), MemoryValidationError, "bad hold");
  });
});
