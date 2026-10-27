import { domainOperatorsQuery, searchControls } from "./controls.js";
import { normalizeSearchResults, providerFacts } from "./normalize.js";
import { boundedJson, createWebTransport, WebToolError } from "./transport.js";
import type { SearchControl, WebAdapterOptions, WebCredentialSource, WebSearchAdapter, WebSearchControlValues } from "./types.js";

/** A self-hosted meta-search instance: the host names it, Prism never guesses one. */
export interface SearxngSearchOptions extends Omit<WebAdapterOptions, "credentials"> {
  /** Exact origin of the instance, e.g. `https://search.example.org`. */
  readonly origin: string;
  /** Accept an `http://` origin when its hostname is loopback (an instance on the same machine). */
  readonly allowLoopback?: boolean;
  /** Optional key, sent as `Authorization: Bearer <key>`; a fronting proxy may require it. */
  readonly credentials?: WebCredentialSource;
}

/** SearXNG has no country parameter and no `week` window; domains join the query as `site:` operators. */
const SUPPORTS: ReadonlySet<SearchControl> = new Set([
  "freshness",
  "includeDomains",
  "excludeDomains",
  "language",
  "offset",
]);
const VALUES: WebSearchControlValues = { freshness: ["day", "month", "year"] };
/** SearXNG's `time_range` spellings; only the narrowed values above are ever sent. */
const FRESHNESS: Readonly<Record<string, string>> = { day: "day", month: "month", year: "year" };
const NO_CREDENTIALS: WebCredentialSource = async () => undefined;
export function createSearxngSearch(options: SearxngSearchOptions): WebSearchAdapter {
  const keyless = options.credentials === undefined;
  // The origin rule is the transport's: exact HTTPS, or loopback HTTP only with the opt-in flag.
  const transport = createWebTransport(
    "searxng",
    options.origin,
    { ...options, credentials: options.credentials ?? NO_CREDENTIALS },
    { allowLoopback: options.allowLoopback === true, auth: keyless ? "none" : "bearer" },
  );
  return {
    provider: "searxng",
    limits: transport.limits,
    supports: SUPPORTS,
    controlValues: VALUES,
    async search(query, call = {}) {
      return transport.run(call.signal, async (signal) => {
        // A `country` request fails here, naming the argument SearXNG cannot honor.
        const controls = searchControls(SUPPORTS, call, VALUES);
        const normalized = query.trim();
        if (!normalized || Buffer.byteLength(normalized) > transport.limits.maxQueryBytes)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "SearXNG query is empty or exceeds byte limit");
        const count = call.count ?? transport.limits.maxResults;
        if (!Number.isSafeInteger(count) || count < 1 || count > transport.limits.maxResults)
          throw new WebToolError("ERR_PRISM_WEB_INPUT", "SearXNG result count is invalid");
        const url = new URL("/search", options.origin);
        url.searchParams.set("q", domainOperatorsQuery(normalized, controls));
        url.searchParams.set("format", "json");
        if (controls.language !== undefined) url.searchParams.set("language", controls.language);
        if (controls.offset !== undefined) url.searchParams.set("pageno", String(controls.offset + 1));
        if (controls.freshness !== undefined) url.searchParams.set("time_range", FRESHNESS[controls.freshness]!);
        const response = await transport.json("searxng", "api_key", url, { method: "GET", headers: { accept: "application/json" } }, signal, {
          retry: "idempotent",
        });
        const metadata = providerFacts(response.value, response.metadata);
        return boundedJson(
          {
            provider: "searxng" as const,
            query: normalized,
            results: normalizeSearchResults("searxng", normalized, response.value, count),
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
