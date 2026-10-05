import type { ProviderRequest } from "@arnilo/prism";
import { sanitizeCacheKey } from "@arnilo/prism";

/** Clamp for `x-grok-conv-id` (session/customer id, never a credential). */
export const XAI_CONV_ID_MAX_LENGTH = 128;

export function xaiCacheEnabled(request: ProviderRequest): boolean {
  if (request.options?.cacheRetention === "none") return false;
  if (request.options?.cache?.mode === "off") return false;
  if (request.model.cache?.kind === "none") return false;
  return true;
}

/** Sticky conversation id for xAI prefix cache routing. */
export function xGrokConvId(request: ProviderRequest): string | undefined {
  if (!xaiCacheEnabled(request)) return undefined;
  return sanitizeCacheKey(request.options?.cache?.key ?? request.options?.cacheKey ?? request.options?.sessionId, XAI_CONV_ID_MAX_LENGTH);
}
