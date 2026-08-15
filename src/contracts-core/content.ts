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

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cost?: number;
  readonly currency?: string;
}
