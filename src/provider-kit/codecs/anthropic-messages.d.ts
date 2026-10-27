import type { JsonObject, ProviderEvent, ProviderRequest, Usage } from "../../contracts.js";
import { type CacheControlledMessage } from "../cache-helpers.js";
/**
 * Shared Anthropic Messages route serializer (body + SSE events) for the
 * dual-route gateway adapters (opencode-go, hyper).
 *
 * Provider-specific behavior is injected through {@link AnthropicMessagesRouteHooks}
 * so the serializer itself stays provider-agnostic. All hooks have sensible defaults.
 */
export interface AnthropicMessagesRouteHooks {
    /** Applies the provider's cache-control markers and returns the messages to serialize. Defaults to request.messages. */
    readonly applyCacheControl?: (request: ProviderRequest) => readonly CacheControlledMessage[];
    /** Whether assistant thinking blocks are preserved on the wire. Defaults to resolvePreserveThinking. */
    readonly preserveThinking?: (request: ProviderRequest) => boolean;
    /** Removes provider-owned compat options so they never reach the wire. Defaults to stripOwnedCompat. */
    readonly stripOwnedCompat?: (compat: JsonObject | undefined) => JsonObject | undefined;
    /** Resolved Anthropic Messages `thinking` object (generation-aware). Defaults to resolveThinkingObject. */
    readonly thinking?: (request: ProviderRequest) => JsonObject | undefined;
    /** Resolved `output_config.effort` value (official field, not top-level `effort`). Defaults to resolveReasoningEffort. */
    readonly effort?: (request: ProviderRequest) => string | undefined;
    /** Optional session/cache affinity headers injected for the route. */
    readonly affinity?: (request: ProviderRequest) => Record<string, string>;
}
export interface AnthropicMessagesEventsOptions {
    readonly signal?: AbortSignal;
    readonly secrets?: readonly (string | undefined)[];
    readonly mapUsage?: (usage: unknown) => Usage | undefined;
}
export declare function anthropicMessagesBody(request: ProviderRequest, hooks?: AnthropicMessagesRouteHooks): Promise<JsonObject>;
export declare function anthropicMessagesEvents(body: ReadableStream<Uint8Array>, signalOrOptions?: AbortSignal | AnthropicMessagesEventsOptions): AsyncIterable<ProviderEvent>;
