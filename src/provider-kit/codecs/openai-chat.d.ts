import type { JsonObject, Message, ModelCapabilities, ModelConfig, ProviderEvent, ProviderRequest, Usage } from "../../contracts.js";
import { applyOpenAIChatStructuredOutput, assertOpenAIChatMessage, mapOpenAIChatUsage, serializeOpenAIChatStructuredOutput, serializeOpenAITool, OMITTED_TOOL_RESULT_IMAGE_NOTE, serializeToolResultText } from "../openai-primitives.js";
import { DEFAULT_OWNED_COMPAT_KEYS, preserveThinking, reasoningEffort, reasoningObject, resolvePreserveThinking, resolveReasoningEffort, resolveReasoningObject, resolveThinkingObject, stripOwnedCompat, thinkingObject } from "../thinking.js";
export { assertOpenAIChatMessage, serializeOpenAIChatStructuredOutput, applyOpenAIChatStructuredOutput, serializeOpenAITool, OMITTED_TOOL_RESULT_IMAGE_NOTE, serializeToolResultText, mapOpenAIChatUsage, DEFAULT_OWNED_COMPAT_KEYS, resolvePreserveThinking, preserveThinking, resolveReasoningEffort, reasoningEffort, resolveThinkingObject, thinkingObject, resolveReasoningObject, reasoningObject, stripOwnedCompat, };
/** Codec options shaping OpenAI Chat Completions body serialization. */
export interface OpenAIChatCodecOptions {
    /**
     * How historical thinking blocks are replayed on the wire:
     * - "reasoning_content": emitted as top-level `reasoning_content` on assistant messages (needed for reasoning continuity on gateways)
     * - "reasoning_details": emitted as `assistant.reasoning_details` entries, unchanged and in order
     * - "fold": folded into `content` as text (default)
     * - "drop": dropped completely from the wire message
     */
    readonly reasoningReplay?: "reasoning_content" | "fold" | "drop" | "reasoning_details";
    /**
     * Anthropic-style `cache_control` blocks on the Chat wire (gateway pattern, pi's
     * `cacheControlFormat: "anthropic"`):
     * - "anthropic-blocks": stamp `{type: "ephemeral"}` at the `resolvePromptCachePlan` breakpoints
     *
     * Absent means no markers are emitted. Default breakpoints match pi's placement:
     * `system_prompt`, `tools`, `last_message`.
     */
    readonly cacheControl?: "anthropic-blocks";
    /** Mark the last tool definition too; only gateways that cache tool definitions accept it. */
    readonly cacheControlOnTools?: boolean;
    /**
     * How image input capability is enforced:
     * - "capability-gated": requires model capabilities to include "image" (default, fail closed)
     * - "always": forwards image blocks without checking model capability
     */
    readonly imageInput?: "capability-gated" | "always";
    /**
     * Wire field used for token ceilings:
     * - "max_tokens": Chat Completions standard (default)
     * - "max_completion_tokens": OpenAI o-series parameter
     */
    readonly maxTokensField?: "max_tokens" | "max_completion_tokens";
    /** Whether assistant thinking blocks are preserved on the wire. Defaults to `resolvePreserveThinking(request)`. */
    readonly preserveThinking?: (request: ProviderRequest) => boolean;
    /** Resolves `reasoning_effort` snapped to declared levels. Defaults to `resolveReasoningEffort(request)`. */
    readonly reasoningEffort?: (request: ProviderRequest) => string | undefined;
    /** Resolves `thinking` object (Kimi/GLM style). Defaults to `resolveThinkingObject(request)`. */
    readonly thinkingObject?: (request: ProviderRequest) => JsonObject | undefined;
    /** Resolves `reasoning` object (OpenAI o-series style). Defaults to `resolveReasoningObject(request)`. */
    readonly reasoningObject?: (request: ProviderRequest) => JsonObject | undefined;
    /** Strips provider-owned compat options before body merge. Defaults to `stripOwnedCompat()`. */
    readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;
    /** Transform messages before serialization (e.g. cache-control markers). Defaults to `request.messages`. */
    readonly mapMessages?: (request: ProviderRequest) => readonly Message[];
    /** Extra provider-specific body fields (merged over base body). */
    readonly buildBodyExtra?: (request: ProviderRequest) => JsonObject | undefined;
    /** Optional session/cache affinity headers injected for the route. */
    readonly affinity?: (request: ProviderRequest) => Record<string, string>;
    /** Final body transform applied last. */
    readonly transformBody?: (body: JsonObject, request: ProviderRequest) => JsonObject;
    /** Custom message serializer override. */
    readonly serializeMessage?: (message: Message, request: ProviderRequest) => JsonObject;
    /** Require `[DONE]` and `finish_reason` before emitting done. Default true. */
    readonly strictCompletion?: boolean;
    /** Emit final stream usage on done event. */
    readonly doneUsage?: boolean;
    /** Handle SSE comment lines (e.g. energy/cost telemetry). */
    readonly onComment?: (text: string) => ProviderEvent | undefined;
}
export interface OpenAIChatEventsOptions {
    readonly signal?: AbortSignal;
    /** Require `[DONE]` and a `finish_reason`; `done` then carries the final usage. Default `true` (fail-closed). */
    readonly strictCompletion?: boolean;
    /** Emit the final stream usage on the `done` event. */
    readonly doneUsage?: boolean;
    readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
    /** Handle an SSE comment line (text after `:`), e.g. `: energy` / `: cost` telemetry. */
    readonly onComment?: (text: string) => ProviderEvent | undefined;
    /** Secrets to redact from stream error messages. */
    readonly secrets?: readonly (string | undefined)[];
}
/**
 * Builds an OpenAI Chat Completions wire body according to provider-specific codec options.
 */
export declare function openAIChatBody(request: ProviderRequest, options?: OpenAIChatCodecOptions): JsonObject;
/** Base Chat Completions request body builder alias. */
export declare const buildOpenAIChatBody: typeof openAIChatBody;
/**
 * Shared OpenAI Chat Completions message serializer supporting reasoning replay modes
 * and image input capability checks.
 */
export declare function serializeOpenAIChatMessage(message: Message, optionsOrCapabilities?: OpenAIChatCodecOptions | ModelCapabilities, modelOrPreserve?: ModelConfig | boolean): JsonObject;
/**
 * Shared OpenAI Chat Completions SSE stream loop: maps `data:` frames to Prism
 * `ProviderEvent` values (text/thinking deltas, tool-call fragments, usage, done/error).
 */
export declare function openAIChatEvents(body: ReadableStream<Uint8Array>, options?: OpenAIChatEventsOptions): AsyncIterable<ProviderEvent>;
