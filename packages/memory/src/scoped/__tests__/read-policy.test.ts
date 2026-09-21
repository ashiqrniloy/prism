import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { MemoryFabric, MemoryNoteHit } from "../../fabric/types.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy, scoreScopedHit } from "../index.js";
import { scopedLedgerPath } from "../ledger.js";

function hit(id: string, score: number, usesSimilarity = score, ingestedAt = new Date().toISOString()): MemoryNoteHit {
  return {
    id,
    kind: "fact",
    content: id,
    ingestedAt,
    tokenCount: 1,
    score,
    similarity: usesSimilarity,
  };
}

function fakeFabric(hits: MemoryNoteHit[]): MemoryFabric {
  return {
    recall: async () => ({
      hits,
      explain: hits.map((row) => ({ id: row.id, score: row.score, link: false, valid: true })),
    }),
    remember: async () => {
      throw new Error("unused");
    },
    attach: () => {
      throw new Error("unused");
    },
  } as unknown as MemoryFabric;
}

async function boundPolicy(hits: MemoryNoteHit[], knobs?: Parameters<typeof createScopedMemoryPolicy>[0]["policy"]) {
  const root = await mkdtemp(join(tmpdir(), "scoped-read-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  const policy = createScopedMemoryPolicy({ memory, fabric: fakeFabric(hits), scopeRoot: root, policy: knobs });
  return { root, policy };
}

describe("scoreScopedHit", () => {
  it("is fabric score × exp(-ageDays/tauDays) × (1 + ln(1 + uses))", () => {
    assert.equal(scoreScopedHit(0.5, 0, 0, 30), 0.5);
    assert.equal(scoreScopedHit(1, 0, 30, 30), Math.exp(-1));
    assert.equal(scoreScopedHit(0.4, 10, 0, 30), 0.4 * (1 + Math.log(11)));
  });
});

describe("policy.recall", () => {
  it("abstains when every hit is below the floor and does not increment usage", async () => {
    const { root, policy } = await boundPolicy([hit("a", 0.2), hit("b", 0.1)]);
    const result = await policy.recall("q");
    assert.deepEqual(result.hits, []);
    assert.equal(result.abstained, true);
    assert.deepEqual(await readdir(root), []);
  });

  it("clamps to topK and ranks by combined score, not raw similarity", async () => {
    const hits = [hit("weak", 0.9), hit("hot", 0.4), ...Array.from({ length: 8 }, (_, i) => hit(`n${i}`, 0.5))];
    const { root, policy } = await boundPolicy(hits);
    await mkdir(join(root, ".memory"), { recursive: true });
    await writeFile(
      scopedLedgerPath(root),
      JSON.stringify({ notes: { hot: { uses: 10, lastUsedAt: new Date().toISOString() } }, pending: [] }),
    );
    const result = await policy.recall("q");
    assert.equal(result.abstained, false);
    assert.equal(result.hits.length, 3);
    assert.equal(result.hits[0]?.id, "hot");
    assert.equal(result.hits[1]?.id, "weak");
    assert.ok(result.hits.every((row) => row.score >= (result.hits.at(-1)?.score ?? 0)));
  });

  it("increments uses once per returned hit; corrupt ledger is zero uses", async () => {
    const hits = [hit("a", 0.9), hit("b", 0.8), hit("c", 0.7), hit("d", 0.6)];
    const { root, policy } = await boundPolicy(hits);
    const first = await policy.recall("q");
    assert.deepEqual(
      first.hits.map((row) => row.id),
      ["a", "b", "c"],
    );
    const ledger = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { uses: number; content?: string }>;
    };
    assert.equal(ledger.notes.a?.uses, 1);
    assert.equal(ledger.notes.b?.uses, 1);
    assert.equal(ledger.notes.c?.uses, 1);
    assert.equal(ledger.notes.d, undefined);
    assert.equal(ledger.notes.a?.content, undefined);

    await writeFile(scopedLedgerPath(root), "{not json");
    const afterCorrupt = await policy.recall("q");
    assert.deepEqual(
      afterCorrupt.hits.map((row) => row.id),
      ["a", "b", "c"],
    );
    const recovered = JSON.parse(await readFile(scopedLedgerPath(root), "utf8")) as {
      notes: Record<string, { uses: number }>;
    };
    assert.equal(recovered.notes.a?.uses, 1);
  });
});
