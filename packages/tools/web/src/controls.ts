import type { JsonObject } from "@arnilo/prism";
import { WebToolError } from "./transport.js";
import type { SearchControl, SearchControls, SearchFreshness } from "./types.js";

/** A search accepts at most this many domains on each side. */
export const MAX_DOMAIN_CONTROLS = 10;
export const SEARCH_FRESHNESS: readonly SearchFreshness[] = ["day", "week", "month", "year"];

/** The argument name a model sees, so an error names exactly what it asked for. */
const ARGUMENT: Record<SearchControl, string> = {
  freshness: "freshness",
  includeDomains: "include_domains",
  excludeDomains: "exclude_domains",
  country: "country",
  language: "language",
  offset: "offset",
};

/** A bare hostname: no scheme, path, port, wildcard, space, or operator syntax. */
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const CODE_2 = /^[a-z]{2}$/iu;

/**
 * Validates the controls a call asked for against one backend's support matrix. A control the
 * backend cannot honor fails loudly, naming the argument — silently ignoring it would make results
 * look filtered when they are not.
 */
export function searchControls(supports: ReadonlySet<SearchControl>, input: object): SearchControls {
  const provided = input as Record<string, unknown>;
  const controls: { -readonly [K in keyof SearchControls]: SearchControls[K] } = {};
  for (const control of Object.keys(ARGUMENT) as SearchControl[]) {
    const value = provided[control];
    if (value === undefined) continue;
    const argument = ARGUMENT[control];
    if (!supports.has(control)) throw invalid(`${argument} is not supported by this search backend`);
    switch (control) {
      case "freshness":
        if (!SEARCH_FRESHNESS.includes(value as SearchFreshness))
          throw invalid(`freshness must be one of ${SEARCH_FRESHNESS.join(", ")}`);
        controls.freshness = value as SearchFreshness;
        break;
      case "includeDomains":
      case "excludeDomains":
        controls[control] = domains(value, argument);
        break;
      case "country":
        if (typeof value !== "string" || !CODE_2.test(value)) throw invalid("country must be a two-letter ISO 3166-1 code");
        controls.country = value.toLowerCase();
        break;
      case "language":
        if (typeof value !== "string" || !CODE_2.test(value)) throw invalid("language must be a two-letter ISO 639-1 code");
        controls.language = value.toLowerCase();
        break;
      case "offset":
        if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid("offset must be a non-negative integer");
        controls.offset = value as number;
        break;
    }
  }
  return controls;
}

/** Reads the tool's snake_case arguments into the typed shape `searchControls` validates. */
export function controlsFromArgs(args: JsonObject): Record<string, unknown> {
  return {
    freshness: args.freshness,
    includeDomains: args.include_domains,
    excludeDomains: args.exclude_domains,
    country: args.country,
    language: args.language,
    offset: args.offset,
  };
}

/** The `web_search` schema properties for one backend, in the model's snake_case spelling. */
export function searchControlProperties(supports: ReadonlySet<SearchControl>): JsonObject {
  const properties: Record<string, JsonObject> = {};
  const entry = (control: SearchControl, schema: JsonObject): void => {
    if (supports.has(control)) properties[ARGUMENT[control]] = schema;
  };
  entry("freshness", { type: "string", enum: [...SEARCH_FRESHNESS], description: "Only results published in this window" });
  entry("includeDomains", {
    type: "array",
    items: { type: "string" },
    maxItems: MAX_DOMAIN_CONTROLS,
    description: "Only results from these hostnames",
  });
  entry("excludeDomains", {
    type: "array",
    items: { type: "string" },
    maxItems: MAX_DOMAIN_CONTROLS,
    description: "Drop results from these hostnames",
  });
  entry("country", { type: "string", pattern: "^[A-Za-z]{2}$", description: "Two-letter country code, e.g. US" });
  entry("language", { type: "string", pattern: "^[A-Za-z]{2}$", description: "Two-letter language code, e.g. en" });
  entry("offset", { type: "integer", minimum: 0, description: "Result page offset" });
  return properties as JsonObject;
}

/**
 * Turns domain controls into the `site:`/`-site:` operators the HTML-index backends understand.
 * The operators join the query, so they count toward every query limit the provider enforces.
 */
export function domainOperatorsQuery(query: string, controls: SearchControls): string {
  const parts = [query];
  for (const domain of controls.includeDomains ?? []) parts.push(`site:${domain}`);
  for (const domain of controls.excludeDomains ?? []) parts.push(`-site:${domain}`);
  return parts.join(" ");
}

function domains(value: unknown, argument: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_DOMAIN_CONTROLS)
    throw invalid(`${argument} must be an array of at most ${MAX_DOMAIN_CONTROLS} hostnames`);
  return value.map((entry) => {
    if (typeof entry !== "string" || !HOSTNAME.test(entry)) throw invalid(`${argument} must contain bare hostnames`);
    return entry.toLowerCase();
  });
}

function invalid(message: string): WebToolError {
  return new WebToolError("ERR_PRISM_WEB_INPUT", message);
}
