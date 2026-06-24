import type { CacheRetention, ProviderRequestOptions } from "@arnilo/prism";

export function promptCacheKey(options: ProviderRequestOptions | undefined): string | undefined {
  const key = options?.cacheKey ?? options?.sessionId;
  return key ? key.slice(0, 64) : undefined;
}

export function promptCacheRetention(options: ProviderRequestOptions | undefined): CacheRetention | undefined {
  return options?.cacheRetention === "none" ? undefined : options?.cacheRetention;
}
