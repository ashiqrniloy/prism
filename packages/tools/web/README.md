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
| `limits` | `object` | tool defaults | Byte, retry, concurrency, and timeout bounds for the HTTP adapters. Hosts may only narrow or raise within the hard caps. |

An unknown key fails `createAgent` with the kernel's config error naming the key. A missing key ref
or a missing Obscura binary registers nothing and writes a `warn` status note; it never throws.

## What it changes

Registers tools with a declared `effects` annotation:

| tool | effects | backend | notes |
| --- | --- | --- | --- |
| `web_search` | `["network"]` | `brave`, `exa`, `obscura` | bounded public-web search; results carry the untrusted citation shape |
| `web_fetch` | `["network"]` | any fetch-capable backend | bounded Markdown fetch; content is untrusted external data |
| `obscura_fetch`, `obscura_scrape` | `["network"]` | `obscura` (`nativeTools`) | native Obscura one-shot fetch and batch scrape |
| `web_extract` | `["network"]` | — | registered only by the named `createWebTools` factory with a host schema and validator |

When a Firecrawl fetch backend is configured, the package also provides the `web.fetch` service:

```ts
interface WebFetchService {
  fetch(url: string, options?: { signal?: AbortSignal; maxBytes?: number }): Promise<WebDocument>;
}
```

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
