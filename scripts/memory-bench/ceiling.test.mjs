import { test } from "bun:test";
import assert from "node:assert/strict";
import { ceilingReport, retrievalStage } from "./ceiling.mjs";

const row = (id, ability, correct, evidence = {}, verdicts = { a: correct ? "yes" : "no", b: correct ? "yes" : "no" }) => ({
  id,
  ability,
  correct,
  evidenceCounts: evidence,
  judgeVerdicts: verdicts,
  // Text a leak would show up as:
  question: "SECRET QUESTION TEXT",
  answer: "SECRET ANSWER TEXT",
});

test("ceiling_report_pairs_recall_and_oracle_per_question_and_carries_no_text", () => {
  const recall = {
    suite: "locomo",
    model: "m",
    results: [
      row("q1", "temporal", true),
      row("q2", "temporal", false, { candidateGold: 0, selectedGold: 0 }),
      row("q3", "multi-hop", false, { candidateGold: 2, selectedGold: 0 }),
      row("q4", "multi-hop", false, { candidateGold: 1, selectedGold: 1 }, { a: "yes", b: "no" }),
      row("q5", "single-hop", true),
      { id: "qx", ability: "single-hop", outcome: "run_limit" }, // not scored: dropped from both sides
    ],
  };
  const oracle = { results: [row("q1", "temporal", true), row("q2", "temporal", true), row("q3", "multi-hop", false), row("q4", "multi-hop", true), row("q5", "single-hop", false)] };
  const report = ceilingReport({ recall, oracle });
  assert.equal(report.n, 5);
  assert.equal(report.recall.correct, 2);
  assert.equal(report.oracle.correct, 3);
  assert.equal(report.gapPoints, 20);
  assert.deepEqual(report.paired, { recallRightOracleRight: 1, recallWrongOracleRight: 2, recallRightOracleWrong: 1, bothWrong: 1 });
  assert.deepEqual(report.recallWrongByStage, { neverCandidate: 1, candidateNotShown: 1, shownToModel: 1 });
  assert.deepEqual(report.recall.byAbility["multi-hop"], { n: 2, correct: 0 });
  assert.deepEqual(report.oracle.byAbility["multi-hop"], { n: 2, correct: 1 });
  assert.equal(report.judgeTies.recall, 1);
  assert.equal(JSON.stringify(report).includes("SECRET"), false, "no question or answer text in the report");
  assert.equal(retrievalStage({ evidenceCounts: {} }), "neverCandidate");
  assert.throws(() => ceilingReport({ recall: { results: [row("a", "x", true)] }, oracle: { results: [row("b", "x", true)] } }), /share no scored question/);
});
