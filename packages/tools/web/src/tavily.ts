import { searchControls } from "./controls.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { SearchControl, WebAdapterOptions, WebSearchAdapter } from "./types.js";

const ORIGIN = "https://api.tavily.com";
/** Tavily pages nothing and filters everything else natively. */
const SUPPORTS: ReadonlySet<SearchControl> = new Set([
  "freshness",
  "includeDomains",
  "excludeDomains",
  "country",
  "language",
]);
const MAX_RESULTS = 20;
const FRESHNESS: Readonly<Record<string, string>> = { day: "day", week: "week", month: "month", year: "year" };
/** Tavily's `country` takes an English country name; Prism's contract stays a two-letter code. */
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
export function createTavilySearch(options: WebAdapterOptions): WebSearchAdapter {
  const transport = createWebTransport("tavily", ORIGIN, options);
  return {
    provider: "tavily",
    limits: transport.limits,
    supports: SUPPORTS,
    async search(query, call = {}) {
      return transport.run(call.signal, async (signal) => {
        // An `offset` request fails here, naming the argument Tavily cannot honor.
        const controls = searchControls(SUPPORTS, call);
        const normalized = query.trim();
        if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Tavily query is empty or exceeds byte limit");
        const count = call.count ?? transport.limits.maxResults;
        if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults || count > MAX_RESULTS)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", `Tavily result count is invalid (1..${Math.min(transport.limits.maxResults, MAX_RESULTS)})`);
        const body = JSON.stringify({
          query: normalized,
          max_results: count,
          search_depth: "basic",
          // `country` is only honored on the general topic, so both travel together.
          topic: "general",
          ...(controls.freshness === undefined ? {} : { time_range: FRESHNESS[controls.freshness]! }),
          ...(controls.country === undefined ? {} : { country: countryName(controls.country) }),
          ...(controls.language === undefined ? {} : { language: controls.language }),
          ...(controls.includeDomains === undefined ? {} : { include_domains: [...controls.includeDomains] }),
          ...(controls.excludeDomains === undefined ? {} : { exclude_domains: [...controls.excludeDomains] }),
        });
        // Search is billed per request; a 429 was refused, so retrying it cannot double-bill.
        const response = await transport.json("tavily", "api_key", new URL("/search", ORIGIN), { method: "POST", body }, signal, {
          retry: "safe-post",
        });
        const metadata = providerFacts(response.value, response.metadata);
        return boundedJson(
          {
            provider: "tavily" as const,
            query: normalized,
            results: normalizeSearchResults("tavily", normalized, response.value, count),
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

function countryName(code: string): string {
  let name: string | undefined;
  try {
    name = REGION_NAMES.of(code.toUpperCase());
  } catch {
    name = undefined;
  }
  // The locale is fixed to `en`, so an unassigned code renders as this literal rather than a name.
  if (name === undefined || name === code.toUpperCase() || name === "Unknown Region")
    throw new WebToolError("ERR_PRISM_WEB_INPUT", "country is not a known ISO 3166-1 code");
  return name;
}
