# Web search, fetch, and extraction

## What it does

`@arnilo/prism-web-tools` provides three separate bounded `ToolDefinition`s: host-selected Brave or Exa `web_search`, Firecrawl Markdown `web_fetch`, and Firecrawl JSON `web_extract`. Package uses native `fetch`; no vendor SDK or browser is installed.

## When to use it

Use when agent needs explicit public-web discovery or host-approved document retrieval/extraction. Keep search separate from fetch/extract so model cannot select provider, credential, API origin, extraction schema, or cost path.

## Inputs / request

| Tool | Model-visible input | Host-only construction input |
| --- | --- | --- |
| `web_search` | `query`, optional `count` | exactly one `createBraveSearch()` or `createExaSearch()`, credential source, limits |
| `web_fetch` | one absolute public `url` | `createFirecrawlFetch()`, credential source, SSRF/DNS policy, limits |
| `web_extract` | bounded `urls` array | `createFirecrawlExtractor()`, fixed JSON Schema, validator, credential source, SSRF/DNS policy, limits |

Credentials may be explicit callbacks or core `CredentialResolver`s. They resolve at request edge as Brave `subscription_token`, Exa `api_key`, or Firecrawl `api_key`. `allowedOrigins` must contain fixed provider API origin; adapters reject redirects. Firecrawl target URLs reject userinfo, non-HTTP(S), private literals, and hostnames denied by `SsrfPolicy`; supply `validateUrl` for host DNS/rebinding/egress checks before handing URL to Firecrawl.

## Outputs / response / events

Search results retain bounded `title`, canonical fragment-free `url`, `snippet`, highlights, provider result ID, publication/retrieval time, returned request/cost/rate facts, and stable citation identity. Citation is `web:<provider>:<sourceId>` when provider supplies ID, otherwise SHA-256 of canonical URL.

Fetch returns bounded Markdown and selected attribution. Extract validates host schema before I/O and validates returned JSON through host `ToolArgumentValidator`. Every result has `untrusted: true`; tool result metadata is `trust: "untrusted_external"`. Missing provider facts remain absent—Prism never guesses billing or freshness.

## Request/response example

```json
{
  "tool": "web_search",
  "arguments": { "query": "Prism TypeScript SDK", "count": 5 },
  "result": {
    "provider": "brave",
    "untrusted": true,
    "results": [{ "citationId": "web:brave:…", "url": "https://example.com/", "title": "Example" }]
  }
}
```

## Implementation example

```ts
import { createEnvCredentialResolver } from "@arnilo/prism";
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";
import { createBraveSearch, createFirecrawlExtractor, createFirecrawlFetch, createWebTools } from "@arnilo/prism-web-tools";

const credentials = createEnvCredentialResolver(process.env, {
  "brave:subscription_token": "BRAVE_SEARCH_TOKEN",
  "firecrawl:api_key": "FIRECRAWL_API_KEY",
});
const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
const tools = createWebTools({
  search: createBraveSearch({ credentials }),
  fetch: createFirecrawlFetch({ credentials, validateUrl: publicDnsPolicy }),
  extract: createFirecrawlExtractor({ credentials, schema, validator: createJsonSchemaArgumentValidator(), validateUrl: publicDnsPolicy }),
});
```

## Extension and configuration notes

Hosts substitute `createExaSearch()` for Brave; no runtime/model routing exists. Root export includes all adapters; `./brave`, `./exa`, and `./firecrawl` subpaths support atomic imports. Official vendor MCP servers are prototypes only: use hardened MCP origin/auth/capability policy, never generic remote passthrough.

Default/hard limits: query 4/16 KiB; results 10/20; URLs 5/20; request 256 KiB/1 MiB; response and aggregate 2/16 MiB; Markdown 1/8 MiB; extraction 256 KiB/1 MiB; schema 64/256 KiB; JSON depth 64/128 and properties 10k/100k; retries 2/4; rate delay 5/60 seconds; concurrency 4/16 active plus the same bounded waiting queue; polling 20/100; wall time 60 seconds/30 minutes. Hosts may only narrow or raise within hard caps.

## Security and performance notes

Provider credentials never enter tool schemas/results, prompts, telemetry, URLs, or errors. Error text excludes remote bodies. Search snippets, Markdown, and extracted JSON are prompt-injection-capable data: never concatenate them into system instructions or use them to modify tools, permissions, credentials, trust, routing, or schemas. Firecrawl fetches target URLs remotely; Prism cannot claim target DNS pinning after handoff. Use controlled host fetch when that guarantee is required.

Default tests use injected fake fetch and make no public request. Restricted smoke: `PRISM_LIVE_WEB=1 npm run test:live -w @arnilo/prism-web-tools` plus least-privilege provider environment credential. Browser automation, arbitrary HTML execution, model-selected providers, automatic OAuth forwarding, and generic web/MCP passthrough are unsupported.

## Related APIs

- [Tools](tools.md): registry, validation, permission, trust, guardrails, and ledger dispatch.
- [Credential storage](credential-storage.md): explicit resolver composition and environment mapping.
- [Host security](host-security.md): SSRF, untrusted-content, and secret boundaries.
- [MCP tools](mcp-tools.md): hardened prototype path for official vendor MCP servers.
- [Performance and resource limits](performance.md): operational ceilings and benchmark evidence.
