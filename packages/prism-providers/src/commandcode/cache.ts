import type { ApplyCacheControlOptions, ProviderRequest } from "@arnilo/prism";
import { applyCacheControl } from "@arnilo/prism";

/**
 * Whether Command Code content `cache_control` markers may be emitted
 * (Anthropic route only). Default featured Claude models declare
 * `cache.kind: "cache_control"`; callers can force `cache.mode: "on"` or
 * disable via `"off"` / `cacheRetention: "none"`.
 */
export function commandCodeCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

/**
 * Apply `cache_control` markers only to selected Prism breakpoints. Never
 * emits a `ttl`: the upstream TTL window is undocumented on the Command Code
 * Provider API, so `cacheRetention: "long"` must not produce a marker the
 * gateway may reject. No breakpoints → no markers (implicit caching still
 * applies upstream).
 */
export function applyCommandCodeCacheControl(request: ProviderRequest) {
  if (!commandCodeCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = { maxBreakpoints: request.model.cache?.maxBreakpoints };
  return applyCacheControl(request.messages, breakpoints, options);
}
