/**
 * Plan 188.5 Task 1: the pinned core is a small top-S slice of long-term memory in the prompt prefix,
 * stable between rebuilds, and written to a per-scope `core.md` by the markdown store.
 */

import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ContextDraft,
  createSessionEntry,
  type HookContext,
  type ModelClient,
  providerDone,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { createMemoryVectorStore, type VectorStore } from "@arnilo/prism-memory-core";
import { resolveLifecycleConfig } from "../../config.js";
import { createFabricContext } from "../../context.js";
import { createMemory, createMemoryFabric, createMemoryWorkingStore } from "../../index.js";
import { createFabricLifecycle } from "../../lifecycle/index.js";
import { resolvePromoteConfig } from "../../promote.js";
import { encodeMemoryNoteMetadata, type MemoryNoteMetadata } from "../../types.js";
import {
  type CreateFabricCoreOptions,
  createFabricCore,
  type MemoryFabricCoreConfig,
  type ResolvedFabricCoreOptions,
  resolveFabricCoreOptions,
} from "../core.js";

const TENANT = "t";
const PROJECT = "projects/prism--11111111";
const PROJECT_DIRECTORY = join(TENANT, "projects", "prism--11111111");
const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
const hook = {} as HookContext;
const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** Storage strength from an explicit promotion signal, so S ordering is testable without a clock. */
const explicit = (value: number): MemoryNoteMetadata["promotion"] => ({ score: 0.9, signals: { explicit: value, outcome: 0 }, pass: "p1" });

interface HarnessOptions {
  readonly core?: false | MemoryFabricCoreConfig;
  readonly capacityNotes?: number;
  readonly promote?: boolean;
  readonly client?: ModelClient;
  readonly writeFile?: CreateFabricCoreOptions["writeFile"];
  readonly vectorStore?: VectorStore;
  readonly workingStore?: ReturnType<typeof createMemoryWorkingStore>;
}

function harness(input: HarnessOptions = {}) {
  const vectorStore: VectorStore = input.vectorStore ?? createMemoryVectorStore();
  const workingStore = input.workingStore ?? createMemoryWorkingStore();
  const memoryFor = (resourceId: string) => createMemory({ tenantId: TENANT, resourceId, threadId: "default", vectorStore, workingStore });
  const project = memoryFor(PROJECT);
  const user = memoryFor("user");
  const scopes = [
    { level: "project" as const, memory: project },
    { level: "user" as const, memory: user },
  ];
  const fabric = createMemoryFabric({
    memory: project,
    scopes,
    vectorStore,
    lifecycle: resolveLifecycleConfig(input.capacityNotes === undefined ? {} : { capacity: { project: { notes: input.capacityNotes } } }),
    clock: () => 0,
    ...(input.promote === true
      ? {
          promote: resolvePromoteConfig({ minTurnsBetween: 1 }),
          promoteRoot: "/nonexistent-prism-core-promote-root",
          resolveModelClient: () => input.client!,
        }
      : { consolidate: false }),
  });
  let scans = 0;
  const scanMetadata = vectorStore.scanMetadata!.bind(vectorStore);
  const resolved = resolveFabricCoreOptions(input.core ?? true, true);
  const core =
    resolved === false
      ? undefined
      : createFabricCore({
          scopes,
          options: resolved,
          scanMetadata: (query) => {
            scans += 1;
            return scanMetadata(query);
          },
          ...(input.writeFile === undefined ? {} : { writeFile: input.writeFile }),
        });
  const projection = createFabricContext(project, fabric.recall, false, {}, undefined, undefined, undefined, core);
  return { vectorStore, project, user, fabric, projection, memoryFor, scans: () => scans, options: resolved as ResolvedFabricCoreOptions };
}

async function coreBlock(projection: ReturnType<typeof createFabricContext>) {
  const built = await projection.build(draft, hook);
  const block = built.context?.find((item) => item.metadata?.source === "fabric-core");
  return block && { title: block.title, content: String(block.content), metadata: block.metadata };
}

async function advance(vectorStore: VectorStore, sessions: number): Promise<void> {
  for (let index = 0; index < sessions; index += 1) {
    await vectorStore.scopeCounter!.increment({ tenantId: TENANT, resourceId: PROJECT, name: "sessions" });
  }
}

describe("pinned core (plan 188.5 Task 1)", () => {
  it("core_selects_verified_by_storage_strength_pinned_first", async () => {
    const { fabric, projection } = harness();
    const weak = await fabric.remember({ kind: "fact", content: "weak fact" });
    const strong = await fabric.remember({ kind: "procedure", content: "strong procedure", promotion: explicit(1) });
    const middle = await fabric.remember({ kind: "preference", content: "middle preference", scope: "user", promotion: explicit(0.5) });
    const pinned = await fabric.remember({ kind: "fact", content: "pinned fact" });
    await fabric.pin(pinned.id);

    const block = await coreBlock(projection);
    assert.equal(block?.title, "Core memory");
    assert.equal(block?.metadata?.untrusted, true, "the core stays in the untrusted envelope");
    const content = block!.content;
    assert.match(content, new RegExp(`^Core memory \\(user\\): \\[${middle.id}\\] middle preference`), "user notes render first");
    const project = content.split("\n")[1]!;
    assert.match(project, new RegExp(`^Core memory \\(project prism\\): \\[${pinned.id}\\] pinned fact`));
    const order = [pinned.id, strong.id, weak.id].map((id) => project.indexOf(id));
    assert.deepEqual(
      order,
      [...order].sort((left, right) => left - right),
      "pinned first, then descending S",
    );
    assert.deepEqual(block?.metadata?.itemIds, [middle.id, pinned.id, strong.id, weak.id]);
  });

  it("core_is_byte_identical_across_turns_without_trigger", async () => {
    const { fabric, projection, scans } = harness();
    await fabric.remember({ kind: "fact", content: "one fact" });
    await fabric.remember({ kind: "fact", content: "two facts" });
    const before = scans();
    const seen = new Set<string>();
    for (let turn = 0; turn < 10; turn += 1) seen.add((await coreBlock(projection))!.content);
    assert.equal(seen.size, 1, "ten turns without a write send identical bytes");
    assert.equal(scans() - before, 2, "one metadata scan per scope for the whole run");
    assert.doesNotMatch([...seen][0]!, /\d{4}-\d{2}-\d{2}T/, "the block carries no timestamp");
  });

  it("core_rebuilds_on_maintain_consolidation_and_pin", async () => {
    // A pin changes the order: the pinned note moves ahead of a stronger one.
    const pinnedHarness = harness();
    const strong = await pinnedHarness.fabric.remember({ kind: "fact", content: "strong fact", promotion: explicit(1) });
    const plain = await pinnedHarness.fabric.remember({ kind: "fact", content: "plain fact" });
    let content = (await coreBlock(pinnedHarness.projection))!.content;
    assert.ok(content.indexOf(strong.id) < content.indexOf(plain.id));
    await pinnedHarness.fabric.pin(plain.id);
    assert.equal((await coreBlock(pinnedHarness.projection))!.content, content, "a pin waits for the next epoch");
    pinnedHarness.projection.refresh();
    content = (await coreBlock(pinnedHarness.projection))!.content;
    assert.ok(content.indexOf(plain.id) < content.indexOf(strong.id), "a pin rebuilds the core");

    // A maintenance pass evicts an over-capacity note, and the core loses it.
    const maintained = harness({ capacityNotes: 1 });
    const notes: { readonly id: string }[] = [];
    for (const text of ["first fact", "second fact", "third fact"])
      notes.push(await maintained.fabric.remember({ kind: "fact", content: text }));
    content = (await coreBlock(maintained.projection))!.content;
    for (const note of notes) assert.ok(content.includes(note.id));
    const report = await maintained.fabric.maintain();
    assert.equal(report.evicted, 2);
    content = (await coreBlock(maintained.projection))!.content;
    assert.equal(notes.filter((note) => content.includes(note.id)).length, 1, "maintain rebuilds the core");

    // A consolidation pass archives a stale verified note through its maintenance tail.
    const client: ModelClient = {
      model: { provider: "scripted", model: "test" },
      async *generate() {
        yield providerToolCall(toolCallContent("x1", "record_notes", { notes: [] }));
        yield providerDone();
      },
    };
    const consolidated = harness({ promote: true, client });
    const stale = await consolidated.fabric.remember({ kind: "fact", content: "stale gate rule" });
    await advance(consolidated.vectorStore, 200);
    assert.ok((await coreBlock(consolidated.projection))!.content.includes(stale.id));
    await consolidated.fabric.consolidate({
      id: "s1",
      entries: async () => [
        createSessionEntry({
          id: "u1",
          sessionId: "s1",
          timestamp: "2026-01-01T00:00:00.000Z",
          kind: "message",
          message: { role: "user", content: [{ type: "text", text: "keep the retry budget small" }] },
        }),
      ],
    });
    assert.equal(await coreBlock(consolidated.projection), undefined, "a consolidation tail archive rebuilds the core");
  });

  it("core_excludes_candidates_flagged_and_archived", async () => {
    const { project, fabric, projection } = harness();
    const kept = await fabric.remember({ kind: "fact", content: "kept fact" });
    const candidate = await fabric.remember({ kind: "procedure", content: "candidate procedure" }, { status: "candidate" });
    const archived = await fabric.remember({ kind: "fact", content: "archived fact" });
    await createFabricLifecycle(project).archive(archived.id);
    const revoked = await fabric.remember({ kind: "fact", content: "revoked fact" });
    await project.setConsent(revoked.id, { visible: false });
    await project.remember(
      {
        entries: [
          {
            id: "f".padEnd(12, "0"),
            text: "flagged fact",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: { fabric: encodeMemoryNoteMetadata({ kind: "fact", flags: ["injection"] }) },
          },
        ],
      },
      { wait: true },
    );
    const file = await fabric.remember({ kind: "file", path: "src/index.ts" });
    await fabric.remember({ kind: "working", block: "plan", content: "working text" });

    const content = (await coreBlock(projection))!.content;
    assert.ok(content.includes(kept.id));
    for (const excluded of [candidate, archived, revoked, file]) {
      assert.ok(!content.includes(excluded.id), `${excluded.kind} note ${excluded.id} must not enter the core`);
    }
    assert.doesNotMatch(content, /flagged fact|working text/);
  });

  it("core_md_human_edit_is_overwritten_and_logged", async () => {
    const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
    const root = await mkdtemp(join(tmpdir(), "prism-core-"));
    tempDirs.push(root);
    const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
    try {
      const made = harness({
        vectorStore: stores.vectorStore,
        workingStore: stores.workingStore,
        writeFile: (scope, body) => stores.writeDerivedFile(scope, "core.md", body),
      });
      await made.fabric.remember({ kind: "fact", content: "deploys run on fridays" });
      assert.match((await coreBlock(made.projection))!.content, /deploys run on fridays/);
      const file = join(root, "notes", PROJECT_DIRECTORY, "core.md");
      assert.match(await readFile(file, "utf8"), /deploys run on fridays/, "the markdown store writes the derived core");

      await writeFile(file, "my own core notes\n");
      await made.fabric.remember({ kind: "fact", content: "billing uses stripe" });
      made.projection.refresh();
      assert.match((await coreBlock(made.projection))!.content, /billing uses stripe/);
      const rewritten = await readFile(file, "utf8");
      assert.match(rewritten, /billing uses stripe/);
      assert.doesNotMatch(rewritten, /my own core notes/, "a human edit is overwritten");
      const logPath = join(root, "notes", "log.md");
      const log = await readFile(logPath, "utf8");
      assert.match(log, /\*\*overwritten\*\*: core\.md/);
      assert.match(log, /pinned: true/);

      // Our own next write is not a human edit: the marker hashes its own body.
      await made.fabric.remember({ kind: "fact", content: "third fact" });
      await coreBlock(made.projection);
      assert.equal(((await readFile(logPath, "utf8")).match(/\*\*overwritten\*\*/g) ?? []).length, 1, "one log line, not one per rebuild");
    } finally {
      await stores.close();
    }
  });

  it("core_splits_the_budget_and_lets_unused_budget_flow", async () => {
    const { fabric, projection } = harness({ core: { maxTokens: 100 } });
    await fabric.remember({ kind: "fact", content: "u", scope: "user" });
    const projectNotes: { readonly id: string }[] = [];
    for (const text of ["p".repeat(60), "q".repeat(60), "r".repeat(60)])
      projectNotes.push(await fabric.remember({ kind: "fact", content: text }));
    const block = await coreBlock(projection);
    assert.ok((block!.metadata!.tokens as number) <= 100, "the rendered block stays inside maxTokens");
    // The project half alone (50) fits two of the three notes; the user scope used a few tokens of its
    // half, and that remainder flows to the project scope.
    for (const note of projectNotes) assert.ok(block!.content.includes(note.id), `project note ${note.id} took the flowing budget`);
  });

  it("core_false_makes_no_computation", async () => {
    const { fabric, projection, scans } = harness({ core: false });
    await fabric.remember({ kind: "fact", content: "anything" });
    assert.equal(await coreBlock(projection), undefined);
    assert.equal(scans(), 0, "core: false runs no scan");
    assert.equal(resolveFabricCoreOptions(false, true), false);
    assert.deepEqual(resolveFabricCoreOptions(undefined, true), { maxTokens: 600, scopes: ["user", "project"] });
    assert.deepEqual(resolveFabricCoreOptions({ scopes: ["project"] }, true), { maxTokens: 600, scopes: ["project"] });
    assert.throws(() => resolveFabricCoreOptions({ maxTokens: 1_001 }, true), /core\.maxTokens/);
    assert.throws(() => resolveFabricCoreOptions({ scopes: [] }, true), /core\.scopes/);
  });
});
