import { test } from "bun:test";
import assert from "node:assert/strict";
import { createSecretRedactor, type ProductionPersistenceStore, type RunFeedbackRecord, type RunFeedbackStore, type RunResult } from "@arnilo/prism";
import { calibrateJudge, createRubricJudge, labeledItemsFromFeedback, assertEvaluationThreshold, runExperiment, runComparison, defineDataset, type Scorer } from "../index.js";
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

const result: RunResult = { sessionId: "s", runId: "r", status: "completed", text: "answer", content: [], messages: [] };
const items = [0, 1, 0, 1].map((humanScore, i) => ({ item: { id: String(i), input: "question" }, result, humanScore }));
const judge: Scorer<string> = { id: "j", score: ({ item }) => ({ score: Number(item!.id) % 2 }) };

test("perfect_judge_kappa_one and constant_judge_kappa_zero", async () => {
  const report = await calibrateJudge({ judge, items, scale: "ordinal", seed: 1 });
  assert.equal(report.n, 4);
  assert.equal(report.cohensKappa, 1);
  assert.equal(report.weightedKappa, 1);
  assert.equal(report.krippendorffAlpha, 1);
  assert.equal(report.spearman, 1);
  assert.deepEqual(report.kappaCi95, { low: -1, high: 1 });
  assert.deepEqual(report.confusion, { labels: [0, 1], counts: [[2, 0], [0, 2]] });
  assert.deepEqual(report, await calibrateJudge({ judge, items, scale: "ordinal", seed: 1 }));
  const constant = await calibrateJudge({ judge: { id: "c", score: () => ({ score: 0 }) }, items });
  assert.equal(constant.cohensKappa, 0);
  assert.equal(constant.spearman, null);
  assert.equal(constant.weightedKappa, undefined);
});

test("calibration counts failed/invalid judges and handles missing evidence", async () => {
  const failed = await calibrateJudge({ judge: { id: "bad", score: () => { throw Error("private"); } }, items });
  assert.equal(failed.n, 0);
  assert.equal(failed.judgeFailures, 4);
  assert.equal(failed.cohensKappa, null);
  assert.equal(failed.kappaCi95, undefined);
  assert.ok(!JSON.stringify(failed).includes("private"));
  assert.equal((await calibrateJudge({ judge: { id: "bad", score: () => ({ score: NaN }) }, items })).judgeFailures, 4);
  const constant = await calibrateJudge({ judge: { id: "c", score: () => ({ score: 1 }) }, items: [items[1]!] });
  assert.equal(constant.cohensKappa, null);
  assert.equal(constant.krippendorffAlpha, null);
  await assert.rejects(calibrateJudge({ judge, items: [{ ...items[0]!, humanScore: NaN }] }));
  await assert.rejects(calibrateJudge({ judge, items, seed: .5 }));
});

test("calibration forwards redaction and cancellation without human labels", async () => {
  const controller = new AbortController();
  const redactor = createSecretRedactor(["SECRET"]);
  let calls = 0;
  await assert.rejects(calibrateJudge({ items, signal: controller.signal, redactor, judge: { id: "j", score(input) {
    calls++;
    assert.equal(input.redactor, redactor);
    assert.ok(!("humanScore" in input));
    controller.abort(Error("cancelled"));
    return { score: 1 };
  } } }), /cancelled/);
  assert.equal(calls, 1);
  await assert.rejects(calibrateJudge({ judge: { ...judge, requires: ["trace"] }, items }), /requires/);
});

const ownership = { tenantId: "t", userId: "u" };
const feedback: RunFeedbackRecord = { id: "f", runId: "r", sessionId: "s", ...ownership,
  rating: -1, comment: "PRIVATE COMMENT", tags: [], scorerIds: [], evaluationIds: [], createdAt: "2026-01-01" };
function sources(records = [feedback]) {
  const queries: unknown[] = [];
  const feedbackStore = { query: async (query: unknown) => { queries.push(query); return { items: records }; } } as unknown as RunFeedbackStore;
  const persistence = {
    queryRuns: async () => ({ items: [{ id: "r", sessionId: "s", status: "succeeded", startedAt: "2026-01-01", ...ownership }] }),
    queryEvents: async () => ({ items: ["user", "assistant"].map((role, i) => ({
      id: String(i), sessionId: "s", runId: "r", ...ownership, type: "message.completed", timestamp: "2026-01-01", redacted: true,
      event: { type: "message.completed", sessionId: "s", runId: "r", message: { role, content: [{ type: "text", text: "SECRET" }] } },
    })) }),
    queryUsage: async () => ({ items: [] }), queryToolCalls: async () => ({ items: [] }),
  } as unknown as ProductionPersistenceStore;
  return { feedbackStore, persistence, ownership, queries };
}

test("feedback_loader_respects_ownership and excludes comments and labels from judge input", async () => {
  const input = sources();
  const loaded = await labeledItemsFromFeedback({ ...input, query: { tag: "graded" }, secrets: ["SECRET"] });
  assert.equal(loaded[0]!.humanScore, 0);
  assert.equal(loaded[0]!.result.status, "completed");
  assert.ok(!JSON.stringify(loaded).includes("PRIVATE COMMENT"));
  assert.ok(!JSON.stringify(loaded).includes("SECRET"));
  assert.deepEqual(input.queries, [{ tag: "graded", ...ownership, limit: 100, cursor: undefined, signal: undefined }]);
  await assert.rejects(labeledItemsFromFeedback({ ...sources([{ ...feedback, tenantId: "other" }]) }), /ownership/);
  await assert.rejects(labeledItemsFromFeedback({ ...sources(), query: { tenantId: "other" } as never }), /ownership/);
  assert.deepEqual(await labeledItemsFromFeedback({ ...sources([{ ...feedback, rating: undefined }]) }), []);
  assert.equal((await labeledItemsFromFeedback({ ...sources(), toScore: () => .5 }))[0]!.humanScore, .5);
  await assert.rejects(labeledItemsFromFeedback({ ...sources(), ownership: {} }), /ownership/);
  await assert.rejects(labeledItemsFromFeedback({ ...sources(), traceLimits: { maxBytes: 1 } }), /byte limit/);
});

test("feedback loader bounds pagination and rejects mismatched run ownership", async () => {
  const input = sources();
  input.feedbackStore.query = async () => ({ items: [feedback], nextCursor: "again" });
  await assert.rejects(labeledItemsFromFeedback({ ...input, traceLimits: { maxPages: 1 } }), /page limit/);
  const wrong = sources();
  wrong.persistence.queryRuns = async () => ({ items: [{ id: "r", sessionId: "s", status: "succeeded", startedAt: "", tenantId: "other" }] });
  await assert.rejects(labeledItemsFromFeedback(wrong), /ownership/);
});

test("threshold_fails_uncalibrated_judge, lower CI bound, invalid evidence; ignores unused judges", async () => {
  const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])] });
  try {
    const experiment = await runExperiment({ agent, dataset: defineDataset({ id: "d", items: [items[0]!.item] }), scorers: [judge] });
    const calibration = await calibrateJudge({ judge, items });
    const gate = (report = calibration, minimumKappa = .6, minimumN?: number) =>
      assertEvaluationThreshold(experiment, { calibrations: { j: { report, minimumKappa, minimumN } } });
    assert.throws(() => gate(), /calibration/);
    assert.doesNotThrow(() => gate({ ...calibration, n: 30, kappaCi95: { low: .8, high: 1 } }));
    assert.throws(() => gate({ ...calibration, n: 30, kappaCi95: { low: .4, high: 1 } }), /calibration/);
    assert.throws(() => gate({ ...calibration, n: 30, cohensKappa: null, kappaCi95: undefined }), /calibration/);
    assert.throws(() => gate({ ...calibration, n: 30, kappaCi95: undefined, cohensKappa: .4 }), /calibration/);
    assert.doesNotThrow(() => gate({ ...calibration, n: 30, kappaCi95: undefined }));
    assert.throws(() => gate({ ...calibration, n: 30, kappaCi95: null as never }), /calibration/);
    const comparison = await runComparison({ dataset: defineDataset({ id: "d", items: [items[0]!.item] }),
      candidates: { a: async () => result, b: async () => result }, scorers: [{ id: "j", score: () => ({ preference: "left" }) }] });
    assert.throws(() => assertEvaluationThreshold(comparison, { calibrations: { j: { report: calibration, minimumKappa: .6 } } }), /calibration/);
    assert.throws(() => gate(calibration, NaN));
    assert.throws(() => gate(calibration, .5, 0));
    assert.throws(() => gate({ ...calibration, n: NaN }));
    assert.throws(() => gate({ ...calibration, n: 30, kappaCi95: { low: NaN, high: 1 } }));
    assert.doesNotThrow(() => assertEvaluationThreshold(experiment, { calibrations: { unused: { report: calibration, minimumKappa: .6 } } }));
  } finally { await agent.dispose(); }
});


test("feedback calibration with a rubric judge sends no comments, human labels, or secrets", async () => {
  const prompts: string[] = [];
  const agent = await createAgent({ model: { provider: "mock", model: "judge" }, packages: [mockProvider([
    [providerTextDelta(JSON.stringify({ reasoning: "Graded", label: "yes" })), providerDone()],
  ], { onRequest: request => prompts.push(JSON.stringify(request)) })] });
  try {
    const loaded = await labeledItemsFromFeedback({ ...sources(), secrets: ["SECRET"] });
    const report = await calibrateJudge({ items: loaded, secrets: ["SECRET"], judge: createRubricJudge({ agent,
      judgedModel: { provider: "mock", model: "candidate" }, rubric: { id: "j", version: "1", criteria: "Helpful answer", scale: [
        { label: "no", score: 0, description: "Unhelpful" }, { label: "yes", score: 1, description: "Helpful" },
      ] } }) });
    assert.equal(report.n, 1);
    assert.equal(prompts.length, 1);
    for (const forbidden of ["PRIVATE COMMENT", "humanScore", "SECRET"]) assert.ok(!prompts[0]!.includes(forbidden));
  } finally { await agent.dispose(); }
});
