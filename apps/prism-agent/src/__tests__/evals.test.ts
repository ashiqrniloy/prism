import { beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExperimentReportRecord } from "@arnilo/prism";
import { assertEvaluationThreshold, defineDataset, EvalDatasetError, EvalThresholdError, type ExperimentReport } from "@arnilo/prism-evals";
import { HOST_EVAL_DATASET, HOST_EVAL_ITEMS, type HostEvalItemExpected, type HostEvalItemInput } from "../../evals/dataset.js";
import {
  assertHostEvalDatasetMatchesBaseline,
  assertHostEvalGate,
  DEFAULT_BASELINE_PATH,
  enforceLiveEvalTokenCeiling,
  LIVE_EVAL_MAX_INPUT_TOKENS,
  loadHostEvalBaseline,
  reconstructReportFromRecord,
  runHostEvalSuite,
} from "../evals/suite.js";

let report: ExperimentReport<HostEvalItemInput, HostEvalItemExpected>;
let baseline: ExperimentReportRecord;
let baselineRawBefore: string;
let suiteCpuMs: number;

beforeAll(async () => {
  baselineRawBefore = readFileSync(DEFAULT_BASELINE_PATH, "utf8");
  baseline = loadHostEvalBaseline();
  const cpuBefore = process.cpuUsage();
  report = await runHostEvalSuite();
  const cpuDelta = process.cpuUsage(cpuBefore);
  suiteCpuMs = (cpuDelta.user + cpuDelta.system) / 1_000;
}, 120_000);

test("host_eval_suite_passes_invariants_and_pass_hat_k", () => {
  assert.equal(report.status, "succeeded");
  assert.equal(report.items.length, 12);
  assert.equal(report.aggregate.invariantsPassed, true);
  assertEvaluationThreshold(report, {
    requireInvariants: true,
    minimumPassHatK: {
      task_success: { k: 4, minimum: 1 },
      state_match: { k: 4, minimum: 1 },
    },
  });
  assert.ok(suiteCpuMs < 20_000, `expected offline host eval suite under 20s CPU budget, took ${Math.round(suiteCpuMs)}ms`);
  assert.equal(readFileSync(DEFAULT_BASELINE_PATH, "utf8"), baselineRawBefore, "running the eval test must never rewrite baseline.json");
});

test("host_eval_suite_does_not_regress_from_baseline", () => {
  assertHostEvalGate(report, baseline);

  const regressed: ExperimentReport<HostEvalItemInput, HostEvalItemExpected> = {
    ...report,
    items: report.items.map((item) => ({
      ...item,
      evaluations: item.evaluations.map((evaluation) =>
        evaluation.scorerId === "task_success" ? { ...evaluation, score: 0 } : evaluation,
      ),
    })),
  };
  const reconstructed = reconstructReportFromRecord(baseline, HOST_EVAL_DATASET);
  assert.throws(
    () =>
      assertEvaluationThreshold(regressed, {
        maximumRegression: { baseline: reconstructed, delta: 0.05 },
      }),
    (err: unknown) => err instanceof EvalThresholdError,
  );
});

test("host_eval_dataset_hash_matches_baseline", () => {
  assert.equal(HOST_EVAL_DATASET.contentHash, baseline.datasetContentHash);
  assertHostEvalDatasetMatchesBaseline(HOST_EVAL_DATASET, baseline);

  const mutated = defineDataset({
    id: HOST_EVAL_DATASET.id,
    version: HOST_EVAL_DATASET.version,
    items: HOST_EVAL_ITEMS.map((item, idx) =>
      idx === 0 ? { ...item, input: { ...item.input, prompt: `${item.input.prompt} (mutated)` } } : item,
    ),
  });
  assert.throws(
    () => assertHostEvalDatasetMatchesBaseline(mutated, baseline),
    (err: unknown) => err instanceof EvalDatasetError,
  );
});

test("planted_regression_fails_gate", async () => {
  const codingApproveSubset = defineDataset({
    id: HOST_EVAL_DATASET.id,
    version: HOST_EVAL_DATASET.version,
    items: HOST_EVAL_ITEMS.filter((item) => item.id === "coding-approve-greeting" || item.id === "coding-approve-version"),
  });
  const unapprovedReport = await runHostEvalSuite({
    dataset: codingApproveSubset,
    trials: 1,
    skipApproval: true,
  });
  assert.equal(unapprovedReport.aggregate.invariantsPassed, false);
  assert.throws(
    () =>
      assertEvaluationThreshold(unapprovedReport, {
        requireInvariants: true,
      }),
    (err: unknown) => err instanceof EvalThresholdError,
  );
});

test("live_eval_gate_row_enforces_token_ceiling", () => {
  enforceLiveEvalTokenCeiling({
    aggregate: {
      ...report.aggregate,
      cost: {
        inputTokens: LIVE_EVAL_MAX_INPUT_TOKENS,
        outputTokens: 1_000,
        totalTokens: LIVE_EVAL_MAX_INPUT_TOKENS + 1_000,
        costComplete: false,
        meanPerItem: {},
      },
    },
  });

  assert.throws(
    () =>
      enforceLiveEvalTokenCeiling({
        aggregate: {
          ...report.aggregate,
          cost: {
            inputTokens: LIVE_EVAL_MAX_INPUT_TOKENS + 1,
            outputTokens: 1_000,
            totalTokens: LIVE_EVAL_MAX_INPUT_TOKENS + 1_001,
            costComplete: false,
            meanPerItem: {},
          },
        },
      }),
    (err: unknown) => err instanceof EvalThresholdError,
  );
});
