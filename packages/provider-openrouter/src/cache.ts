import type { ApplyCacheControlOptions, JsonObject, Message, ProviderRequest, ProviderRequestOptions, Usage } from "@arnilo/prism";
import { applyCacheControl, sanitizeCacheKey } from "@arnilo/prism";

/** OpenRouter `session_id` / `x-session-id` documented max length. */
export const OPENROUTER_SESSION_ID_MAX_LENGTH = 256;

export function openRouterSessionId(options: ProviderRequestOptions | undefined): string | undefined {
  // Sanitize + clamp via the shared core helper. Session ids route requests and
  // identify conversations; they must never carry credentials or raw prompts.
  return sanitizeCacheKey(options?.cacheKey ?? options?.sessionId, OPENROUTER_SESSION_ID_MAX_LENGTH);
}

/**
 * Whether OpenRouter cache_control markers may be emitted for this request.
 * Caching is enabled when not explicitly disabled (`cacheRetention !== "none"`,
 * `cache.mode !== "off"`) and the model opts in via `ModelCacheCapabilities`
 * (`kind: "cache_control"`) or the legacy `compat.openRouterCache` flag.
 */
export function openRouterCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.model.compat?.openRouterCache === true || request.options?.cache?.mode === "on";
}

/**
 * Apply Anthropic-style `cache_control` only to the requested Prism breakpoints,
 * not to every content block. Returns the Prism messages with markers on the
 * last content block of each selected message; the OpenRouter message converter
 * preserves those markers. With no breakpoints, no markers are emitted and
 * OpenRouter's implicit caching (when available) handles prefix reuse.
 */
export function applyOpenRouterCacheControl(request: ProviderRequest): readonly Message[] {
  if (!openRouterCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = {
    ttl: openRouterCacheTtl(request) ? "1h" : undefined,
    maxBreakpoints: request.model.cache?.maxBreakpoints,
  };
  return applyCacheControl(request.messages, breakpoints, options) as readonly Message[];
}

/**
 * Official OpenRouter automatic Anthropic-style caching: a single top-level
 * `cache_control` when caching is enabled and the host did not select explicit
 * breakpoints. Prefer breakpoints for fine-grained control.
 * @see https://openrouter.ai/docs/guides/best-practices/prompt-caching
 */
export function openRouterTopLevelCacheControl(request: ProviderRequest): JsonObject | undefined {
  if (!openRouterCacheEnabled(request)) return undefined;
  if (request.options?.cache?.breakpoints?.length) return undefined;
  // Only emit top-level automatic cache_control for explicit cache_control models
  // (or legacy openRouterCache / cache.mode on). Implicit-cache models do not need it.
  const explicit =
    request.model.cache?.kind === "cache_control"
    || request.model.compat?.openRouterCache === true
    || request.options?.cache?.mode === "on";
  if (!explicit) return undefined;
  return openRouterCacheTtl(request)
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };
}

function openRouterCacheTtl(request: ProviderRequest): boolean {
  // Anthropic cache_control supports a `ttl: "1h"` long-retention window. Only
  // emit it when the caller asks for long retention and the model allows it.
  if (request.options?.cacheRetention !== "long" && request.options?.cache?.retention !== "long") return false;
  return request.model.cache?.longRetention !== false;
}

/**
 * Preserve a `cache_control` marker carried on a Prism content block when
 * converting to the OpenRouter content shape. Marker only lands on the last
 * block of a breakpoint-selected message (set by `applyOpenRouterCacheControl`).
 */
export function withOpenRouterCacheMarker(contentItem: JsonObject, marker: JsonObject | undefined): JsonObject {
  return marker ? { ...contentItem, cache_control: marker } : contentItem;
}

export function openRouterUsage(usage: OpenRouterUsage | undefined): Usage | undefined {
  return usage ? {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens,
  } : undefined;
}

export interface OpenRouterUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number };
}
