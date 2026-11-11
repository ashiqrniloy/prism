import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createSessionEntry, type SessionEntry } from "@arnilo/prism";
import { type MemoryObservation, type MemoryReflection, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "@arnilo/prism-memory-system";
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { createMemory, createLongTermMemory, parseMemoryNoteMetadata } from "../../index.js";
import { MEMORY_NOTE_KINDS } from "../types.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };

function makeMemory() {
  const vectors = createMemoryVectorStore();
  const memory = createMemory({ ...scope, embedder: createHashEmbedder(), vectorStore: vectors });
  return { memory, vectors };
}

const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "statement",
  description: "User prefers shortest path.",
  timestamp: "2026-06-20T00:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 5,
};

const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Prefer the smallest retry budget",
  supportingObservationIds: [observation.id],
  tokenCount: 7,
};

function ledgerEntries(): readonly SessionEntry[] {
  const base = { sessionId: "s1", timestamp: observation.timestamp, kind: "custom" as const };
  return [
    createSessionEntry({ id: "m1", ...base, data: { type: OBSERVATIONS_RECORDED, observations: [observation] } }),
    createSessionEntry({ id: "m2", ...base, data: { type: REFLECTIONS_RECORDED, reflections: [reflection] } }),
  ];
}

/**
 * The same ledger as the package writes it: `state.log` keeps each record as one `package_state`
 * entry whose payload is `data.value` (plan 157 Task 2). A branch-only consumer must read it.
 */
function packageLogEntries(): readonly SessionEntry[] {
  const base = { sessionId: "s1", timestamp: observation.timestamp, kind: "package_state" as const };
  const state = (value: unknown) => ({
    schemaVersion: 1,
    package: "arnilo:prism-memory-system",
    key: "memory.session.ledger",
    op: "append",
    value,
  });
  return [
    createSessionEntry({ id: "m1", ...base, data: state({ type: OBSERVATIONS_RECORDED, observations: [observation] }) }),
    createSessionEntry({ id: "m2", ...base, data: state({ type: REFLECTIONS_RECORDED, reflections: [reflection] }) }),
  ];
}

describe("memory fabric notes", () => {
  it("round-trips a fact note through the existing vector store", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory });

    const note = await fabric.remember({ kind: "fact", content: "User prefers metric units", tags: ["prefs"] });
    assert.match(note.id, /^[a-f0-9]{12}$/);
    assert.equal(note.kind, "fact");
    assert.equal(note.tokenCount, Math.ceil("User prefers metric units".length / 4));

    const { hits } = await fabric.recall("User prefers metric units");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, note.id);
    assert.equal(hits[0]?.kind, "fact");
    assert.deepEqual(hits[0]?.tags, ["prefs"]);
    assert.equal(hits[0]?.scope?.tenantId, "t1");
    assert.ok((hits[0]?.score ?? 0) > 0);
    assert.equal((await vectors.getByThread(scope)).length, 1);
  });

  it("keeps procedure notes out of default recall", async () => {
    const { memory } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    const fact = await fabric.remember({ kind: "fact", content: "Deploy via canary" });
    const procedure = await fabric.remember({ kind: "procedure", content: "Deploy via canary" });

    assert.deepEqual(
      (await fabric.recall("Deploy via canary")).hits.map((hit) => hit.id),
      [fact.id],
    );
    assert.deepEqual(
      (await fabric.recall("Deploy via canary", { kinds: ["procedure"] })).hits.map((hit) => hit.id),
      [procedure.id],
    );
    assert.deepEqual(
      (await fabric.recall("Deploy via canary", { kinds: ["fact", "procedure"] })).hits.map((hit) => hit.id).sort(),
      [fact.id, procedure.id].sort(),
    );
  });

  it("filters validity windows against asOf", async () => {
    const { memory } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    const past = await fabric.remember({
      kind: "fact",
      content: "Office is in Berlin",
      validFrom: "2020-01-01T00:00:00.000Z",
      validTo: "2021-01-01T00:00:00.000Z",
    });
    const current = await fabric.remember({ kind: "fact", content: "Office is in Berlin", validFrom: "2026-01-01T00:00:00.000Z" });

    assert.deepEqual(
      (await fabric.recall("Office is in Berlin")).hits.map((hit) => hit.id),
      [current.id],
    );
    assert.deepEqual(
      (await fabric.recall("Office is in Berlin", { asOf: "2020-06-01T00:00:00.000Z" })).hits.map((hit) => hit.id),
      [past.id],
    );
    assert.deepEqual((await fabric.recall("Office is in Berlin", { asOf: new Date("2019-01-01T00:00:00.000Z") })).hits, []);
  });

  it("fails closed on unknown kind, bad id, missing content, and bad asOf", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory });

    await assert.rejects(fabric.remember({ kind: "opinion" as never, content: "x" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "fact", content: "x", id: "ZZZZ" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "fact" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "fact", content: "x", validTo: "not-a-date" }), MemoryValidationError);
    await assert.rejects(fabric.recall("x", { kinds: ["opinion" as never] }), MemoryValidationError);
    await assert.rejects(fabric.recall("x", { kinds: [] }), MemoryValidationError);
    await assert.rejects(fabric.recall("x", { asOf: "not-a-date" }), MemoryValidationError);
    assert.equal((await vectors.getByThread(scope)).length, 0);
  });

  it("admits only well-formed fabric notes into recall", async () => {
    const { memory } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    await memory.remember(
      {
        entries: [
          { id: "a".repeat(12), text: "Deploy via canary", metadata: {} },
          { id: "b".repeat(12), text: "Deploy via canary", metadata: { fabric: { v: 1, kind: "nonsense" } } },
          { id: "c".repeat(12), text: "Deploy via canary", metadata: { fabric: { v: 1, kind: "fact", validFrom: "nope" } } },
        ],
      },
      { wait: true },
    );
    assert.deepEqual((await fabric.recall("Deploy via canary")).hits, []);
    assert.equal((await memory.recall("Deploy via canary")).hits.length, 3);
    assert.equal(parseMemoryNoteMetadata(undefined), undefined);
    assert.deepEqual(parseMemoryNoteMetadata({ fabric: { v: 1, kind: "fact" } }), { v: 1, kind: "fact" });
  });

  it("promotes a ledger reflection into a fact or procedure note", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory, observational: { session: { entries: async () => ledgerEntries() } } });

    const note = await fabric.remember({ kind: "procedure", reflectionId: reflection.id, tags: ["promoted"] });
    assert.equal(note.kind, "procedure");
    assert.equal(note.content, reflection.content);
    assert.deepEqual(note.promotedFrom, { reflectionId: reflection.id });
    assert.deepEqual(note.tags, ["promoted"]);
    assert.equal(note.ingestedAt.length > 0, true);
    assert.equal((await vectors.getByThread(scope)).length, 1);
    const { hits } = await fabric.recall(reflection.content, { kinds: ["procedure"] });
    assert.deepEqual(
      hits.map((hit) => hit.id),
      [note.id],
    );
    assert.deepEqual(hits[0]?.promotedFrom, { reflectionId: reflection.id });

    const asFact = await fabric.remember({ kind: "fact", reflectionId: reflection.id });
    assert.equal(asFact.kind, "fact");
    assert.equal(asFact.id === note.id, false);
  });

  it("promotes a reflection the package kept in its session log", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory, observational: { session: { entries: async () => packageLogEntries() } } });

    const note = await fabric.remember({ kind: "procedure", reflectionId: reflection.id });
    assert.equal(note.content, reflection.content);
    assert.deepEqual(note.promotedFrom, { reflectionId: reflection.id });
    assert.equal((await vectors.getByThread(scope)).length, 1);
  });

  it("fails closed when a reflection is unknown or the source is missing", async () => {
    const { memory, vectors } = makeMemory();
    await assert.rejects(createLongTermMemory({ memory }).remember({ kind: "fact", reflectionId: reflection.id }), MemoryValidationError);
    const attached = createLongTermMemory({ memory, observational: { session: { entries: async () => ledgerEntries() } } });
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: "c".repeat(12) }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: reflection.id, content: "copied" }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "episode", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "file", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: "ZZZZ" }), MemoryValidationError);
    assert.equal((await vectors.getByThread(scope)).length, 0);
  });

  it("working_kind_and_store_absent", async () => {
    // Plan 216 Task 7: working memory left long-term memory; the WM component owns the name now.
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    assert.equal((MEMORY_NOTE_KINDS as readonly string[]).includes("working"), false);
    for (const member of ["getWorking", "updateWorking", "deleteWorking", "renderWorking", "createWorkingMemoryProcessor"]) {
      assert.equal(member in memory, false, `Memory.${member} is gone`);
    }
    const failure = await fabric.remember({ kind: "working" as never, content: "Prefers terse output" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof MemoryValidationError);
    assert.equal(failure.code, "working_memory_retired");
    assert.equal((await vectors.getByThread(scope)).length, 0);
    const system = await import("../../index.js");
    for (const name of ["createMemoryWorkingStore", "MEMORY_FABRIC_WORKING_KEY", "readFabricBlock", "FABRIC_BLOCK_LABEL"]) {
      assert.equal(name in system, false, `${name} is not exported`);
    }
    const core = await import("@arnilo/prism-memory-system/core");
    assert.equal("renderTemplate" in core, false);
  });

  it("stores file notes as metadata plus path and defaults content to the path", async () => {
    const { memory } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    const note = await fabric.remember({ kind: "file", path: "notes/roadmap.md", tags: ["plan"] });
    assert.equal(note.content, "notes/roadmap.md");
    assert.equal(note.path, "notes/roadmap.md");
    const { hits } = await fabric.recall("notes/roadmap.md");
    assert.equal(hits[0]?.kind, "file");
    assert.equal(hits[0]?.path, "notes/roadmap.md");
    assert.deepEqual(hits[0]?.tags, ["plan"]);

    await assert.rejects(fabric.remember({ kind: "file", path: "" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "file", path: "a\0b" }), MemoryValidationError);
  });

  it("episode_view_and_merge_absent_and_kind_reserved", async () => {
    // Plan 216 Task 7: the episode view over observational-memory ids and episode merging are gone; the kind name
    // stays reserved for plan 219's stored episode, and writing it fails with a named error until then.
    const { memory, vectors } = makeMemory();
    const entry: SessionEntry = {
      id: "m1",
      sessionId: "s1",
      timestamp: observation.timestamp,
      kind: "message",
      data: { type: OBSERVATIONS_RECORDED, observations: [observation] },
    };
    const fabric = createLongTermMemory({ memory, observational: { session: { entries: async () => [entry] } } });
    assert.ok((MEMORY_NOTE_KINDS as readonly string[]).includes("episode"), "the kind name stays reserved");
    for (const input of [
      { kind: "episode", id: observation.id },
      { kind: "episode", content: "a day" },
    ] as const) {
      const failure = await fabric.remember(input).then(
        () => undefined,
        (error: unknown) => error,
      );
      assert.ok(failure instanceof MemoryValidationError);
      assert.equal(failure.code, "episode_kind_not_available");
    }
    assert.equal((await vectors.getByThread(scope)).length, 0);
    const lifecycle = await import("../lifecycle/index.js");
    for (const name of [
      "episodeClusters",
      "summarizeEpisodeCluster",
      "EPISODE_MERGE_TOOL",
      "EPISODE_MERGE_SYSTEM",
      "MAX_EPISODE_CLUSTER",
    ]) {
      assert.equal(name in lifecycle, false, `${name} is gone`);
    }
    const report = await createLongTermMemory({ memory, vectorStore: vectors }).maintain();
    assert.equal("episodesMerged" in report, false);
  });

  it("starts nothing on create and stays out of the family root entrypoint", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createLongTermMemory({ memory });
    assert.deepEqual(
      Object.keys(fabric).sort(),
      [
        "consolidate",
        "forget",
        "maintain",
        "pin",
        "recall",
        "recordUses",
        "registerContextBuild",
        "remember",
        "searchConversation",
        "tools",
        "verify",
      ].sort(),
    );
    assert.equal((await vectors.getByThread(scope)).length, 0);
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
    assert.equal(manifest.name, "@arnilo/prism-memory-system");
    assert.equal(manifest.exports["."], "./system/src/index.ts");
    assert.equal(manifest.exports["./fabric"], undefined, "the retired family subpath stays absent");
  });
});
