import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryValidationError } from "../../errors.js";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { createMemoryFabric, DEFAULT_CONSOLIDATION_THRESHOLD, parseMemoryNoteMetadata } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };

function makeMemory() {
  const vectors = createMemoryVectorStore();
  const working = createMemoryWorkingStore();
  const memory = createMemory({ ...scope, embedder: createHashEmbedder(), vectorStore: vectors, workingStore: working });
  return { memory, vectors, working };
}

/** The opt-in workers only run for an attached session; these tests attach a stand-in. */
const session = { id: "s1" };

/** Raw rows for a query, including superseded and non-fabric rows the fabric recall would hide. */
async function rawRows(memory: ReturnType<typeof makeMemory>["memory"], query: string) {
  return (await memory.recall(query, { topK: 20 })).hits;
}

describe("memory fabric consolidation", () => {
  it("folds an identical note in place instead of duplicating it", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const first = await fabric.remember({ kind: "fact", content: "User prefers metric units", keywords: ["units"] });
    const second = await fabric.remember({ kind: "fact", content: "User prefers metric units", keywords: ["prefs"], tags: ["ui"] });

    assert.equal(second.id, first.id);
    assert.equal(second.keywords?.join(","), "units,prefs");
    assert.equal(second.tags?.join(","), "ui");
    assert.equal((await rawRows(memory, "User prefers metric units")).length, 1);
    assert.equal((await fabric.recall("User prefers metric units")).hits.length, 1);
  });

  it("supersedes a changed fact: old row gets validTo, new row carries supersedes", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const first = await fabric.remember({ kind: "fact", content: "Deploy service with canary" });
    const second = await fabric.remember({ kind: "fact", content: "Deploy service with canary disabled" });

    assert.equal(second.supersedes, first.id);
    const rows = await rawRows(memory, "Deploy service with canary");
    assert.equal(rows.length, 2);
    const oldMetadata = parseMemoryNoteMetadata(rows.find((row) => row.id === first.id)?.metadata);
    assert.equal(oldMetadata?.validTo, second.ingestedAt);
    assert.deepEqual(
      (await fabric.recall("Deploy service with canary")).hits.map((hit) => hit.id),
      [second.id],
    );
    const historical = await fabric.recall("Deploy service with canary", { asOf: "2020-01-01T00:00:00.000Z" });
    assert.deepEqual(historical.hits.map((hit) => hit.id).sort(), [first.id, second.id].sort());
  });

  it("supersede keeps host metadata keys on the superseded row", async () => {
    const { memory } = makeMemory();
    await memory.remember(
      {
        entries: [
          {
            id: "0badc0ffee11",
            text: "Office is in Berlin",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: { owner: "host", fabric: { v: 1, kind: "fact" } },
          },
        ],
      },
      { wait: true },
    );
    const fabric = createMemoryFabric({ memory });

    const note = await fabric.remember({ kind: "fact", content: "Office is in Berlin today" });

    assert.equal(note.supersedes, "0badc0ffee11");
    const row = (await rawRows(memory, "Office is in Berlin")).find((hit) => hit.id === "0badc0ffee11");
    assert.equal((row?.metadata as Record<string, unknown> | undefined)?.owner, "host");
    assert.equal(parseMemoryNoteMetadata(row?.metadata)?.validTo, note.ingestedAt);
  });

  it("never folds a file note into a different path and updates the same path in place", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const alpha = await fabric.remember({ kind: "file", path: "docs/alpha.md", content: "Service deploy uses canary rollout plan" });
    const beta = await fabric.remember({ kind: "file", path: "docs/beta.md", content: "Service deploy uses canary rollout plan" });
    assert.notEqual(beta.id, alpha.id);
    assert.equal((await rawRows(memory, "Service deploy uses canary rollout plan")).length, 2);

    const alphaAgain = await fabric.remember({
      kind: "file",
      path: "docs/alpha.md",
      content: "Service deploy uses canary rollout plan v2",
      keywords: ["canary"],
    });
    assert.equal(alphaAgain.id, alpha.id);
    assert.equal(alphaAgain.path, "docs/alpha.md");
    assert.equal((await rawRows(memory, "Service deploy uses canary rollout plan")).length, 2);
    const hits = await fabric.recall("Service deploy uses canary rollout plan v2", { kinds: ["file"] });
    assert.equal(hits.hits.find((hit) => hit.id === alpha.id)?.content, "Service deploy uses canary rollout plan v2");
  });

  it("writes unconditionally when consolidation is off", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });

    const first = await fabric.remember({ kind: "fact", content: "User prefers metric units" });
    const second = await fabric.remember({ kind: "fact", content: "User prefers metric units" });
    assert.notEqual(second.id, first.id);
    assert.equal((await rawRows(memory, "User prefers metric units")).length, 2);
  });

  it("stores no links unless the linker is enabled", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const note = await fabric.remember({ kind: "fact", content: "Canary rollout is required" });
    assert.equal(note.links, undefined);
    assert.equal(parseMemoryNoteMetadata((await rawRows(memory, "Canary rollout is required"))[0]?.metadata)?.links, undefined);
  });

  it("links the top-k neighbors with clamped weights and skips itself", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false, linker: { enabled: true, topK: 2 } });
    fabric.attach(session);

    const one = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    const two = await fabric.remember({ kind: "fact", content: "Canary rollout protects services" });
    const three = await fabric.remember({ kind: "fact", content: "Canary rollout protects services nightly" });

    assert.ok(three.links !== undefined && three.links.length <= 2);
    const ids = three.links.map((link) => link.id);
    assert.ok(
      ids.every((id) => id !== three.id && [one.id, two.id].includes(id)),
      `unexpected link ids ${ids.join(",")}`,
    );
    assert.ok(three.links.every((link) => link.relation === "related" && (link.weight ?? 0) > 0 && (link.weight ?? 0) <= 1));
    assert.equal((await rawRows(memory, "Canary rollout protects services nightly")).length, 3);
  });

  it("patches neighbor keywords only, leaving sourceEntryIds and content frozen", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false, evolution: { enabled: true, maxPatches: 5 } });
    fabric.attach(session);

    const neighbor = await fabric.remember({
      kind: "fact",
      content: "Canary rollout protects deploys",
      keywords: ["canary"],
      sourceEntryIds: ["m1"],
    });
    await fabric.remember({ kind: "fact", content: "Dashboards track rollout health", keywords: ["dashboards"] });
    await fabric.remember({ kind: "fact", content: "Dashboards track rollout health", keywords: ["dashboards"] });

    const rows = await rawRows(memory, "Canary rollout protects deploys");
    const row = rows.find((hit) => hit.id === neighbor.id);
    assert.equal(row?.text, "Canary rollout protects deploys");
    const metadata = parseMemoryNoteMetadata(row?.metadata);
    assert.deepEqual(metadata?.sourceEntryIds, ["m1"]);
    assert.deepEqual(metadata?.keywords, ["canary", "dashboards"]);
  });

  it("skips both workers when passive", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({
      memory,
      consolidate: false,
      passive: true,
      linker: { enabled: true },
      evolution: { enabled: true },
    });
    fabric.attach(session);

    const neighbor = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys", keywords: ["canary"] });
    const note = await fabric.remember({ kind: "fact", content: "Dashboards track rollout health", keywords: ["dashboards"] });

    assert.equal(note.links, undefined);
    assert.deepEqual(
      parseMemoryNoteMetadata((await rawRows(memory, "Canary rollout protects deploys")).find((row) => row.id === neighbor.id)?.metadata)
        ?.keywords,
      ["canary"],
    );
  });

  it("validates consolidation, linker, and evolution options and keeps distant notes apart", async () => {
    const { memory } = makeMemory();
    assert.throws(() => createMemoryFabric({ memory, consolidate: { threshold: 2 } }), MemoryValidationError);
    assert.throws(() => createMemoryFabric({ memory, consolidate: "yes" as unknown as boolean }), MemoryValidationError);
    assert.throws(() => createMemoryFabric({ memory, linker: { topK: 0 } }), RangeError);
    assert.throws(() => createMemoryFabric({ memory, linker: "yes" as unknown as boolean }), MemoryValidationError);
    assert.throws(() => createMemoryFabric({ memory, evolution: { maxPatches: 100 } }), RangeError);
    assert.throws(() => createMemoryFabric({ memory, passive: "yes" as unknown as boolean }), MemoryValidationError);

    const fabric = createMemoryFabric({ memory });
    await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    await fabric.remember({ kind: "fact", content: "Dashboards track rollout health" });
    assert.equal((await fabric.recall("rollout", { topK: 10 })).hits.length, 2);
    assert.equal(DEFAULT_CONSOLIDATION_THRESHOLD, 0.85);
  });
});
