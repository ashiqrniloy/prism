import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BatchJobsError, pollBatch } from "@arnilo/prism";
import { runBatchJobsConformance } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIBatchJobsProvider, OPENAI_BATCH_COMPLETION_WINDOW, OPENAI_BATCH_MAX_REQUESTS } from "../index.js";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: Record<string, unknown> | FormData;
}

function jsonBody(request: CapturedRequest): Record<string, unknown> {
  if (request.body instanceof FormData) throw new Error(`expected JSON body for ${request.url}`);
  return request.body;
}

/** Route-based fake transport covering the batch lifecycle: files.upload →
 *  batches.create → status → cancel → results download. */
function openaiBatchFetch(lines: string[], options: { statusSequence?: string[]; failJob?: boolean } = {}) {
  const requests: CapturedRequest[] = [];
  let statusCalls = 0;
  const statuses = options.statusSequence ?? ["validating", "in_progress", "completed"];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method as string) ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    requests.push({ method, url, headers, body });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

    if (url.endsWith("/files") && method === "POST") return json({ id: "file-input-1", object: "file" });
    if (url.endsWith("/batches") && method === "POST") {
      return json({ id: "batch-1", status: "validating", request_counts: { total: 2, completed: 0, failed: 0 } });
    }
    if (url.endsWith("/batches/batch-1/cancel")) return json({ id: "batch-1", status: "cancelling" });
    if (url.endsWith("/batches/batch-1")) {
      const state = options.failJob ? "failed" : (statuses[Math.min(statusCalls, statuses.length - 1)] as string);
      statusCalls += 1;
      return json({
        id: "batch-1",
        status: state,
        request_counts: { total: 2, completed: state === "completed" ? 2 : 0, failed: options.failJob ? 2 : 0 },
        error: options.failJob ? { code: "jobs_failed", message: "all requests failed" } : undefined,
        output_file_id: state === "completed" ? "file-output-1" : undefined,
        error_file_id: options.failJob ? "file-error-1" : undefined,
      });
    }
    if (url.endsWith("/files/file-output-1/content") || url.endsWith("/files/file-error-1/content")) {
      return new Response(`${lines.join("\n")}\n`, { status: 200 });
    }
    return json({ error: { message: `unrouted ${method} ${url}` } }, 404);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const RESULT_LINES = [
  JSON.stringify({ id: "r1", custom_id: "req-a", response: { status_code: 200, request_id: "x", body: { choices: [] } } }),
  JSON.stringify({ id: "r2", custom_id: "req-b", response: { status_code: 200, request_id: "y", body: { choices: [] } } }),
  JSON.stringify({ id: "r3", custom_id: "req-c", error: { code: "rate_limited", message: "too many" } }),
];

function provider(fetchImpl: typeof fetch) {
  return createOpenAIBatchJobsProvider({ apiKey: "sk-openai-secret", fetch: fetchImpl });
}

describe("createOpenAIBatchJobsProvider", () => {
  it("submit_uploads_jsonl_then_creates_batch_with_metadata", async () => {
    const { fetchImpl, requests } = openaiBatchFetch(RESULT_LINES);
    const job = await provider(fetchImpl).submit({
      model: "gpt-4o-mini",
      requests: [{ customId: "req-a", body: { messages: [{ role: "user", content: "hi" }] } }, { body: { messages: [] } }],
      metadata: { priority: "high" },
    });
    assert.equal(job.id, "batch-1");
    assert.equal(job.state, "queued", "validating maps to neutral queued");
    const upload = requests[0];
    assert.equal(`${upload.method} ${new URL(upload.url).pathname}`, "POST /v1/files", "JSONL lands via Files API");
    assert.equal(requests[0].body instanceof FormData, true);
    const create = requests[1];
    assert.equal(`${create.method} ${new URL(create.url).pathname}`, "POST /v1/batches");
    const createBody = jsonBody(create);
    assert.equal(createBody.input_file_id, "file-input-1");
    assert.equal(createBody.endpoint, "/v1/chat/completions");
    assert.equal(createBody.completion_window, OPENAI_BATCH_COMPLETION_WINDOW);
    assert.deepEqual(createBody.metadata, { priority: "high" });
  });

  it("status_maps_provider_states_to_neutral_union", async () => {
    const { fetchImpl } = openaiBatchFetch(RESULT_LINES, { statusSequence: ["in_progress"] });
    const job = await provider(fetchImpl).status("batch-1");
    assert.equal(job.state, "running");
    assert.deepEqual(job.requestCounts, { total: 2, completed: 0, failed: 0 });
  });

  it("results_pages_jsonl_lines_with_opaque_line_offset_cursor", async () => {
    const { fetchImpl, requests } = openaiBatchFetch(RESULT_LINES, { statusSequence: ["completed"] });
    const batch = provider(fetchImpl);
    const page1 = await batch.results("batch-1", { cursor: null, pageSize: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.nextCursor, "2", "cursor is a line-offset continuation token");
    assert.equal(page1.items[0]?.customId, "req-a");
    assert.equal(page1.items[1]?.response?.status_code, 200, "provider-native response rides through");
    assert.equal(page1.job?.state, "completed");
    const page2 = await batch.results("batch-1", { cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, null);
    assert.equal(page2.items[0]?.customId, "req-c", "per-item errors ride alongside completed jobs");
    assert.equal(page2.items[0]?.error?.code, "rate_limited");
    const download = requests.find((request) => request.url.includes("/files/file-output-1/content"));
    assert.ok(download, "results fetched from the output file");
  });

  it("results_without_output_file_returns_empty_page", async () => {
    const { fetchImpl } = openaiBatchFetch(RESULT_LINES, { statusSequence: ["validating"] });
    const page = await provider(fetchImpl).results("batch-1", { cursor: null });
    assert.deepEqual(page.items, []);
    assert.equal(page.nextCursor, null);
  });

  it("cancel_maps_cancelling_state", async () => {
    const { fetchImpl, requests } = openaiBatchFetch(RESULT_LINES);
    const job = await provider(fetchImpl).cancel("batch-1");
    assert.equal(job.state, "cancelling");
    assert.equal(requests[0].url.endsWith("/batches/batch-1/cancel"), true);
  });

  it("empty_and_oversized_submits_fail_typed_without_fetching", async () => {
    let fetchCalls = 0;
    const batch = createOpenAIBatchJobsProvider({
      apiKey: "sk-x",
      fetch: (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => batch.submit({ model: "gpt-4o-mini", requests: [] }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "empty_requests");
        return true;
      },
    );
    await assert.rejects(
      () => batch.submit({ model: "gpt-4o-mini", requests: Array.from({ length: OPENAI_BATCH_MAX_REQUESTS + 1 }, () => ({ body: {} })) }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "too_many_requests");
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  });

  it("http_error_surfaces_status_and_redacts_api_key", async () => {
    const batch = createOpenAIBatchJobsProvider({
      apiKey: "sk-openai-secret",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "bad key sk-openai-secret" } }), { status: 429 })) as typeof fetch,
    });
    await assert.rejects(
      () => batch.status("batch-1"),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "request_failed");
        assert.ok(error.message.includes("429"));
        assert.ok(!error.message.includes("sk-openai-secret"), `key redacted: ${error.message}`);
        return true;
      },
    );
  });

  it("job_failed_terminal_surfaces_typed_error_with_provider_message", async () => {
    const { fetchImpl } = openaiBatchFetch(RESULT_LINES, { failJob: true, statusSequence: ["failed"] });
    await assert.rejects(
      () => pollBatch(provider(fetchImpl), "batch-1", { intervalMs: 1, maxAttempts: 2 }),
      (error: unknown) => {
        assert.ok(error instanceof BatchJobsError);
        assert.equal(error.code, "job_failed");
        assert.ok(error.message.includes("all requests failed"), "provider error message surfaces");
        return true;
      },
    );
  });

  it("passes_batch_conformance_with_fake_transport", async () => {
    const { fetchImpl } = openaiBatchFetch(RESULT_LINES);
    await runBatchJobsConformance({
      provider: provider(fetchImpl),
      maxRequests: OPENAI_BATCH_MAX_REQUESTS,
      sample: {
        model: "gpt-4o-mini",
        requests: [{ customId: "req-a", body: { messages: [{ role: "user", content: "hi" }] } }, { body: { messages: [] } }],
      },
    });
  });
});
