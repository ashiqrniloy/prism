import { createWebTransport, boundedJson, WebToolError } from "./transport.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import type { WebAdapterOptions, WebSearchAdapter } from "./types.js";

const ORIGIN = "https://api.search.brave.com";
export function createBraveSearch(options: WebAdapterOptions): WebSearchAdapter {
  const transport = createWebTransport("brave", ORIGIN, options);
  return { provider: "brave", async search(query, call = {}) { return transport.run(call.signal, async (signal) => {
    const normalized = query.trim(); if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes || normalized.length > 400 || normalized.split(/\s+/u).length > 50) throw new WebToolError("ERR_PRISM_WEB_INPUT", "Brave query exceeds provider limits");
    const count = call.count ?? transport.limits.maxResults; if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults || count > 20) throw new WebToolError("ERR_PRISM_WEB_INPUT", "Brave result count is invalid");
    const url = new URL("/res/v1/web/search", ORIGIN); url.searchParams.set("q", normalized); url.searchParams.set("count", String(count));
    const response = await transport.json("brave", "subscription_token", url, { method: "GET", headers: { accept: "application/json" } }, signal); const metadata = providerFacts(response.value, response.metadata);
    return boundedJson({ provider: "brave" as const, query: normalized, results: normalizeSearchResults("brave", normalized, response.value, count, metadata), metadata, untrusted: true as const }, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties, transport.limits.maxAggregateBytes);
  }); } };
}
