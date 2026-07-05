import type { ApplyCacheControlOptions, Message, ProviderRequest, ProviderRequestOptions } from "@arnilo/prism";
import { applyCacheControl, sanitizeCacheKey } from "@arnilo/prism";

/** `x-opencode-session` accepted length cap (OpenCode server session id). */
export const OPENCODE_SESSION_ID_MAX_LENGTH = 128;

/**
 * Resolve the OpenCode session id from cache intent first (`cacheKey`), then the
 * runtime `sessionId`. Sanitized + clamped via the shared core helper so session
 * ids cannot carry credentials, raw prompts, or disallowed characters.
 */
export function opencodeSessionId(options: ProviderRequestOptions | undefined): string | undefined {
  return sanitizeCacheKey(options?.cacheKey ?? options?.sessionId, OPENCODE_SESSION_ID_MAX_LENGTH);
}

/**
 * Provider-owned OpenCode headers. Applied after caller headers so callers cannot
 * replace `content-type` or the session id. `authorization` is added separately by
 * the provider after these.
 */
export function opencodeOwnedHeaders(options: ProviderRequestOptions | undefined): Record<string, string> {
  const sessionId = opencodeSessionId(options);
  return {
    "content-type": "application/json",
    ...(sessionId ? { "x-opencode-session": sessionId } : {}),
  };
}

/**
 * Whether Anthropic-route content `cache_control` markers may be emitted. Caching
 * is enabled unless explicitly disabled and the model opts in via
 * `ModelConfig.cache.kind: "cache_control"` (or the caller forces `cache.mode:
 * "on"` for an Anthropic-route model). The OpenAI-compatible chat route never
 * receives Anthropic `cache_control` fields.
 */
export function opencodeAnthropicCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

/**
 * Apply Anthropic-style `cache_control` markers only to the caller-selected Prism
 * breakpoints on the Anthropic Messages route, using the shared `applyCacheControl`
 * helper. Markers land on the last content block of each selected message; with no
 * breakpoints, no markers are emitted and the server relies on implicit caching.
 */
export function applyOpencodeAnthropicCacheControl(request: ProviderRequest): readonly Message[] {
  if (!opencodeAnthropicCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = {
    ttl: opencodeAnthropicCacheTtl(request) ? "1h" : undefined,
    maxBreakpoints: request.model.cache?.maxBreakpoints,
  };
  return applyCacheControl(request.messages, breakpoints, options) as readonly Message[];
}

function opencodeAnthropicCacheTtl(request: ProviderRequest): boolean {
  // Anthropic cache_control supports a `ttl: "1h"` long-retention window. Only
  // emit it when the caller asks for long retention and the model allows it.
  if (request.options?.cacheRetention !== "long" && request.options?.cache?.retention !== "long") return false;
  return request.model.cache?.longRetention !== false;
}
