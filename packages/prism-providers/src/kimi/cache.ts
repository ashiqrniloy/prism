import type { ApplyCacheControlOptions, Message, ProviderRequest } from "@arnilo/prism";
import { applyCacheControl } from "@arnilo/prism";

/**
 * Whether Anthropic-style content `cache_control` markers may be emitted on the
 * Kimi coding (`/messages`) endpoint. Default catalog models use implicit
 * caching and do not declare this; hosts opt in per-model via
 * `ModelConfig.cache.kind: "cache_control"` (or force `cache.mode: "on"`).
 * The Moonshot OpenAI-compatible route never receives Anthropic `cache_control`.
 */
export function kimiAnthropicCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

/**
 * Apply Anthropic-style `cache_control` markers only to the caller-selected Prism
 * breakpoints on the Kimi Anthropic route, using the shared `applyCacheControl`
 * helper. Markers land on the last content block of each selected message; with
 * no breakpoints, no markers are emitted and the endpoint relies on implicit caching.
 */
export function applyKimiAnthropicCacheControl(request: ProviderRequest): readonly Message[] {
  if (!kimiAnthropicCacheEnabled(request)) return request.messages;
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages;
  const options: ApplyCacheControlOptions = {
    ttl: kimiAnthropicCacheTtl(request) ? "1h" : undefined,
    maxBreakpoints: request.model.cache?.maxBreakpoints,
  };
  return applyCacheControl(request.messages, breakpoints, options) as readonly Message[];
}

function kimiAnthropicCacheTtl(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention !== "long" && request.options?.cache?.retention !== "long") return false;
  return request.model.cache?.longRetention !== false;
}
