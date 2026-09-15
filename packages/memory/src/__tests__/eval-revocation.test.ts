import assert from "node:assert/strict";
import { test } from "node:test";
import { createHashEmbedder, createMemory, revokedIdsAbsent } from "../index.js";

test("072 invariant: revoked id absent from injected snapshot; score 0 cannot be averaged away", async () => {
  const memory = createMemory({
    tenantId: "t1",
    resourceId: "r1",
    threadId: "th1",
    embedder: createHashEmbedder({ dimensions: 2 }),
  });
  await memory.remember(
    {
      entries: [
        { id: "secret-fact", text: "the merger closes friday" },
        { id: "ok", text: "weather is fine" },
      ],
    },
    { wait: true },
  );
  const before = await memory.recall("merger", { topK: 5 });
  const envBefore = { injectedIds: before.hits.map((hit) => hit.id) };
  assert.equal(revokedIdsAbsent(envBefore, ["secret-fact"]).score, 0);

  await memory.forget({ ids: ["secret-fact"] });
  const after = await memory.recall("merger", { topK: 5 });
  const envAfter = { injectedIds: after.hits.map((hit) => hit.id) };
  assert.equal(envAfter.injectedIds.includes("secret-fact"), false);
  assert.equal(revokedIdsAbsent(envAfter, ["secret-fact"]).score, 1);

  const invariant = revokedIdsAbsent({ injectedIds: ["secret-fact"] }, ["secret-fact"]);
  const other = { score: 1 };
  const mean = (invariant.score + other.score) / 2;
  assert.equal(invariant.metadata.invariant, true);
  assert.equal(invariant.score, 0);
  assert.ok(mean > 0);
});
