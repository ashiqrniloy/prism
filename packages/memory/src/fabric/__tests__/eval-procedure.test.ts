import assert from "node:assert/strict";
import { test } from "node:test";
import { createHashEmbedder, createMemory, createMemoryVectorStore, createMemoryWorkingStore } from "../../index.js";
import { caseConclusionsNotProcedures, createMemoryFabric } from "../index.js";

/**
 * 072-style invariant fixture, hermetic (hash embedder, in-memory stores, no provider).
 * Grades the one promotion this layer exists to prevent: a case conclusion — case-bound
 * specifics — filed as a reusable `procedure`. The scorer body lives in `../invariants.ts`
 * so a host can wrap it with `defineScorer({ invariant: true, ... })` in its own harness.
 */
test("072 invariant: a case conclusion promoted into a procedure scores 0", async () => {
  const fabric = createMemoryFabric({
    memory: createMemory({
      tenantId: "eval",
      resourceId: "oncall",
      threadId: "case-4711",
      embedder: createHashEmbedder({ dimensions: 32 }),
      vectorStore: createMemoryVectorStore(),
      workingStore: createMemoryWorkingStore(),
    }),
  });
  const caseTokens = ["4711", "03:12"];

  // Host path: the conclusion stays a fact, the generalizable lesson is the procedure.
  await fabric.remember({ kind: "fact", content: "Checkout worker for case 4711 OOM'd at 03:12 after the retry cap doubled" });
  await fabric.remember({ kind: "procedure", content: "Cap retry bursts before raising a worker memory limit" });
  const graded = (await fabric.recall("4711 03:12", { kinds: ["procedure"] })).hits.map((hit) => hit.content);
  assert.equal(caseConclusionsNotProcedures({ procedures: graded }, caseTokens).score, 1);

  // Anti-pattern: re-filing the conclusion as a procedure. Details now live in a reusable recipe.
  await fabric.remember({ kind: "procedure", content: "Case 4711: raise the worker memory limit at 03:12" });
  const promoted = (await fabric.recall("4711 03:12", { kinds: ["procedure"] })).hits.map((hit) => hit.content);
  const invariant = caseConclusionsNotProcedures({ procedures: promoted }, caseTokens);
  assert.equal(promoted.length, 2);
  assert.equal(invariant.metadata.invariant, true);
  assert.equal(invariant.score, 0);

  // The split is enforced by kind, not by the query: untyped recall never surfaces a procedure,
  // so a case conclusion filed as one is invisible to the path a host injects by default.
  const untyped = await fabric.recall("4711 03:12");
  assert.equal(
    untyped.hits.some((hit) => hit.kind === "procedure"),
    false,
  );
});
