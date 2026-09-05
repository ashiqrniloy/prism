/** Provider-neutral async batch-jobs contract (plan 061 Task 7).
 *
 * Standalone contract — deliberately not coupled to the orchestration saga seam
 * in v1 (plan decision). Job ids are opaque strings; request payloads are
 * provider-native `JsonObject` bodies and inherit the provider's request caps;
 * polling is a plain exported utility (`pollBatch`), never loop-integrated into
 * core.
 */
import type { JsonObject, ModelCapabilities, ModelConfig } from "./content.js";

/** Neutral job state union. Adapters map provider states onto these:
 *  `queued` (submitted, not yet running), `cancelling`, and the three terminal
 *  states `completed` / `failed` / `cancelled` / `expired`. */
export type BatchJobState = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "expired";

export const BATCH_TERMINAL_STATES: readonly BatchJobState[] = ["completed", "failed", "cancelled", "expired"];

export function isBatchJobTerminal(job: Pick<BatchJob, "state">): boolean {
  return BATCH_TERMINAL_STATES.includes(job.state);
}

export type BatchJobsErrorCode =
  | "empty_requests"
  | "too_many_requests"
  | "unsupported_model"
  | "job_not_found"
  | "invalid_cursor"
  | "request_failed"
  | "response_malformed"
  | "unsupported_operation"
  | "job_failed"
  | "job_cancelled"
  | "job_expired";

export class BatchJobsError extends Error {
  readonly code: BatchJobsErrorCode;

  constructor(code: BatchJobsErrorCode, message: string) {
    super(message);
    this.name = "BatchJobsError";
    this.code = code;
  }
}

export function modelSupportsBatchJobs(capabilities?: ModelCapabilities): boolean {
  return capabilities?.batchJobs === true;
}

export function assertBatchJobsSupported(model: ModelConfig): void {
  if (!modelSupportsBatchJobs(model.capabilities)) {
    throw new BatchJobsError("unsupported_model", `Model ${model.provider}/${model.model} does not declare the batchJobs capability`);
  }
}

/** One batched request: provider-native body plus an optional caller-assigned
 *  correlation id echoed on results. Bodies are opaque to the contract. */
export interface BatchRequestItem {
  readonly customId?: string;
  readonly body: JsonObject;
}

export interface BatchSubmitRequest {
  readonly model: string;
  readonly requests: readonly BatchRequestItem[];
  /** Provider-native routing metadata (weights, priorities) — opaque passthrough. */
  readonly metadata?: JsonObject;
  readonly signal?: AbortSignal;
}

export interface BatchJob {
  /** Opaque provider job id — contract never parses or scopes it. */
  readonly id: string;
  readonly state: BatchJobState;
  readonly requestCounts?: { readonly total: number; readonly completed: number; readonly failed: number };
  readonly createdAt?: string;
  readonly completedAt?: string;
  readonly expiresAt?: string;
  /** Provider-native job fields, unmodified, for host-side audits. */
  readonly raw?: JsonObject;
  /** Terminal failure detail when `state` is `failed`. */
  readonly error?: { readonly code?: string; readonly message?: string };
}

export interface BatchResultItem {
  readonly customId: string;
  /** Provider-native per-request response (status + payload), when it succeeded. */
  readonly response?: JsonObject;
  /** Per-request failure detail (the job itself may still be `completed`). */
  readonly error?: { readonly code?: string; readonly message?: string };
  /** Provider-native raw line for audits. */
  readonly raw?: JsonObject;
}

export interface BatchResultsPage {
  readonly job?: BatchJob;
  readonly items: readonly BatchResultItem[];
  /** Opaque continuation token; `null`/`undefined` when the page is last. */
  readonly nextCursor?: string | null;
}

export interface BatchResultsOptions {
  readonly cursor?: string | null;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

export interface BatchJobsProvider {
  readonly id: string;
  submit(request: BatchSubmitRequest): Promise<BatchJob>;
  status(jobId: string): Promise<BatchJob>;
  cancel(jobId: string): Promise<BatchJob>;
  results(jobId: string, options?: BatchResultsOptions): Promise<BatchResultsPage>;
}

export interface PollBatchOptions {
  readonly intervalMs?: number;
  /** Backoff multiplier applied per poll; caps at `maxIntervalMs`. */
  readonly backoffMultiplier?: number;
  readonly maxIntervalMs?: number;
  readonly maxAttempts?: number;
  readonly signal?: AbortSignal;
}

/** Poll a job until it reaches a terminal state. Plain utility — core never
 *  calls it. Terminal failure states surface typed `BatchJobsError`s
 *  (`job_failed` / `job_cancelled` / `job_expired`); only `completed` resolves. */
export async function pollBatch(provider: BatchJobsProvider, jobId: string, options: PollBatchOptions = {}): Promise<BatchJob> {
  const intervalMs = options.intervalMs ?? 30_000;
  const multiplier = options.backoffMultiplier ?? 1;
  const maxIntervalMs = options.maxIntervalMs ?? intervalMs * 16;
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
  let delay = intervalMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("pollBatch aborted");
    let job: BatchJob;
    try {
      job = await provider.status(jobId);
    } catch (error) {
      if (error instanceof BatchJobsError && error.code === "job_not_found") {
        throw new BatchJobsError("job_not_found", `pollBatch: job ${jobId} not found`);
      }
      throw error;
    }
    if (isBatchJobTerminal(job)) {
      if (job.state === "completed") return job;
      if (job.state === "cancelled") throw new BatchJobsError("job_cancelled", `Batch job ${jobId} was cancelled`);
      if (job.state === "expired") throw new BatchJobsError("job_expired", `Batch job ${jobId} expired before completion`);
      throw new BatchJobsError("job_failed", `Batch job ${jobId} failed: ${job.error?.message ?? "provider reported failure"}`);
    }
    if (attempt === maxAttempts) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      options.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    delay = Math.min(delay * multiplier, maxIntervalMs);
  }
  throw new BatchJobsError("request_failed", `Batch job ${jobId} did not reach a terminal state within ${maxAttempts} polls`);
}
