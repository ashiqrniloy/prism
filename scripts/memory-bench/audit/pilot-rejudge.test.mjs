import { test } from "bun:test";
import assert from "node:assert/strict";
import { completePilotScoring } from "./pilot-rejudge.mjs";

test("pilot_rejudge_preserves_the_answer_and_charges_failed_evaluation", () => {
  const source = {
    usage: { inputTokens: 100, outputTokens: 20, wireAttempts: 3 },
    timing: { wallMs: 1000 },
    cells: [
      {
        jobId: "full.q",
        config: "full",
        id: "q",
        cluster: "c",
        ability: "summarization",
        answerKey: "saved",
        outcome: "evaluation_error",
        evaluationUsage: { inputTokens: 40, outputTokens: 10, wireAttempts: 2 },
        phaseTiming: { answer: 500, evaluation: 400 },
      },
      {
        jobId: "fabric-x.q",
        config: "fabric-x",
        id: "q",
        cluster: "c",
        ability: "summarization",
        correct: true,
        graded: 0.8,
        outcome: "completed",
      },
    ],
  };
  const completion = {
    status: "completed",
    jobId: "full.q",
    answerKey: "saved",
    correct: false,
    graded: 0.4,
    binary: { a: "no", b: "no" },
    gradedJudges: { a: 0.3, b: 0.5 },
    usage: { inputTokens: 30, outputTokens: 5, wireAttempts: 4 },
    timing: { wallMs: 200 },
  };
  const combined = completePilotScoring(source, completion);
  assert.equal(source.cells[0].outcome, "evaluation_error", "original attempt remains immutable");
  assert.equal(combined.cells[0].outcome, "completed");
  assert.equal(combined.cells[0].answerKey, "saved");
  assert.equal(combined.cells[0].evaluationUsage.inputTokens, 70);
  assert.equal(combined.usage.wireAttempts, 7);
  assert.equal(combined.comparisons[1].graded.diff, 0.4);
  assert.throws(() => completePilotScoring(source, { ...completion, answerKey: "another-answer" }), /checkpoint/);
  assert.throws(() => completePilotScoring(source, { ...completion, graded: undefined }), /score/);
  assert.throws(() => completePilotScoring(source, { ...completion, status: "evaluation_error" }), /completed/);
});
