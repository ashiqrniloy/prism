import type { JsonObject, ProviderFailureClass, ProviderRequestTimeouts } from "../contracts.js";
import { TRANSIENT_NETWORK_CODES } from "../models/retry.js";
import { redactSecrets } from "../redaction.js";

const DEFAULT_MAX_JSON_DEPTH = 32;
const DEFAULT_MAX_JSON_PROPERTIES = 4_096;

export const DEFAULT_MAX_EVENT_BYTES = 262_144;
export const DEFAULT_MAX_BUFFER_BYTES = 524_288;
export const DEFAULT_MAX_RESPONSE_BODY_BYTES = 65_536;
export const DEFAULT_MAX_ARGUMENT_BYTES = 262_144;

export interface BoundedStreamLimits {
  readonly maxEventBytes?: number;
  readonly maxBufferBytes?: number;
  readonly maxResponseBodyBytes?: number;
}

export interface SseEvent {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
  readonly comments?: readonly string[];
}

export type ProviderTransportErrorCode =
  | "sse_buffer_overflow"
  | "sse_event_overflow"
  | "response_body_overflow"
  | "aborted"
  | "invalid_json_arguments"
  | "incomplete_delta"
  | "response_body_shape";

const QUOTA_BODY =
  /quota|usage[\s_-]*limit|session[\s_-]*limit|weekly[\s_-]*limit|insufficient[\s_-]*(?:quota|credit|balance)|billing[\s_-]*(?:limit|quota)/i;
/** Bodies the supported routes answer when the request does not fit the model's context window. */
const CONTEXT_OVERFLOW_BODY =
  /context_length_exceeded|maximum context length|exceeded max(?:imum)? context length|context window exceeds limit|prompt is too long/i;
/** 400/413 are the generic overflow statuses; SystemOne answers 422 for an invalid request. */
const CONTEXT_OVERFLOW_STATUSES = new Set([400, 413, 422]);
/**
 * Stream error codes the supported routes put on the wire with no HTTP status (Anthropic `error`
 * event types, Responses `response.failed` codes). Anything else stays `unknown` and is not retried.
 */
const WIRE_CODE_FAILURE_CLASSES: Readonly<Record<string, ProviderFailureClass>> = {
  rate_limit_error: "rate_limited",
  rate_limit_exceeded: "rate_limited",
  overloaded_error: "transient",
  api_error: "transient",
  server_error: "transient",
};

/**
 * Whether a failure body/message says the request did not fit the model's context window. One
 * spelling for the classifier and for codecs that only see a stream frame (a Responses
 * `response.failed` never carries an HTTP status).
 */
export function isContextOverflowMessage(message: string): boolean {
  return CONTEXT_OVERFLOW_BODY.test(message);
}

/** Maps already-captured provider transport evidence to advisory outcome metadata. */
export function classifyProviderFailure(error: unknown): ProviderFailureClass {
  const status = readHttpStatus(error);
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return QUOTA_BODY.test(errorMessage(error)) ? "quota" : "rate_limited";
  // Body evidence wins over the generic status rule: every supported route has a distinct overflow
  // string (recorded from OpenCode Go in plan 194 Task 1), and a 413 body is never retried anyway.
  if (status !== undefined && CONTEXT_OVERFLOW_STATUSES.has(status) && isContextOverflowMessage(errorMessage(error))) {
    return "context_overflow";
  }
  if (status !== undefined) return status >= 500 ? "transient" : status >= 400 ? "permanent" : "unknown";
  const cause = readField(error, "cause");
  if (isTransientNetworkCode(readField(error, "code")) || isTransientNetworkCode(readField(cause, "code"))) return "transient";
  const code = readField(error, "code");
  if (typeof code === "string" && Object.hasOwn(WIRE_CODE_FAILURE_CLASSES, code)) return WIRE_CODE_FAILURE_CLASSES[code]!;
  // A stream can report a quota with no status at all: the measured Sign in with ChatGPT usage limit is a
  // 200 response whose error frame says so (plan 204 Task 9). Quota is never retried, so say it here.
  if (QUOTA_BODY.test(errorMessage(error))) return "quota";
  return "unknown";
}

export class ProviderTransportError extends Error {
  readonly code: ProviderTransportErrorCode;
  readonly limitBytes?: number;

  constructor(code: ProviderTransportErrorCode, message: string, limitBytes?: number) {
    super(message);
    this.name = "ProviderTransportError";
    this.code = code;
    this.limitBytes = limitBytes;
  }
}

/** HTTP failure error carrying the status as numeric `code` plus any `Retry-After`
 *  hint as `retryAfterMs`, so retry policies classify transience and pace retries
 *  without parsing message text. Both fields flow into `ErrorInfo` via errorToErrorInfo. */
export function httpStatusError(prefix: string, response: Response, bodyText: string): Error {
  const error = new Error(`${prefix}: ${response.status} ${bodyText}`) as Error & { code?: number; retryAfterMs?: number };
  error.code = response.status;
  const hint = parseRetryAfterMs(response.headers);
  if (hint !== undefined) error.retryAfterMs = hint;
  Object.defineProperty(error, "failureClass", { value: classifyProviderFailure(error), enumerable: true });
  return error;
}

function readHttpStatus(error: unknown): number | undefined {
  for (const key of ["code", "status", "statusCode"]) {
    const value = readField(error, key);
    const status = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : undefined;
    if (status !== undefined && status >= 100 && status <= 599) return status;
  }
  return undefined;
}

function readField(error: unknown, key: string): unknown {
  return error && typeof error === "object" && key in error ? (error as Record<string, unknown>)[key] : undefined;
}

function isTransientNetworkCode(value: unknown): boolean {
  return typeof value === "string" && TRANSIENT_NETWORK_CODES.has(value.toUpperCase());
}

function errorMessage(error: unknown): string {
  const cause = readField(error, "cause");
  return [readField(error, "message"), readField(cause, "message")].filter((value): value is string => typeof value === "string").join(" ");
}

/** Where a backpressure hint can come from: response headers, a plain header record, or one raw `Retry-After` value. */
export type RetryAfterSource = Headers | Readonly<Record<string, string>> | string | null | undefined;

/**
 * The one `Retry-After` parser, in milliseconds (rounded). Reads `retry-after-ms`, then `retry-after`
 * (delay-seconds or an HTTP date), then `bodyRetryAfter` (seconds, for routes that put the hint in the
 * error body). Header names are case-insensitive; malformed or negative values are no hint.
 */
export function parseRetryAfterMs(source: RetryAfterSource, bodyRetryAfter?: unknown, now: number = Date.now()): number | undefined {
  if (typeof source === "string") return parseRetryAfterValue(source, now);
  const ms = readNonNegativeNumber(readHeader(source, "retry-after-ms"));
  if (ms !== undefined) return Math.round(ms);
  const header = readHeader(source, "retry-after");
  const fromHeader = header === undefined ? undefined : parseRetryAfterValue(header, now);
  if (fromHeader !== undefined) return fromHeader;
  const seconds = readNonNegativeNumber(bodyRetryAfter);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

function parseRetryAfterValue(value: string, now: number): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = readNonNegativeNumber(trimmed);
  if (seconds !== undefined) return Math.round(seconds * 1000);
  if (/^-?[\d.]+$/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function readHeader(headers: Exclude<RetryAfterSource, string>, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/** A provider request that hit its connect or idle timeout. Retried like any transient network failure. */
class ProviderTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  readonly failureClass = "transient";
  constructor(
    readonly timeout: "connect" | "idle",
    readonly timeoutMs: number,
  ) {
    super(
      timeout === "connect"
        ? `Provider request timed out: no response headers within ${timeoutMs} ms (connect timeout)`
        : `Provider stream timed out: no bytes for ${timeoutMs} ms (idle timeout)`,
    );
    this.name = "ProviderTimeoutError";
  }
}

export interface FetchWithStreamTimeoutsOptions {
  /** Fetch implementation; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Usually `request.options?.timeouts`. Omitted fields take the defaults; `null` disables one. */
  readonly timeouts?: ProviderRequestTimeouts;
}

function resolveTimeoutMs(value: number | null | undefined, fallback: number, name: string): number | undefined {
  if (value === null) return undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`timeouts.${name} must be a positive number of milliseconds or null`);
  }
  return value;
}

/**
 * `fetch` for a provider turn request, with a connect timeout (no response headers within `connectMs`) and an
 * idle timeout (no body bytes for `idleMs` while the body is being read). Either one aborts the request and
 * fails it with `code: "ETIMEDOUT"`, `failureClass: "transient"`, naming which timeout fired. It wraps the
 * response body stream, so SSE, NDJSON and JSON readers all get the idle timer, and any bytes (SSE comments,
 * `ping` frames) keep the stream alive. `init.signal` (the run's abort) still wins and surfaces as an abort.
 * Every provider turn fetch goes through this helper; there is no per-provider timeout code.
 */
export async function fetchWithStreamTimeouts(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchWithStreamTimeoutsOptions = {},
): Promise<Response> {
  const connectMs = resolveTimeoutMs(options.timeouts?.connectMs, DEFAULT_CONNECT_TIMEOUT_MS, "connectMs");
  const idleMs = resolveTimeoutMs(options.timeouts?.idleMs, DEFAULT_IDLE_TIMEOUT_MS, "idleMs");
  const fetchImpl = options.fetch ?? fetch;
  if (connectMs === undefined && idleMs === undefined) return fetchImpl(input, init);

  const outer = init.signal ?? undefined;
  const controller = new AbortController();
  let timedOut: ProviderTimeoutError | undefined;
  /** Fires a timeout unless the request already ended or the run already aborted it. */
  const fire = (kind: "connect" | "idle", ms: number): ProviderTimeoutError | undefined => {
    if (timedOut || controller.signal.aborted) return undefined;
    timedOut = new ProviderTimeoutError(kind, ms);
    controller.abort(timedOut);
    return timedOut;
  };
  const forwardAbort = (): void => controller.abort(outer?.reason);
  if (outer?.aborted) forwardAbort();
  else outer?.addEventListener("abort", forwardAbort, { once: true });
  const release = (): void => outer?.removeEventListener("abort", forwardAbort);

  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let response: Response;
  try {
    // Race the fetch so a timeout wins even against a transport that ignores its signal.
    response = await new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => reject(timedOut ?? controller.signal.reason);
      if (controller.signal.aborted) return onAbort();
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (connectMs !== undefined) connectTimer = setTimeout(() => fire("connect", connectMs), connectMs);
      fetchImpl(input, { ...init, signal: controller.signal }).then(
        (value) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => reject(timedOut ?? error),
      );
    });
  } catch (error) {
    release();
    throw error;
  } finally {
    clearTimeout(connectTimer);
  }

  const source = response.body;
  if (!source) {
    release();
    return response;
  }
  return new Response(idleTimedBody(source, idleMs, fire, release), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Re-streams `source`, arming one idle timer only while a read is pending: a slow consumer is not a stalled
 * provider. The timer is created once and refreshed per read, so a healthy stream allocates no timers.
 */
function idleTimedBody(
  source: ReadableStream<Uint8Array>,
  idleMs: number | undefined,
  fire: (kind: "idle", ms: number) => ProviderTimeoutError | undefined,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let timer: (ReturnType<typeof setTimeout> & { refresh?: () => unknown }) | undefined;
  let pending = false;
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (): void => {
    clearTimeout(timer);
    release();
  };
  const onIdle = (): void => {
    if (!pending || idleMs === undefined) return;
    const error = fire("idle", idleMs);
    if (!error) return;
    finish();
    sink?.error(error);
    reader.cancel(error).catch(() => {});
  };
  const arm = (): void => {
    if (idleMs === undefined) return;
    if (timer?.refresh) timer.refresh();
    else {
      clearTimeout(timer);
      timer = setTimeout(onIdle, idleMs);
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
    },
    async pull(controller) {
      pending = true;
      arm();
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        pending = false;
        finish();
        // The idle timer already errored the stream with its own error; otherwise pass the failure on.
        try {
          controller.error(error);
        } catch {
          // already errored
        }
        return;
      } finally {
        pending = false;
      }
      try {
        if (result.done) {
          finish();
          controller.close();
        } else controller.enqueue(result.value);
      } catch {
        // errored by the idle timer while the read settled
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => {});
      // Hand the source back unlocked, as a direct reader that cancels would.
      reader.releaseLock();
    },
  });
}

export interface ReadSseEventsOptions extends BoundedStreamLimits {
  readonly signal?: AbortSignal;
}

export interface ReadBoundedResponseTextOptions extends BoundedStreamLimits {
  readonly secrets?: readonly (string | undefined)[];
}

export interface ReadBoundedResponseJsonOptions extends ReadBoundedResponseTextOptions {
  /** Max JSON nesting depth. Default: 32. */
  readonly maxDepth?: number;
  /** Max object properties / array elements per container. Default: 4_096. */
  readonly maxProperties?: number;
  /** Caller-supplied shape gate; failure throws `response_body_shape`. */
  readonly shape?: (value: unknown) => boolean;
  readonly signal?: AbortSignal;
}

export interface ParseJsonObjectArgumentsOptions {
  readonly toolName?: string;
  readonly maxBytes?: number;
}

function resolveLimits(options?: BoundedStreamLimits) {
  return {
    maxEventBytes: options?.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES,
    maxBufferBytes: options?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    maxResponseBodyBytes: options?.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES,
  };
}

/** UTF-8 length without encoding or allocating (plan 228 Task 4; was a fresh `TextEncoder` per call). */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** An SSE frame delimiter (`\n\n`, `\r\n\r\n`, or a mix); at most four characters long. */
const SSE_DELIMITER = /\r?\n\r?\n/;
/** Characters of already-scanned text kept to find a delimiter split across chunks (delimiter length − 1). */
const SSE_DELIMITER_OVERLAP = 3;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ProviderTransportError("aborted", "Transport operation aborted");
  }
}

function parseSseEventBlock(block: string): SseEvent | undefined {
  const comments: string[] = [];
  const dataLines: string[] = [];
  let id: string | undefined;
  let event: string | undefined;

  for (const line of block.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith(":")) {
      comments.push(line.slice(1).trimStart());
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^\s/, "");
    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "id":
        id = value;
        break;
      case "event":
        event = value;
        break;
      default:
        break;
    }
  }

  const data = dataLines.join("\n");
  if (!data && comments.length === 0) return undefined;
  return {
    id,
    event,
    data,
    ...(comments.length > 0 ? { comments } : {}),
  };
}

function eventBlockBytes(block: string): number {
  return byteLength(block);
}

/** Incremental O(bytes) SSE parser with finite buffer/event limits. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>, options?: ReadSseEventsOptions): AsyncGenerator<SseEvent> {
  const limits = resolveLimits(options);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Plan 228 Task 4: the buffer is never re-encoded or re-scanned. `bufferBytes` grows by each decoded
  // chunk's length and shrinks by each consumed frame's; only the new text (plus `scanTail`, the last few
  // scanned characters) is searched for a delimiter, so a frame spread over many chunks costs O(frame).
  let buffer = "";
  let bufferBytes = 0;
  let scanTail = "";

  /** Appends decoded text; true when the buffer now holds at least one complete frame. */
  const append = (text: string): boolean => {
    if (!text) return false;
    buffer += text;
    bufferBytes += byteLength(text);
    if (bufferBytes > limits.maxBufferBytes) {
      throw new ProviderTransportError("sse_buffer_overflow", `SSE buffer exceeded ${limits.maxBufferBytes} bytes`, limits.maxBufferBytes);
    }
    const window = scanTail + text;
    scanTail = window.slice(-SSE_DELIMITER_OVERLAP);
    return SSE_DELIMITER.test(window);
  };

  const yieldCompleteEvents = function* (): Generator<SseEvent> {
    while (true) {
      const match = SSE_DELIMITER.exec(buffer);
      if (!match) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const size = eventBlockBytes(block);
      bufferBytes -= size + match[0].length;
      const parsed = parseSseEventBlock(block);
      if (!parsed) continue;
      if (size > limits.maxEventBytes) {
        throw new ProviderTransportError("sse_event_overflow", `SSE event exceeded ${limits.maxEventBytes} bytes`, limits.maxEventBytes);
      }
      yield parsed;
    }
    scanTail = buffer.slice(-SSE_DELIMITER_OVERLAP);
  };

  try {
    while (true) {
      throwIfAborted(options?.signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (append(decoder.decode(value, { stream: true }))) yield* yieldCompleteEvents();
    }
    if (append(decoder.decode())) yield* yieldCompleteEvents();
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseSseEventBlock(tail);
      if (parsed) {
        const size = eventBlockBytes(tail);
        if (size > limits.maxEventBytes) {
          throw new ProviderTransportError("sse_event_overflow", `SSE event exceeded ${limits.maxEventBytes} bytes`, limits.maxEventBytes);
        }
        yield parsed;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }
}

/** Yields joined `data:` payloads for each SSE event (migration helper over {@link readSseEvents}). */
export async function* readSseData(body: ReadableStream<Uint8Array>, options?: ReadSseEventsOptions): AsyncGenerator<string> {
  for await (const event of readSseEvents(body, options)) {
    const data = event.data.trim();
    if (data) yield data;
  }
}

/** Read a response body with a hard byte ceiling; redacts optional secrets. */
export async function readBoundedResponseText(response: Response, options?: ReadBoundedResponseTextOptions): Promise<string> {
  const limits = resolveLimits(options);
  const secrets = options?.secrets ?? [];
  if (!response.body) {
    try {
      const text = await response.text();
      if (byteLength(text) > limits.maxResponseBodyBytes) {
        throw new ProviderTransportError(
          "response_body_overflow",
          `Response body exceeded ${limits.maxResponseBodyBytes} bytes`,
          limits.maxResponseBodyBytes,
        );
      }
      return redactSecrets(text, secrets);
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      return "";
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limits.maxResponseBodyBytes) {
        throw new ProviderTransportError(
          "response_body_overflow",
          `Response body exceeded ${limits.maxResponseBodyBytes} bytes`,
          limits.maxResponseBodyBytes,
        );
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return redactSecrets(parts.join(""), secrets);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }
}

function assertJsonBounds(value: unknown, maxDepth: number, maxProperties: number, depth = 0): void {
  if (depth > maxDepth) {
    throw new ProviderTransportError("response_body_shape", `JSON nesting exceeded ${maxDepth} levels`);
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > maxProperties) {
      throw new ProviderTransportError("response_body_shape", `JSON array exceeded ${maxProperties} elements`);
    }
    for (const entry of value) assertJsonBounds(entry, maxDepth, maxProperties, depth + 1);
    return;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length > maxProperties) {
    throw new ProviderTransportError("response_body_shape", `JSON object exceeded ${maxProperties} properties`);
  }
  for (const key of keys) assertJsonBounds((value as Record<string, unknown>)[key], maxDepth, maxProperties, depth + 1);
}

/** Read a success body with the same byte ceiling as {@link readBoundedResponseText}, then parse it as JSON
 *  with depth/property caps and an optional caller-supplied shape gate. Malformed JSON, over-limit nesting,
 *  or shape failure throw `ProviderTransportError` with code `response_body_shape`. */
export async function readBoundedResponseJson<T>(response: Response, options?: ReadBoundedResponseJsonOptions): Promise<T> {
  throwIfAborted(options?.signal);
  const text = await readBoundedResponseText(response, options);
  throwIfAborted(options?.signal);
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  const maxProperties = options?.maxProperties ?? DEFAULT_MAX_JSON_PROPERTIES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderTransportError("response_body_shape", "Response body is not valid JSON");
  }
  assertJsonBounds(parsed, maxDepth, maxProperties);
  if (options?.shape && !options.shape(parsed)) {
    throw new ProviderTransportError("response_body_shape", "Response body does not match the expected shape");
  }
  return parsed as T;
}

export type ParseJsonObjectArgumentsResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly error: ProviderTransportError };

/** Parse streamed tool arguments without throwing; prefer this for recoverable tool-call recovery. */
export function tryParseJsonObjectArguments(text: string, options?: ParseJsonObjectArgumentsOptions): ParseJsonObjectArgumentsResult {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_ARGUMENT_BYTES;
  const suffix = options?.toolName ? ` for tool ${options.toolName}` : "";
  if (!text) return { ok: true, value: {} };
  if (byteLength(text) > maxBytes) {
    return {
      ok: false,
      error: new ProviderTransportError("invalid_json_arguments", `Tool arguments${suffix} exceeded ${maxBytes} bytes`, maxBytes),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: new ProviderTransportError("invalid_json_arguments", `Invalid tool arguments JSON${suffix}`),
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: new ProviderTransportError("invalid_json_arguments", `Tool arguments${suffix} must be a JSON object`),
    };
  }
  return { ok: true, value: parsed as JsonObject };
}

/** Parse streamed tool arguments as a JSON object; throws {@link ProviderTransportError} on invalid input. */
export function parseJsonObjectArguments(text: string, options?: ParseJsonObjectArgumentsOptions): JsonObject {
  const result = tryParseJsonObjectArguments(text, options);
  if (!result.ok) throw result.error;
  return result.value;
}
