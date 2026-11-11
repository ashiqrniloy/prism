import assert from "node:assert/strict";
import { type Agent, createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import {
  calibrateJudge,
  createJudgePanel,
  createPairwiseJudge,
  createRubricJudge,
  defineDataset,
  runComparison,
} from "@arnilo/prism-hosts/evals";

// Scripted verdicts demonstrate the API; they do not measure a real judge's quality.
async function mockAgent(model: string, replies: readonly string[]) {
  return createAgent({
    model: { provider: "mock", model },
    packages: [mockProvider(replies.map((text) => [providerTextDelta(text), providerDone()]))],
  });
}

async function answer(agent: Agent, input: string, signal?: AbortSignal) {
  const session = await agent.session();
  try {
    return await session.run(input, { signal });
  } finally {
    await session.close();
  }
}

const started = performance.now();
const dataset = defineDataset({
  id: "arithmetic",
  version: "1",
  items: Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, input: "What is 2 + 2?", expected: "4" })),
});
const rubric = {
  id: "correctness",
  version: "1",
  criteria: "Does the answer match the reference?",
  scale: [
    { label: "no", score: 0, description: "Incorrect answer" },
    { label: "yes", score: 1, description: "Correct answer" },
  ],
};
const agents = await Promise.all([
  mockAgent("candidate-a", ["4", "4", "5", "4", "5", "4"]),
  mockAgent("candidate-b", ["2 + 2 = 4"]),
  mockAgent(
    "judge-a",
    ["yes", "yes", "yes", "no", "yes", "no", "yes"].map((label) =>
      JSON.stringify({ reasoning: "Compared the answer with the reference.", label }),
    ),
  ),
  mockAgent("judge-b", [JSON.stringify({ reasoning: "The answer is correct.", label: "yes" })]),
  // Each item has one win per candidate across two trials, preserving a finite bootstrap fit.
  mockAgent(
    "judge-pair",
    dataset.items
      .flatMap(() => ["A", "B", "B", "A"])
      .map((winner) => JSON.stringify({ reasoning: "Applied the comparison criteria.", winner })),
  ),
]);
const [candidateA, candidateB, judgeA, judgeB, pairAgent] = agents;
try {
  const judge = createRubricJudge<string, string>({
    agent: judgeA,
    rubric,
    judgedModel: candidateA.config.model,
    reference: (item) => item.expected,
  });
  const [firstItem] = dataset.items;
  assert.ok(firstItem);
  const result = await answer(candidateA, firstItem.input);
  const verdict = await judge.score({ item: firstItem, result });
  assert.equal(verdict.metadata?.label, "yes");
  assert.equal(verdict.score, 1);
  console.log(judge.id, verdict.metadata?.label, verdict.score);

  const panel = createJudgePanel({
    id: "panel",
    combine: "majority",
    judges: [
      judge,
      createRubricJudge<string, string>({
        id: "correctness-b",
        agent: judgeB,
        rubric,
        judgedModel: candidateA.config.model,
        reference: (item) => item.expected,
      }),
    ],
  });
  const combined = await panel.score({ item: firstItem, result });
  assert.equal(combined.metadata?.failedJudges, 0);
  assert.equal(combined.metadata?.label, "yes");
  assert.equal(combined.score, 1);
  console.log(panel.id, combined.metadata?.label, combined.score);

  const items = [];
  for (const [i, item] of dataset.items.entries()) {
    items.push({ item, result: await answer(candidateA, item.input), humanScore: i % 2 === 0 ? 1 : 0 });
  }
  const calibration = await calibrateJudge({ judge, items, seed: 1 });
  assert.equal(calibration.n, 5);
  assert.equal(calibration.judgeFailures, 0);
  assert.equal(calibration.cohensKappa, 1);
  console.log(judge.id, calibration.n, calibration.cohensKappa);

  const leftModel = candidateA.config.model;
  const rightModel = candidateB.config.model;
  assert.ok(leftModel);
  assert.ok(rightModel);
  const pairwise = createPairwiseJudge<string, string>({
    agent: pairAgent,
    rubric: { id: "preference", version: "1", criteria: "Prefer the clearer correct answer." },
    judgedModels: { left: leftModel, right: rightModel },
  });
  const comparison = await runComparison({
    dataset,
    trials: 2,
    seed: 1,
    concurrency: 1,
    candidates: {
      a: (item, signal) => answer(candidateA, item.input, signal),
      b: (item, signal) => answer(candidateB, item.input, signal),
    },
    scorers: [pairwise],
  });
  assert.equal(comparison.failures, 0);
  assert.equal(comparison.records.length, 10);
  assert.deepEqual(comparison.wins, { a: 5, b: 5 });
  assert.equal(comparison.positionConsistency[pairwise.id], 1);
  assert.equal(comparison.ranking.length, 2);
  console.log(pairwise.id, comparison.positionConsistency[pairwise.id]);
  for (const row of comparison.ranking) {
    assert.equal(row.strength, 1);
    assert.deepEqual(row.ci95, [1, 1]);
    assert.equal(row.rank, 1);
    assert.ok(row.ci95);
    console.log(row.scorerId, row.candidate, row.strength, ...row.ci95, row.rank);
  }
  assert.ok(performance.now() - started < 10_000, "judge example exceeded 10 seconds");
} finally {
  await Promise.all(agents.map((agent) => agent.dispose()));
}
