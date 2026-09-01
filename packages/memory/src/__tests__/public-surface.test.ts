/**
 * Plan 044 Task 3: conformance leg + docs tripwire over the composite recall
 * scoring surface. Imports only the package public entry — no private `src/**`
 * reaches past this file. Asserts the documented contract (docs/
 * working-and-semantic-memory.md): weights validated and sum-normalized,
 * half-life mandatory with recencyWeight, importance clamped to [0,1] at write,
 * hook output clamped, explicit entry importance wins, absent hook → neutral,
 * and the blended tie-break matches store ordering.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  clampImportance,
  createHashEmbedder,
  createMemory,
  deriveEntryImportance,
  type ImportanceFromReflection,
  type MemoryVectorHit,
  rerankRecallHits,
  resolveRecallScoring,
} from "../index.js";

const stubEmbedder = createHashEmbedder({ dimensions: 4 });

test("conformance: resolveRecallScoring validates weights and requires halfLifeMs for recency", () => {
  assert.equal(resolveRecallScoring(undefined), undefined); // disabled by default
  assert.equal(resolveRecallScoring({}), undefined); // zero weights disabled

  const resolved = resolveRecallScoring({ recencyWeight: 0.3, importanceWeight: 0.2, halfLifeMs: 1000 });
  assert.ok(resolved);
  assert.equal(resolved.similarity, 0.5, "similarity keeps the remainder of 1");
  assert.equal(resolved.recency, 0.3);
  assert.equal(resolved.importance, 0.2);
  assert.equal(resolved.halfLifeMs, 1000);

  assert.throws(() => resolveRecallScoring({ recencyWeight: 0.5 }), /halfLifeMs/); // recency without half-life
  assert.throws(() => resolveRecallScoring({ recencyWeight: 1.5, halfLifeMs: 1000 }), /\[0,1\]/);
  assert.throws(() => resolveRecallScoring({ recencyWeight: -0.1, halfLifeMs: 1000 }), /\[0,1\]/);
  assert.throws(() => resolveRecallScoring({ recencyWeight: 0.5, halfLifeMs: 0 }), /halfLifeMs/); // non-positive half-life
  const over = resolveRecallScoring({ recencyWeight: 0.8, importanceWeight: 0.8, halfLifeMs: 1000 }); // overshoot normalizes down
  assert.ok(over);
  assert.equal(over.similarity, 0);
  assert.equal(over.recency, 0.5);
  assert.equal(over.importance, 0.5);
});

test("conformance: importance clamps to [0,1]; explicit entry importance wins over the hook", () => {
  assert.equal(clampImportance(4), 1);
  assert.equal(clampImportance(-0.2), 0);
  assert.equal(clampImportance(0.5), 0.5);
  assert.equal(clampImportance(undefined), 1); // neutral fallback
  const hook: ImportanceFromReflection = () => 7; // out-of-range output clamps at write
  assert.equal(deriveEntryImportance({ importance: 0.4, reflection: { content: "x" } }, hook), 0.4);
  assert.equal(deriveEntryImportance({ reflection: { content: "x" } }, hook), 1);
  assert.equal(deriveEntryImportance({ reflection: { content: "x" } }, undefined), undefined); // no hook → neutral
});

test("conformance: rerankRecallHits blends per-hit and keeps the documented tie-break", () => {
  const scoring = resolveRecallScoring({ recencyWeight: 0, importanceWeight: 1 });
  assert.ok(scoring);
  const now = Date.parse("2026-01-30T00:00:00.000Z");
  const hit = (id: string, sequence: number, importance: number, score: number): MemoryVectorHit => ({
    id,
    tenantId: "t1",
    resourceId: "r1",
    threadId: "th1",
    text: id,
    embedding: [1, 0, 0, 0],
    sequence,
    createdAt: "2026-01-01T00:00:00.000Z",
    importance,
    score,
  });
  const reranked = rerankRecallHits([hit("low", 1, 0.4, 0.9), hit("high", 1, 0.9, 0.5)], scoring, now);
  assert.equal(reranked[0]!.id, "high"); // 0.9 blended beats 0.9 similarity only
  assert.equal(reranked[0]!.similarity, 0.5);
  assert.equal(reranked[0]!.importance, 0.9);
  // equal blended score → sequence ascending tie-break (score desc, sequence asc, id asc)
  const tie = rerankRecallHits([hit("a", 2, 1, 0.5), hit("b", 1, 1, 0.5)], scoring, now);
  assert.equal(tie[0]!.id, "b");
  assert.equal(tie[1]!.id, "a");
  // recency component: fresh now → 1, decays with age using halfLifeMs
  const fresh = rerankRecallHits([hit("f", 1, 0, 0)], scoring, Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(fresh[0]!.recency, 1);
});

test("conformance: public createMemory accepts the scoring surface; plain recall stays component-free", async () => {
  const memory = createMemory({
    tenantId: "t1",
    resourceId: "r1",
    threadId: "th-surface",
    embedder: stubEmbedder,
    importanceFrom: (reflection) => Number(reflection.mentions ?? 0) / 10,
  });
  await memory.remember(
    {
      entries: [
        { id: "e1", text: "conformance alpha", sequence: 1, reflection: { content: "x", mentions: 8 } },
        { id: "e2", text: "conformance beta", sequence: 2 },
      ],
    },
    { wait: true },
  );
  const scored = await memory.recall("conformance", { topK: 2, scoring: { importanceWeight: 0.5 } });
  assert.equal(scored.hits.length, 2);
  for (const hit of scored.hits) {
    for (const key of ["score", "similarity", "recency", "importance"] as const) {
      assert.equal(typeof hit[key], "number", `hit.${key} numeric when scoring enabled`);
    }
  }
  const plain = await memory.recall("conformance", { topK: 2 });
  assert.equal(plain.hits.length, 2);
  // without scoring: no composite components; stored record importance still present where stored
  for (const hit of plain.hits) {
    assert.equal("similarity" in hit, false);
    assert.equal("recency" in hit, false);
  }
  const stored = plain.hits.find((hit) => hit.id === "e1");
  assert.ok(stored);
  assert.equal(stored.importance, 0.8); // derived importance persisted with the record
});

test("tripwire: docs page documents the composite scoring surface it ships", () => {
  const docs = readFileSync(fileURLToPath(new URL("../../../../docs/working-and-semantic-memory.md", import.meta.url)), "utf8");
  for (const needle of ["RecallScoringOptions", "importanceFrom", "halfLifeMs", "recencyWeight", "importanceWeight", "topK × 4"]) {
    assert.ok(docs.includes(needle), `docs/working-and-semantic-memory.md must mention ${needle}`);
  }
});
