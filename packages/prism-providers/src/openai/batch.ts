/** OpenAI batch adapter — plan 061 Task 7 (Files API upload + `/v1/batches` lifecycle).
 *
 * Job ids are opaque passthrough; request bodies are provider-native JSONL lines
 * and inherit the request caps (50k lines/job per OpenAI's documented limit).
 * Results page client-side over the downloaded output/error JSONL — cursor is a
 * line offset. Credentials resolve per call via the existing seams and are
 * redacted from every thrown error.
 */
import {
  type BatchJob,
  BatchJobsError,
  type BatchJobsProvider,
  type BatchRequestItem,
  type BatchResultItem,
  type BatchResultsOptions,
  type BatchResultsPage,
  type BatchSubmitRequest,
  type JsonObject,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

export const OPENAI_BATCH_MAX_REQUESTS = 50_000;
/** Per-response read bound for batch JSONL downloads (batches can be large). */
export const OPENAI_BATCH_MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
export const OPENAI_BATCH_COMPLETION_WINDOW = "24h";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CHAT_COMPLETIONS_ENDPOINT = "/v1/chat/completions";

export interface OpenAIBatchJobsOptions {
  readonly id?: string;
  readonly apiKey?: Parameters<typeof resolveCredentialValue>[0];
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Batch endpoint for the uploaded lines; defaults to chat completions. */
  readonly endpoint?: string;
  readonly completionWindow?: string;
}

const OPENAI_STATE_MAP: Readonly<Record<string, BatchJob["state"]>> = {
  validating: "queued",
  in_progress: "running",
  finalizing: "running",
  completed: "completed",
  failed: "failed",
  expired: "expired",
  cancelling: "cancelling",
  cancelled: "cancelled",
};

function asJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function mapBatchJob(payload: Record<string, unknown>): BatchJob {
  const id = typeof payload.id === "string" ? payload.id : undefined;
  const rawState = typeof payload.status === "string" ? payload.status : undefined;
  if (id === undefined || rawState === undefined || OPENAI_STATE_MAP[rawState] === undefined) {
    throw new BatchJobsError("response_malformed", `OpenAI batch response missing id/status (state: ${String(rawState)})`);
  }
  const counts = asJsonObject(payload.request_counts) as { total?: unknown; completed?: unknown; failed?: unknown } | undefined;
  const error = asJsonObject(payload.error) as { code?: unknown; message?: unknown } | undefined;
  return {
    id,
    state: OPENAI_STATE_MAP[rawState],
    requestCounts:
      counts && typeof counts.total === "number" && typeof counts.completed === "number" && typeof counts.failed === "number"
        ? { total: counts.total, completed: counts.completed, failed: counts.failed }
        : undefined,
    createdAt: typeof payload.created_at === "number" ? new Date(payload.created_at * 1000).toISOString() : undefined,
    completedAt: typeof payload.completed_at === "number" ? new Date(payload.completed_at * 1000).toISOString() : undefined,
    expiresAt: typeof payload.expires_at === "number" ? new Date(payload.expires_at * 1000).toISOString() : undefined,
    raw: payload as unknown as JsonObject,
    error:
      error && typeof error.message === "string"
        ? { code: typeof error.code === "string" ? error.code : undefined, message: error.message }
        : undefined,
  };
}

function encodeLine(item: BatchRequestItem, model: string, endpoint: string, index: number): string {
  const body = asJsonObject(item.body);
  if (!body) throw new BatchJobsError("response_malformed", `batch request ${index} body must be a JSON object`);
  const line: Record<string, unknown> = {
    custom_id: item.customId ?? `request-${index}`,
    method: "POST",
    url: endpoint,
    body: { model, ...body },
  };
  return JSON.stringify(line);
}

function parseResultLine(line: string): BatchResultItem | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new BatchJobsError("response_malformed", "OpenAI batch results contained a non-JSONL line");
  }
  const record = asJsonObject(parsed);
  if (!record || typeof record.custom_id !== "string") {
    throw new BatchJobsError("response_malformed", "OpenAI batch result line missing custom_id");
  }
  const error = asJsonObject(record.error);
  return {
    customId: record.custom_id,
    response: asJsonObject(record.response),
    error:
      error && (typeof error.message === "string" || typeof error.code === "string")
        ? {
            code: typeof error.code === "string" ? error.code : undefined,
            message: typeof error.message === "string" ? error.message : undefined,
          }
        : undefined,
    raw: record,
  };
}

/** Create an OpenAI-compatible `BatchJobsProvider` (Files API + `/v1/batches`). */
export function createOpenAIBatchJobsProvider(options: OpenAIBatchJobsOptions): BatchJobsProvider {
  const id = options.id ?? "openai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? CHAT_COMPLETIONS_ENDPOINT;
  const completionWindow = options.completionWindow ?? OPENAI_BATCH_COMPLETION_WINDOW;

  const headers: Record<string, string> = { ...options.headers };

  async function resolveKey(): Promise<string> {
    const apiKey = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
    if (!apiKey) throw new BatchJobsError("request_failed", "OpenAI batch jobs require an API key (apiKey option or credential source)");
    return apiKey;
  }

  function authorizedHeaders(apiKey: string, json: boolean): Record<string, string> {
    return json
      ? { ...headers, "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
      : { ...headers, Authorization: `Bearer ${apiKey}` };
  }

  async function requestJson(_method: string, url: string, init: RequestInit, apiKey: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new BatchJobsError("request_failed", `OpenAI batch request failed: ${redactSecrets(String(error), [apiKey])}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BatchJobsError(
        "request_failed",
        `OpenAI batch request failed with status ${response.status}: ${redactSecrets(text || response.statusText, [apiKey])}`,
      );
    }
    try {
      return (await readBoundedResponseJson(response, { maxResponseBodyBytes: OPENAI_BATCH_MAX_RESPONSE_BYTES })) as unknown as Record<
        string,
        unknown
      >;
    } catch (error) {
      if (error instanceof BatchJobsError) throw error;
      throw new BatchJobsError("response_malformed", `OpenAI batch response was not valid JSON: ${redactSecrets(String(error), [apiKey])}`);
    }
  }

  async function uploadInputFile(jsonl: string, signal: AbortSignal | undefined, apiKey: string): Promise<string> {
    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "batch-input.jsonl");
    const payload = await requestJson(
      "POST",
      `${baseUrl}/files`,
      { method: "POST", headers: authorizedHeaders(apiKey, false), body: form, signal },
      apiKey,
    );
    if (typeof payload.id !== "string") throw new BatchJobsError("response_malformed", "OpenAI file upload response missing id");
    return payload.id;
  }

  async function downloadText(fileId: string, signal: AbortSignal | undefined, apiKey: string): Promise<string> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/files/${encodeURIComponent(fileId)}/content`, {
        method: "GET",
        headers: authorizedHeaders(apiKey, false),
        signal,
      });
    } catch (error) {
      throw new BatchJobsError("request_failed", `OpenAI batch results download failed: ${redactSecrets(String(error), [apiKey])}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BatchJobsError(
        "request_failed",
        `OpenAI batch results download failed with status ${response.status}: ${redactSecrets(text || response.statusText, [apiKey])}`,
      );
    }
    try {
      return await readBoundedResponseText(response, { maxResponseBodyBytes: OPENAI_BATCH_MAX_RESPONSE_BYTES });
    } catch (error) {
      if (error instanceof BatchJobsError) throw error;
      throw new BatchJobsError("response_malformed", `OpenAI batch results were not readable: ${redactSecrets(String(error), [apiKey])}`);
    }
  }

  return {
    id,
    async submit(request: BatchSubmitRequest) {
      if (request.requests.length === 0) throw new BatchJobsError("empty_requests", "batch submit requires at least one request");
      if (request.requests.length > OPENAI_BATCH_MAX_REQUESTS) {
        throw new BatchJobsError("too_many_requests", `batch submit exceeds ${OPENAI_BATCH_MAX_REQUESTS} requests per job`);
      }
      const apiKey = await resolveKey();
      const jsonl = request.requests.map((item, index) => encodeLine(item, request.model, endpoint, index)).join("\n");
      const fileId = await uploadInputFile(jsonl, request.signal, apiKey);
      const payload = await requestJson(
        "POST",
        `${baseUrl}/batches`,
        {
          method: "POST",
          headers: authorizedHeaders(apiKey, true),
          body: JSON.stringify({
            input_file_id: fileId,
            endpoint,
            completion_window: completionWindow,
            ...(request.metadata ? { metadata: request.metadata } : {}),
          }),
          signal: request.signal,
        },
        apiKey,
      );
      return mapBatchJob(payload);
    },
    async status(jobId) {
      if (jobId.length === 0) throw new BatchJobsError("job_not_found", "batch job id must not be empty");
      const apiKey = await resolveKey();
      const payload = await requestJson(
        "GET",
        `${baseUrl}/batches/${encodeURIComponent(jobId)}`,
        { method: "GET", headers: authorizedHeaders(apiKey, true) },
        apiKey,
      );
      return mapBatchJob(payload);
    },
    async cancel(jobId) {
      const apiKey = await resolveKey();
      const payload = await requestJson(
        "POST",
        `${baseUrl}/batches/${encodeURIComponent(jobId)}/cancel`,
        { method: "POST", headers: authorizedHeaders(apiKey, true), body: "{}" },
        apiKey,
      );
      return mapBatchJob(payload);
    },
    async results(jobId: string, resultsOptions: BatchResultsOptions = {}): Promise<BatchResultsPage> {
      if (jobId.length === 0) throw new BatchJobsError("job_not_found", "batch job id must not be empty");
      const apiKey = await resolveKey();
      const jobPayload = await requestJson(
        "GET",
        `${baseUrl}/batches/${encodeURIComponent(jobId)}`,
        { method: "GET", headers: authorizedHeaders(apiKey, true) },
        apiKey,
      );
      const job = mapBatchJob(jobPayload);
      const raw = asJsonObject(jobPayload);
      const fileId =
        typeof raw?.output_file_id === "string"
          ? raw.output_file_id
          : typeof raw?.error_file_id === "string"
            ? raw.error_file_id
            : undefined;
      if (fileId === undefined) return { job, items: [], nextCursor: null };
      const text = await downloadText(fileId, resultsOptions.signal, apiKey);
      const lines = text.split("\n");
      const cursor = resultsOptions.cursor ?? null;
      let offset = 0;
      if (cursor !== null) {
        const parsed = Number(cursor);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > lines.length) {
          throw new BatchJobsError("invalid_cursor", `batch results cursor ${String(cursor)} is not a valid line offset`);
        }
        offset = parsed;
      }
      const pageSize = resultsOptions.pageSize ?? 100;
      const items: BatchResultItem[] = [];
      while (offset < lines.length && items.length < pageSize) {
        const item = parseResultLine(lines[offset]);
        offset += 1;
        if (item) items.push(item);
      }
      return { job, items, nextCursor: offset < lines.length ? String(offset) : null };
    },
  } as BatchJobsProvider;
}

export { assertBatchJobsSupported, modelSupportsBatchJobs } from "@arnilo/prism";
