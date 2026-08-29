/** Contracts-core provider family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ProviderEvent, RealtimeEvent, ToolDefinition } from "../contracts-protocol.js";
import type { ContextBlock } from "./agent.js";
import type { JsonObject, Message, ModelConfig } from "./content.js";

export type CacheRetention = "none" | "short" | "long";
export type PromptCacheKind = "implicit" | "openai_key" | "cache_control" | "provider_specific" | "none";

export interface ModelCacheCapabilities {
  readonly kind?: PromptCacheKind;
  readonly maxKeyLength?: number;
  readonly maxBreakpoints?: number;
  readonly minCacheableTokens?: number;
  readonly longRetention?: boolean;
  /** Model accepts explicit per-block cache breakpoints (e.g. OpenAI GPT-5.6+ `prompt_cache_breakpoint`). */
  readonly explicitBreakpoints?: boolean;
}

export type PromptCacheMode = "auto" | "on" | "off";
export type PromptCacheBreakpointLocation =
  | "system_prompt"
  | "tools"
  | "stable_context"
  | "last_stable_message"
  | "last_user_message"
  | "message_id";
export type PromptCacheBreakpointTtl = "short" | "long";

export interface PromptCacheBreakpoint {
  readonly location: PromptCacheBreakpointLocation;
  readonly messageId?: string;
  readonly ttl?: PromptCacheBreakpointTtl;
}

export interface PromptCacheHints {
  readonly mode?: PromptCacheMode;
  readonly key?: string;
  readonly retention?: CacheRetention;
  readonly breakpoints?: readonly PromptCacheBreakpoint[];
}

export interface StructuredOutputOptions {
  readonly name: string;
  readonly schema: JsonObject;
  readonly strict?: boolean;
}

export interface ProviderRequestOptions {
  readonly sessionId?: string;
  readonly cacheRetention?: CacheRetention;
  readonly cacheKey?: string;
  readonly cache?: PromptCacheHints;
  readonly headers?: Readonly<Record<string, string>>;
  readonly compat?: JsonObject;
  readonly extra?: JsonObject;
  /** Provider-neutral JSON-schema structured output request. Requires model `capabilities.structuredOutput`. */
  readonly structuredOutput?: StructuredOutputOptions;
  /** Opaque provider continuation cursor (e.g. OpenAI `previous_response_id`). When set,
   *  the provider resumes from this cursor instead of re-sending full history. */
  readonly continuation?: { readonly cursor: string };
}

export interface ProviderRequest {
  readonly model: ModelConfig;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly context?: readonly ContextBlock[];
  readonly options?: ProviderRequestOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface AIProvider {
  readonly id: string;
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export type ProviderResolver = (model: ModelConfig) => AIProvider | undefined;

/** Realtime audio/session event. Realtime is a bidirectional session, not a request/response
 *  stream, so it is a separate neutral seam from `AIProvider.generate()`. Credentials are
 *  bound to the session handshake only and never appear in events. */
export interface RealtimeSession {
  readonly id: string;
  readonly provider: string;
  /** Send an audio chunk (PCM/Opus; provider-specific format set at creation). */
  sendAudio(chunk: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Inbound events (audio out, transcripts, hosted tool calls, interruption, close, error). */
  events(): AsyncIterable<RealtimeEvent>;
  /** Request the provider stop the current response mid-stream. */
  interrupt(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Close the session and release the transport. Idempotent. */
  close(reason?: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
}

/** Factory a provider exposes for realtime sessions; not part of `AIProvider`. */
export type RealtimeSessionFactory = (options: RealtimeSessionOptions) => RealtimeSession;

export interface RealtimeSessionOptions {
  readonly model: ModelConfig;
  readonly signal?: AbortSignal;
  /** Provider-specific caps override; providers enforce finite defaults. */
  readonly caps?: RealtimeCaps;
}

export interface RealtimeCaps {
  readonly maxAudioEventsPerSecond?: number;
  readonly maxBytesPerSecond?: number;
  readonly maxWallMs?: number;
}
