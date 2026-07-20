import type { CredentialResolver, JsonObject, JsonValue, SsrfPolicy, ToolArgumentValidator, ToolDefinition } from "@arnilo/prism";

export type WebProvider = "brave" | "exa" | "firecrawl";
export interface WebRateMetadata { readonly limit?: number; readonly remaining?: number; readonly reset?: string; readonly retryAfterMs?: number; }
export interface WebProviderMetadata { readonly requestId?: string; readonly cost?: JsonValue; readonly rate?: WebRateMetadata; }
export interface WebCitation { readonly citationId: string; readonly provider: WebProvider; readonly sourceId?: string; readonly url: string; }
export interface WebSearchResult extends WebCitation { readonly title?: string; readonly snippet?: string; readonly highlights?: readonly string[]; readonly publishedAt?: string; readonly retrievedAt: string; readonly metadata?: WebProviderMetadata; }
export interface WebSearchResponse { readonly provider: "brave" | "exa"; readonly query: string; readonly results: readonly WebSearchResult[]; readonly metadata?: WebProviderMetadata; readonly untrusted: true; }
export interface WebDocument extends WebCitation { readonly title?: string; readonly markdown: string; readonly retrievedAt: string; readonly metadata?: WebProviderMetadata; readonly untrusted: true; }
export interface WebExtraction { readonly provider: "firecrawl"; readonly urls: readonly string[]; readonly data: JsonValue; readonly retrievedAt: string; readonly metadata?: WebProviderMetadata; readonly untrusted: true; }

export interface WebLimits {
  readonly maxQueryBytes?: number; readonly maxResults?: number; readonly maxUrls?: number;
  readonly maxRequestBytes?: number; readonly maxResponseBytes?: number; readonly maxMarkdownBytes?: number;
  readonly maxExtractBytes?: number; readonly maxSchemaBytes?: number; readonly maxAggregateBytes?: number;
  readonly maxJsonDepth?: number; readonly maxJsonProperties?: number; readonly maxRetries?: number;
  readonly maxRateLimitDelayMs?: number; readonly maxConcurrency?: number; readonly maxPollingAttempts?: number;
  readonly pollingDelayMs?: number; readonly timeoutMs?: number;
}
export type ResolvedWebLimits = Required<WebLimits>;
export type WebCredentialSource = string | (() => string | undefined | Promise<string | undefined>) | CredentialResolver;
export interface WebAdapterOptions { readonly credentials: WebCredentialSource; readonly allowedOrigins?: readonly string[]; readonly fetch?: typeof globalThis.fetch; readonly limits?: WebLimits; readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>; }
export interface WebSearchAdapter { readonly provider: "brave" | "exa"; search(query: string, options?: { readonly count?: number; readonly signal?: AbortSignal }): Promise<WebSearchResponse>; }
export interface WebFetchAdapter { readonly provider: "firecrawl"; fetch(url: string, options?: { readonly signal?: AbortSignal }): Promise<WebDocument>; }
export interface WebExtractAdapter { readonly provider: "firecrawl"; extract(urls: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<WebExtraction>; }
export interface FirecrawlTargetPolicy { readonly ssrf?: SsrfPolicy; readonly validateUrl?: (url: URL, signal?: AbortSignal) => void | Promise<void>; }
export interface FirecrawlExtractOptions extends WebAdapterOptions, FirecrawlTargetPolicy { readonly schema: JsonObject; readonly validator: ToolArgumentValidator; }
export interface FirecrawlFetchOptions extends WebAdapterOptions, FirecrawlTargetPolicy {}
export interface WebToolsOptions { readonly search?: WebSearchAdapter; readonly fetch?: WebFetchAdapter; readonly extract?: WebExtractAdapter; }
export type WebToolSet = readonly ToolDefinition[];
