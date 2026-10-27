import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "bun:test";
import { createSessionEntry, type SessionEntry } from "@arnilo/prism";
import {
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "@arnilo/prism-memory-observational";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, parseMemoryNoteMetadata } from "../index.js";
import { MEMORY_FABRIC_WORKING_KEY } from "../types.js";

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
  const state = (value: unknown) => ({ schemaVersion: 1, package: "arnilo:prism-memory-observational", key: "ledger", op: "append", value });
  return [
    createSessionEntry({ id: "m1", ...base, data: state({ type: OBSERVATIONS_RECORDED, observations: [observation] }) }),
    createSessionEntry({ id: "m2", ...base, data: state({ type: REFLECTIONS_RECORDED, reflections: [reflection] }) }),
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

  it("promotes a ledger reflection into a fact or procedure note", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => ledgerEntries() } } });

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

  it("promotes an observation and a reflection the package kept in its session log", async () => {
    const { memory, vectors } = makeMemory();
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => packageLogEntries() } } });

    const episode = await fabric.remember({ kind: "episode", id: observation.id });
    assert.equal(episode.kind, "episode");
    assert.equal(episode.content, observation.content);
    assert.deepEqual(episode.sourceEntryIds, observation.sourceEntryIds);

    const note = await fabric.remember({ kind: "procedure", reflectionId: reflection.id });
    assert.equal(note.content, reflection.content);
    assert.deepEqual(note.promotedFrom, { reflectionId: reflection.id });
    // The episode is a view over the ledger, so only the promoted note writes a row.
    assert.equal((await vectors.getByThread(scope)).length, 1);
  });

  it("fails closed when a reflection is unknown or the source is missing", async () => {
    const { memory, vectors } = makeMemory();
    await assert.rejects(createMemoryFabric({ memory }).remember({ kind: "fact", reflectionId: reflection.id }), MemoryValidationError);
    const attached = createMemoryFabric({ memory, observational: { session: { entries: async () => ledgerEntries() } } });
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: "c".repeat(12) }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: reflection.id, content: "copied" }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "episode", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "file", reflectionId: reflection.id }), MemoryValidationError);
    await assert.rejects(attached.remember({ kind: "fact", reflectionId: "ZZZZ" }), MemoryValidationError);
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

  it("starts nothing on create and stays out of the family root entrypoint", async () => {
    const { memory, vectors, working } = makeMemory();
    const fabric = createMemoryFabric({ memory });
    assert.deepEqual(
      Object.keys(fabric).sort(),
      ["consolidate", "forget", "maintain", "pin", "recall", "recordUses", "registerContextBuild", "remember", "searchConversation", "tools", "verify"].sort(),
    );
    assert.equal((await vectors.getByThread(scope)).length, 0);
    assert.equal(await working.get(scope), undefined);
    // The family workspace is deleted (plan 158 Task 6), so the fabric/scoped subpaths and the
    // createMemory exports left with it — there is no root entrypoint left to leak into.
    assert.equal(
      existsSync(new URL("../../../package.json", import.meta.url)),
      false,
      "the @arnilo/prism-memory family manifest must stay deleted",
    );
  });
});
