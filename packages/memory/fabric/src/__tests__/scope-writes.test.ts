import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@arnilo/prism";
import {
  createHashEmbedder,
  createMemoryVectorStore,
  type Memory,
  MemoryScopeError,
  MemoryValidationError,
} from "@arnilo/prism-memory-core";
import { createMarkdownMemoryStores, type MarkdownMemoryStores } from "@arnilo/prism-memory-core/fabric";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, type MemoryFabricScopeBinding } from "../index.js";

const dirs: string[] = [];
const stores: MarkdownMemoryStores[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = "projects/demo--01234567";

function memoryFor(resourceId: string, vectorStore = createMemoryVectorStore(), workingStore = createMemoryWorkingStore()): Memory {
  return createMemory({
    tenantId: "prism",
    resourceId,
    threadId: "default",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore,
    workingStore,
  });
}

function fabricOver(bindings: readonly MemoryFabricScopeBinding[]) {
  return createMemoryFabric({ memory: bindings[0]!.memory, scopes: bindings });
}

describe("fabric scope-aware writes (plan 188.2 Task 3)", () => {
  it("preference_defaults_to_user_scope_and_preferences_dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "fabric-scope-writes-"));
    dirs.push(root);
    const store = await createMarkdownMemoryStores({ root });
    stores.push(store);
    const user = createMemory({
      tenantId: "prism",
      resourceId: "user",
      threadId: "default",
      vectorStore: store.vectorStore,
      workingStore: store.workingStore,
    });
    const project = createMemory({
      tenantId: "prism",
      resourceId: PROJECT,
      threadId: "default",
      vectorStore: store.vectorStore,
      workingStore: store.workingStore,
    });
    const fabric = fabricOver([
      { level: "project", memory: project },
      { level: "user", memory: user },
    ]);

    const note = await fabric.remember({ kind: "preference", content: "Prefer pnpm over npm." });
    assert.equal(note.level, "user");
    assert.equal(note.scope?.resourceId, "user");
    const dir = join(root, "prism", "user", "preferences");
    assert.ok(existsSync(dir), `missing ${dir}`);
    assert.equal(readdirSync(dir).filter((name) => name.endsWith(".md")).length, 1);
    assert.equal((await user.recall("pnpm")).hits.length, 1);
  });

  it("path_scope_requires_applies_to_and_rejects_traversal_globs", async () => {
    const project = memoryFor(PROJECT);
    const fabric = fabricOver([{ level: "project", memory: project }]);

    await assert.rejects(fabric.remember({ kind: "procedure", scope: "path", content: "Run it." }), MemoryValidationError);
    for (const glob of ["../secret/**", "/etc/**", "~/x/**", "C:/x/**", "packages\\memory\\**", "a/\0b"]) {
      await assert.rejects(
        fabric.remember({ kind: "procedure", scope: "path", appliesTo: [glob], content: "Run it." }),
        MemoryValidationError,
        glob,
      );
    }
    await assert.rejects(
      fabric.remember({ kind: "procedure", scope: "path", appliesTo: Array(9).fill("src/**"), content: "Run it." }),
      MemoryValidationError,
    );
    await assert.rejects(fabric.remember({ kind: "fact", content: "x", key: "Bad Key" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "fact", content: "x", scope: "project", appliesTo: ["src/**"] }), MemoryValidationError);

    const note = await fabric.remember({
      kind: "procedure",
      scope: "path",
      appliesTo: ["packages/memory/**"],
      key: "memory.tests",
      content: "Run memory suites with --timeout=0.",
    });
    assert.equal(note.level, "path");
    assert.deepEqual(note.appliesTo, ["packages/memory/**"]);
    assert.equal(note.key, "memory.tests");
    assert.equal(note.scope?.resourceId, PROJECT);
    assert.ok(await project.getEntry(note.id));
  });

  it("write_to_disabled_scope_fails", async () => {
    const project = memoryFor(PROJECT);
    const fabric = fabricOver([{ level: "project", memory: project }]);

    await assert.rejects(fabric.remember({ kind: "preference", content: "Prefer tabs." }), /scope user is not active/);
    await assert.rejects(fabric.remember({ kind: "fact", scope: "agent", content: "Tabs win." }), /scope agent is not active/);
  });

  it("replace_and_forget_find_note_in_any_active_scope", async () => {
    const project = memoryFor(PROJECT);
    const user = memoryFor("user");
    const fabric = fabricOver([
      { level: "project", memory: project },
      { level: "user", memory: user },
    ]);
    const note = await fabric.remember({ kind: "preference", content: "Prefer pnpm." });
    const replace = fabric.tools().find((tool) => tool.name === "memory.replace")!;
    const context = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
    const result = await replace.execute({ id: note.id, old: "pnpm", new: "yarn" }, context);
    assert.equal(result.error, undefined);
    assert.match((await user.getEntry(note.id))!.text, /yarn/);

    const forgotten = await fabric.forget({ id: note.id });
    assert.equal(forgotten.deleted, 1);
    assert.equal(await user.getEntry(note.id), undefined);
    assert.equal(await project.getEntry(note.id), undefined);
  });

  it("cross_scope_supersede_is_refused", async () => {
    const project = memoryFor(PROJECT);
    const user = memoryFor("user");
    const fabric = fabricOver([
      { level: "project", memory: project },
      { level: "user", memory: user },
    ]);
    const preference = await fabric.remember({ kind: "preference", content: "Prefer pnpm." });
    await assert.rejects(
      fabric.remember({ kind: "fact", content: "This project uses pnpm.", supersedes: preference.id }),
      MemoryScopeError,
    );
  });

  it("project_writes_still_carry_the_project_level_and_key", async () => {
    const project = memoryFor(PROJECT);
    const fabric = fabricOver([{ level: "project", memory: project }]);
    const note = await fabric.remember({ kind: "fact", content: "Deploys go through CI.", key: "deploy.path" });
    assert.equal(note.level, "project");
    assert.equal(note.key, "deploy.path");
    const row = await project.getEntry(note.id);
    const fabricMetadata = (row?.metadata as JsonObject | undefined)?.fabric as JsonObject | undefined;
    assert.equal(fabricMetadata?.scope, "project");
    assert.equal(fabricMetadata?.key, "deploy.path");
  });
});

describe("agent scope is not writable by the model tools (plan 188.7 Task 4, plan 210 Task 7)", () => {
  it("foreign_project_fact_never_enters_other_project_context_via_confirmed_leak_path", async () => {
    const project = memoryFor(PROJECT);
    const agent = memoryFor("agent");
    const fabric = fabricOver([
      { level: "project", memory: project },
      { level: "agent", memory: agent },
    ]);
    const insert = fabric.tools().find((tool) => tool.name === "memory.insert")!;
    const context = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
    const wider = await insert.execute({ kind: "fact", scope: "agent", key: "deploy.region", text: "alpha region = eu-west" }, context);
    assert.match(String(wider.error?.message), /not writable/);
    assert.equal((await agent.recall("eu-west", { topK: 5 })).hits.length, 0, "no agent note was written");

    const local = await insert.execute({ kind: "fact", scope: "project", key: "deploy.region", text: "alpha region = eu-west" }, context);
    assert.equal(local.error, undefined);
    assert.equal((await project.recall("eu-west", { topK: 5 })).hits.length, 1, "the project note is stored");
    assert.equal((await agent.recall("eu-west", { topK: 5 })).hits.length, 0, "it is not visible above the project");

    // The confirmed leak route is a write into the shared agent scope: it is visible to every project.
    // A trusted host may still seed a genuinely general note; a model tool no longer can.
    const host = await fabric.remember({ kind: "procedure", scope: "agent", content: "Flush the queue before retrying" });
    assert.equal(host.level, "agent");
    assert.equal((await agent.recall("flush the queue", { topK: 5 })).hits.length, 1);
  });
});
