# @arnilo/prism-web-tools

Unified web tools family for Prism. Three peer-gated surfaces, one package:

- **Root (`@arnilo/prism-web-tools`)** — bounded host-selected Brave or Exa `web_search`, Firecrawl Markdown `web_fetch`, and Firecrawl JSON `web_extract` `ToolDefinition`s over native `fetch`. No vendor SDK, browser, or binary installs or loads.
- **`@arnilo/prism-web-tools/browser`** — Playwright-peer gated browser automation (`browser_open`/`browser_snapshot`/`browser_act`/`browser_close`/`browser_evaluate`/`browser_observe`) over a host-supplied Playwright `Browser` with egress policy and upload/download/screenshot quarantine. `playwright-core@1.61.0` is an optional peer, probed lazily; the root import never resolves it.
- **`@arnilo/prism-web-tools/obscura`** — tools for a host-installed Obscura headless browser: fail-closed process lifecycle, full MCP tool bridge (`@arnilo/prism-mcp` is a required peer), CDP/Playwright composition, and bounded CLI web tools. The host binary is probed fail-closed before any process starts; the root import never touches it.

```ts
import { createBraveSearch, createFirecrawlExtractor, createFirecrawlFetch, createWebTools } from "@arnilo/prism-web-tools";

const tools = createWebTools({
  search: createBraveSearch({ credentials }),
  fetch: createFirecrawlFetch({ credentials, validateUrl: publicDnsPolicy }),
  extract: createFirecrawlExtractor({ credentials, schema, validator, validateUrl: publicDnsPolicy }),
});
```

Exports: root package, dependency-free adapter subpaths `./brave`, `./exa`, `./firecrawl`, plus `/browser` and `/obscura`. Native `fetch` is used with exact fixed provider origins and redirects disabled. Credentials resolve immediately before each request and never enter tool arguments/results/errors.

Results carry stable citation IDs and `untrusted: true`; tool results add `trust: "untrusted_external"`. External content never changes instructions, tools, permissions, credentials, or routing. Firecrawl URL handoff applies Prism SSRF syntax/private-literal policy and optional host DNS/egress validation; Firecrawl performs target retrieval, so Prism does not claim target DNS pinning after handoff.

All requests, responses, results, URLs, schemas, JSON, Markdown, retries, rate delays, polling, concurrency, and wall time have default and hard bounds. `npm test` uses local fakes only (fake fetch, fake Playwright, fake Obscura CLI). Live smoke tests are opt-in: `PRISM_LIVE_WEB=1`, `PRISM_LIVE_PLAYWRIGHT=1`, or `PRISM_LIVE_OBSCURA=1` via `npm run test:live -w @arnilo/prism-web-tools` plus the least-privilege credential or binary.

See [Web search, fetch, and extraction](../../docs/web-tools.md), [Browser automation](../../docs/browser-automation.md), and [Obscura](../../docs/obscura.md).