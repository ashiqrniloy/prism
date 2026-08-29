import { ObscuraError } from "./errors.js";

/**
 * One replaceable HTML search profile. The extraction expression is a constant —
 * the query travels only inside the URL-encoded search URL, never inside
 * JavaScript source, so no user text is ever evaluated.
 */
export interface ObscuraSearchProfile {
  readonly id: string;
  /** Build the public-web search URL for an encoded-ready query. */
  readonly searchUrl: (query: string) => string;
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

export const DEFAULT_OBSCURA_SEARCH_PROFILE: ObscuraSearchProfile = {
  id: "default",
  // DuckDuckGo HTML endpoint: no JS requirement, stable result markup.
  searchUrl: (query) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
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
