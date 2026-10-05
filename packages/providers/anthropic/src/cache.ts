import type { ApplyCacheControlOptions, Message, ProviderRequest } from "@arnilo/prism";
import { applyCacheControl } from "@arnilo/prism";

/**
 * Whether Anthropic content `cache_control` markers may be emitted.
 * Default featured models declare `cache.kind: "cache_control"`; callers can force
 * `cache.mode: "on"` or disable via `"off"` / `cacheRetention: "none"`.
 */
export function anthropicCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

/**
 * Apply Anthropic `cache_control` markers only to selected Prism breakpoints.
 * With no breakpoints, no markers are emitted (implicit caching still applies upstream).
 */
export function applyAnthropicCacheControl(request: ProviderRequest): readonly Message[] {
  if (!anthropicCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = {
    ttl: anthropicCacheTtl(request) ? "1h" : undefined,
    maxBreakpoints: request.model.cache?.maxBreakpoints,
  };
  return applyCacheControl(request.messages, breakpoints, options) as readonly Message[];
}

function anthropicCacheTtl(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention !== "long" && request.options?.cache?.retention !== "long") return false;
  return request.model.cache?.longRetention !== false;
}
