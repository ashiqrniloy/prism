# @arnilo/prism-tools-web

The first-party web search and fetch tools as a Prism package. The default export is a
`definePackage` definition whose `setup` registers `web_search` and `web_fetch` into the session's
tool registry and, when a fetch backend is configured, provides the `web.fetch` service.

## Install

```bash
prism add @arnilo/prism-tools-web
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-tools-web",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": {
    "backend": "brave",
    "apiKey": "env:BRAVE_API_KEY",
    "fetch": { "backend": "firecrawl", "apiKey": "env:FIRECRAWL_API_KEY" }
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `backend` | `"brave"` \| `"exa"` \| `"firecrawl"` \| `"obscura"` | none (required) | Selects the search/fetch backend. Missing `backend` fails the package load with a field-naming error. |
| `apiKey` | `env:NAME` \| `keyring:NAME` | none | Ref only; a literal fails config validation. Required for `brave`, `exa`, and `firecrawl`. Resolved once through `prism.credentials.resolve`. |
| `fetch.backend` | `"firecrawl"` \| `"off"` | `"firecrawl"` | Second backend used for `web_fetch` when `backend` is `brave` or `exa`. `"off"` registers `web_search` only. |
| `fetch.apiKey` | `env:NAME` \| `keyring:NAME` | none | Ref only. Required for the Firecrawl fetch backend. When unresolved, `web_search` is registered and a warn note explains the missing fetch. |
| `obscura.binary` | `string` | `"obscura"` | Absolute path or a bare name resolved against absolute `PATH` entries. Used only when `backend` is `"obscura"`. |
| `obscura.nativeTools` | `boolean` | `true` | Registers the native `obscura_fetch`/`obscura_scrape` tools alongside `web_search`/`web_fetch`. |
| `obscura.limits` | `object` | tool defaults | `ObscuraWebLimits` keys (`maxQueryBytes`, `maxResults`, `maxUrls`, `maxConcurrency`, `maxOutputBytes`, `maxStderrBytes`, `timeoutMs`, `maxEvalBytes`). An out-of-range value fails setup with `invalid limits config` naming the key. |
| `extract.schema` | `object` | none | Registers `web_extract` over this JSON Schema. Needs a Firecrawl key (`apiKey` for `backend: "firecrawl"`, `fetch.apiKey` otherwise); without one a warn note skips only `web_extract`. The schema is compiled at setup by the kernel's `validateJsonSchema`, so an unsupported subset or a remote `$ref` fails setup naming `extract.schema`. |
| `limits` | `object` | tool defaults | Byte, retry, concurrency, and timeout bounds for the HTTP adapters. Hosts may only narrow or raise within the hard caps. |

An unknown key fails `createAgent` with the kernel's config error naming the key. A missing key ref
or a missing Obscura binary registers nothing and writes a `warn` status note; it never throws.

## What it changes

Registers tools with a declared `effects` annotation:

| tool | effects | backend | notes |
| --- | --- | --- | --- |
| `web_search` | `["network"]` | `brave`, `exa`, `obscura` | bounded public-web search; the model reads a numbered list (title, URL, date, ≤300-character snippet, at most two highlights), while `value` keeps the citation shape |
| `web_fetch` | `["network"]` | any fetch-capable backend | one slice of a page's Markdown (`url`, `max_chars` 1–100 000 default 32 000, `offset`); the result is marked `untrusted_external`, so the kernel wraps it in its envelope (`docs/tools.md`) and the tool ships no banner of its own |
| `obscura_fetch`, `obscura_scrape` | `["network"]` | `obscura` (`nativeTools`) | native Obscura one-shot fetch and batch scrape |
| `web_extract` | `["network"]` | `firecrawl` | registered from `extract.schema` (package config) or by the named `createWebTools` factory with a host schema and validator |

### What the model sees, and what hosts read

Every web tool returns two things: `content` (text for the model) and `value` (structured data for
hosts, `tools-research`, and citation ledgers). Since the kernel wraps untrusted results in its
envelope, the text is the only thing the model reads, so each tool renders it for reading:

```text
1. Bun 1.4 release notes
   https://bun.sh/blog/bun-v1.4
   2026-09-30 — Bun 1.4 adds …
   · highlights, at most two per result
```

`renderSearchResults` (search) and `renderScrapeResults` (batch scrape) in `src/render.ts` are shared
by Brave, Exa, and Obscura. Rendered text is never interpreted: titles, snippets, and highlights are
collapsed to a single line, so a snippet containing `\n2. Fake result` cannot fake an entry, and no
link is synthesized from snippet text. A ten-result search renders about half the bytes of the
pre-0.14 payload (3.1 kB against 6.3 kB recorded). Provider and rate facts (`requestId`, `cost`,
`rate`) appear once on the response, never on each result.

Tool descriptions state what each tool is for, when to use `web_search` versus `web_fetch`, the
`count` default and maximum (from the resolved `maxResults`), the fetch slice defaults, and that the
content is untrusted. They name no backend vendor.

### Search controls

`web_search` takes structured controls instead of query operators, and each backend exposes only the
ones it can honor — a control the configured backend does not support fails with `ERR_PRISM_WEB_INPUT`
naming the argument rather than being silently ignored:

| argument | Brave | Exa | Obscura (DuckDuckGo HTML) |
| --- | --- | --- | --- |
| `freshness` (`day`/`week`/`month`/`year`) | `freshness=pd/pw/pm/py` | `startPublishedDate` (ISO, now − 1/7/30/365 days) | `df=d/w/m/y` |
| `include_domains` (≤ 10) | `site:` operators appended to the query | `includeDomains` | `site:` operators appended to the query |
| `exclude_domains` (≤ 10) | `-site:` operators appended to the query | `excludeDomains` | `-site:` operators appended to the query |
| `country` (ISO 3166-1 alpha-2) | `country` | `userLocation` | `kl=<country>-<language>` |
| `language` (ISO 639-1) | `search_lang` | not supported — refused by name | `kl=<country>-<language>` |
| `offset` | `offset`, 0-based, ≤ 9; larger fails naming `offset` | not supported (Exa has no paging) | not supported (continuing a DDG result list needs a `vqd` token from a second request) |

Domain values are validated as bare hostnames before they reach a query string or a JSON body: a
scheme, path, wildcard, space, or operator syntax (`example.com OR site:evil.test`) is rejected. The
`site:`/`-site:` operators are appended to the search query, so they count toward every query limit
the provider enforces — Brave's 400-character and 50-word caps included. One search is still exactly
one provider request.

The matrix lives in one place per adapter: `supports: ReadonlySet<SearchControl>`, which the tool
builder reads to build the schema (and the description's filter list) and the adapter reads to
validate its own calls.

### Paging a page

`web_fetch` returns characters `offset` to `offset + max_chars` of the page, not the whole page: a
megabyte result exceeds most context windows before compaction can run. Its text content is

```text
Showing characters 0–32000 of 100000.
Call web_fetch again with offset=32000 for more.

# Example Domain …            (32 000 characters)
```

and its `value` is the document's citation fields plus `{ markdown, offset, totalChars, truncated,
nextOffset?, sourceTruncated }`. A slice ends on a paragraph break, else a line break, when one falls
in the last tenth of the window, and never splits a surrogate pair.

The page is kept in a per-tool-instance memo keyed by `(sessionId, url)` — at most 8 pages, at most
10 minutes — so paging a page costs one fetch and one session never reads another session's page. A
page over the fetch limit is no longer an error: the head is kept and `sourceTruncated: true` says
the tail is missing. Only a response over the transport's `maxResponseBytes` read cap fails.

When a Firecrawl fetch backend is configured, the package also provides the `web.fetch` service:

```ts
interface WebFetchService {
  fetch(url: string, options?: { signal?: AbortSignal; maxBytes?: number }): Promise<WebDocument>;
}
```

`maxBytes` lowers the Markdown kept and sets `sourceTruncated`; it is clamped to `maxMarkdownBytes`,
so the service bound is the only one a consumer (the wiki and RAG loaders) can tighten.

## Capabilities

`credentials` — setup resolves the configured `apiKey` (and `fetch.apiKey`) through the credentials
slot. A resolved secret joins the agent's secret set, so it is redacted from events, notes, logs,
errors, and `inspect()` from then on.

## Cost, security, and failure behavior

- Provider credentials never enter tool schemas, results, prompts, telemetry, URLs, or errors. Only
  refs are accepted in config; a literal fails validation.
- Firecrawl fetches are SSRF-checked with `assertSsrfAllowedUrl` before the request. The 0.12
  pinned-fetch and SSRF limits are unchanged.
- Obscura fetches and scrapes pre-resolve the target hostname through the kernel's `defaultResolver`
  and reject any private, loopback, link-local, or metadata address via `assertSsrfAllowedUrl` on each
  address (`ERR_OBSCURA_SSRF`). This adds exactly one DNS resolution per fetch operation.
- **Time-of-check gap:** Because the Obscura child process/browser binary resolves hostnames independently,
  a DNS rebinding race could theoretically occur between pre-check and binary fetch. For full network
  isolation in enterprise deployments, use the contained-proxy pattern (e.g. an egress proxy or isolated
  network container) that `@arnilo/prism-tools-browser` requires.
- Registration performs no network request. Importing the package loads neither `playwright-core`
  nor `@arnilo/prism-mcp`; the Obscura MCP bridge is imported dynamically only when its surface is
  used.
- Missing key/binary is a status note and an inert package, never a throw.
- **Parallel calls wait, they do not fail.** `maxConcurrency` (default 4, hard 16) caps requests in
  flight; further calls queue up to `maxQueued` (default 64, hard 256) and then fail with
  `ERR_PRISM_WEB_LIMIT` `Web operation queue is full`. A waiting call is still bounded by
  `timeoutMs` and by the caller's signal — an aborted waiter leaves the queue, takes no slot, and
  makes no request.
- **Retries follow billing, not the HTTP verb.** Each request names a retry mode: `idempotent` (GETs
  — retry a connection failure and any 429/5xx), `safe-post` (Exa search, Firecrawl `/v2/scrape` —
  retry a connection failure and a 429, never a 5xx, since the provider may already have done the
  work) or `never` (Firecrawl `/v2/extract` job creation — a paid job is never submitted twice).
  Backoff is exponential, and a `Retry-After` header — delay-seconds or an HTTP date — is honored,
  with a date in the past meaning "retry now"; every delay stays capped by `maxRateLimitDelayMs`.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import toolsWeb from "@arnilo/prism-tools-web";

const agent = await createAgent({
  model,
  packages: [
    toolsWeb({
      backend: "brave",
      apiKey: "env:BRAVE_API_KEY",
      fetch: { backend: "firecrawl", apiKey: "env:FIRECRAWL_API_KEY" },
    }),
  ],
});
```

The 0.12 factory names (`createBraveSearch`, `createExaSearch`, `createFirecrawlFetch`,
`createFirecrawlExtractor`, `createWebTools`, `createObscuraWebTools`, `connectObscuraCdp`,
`createObscuraMcpTools`, and the limits/normalize helpers) stay exported for hosts that build tool
lists by hand.
