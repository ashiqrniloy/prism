import { domainOperatorsQuery, searchControls } from "./controls.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { SearchControl, WebAdapterOptions, WebSearchAdapter } from "./types.js";

const ORIGIN = "https://api.search.brave.com";
/** Brave supports every control; its offset is 0-based and capped at 9. */
const SUPPORTS: ReadonlySet<SearchControl> = new Set(["freshness", "includeDomains", "excludeDomains", "country", "language", "offset"]);
const HARD_OFFSET = 9;
const FRESHNESS: Readonly<Record<string, string>> = { day: "pd", week: "pw", month: "pm", year: "py" };
export function createBraveSearch(options: WebAdapterOptions): WebSearchAdapter {
  const transport = createWebTransport("brave", ORIGIN, options);
  return {
    provider: "brave",
    limits: transport.limits,
    supports: SUPPORTS,
    async search(query, call = {}) {
      return transport.run(call.signal, async (signal) => {
        const controls = searchControls(SUPPORTS, call);
        // Domain operators join the query, so they count toward every Brave query limit below.
        const normalized = domainOperatorsQuery(query.trim(), controls);
        if (
          !normalized ||
          Buffer.byteLength(normalized) > transport.limits.maxQueryBytes ||
          normalized.length > 400 ||
          normalized.split(/\s+/u).length > 50
        )
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Brave query exceeds provider limits");
        const count = call.count ?? transport.limits.maxResults;
        if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults || count > 20)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Brave result count is invalid");
        if (controls.offset !== undefined && controls.offset > HARD_OFFSET) {
          throw new WebToolError("ERR_PRISM_WEB_INPUT", `offset must be 0..${HARD_OFFSET}`);
        }
        const url = new URL("/res/v1/web/search", ORIGIN);
        url.searchParams.set("q", normalized);
        url.searchParams.set("count", String(count));
        if (controls.freshness !== undefined) url.searchParams.set("freshness", FRESHNESS[controls.freshness]!);
        if (controls.country !== undefined) url.searchParams.set("country", controls.country);
        if (controls.language !== undefined) url.searchParams.set("search_lang", controls.language);
        if (controls.offset !== undefined) url.searchParams.set("offset", String(controls.offset));
        const response = await transport.json(
          "brave",
          "subscription_token",
          url,
          { method: "GET", headers: { accept: "application/json" } },
          signal,
          { retry: "idempotent" },
        );
        const metadata = providerFacts(response.value, response.metadata);
        return boundedJson(
          {
            provider: "brave" as const,
            query: normalized,
            results: normalizeSearchResults("brave", normalized, response.value, count),
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
