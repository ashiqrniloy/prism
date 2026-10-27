import { searchControls } from "./controls.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { SearchControl, WebAdapterOptions, WebSearchAdapter, WebSearchControlValues } from "./types.js";

/** Kagi API v1: `GET /api/v0/search` is deprecated and deliberately not implemented. */
const ORIGIN = "https://kagi.com";
/** Kagi has no language control; `year` is a date filter because `timeRelative` has no year value. */
const SUPPORTS: ReadonlySet<SearchControl> = new Set(["freshness", "includeDomains", "excludeDomains", "country", "offset"]);
const VALUES: WebSearchControlValues = { freshness: ["day", "week", "month", "year"] };
const TIME_RELATIVE: Readonly<Record<string, string>> = { day: "day", week: "week", month: "month" };
const MAX_PAGE = 10;
const HARD_OFFSET = MAX_PAGE - 1;
export function createKagiSearch(options: WebAdapterOptions): WebSearchAdapter {
  // Kagi's API key is an `Authorization: Bot <token>` credential, not a bearer token.
  const transport = createWebTransport("kagi", ORIGIN, options, { auth: "bot" });
  return {
    provider: "kagi",
    limits: transport.limits,
    supports: SUPPORTS,
    controlValues: VALUES,
    async search(query, call = {}) {
      return transport.run(call.signal, async (signal) => {
        // A `language` request fails here, naming the argument Kagi cannot honor.
        const controls = searchControls(SUPPORTS, call, VALUES);
        const normalized = query.trim();
        if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Kagi query is empty or exceeds byte limit");
        const count = call.count ?? transport.limits.maxResults;
        if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "Kagi result count is invalid");
        if (controls.offset !== undefined && controls.offset > HARD_OFFSET)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", `offset must be 0..${HARD_OFFSET}`);
        const filters = {
          ...(controls.country === undefined ? {} : { region: controls.country.toUpperCase() }),
          ...(controls.freshness === "year" ? { after: new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10) } : {}),
        };
        const lens = {
          ...(controls.includeDomains === undefined ? {} : { sitesIncluded: [...controls.includeDomains] }),
          ...(controls.excludeDomains === undefined ? {} : { sitesExcluded: [...controls.excludeDomains] }),
          ...(controls.freshness === undefined || controls.freshness === "year"
            ? {}
            : { timeRelative: TIME_RELATIVE[controls.freshness]! }),
        };
        const body = JSON.stringify({
          query: normalized,
          workflow: "search",
          page: (controls.offset ?? 0) + 1,
          limit: count,
          ...(Object.keys(filters).length === 0 ? {} : { filters }),
          ...(Object.keys(lens).length === 0 ? {} : { lens }),
        });
        // Search is billed per request; a 429 was refused, so retrying it cannot double-bill.
        const response = await transport.json(
          "kagi",
          "api_key",
          new URL("/api/v1/search", ORIGIN),
          { method: "POST", body },
          signal,
          { retry: "safe-post" },
        );
        const metadata = providerFacts(response.value, response.metadata);
        return boundedJson(
          {
            provider: "kagi" as const,
            query: normalized,
            results: normalizeSearchResults("kagi", normalized, response.value, count),
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
