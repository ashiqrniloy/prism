import { searchControls } from "./controls.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { SearchControl, WebAdapterOptions, WebSearchAdapter } from "./types.js";

const ORIGIN = "https://api.exa.ai";
/** Exa filters domain and dates natively; it has no result paging and no language control. */
const SUPPORTS: ReadonlySet<SearchControl> = new Set(["freshness", "includeDomains", "excludeDomains", "country"]);
const FRESHNESS_DAYS: Readonly<Record<string, number>> = { day: 1, week: 7, month: 30, year: 365 };
export function createExaSearch(options: WebAdapterOptions): WebSearchAdapter {
  const transport = createWebTransport("exa", ORIGIN, options);
  return {
    provider: "exa",
    limits: transport.limits,
    supports: SUPPORTS,
    async search(query, call = {}) {
      return transport.run(call.signal, async (signal) => {
        // An `offset` or `language` request fails here, naming the argument Exa cannot honor.
        const controls = searchControls(SUPPORTS, call);
        const normalized = query.trim();
        if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Exa query is empty or exceeds byte limit");
        const count = call.count ?? transport.limits.maxResults;
        if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Exa result count is invalid");
        const body = JSON.stringify({
          query: normalized,
          numResults: count,
          contents: { text: { maxCharacters: 2_000 }, highlights: { maxCharacters: 1_000 } },
          ...(controls.includeDomains === undefined ? {} : { includeDomains: controls.includeDomains }),
          ...(controls.excludeDomains === undefined ? {} : { excludeDomains: controls.excludeDomains }),
          ...(controls.country === undefined ? {} : { userLocation: controls.country }),
          ...(controls.freshness === undefined ? {} : { startPublishedDate: publishedSince(controls.freshness) }),
        });
        // Search is billed per request; a 429 was refused, so retrying it cannot double-bill.
        const response = await transport.json("exa", "api_key", new URL("/search", ORIGIN), { method: "POST", body }, signal, {
          retry: "safe-post",
        });
        const metadata = providerFacts(response.value, response.metadata);
        return boundedJson(
          {
            provider: "exa" as const,
            query: normalized,
            results: normalizeSearchResults("exa", normalized, response.value, count),
            metadata,
            untrusted: true as const,
          },
          transport.limits.maxJsonDepth,
          transport.limits.maxJsonProperties,
          transport.limits.maxAggregateBytes,
        );
      });
    },
  };
}

/** Exa takes an ISO 8601 instant, so a freshness window becomes a lower bound on the publish date. */
function publishedSince(freshness: string): string {
  return new Date(Date.now() - FRESHNESS_DAYS[freshness]! * 86_400_000).toISOString();
}
