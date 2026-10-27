import { test, expect } from "bun:test";
import { createSecretRedactor, type EvaluationRecord, type ExperimentReportRecord } from "@arnilo/prism";
import { createMemoryExperimentReportStore } from "../index.js";
import { createMemoryEvaluationStore } from "@arnilo/prism-store-codecs";

const owner = { tenantId: "tenant", userId: "user" };
const evaluation = (id: string): EvaluationRecord => ({
  ...owner,
  id,
  scorerId: "quality",
  status: "scored",
  score: 0.5,
  sampled: true,
  createdAt: "2026-10-27T00:00:00.000Z",
});
const summary = (id: string): ExperimentReportRecord => ({
  ...owner,
  id,
  datasetId: "data",
  createdAt: "2026-10-27T00:00:00.000Z",
  manifest: { runtimeRevision: "r1", datasetVersion: "v1" },
  aggregate: { itemCount: 1, scoredCount: 1, skippedCount: 0, failedCount: 0, scorers: {} },
  itemMeans: { item: { quality: 0.5 } },
});

test("memory_evaluation_store_conformance", async () => {
  const store = createMemoryEvaluationStore();
  for (const id of ["a", "b", "c"]) await store.append(evaluation(id));
  await expect(store.append(evaluation("a"))).rejects.toThrow();
  const first = await store.query({ ...owner, limit: 1 });
  expect(first.items.map((r) => r.id)).toEqual(["a"]);
  const second = await store.query({ ...owner, limit: 1, cursor: first.nextCursor });
  expect(second.items.map((r) => r.id)).toEqual(["b"]);
  expect((await store.query({ ...owner, order: "desc" })).items.map((r) => r.id)).toEqual(["c", "b", "a"]);
  expect((await store.query({ tenantId: owner.tenantId })).items).toEqual([]);
  expect((await store.query()).items).toEqual([]);
  expect((await store.query({ ...owner, userId: "other" })).items).toEqual([]);
  expect((await store.query({ ...owner, status: "failed" })).items).toEqual([]);
  await expect(store.query({ ...owner, cursor: "unknown" })).rejects.toThrow();
  await expect(store.query({ ...owner, limit: 0 })).rejects.toThrow();
  await expect(store.query({ ...owner, signal: AbortSignal.abort() })).rejects.toThrow();
});

test("latest_returns_newest_matching_dataset_and_owner", async () => {
  const store = createMemoryExperimentReportStore();
  await store.append(summary("a"));
  await store.append({ ...summary("b"), createdAt: "2026-10-28T00:00:00.000Z" });
  await store.append({ ...summary("c"), userId: "other" });
  await store.append({ ...summary("d"), datasetId: "other" });
  expect((await store.latest({ ...owner, datasetId: "data", manifestMatch: { runtimeRevision: "r1" } }))?.id).toBe("b");
  expect(await store.latest({ ...owner, datasetId: "data", manifestMatch: { runtimeRevision: "r2" } })).toBeUndefined();
  expect(await store.latest({ datasetId: "data" })).toBeUndefined();
  await expect(store.append(summary("a"))).rejects.toThrow();
  const first = await store.query({ ...owner, datasetId: "data", limit: 1 });
  expect((await store.query({ ...owner, datasetId: "data", cursor: first.nextCursor })).items[0]?.id).toBe("b");
});

test("stores_validate_redact_bound_and_detach_records", async () => {
  const record = { ...evaluation("a"), reason: "secret-value", metadata: { text: "secret-value" } };
  const store = createMemoryEvaluationStore([record], { redactor: createSecretRedactor(["secret-value"]) });
  record.metadata.text = "changed";
  const stored = (await store.query(owner)).items[0]!;
  expect(JSON.stringify(stored)).not.toContain("secret-value");
  expect(JSON.stringify(stored)).not.toContain("changed");
  expect(Object.isFrozen(stored.metadata)).toBe(true);
  await expect(store.append({ ...evaluation("bad"), score: NaN })).rejects.toThrow();
  await expect(store.append({ ...evaluation("bad"), createdAt: "invalid" })).rejects.toThrow();
  await expect(store.append({ ...evaluation("bad"), reason: "x".repeat(1024 * 1024) })).rejects.toThrow();
  expect(() => createMemoryEvaluationStore([evaluation("a"), evaluation("a")])).toThrow();
  const reports = createMemoryExperimentReportStore();
  await expect(reports.append({ ...summary("bad"), itemMeans: { item: { quality: Infinity } } })).rejects.toThrow();
  await reports.append({ ...summary("offset"), createdAt: "2026-10-27T02:00:00+03:00" });
  await reports.append(summary("utc"));
  expect((await reports.latest({ ...owner, datasetId: "data" }))?.id).toBe("utc");
  await expect(
    reports.append({
      ...summary("bad-stats"),
      aggregate: { ...summary("x").aggregate, scorers: { quality: { items: 1, records: 1, mean: 2, passRate: 1, method: "wilson" } } },
    }),
  ).rejects.toThrow();
  await expect(reports.append({ ...summary("big"), metadata: { text: "x".repeat(1024 * 1024) } })).rejects.toThrow();
});

import { evaluationStoreConformance } from "../index.js";
test("shared memory evaluation conformance", () =>
  evaluationStoreConformance(() => ({
    evaluations: createMemoryEvaluationStore(),
    experiments: createMemoryExperimentReportStore(),
  })));
