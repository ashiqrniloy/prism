import type { ApplyCacheControlOptions, Message, ProviderRequest } from "@arnilo/prism";
import { applyCacheControl } from "@arnilo/prism";

/**
 * Whether Anthropic-route content `cache_control` markers may be emitted. Caching
 * is enabled unless explicitly disabled and the model opts in via
 * `ModelConfig.cache.kind: "cache_control"` (or the caller forces `cache.mode:
 * "on"`). The OpenAI-compatible chat route never receives Anthropic `cache_control`
 * fields — implicit prefix caching there requires no wire payload.
 */
export function hyperAnthropicCacheEnabled(request: ProviderRequest): boolean {
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
 *
 * No `ttl` is ever emitted: Hyper does not document long-retention support, so
 * `cache_control: { type: "ephemeral" }` is the only documented-safe marker.
 */
export function applyHyperAnthropicCacheControl(request: ProviderRequest): readonly Message[] {
  if (!hyperAnthropicCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = { maxBreakpoints: request.model.cache?.maxBreakpoints };
  return applyCacheControl(request.messages, breakpoints, options) as readonly Message[];
}
