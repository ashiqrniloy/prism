/**
 * Host-owned domain policy: which hosts web search may show and which URLs fetch/extract may touch.
 * Model-supplied `include_domains` is a preference, never a permission; this is the permission.
 */
import { normalizeHostname } from "@arnilo/prism";
import { WebToolError } from "./transport.js";

export interface ToolsWebDomainsConfig {
  /** When set, only matching hosts are permitted (an empty list permits none). */
  readonly allow?: readonly string[];
  /** Always refused, even when `allow` matches. */
  readonly block?: readonly string[];
}

export interface DomainPolicy {
  /** True when `allow` was configured, so `web_search` can say results are limited. */
  readonly restricted: boolean;
  readonly allows: (url: string) => boolean;
  /** Throws `ERR_PRISM_WEB_DOMAIN` naming the host when the URL is not permitted. */
  readonly assert: (url: string) => void;
  /** Keep only permitted rows; `filtered` counts the dropped ones. */
  readonly filter: <T extends { readonly url: string }>(rows: readonly T[]) => { readonly results: readonly T[]; readonly filtered: number };
}

const MAX_ENTRIES = 256;

/** One policy, built once per package, shared by search, fetch, extract, and the `web.fetch` service. */
export function createDomainPolicy(config: ToolsWebDomainsConfig): DomainPolicy {
  const allow = config.allow === undefined ? undefined : compile(config.allow, "allow");
  const block = compile(config.block ?? [], "block");

  const permitted = (host: string): boolean => {
    if (matches(host, block)) return false;
    return allow === undefined || matches(host, allow);
  };
  const allows = (url: string): boolean => {
    const host = hostOf(url);
    // A malformed URL is not a permitted host; adapters report their own error later.
    return host !== undefined && permitted(host);
  };

  return {
    restricted: allow !== undefined,
    allows,
    assert: (url) => {
      if (allows(url)) return;
      const host = hostOf(url);
      throw new WebToolError(
        "ERR_PRISM_WEB_DOMAIN",
        host === undefined ? "Host domain policy does not permit this URL" : `Host domain policy does not permit ${host}`,
      );
    },
    filter: <T extends { readonly url: string }>(rows: readonly T[]) => {
      const results = rows.filter((row) => allows(row.url));
      return { results, filtered: rows.length - results.length };
    },
  };
}

interface Compiled {
  readonly exact: ReadonlySet<string>;
  readonly wildcard: ReadonlySet<string>;
}

function compile(entries: readonly string[], field: "allow" | "block"): Compiled {
  if (entries.length > MAX_ENTRIES) throw new Error(`domains.${field} may hold at most ${MAX_ENTRIES} entries`);
  const exact = new Set<string>();
  const wildcard = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") throw new Error(`domains.${field} entries must be strings`);
    const trimmed = entry.trim();
    const isWildcard = trimmed.startsWith("*.");
    const hostPart = isWildcard ? trimmed.slice(2) : trimmed;
    if (hostPart.length === 0) throw new Error(`domains.${field} contains an empty hostname`);
    if (hostPart.includes("*")) throw new Error(`domains.${field} entry ${JSON.stringify(entry)} may only use a leading "*.", not a partial wildcard`);
    let host: string;
    try {
      const parsed = new URL(`https://${hostPart}`);
      if (parsed.port !== "" || parsed.pathname !== "/" || parsed.username !== "" || parsed.search !== "" || parsed.hash !== "")
        throw new Error("not a bare hostname");
      host = normalizeHostname(parsed.hostname);
    } catch {
      throw new Error(`domains.${field} entry ${JSON.stringify(entry)} is not a bare hostname`);
    }
    (isWildcard ? wildcard : exact).add(host);
  }
  return { exact, wildcard };
}

/** Exact host, or a strict subdomain of a `*.` entry (the apex itself does not match `*.`). */
function matches(host: string, compiled: Compiled): boolean {
  if (compiled.exact.has(host)) return true;
  let candidate = host;
  while (true) {
    const dot = candidate.indexOf(".");
    if (dot === -1) return false;
    candidate = candidate.slice(dot + 1);
    if (compiled.wildcard.has(candidate)) return true;
  }
}

function hostOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!/^https?:$/u.test(parsed.protocol)) return undefined;
  return normalizeHostname(parsed.hostname);
}
