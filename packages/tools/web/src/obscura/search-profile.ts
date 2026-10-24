import { ObscuraError } from "./errors.js";

/**
 * One replaceable HTML search profile. The extraction expression is a constant —
 * the query travels only inside the URL-encoded search URL, never inside
 * JavaScript source, so no user text is ever evaluated.
 */
export interface SearchProfileControls {
  readonly freshness?: "day" | "week" | "month" | "year";
  readonly country?: string;
  readonly language?: string;
}
export interface ObscuraSearchProfile {
  readonly id: string;
  /** Build the public-web search URL for an encoded-ready query and the controls `kl`/`df` carry. */
  readonly searchUrl: (query: string, controls?: SearchProfileControls) => string;
  /** Constant JS evaluated in the search results page; must return JSON of `{url,title,snippet}[]`. */
  readonly extractionJs: string;
}

const DEFAULT_EXTRACTION_JS = `JSON.stringify(
  [...document.querySelectorAll('#links .result')].slice(0, 50).map((r) => ({
    url: r.querySelector('a.result__a')?.href ?? '',
    title: r.querySelector('a.result__a')?.textContent?.trim() ?? '',
    snippet: r.querySelector('.result__snippet')?.textContent?.trim() ?? '',
  }))
)`;

/** DuckDuckGo `df` windows. */
const DDG_FRESHNESS: Readonly<Record<string, string>> = { day: "d", week: "w", month: "m", year: "y" };

export const DEFAULT_OBSCURA_SEARCH_PROFILE: ObscuraSearchProfile = {
  id: "default",
  // DuckDuckGo HTML endpoint: no JS requirement, stable result markup.
  searchUrl: (query, controls = {}) => {
    const url = new URL("https://duckduckgo.com/html/");
    url.searchParams.set("q", query);
    if (controls.freshness !== undefined) url.searchParams.set("df", DDG_FRESHNESS[controls.freshness]!);
    // `kl` is a region-language pair, so both controls travel in it; the wildcard region is DDG's "any".
    if (controls.country !== undefined || controls.language !== undefined)
      url.searchParams.set("kl", `${controls.country ?? "wt"}-${controls.language ?? "en"}`);
    return url.toString();
  },
  extractionJs: DEFAULT_EXTRACTION_JS,
};

export function resolveObscuraSearchProfile(profile: ObscuraSearchProfile | undefined, maxEvalBytes: number): ObscuraSearchProfile {
  const resolved = profile ?? DEFAULT_OBSCURA_SEARCH_PROFILE;
  if (typeof resolved.id !== "string" || resolved.id.length === 0 || resolved.id.length > 64) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "search profile id must be a 1-64 character string");
  }
  if (typeof resolved.extractionJs !== "string" || resolved.extractionJs.length === 0) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "search profile extractionJs must be a non-empty string");
  }
  if (Buffer.byteLength(resolved.extractionJs, "utf8") > maxEvalBytes) {
    throw new ObscuraError("ERR_OBSCURA_LIMIT", `search profile extractionJs exceeds ${maxEvalBytes} bytes`);
  }
  if (typeof resolved.searchUrl !== "function") {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "search profile searchUrl must be a function");
  }
  return resolved;
}
