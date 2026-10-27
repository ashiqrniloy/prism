import assert from "node:assert/strict";
import type { EvaluationRecord, EvaluationStore, ExperimentReportRecord, ExperimentReportStore } from "@arnilo/prism";

/** Shared contract for memory and SQL evaluation capabilities; the factory returns empty stores. */
export async function evaluationStoreConformance(
  factory: () =>
    | { evaluations: EvaluationStore; experiments: ExperimentReportStore }
    | Promise<{ evaluations: EvaluationStore; experiments: ExperimentReportStore }>,
): Promise<void> {
  const { evaluations, experiments } = await factory();
  const owner = { tenantId: "eval-tenant", accountId: "eval-account", userId: "eval-user" };
  const evaluation = (id: string): EvaluationRecord => ({
    ...owner,
    id,
    scorerId: "quality",
    status: "scored",
    score: 0.5,
    sampled: true,
    runId: "run",
    sessionId: "session",
    experimentId: "experiment",
    datasetId: "data",
    itemId: "item",
    createdAt: "2026-10-27T00:00:00.000Z",
    reason: "review",
    metadata: { nested: { value: 1 } },
  });
  for (const id of ["a", "b", "c"]) await evaluations.append(evaluation(id));
  await evaluations.append({ ...evaluation("offset"), createdAt: "2026-10-27T02:00:00+03:00" });
  await assert.rejects(async () => evaluations.append(evaluation("a")));
  await assert.rejects(async () => evaluations.append({ ...evaluation("invalid"), score: NaN }));
  await assert.rejects(async () => evaluations.append({ ...evaluation("big"), reason: "x".repeat(1024 * 1024) }));
  for (const order of ["asc", "desc"] as const) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await evaluations.query({ ...owner, order, limit: 1, cursor });
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      assert.ok(ids.length <= 4, "cursor must advance");
    } while (cursor);
    assert.deepEqual(ids, order === "asc" ? ["offset", "a", "b", "c"] : ["c", "b", "a", "offset"]);
  }
  const stored = (await evaluations.query({ ...owner, id: "a" })).items[0]!;
  assert.deepEqual(stored, evaluation("a"));
  assert.ok(Object.isFrozen(stored.metadata));
  for (const scope of [
    {},
    { tenantId: owner.tenantId },
    { ...owner, tenantId: "other" },
    { ...owner, accountId: "other" },
    { ...owner, userId: "other" },
  ]) {
    assert.deepEqual((await evaluations.query(scope)).items, []);
  }
  for (const key of ["scorerId", "runId", "sessionId", "experimentId", "datasetId", "itemId"] as const) {
    assert.equal((await evaluations.query({ ...owner, [key]: evaluation("a")[key] })).items.length, 4);
    assert.deepEqual((await evaluations.query({ ...owner, [key]: "other" })).items, []);
  }
  assert.equal((await evaluations.query({ ...owner, status: ["scored", "failed"] })).items.length, 4);
  assert.deepEqual((await evaluations.query({ ...owner, status: [] })).items, []);
  await assert.rejects(async () => evaluations.query({ ...owner, limit: 0 }));
  await assert.rejects(async () => evaluations.query({ ...owner, order: "bad" as "asc" }));
  await assert.rejects(async () => evaluations.query({ ...owner, cursor: "unknown" }));
  await assert.rejects(async () => evaluations.query({ ...owner, signal: AbortSignal.abort() }));
  await evaluations.append({ ...evaluation("local"), tenantId: undefined, accountId: undefined, userId: undefined });
  assert.deepEqual(
    (await evaluations.query()).items.map((row) => row.id),
    ["local"],
  );

  const report = (id: string): ExperimentReportRecord => ({
    ...owner,
    id,
    datasetId: "data",
    datasetVersion: "v1",
    datasetContentHash: "hash",
    createdAt: "2026-10-27T00:00:00.000Z",
    manifest: { runtimeRevision: "r1", datasetVersion: "v1" },
    aggregate: { itemCount: 1, scoredCount: 1, skippedCount: 0, failedCount: 0, scorers: {} },
    itemMeans: { item: { quality: 0.5 } },
  });
  await experiments.append(report("a"));
  await experiments.append({ ...report("b"), createdAt: "2026-10-28T00:00:00.000Z" });
  await experiments.append({ ...report("c"), userId: "other" });
  await experiments.append({ ...report("d"), datasetId: "other" });
  await assert.rejects(async () => experiments.append(report("a")));
  await assert.rejects(async () => experiments.append({ ...report("big"), metadata: { value: "x".repeat(1024 * 1024) } }));
  assert.equal((await experiments.latest({ ...owner, datasetId: "data", manifestMatch: { runtimeRevision: "r1" } }))?.id, "b");
  assert.equal(await experiments.latest({ ...owner, datasetId: "data", manifestMatch: { runtimeRevision: "r2" } }), undefined);
  assert.equal(await experiments.latest({ datasetId: "data" }), undefined);
  assert.equal(await experiments.latest({ ...owner, datasetId: "data", datasetVersion: "v2" }), undefined);
  assert.equal(await experiments.latest({ ...owner, datasetId: "data", datasetContentHash: "other" }), undefined);
  const first = await experiments.query({ ...owner, datasetId: "data", limit: 1 });
  assert.deepEqual(first.items[0], report("a"));
  assert.equal((await experiments.query({ ...owner, datasetId: "data", cursor: first.nextCursor })).items[0]?.id, "b");
  assert.equal((await experiments.query({ ...owner, id: "b" })).items.length, 1);
}
