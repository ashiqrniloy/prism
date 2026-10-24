# Changelog

## [Unreleased]

### Added

- **Package config reaches every backend (plan 192 Task 8).** `toolsWeb({ backend: "obscura", obscura: { limits } })` now passes `ObscuraWebLimits` to `createObscuraWebTools` instead of silently dropping them — the config schema declares `obscura.limits`, and an out-of-range value fails setup with `invalid limits config` naming the key. The Obscura backend also provides the `web.fetch` service, built on the exported `createObscuraPageFetcher` (the same URL-validated, byte-bounded `markdown` dump the `web_fetch` tool uses), so wiki ingest and RAG URL loaders work with Obscura. A new `extract.schema` config field registers `web_extract` over that schema: it takes the main key for `backend: "firecrawl"` and `fetch.apiKey` otherwise, compiles the schema at setup with the kernel's `validateJsonSchema` (so an unsupported subset or a remote `$ref` fails setup naming `extract.schema`), and a missing Firecrawl key writes a `warn` note and skips only `web_extract`. `ToolsWebObscuraConfig.limits` and `ToolsWebExtractConfig` are new public config types.

- **`web_search` takes structured search controls, per backend (plan 192 Task 6).** `freshness` (`day`/`week`/`month`/`year`), `include_domains` and `exclude_domains` (each up to 10 bare hostnames), `country` (ISO 3166-1 alpha-2), `language` (ISO 639-1) and `offset` are typed on `WebSearchAdapter.search` (`WebSearchCall`) instead of leaving models to write query operators. Brave maps them to `freshness`/`country`/`search_lang`/`offset` (0-based, capped at 9 — a larger value fails with `ERR_PRISM_WEB_INPUT` naming `offset`) and appends `site:`/`-site:` operators for domains; Exa maps them to `startPublishedDate`/`includeDomains`/`excludeDomains`/`userLocation` and refuses `offset` and `language` by name; Obscura's DuckDuckGo profile maps them to `df` and a `kl` region-language pair plus `site:` operators, and refuses `offset` because continuing the list needs a `vqd` token from a second request. Each adapter declares `supports: ReadonlySet<SearchControl>` — one table read by the tool builder and by the adapter's own validation — so the schema and description list only what the configured backend honors, and an unsupported or malformed control fails with `ERR_PRISM_WEB_INPUT` naming the argument. Domain values are validated as bare hostnames (no scheme, path, wildcard, or `site:` syntax) and the operators they generate count toward the provider's query length and word limits. `ObscuraSearchProfile.searchUrl` gained an optional `controls` argument.

### Changed

- **Search results and tool descriptions are written for the model (plan 192 Task 5).** `web_search` (Brave, Exa, and Obscura) now returns text content as a numbered list — `1. <title>`, the URL, then `<published> — <snippet>` clipped to 300 characters, plus at most two provider highlights of 200 characters each — via a shared `src/render.ts`; `value` keeps its structure and `WebSearchResult` no longer carries per-result `metadata` (provider/rate facts stay once on the response). Titles, snippets, and highlights are collapsed to one line so untrusted text cannot fake a numbered entry, and nothing in a snippet becomes a link. `obscura_scrape` renders one numbered entry per URL, and `obscura_fetch` returns one 32 000-character slice of its dump as text while `value` keeps the full output. Descriptions now say what each tool is for, when to use `web_search` versus `web_fetch`, the `count` default and maximum (the schema's `count.maximum` comes from the resolved `maxResults`), the fetch slice defaults, and that content is untrusted — with no backend vendor names. Recorded: a ten-result search renders 3.1 kB of text against 6.3 kB of the previous payload.

- **`web_fetch` pages a document instead of returning all of it (plan 192 Task 4).** `web_fetch` (Firecrawl and Obscura) takes `max_chars` (integer, default 32 000, maximum 100 000) and `offset`, and returns one slice: its text content is `Showing characters <offset>–<end> of <total>.` plus, while more remains, `Call web_fetch again with offset=<nextOffset> for more.`, then the slice; its `value` is the citation fields plus `{ markdown, offset, totalChars, truncated, nextOffset?, sourceTruncated }`. Slices end on a paragraph break, else a line break, when one falls in the last tenth of the window, and never split a surrogate pair. A page is memoized per tool instance by `(sessionId, url)` — at most 8 pages, at most 10 minutes — so paging makes no new request and one session never reads another's page. `WebDocument` gains `sourceTruncated`, `WebFetchAdapter.fetch` takes `maxBytes`, and the `web.fetch` service honors it (clamped to `maxMarkdownBytes`); the RAG web loader passes its `maxBytes` through.

### Fixed

- **Parallel web calls wait for a slot instead of failing (plan 192 Task 7).** The transport refused any call past `maxConcurrency`; it now queues up to a new `maxQueued` limit (default 64, hard 256, in `WebLimits`, `DEFAULT_WEB_LIMITS`, `HARD_WEB_LIMITS` and the package config schema) and only fails beyond it with `ERR_PRISM_WEB_LIMIT` `Web operation queue is full`. A waiter is still bounded by `timeoutMs` and the caller's signal, and an aborted waiter leaves the queue without consuming a slot or issuing a request.
- **Retries follow what a provider bills (plan 192 Task 7).** `transport.json` takes a per-request retry mode: `idempotent` (GETs; connection failures and 429/5xx), `safe-post` (Exa `/search` and Firecrawl `/v2/scrape`; connection failures and 429 only, since a 5xx may mean the work already happened) and `never` (Firecrawl `/v2/extract` job creation, so a paid job is never submitted twice). Extract polling GETs stay `idempotent`.
- **`Retry-After` given as an HTTP date is honored (plan 192 Task 7).** Only delay-seconds were parsed before; an HTTP-date value now becomes a delay from now, a date in the past means 0, and the result still caps at `maxRateLimitDelayMs`.

- **An over-limit document is truncated, not an error (plan 192 Task 4).** Firecrawl Markdown over `maxMarkdownBytes` and Obscura output over `maxOutputBytes` keep their first limit and set `sourceTruncated: true`, so the caller can read and page the head; only a response over the transport's `maxResponseBytes` read cap still fails. New helpers in `src/slice.ts` (`sliceMarkdown`, `fetchSliceText`, `fetchSliceValue`, `truncateUtf8Bytes`, `createFetchMemo`, `fetchSliceArgs`, `fetchParameters`, `DEFAULT_FETCH_CHARS`, `HARD_FETCH_CHARS`) are used by every fetch backend and are not re-exported from the package entry; they appear in `scripts/compat-baseline/arnilo__prism-tools-web.txt` because the declaration emit covers the whole source tree.

### Added

- `@arnilo/prism-tools-web` (plan 155 Task 2): the web search and fetch code moved out of
  `@arnilo/prism-web-tools` (root, `./brave`, `./exa`, `./firecrawl`, `./obscura`) into a
  source-exported package on the lockstep line. The default export is a `definePackage` definition
  whose `setup` registers `web_search` and `web_fetch` (plus the native Obscura tools when
  `backend: "obscura"`), each declaring `effects: ["network"]`. Config selects the backend:
  `{ backend, apiKey?, fetch?, obscura?, limits? }`. `apiKey` and `fetch.apiKey` are ref-only
  (`env:`/`keyring:`) and resolve once through `prism.credentials.resolve`; a literal fails
  validation. A missing key ref or a missing Obscura binary writes a `warn` status note and registers
  nothing instead of throwing.
- The `web.fetch` service, provided when a Firecrawl fetch backend is configured:
  `fetch(url, { signal?, maxBytes? }) → Promise<WebDocument>`.
- The moved module surface keeps its names as named exports behind the single entry point: the
  Brave/Exa/Firecrawl adapters, `createWebTools`, the limits/normalize/transport helpers, and the
  full Obscura surface (`createObscuraWebTools`, `connectObscuraCdp`, `createObscuraMcpTools`,
  `resolveObscuraCommand`, `validateObscuraCommand`, `spawnObscuraProcess`).
- `resolveObscuraCommand(name)`: resolves a configured Obscura command to an absolute executable
  path against absolute `PATH` entries only.

### Changed

- The `@arnilo/prism-mcp` import in the Obscura MCP bridge is now dynamic, so importing the package
  loads neither `playwright-core` nor `@arnilo/prism-mcp`. The Obscura CDP composition uses a local
  structural Playwright type instead of the browser package's types.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The web search and fetch tools shipped inside `@arnilo/prism-web-tools` before this package existed;
see that package's changelog for the pre-split history.
