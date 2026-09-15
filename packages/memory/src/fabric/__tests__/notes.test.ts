import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionEntry, type SessionEntry } from "@arnilo/prism";
import {
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_CLOSED,
  WORK_SCOPE_OPENED,
} from "../../compaction/observational-memory/index.js";
import { MemoryValidationError } from "../../errors.js";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { createMemoryFabric, MEMORY_FABRIC_WORKING_KEY, parseMemoryNoteMetadata } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };

function makeMemory() {
  const vectors = createMemoryVectorStore();
  const working = createMemoryWorkingStore();
  const memory = createMemory({ ...scope, embedder: createHashEmbedder(), vectorStore: vectors, workingStore: working });
  return { memory, vectors, working };
}

const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "User prefers shortest path.",
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

function scopedEntries(closed: boolean): readonly SessionEntry[] {
  const base = { sessionId: "s1", timestamp: observation.timestamp, kind: "custom" as const };
  return [
    createSessionEntry({ id: "m1", ...base, data: { type: OBSERVATIONS_RECORDED, observations: [observation] } }),
    createSessionEntry({ id: "m2", ...base, data: { type: REFLECTIONS_RECORDED, reflections: [reflection] } }),
    createSessionEntry({ id: "sc1", ...base, data: { type: WORK_SCOPE_OPENED, id: "task:1" } }),
    createSessionEntry({ id: "sc2", ...base, data: { type: WORK_SCOPE_BOUND, scopeId: "task:1", refs: [`reflection:${reflection.id}`] } }),
    ...(closed ? [createSessionEntry({ id: "sc3", ...base, data: { type: WORK_SCOPE_CLOSED, scopeId: "task:1" } })] : []),
  ];
}

describe("memory fabric notes", () => {
  it("round-trips a fact note through the existing vector store", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createMemoryFabric({ memory });

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
    const fabric = createMemoryFabric({ memory });
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
    const fabric = createMemoryFabric({ memory });
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
    const fabric = createMemoryFabric({ memory });

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
    const fabric = createMemoryFabric({ memory });
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

  it("promotes a reflection bound to a closed work scope into a fact or procedure note", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => scopedEntries(true) } } });

    const note = await fabric.remember({ kind: "procedure", reflectionId: reflection.id, tags: ["promoted"] });
    assert.equal(note.kind, "procedure");
    assert.equal(note.content, reflection.content);
    assert.deepEqual(note.promotedFrom, { reflectionId: reflection.id, scopeId: "task:1" });
    assert.deepEqual(note.tags, ["promoted"]);
    assert.equal(note.ingestedAt.length > 0, true);
    assert.equal((await vectors.getByThread(scope)).length, 1);
    const { hits } = await fabric.recall(reflection.content, { kinds: ["procedure"] });
    assert.deepEqual(
      hits.map((hit) => hit.id),
      [note.id],
    );
    assert.deepEqual(hits[0]?.promotedFrom, { reflectionId: reflection.id, scopeId: "task:1" });

    const asFact = await fabric.remember({ kind: "fact", reflectionId: reflection.id });
    assert.equal(asFact.kind, "fact");
    assert.equal(asFact.id === note.id, false);
  });

  it("fails closed when a reflection is unknown, unbound, bound to an open scope, or the source is missing", async () => {
    const { memory, vectors } = makeMemory();
    await assert.rejects(createMemoryFabric({ memory }).remember({ kind: "fact", reflectionId: reflection.id }), MemoryValidationError);
    const open = createMemoryFabric({ memory, observational: { session: { entries: async () => scopedEntries(false) } } });
    await assert.rejects(open.remember({ kind: "fact", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(open.remember({ kind: "fact", reflectionId: "c".repeat(12) }), MemoryValidationError);
    const closed = createMemoryFabric({ memory, observational: { session: { entries: async () => scopedEntries(true) } } });
    await assert.rejects(closed.remember({ kind: "fact", reflectionId: reflection.id, content: "copied" }), MemoryValidationError);
    await assert.rejects(closed.remember({ kind: "episode", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(closed.remember({ kind: "file", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(closed.remember({ kind: "fact", reflectionId: "ZZZZ" }), MemoryValidationError);
    assert.equal((await vectors.getByThread(scope)).length, 0);
  });

  it("stores working notes as labeled blocks in the working store", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const note = await fabric.remember({ kind: "working", block: "core", content: "Prefers terse output" });
    const value = (await memory.getWorking())?.value as Record<string, unknown>;
    const blocks = (value?.[MEMORY_FABRIC_WORKING_KEY] as { blocks?: Record<string, { id: string; content: string }> } | undefined)?.blocks;
    assert.equal(blocks?.core?.content, "Prefers terse output");
    assert.equal(blocks?.core?.id, note.id);
    assert.equal(note.block, "core");
    assert.equal(note.ingestedAt, (await memory.getWorking())?.updatedAt);
    assert.equal((await vectors.getByThread(scope)).length, 0);
    assert.deepEqual((await fabric.recall("Prefers terse output")).hits, []);

    await assert.rejects(fabric.remember({ kind: "working", block: "CORE", content: "x" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "working", block: "core" }), MemoryValidationError);
    await assert.rejects(
      fabric.remember({ kind: "working", block: "core", content: "x".repeat(memory.limits.maxEntryTextChars + 1) }),
      MemoryValidationError,
    );
  });

  it("stores file notes as metadata plus path and defaults content to the path", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });
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

  it("derives episode notes from observational memory without writing a row", async () => {
    const { memory, vectors } = makeMemory();
    await assert.rejects(createMemoryFabric({ memory }).remember({ kind: "episode", id: observation.id }), MemoryValidationError);

    const entry: SessionEntry = {
      id: "m1",
      sessionId: "s1",
      timestamp: observation.timestamp,
      kind: "message",
      data: { type: OBSERVATIONS_RECORDED, observations: [observation] },
    };
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => [entry] } } });
    const note = await fabric.remember({ kind: "episode", id: observation.id });
    assert.equal(note.kind, "episode");
    assert.equal(note.content, observation.content);
    assert.equal(note.ingestedAt, observation.timestamp);
    assert.deepEqual(note.sourceEntryIds, ["m1"]);
    assert.equal((await vectors.getByThread(scope)).length, 0);
    assert.deepEqual((await memory.recall("shortest path")).hits, []);

    await assert.rejects(fabric.remember({ kind: "episode", id: "b".repeat(12) }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "episode", id: observation.id, content: "copied" }), MemoryValidationError);
    await assert.rejects(fabric.remember({ kind: "episode" }), MemoryValidationError);
  });

  it("starts nothing on create and stays out of the root entrypoint", async () => {
    const { memory, vectors, working } = makeMemory();
    const fabric = createMemoryFabric({ memory });
    assert.deepEqual(Object.keys(fabric).sort(), [
      "attach",
      "createContextProvider",
      "forget",
      "recall",
      "remember",
      "searchConversation",
      "tools",
    ]);
    assert.equal((await vectors.getByThread(scope)).length, 0);
    assert.equal(await working.get(scope), undefined);
    const root = (await import("../../index.js")) as Record<string, unknown>;
    assert.equal("createMemoryFabric" in root, false);
  });
});
