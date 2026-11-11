import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  type JsonObject,
  type ProviderRequest,
  type SessionEntry,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { createHashEmbedder, createMemoryVectorStore, type Memory, MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { resolveMemoryFabricConfig } from "../config.js";
import { exchangePairs } from "../exchanges.js";
import memorySystem, { createMemory, createLongTermMemory } from "../../index.js";
import { EVIDENCE_RELATION, LessonRequiresEvidenceError, lessonNudgeLine, lessonSignal } from "../lessons.js";
import { DEFAULT_ARCHIVE_CONFIG, shouldArchive } from "../lifecycle/archive.js";
import { SCOPE_CLOCK_COUNTER } from "../lifecycle/clock.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { parseMemoryNoteMetadata } from "../types.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-fabric-lessons-"));
  dirs.push(dir);
  return dir;
}

function memoryFor(resourceId: string, vectorStore = createMemoryVectorStore()): Memory {
  return createMemory({
    tenantId: "prism",
    resourceId,
    threadId: "default",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore,
  });
}

/** A project and a user scope over one store, the way the package binds them. */
function scoped(clock: { value: number } = { value: 0 }) {
  const store = createMemoryVectorStore();
  const project = memoryFor("projects/demo--01234567", store);
  const user = memoryFor("user", store);
  const fabric = createLongTermMemory({
    memory: project,
    scopes: [
      { level: "project", memory: project },
      { level: "user", memory: user },
    ],
    consolidate: false,
    vectorStore: store,
    clock: () => clock.value,
    lifecycle: resolveMemoryFabricConfig({}).lifecycle,
  });
  const tools = fabric.tools({});
  const insert = tools.find((tool) => tool.name === "memory.insert")!;
  const context: ToolExecutionContext = { sessionId: "s1", runId: "r1", toolCallId: "c1" };
  return {
    fabric,
    project,
    user,
    store,
    clock,
    insert: async (args: Record<string, unknown>): Promise<ToolResult> => await insert.execute(args as JsonObject, context),
  };
}

const reason = (result: ToolResult) => (result.value as { reason?: string } | undefined)?.reason;
const noteId = (result: ToolResult) => (result.value as { id: string }).id;

async function metadataOf(memory: Memory, id: string) {
  const row = await memory.getEntry(id);
  assert.ok(row, `note ${id} exists`);
  return { metadata: parseMemoryNoteMetadata(row.metadata)!, status: row.metadata?.status };
}

describe("cited lessons (plan 209 Task 4)", () => {
  it("insert_evidence_links_and_rejects_foreign_ids", async () => {
    const h = scoped();
    const exchange = await h.fabric.remember({ kind: "fact", content: "bun test failed with ENOENT on the sqlite file", scope: "project" });
    const preference = await h.fabric.remember({ kind: "preference", content: "terse answers", scope: "user" });

    const written = await h.insert({
      kind: "procedure",
      text: "Create the SQLite file's parent dir before running memory suites.",
      tags: ["lesson"],
      evidence: [exchange.id, preference.id],
    });
    assert.equal(written.error, undefined, "a project lesson may cite project and user notes");
    const { metadata } = await metadataOf(h.project, noteId(written));
    assert.deepEqual(
      metadata.links?.filter((link) => link.relation === EVIDENCE_RELATION).map((link) => link.id),
      [exchange.id, preference.id],
    );

    // An id no active scope holds is unreadable.
    const missing = await h.insert({ kind: "fact", text: "x happened", evidence: ["0123456789ab"] });
    assert.equal(reason(missing), "not_found");

    // A user note is read in every project, so it may not cite one project's exchange.
    const foreign = await h.insert({ kind: "fact", text: "y is true everywhere", scope: "user", evidence: [exchange.id] });
    assert.equal(reason(foreign), "not_found");

    // A note of another fabric (another project) is never readable here.
    const other = createLongTermMemory({ memory: memoryFor("projects/other--89abcdef"), consolidate: false });
    const elsewhere = await other.remember({ kind: "fact", content: "other project note" });
    assert.equal(reason(await h.insert({ kind: "fact", text: "z", evidence: [elsewhere.id] })), "not_found");

    // Shape errors stay validation errors: at most eight ids, each a 12-hex id.
    await assert.rejects(h.insert({ kind: "fact", text: "w", evidence: ["nope"] }), MemoryValidationError);
    await assert.rejects(h.insert({ kind: "fact", text: "w", evidence: Array(9).fill(exchange.id) }), MemoryValidationError);
    await assert.rejects(h.insert({ kind: "fact", text: "w", evidence: [] }), MemoryValidationError);
  });

  it("lesson_tag_requires_evidence", async () => {
    const h = scoped();
    const exchange = await h.fabric.remember({ kind: "fact", content: "the deploy needed a second try", scope: "project" });
    assert.equal(reason(await h.insert({ kind: "procedure", text: "Retry deploys once.", tags: ["lesson"] })), "lesson_requires_evidence");
    assert.equal(
      reason(await h.insert({ kind: "preference", text: "Retry deploys once.", tags: ["lesson"], evidence: [exchange.id] })),
      "lesson_requires_evidence",
      "a lesson is a procedure or a fact",
    );
    // Every writer holds the invariant, not only the tool.
    await assert.rejects(
      h.fabric.remember({ kind: "fact", content: "lesson without proof", tags: ["lesson"] }),
      LessonRequiresEvidenceError,
    );
    // An untagged note needs no evidence.
    assert.equal((await h.insert({ kind: "procedure", text: "Retry deploys once." })).error, undefined);
  });

  it("lesson_verified_by_use_and_archived_when_unused", async () => {
    const h = scoped({ value: 1 });
    const exchange = await h.fabric.remember({ kind: "fact", content: "the migration failed with ENOENT", scope: "project" });
    const lesson = noteId(
      await h.insert({ kind: "procedure", text: "Create the data dir before migrating.", tags: ["lesson"], evidence: [exchange.id] }),
    );
    const plain = noteId(await h.insert({ kind: "procedure", text: "Run migrations from the repo root." }));
    assert.equal((await metadataOf(h.project, lesson)).status, "candidate", "a lesson starts as a candidate");

    // The existing use rule: cited in a later session (twice by default) without correction verifies it.
    const lifecycle = createFabricLifecycle(h.project);
    await lifecycle.recordUses("s2", [lesson], { clock: 2 });
    assert.deepEqual(await lifecycle.recordUses("s3", [lesson], { clock: 3 }), [lesson]);
    assert.equal((await metadataOf(h.project, lesson)).status, "verified");

    // The lesson rule: unused for archiveAfterSessions (20) scope sessions since its last use, whatever its strengths.
    const archive = { ...DEFAULT_ARCHIVE_CONFIG, lessonSessions: 20 };
    const used = { kind: "procedure" as const, tags: ["lesson"], created: 1, uses: [{ s: 3, at: "2026-01-01T00:00:00.000Z" }] };
    assert.equal(shouldArchive(used, 22, { archive }), false);
    assert.equal(shouldArchive(used, 23, { archive }), true);
    assert.equal(shouldArchive({ ...used, tags: [] }, 23, { archive }), false, "an untagged note keeps the general rule");
    assert.equal(shouldArchive({ ...used, pinned: true }, 23, { archive }), false, "a pinned lesson never archives");
    assert.equal(resolveMemoryFabricConfig({}).lifecycle.archive.lessonSessions, 20);
    assert.equal(resolveMemoryFabricConfig({ lessons: { archiveAfterSessions: 5 } }).lifecycle.archive.lessonSessions, 5);

    // Through maintenance: archived from default recall, never deleted, and a citation revives it.
    h.clock.value = 23;
    for (let tick = 0; tick < 23; tick += 1)
      await h.store.scopeCounter.increment({ tenantId: "prism", resourceId: h.project.scope.resourceId, name: SCOPE_CLOCK_COUNTER });
    const report = await h.fabric.maintain();
    assert.ok(report.archived >= 1);
    assert.equal((await metadataOf(h.project, lesson)).status, "archived");
    assert.equal((await metadataOf(h.project, plain)).status, undefined, "the untagged procedure stays");
    await lifecycle.recordUses("s24", [lesson], { clock: 24 });
    assert.notEqual((await metadataOf(h.project, lesson)).status, "archived", "a later use revives it");
  });
});

const message = (id: string, role: "user" | "assistant", text: string, extra: Partial<SessionEntry> = {}): SessionEntry => ({
  id,
  sessionId: "s",
  timestamp: "2026-01-01T00:00:01.000Z",
  kind: "message",
  message: { role, content: [{ type: "text", text }] },
  ...extra,
});

describe("lesson nudge (plan 209 Task 4)", () => {
  it("lesson_signal_reads_corrections_remember_fixed_and_denials", () => {
    const base = [message("u0", "user", "set it up"), message("a0", "assistant", "done with npm")];
    const turn = (text: string, between: SessionEntry[] = []) => {
      const entries = [...base, message("u1", "user", text), ...between, message("a1", "assistant", "ok")];
      return lessonSignal(entries, exchangePairs(entries).at(-1)!);
    };
    assert.equal(turn("No, that's wrong, use pnpm"), "correction");
    assert.equal(turn("Please remember the staging host is blue"), "remember");
    assert.equal(turn("thanks, looks fine"), undefined);
    assert.equal(turn("I prefer short answers"), undefined, "only the remember cue among explicit statements");
    const denial: SessionEntry = {
      id: "e1",
      sessionId: "s",
      timestamp: "2026-01-01T00:00:01.000Z",
      kind: "event",
      event: { type: "decision.resolved", sessionId: "s", runId: "r", decisions: [{ toolCallId: "c1", outcome: "deny" }], via: "inline" },
    } as SessionEntry;
    assert.equal(turn("delete the build dir", [denial]), "denial");
    const entries = [...base, message("u1", "user", "run the tests"), message("a1", "assistant", "fixed")];
    assert.equal(lessonSignal(entries, exchangePairs(entries).at(-1)!, { fixed: true }), "fixed");
  });

  it("nudge_only_after_signal_and_rate_limited", async () => {
    const root = await tempRoot();
    const requests: ProviderRequest[] = [];
    const reply = [providerTextDelta("ok"), providerDone()];
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [
        mockProvider(
          Array.from({ length: 6 }, () => reply),
          { onRequest: (request) => requests.push(request) },
        ),
        memorySystem({ ltm: { preset: "conversational", lessons: { nudge: true, minTurnsBetweenNudges: 3 }, tools: { root } } }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    try {
      const session = await agent.session({ id: "nudge", create: true });
      for (const text of ["hello", "No, that's wrong, use pnpm", "next step", "Actually that's wrong too", "carry on", "and then"])
        await session.run(text);
      const nudged = requests.map((request) => JSON.stringify(request.messages).includes("Memory nudge"));
      // Request i follows turn i-1: only the request after the first correction carries it; the second
      // correction comes two turns later and the rate limit (3) holds it back.
      assert.deepEqual(nudged, [false, false, true, false, false, false]);
      await session.close();
    } finally {
      await agent.dispose();
    }
    // Off unless asked for, and it needs the exchange archive.
    assert.equal(resolveMemoryFabricConfig({ preset: "conversational" }).lessons.nudge, false);
    assert.throws(() => resolveMemoryFabricConfig({ lessons: { nudge: true } }), MemoryValidationError);
  });

  it("nudge_never_in_prefix_and_carries_no_note_text", async () => {
    const root = await tempRoot();
    const requests: ProviderRequest[] = [];
    const reply = [providerTextDelta("ok"), providerDone()];
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [
        mockProvider([reply, reply, reply], { onRequest: (request) => requests.push(request) }),
        memorySystem({ ltm: { preset: "conversational", lessons: { nudge: true }, tools: { root } } }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    try {
      const session = await agent.session({ id: "prefix", create: true });
      await session.run("deploy with the zebra script");
      await session.run("No, that's wrong, the zebra script is retired");
      await session.run("go on");
      const request = requests[2]!;
      assert.doesNotMatch(JSON.stringify(request.context ?? []), /Memory nudge|lesson/, "never in the prefix");
      const tail = request.messages.at(-1)!;
      assert.ok(Array.isArray(tail.metadata?.contextBlocks), "the nudge rides the tail after the whole transcript");
      const text = tail.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      const id = /evidence: \["([a-f0-9]{12})"\]/.exec(text)?.[1];
      assert.ok(id, "the line names the exchange id");
      assert.ok(text.includes(lessonNudgeLine("correction", id!)), "fixed text and the id only");
      assert.doesNotMatch(text, /zebra/, "no note or turn text");
      assert.equal(
        request.messages.filter((m) => JSON.stringify(m).includes("Memory nudge")).length,
        1,
        "exactly one nudge, only in the tail",
      );
      await session.close();
    } finally {
      await agent.dispose();
    }
  });
});
