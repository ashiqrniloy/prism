import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import { MemoryValidationError } from "../../errors.js";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { createMemoryFabric } from "../index.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };

function makeMemory() {
  const memory = createMemory({
    ...scope,
    embedder: createHashEmbedder(),
    vectorStore: createMemoryVectorStore(),
    workingStore: createMemoryWorkingStore(),
  });
  return { memory };
}

/** Minimal current-branch message entry; only `message` roles user/assistant/tool are eligible. */
function message(id: string, text: string, role: "user" | "assistant" = "user", timestamp = "2026-01-01T00:00:00.000Z"): SessionEntry {
  return { id, sessionId: "s1", timestamp, kind: "message", message: { role, content: [{ type: "text", text }] } };
}

describe("memory fabric recall", () => {
  it("returns hits with a parallel explain row", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });
    const note = await fabric.remember({ kind: "fact", content: "User prefers metric units", importance: 0.75 });

    const plain = await fabric.recall("User prefers metric units");
    assert.equal(plain.hits.length, 1);
    assert.equal(plain.explain.length, 1);
    assert.deepEqual(plain.explain[0], {
      id: note.id,
      score: plain.hits[0]?.score,
      importance: 0.75,
      link: false,
      valid: true,
    });
    assert.equal(plain.hits[0]?.similarity, undefined);

    const scored = await fabric.recall("User prefers metric units", {
      scoring: { recencyWeight: 0.2, importanceWeight: 0.2, halfLifeMs: 7 * 86_400_000 },
    });
    assert.equal(scored.explain[0]?.similarity, scored.hits[0]?.similarity);
    assert.equal(typeof scored.explain[0]?.recency, "number");
  });

  it("keeps the memory.recall order for a plain facts-only query", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    for (const content of ["Canary rollout protects deploys", "Rollout dashboard tracks canary health", "Deploys are scheduled weekly"]) {
      await fabric.remember({ kind: "fact", content });
    }

    const query = "canary rollout deploys";
    const viaFabric = await fabric.recall(query, { kinds: ["fact"], topK: 3 });
    const viaMemory = await memory.recall(query, { topK: 3 });
    assert.deepEqual(
      viaFabric.hits.map((hit) => hit.id),
      viaMemory.hits.map((hit) => hit.id),
    );
    assert.ok(viaFabric.explain.every((entry) => entry.link === false));
  });

  it("adds a linked neighbor that the seed hit points at", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, linker: { enabled: true, topK: 3 } });
    fabric.attach({ id: "s1" });
    const neighbor = await fabric.remember({ kind: "fact", content: "Rollout health lives on the deploy dashboard" });
    const seed = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });

    assert.deepEqual(
      seed.links?.map((link) => link.id),
      [neighbor.id],
    );
    const { hits, explain } = await fabric.recall("Canary rollout protects deploys", { topK: 1 });
    assert.deepEqual(
      hits.map((hit) => hit.id),
      [seed.id, neighbor.id],
    );
    assert.equal(explain[0]?.link, false);
    assert.equal(explain[1]?.link, true);
    assert.equal(hits[1]?.content, "Rollout health lives on the deploy dashboard");
  });

  it("drops a revoked entry from hits and explain", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const revoked = await fabric.remember({ kind: "fact", content: "Legacy units are imperial" });
    await fabric.remember({ kind: "fact", content: "Current units are metric" });
    assert.equal((await fabric.recall("units", { topK: 5 })).hits.length, 2);

    await memory.setConsent(revoked.id, { visible: false });
    const after = await fabric.recall("units", { topK: 5 });
    assert.deepEqual(
      after.hits.map((hit) => hit.id),
      [(await fabric.recall("Current units are metric")).hits[0]?.id],
    );
    assert.ok(after.explain.every((entry) => entry.id !== revoked.id));
  });

  it("filters the validity window against asOf", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });
    const future = await fabric.remember({ kind: "fact", content: "Pricing moves to usage tiers", validFrom: "2030-01-01T00:00:00.000Z" });

    const now = await fabric.recall("Pricing moves to usage tiers");
    assert.equal(now.hits.length, 0);
    const futureResult = await fabric.recall("Pricing moves to usage tiers", { asOf: "2030-06-01T00:00:00.000Z" });
    assert.deepEqual(
      futureResult.hits.map((hit) => hit.id),
      [future.id],
    );
    assert.deepEqual(
      futureResult.explain.map((entry) => entry.valid),
      [true],
    );
  });

  it("stops at the token budget but always returns the best hit", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const first = await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    const second = await fabric.remember({ kind: "fact", content: "Canary rollout protects services" });

    const unbudgeted = await fabric.recall("canary rollout protects", { topK: 5 });
    assert.equal(unbudgeted.hits.length, 2);
    const firstTokens = unbudgeted.hits[0]?.tokenCount ?? 0;

    const tight = await fabric.recall("canary rollout protects", { topK: 5, budget: firstTokens });
    assert.deepEqual(
      tight.hits.map((hit) => hit.id),
      [first.id],
    );
    assert.equal(tight.explain.length, 1);
    assert.deepEqual((await fabric.recall("canary rollout protects", { topK: 5, budget: 10_000 })).hits.length, 2);
    const tiny = await fabric.recall("canary rollout protects", { topK: 5, budget: 1 });
    assert.equal(tiny.hits.length, 1);

    assert.equal(second.id === first.id, false);
    await assert.rejects(fabric.recall("x", { budget: 0 }), MemoryValidationError);
    await assert.rejects(fabric.recall("x", { budget: 1.5 }), MemoryValidationError);
    await assert.rejects(fabric.recall("x", { kinds: ["nope" as never] }), MemoryValidationError);
  });
});

describe("memory fabric conversation search", () => {
  const entries: readonly SessionEntry[] = [
    message("m1", "hello there", "user", "2026-01-01T00:00:00.000Z"),
    message("m2", "canary rollout is the deploy strategy", "assistant", "2026-01-01T00:01:00.000Z"),
    message("m3", "ship it", "user", "2026-01-01T00:02:00.000Z"),
    message("m4", "canary rollout rollback notes", "assistant", "2026-01-01T00:03:00.000Z"),
    { id: "e1", sessionId: "s1", timestamp: "2026-01-01T00:04:00.000Z", kind: "summary", summary: "canary rollout summary" },
  ];

  it("ranks branch messages and pages around the match with the OM page helper", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => entries } } });

    const result = await fabric.searchConversation("canary rollout", { limit: 2, topK: 5 });
    assert.equal(result.scanned, 4);
    assert.deepEqual(
      result.hits.map((hit) => hit.entryId),
      ["m4", "m2"],
    );
    assert.equal(result.hits[0]?.score, 1);
    assert.equal(result.hits[0]?.timestamp, "2026-01-01T00:03:00.000Z");
    assert.equal(result.hits[0]?.page.limit, 2);
    assert.equal(result.hits[0]?.page.entries.length, 2);
    assert.deepEqual(
      result.hits[0]?.page.entries.map((entry) => entry.id),
      ["m3", "m4"],
    );
    assert.equal(result.hits[0]?.page.prevCursor, "m2");

    const forward = await fabric.searchConversation("deploy strategy", { limit: 1, direction: "forward" });
    assert.deepEqual(
      forward.hits.map((hit) => hit.entryId),
      ["m2"],
    );
    assert.deepEqual(
      forward.hits[0]?.page.entries.map((entry) => entry.id),
      ["m2"],
    );
    assert.equal(forward.hits[0]?.page.nextCursor, "m3");
  });

  it("validates the page limit and topK against the OM and search caps", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => entries } } });

    await assert.rejects(fabric.searchConversation("canary", { limit: 101 }), RangeError);
    await assert.rejects(fabric.searchConversation("canary", { limit: 0 }), RangeError);
    await assert.rejects(fabric.searchConversation("canary", { topK: 101 }), RangeError);
    await assert.rejects(fabric.searchConversation("canary", { topK: 1.5 }), RangeError);
    await assert.rejects(fabric.searchConversation("a"), MemoryValidationError);
    assert.deepEqual((await fabric.searchConversation("canary", { topK: 100 })).hits.length, 2);
  });

  it("fails closed without an observational session and matches nothing on a clean miss", async () => {
    const { memory } = makeMemory();
    const inert = createMemoryFabric({ memory });
    await assert.rejects(inert.searchConversation("canary"), MemoryValidationError);

    const fabric = createMemoryFabric({ memory, observational: { session: { entries: async () => entries } } });
    const miss = await fabric.searchConversation("kubernetes");
    assert.deepEqual(miss.hits, []);
    assert.equal(miss.scanned, 4);
  });
});
