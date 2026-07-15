import type { JsonObject } from "../contracts.js";
import { redactSecrets } from "../redaction.js";

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
  | "invalid_json_arguments";

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

export interface ReadSseEventsOptions extends BoundedStreamLimits {
  readonly signal?: AbortSignal;
}

export interface ReadBoundedResponseTextOptions extends BoundedStreamLimits {
  readonly secrets?: readonly (string | undefined)[];
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

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

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
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  options?: ReadSseEventsOptions,
): AsyncGenerator<SseEvent> {
  const limits = resolveLimits(options);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const ensureBufferLimit = (): void => {
    if (byteLength(buffer) > limits.maxBufferBytes) {
      throw new ProviderTransportError(
        "sse_buffer_overflow",
        `SSE buffer exceeded ${limits.maxBufferBytes} bytes`,
        limits.maxBufferBytes,
      );
    }
  };

  const yieldCompleteEvents = function* (): Generator<SseEvent> {
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const parsed = parseSseEventBlock(block);
      if (!parsed) continue;
      const size = eventBlockBytes(block);
      if (size > limits.maxEventBytes) {
        throw new ProviderTransportError(
          "sse_event_overflow",
          `SSE event exceeded ${limits.maxEventBytes} bytes`,
          limits.maxEventBytes,
        );
      }
      yield parsed;
    }
  };

  try {
    while (true) {
      throwIfAborted(options?.signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      ensureBufferLimit();
      yield* yieldCompleteEvents();
    }
    buffer += decoder.decode();
    ensureBufferLimit();
    yield* yieldCompleteEvents();
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseSseEventBlock(tail);
      if (parsed) {
        const size = eventBlockBytes(tail);
        if (size > limits.maxEventBytes) {
          throw new ProviderTransportError(
            "sse_event_overflow",
            `SSE event exceeded ${limits.maxEventBytes} bytes`,
            limits.maxEventBytes,
          );
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
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  options?: ReadSseEventsOptions,
): AsyncGenerator<string> {
  for await (const event of readSseEvents(body, options)) {
    const data = event.data.trim();
    if (data) yield data;
  }
}

/** Read a response body with a hard byte ceiling; redacts optional secrets. */
export async function readBoundedResponseText(
  response: Response,
  options?: ReadBoundedResponseTextOptions,
): Promise<string> {
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

/** Parse streamed tool arguments as a JSON object; throws {@link ProviderTransportError} on invalid input. */
export function parseJsonObjectArguments(
  text: string,
  options?: ParseJsonObjectArgumentsOptions,
): JsonObject {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_ARGUMENT_BYTES;
  const suffix = options?.toolName ? ` for tool ${options.toolName}` : "";
  if (!text) return {};
  if (byteLength(text) > maxBytes) {
    throw new ProviderTransportError(
      "invalid_json_arguments",
      `Tool arguments${suffix} exceeded ${maxBytes} bytes`,
      maxBytes,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProviderTransportError(
      "invalid_json_arguments",
      `Invalid tool arguments JSON${suffix}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderTransportError(
      "invalid_json_arguments",
      `Tool arguments${suffix} must be a JSON object`,
    );
  }
  return parsed as JsonObject;
}
