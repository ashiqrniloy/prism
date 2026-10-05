import type { ApplyCacheControlOptions, CacheControlledMessage, JsonObject, ProviderRequest } from "@arnilo/prism";
import { applyCacheControl } from "@arnilo/prism";

/**
 * DashScope explicit context cache accepts at most 4 `cache_control` markers per
 * request (each marking a cached prefix of ≥1024 tokens, 5-minute TTL).
 * @see https://www.alibabacloud.com/help/en/model-studio/context-cache
 */
export const ALIBABA_MAX_CACHE_BREAKPOINTS = 4;

/**
 * Whether explicit `cache_control` markers may be emitted for this request.
 * Enabled when not disabled (`cacheRetention !== "none"`, `cache.mode !== "off"`)
 * and the model opts in (`cache.kind === "cache_control"`) or the caller forces
 * `cache.mode === "on"`. DashScope implicit prefix caching is automatic and needs
 * no marker; explicit markers only steer the documented 4-breakpoint budget.
 */
export function alibabaCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return request.model.cache?.kind === "cache_control" || request.options?.cache?.mode === "on";
}

/**
 * Apply Anthropic-style `cache_control: {"type":"ephemeral"}` only to the requested
 * Prism breakpoints, capped at `ALIBABA_MAX_CACHE_BREAKPOINTS`. Returns Prism messages
 * with markers on the last content block of each selected message; the Alibaba message
 * serializer preserves those markers. With no breakpoints (or explicit cache disabled),
 * no markers are emitted and DashScope implicit caching handles prefix reuse.
 */
export function applyAlibabaCacheControl(request: ProviderRequest): readonly CacheControlledMessage[] {
  if (!alibabaCacheEnabled(request)) return request.messages as readonly CacheControlledMessage[];
  const breakpoints = request.options?.cache?.breakpoints;
  if (!breakpoints?.length) return request.messages as readonly CacheControlledMessage[];
  const options: ApplyCacheControlOptions = {
    maxBreakpoints: Math.min(request.model.cache?.maxBreakpoints ?? ALIBABA_MAX_CACHE_BREAKPOINTS, ALIBABA_MAX_CACHE_BREAKPOINTS),
  };
  return applyCacheControl(request.messages, breakpoints, options);
}

/**
 * Preserve a `cache_control` marker carried on a Prism content block when converting
 * to the DashScope content shape. A marker only lands on the last block of a
 * breakpoint-selected message (set by `applyAlibabaCacheControl`).
 */
export function withAlibabaCacheMarker(contentItem: JsonObject, marker: JsonObject | undefined): JsonObject {
  return marker ? { ...contentItem, cache_control: marker } : contentItem;
}
