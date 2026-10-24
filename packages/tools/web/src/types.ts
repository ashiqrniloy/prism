import type { CredentialValueSource, JsonObject, JsonValue, SsrfPolicy, ToolArgumentValidator, ToolDefinition } from "@arnilo/prism";

export type WebProvider = "brave" | "exa" | "firecrawl" | "obscura";
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
  readonly provider: "brave" | "exa";
  readonly query: string;
  readonly results: readonly WebSearchResult[];
  readonly metadata?: WebProviderMetadata;
  readonly untrusted: true;
}
export interface WebDocument extends WebCitation {
  readonly title?: string;
  readonly markdown: string;
  /** The page was longer than the fetch limit; `markdown` keeps its head only. */
  readonly sourceTruncated?: boolean;
  readonly retrievedAt: string;
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
export type WebCredentialSource = CredentialValueSource;
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
export interface WebSearchCall extends SearchControls {
  readonly count?: number;
  readonly signal?: AbortSignal;
}
export interface WebSearchAdapter {
  readonly provider: "brave" | "exa";
  /** Resolved limits, so `web_search` can state the real `count` maximum. */
  readonly limits?: WebLimits;
  /** One table per adapter, read by the tool builder and by the adapter's own validation. */
  readonly supports: ReadonlySet<SearchControl>;
  search(query: string, options?: WebSearchCall): Promise<WebSearchResponse>;
}
export interface WebFetchAdapter {
  readonly provider: "firecrawl";
  /** `maxBytes` lowers the Markdown kept (`maxMarkdownBytes` is the ceiling) and flags the truncation. */
  fetch(url: string, options?: { readonly signal?: AbortSignal; readonly maxBytes?: number }): Promise<WebDocument>;
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
export interface WebToolsOptions {
  readonly search?: WebSearchAdapter;
  readonly fetch?: WebFetchAdapter;
  readonly extract?: WebExtractAdapter;
}

/** The `web.fetch` service `@arnilo/prism-tools-web` provides when a fetch backend is configured. */
export interface WebFetchService {
  fetch(url: string, options?: { readonly signal?: AbortSignal; readonly maxBytes?: number }): Promise<WebDocument>;
}
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export type WebToolSet = readonly ToolDefinition[];
