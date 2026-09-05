/** Contracts-core content family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AudioContent, DocumentContent, FileContent } from "../content.js";
import type { ModelCacheCapabilities } from "./provider.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ErrorInfo {
  readonly name?: string;
  readonly message: string;
  readonly code?: string | number;
  /** Provider backpressure hint (e.g. from a `Retry-After` header); retry policies
   *  honor it capped at their own `maxDelayMs`. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | FileContent
  | DocumentContent
  | VideoContent
  | ThinkingContent
  | ToolCallDeltaContent
  | ToolCallContent
  | ToolResultContent;

export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ImageContent {
  readonly type: "image";
  readonly mimeType?: string;
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VideoContent {
  readonly type: "video";
  readonly mediaType?: string;
  readonly name?: string;
  /** Base64-encoded video bytes. */
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly durationMs?: number;
  /** Frame-sampling hint for providers that downsample (e.g. Qwen-VL defaults to 2.0). */
  readonly fps?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ThinkingContent {
  readonly type: "thinking";
  readonly text: string;
  readonly signature?: string;
}

export interface ToolCallDeltaContent {
  readonly type: "tool_call_delta";
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsText?: string;
  /** Who executes the call. `"provider-hosted"` = the provider runs it server-side;
   *  the host must NOT dispatch it or send a `tool_result`. Defaults to `"host"`. */
  readonly authority?: ToolCallAuthority;
}

export type ToolCallAuthority = "host" | "provider-hosted";

export interface ToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
  /** Set when streamed arguments failed JSON parse; dispatch blocks without execute(). */
  readonly argumentsError?: ErrorInfo;
  /** Who executes the call. `"provider-hosted"` = the provider already ran it
   *  server-side; the host must NOT dispatch it or append a `tool_result`. The
   *  assistant response text already incorporates the call's effect. */
  readonly authority?: ToolCallAuthority;
}

export interface ToolResultContent {
  readonly type: "tool_result";
  readonly toolCallId: string;
  readonly name: string;
  readonly result?: unknown;
  readonly error?: ErrorInfo;
}

export interface Message {
  readonly id?: string;
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: readonly ContentBlock[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly displayName?: string;
  readonly capabilities?: ModelCapabilities;
  readonly limits?: ModelLimits;
  readonly cost?: ModelCost;
  readonly cache?: ModelCacheCapabilities;
  readonly compat?: JsonObject;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ModelCapabilities {
  /** Known values include `text`, `image`, `audio`, `file`, and `document`. */
  readonly input?: readonly string[];
  readonly output?: readonly string[];
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly streaming?: boolean;
  /** Native JSON-schema structured output support for this model. */
  readonly structuredOutput?: boolean | "json_schema";
  /** Provider-neutral embeddings generation support (plan 061). */
  readonly embeddings?: boolean;
  /** Portable thinking/reasoning effort levels this model declares, ascending ladder order (`none` < `minimal` < `low` < `medium` < `high` < `xhigh` < `max`). Advisory legality metadata for hosts; absent means forward-compat passthrough (phase 65). */
  readonly thinkingLevels?: readonly string[];
  /** Provider-neutral speech synthesis support (plan 061). */
  readonly speech?: boolean;
  /** Provider-neutral speech transcription support (plan 061). */
  readonly transcription?: boolean;
  /** Provider-neutral image generation/editing support (plan 061). */
  readonly imageGeneration?: boolean;
  /** Provider-neutral video generation support (plan 061). */
  readonly videoGeneration?: boolean;
  /** Provider-neutral moderation classification support (plan 061). */
  readonly moderation?: boolean;
  /** Provider-neutral async batch-jobs support (plan 061). */
  readonly batchJobs?: boolean;
}

export interface ModelLimits {
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelCost {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly currency?: string;
  readonly unit?: string;
}

/** Normalized model-list/capability discovery provenance (plan 062): where a
 *  listing came from, when, and how long hosts may cache it. */
export interface ModelDiscoveryProvenance {
  readonly provider: string;
  /** ISO-8601 timestamp of the fetch (or catalog snapshot) moment. */
  readonly fetchedAt: string;
  /** `"api"` = live provider listing; `"catalog"` = host/registry snapshot, no network. */
  readonly source: "api" | "catalog";
  /** Cache-TTL guidance in milliseconds; hosts may serve the result from cache this long. */
  readonly ttlMs?: number;
}

export interface ModelDiscoveryOptions {
  /** Cache window in ms; within TTL a cached result is returned without network.
   *  `0` forces a refresh. Defaults to the adapter's configured TTL. */
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
}

/** Normalized `listModels()` result: the existing `ModelConfig` contract verbatim
 *  (id = `model`, context window = `limits`, capabilities = `capabilities`, pricing
 *  hint = `cost`) plus provenance. No new model shape ships. */
export interface ModelDiscoveryResult {
  readonly models: readonly ModelConfig[];
  readonly provenance: ModelDiscoveryProvenance;
}

/** Model-list/capability discovery seam (plan 062). Adapter implementations
 *  normalize provider listings to `ModelConfig` and cache per provider within
 *  the configured TTL; hosts merge their own catalog overrides on top. */
export interface ModelDiscovery {
  listModels(options?: ModelDiscoveryOptions): Promise<ModelDiscoveryResult>;
}

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cost?: number;
  readonly currency?: string;
}

/**
 * Host-supplied pricing adapter (plan 062): quotes cost rates per model id. Core
 * ships no pricing tables — when no catalog is configured, usage is reported
 * without cost fields. Quotes follow the repo-wide `per_million_tokens` unit
 * convention (see {@link ModelCost}); a stale or unknown model must resolve to
 * `undefined` (degrades to usage-only), never throw.
 */
export interface CostCatalog {
  get(modelId: string, options?: { readonly signal?: AbortSignal }): Promise<ModelCost | undefined>;
}
