import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import type { WebAdapterOptions, WebSearchAdapter } from "./types.js";

const ORIGIN = "https://api.exa.ai";
export function createExaSearch(options: WebAdapterOptions): WebSearchAdapter {
  const transport = createWebTransport("exa", ORIGIN, options);
  return { provider: "exa", async search(query, call = {}) { return transport.run(call.signal, async (signal) => {
    const normalized = query.trim(); if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes) throw new WebToolError("ERR_PRISM_WEB_INPUT", "Exa query is empty or exceeds byte limit");
    const count = call.count ?? transport.limits.maxResults; if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults) throw new WebToolError("ERR_PRISM_WEB_INPUT", "Exa result count is invalid");
    const body = JSON.stringify({ query: normalized, numResults: count, contents: { text: { maxCharacters: 2_000 }, highlights: { maxCharacters: 1_000 } } });
    const response = await transport.json("exa", "api_key", new URL("/search", ORIGIN), { method: "POST", body }, signal); const metadata = providerFacts(response.value, response.metadata);
    return boundedJson({ provider: "exa" as const, query: normalized, results: normalizeSearchResults("exa", normalized, response.value, count, metadata), metadata, untrusted: true as const }, transport.limits.maxJsonDepth, transport.limits.maxJsonProperties, transport.limits.maxAggregateBytes);
  }); } };
}
