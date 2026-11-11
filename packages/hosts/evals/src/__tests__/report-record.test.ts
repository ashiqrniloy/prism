import { test, expect } from "bun:test";
import { createAgent, providerTextDelta, providerDone } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createMemoryExperimentReportStore } from "@arnilo/prism-extensions/store-codecs";
import { defineDataset, defineScorer, runExperiment, toExperimentReportRecord, type ExperimentReport } from "../index.js";

function report(): ExperimentReport {
  const row = {
    id: "e",
    scorerId: "quality",
    status: "scored" as const,
    score: 0.5,
    sampled: true,
    reason: "PRIVATE reason",
    metadata: { private: "PRIVATE metadata" },
    createdAt: "2026-10-27",
  };
  return {
    experimentId: "experiment",
    datasetId: "dataset",
    datasetVersion: "v1",
    datasetContentHash: "hash",
    status: "succeeded",
    items: [
      {
        item: { id: "item", input: "PRIVATE input", expected: "PRIVATE expected" },
        trials: [],
        evaluations: [row, { ...row, id: "e2", score: 1 }],
      },
    ],
    evaluations: [row],
    aggregate: { itemCount: 1, scoredCount: 2, skippedCount: 0, failedCount: 0, scorers: {} },
  };
}

test("experiment_summary_contains_no_text", () => {
  const input = report();
  const summary = toExperimentReportRecord(input);
  expect(JSON.stringify(summary)).not.toContain("PRIVATE");
  expect(summary.itemMeans).toEqual({ item: { quality: 0.75 } });
  expect(summary.datasetContentHash).toBe("hash");
  expect(summary).not.toHaveProperty("evaluations");
  expect(summary).not.toHaveProperty("items");
  const withUsage = toExperimentReportRecord({
    ...input,
    aggregate: {
      ...input.aggregate,
      cost: {
        inputTokens: 1,
        metadata: { private: "PRIVATE".repeat(200_000) },
        costComplete: false,
        meanPerItem: { inputTokens: 1, metadata: { private: "PRIVATE" } },
      },
    },
  });
  expect(JSON.stringify(withUsage)).not.toContain("PRIVATE");
  expect(withUsage.aggregate.cost?.inputTokens).toBe(1);
  expect(summary.createdAt).toBeDefined();
  expect(() => toExperimentReportRecord({ ...input, items: [input.items[0]!, input.items[0]!] })).toThrow();
  const excluded = {
    ...input,
    items: [
      {
        ...input.items[0]!,
        evaluations: [
          ...input.items[0]!.evaluations,
          { ...input.evaluations[0]!, status: "failed" as const, score: 0 },
          { ...input.evaluations[0]!, status: "skipped" as const, score: 0 },
        ],
      },
    ],
  };
  expect(toExperimentReportRecord(excluded).itemMeans).toEqual({ item: { quality: 0.75 } });
});

test("summary_over_cap_throws", () => {
  const input = report();
  const oversized = { ...input, items: [{ ...input.items[0]!, item: { ...input.items[0]!.item, id: "x".repeat(1024 * 1024) } }] };
  expect(() => toExperimentReportRecord(oversized)).toThrow(expect.objectContaining({ code: "ERR_PRISM_EVAL_REPORT_BOUNDS" }));
});

test("runExperiment_writes_one_summary_and_propagates_store_failure", async () => {
  const agent = await createAgent({
    model: { provider: "mock", model: "mock" },
    packages: [mockProvider([[providerTextDelta("hello"), providerDone()]])],
  });
  const dataset = defineDataset({ id: "data", items: [{ id: "a", input: "hello" }] });
  const scorer = defineScorer({ id: "quality", score: () => ({ score: 1 }) });
  const owner = { tenantId: "tenant", userId: "user" };
  const store = createMemoryExperimentReportStore();
  let writes = 0;
  const experimentStore = {
    ...store,
    async append(record: Parameters<typeof store.append>[0]) {
      writes++;
      await store.append(record);
    },
  };
  const result = await runExperiment({ agent, dataset, scorers: [scorer], experimentStore, ownership: owner });
  expect(writes).toBe(1);
  const stored = await store.latest({ ...owner, datasetId: dataset.id });
  expect(stored?.id).toBe(result.experimentId);
  expect(stored?.itemMeans).toEqual({ a: { quality: 1 } });
  await expect(
    runExperiment({
      agent,
      dataset,
      scorers: [scorer],
      experimentStore: {
        ...store,
        append() {
          throw new Error("write failed");
        },
      },
    }),
  ).rejects.toThrow("write failed");
  const aborted = await runExperiment({
    agent,
    dataset,
    scorers: [scorer],
    experimentStore,
    ownership: owner,
    signal: AbortSignal.abort(new Error("stop")),
  });
  expect(aborted.status).toBe("aborted");
  expect(writes).toBe(2);
  await agent.dispose();
});
