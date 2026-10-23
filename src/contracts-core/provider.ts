/** Contracts-core provider family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ProviderEvent, ToolDefinition } from "../contracts-protocol.js";
import type { HostPort } from "../host/types.js";
import type { ContextBlock } from "./agent.js";
import type { JsonObject, Message, ModelConfig, ModelSpec } from "./content.js";
import type { EmbeddingsProvider } from "./embeddings.js";
import type { DecisionsProvider } from "./decisions.js";
import type { Secret } from "./resources.js";

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
  | "last_message"
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
  readonly model: ModelSpec;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly context?: readonly ContextBlock[];
  readonly options?: ProviderRequestOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

/** What a provider's `auth` descriptors may do to the credentials slot. The kernel never runs `login`. */
export interface AuthContext {
  readonly host: HostPort;
  readonly credentials: {
    store(ref: string, secret: Secret): Promise<void>;
    delete(ref: string): Promise<void>;
  };
}

/** How a provider is authenticated, for a host's login UI. `ref` is a `SECRET_REF`. */
export type AuthMethod =
  | { readonly kind: "api-key"; readonly ref: string }
  | { readonly kind: "oauth"; readonly id: string; login(ctx: AuthContext): Promise<void> };

export interface ModelProvider {
  readonly id: string;
  /** Declared authentication methods; a host reads them to offer login. The kernel only carries them. */
  readonly auth?: readonly AuthMethod[];
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
  /**
   * Optional model discovery behind `agent.models.list()`. Each model is the existing `ModelConfig` (id =
   * `model`, context window = `limits`). A provider without it contributes no models of its own.
   */
  models?(): Promise<readonly ModelConfig[]>;
  /**
   * Optional embeddings adapter behind `prism.models.embeddings(ref)` (plan 158): the provider's own
   * embeddings client. Absent means the model cannot embed and callers see `EmbeddingsError`.
   */
  embeddings?(): EmbeddingsProvider;
  /**
   * Optional decisions adapter behind `prism.models.decisions(ref)` (plan 195): the provider's own
   * typed-decision client. Absent means the model cannot decide and callers see `DecisionsError`.
   */
  decisions?(): DecisionsProvider;
}

/**
 * Closed taxonomy for why a provider turn stopped (plan 087 T1). Adapters map native wire
 * reasons (`finish_reason`, `stop_reason`, `finishReason`, Converse `stopReason`) through the
 * shared `mapProviderStopReason` table; `unknown` is the escape hatch for a new wire value.
 */
export type ProviderStopReason =
  | "end_turn"
  | "tool_calls"
  | "max_output_tokens"
  | "content_filter"
  | "abort"
  | "provider_error"
  | "unknown";

/**
 * Effective budget snapshot at provider-turn end (plan 087 T1): current-turn input tokens
 * against the per-request input cap, cumulative run input against its budget, and the turn
 * axis, so a host can see which limit was closest without instrumenting the session.
 */
export interface TurnBudgets {
  /** Input tokens charged for this turn: provider-reported, or a labeled fallback estimate when the
   *  provider reported none; absent when neither exists. See `inputTokensSource`. */
  readonly inputTokens?: number;
  /** Provenance of `inputTokens`: `"reported"` from the provider, `"estimated"` from the
   *  `usageEstimation: "fallback"` seam. Absent together with `inputTokens`; `usage.estimated` stays
   *  the authoritative label for the turn's usage. */
  readonly inputTokensSource?: "reported" | "estimated";
  /** Resolved per-request input cap (attention compiler when enabled); absent when no cap derivable. */
  readonly inputCap?: number;
  /** Cumulative run input budget (`RunLimits.maxInputTokens`); absent when the axis is disabled. */
  readonly runInputBudget?: number;
  /** Cumulative input tokens charged this run (all provider turns). */
  readonly runInputUsed: number;
  /** Provider turns started this run (1-based current turn at turn end). */
  readonly turns: number;
  /** Resolved clean turn cap; `null` when disabled. */
  readonly maxTurns: number | null;
}

export type ProviderResolver = (model: ModelConfig) => ModelProvider | undefined;
