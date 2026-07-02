import type { ModelConfig, ProviderRequestOptions } from "@arnilo/prism";
import { sanitizeCacheKey } from "@arnilo/prism";

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
