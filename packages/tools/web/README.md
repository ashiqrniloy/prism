# @arnilo/prism-tools/web

The first-party web search and fetch tools as a Prism package. The default export is a
`definePackage` definition whose `setup` registers `web_search` and `web_fetch` into the session's
tool registry and, when a fetch backend is configured, provides the `web.fetch` service.

## Install

```bash
prism add @arnilo/prism-tools/web
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-tools/web",
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
| `backend` | `"brave"` \| `"exa"` \| `"firecrawl"` \| `"native"` \| `"obscura"` \| `"searxng"` \| `"tavily"` \| `"kagi"` | none (required) | Selects the search/fetch backend. `"native"` is fetch-only and needs no key. Missing `backend` fails the package load with a field-naming error. |
| `apiKey` | `env:NAME` \| `keyring:NAME` | none | Ref only; a literal fails config validation. Required for `brave`, `exa`, `firecrawl`, `tavily`, and `kagi`; optional for `searxng` (sent as `Authorization: Bearer <key>` for an instance behind an authenticating proxy); `native` and `obscura` need none. Resolved once through `prism.credentials.resolve`. |
| `searxng.origin` | `string` | none (required for `searxng`) | Exact origin of the self-hosted instance, e.g. `https://search.example.org`. Must be an exact HTTPS origin; a missing one writes a `warn` note and registers nothing. |
| `searxng.allowLoopback` | `boolean` | `false` | Accepts a plaintext `http://` origin, but only when its hostname is loopback (`127.0.0.1`, `::1`, `localhost`). No other origin escapes the exact-HTTPS rule. |
| `fetch.backend` | `"native"` \| `"firecrawl"` \| `"off"` | `"native"` | Second backend used for `web_fetch` when `backend` is `brave` or `exa`. `"native"` is keyless; `"off"` registers `web_search` only. |
| `fetch.apiKey` | `env:NAME` \| `keyring:NAME` | none | Ref only. Required for the Firecrawl fetch backend. When unresolved, `web_search` is registered and a warn note explains the missing fetch. |
| `fetch.prompt` | `{ model: string \| { provider, model }, maxInputChars?: number, maxOutputTokens?: number }` | none (off) | Adds a `prompt` argument to `web_fetch`: the configured model answers one question from up to `maxInputChars` of the page (default 100 000), with an output budget of `maxOutputTokens` (default 1 024, never above the model's own ceiling). The page is wrapped in the kernel's untrusted envelope and the request carries no tools; the answer is returned as untrusted text with `value { url, title, answer, inputChars, sourceTruncated, usage }`. The model is host-chosen and resolved once at setup — a bad ref writes a `warn` note and leaves `web_fetch` without the argument. |
| `fetch.userAgent` | `string` | `Prism-Web-Fetch/<version> (+https://github.com/ashiqrniloy/prism)` | The `user-agent` the native backend sends. Only the native fetch reads it. |
| `obscura.binary` | `string` | `"obscura"` | Absolute path or a bare name resolved against absolute `PATH` entries. Used only when `backend` is `"obscura"`. |
| `obscura.nativeTools` | `boolean` | `true` | Registers the native `obscura_fetch`/`obscura_scrape` tools alongside `web_search`/`web_fetch`. |
| `obscura.limits` | `object` | tool defaults | `ObscuraWebLimits` keys (`maxQueryBytes`, `maxResults`, `maxUrls`, `maxConcurrency`, `maxOutputBytes`, `maxStderrBytes`, `timeoutMs`, `maxEvalBytes`). An out-of-range value fails setup with `invalid limits config` naming the key. |
| `extract.schema` | `object` | none | Registers `web_extract` over this JSON Schema. Needs a Firecrawl key (`apiKey` for `backend: "firecrawl"`, `fetch.apiKey` otherwise); without one a warn note skips only `web_extract`. The schema is compiled at setup by the kernel's `validateJsonSchema`, so an unsupported subset or a remote `$ref` fails setup naming `extract.schema`. |
| `limits` | `object` | tool defaults | Byte, retry, concurrency, and timeout bounds for the HTTP adapters. Hosts may only narrow or raise within the hard caps. |
| `cache` | `{ ttlSeconds: number, maxEntries?: number, maxBytes?: number }` | none (off) | Per-session page cache for `web_fetch` and the `web.fetch` service. `ttlSeconds` 1–86 400; `maxEntries` default 64; `maxBytes` default 16 MiB of Markdown per agent process. A repeat fetch of the same canonical URL in the same session within the TTL makes no request, returns `cached: true`, and says so in the text; `web_fetch` also gains a `refresh` argument to bypass it. Entries are LRU-evicted by count and bytes and dropped when the session closes; nothing is persisted. |
| `domains` | `{ allow?: string[], block?: string[] }` | none (everything public) | Host-enforced permission, not a model preference. Bare hostnames; a leading `*.` matches subdomains (`*.example.com` does not match `example.com`); at most 256 entries each; `block` wins over `allow`; when `allow` is present only its matches are permitted (an empty list permits none). Entries are normalized (case, trailing dot, IDN→punycode) and a malformed entry fails setup with `invalid domains config`. |

An unknown key fails `createAgent` with the kernel's config error naming the key. A missing key ref
or a missing Obscura binary registers nothing and writes a `warn` status note; it never throws.

## What it changes

Registers tools with a declared `effects` annotation:

| tool | effects | backend | notes |
| --- | --- | --- | --- |
| `web_search` | `["network"]` | `brave`, `exa`, `searxng`, `tavily`, `kagi`, `obscura` | bounded public-web search; the model reads a numbered list (title, URL, date, ≤300-character snippet, at most two highlights), while `value` keeps the citation shape |
| `web_fetch` | `["network"]` | `native` (default), `firecrawl`, `obscura` | one slice of a page's Markdown (`url`, `max_chars` 1–100 000 default 32 000, `offset`); the result is marked `untrusted_external`, so the kernel wraps it in its envelope (`docs/tools.md`) and the tool ships no banner of its own |
| `obscura_fetch`, `obscura_scrape` | `["network"]` | `obscura` (`nativeTools`) | native Obscura one-shot fetch and batch scrape |
| `web_extract` | `["network"]` | `firecrawl` | registered from `extract.schema` (package config) or by the named `createWebTools` factory with a host schema and validator |

It also provides the `web.fetch` service (a `WebFetchService` other packages use to ingest a URL)
whenever a fetch backend is configured, and keeps the per-session fetch cache in process memory
through `prism.state.agent` — never in session state or the log, so page text is never written to the
branch. Its only hook registration is an observe-only `session.closed` listener that drops that
session's cached pages. It claims no slot and emits no events of its own.

It also ships one skill, `web-research` (page text is data, give each fact's URL, say so when no page has the answer). It declares `requiresTools: web_fetch`, so a config or request without `web_fetch` does not list it. Cost: one catalog line, and the body only when the model loads it; `disable: { skills: ["web-research"] }` removes it. Its effect is measured on one hazard (`web-no-answer`: 6/9 with the skill, 1/9 without) and not in the pooled score; see [the evidence](../../../docs/_evidence/skill-evals/211/v3/web-research.preload.md).

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

| argument | Brave | Exa | SearXNG | Tavily | Kagi v1 | Obscura (DuckDuckGo HTML) |
| --- | --- | --- | --- | --- | --- | --- |
| `freshness` | `pd`/`pw`/`pm`/`py` | `startPublishedDate` (ISO, now − 1/7/30/365 days) | `time_range=day/month/year` — **no `week`** | `time_range=day/week/month/year` | `lens.timeRelative=day/week/month`; `year` becomes `filters.after` (a year ago) | `df=d/w/m/y` |
| `include_domains` (≤ 10) | `site:` operators appended to the query | `includeDomains` | `site:` operators appended to the query | `include_domains` | `lens.sitesIncluded` | `site:` operators appended to the query |
| `exclude_domains` (≤ 10) | `-site:` operators appended to the query | `excludeDomains` | `-site:` operators appended to the query | `exclude_domains` | `lens.sitesExcluded` | `-site:` operators appended to the query |
| `country` (ISO 3166-1 alpha-2) | `country` | `userLocation` | not supported — refused by name | `country` as an English name (e.g. `United States`), with `topic: general` | `filters.region` | `kl=<country>-<language>` |
| `language` (ISO 639-1) | `search_lang` | not supported — refused by name | `language` | `language` | not supported — refused by name | `kl=<country>-<language>` |
| `offset` | `offset`, 0-based, ≤ 9; larger fails naming `offset` | not supported (Exa has no paging) | `pageno` (1-based, from `offset`) | not supported (Tavily pages nothing) | `page` 1–10, so `offset` ≤ 9 | not supported (continuing a DDG result list needs a `vqd` token from a second request) |

A backend may support a control without every value: SearXNG has no `week` window, so the tool schema
offers only `day`/`month`/`year` there and a `week` request fails naming `freshness`. The narrowed
values live in each adapter's `controlValues`, which the tool builder reads.

Domain values are validated as bare hostnames before they reach a query string or a JSON body: a
scheme, path, wildcard, space, or operator syntax (`example.com OR site:evil.test`) is rejected. The
`site:`/`-site:` operators are appended to the search query, so they count toward every query limit
the provider enforces — Brave's 400-character and 50-word caps included. One search is still exactly
one provider request.

The matrix lives in one place per adapter: `supports: ReadonlySet<SearchControl>` (and, for a control
with a narrower value set, `controlValues`), which the tool builder reads to build the schema (and the
description's filter list) and the adapter reads to validate its own calls.

### Backend cost and failure behavior

| backend | what one search costs | notes |
| --- | --- | --- |
| Brave, Exa | per-query plan | keyed; a 429 is retried only because it was refused |
| SearXNG | free (self-hosted) | no key; requests are GETs, so connection failures and 429/5xx retry |
| Tavily | per credit/plan | `POST /search`, retried only on a 429 (`safe-post`); `max_results` 0–20 and no paging |
| Kagi | per-query price (see `kagi.com/api/pricing`) | API v1 `POST https://kagi.com/api/v1/search` with `Authorization: Bot <token>`; the deprecated v0 GET is not implemented |
| Firecrawl | per page/scrape | fetch/extract only |
| Obscura | free (local binary) | fetch/search through a local headless browser |

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

The page is kept in a session-scoped cache keyed by `(sessionId, canonical URL)`, so paging a page
costs one fetch and one session never reads another session's page. Without `cache` config that is
the anonymous memo — at most 8 pages, at most 10 minutes. With `cache: { ttlSeconds }` the page also
survives across tool calls: a repeat fetch within the TTL returns `cached: true` and the text says
`cached <age> ago`, `refresh: true` fetches again, and `maxEntries`/`maxBytes` bound the memory
(LRU by count and bytes, dropped when the session closes, never written to the store). The cache
costs up to `maxBytes` of process memory in exchange for fewer paid fetches; it is off by default.
A page over the fetch limit is no longer an error: the head is kept and `sourceTruncated: true` says
the tail is missing. Only a response over the transport's `maxResponseBytes` read cap fails.

With the `native` backend (the default) the page is read directly by this package, without a key:
`pinnedFetch`'s DNS pinning and SSRF check are applied to every hop, redirects are followed by hand
(up to 5, hard 10), and no cookies are stored or sent. HTML is reduced to its article body with
Readability and converted to Markdown (headings, fenced code, absolute links); `text/*`,
`application/json`, and XML pass through, JSON pretty-printed. Anything else fails with
`ERR_PRISM_WEB_CONTENT_TYPE`. The citation URL is the final URL and `value.redirects` lists the
hops. `linkedom`, `@mozilla/readability`, and `turndown` are loaded on the first HTML conversion
only, so a JSON-only host pays nothing for them.

The Obscura backend's `web_fetch` reads one `markdown` dump through the configured binary: the
pre-check resolves and validates the requested URL, then Obscura fetches it, and **the citation is the
requested URL** — `obscura fetch --dump` cannot report where it redirected (only its worker protocol
does), so a redirecting page is read at its final content under the original URL. Obscura's own
client re-validates every redirect hop from 0.1.8; on an older or unverified binary the package
registers no Obscura page path and `web_fetch` comes from the native backend instead (below).

Its `web_search` uses one replaceable HTML profile: `https://html.duckduckgo.com/html/?q=…` (the host
`duckduckgo.com/html/` only redirects there), where the profile's constant extraction expression
decodes each `result__a` through the `uddg` parameter of DuckDuckGo's `/l/` redirect and returns the
raw `href` for anything else, skipping `.result--ad` sponsored rows. A blocked page or a query with
no rows fails `web_search` with `ERR_OBSCURA_SEARCH_EMPTY` ("search returned no results; the search
page may have blocked automated access") instead of returning a silent empty list; rows whose decoded
target is not `http(s)` are dropped host-side by `citation()`. A custom `searchProfile` may return a
bare row array instead of `{ blocked, results }`; it is treated as unblocked.

When a fetch backend is configured the package also provides the `web.fetch` service:

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

`models` — declared always because capabilities are static, but `prism.models.client` is only called
when `fetch.prompt` is configured. That call runs with no session or run identity, so its usage is
**outside the run's budget**: it is reported on the tool value (`value.usage`) and in neither the
run's totals nor `RunResult`. Each `prompt` use is exactly one model call; without `fetch.prompt`
the package makes none.

## Cost, security, and failure behavior

- Provider credentials never enter tool schemas, results, prompts, telemetry, URLs, or errors. Only
  refs are accepted in config; a literal fails validation.
- The `prompt` path is a trust boundary: the page is untrusted input to a host-chosen model, the
  request has no tools, and the answer is still marked untrusted because page text can shape it.
  Page instructions cannot add a tool or a permission; at most they can mislead the answer.
- Firecrawl fetches are SSRF-checked with `assertSsrfAllowedUrl` before the request. The 0.12
  pinned-fetch and SSRF limits are unchanged.
- **`domains` is the host's permission, independent of model arguments.** `web_search` rows whose
  host is not permitted are dropped before rendering and counted in `value.filtered` (the description
  says results are limited when `allow` is set, without listing the hosts); `web_fetch`,
  `web_extract`, `obscura_fetch`, `obscura_scrape`, and the `web.fetch` service refuse a non-permitted
  URL with `ERR_PRISM_WEB_DOMAIN` naming the host. The native backend re-checks every redirect hop,
  so a permitted host cannot redirect into a blocked one; Firecrawl and Obscura follow redirects in
  their own process, so for them the policy covers the URL Prism hands over (Obscura's binary still
  re-validates private addresses per hop). Matching is a set lookup plus a suffix walk: no DNS, no
  network.
- Native fetches use the kernel's DNS-pinned request on every hop: one resolve, every candidate
  private-checked, and the socket pinned to the validated address, so a redirect cannot re-resolve
  into a private network. Plaintext `http:` is refused (there is no loopback opt-in), response
  bodies are bounded by `maxResponseBytes`, and scripts never run. Fetched HTML is never written to
  disk.
- Obscura search rows are untrusted: the decoded `uddg` target is re-validated host-side, so a link
  to `javascript:` or another scheme is dropped rather than rendered or fetched.
- Obscura fetches and scrapes pre-resolve the target hostname through the kernel's `defaultResolver`
  and reject any private, loopback, link-local, or metadata address via `assertSsrfAllowedUrl` on each
  address (`ERR_OBSCURA_SSRF`). This adds exactly one DNS resolution per fetch operation — and it
  covers only the **first** URL: the rest happens inside the Obscura process.
- **Redirects and private addresses.** Obscura follows redirects itself and, from **0.1.8**, every
  `Location` is validated and re-resolved through its own `SsrfGuardResolver`, so a redirect to a
  public-looking name that resolves to a private or metadata address is refused by the binary. Prism
  therefore probes `obscura --version` once at setup: a parsed version of at least 0.1.8 keeps the
  browser-backed `web_fetch` and the native `obscura_fetch`/`obscura_scrape`; an older version, a
  source build (`0.2.5-dev+<sha>`), an unparseable output, or a failing probe registers `web_search`
  only, serves `web_fetch` and the `web.fetch` service from the native backend (which re-checks every
  hop), and writes one `warn` status note naming the probed version. Prism never passes
  `--allow-private-network`, and the child env is only `PATH` plus the configured values, so
  `OBSCURA_ALLOW_PRIVATE_NETWORK` and `OBSCURA_PROXY` from the host are not inherited.
- Subresource loads made by the Obscura browser are **not** restricted by Prism; Obscura's own client
  resolves and validates them, and the binary is never told to allow the private network. For full
  network isolation in enterprise deployments, put the binary behind an egress proxy or in an
  isolated network container — the contained-proxy pattern `@arnilo/prism-tools/browser` requires.
- Registration performs no network request. Importing the package loads neither `playwright-core`
  nor `@arnilo/prism-extensions/mcp`; the Obscura MCP bridge is imported dynamically only when its surface is
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
import toolsWeb from "@arnilo/prism-tools/web";

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
