/**
 * One page cache for every fetch backend: session-scoped, bounded, and in process memory only.
 *
 * `web_fetch` returns a page in slices, so a second call for the same URL in one session must not
 * pay for a second fetch. With `cache` config the page is kept for `ttlSeconds` and marked
 * `cached`; without it Prism keeps the plan 192 paging memo (10 minutes, 8 pages, no annotations)
 * through the same implementation, so there is one cache, not two. Nothing is persisted: the
 * entries live in `prism.state.agent`, which resets at package dispose, and the `session.closed`
 * hook drops a session's entries so one tenant's page never answers another session.
 */
import type { ToolsWebCacheConfig } from "./config.js";
import { WebToolError } from "./transport.js";
import type { FetchCache, WebDocument, WebFetchOptions } from "./types.js";

/** `cache.maxEntries` default. */
export const DEFAULT_CACHE_MAX_ENTRIES = 64;
/** `cache.maxBytes` default: 16 MiB of Markdown per agent process. */
export const DEFAULT_CACHE_MAX_BYTES = 16 * 1024 * 1024;
/** Hard bounds, so a config cannot turn the cache into unbounded memory. */
export const HARD_CACHE_TTL_SECONDS = 86_400;
export const HARD_CACHE_MAX_ENTRIES = 4_096;
export const HARD_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** The anonymous paging memo kept when no `cache` is configured (plan 192's values). */
export const MEMO_TTL_SECONDS = 600;
export const MEMO_MAX_ENTRIES = 8;

export interface ResolvedFetchCache {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  /** `false` for the implicit memo: no `cached` flag, no `refresh` argument. */
  readonly annotated: boolean;
}

interface CacheEntry {
  readonly document: WebDocument;
  readonly at: number;
  readonly bytes: number;
}

/** Validates `cache`; without it the memo defaults apply, unannotated. */
export function resolveFetchCache(config: ToolsWebCacheConfig | undefined): ResolvedFetchCache {
  if (config === undefined)
    return {
      ttlMs: MEMO_TTL_SECONDS * 1_000,
      maxEntries: MEMO_MAX_ENTRIES,
      maxBytes: HARD_CACHE_MAX_BYTES,
      annotated: false,
    };
  const ttl = config.ttlSeconds;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > HARD_CACHE_TTL_SECONDS)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", `cache.ttlSeconds must be an integer between 1 and ${HARD_CACHE_TTL_SECONDS}`);
  const maxEntries = config.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > HARD_CACHE_MAX_ENTRIES)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", `cache.maxEntries must be an integer between 1 and ${HARD_CACHE_MAX_ENTRIES}`);
  const maxBytes = config.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HARD_CACHE_MAX_BYTES)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", `cache.maxBytes must be an integer between 1 and ${HARD_CACHE_MAX_BYTES}`);
  return { ttlMs: ttl * 1_000, maxEntries, maxBytes, annotated: true };
}

/**
 * The cache itself: one LRU map keyed by session and URL, bounded by count and Markdown bytes.
 * Insertion order is recency, so eviction is "delete the first key".
 */
export function createFetchCache(config: ResolvedFetchCache, now: () => number = Date.now): FetchCache {
  const entries = new Map<string, CacheEntry>();
  const key = (sessionId: string | undefined, url: string) => (sessionId === undefined ? undefined : `${sessionId}\u0000${url}`);
  let bytes = 0;
  const remove = (id: string): void => {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    bytes -= entry.bytes;
  };
  return {
    annotated: config.annotated,
    read(sessionId, url, at = now()) {
      const id = key(sessionId, url);
      if (id === undefined) return undefined;
      const entry = entries.get(id);
      if (entry === undefined) return undefined;
      if (at - entry.at > config.ttlMs) {
        remove(id);
        return undefined;
      }
      // Touch: delete and re-insert so this page is the newest entry.
      entries.delete(id);
      entries.set(id, entry);
      return { document: entry.document, ageMs: Math.max(0, at - entry.at) };
    },
    write(sessionId, url, document) {
      const id = key(sessionId, url);
      if (id === undefined) return;
      const size = Buffer.byteLength(document.markdown, "utf8");
      remove(id);
      // A page larger than the whole budget is fetched again rather than evicting everything else.
      if (size > config.maxBytes) return;
      entries.set(id, { document, at: now(), bytes: size });
      bytes += size;
      for (const oldest of entries.keys()) {
        if (entries.size <= config.maxEntries && bytes <= config.maxBytes) break;
        remove(oldest);
      }
    },
    dropSession(sessionId) {
      const prefix = `${sessionId}\u0000`;
      for (const id of [...entries.keys()]) if (id.startsWith(prefix)) remove(id);
    },
  };
}

/** The cache stores the canonical URL, never the requested one, so trailing `#fragment` is one page. */
export function tryCanonicalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Decorator over anything with a `fetch`: a hit makes no request. The adapter sees the original
 * URL (so redirects and citations are unchanged); the cache is keyed by its canonical form.
 */
export function withFetchCache<T extends { fetch(url: string, options?: WebFetchOptions): Promise<WebDocument> }>(
  target: T,
  cache: FetchCache,
): T {
  return {
    ...target,
    async fetch(url: string, options?: WebFetchOptions): Promise<WebDocument> {
      const sessionId = options?.sessionId;
      const canonical = sessionId === undefined ? undefined : tryCanonicalUrl(url);
      if (sessionId === undefined || canonical === undefined) return target.fetch(url, options);
      if (options?.refresh !== true) {
        const hit = cache.read(sessionId, canonical);
        if (hit !== undefined) {
          return cache.annotated ? { ...hit.document, cached: true, cachedAgeMs: hit.ageMs } : hit.document;
        }
      }
      const document = await target.fetch(url, options);
      cache.write(sessionId, canonical, document);
      return document;
    },
  };
}
