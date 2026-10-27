import type { JsonObject, ProviderEvent, ProviderRequest, Usage } from "../../contracts.js";
/**
 * Request fields a Sign in with ChatGPT Responses route refuses with `400 unsupported_parameter`
 * (measured live, plan 204 Task 1 (e)). `max_output_tokens` is deliberately absent: the route
 * accepts it from 16 up.
 */
export declare const OPENAI_RESPONSES_UNSUPPORTED_FIELDS: readonly ["background", "conversation", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user"];
/** Smallest `max_output_tokens` the Responses route accepts (8 is refused locally, never on the wire). */
export declare const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
/** Default cap for `prompt_cache_key`; longer keys are truncated to this many characters. */
export declare const DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX = 64;
/** A body that sets a token ceiling below the route minimum fails here, not at the provider. */
export declare class ResponsesMaxOutputTokensError extends Error {
    readonly code = "max_output_tokens_below_minimum";
    constructor(requested: number);
}
/** Codec options shaping Responses body serialization. */
export interface OpenAIResponsesCodecOptions {
    /** `store` on the wire. `false` also forces `include: ["reasoning.encrypted_content"]`. Default `false`. */
    readonly store?: boolean;
    /** `stream` on the wire. Default `true`. */
    readonly stream?: boolean;
    /** Extra `include` values. The encrypted-reasoning include is added when `store` is false. */
    readonly include?: readonly string[];
    /** Body keys deleted after construction, so model `parameters` and `extra` cannot re-add a refused field. */
    readonly omitFields?: readonly string[];
    /** Cap for `prompt_cache_key`; defaults to 64 characters. */
    readonly promptCacheKeyMax?: number;
    /** `reasoning.summary` value. Absent means the model's compat decides. */
    readonly reasoningSummary?: string;
    /** Image input gate. Defaults to `"capability-gated"`. */
    readonly imageInput?: "capability-gated" | "always";
    /** Require `response.completed`/`response.incomplete` before `done`. Default `true`. */
    readonly strictCompletion?: boolean;
    /** Strip provider-owned compat options before the body merge. Defaults to `stripOwnedCompat()`. */
    readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;
    /** Final body transform applied before `omitFields`. */
    readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;
}
export interface OpenAIResponsesEventsOptions {
    readonly signal?: AbortSignal;
    /** Provider id stamped into replayed reasoning, so a foreign provider's blob is never sent back. */
    readonly provider?: string;
    /** Require a completed/incomplete terminal event; a truncated stream is then an error. Default `true`. */
    readonly strictCompletion?: boolean;
    readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
    readonly secrets?: readonly (string | undefined)[];
}
/**
 * Builds an OpenAI Responses wire body. The route is stateless and never continues a stored
 * response, so `previous_response_id` is removed even when a caller sets it.
 */
export declare function openAIResponsesBody(request: ProviderRequest, options?: OpenAIResponsesCodecOptions): JsonObject;
/** Body builder alias, matching the Chat codec's naming. */
export declare const buildOpenAIResponsesBody: typeof openAIResponsesBody;
/**
 * Function tools are flat on the Responses wire (`name`/`parameters` at the top level), not wrapped
 * in a `function` object the way Chat Completions requires.
 */
export declare function serializeResponsesTool(tool: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: JsonObject;
}): JsonObject;
/**
 * Parses the Responses SSE stream into Prism provider events. Text and reasoning summaries stream as
 * deltas; the terminal `response.completed`/`response.incomplete` carries usage and the stop reason.
 */
export declare function openAIResponsesEvents(body: ReadableStream<Uint8Array>, options?: OpenAIResponsesEventsOptions): AsyncIterable<ProviderEvent>;
/** Responses usage is inclusive: `input_tokens` already counts cache reads. */
export declare function mapOpenAIResponsesUsage(usage: unknown): Usage | undefined;
