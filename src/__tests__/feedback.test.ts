import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMemoryRunFeedbackStore, createSecretRedactor, RunFeedbackError, type RunFeedbackRunResolver } from "../index.js";
import { runFeedbackConformance } from "../testing/feedback.js";

const owner = { tenantId: "feedback-tenant", userId: "feedback-user" } as const;
const runs: RunFeedbackRunResolver = async ({ runId, ownership }) =>
  runId === "feedback-run-a" && ownership.tenantId === owner.tenantId && ownership.userId === owner.userId
    ? { runId, sessionId: "session-a", traceId: "trace-a", ...owner }
    : false;

describe("run feedback", () => {
  test("passes shared memory conformance", async () => {
    await runFeedbackConformance(() => createMemoryRunFeedbackStore({ resolveRun: runs }));
  });

  test("redacts and freezes bounded immutable records", async () => {
    const store = createMemoryRunFeedbackStore({
      resolveRun: runs,
      redactor: createSecretRedactor(["canary-secret"]),
    });
    const record = await store.append({
      id: "feedback-redacted",
      runId: "feedback-run-a",
      sessionId: "session-a",
      traceId: "trace-a",
      rating: 0.5,
      comment: "contains canary-secret",
      tags: ["canary-secret"],
      metadata: { note: "canary-secret", nested: { value: "fixed" } },
      ...owner,
    });
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.tags), true);
    assert.doesNotMatch(JSON.stringify(record), /canary-secret/);
    assert.throws(() => (record.tags as string[]).push("mutate"));
    assert.throws(() => { ((record.metadata?.nested as { value: string }).value) = "mutate"; });
  });

  test("rejects missing/cross-owned runs, invalid bounds, duplicates, and empty input", async () => {
    const store = createMemoryRunFeedbackStore({ resolveRun: runs, maxCommentBytes: 4 });
    await assert.rejects(store.append({ id: "missing", runId: "nope", rating: 1, ...owner }), (error: unknown) =>
      error instanceof RunFeedbackError && error.code === "ERR_PRISM_RUN_FEEDBACK_RUN_NOT_FOUND");
    await assert.rejects(store.append({ id: "cross", runId: "feedback-run-a", rating: 1, tenantId: owner.tenantId, userId: "other" }));
    await assert.rejects(store.append({ id: "rating", runId: "feedback-run-a", rating: 2, ...owner }));
    await assert.rejects(store.append({ id: "large", runId: "feedback-run-a", comment: "large", ...owner }));
    await assert.rejects(store.append({ id: "empty", runId: "feedback-run-a", ...owner }));
    await store.append({ id: "duplicate", runId: "feedback-run-a", rating: 1, ...owner });
    await assert.rejects(store.append({ id: "duplicate", runId: "feedback-run-a", rating: 1, ...owner }));
  });

  test("filters, orders, paginates, deletes, and honors abort", async () => {
    const store = createMemoryRunFeedbackStore({ resolveRun: runs });
    await store.append({ id: "first", runId: "feedback-run-a", rating: 1, scorerIds: ["score-a"], createdAt: "2026-01-01T00:00:00Z", ...owner });
    await store.append({ id: "second", runId: "feedback-run-a", rating: -1, tags: ["bad"], createdAt: "2026-01-02T00:00:00Z", ...owner });
    assert.equal((await store.query({ ...owner, scorerId: "score-a" })).items[0]?.id, "first");
    assert.equal((await store.query({ ...owner, tag: "bad" })).items[0]?.id, "second");
    assert.deepEqual((await store.query({ ...owner, order: "desc" })).items.map((item) => item.id), ["second", "first"]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(store.query({ ...owner, signal: controller.signal }));
    assert.equal(await store.delete({ id: "second", ...owner }), true);
    assert.equal((await store.query(owner)).items.length, 1);
  });
});
