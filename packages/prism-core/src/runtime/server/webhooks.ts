import { createHmac, randomUUID } from "node:crypto";
import {
  type AgentEvent,
  assertSsrfAllowedUrl,
  createDefaultRetryPolicy,
  isLoopbackHostname,
  MediaContentError,
  pinnedFetch,
  type SecretRedactor,
  waitForRetry,
} from "@arnilo/prism";
import type { WorkflowEvent } from "../workflows/index.js";

const EVENT_NAMES = new Set<WebhookEventName>([
  "run.completed",
  "run.failed",
  "run.suspended",
  "workflow.completed",
  "workflow.failed",
  "workflow.suspended",
]);
const DEFAULT_MAX_QUEUED_EVENTS = 128;
const HARD_MAX_QUEUED_EVENTS = 4_096;
const DEFAULT_TIMEOUT_MS = 5_000;
const HARD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_EVENT_BYTES = 65_536;
const HARD_MAX_EVENT_BYTES = 1_048_576;
const DEFAULT_RETRIES = 3;
const HARD_RETRIES = 10;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;
const HARD_RETRY_DELAY_MS = 30_000;
const DEFAULT_RETRY_JITTER = 0.25;
const DEFAULT_MAX_FAILURE_RECORDS = 32;
const HARD_MAX_FAILURE_RECORDS = 256;

export type WebhookEventName =
  | "run.completed"
  | "run.failed"
  | "run.suspended"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.suspended";

export interface WebhookTarget {
  readonly url: string;
  readonly events: readonly WebhookEventName[];
}

export interface WebhookNotifierLimits {
  readonly maxQueuedEvents?: number;
  readonly timeoutMs?: number;
  readonly maxEventBytes?: number;
  /** Retries after the initial attempt. Default 3, hard cap 10. */
  readonly retries?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  /** Symmetric jitter fraction. Default 0.25 (±25%). */
  readonly retryJitter?: number;
  readonly maxFailureRecords?: number;
}

export interface WebhookNotifierOptions {
  readonly targets: readonly WebhookTarget[];
  /** Enables HTTP only for loopback development endpoints. Default false. */
  readonly allowLoopbackHttp?: boolean;
  readonly signer: { readonly key: Uint8Array };
  readonly redactor: SecretRedactor;
  readonly limits?: WebhookNotifierLimits;
}

export interface WebhookNotification {
  readonly event: WebhookEventName;
  readonly runId?: string;
  readonly workflowRunId?: string;
  readonly status: "completed" | "failed" | "suspended";
  readonly payload?: unknown;
  readonly timestamp?: string;
}

export interface WebhookDeliveryOptions {
  /** Cancels queued and retrying delivery for this notification. Never serialized. */
  readonly signal?: AbortSignal;
}

export interface WebhookEnvelope {
  readonly id: string;
  readonly event: WebhookEventName;
  readonly runId?: string;
  readonly workflowRunId?: string;
  readonly status: WebhookNotification["status"];
  readonly redactedPayload: unknown;
  readonly timestamp: string;
}

export interface WebhookFailureRecord {
  readonly id: string;
  readonly event: WebhookEventName;
  readonly attempts: number;
  readonly status?: number;
  readonly error: string;
}

export interface WebhookNotifierDiagnostics {
  readonly queued: number;
  readonly delivered: number;
  /** Terminal delivery failures; publish as the `prism.webhook.failed` counter. */
  readonly failed: number;
  readonly dropped: number;
  readonly retries: number;
  readonly cancelled: number;
  readonly failures: readonly WebhookFailureRecord[];
  readonly lastError?: string;
}

export interface WebhookNotifier {
  notify(event: WebhookNotification, options?: WebhookDeliveryOptions): void;
  onAgentEvent(event: AgentEvent): void;
  onWorkflowEvent(event: WorkflowEvent): void;
  diagnostics(): WebhookNotifierDiagnostics;
}

export interface WebhookRetryLimits {
  readonly timeoutMs: number;
  readonly retries: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly retryJitter: number;
}

interface ResolvedLimits extends WebhookRetryLimits {
  readonly maxQueuedEvents: number;
  readonly maxEventBytes: number;
  readonly maxFailureRecords: number;
}

interface RegisteredTarget {
  readonly url: URL;
  readonly events: ReadonlySet<WebhookEventName>;
  readonly allowLoopbackHttp: boolean;
}

interface Delivery {
  readonly target: URL;
  readonly allowLoopbackHttp: boolean;
  readonly body: string;
  readonly envelope: WebhookEnvelope;
  readonly signature: string;
  readonly signal?: AbortSignal;
  detachAbort: () => void;
}

export interface WebhookRetryAttempt {
  readonly status: number;
  readonly retryAfterMs?: number;
}

export interface WebhookDeliveryOutcome {
  readonly state: "delivered" | "failed" | "cancelled";
  readonly attempts: number;
  readonly retries: number;
  readonly status?: number;
  readonly error?: string;
}

/** Pure: redact first, then serialize/sign the returned envelope. */
export function buildWebhookEnvelope(event: WebhookNotification, redactor: SecretRedactor, id: string): WebhookEnvelope {
  assertEvent(event);
  if (!id) throw new TypeError("Webhook id is required");
  const timestamp = event.timestamp ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError("Webhook timestamp must be an ISO date");
  return {
    id,
    event: event.event,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    ...(event.workflowRunId === undefined ? {} : { workflowRunId: event.workflowRunId }),
    status: event.status,
    redactedPayload: redactor.redact(event.payload ?? null),
    timestamp,
  };
}

export function signWebhookBody(body: string, key: Uint8Array): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

export function createWebhookNotifier(options: WebhookNotifierOptions): WebhookNotifier {
  if (!(options.signer.key instanceof Uint8Array) || options.signer.key.byteLength < 32)
    throw new TypeError("Webhook HMAC key must be at least 32 bytes");
  if (!options.redactor || typeof options.redactor.redact !== "function") throw new TypeError("Webhook redactor is required");
  const targets = options.targets.map((target) => registerTarget(target, options.allowLoopbackHttp === true));
  const limits = resolveLimits(options.limits);
  // ponytail: in-memory queue; use a durable outbox when cross-restart delivery matters.
  const queue: Delivery[] = [];
  const failures: WebhookFailureRecord[] = [];
  let delivered = 0;
  let failed = 0;
  let dropped = 0;
  let retries = 0;
  let cancelled = 0;
  let flushing = false;

  const recordFailure = (delivery: Delivery, outcome: WebhookDeliveryOutcome) => {
    const failure = Object.freeze({
      id: delivery.envelope.id,
      event: delivery.envelope.event,
      attempts: outcome.attempts,
      ...(outcome.status === undefined ? {} : { status: outcome.status }),
      error: outcome.error ?? "Webhook delivery failed",
    });
    failed += 1;
    failures.push(failure);
    if (failures.length > limits.maxFailureRecords) failures.shift();
  };

  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        const delivery = queue.shift()!;
        delivery.detachAbort();
        const outcome = await retryWebhookDelivery(
          (signal) => postWebhookDelivery(delivery, signal),
          limits,
          options.redactor,
          delivery.signal,
        );
        retries += outcome.retries;
        if (outcome.state === "delivered") delivered += 1;
        else if (outcome.state === "failed") recordFailure(delivery, outcome);
        else cancelled += 1;
      }
    } finally {
      flushing = false;
      if (queue.length) void flush();
    }
  };

  const notify = (event: WebhookNotification, deliveryOptions?: WebhookDeliveryOptions) => {
    const selected = targets.filter((target) => target.events.has(event.event));
    if (!selected.length) return;
    const envelope = buildWebhookEnvelope(event, options.redactor, randomUUID());
    const body = JSON.stringify(envelope);
    if (Buffer.byteLength(body, "utf8") > limits.maxEventBytes) throw new RangeError(`Webhook event exceeds ${limits.maxEventBytes} bytes`);
    const signature = signWebhookBody(body, options.signer.key);
    for (const target of selected) {
      if (queue.length >= limits.maxQueuedEvents) {
        dropped += 1; // drop newest; queued deliveries remain ordered.
        continue;
      }
      if (deliveryOptions?.signal?.aborted) {
        cancelled += 1;
        continue;
      }
      const delivery: Delivery = {
        target: target.url,
        allowLoopbackHttp: target.allowLoopbackHttp,
        body,
        envelope,
        signature,
        ...(deliveryOptions?.signal === undefined ? {} : { signal: deliveryOptions.signal }),
        detachAbort: () => undefined,
      };
      if (delivery.signal) {
        const onAbort = () => {
          const index = queue.indexOf(delivery);
          if (index >= 0) {
            queue.splice(index, 1);
            cancelled += 1;
          }
        };
        delivery.detachAbort = () => delivery.signal?.removeEventListener("abort", onAbort);
        delivery.signal.addEventListener("abort", onAbort, { once: true });
      }
      queue.push(delivery);
    }
    void flush();
  };

  return {
    notify,
    onAgentEvent(event) {
      switch (event.type) {
        case "agent_finished":
          notify({ event: "run.completed", runId: event.runId, status: "completed", payload: event });
          break;
        case "agent_suspended":
          notify({ event: "run.suspended", runId: event.runId, status: "suspended", payload: event });
          break;
        case "agent_denied":
        case "run_limit_exceeded":
        case "error":
          notify({ event: "run.failed", runId: event.runId, status: "failed", payload: event });
          break;
        default:
          break;
      }
    },
    onWorkflowEvent(event) {
      if (event.type === "workflow_suspended") {
        notify({
          event: "workflow.suspended",
          workflowRunId: event.runId,
          status: "suspended",
          payload: event,
          timestamp: event.timestamp,
        });
      } else if (event.type === "workflow_finished") {
        notify({
          event: event.status === "succeeded" ? "workflow.completed" : "workflow.failed",
          workflowRunId: event.runId,
          status: event.status === "succeeded" ? "completed" : "failed",
          payload: event,
          timestamp: event.timestamp,
        });
      }
    },
    diagnostics: () => {
      const lastError = failures[failures.length - 1]?.error;
      return {
        queued: queue.length,
        delivered,
        failed,
        dropped,
        retries,
        cancelled,
        failures: Object.freeze([...failures]),
        ...(lastError === undefined ? {} : { lastError }),
      };
    },
  };
}

export async function retryWebhookDelivery(
  attempt: (signal: AbortSignal) => Promise<WebhookRetryAttempt>,
  limits: WebhookRetryLimits,
  redactor: SecretRedactor,
  signal?: AbortSignal,
): Promise<WebhookDeliveryOutcome> {
  const retry = createDefaultRetryPolicy({
    name: "webhook-delivery",
    maxAttempts: limits.retries + 1,
    baseDelayMs: limits.retryBaseDelayMs,
    maxDelayMs: limits.retryMaxDelayMs,
    jitter: limits.retryJitter,
    transientCodes: ["webhook_network"],
  });
  let retries = 0;
  for (let attempts = 1; ; attempts += 1) {
    if (signal?.aborted) return { state: "cancelled", attempts: attempts - 1, retries };
    try {
      const response = await attempt(combineAttemptSignal(signal, limits.timeoutMs));
      if (response.status >= 200 && response.status < 300) return { state: "delivered", attempts, retries, status: response.status };
      const error = redactWebhookError(`Webhook returned HTTP ${response.status}`, redactor);
      if (response.status !== 429 && response.status < 500) return { state: "failed", attempts, retries, status: response.status, error };
      const next = await scheduleWebhookRetry(retry, attempts, response.status, error, response.retryAfterMs, signal);
      if (next === "retry") {
        retries += 1;
        continue;
      }
      return { state: next, attempts, retries, status: response.status, ...(next === "failed" ? { error } : {}) };
    } catch (error) {
      if (signal?.aborted) return { state: "cancelled", attempts, retries };
      const message = redactWebhookError(error, redactor);
      if (error instanceof MediaContentError) return { state: "failed", attempts, retries, error: message };
      const next = await scheduleWebhookRetry(retry, attempts, retryCode(error), message, undefined, signal);
      if (next === "retry") {
        retries += 1;
        continue;
      }
      return { state: next, attempts, retries, ...(next === "failed" ? { error: message } : {}) };
    }
  }
}

async function postWebhookDelivery(delivery: Delivery, signal: AbortSignal): Promise<WebhookRetryAttempt> {
  const response = await pinnedFetch(
    delivery.target,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prism-event-id": delivery.envelope.id,
        "x-prism-signature": `sha256=${delivery.signature}`,
        "x-prism-timestamp": delivery.envelope.timestamp,
      },
      body: delivery.body,
      redirect: "manual",
      signal,
    },
    {
      errorPrefix: "Webhook",
      hostnameErrorPrefix: "Webhook",
      ...(delivery.allowLoopbackHttp ? { allowLoopback: true } : {}),
    },
  );
  const status = response.status;
  const retryAfterMs = readRetryAfterMs(response.headers.get("retry-after"));
  await response.body?.cancel().catch(() => undefined);
  return { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
}

async function scheduleWebhookRetry(
  retry: ReturnType<typeof createDefaultRetryPolicy>,
  attempt: number,
  code: string | number,
  message: string,
  retryAfterMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<"retry" | "failed" | "cancelled"> {
  const decision = await retry.decide({
    sessionId: "webhook",
    runId: "webhook",
    attempt,
    error: {
      name: "WebhookDeliveryError",
      message,
      code,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
    signal,
  });
  if (!decision.retry) return "failed";
  try {
    await waitForRetry(decision, signal);
    return "retry";
  } catch {
    return signal?.aborted ? "cancelled" : "failed";
  }
}

function combineAttemptSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function retryCode(error: unknown): string | number {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return code;
  }
  return "webhook_network";
}

function redactWebhookError(error: unknown, redactor: SecretRedactor): string {
  const message = error instanceof Error ? error.message : String(error);
  const bytes = Buffer.from(String(redactor.redact(message)), "utf8");
  return bytes.subarray(0, 1_024).toString("utf8") || "Webhook delivery failed";
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function registerTarget(target: WebhookTarget, allowLoopbackHttp: boolean): RegisteredTarget {
  if (!target || typeof target.url !== "string") throw new TypeError("Webhook target URL is required");
  const url = new URL(target.url);
  const loopbackHttp = allowLoopbackHttp && url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) throw new TypeError("Webhook target URL must use https");
  if (url.username || url.password || url.hash) throw new TypeError("Webhook target URL must not contain credentials or a fragment");
  if (!loopbackHttp) assertSsrfAllowedUrl(url.href);
  if (!Array.isArray(target.events) || !target.events.length) throw new TypeError("Webhook target must select at least one event");
  const events = new Set<WebhookEventName>();
  for (const event of target.events) {
    if (!EVENT_NAMES.has(event)) throw new TypeError(`Unsupported webhook event: ${String(event)}`);
    events.add(event);
  }
  return { url, events, allowLoopbackHttp: loopbackHttp };
}

function resolveLimits(input: WebhookNotifierLimits | undefined): ResolvedLimits {
  const retryBaseDelayMs = bounded(input?.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS, HARD_RETRY_DELAY_MS, "retryBaseDelayMs");
  const retryMaxDelayMs = bounded(input?.retryMaxDelayMs, DEFAULT_RETRY_MAX_DELAY_MS, HARD_RETRY_DELAY_MS, "retryMaxDelayMs");
  if (retryMaxDelayMs < retryBaseDelayMs) throw new RangeError("retryMaxDelayMs must be at least retryBaseDelayMs");
  return {
    maxQueuedEvents: bounded(input?.maxQueuedEvents, DEFAULT_MAX_QUEUED_EVENTS, HARD_MAX_QUEUED_EVENTS, "maxQueuedEvents"),
    timeoutMs: bounded(input?.timeoutMs, DEFAULT_TIMEOUT_MS, HARD_TIMEOUT_MS, "timeoutMs"),
    maxEventBytes: bounded(input?.maxEventBytes, DEFAULT_MAX_EVENT_BYTES, HARD_MAX_EVENT_BYTES, "maxEventBytes"),
    retries: boundedNonNegative(input?.retries, DEFAULT_RETRIES, HARD_RETRIES, "retries"),
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryJitter: fraction(input?.retryJitter, DEFAULT_RETRY_JITTER, "retryJitter"),
    maxFailureRecords: bounded(input?.maxFailureRecords, DEFAULT_MAX_FAILURE_RECORDS, HARD_MAX_FAILURE_RECORDS, "maxFailureRecords"),
  };
}

function boundedNonNegative(value: number | undefined, fallback: number, hard: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > hard)
    throw new RangeError(`${name} must be an integer from 0 to ${hard}`);
  return resolved;
}

function fraction(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) throw new RangeError(`${name} must be a number from 0 to 1`);
  return resolved;
}

function bounded(value: number | undefined, fallback: number, hard: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard)
    throw new RangeError(`${name} must be an integer from 1 to ${hard}`);
  return resolved;
}

function assertEvent(event: WebhookNotification): void {
  if (!event || !EVENT_NAMES.has(event.event)) throw new TypeError("Webhook event is invalid");
  if (event.status !== "completed" && event.status !== "failed" && event.status !== "suspended")
    throw new TypeError("Webhook status is invalid");
  if (event.runId === undefined && event.workflowRunId === undefined)
    throw new TypeError("Webhook event requires a runId or workflowRunId");
}
