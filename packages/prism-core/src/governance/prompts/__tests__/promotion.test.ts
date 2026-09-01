import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRunResult } from "@arnilo/prism";
import type { Dataset, PairwiseScorer } from "../../evals/index.js";
import type { PromptStore } from "../index.js";
import { assertPromptPromotion, createMemoryPromptStore, PromptValidationError } from "../index.js";

function result(text: string): AgentRunResult {
  return {
    sessionId: "eval-session",
    runId: `run-${text}`,
    status: "succeeded",
    text,
    content: [{ type: "text", text }],
  };
}

/** Deterministic pairwise scorer: prefers the reply carrying the expected marker. */
const markerScorer: PairwiseScorer<{ question: string }, { reply: string }> = {
  id: "relevance",
  score({ left, right, item }) {
    const expected = item.expected!.reply;
    const matches = (text: string) => text.includes(expected);
    return { preference: matches(left.result.text) === matches(right.result.text) ? "tie" : matches(left.result.text) ? "left" : "right" };
  },
};

const dataset: Dataset<{ question: string }, { reply: string }> = {
  id: "support-dataset",
  version: "1",
  items: [
    { id: "item-1", input: { question: "refund" }, expected: { reply: "candidate" } },
    { id: "item-2", input: { question: "invoice" }, expected: { reply: "candidate" } },
    { id: "item-3", input: { question: "delivery" }, expected: { reply: "candidate" } },
    { id: "item-4", input: { question: "account" }, expected: { reply: "candidate" } },
  ],
};

async function setup(): Promise<PromptStore> {
  const store = createMemoryPromptStore();
  // version 1 (baseline): generic reply; version 2 (candidate): carries the expected marker.
  await store.put({ name: "support-agent", body: "baseline reply" });
  await store.put({ name: "support-agent", body: "candidate reply" });
  return store;
}

function promotionOptions(store: PromptStore) {
  return {
    store,
    name: "support-agent",
    candidate: { version: 2 },
    baseline: { version: 1 },
    dataset,
    scorers: [markerScorer],
    run: (prompt: { body: string }) => async (item: { input: { question: string } }) =>
      result(`${prompt.body.split(" ")[0]}:${item.input.question}`),
  };
}

describe("assertPromptPromotion", () => {
  it("promotes when the candidate wins every comparison", async () => {
    const store = await setup();
    const verdict = await assertPromptPromotion(promotionOptions(store));
    assert.equal(verdict.verdict, "promote");
    assert.deepEqual(verdict.reasons, []);
    assert.equal(verdict.winRate, 1);
    assert.equal(verdict.candidate.version, 2);
    assert.equal(verdict.baseline.version, 1);
    assert.deepEqual(verdict.perScorer, { relevance: { wins: 4, losses: 0, ties: 0, failures: 0 } });
    assert.equal(JSON.parse(verdict.reportJson).datasetId, "support-dataset");
    // Read-only evaluation: the store still holds exactly the two seeded versions.
    const listed = await store.list({ name: "support-agent" });
    assert.equal(listed.items.length, 2);
  });

  it("holds when the candidate loses and carries the bounded report", async () => {
    const store = await setup();
    const verdict = await assertPromptPromotion({ ...promotionOptions(store), candidate: { version: 1 }, baseline: { version: 2 } });
    assert.equal(verdict.verdict, "hold");
    assert.ok(verdict.reasons.length > 0);
    assert.equal(verdict.winRate, 0);
    const parsed = JSON.parse(verdict.reportJson) as { candidates: string[]; wins: Record<string, number> };
    assert.deepEqual(parsed.candidates, ["baseline", "candidate"]);
    assert.equal(parsed.wins.candidate, 0);
    assert.deepEqual(verdict.perScorer, { relevance: { wins: 0, losses: 4, ties: 0, failures: 0 } });
    const listed = await store.list({ name: "support-agent" });
    assert.equal(listed.items.length, 2);
  });

  it("promotes at exact threshold equality and holds just below", async () => {
    const store = await setup();
    // Candidate wins items 1-2, ties items 3-4 → winRate 2/4 = 0.5.
    const halfScorer: PairwiseScorer<{ question: string }, { reply: string }> = {
      id: "half",
      score({ left, right, item }) {
        if (item.id === "item-3" || item.id === "item-4") return { preference: "tie" };
        return {
          preference: left.result.text.startsWith("candidate") ? "left" : right.result.text.startsWith("candidate") ? "right" : "tie",
        };
      },
    };
    const atThreshold = await assertPromptPromotion({ ...promotionOptions(store), scorers: [halfScorer], minimumWinRate: 0.5 });
    assert.equal(atThreshold.verdict, "promote");
    assert.equal(atThreshold.winRate, 0.5);
    const belowThreshold = await assertPromptPromotion({ ...promotionOptions(store), scorers: [halfScorer], minimumWinRate: 0.6 });
    assert.equal(belowThreshold.verdict, "hold");
    assert.ok(belowThreshold.reasons[0]!.includes("< 0.6"));
  });

  it("forwards thresholds to the shared evaluation gate", async () => {
    const verdict = await assertPromptPromotion({
      ...promotionOptions(await setup()),
      thresholds: { minimumCandidateWins: { candidate: 5 } },
    });
    assert.equal(verdict.verdict, "hold");
    assert.ok(verdict.reasons[0]!.includes("candidate wins < 5"));
  });

  it("rejects candidate and baseline resolving to the same version", async () => {
    const store = await setup();
    await assert.rejects(assertPromptPromotion({ ...promotionOptions(store), baseline: { version: 2 } }), PromptValidationError);
    await assert.rejects(assertPromptPromotion({ ...promotionOptions(store), candidate: { version: 99 } }), PromptValidationError);
  });

  it("resolves by label instead of an explicit version", async () => {
    const store = await setup();
    await store.put({ name: "support-agent", body: "candidate reply", labels: ["candidate"] });
    const verdict = await assertPromptPromotion({ ...promotionOptions(store), candidate: { label: "candidate" } });
    assert.equal(verdict.candidate.version, 3);
  });
});
