import { createHash } from "node:crypto";
import { type ArtifactCitation, HARD_CITATION_EXCERPT_BYTES } from "@arnilo/prism";
import { WebToolError } from "./transport.js";
import type { WebCitation, WebProvider, WebProviderMetadata, WebSearchProvider, WebSearchResult } from "./types.js";

export function canonicalUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Provider returned an invalid URL");
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password)
    throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Provider returned an unsafe URL");
  url.hash = "";
  return url.toString();
}
export function citation(provider: WebProvider, inputUrl: string, sourceId?: string): WebCitation {
  const url = canonicalUrl(inputUrl);
  return {
    provider,
    sourceId,
    url,
    citationId: sourceId ? `web:${provider}:${sourceId}` : `web:${provider}:${createHash("sha256").update(url).digest("hex")}`,
  };
}

/** Hash an already-fetched body. Never refetches, never stores credentials. */
export function snapshotWebEvidence(input: {
  readonly url: string;
  readonly body: string | Uint8Array;
  readonly provider: WebProvider;
  readonly retrievedAt?: string;
  readonly title?: string;
  readonly sourceId?: string;
  readonly tenantId?: string;
  readonly excerpt?: string;
  readonly span?: { readonly start: number; readonly end: number };
  readonly revision?: string;
}): ArtifactCitation {
  const base = citation(input.provider, input.url, input.sourceId);
  const bytes = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
  if (input.excerpt !== undefined && Buffer.byteLength(input.excerpt, "utf8") > HARD_CITATION_EXCERPT_BYTES) {
    throw new WebToolError("ERR_PRISM_WEB_LIMIT", `excerpt exceeds ${HARD_CITATION_EXCERPT_BYTES} bytes`);
  }
  return {
    uri: base.url,
    kind: "web",
    sourceId: base.sourceId ?? base.citationId,
    revision: input.revision ?? "1",
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    support: "unverified",
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
    ...(input.span === undefined ? {} : { span: input.span }),
  };
}
/** Result rows only: provider/rate facts stay once at the response's top level, never per result. */
export function normalizeSearchResults(
  provider: WebSearchProvider,
  _query: string,
  raw: unknown,
  maxResults: number,
): readonly WebSearchResult[] {
  const root = object(raw),
    fields = SEARCH_FIELDS[provider],
    list = fields.list(root);
  if (!Array.isArray(list)) throw new WebToolError("ERR_PRISM_WEB_RESPONSE", `${provider} response has no results`);
  const seen = new Set<string>(),
    retrievedAt = new Date().toISOString(),
    out: WebSearchResult[] = [];
  for (const entry of list) {
    if (out.length >= maxResults) break;
    const item = object(entry);
    if (typeof item.url !== "string") continue;
    const base = citation(provider, item.url, typeof item.id === "string" ? item.id : undefined);
    if (seen.has(base.url)) continue;
    seen.add(base.url);
    const highlights = Array.isArray(item.highlights)
      ? item.highlights.filter((value): value is string => typeof value === "string").slice(0, 16)
      : undefined;
    out.push({
      ...base,
      title: text(item.title),
      snippet: text(item[fields.snippet]),
      highlights,
      publishedAt: text(item[fields.publishedAt]),
      retrievedAt,
    });
  }
  return out;
}
/** Where each backend keeps its rows, snippet, and publish date. One table instead of per-provider ternaries. */
const SEARCH_FIELDS: Readonly<Record<WebSearchProvider, {
  readonly list: (root: Record<string, unknown>) => unknown;
  readonly snippet: string;
  readonly publishedAt: string;
}>> = {
  brave: { list: (root) => object(root.web).results, snippet: "description", publishedAt: "page_age" },
  exa: { list: (root) => root.results, snippet: "text", publishedAt: "publishedDate" },
  searxng: { list: (root) => root.results, snippet: "content", publishedAt: "publishedDate" },
  tavily: { list: (root) => root.results, snippet: "content", publishedAt: "published_date" },
  kagi: { list: (root) => object(root.data).search, snippet: "snippet", publishedAt: "time" },
};

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new WebToolError("ERR_PRISM_WEB_RESPONSE", "Provider returned an invalid object");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
export function providerFacts(raw: unknown, base?: WebProviderMetadata): WebProviderMetadata | undefined {
  const root = object(raw);
  const requestId = text(root.requestId) ?? base?.requestId;
  const cost = root.costDollars ?? root.creditsUsed;
  return requestId || cost !== undefined || base?.rate ? { requestId, cost: toJson(cost), rate: base?.rate } : undefined;
}
function toJson(value: unknown): import("@arnilo/prism").JsonValue | undefined {
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    ? (value as import("@arnilo/prism").JsonValue)
    : undefined;
}
