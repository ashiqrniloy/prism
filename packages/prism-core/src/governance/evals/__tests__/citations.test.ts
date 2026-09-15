import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createAgent, createMockProvider, providerDone, providerTextDelta, providerUsage } from "@arnilo/prism";
import { createCitationIntegrityScorer } from "../citations.js";
import { defineDataset } from "../dataset.js";
import { runExperiment } from "../experiment.js";
import { defineScorer } from "../scorer.js";
import { assertEvaluationThreshold, EvalThresholdError } from "../threshold.js";

const body = "quoted fact";
const hash = createHash("sha256").update(body, "utf8").digest("hex");
const citation = {
  uri: "https://example.test/s",
  sourceId: "s1",
  revision: "r1",
  contentHash: hash,
  excerpt: body,
};

test("citation integrity scorer is invariant 0 on revoked ACL / forged hash even when a judge scores 1", async () => {
  const integrity = createCitationIntegrityScorer();
  const judge = defineScorer({ id: "prose", score: () => ({ score: 1 }) });
  const result = {
    sessionId: "sess-1",
    runId: "run-1",
    status: "succeeded" as const,
    text: "ok",
    content: [],
  };
  const revoked = await integrity.score({
    result,
    environment: { citations: [{ citation, live: { contentHash: hash, revision: "r1", body, authorized: false } }] },
  });
  assert.equal(revoked.score, 0);
  assert.equal(revoked.reason, "revoked_acl");
  assert.equal(revoked.metadata?.invariant, true);

  const forged = await integrity.score({
    result,
    environment: { citations: [{ citation, live: { contentHash: "00".repeat(32), revision: "r1", body } }] },
  });
  assert.equal(forged.reason, "hash_mismatch");

  const ok = await integrity.score({
    result,
    environment: { citations: [{ citation, live: { contentHash: hash, revision: "r1", body } }] },
  });
  assert.equal(ok.score, 1);

  const report = await runExperiment({
    agent: createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerTextDelta("ok"),
        providerUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        providerDone(),
      ]),
    }),
    dataset: defineDataset({ id: "cite", items: [{ id: "i1", input: "q" }] }),
    scorers: [integrity, judge],
    toEnvironment: () => ({
      citations: [{ citation, live: { contentHash: hash, revision: "r1", authorized: false } }],
    }),
  });
  assert.equal(report.aggregate.invariantsPassed, false);
  assert.throws(() => assertEvaluationThreshold(report, { minimumMean: 0.4 }), EvalThresholdError);
});
