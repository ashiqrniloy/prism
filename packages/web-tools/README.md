# @arnilo/prism-web-tools

Optional zero-SDK web research package. Hosts select one Brave or Exa search adapter and optional Firecrawl Markdown/extraction adapters; models never select provider, API origin, credential, or extraction schema.

```ts
import { createBraveSearch, createFirecrawlExtractor, createFirecrawlFetch, createWebTools } from "@arnilo/prism-web-tools";

const tools = createWebTools({
  search: createBraveSearch({ credentials }),
  fetch: createFirecrawlFetch({ credentials, validateUrl: publicDnsPolicy }),
  extract: createFirecrawlExtractor({ credentials, schema, validator, validateUrl: publicDnsPolicy }),
});
```

Exports: root package plus dependency-free adapter subpaths `./brave`, `./exa`, and `./firecrawl`. Native `fetch` is used with exact fixed provider origins and redirects disabled. Credentials resolve immediately before each request and never enter tool arguments/results/errors.

Results carry stable citation IDs and `untrusted: true`; tool results add `trust: "untrusted_external"`. External content never changes instructions, tools, permissions, credentials, or routing. Firecrawl URL handoff applies Prism SSRF syntax/private-literal policy and optional host DNS/egress validation; Firecrawl performs target retrieval, so Prism does not claim target DNS pinning after handoff.

All requests, responses, results, URLs, schemas, JSON, Markdown, retries, rate delays, polling, concurrency, and wall time have default and hard bounds. `npm test` uses local fake fetch only. Live smoke tests require `PRISM_LIVE_WEB=1` plus provider-specific `PRISM_BRAVE_SEARCH_TOKEN`, `PRISM_EXA_API_KEY`, or `PRISM_FIRECRAWL_API_KEY`.

See [Web search, fetch, and extraction](../../docs/web-tools.md).
