import type { JsonObject, ProviderFailureClass } from "../contracts.js";
export declare const DEFAULT_MAX_EVENT_BYTES = 262144;
export declare const DEFAULT_MAX_BUFFER_BYTES = 524288;
export declare const DEFAULT_MAX_RESPONSE_BODY_BYTES = 65536;
export declare const DEFAULT_MAX_ARGUMENT_BYTES = 262144;
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
export type ProviderTransportErrorCode = "sse_buffer_overflow" | "sse_event_overflow" | "response_body_overflow" | "aborted" | "invalid_json_arguments" | "incomplete_delta" | "response_body_shape";
/**
 * Whether a failure body/message says the request did not fit the model's context window. One
 * spelling for the classifier and for codecs that only see a stream frame (a Responses
 * `response.failed` never carries an HTTP status).
 */
export declare function isContextOverflowMessage(message: string): boolean;
/** Maps already-captured provider transport evidence to advisory outcome metadata. */
export declare function classifyProviderFailure(error: unknown): ProviderFailureClass;
export declare class ProviderTransportError extends Error {
    readonly code: ProviderTransportErrorCode;
    readonly limitBytes?: number;
    constructor(code: ProviderTransportErrorCode, message: string, limitBytes?: number);
}
/** HTTP failure error carrying the status as numeric `code` plus any `Retry-After`
 *  hint as `retryAfterMs`, so retry policies classify transience and pace retries
 *  without parsing message text. Both fields flow into `ErrorInfo` via errorToErrorInfo. */
export declare function httpStatusError(prefix: string, response: Response, bodyText: string): Error;
/** Parse a `Retry-After` header (delay-seconds or HTTP-date) into milliseconds. */
export declare function parseRetryAfterMs(value: string | null, now?: number): number | undefined;
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
/** Incremental O(bytes) SSE parser with finite buffer/event limits. */
export declare function readSseEvents(body: ReadableStream<Uint8Array>, options?: ReadSseEventsOptions): AsyncGenerator<SseEvent>;
/** Yields joined `data:` payloads for each SSE event (migration helper over {@link readSseEvents}). */
export declare function readSseData(body: ReadableStream<Uint8Array>, options?: ReadSseEventsOptions): AsyncGenerator<string>;
/** Read a response body with a hard byte ceiling; redacts optional secrets. */
export declare function readBoundedResponseText(response: Response, options?: ReadBoundedResponseTextOptions): Promise<string>;
/** Read a success body with the same byte ceiling as {@link readBoundedResponseText}, then parse it as JSON
 *  with depth/property caps and an optional caller-supplied shape gate. Malformed JSON, over-limit nesting,
 *  or shape failure throw `ProviderTransportError` with code `response_body_shape`. */
export declare function readBoundedResponseJson<T>(response: Response, options?: ReadBoundedResponseJsonOptions): Promise<T>;
export type ParseJsonObjectArgumentsResult = {
    readonly ok: true;
    readonly value: JsonObject;
} | {
    readonly ok: false;
    readonly error: ProviderTransportError;
};
/** Parse streamed tool arguments without throwing; prefer this for recoverable tool-call recovery. */
export declare function tryParseJsonObjectArguments(text: string, options?: ParseJsonObjectArgumentsOptions): ParseJsonObjectArgumentsResult;
/** Parse streamed tool arguments as a JSON object; throws {@link ProviderTransportError} on invalid input. */
export declare function parseJsonObjectArguments(text: string, options?: ParseJsonObjectArgumentsOptions): JsonObject;
