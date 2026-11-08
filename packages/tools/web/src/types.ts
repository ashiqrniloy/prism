import type { JsonObject, JsonValue, SsrfPolicy, ToolArgumentValidator, ToolDefinition, Usage } from "@arnilo/prism";

import type { DomainPolicy } from "./domains.js";

export type WebProvider = "brave" | "exa" | "firecrawl" | "native" | "obscura" | "searxng" | "tavily" | "kagi";
/** The backends that answer `web_search` (the others are fetch/extract only). */
export type WebSearchProvider = "brave" | "exa" | "searxng" | "tavily" | "kagi";
export interface WebRateMetadata {
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: string;
  readonly retryAfterMs?: number;
}
export interface WebProviderMetadata {
  readonly requestId?: string;
  readonly cost?: JsonValue;
  readonly rate?: WebRateMetadata;
}
export interface WebCitation {
  readonly citationId: string;
  readonly provider: WebProvider;
  readonly sourceId?: string;
  readonly url: string;
}
export interface WebSearchResult extends WebCitation {
  readonly title?: string;
  readonly snippet?: string;
  readonly highlights?: readonly string[];
  readonly publishedAt?: string;
  readonly retrievedAt: string;
}
export interface WebSearchResponse {
  readonly provider: WebSearchProvider;
  readonly query: string;
  readonly results: readonly WebSearchResult[];
  /** Results dropped by the host domain policy. */
  readonly filtered?: number;
  readonly metadata?: WebProviderMetadata;
  readonly untrusted: true;
}
export interface WebDocument extends WebCitation {
  readonly title?: string;
  readonly markdown: string;
  /** The page was longer than the fetch limit; `markdown` keeps its head only. */
  readonly sourceTruncated?: boolean;
  /** Targets followed, in order; `url` is the final one. Only the `native` backend reports them. */
  readonly redirects?: readonly string[];
  readonly retrievedAt: string;
  /** Served from the session cache; `cachedAgeMs` is how old the stored copy is. Only with `cache` config. */
  readonly cached?: true;
  readonly cachedAgeMs?: number;
  readonly metadata?: WebProviderMetadata;
  readonly untrusted: true;
}
export interface WebExtraction {
  readonly provider: "firecrawl";
  readonly urls: readonly string[];
  readonly data: JsonValue;
  readonly retrievedAt: string;
  readonly metadata?: WebProviderMetadata;
  readonly untrusted: true;
}

export interface WebLimits {
  readonly maxQueryBytes?: number;
  readonly maxResults?: number;
  readonly maxUrls?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxMarkdownBytes?: number;
  readonly maxExtractBytes?: number;
  readonly maxSchemaBytes?: number;
  readonly maxAggregateBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
  readonly maxRetries?: number;
  readonly maxRateLimitDelayMs?: number;
  readonly maxConcurrency?: number;
  /** Calls waiting for a slot; only past this many does the transport refuse a new one. */
  readonly maxQueued?: number;
  readonly maxPollingAttempts?: number;
  readonly pollingDelayMs?: number;
  readonly timeoutMs?: number;
}
export type ResolvedWebLimits = Required<WebLimits>;
/** A lazily resolved key (the kit's `SecretSource` shape); the package builds it from an `env:`/`keyring:` ref. A literal string does not type-check. */
export type WebCredentialSource = () => Promise<string | undefined>;
export interface WebAdapterOptions {
  readonly credentials: WebCredentialSource;
  readonly allowedOrigins?: readonly string[];
  readonly fetch?: typeof globalThis.fetch;
  readonly limits?: WebLimits;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export type SearchFreshness = "day" | "week" | "month" | "year";
/** Structured search controls: the tool schema exposes only what a backend supports. */
export interface SearchControls {
  readonly freshness?: SearchFreshness;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly country?: string;
  readonly language?: string;
  readonly offset?: number;
}
export type SearchControl = keyof SearchControls;
/** Narrowed value sets for a control a backend supports only partly (the tool schema follows them). */
export interface WebSearchControlValues {
  readonly freshness?: readonly SearchFreshness[];
}
export interface WebSearchCall extends SearchControls {
  readonly count?: number;
  readonly signal?: AbortSignal;
}
export interface WebSearchAdapter {
  readonly provider: WebSearchProvider;
  /** Resolved limits, so `web_search` can state the real `count` maximum. */
  readonly limits?: WebLimits;
  /** One table per adapter, read by the tool builder and by the adapter's own validation. */
  readonly supports: ReadonlySet<SearchControl>;
  /** The values a backend accepts for a supported control, when it accepts only some (e.g. no `week`). */
  readonly controlValues?: WebSearchControlValues;
  search(query: string, options?: WebSearchCall): Promise<WebSearchResponse>;
}
/** One fetch request. `sessionId` opts into the per-session cache; `refresh` bypasses a cached page. */
export interface WebFetchOptions {
  readonly signal?: AbortSignal;
  /** Lowers the Markdown kept (`maxMarkdownBytes` is the ceiling) and flags the truncation. */
  readonly maxBytes?: number;
  /** The session the page belongs to. Without it the cache is not consulted and nothing is stored. */
  readonly sessionId?: string;
  /** Fetch again even when the session has a fresh cached page. */
  readonly refresh?: boolean;
}
export interface WebFetchAdapter {
  readonly provider: "firecrawl" | "native";
  fetch(url: string, options?: WebFetchOptions): Promise<WebDocument>;
}
export interface WebExtractAdapter {
  readonly provider: "firecrawl";
  extract(urls: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<WebExtraction>;
}
export interface FirecrawlTargetPolicy {
  readonly ssrf?: SsrfPolicy;
  readonly validateUrl?: (url: URL, signal?: AbortSignal) => void | Promise<void>;
}
export interface FirecrawlExtractOptions extends WebAdapterOptions, FirecrawlTargetPolicy {
  readonly schema: JsonObject;
  readonly validator: ToolArgumentValidator;
}
export interface FirecrawlFetchOptions extends WebAdapterOptions, FirecrawlTargetPolicy {}
/** A page and how long ago it was fetched, as the cache returns it. */
export interface CachedPage {
  readonly document: WebDocument;
  readonly ageMs: number;
}
/**
 * A session-scoped page cache. `annotated` marks entries with `cached`/`cachedAgeMs` and adds the
 * model's `refresh` argument; the fixed memo Prism keeps without `cache` config is anonymous.
 */
export interface FetchCache {
  readonly annotated: boolean;
  /** Keyed by session id plus canonical URL; `undefined` never matches and never stores. */
  read(sessionId: string | undefined, url: string, now?: number): CachedPage | undefined;
  write(sessionId: string | undefined, url: string, document: WebDocument): void;
  /** Drops one session's pages; called from the `session.closed` hook. */
  dropSession(sessionId: string): void;
}
/** The answer to a `web_fetch` question, plus what the sub-call cost (outside the run's budget). */
export interface PromptAnswer {
  readonly answer: string;
  readonly inputChars: number;
  readonly sourceTruncated: boolean;
  readonly usage?: Usage;
}
/** Opt-in `fetch.prompt` support: one bounded, tool-free model call over the page. */
export interface PromptFetch {
  answer(page: WebDocument, question: string, options?: { readonly signal?: AbortSignal }): Promise<PromptAnswer>;
}
export interface WebToolsOptions {
  readonly search?: WebSearchAdapter;
  readonly fetch?: WebFetchAdapter;
  readonly extract?: WebExtractAdapter;
  /** Host-owned permission: filters search rows and refuses non-permitted fetch/extract targets. */
  readonly domains?: DomainPolicy;
  /** Per-session page cache; without it `web_fetch` uses the short anonymous paging memo. */
  readonly cache?: FetchCache;
  /** Adds the `web_fetch` `prompt` argument: one model call answers a question from the page. */
  readonly prompt?: PromptFetch;
}

/** The `web.fetch` service `@arnilo/prism-tools-web` provides when a fetch backend is configured. */
export interface WebFetchService {
  fetch(url: string, options?: WebFetchOptions): Promise<WebDocument>;
}
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export type WebToolSet = readonly ToolDefinition[];
