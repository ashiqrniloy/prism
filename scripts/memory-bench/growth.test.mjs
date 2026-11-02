import { test } from "bun:test";
import assert from "node:assert/strict";
import { renderGrowthMarkdown, runGrowth } from "./growth.mjs";

function syntheticRow(sessions = 36) {
  return {
    id: "monthly",
    question: "What did we decide about the monthly release?",
    answerSessionIds: [],
    sessions: Array.from({ length: sessions }, (_, index) => ({
      id: `raw-${index}`,
      date: `2025-${String((index % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      messages: [
        {
          id: `raw-${index}:u`,
          role: "user",
          text: `unique${index}alpha unique${index}bravo unique${index}charlie unique${index}delta unique${index}echo unique${index}foxtrot`,
        },
        { id: `raw-${index}:a`, role: "assistant", text: `recorded unique${index}answer` },
      ],
    })),
  };
}

test("growth_month12_criterion_evaluated", async () => {
  const report = await runGrowth({ rows: [syntheticRow()], maxQuestions: 1, hotTokens: 100, source: "test-fixture" });
  assert.equal(report.modelCalls, 0);
  assert.equal(report.exchanges, 36);
  assert.deepEqual(Object.keys(report.snapshots).map(Number), [1, 6, 12]);
  assert.equal(report.snapshots[1].accuracy, 1, "month-1 content is active at month 1");
  assert.ok(report.snapshots[6].archived + report.snapshots[6].demoted > 0, "maintenance acted by month 6");
  assert.ok(report.snapshots[12].archived + report.snapshots[12].demoted > 0, "maintenance acted by month 12");
  assert.ok(report.criterion.pass, "month-12 accuracy stays within 3 points of month 1");
  assert.ok(report.snapshots[12].accuracy >= report.snapshots[1].accuracy - 0.03);
  assert.equal(report.snapshots[12].archivedInclusiveAccuracy, 1, "the demoted month-1 exchanges remain searchable");
  assert.match(renderGrowthMarkdown(report), /Criterion.*PASS/);
});
