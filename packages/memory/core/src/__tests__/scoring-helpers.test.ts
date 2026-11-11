import { test } from "bun:test";
import assert from "node:assert/strict";
import type { MemoryVectorHit } from "../index.js";
import { rerankRecallHits, resolveRecallScoring, withTailContext } from "../index.js";
import { clampImportance } from "../scoring.js";

test("unrated importance is neutral half; accessed recency falls back to creation", () => {
  assert.equal(clampImportance(undefined), 0.5);
  const hit: MemoryVectorHit = {
    id: "a",
    tenantId: "t",
    resourceId: "r",
    threadId: "c",
    text: "a",
    embedding: [1],
    sequence: 1,
    score: 1,
    createdAt: new Date(0).toISOString(),
    lastAccessedAt: new Date(1000).toISOString(),
  };
  const scoring = resolveRecallScoring({ recencyWeight: 1, halfLifeMs: 1000 })!;
  assert.equal(rerankRecallHits([hit], scoring, 2000)[0]!.recency, 0.5);
  assert.equal(rerankRecallHits([{ ...hit, lastAccessedAt: undefined }], scoring, 2000)[0]!.recency, 0.25);
  assert.equal(
    rerankRecallHits([hit], resolveRecallScoring({ recencyWeight: 1, halfLifeMs: 1000, recencyBasis: "created" })!, 2000)[0]!.recency,
    0.25,
  );
  assert.throws(() => resolveRecallScoring({ recencyBasis: "bad" as never }), /recencyBasis/);
});

test("tail context preserves prefix and user anchor across tool rounds, with metadata", () => {
  const prefix = { role: "system" as const, content: [{ type: "text" as const, text: "prefix" }] };
  const user = { role: "user" as const, content: [{ type: "text" as const, text: "question" }] };
  const tool = { role: "tool" as const, content: [{ type: "tool_result" as const, toolCallId: "x", name: "x", result: "ok" }] };
  const blocks = [{ title: "Memory", content: "fact", metadata: { source: "fabric", itemIds: ["a"], tokens: 3 } }];
  const draft = { messages: [prefix, user, tool] };
  const result = withTailContext(draft, blocks);
  assert.equal(result.messages[0], prefix);
  assert.equal(result.messages[2], user);
  assert.equal(result.messages[3], tool);
  assert.deepEqual(result.messages[1]!.metadata?.contextBlocks, [{ title: "Memory", source: "fabric", itemIds: ["a"], tokens: 3 }]);
  assert.equal(withTailContext({ messages: [prefix] }, blocks).messages.length, 2);
  assert.equal(withTailContext(draft, []), draft);
});
