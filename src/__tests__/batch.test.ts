import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBatchJobsSupported,
  type BatchJob,
  BatchJobsError,
  type BatchJobsProvider,
  type BatchResultItem,
  isBatchJobTerminal,
  modelSupportsBatchJobs,
  pollBatch,
} from "../contracts.js";
import { runBatchJobsConformance } from "../testing/provider-conformance.js";

type FakeState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Plan acceptance criterion: conformance-adjacent fake with full lifecycle —
 *  submitted → in_progress → completed with paged results; cancel mid-run;
 *  failure terminal surfaces typed errors. */
function fakeBatchProvider(
  options: { resultCustomIds?: string[]; pageSize?: number; failAfterStatuses?: number } = {},
): BatchJobsProvider & { cancelled: Set<string> } {
  const jobs = new Map<string, { state: FakeState; statuses: number }>();
  const cancelled = new Set<string>();
  let seq = 0;
  const ids = options.resultCustomIds ?? ["req-a", "req-b", "req-c", "req-d"];
  return {
    id: "fake",
    cancelled,
    async submit(request) {
      if (request.requests.length === 0) throw new BatchJobsError("empty_requests", "empty");
      if (request.requests.length > 100) throw new BatchJobsError("too_many_requests", "cap");
      const id = `job-${seq++}`;
      jobs.set(id, { state: "queued", statuses: 0 });
      return { id, state: "queued", requestCounts: { total: request.requests.length, completed: 0, failed: 0 }, raw: { provider: "fake" } };
    },
    async status(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new BatchJobsError("job_not_found", `unknown job ${jobId}`);
      if (cancelled.has(jobId)) {
        job.state = "cancelled";
        return { id: jobId, state: "cancelled" };
      }
      job.statuses += 1;
      if (options.failAfterStatuses !== undefined && job.statuses >= options.failAfterStatuses) job.state = "failed";
      else if (job.state === "queued") job.state = "running";
      else if (job.state === "running") job.state = "completed";
      const state: BatchJob["state"] = job.state;
      return {
        id: jobId,
        state,
        requestCounts: { total: ids.length, completed: state === "completed" ? ids.length : 0, failed: 0 },
        raw: {},
      };
    },
    async cancel(jobId) {
      if (!jobs.has(jobId)) throw new BatchJobsError("job_not_found", `unknown job ${jobId}`);
      cancelled.add(jobId);
      return { id: jobId, state: "cancelled" };
    },
    async results(jobId, resultsOptions = {}) {
      if (!jobs.has(jobId)) throw new BatchJobsError("job_not_found", `unknown job ${jobId}`);
      const cursor = resultsOptions.cursor ? Number(resultsOptions.cursor) : 0;
      if (!Number.isInteger(cursor) || cursor < 0 || cursor > ids.length) throw new BatchJobsError("invalid_cursor", "bad cursor");
      const pageSize = options.pageSize ?? 2;
      const items: BatchResultItem[] = ids.slice(cursor, cursor + pageSize).map((customId) => ({
        customId,
        response: { status: 200, body: { ok: true } },
        raw: { custom_id: customId },
      }));
      const next = cursor + pageSize;
      return { items, nextCursor: next < ids.length ? String(next) : null };
    },
  };
}

describe("batch jobs contract", () => {
  it("modelSupportsBatchJobs_requires_explicit_capability_flag", () => {
    assert.equal(modelSupportsBatchJobs(undefined), false);
    assert.equal(modelSupportsBatchJobs({}), false);
    assert.equal(modelSupportsBatchJobs({ batchJobs: true }), true);
  });

  it("assertBatchJobsSupported_throws_typed_unsupported_model_error", () => {
    const model = { provider: "openai", model: "gpt-batch", capabilities: { moderation: true } };
    assert.throws(
      () => assertBatchJobsSupported(model),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "unsupported_model");
        return true;
      },
    );
  });

  it("isBatchJobTerminal_covers_all_four_terminal_states", () => {
    for (const state of ["completed", "failed", "cancelled", "expired"] as const) {
      assert.equal(isBatchJobTerminal({ state }), true, state);
    }
    for (const state of ["queued", "running", "cancelling"] as const) {
      assert.equal(isBatchJobTerminal({ state }), false, state);
    }
  });

  it("fake_lifecycle_progresses_queued_running_completed_with_paged_results", async () => {
    const provider = fakeBatchProvider({ pageSize: 2 });
    const job = await provider.submit({ model: "fake-batch", requests: [{ body: {} }, { body: {} }] });
    assert.equal(job.state, "queued");
    await provider.status(job.id);
    await provider.status(job.id);
    const page1 = await provider.results(job.id, { cursor: null });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.nextCursor, "2");
    const page2 = await provider.results(job.id, { cursor: page1.nextCursor });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.nextCursor, null, "paging walks to exhaustion");
  });

  it("cancel_mid_run_surfaces_cancelled_terminal", async () => {
    const provider = fakeBatchProvider();
    const job = await provider.submit({ model: "fake-batch", requests: [{ body: {} }] });
    await provider.status(job.id);
    const cancelled = await provider.cancel(job.id);
    assert.equal(cancelled.state, "cancelled");
    await assert.rejects(
      () => pollBatch(provider, job.id, { intervalMs: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "job_cancelled");
        return true;
      },
    );
  });

  it("failure_terminal_surfaces_typed_job_failed_error", async () => {
    const provider = fakeBatchProvider({ failAfterStatuses: 1 });
    const job = await provider.submit({ model: "fake-batch", requests: [{ body: {} }] });
    await assert.rejects(
      () => pollBatch(provider, job.id, { intervalMs: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "job_failed");
        return true;
      },
    );
  });

  it("pollBatch_reports_job_not_found_typed", async () => {
    await assert.rejects(
      () => pollBatch(fakeBatchProvider(), "missing", { intervalMs: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "job_not_found");
        return true;
      },
    );
  });

  it("runBatchJobsConformance_passes_fake_lifecycle_and_rejects_broken_providers", async () => {
    await runBatchJobsConformance({
      provider: fakeBatchProvider(),
      maxRequests: 100,
      sample: { model: "fake-batch", requests: [{ body: {} }, { body: {} }] },
    });
    const noPages: BatchJobsProvider = fakeBatchProvider({ resultCustomIds: [] });
    await assert.rejects(
      () => runBatchJobsConformance({ provider: noPages, sample: { model: "m", requests: [{ body: {} }] } }),
      /at least one result item/,
    );
  });
});
