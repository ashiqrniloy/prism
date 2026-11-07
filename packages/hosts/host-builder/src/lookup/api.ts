import type { ApiExport, ApiIndex } from "../indexes.js";
import { nearest, tokens } from "./text.js";

export interface ApiQuery {
  /** An exact export name. */
  readonly symbol?: string;
  /** Words matched against names, signatures and summaries. */
  readonly query?: string;
  /** A package name (`@arnilo/prism-approval`) that limits the search. */
  readonly package?: string;
}

export interface ApiMatch {
  readonly package: string;
  readonly subpath: string;
  /** The import specifier, for example `@arnilo/prism/testing`. */
  readonly specifier: string;
  readonly name: string;
  readonly kind: ApiExport["kind"];
  readonly signature: string;
  readonly summary?: string;
  readonly docs: readonly string[];
  readonly examples: readonly string[];
}

export interface ApiResult {
  readonly found: boolean;
  readonly matches: readonly ApiMatch[];
  /** The nearest names when nothing matched. */
  readonly nearest: readonly string[];
  readonly note?: string;
}

const MAX_MATCHES = 10;
const MAX_SIGNATURE = 4000;

function flatten(index: ApiIndex, packageName: string | undefined): ApiMatch[] {
  const matches: ApiMatch[] = [];
  for (const pkg of index.packages) {
    if (packageName !== undefined && pkg.name !== packageName) continue;
    for (const entry of pkg.entries) {
      for (const item of entry.exports) {
        matches.push({
          package: pkg.name,
          subpath: entry.subpath,
          specifier: entry.specifier,
          name: item.name,
          kind: item.kind,
          signature: item.signature.length > MAX_SIGNATURE ? `${item.signature.slice(0, MAX_SIGNATURE)} …` : item.signature,
          ...(item.summary !== undefined ? { summary: item.summary } : {}),
          docs: item.docs ?? [],
          examples: item.examples ?? [],
        });
      }
    }
  }
  return matches;
}

/**
 * Looks up a public name. `symbol` is an exact, case-sensitive match across every package and subpath;
 * `query` is a lexical search over names, signatures and summaries (a name hit outranks a signature hit).
 * With neither, or no hit, the result is `found: false` with the nearest names, never an exception.
 */
export function lookupApi(index: ApiIndex, input: ApiQuery): ApiResult {
  const all = flatten(index, input.package);
  if (input.package !== undefined && all.length === 0) {
    return {
      found: false,
      matches: [],
      nearest: nearest(
        index.packages.map((pkg) => pkg.name),
        input.package,
      ),
      note: `no package named "${input.package}"`,
    };
  }
  if (input.symbol !== undefined && input.symbol.trim() !== "") {
    const symbol = input.symbol.trim();
    const exact = all.filter((match) => match.name === symbol);
    if (exact.length > 0) return { found: true, matches: exact.slice(0, MAX_MATCHES), nearest: [] };
    return {
      found: false,
      matches: [],
      nearest: nearest(
        all.map((match) => match.name),
        symbol,
      ),
      note: `no export named "${symbol}"`,
    };
  }
  const words = tokens(input.query ?? "");
  if (words.length === 0) return { found: false, matches: [], nearest: [], note: "pass a symbol or a query" };
  const scored: Array<{ match: ApiMatch; score: number }> = [];
  for (const match of all) {
    const nameTokens = new Set(tokens(match.name));
    const lowerName = match.name.toLowerCase();
    const signature = match.signature.toLowerCase();
    const summary = (match.summary ?? "").toLowerCase();
    let score = 0;
    for (const word of words) {
      if (lowerName === word) score += 12;
      else if (nameTokens.has(word)) score += 6;
      else if (lowerName.includes(word)) score += 3;
      if (signature.includes(word)) score += 1;
      if (summary.includes(word)) score += 2;
    }
    if (score > 0) scored.push({ match, score });
  }
  // Equal scores: the shorter name is the closer match.
  scored.sort((a, b) => b.score - a.score || a.match.name.length - b.match.name.length);
  if (scored.length === 0) {
    return {
      found: false,
      matches: [],
      nearest: nearest(
        all.map((match) => match.name),
        (input.query ?? "").trim(),
      ),
      note: "no export matched the query",
    };
  }
  return { found: true, matches: scored.slice(0, MAX_MATCHES).map((entry) => entry.match), nearest: [] };
}
