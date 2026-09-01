import type { Message, ModelConfig, ProviderRequest, ProviderRequestOptions } from "@arnilo/prism";
import { resolveBreakpoint, sanitizeCacheKey } from "@arnilo/prism";

/** OpenAI Responses `prompt_cache_key` accepted length cap. */
export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

export function promptCacheKey(options: ProviderRequestOptions | undefined): string | undefined {
  // Sanitize + clamp via the shared core helper so cache keys cannot carry
  // disallowed characters or exceed the provider limit. Cache keys are
  // session/customer identifiers only, never credentials.
  return sanitizeCacheKey(options?.cacheKey ?? options?.sessionId, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
}

/**
 * OpenAI Responses only accepts `prompt_cache_retention: "24h"` (extended
 * caching). Default short caching is automatic and implicit, so `"short"` and
 * `"none"` omit the field rather than emitting an invalid literal. `"long"`
 * maps to `"24h"` only when the model declares `cache.longRetention`; unknown
 * models omit the field so Prism never sends unsupported retention values.
 */
export function promptCacheRetention(options: ProviderRequestOptions | undefined, model: ModelConfig): "24h" | undefined {
  if (options?.cacheRetention === "long") return model.cache?.longRetention === true ? "24h" : undefined;
  return undefined;
}

/**
 * GPT-5.6+ explicit-only caching: `prompt_cache_options: { mode: "explicit" }`.
 * Activated when the model declares `cache.explicitBreakpoints` and the host
 * supplies `cache.breakpoints` (or forces `cache.mode: "on"`). The only TTL is
 * `"30m"` (also the default), so no ttl field is ever emitted. Older models and
 * `cache.mode: "off"` keep implicit caching with no options field.
 * @see https://developers.openai.com/api/docs/guides/prompt-caching
 */
export function promptCacheOptions(options: ProviderRequestOptions | undefined, model: ModelConfig): { mode: "explicit" } | undefined {
  if (model.cache?.explicitBreakpoints !== true || options?.cache?.mode === "off") return undefined;
  const wantsExplicit = options?.cache?.mode === "on" || !!options?.cache?.breakpoints?.length;
  return wantsExplicit ? { mode: "explicit" } : undefined;
}

export type OpenAIBreakpointMessage = Omit<Message, "content"> & {
  readonly content: readonly (Message["content"][number] & {
    readonly prompt_cache_breakpoint?: { readonly mode: "explicit" };
  })[];
};

/** Official cap: each request can create up to four cache writes. */
const OPENAI_PROMPT_CACHE_MAX_BREAKPOINTS = 4;

/**
 * Stamp `prompt_cache_breakpoint: { mode: "explicit" }` on the last content
 * block of caller-selected `cache.breakpoints` anchors (shared selection
 * semantics with `applyCacheControl`). Only runs when `promptCacheOptions`
 * activates explicit mode; `tools` breakpoints are skipped (tool definitions
 * are not markable content blocks in Responses).
 */
export function applyPromptCacheBreakpoints(request: ProviderRequest): readonly OpenAIBreakpointMessage[] {
  const messages = request.messages as readonly OpenAIBreakpointMessage[];
  if (!promptCacheOptions(request.options, request.model)) return messages;
  const breakpoints = request.options?.cache?.breakpoints ?? [];
  const max = request.model.cache?.maxBreakpoints ?? OPENAI_PROMPT_CACHE_MAX_BREAKPOINTS;
  const selected = new Set<number>();
  for (const breakpoint of breakpoints) {
    const index = resolveBreakpoint(request.messages, breakpoint);
    if (index >= 0) selected.add(index);
    if (selected.size >= max) break;
  }
  if (!selected.size) return messages;
  return messages.map((message, index) => {
    if (!selected.has(index) || !message.content.length) return message;
    const content = message.content.map((block, blockIndex) =>
      blockIndex === message.content.length - 1 && block.type === "text"
        ? { ...block, prompt_cache_breakpoint: { mode: "explicit" as const } }
        : block,
    );
    return { ...message, content };
  });
}
