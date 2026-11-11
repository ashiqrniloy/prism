# Optional peer dependencies

## What it does

Lists every third-party peer a Prism package declares, what importing that peer unlocks, and the exact install line for it. Prism keeps optional integrations behind peer dependencies so a host installs a browser, a database driver, or a vendor SDK only when it actually uses that surface — and so the host, not Prism, owns the version, the binary, and the supply chain.

## When to use it

- Before installing a subpath: check whether it needs an extra package.
- Reviewing supply chain: which peers open a network connection, and which are pinned.
- Debugging a "peer not installed" error from a gated subpath.
- Auditing which of your already-installed packages a Prism surface will reuse.

Internal `@arnilo/*` peers are not listed here: every bundle declares a required `@arnilo/prism` peer over its supported API window. Other internal dependencies follow the bundle version policy. The matrix below lists third-party peers, including the optional peers owned by the extensions bundle.

## Matrix

One row per declaration. `Unlocks` names the subpath whose import reaches the peer; `Install` is the exact command for a host that has already installed the Prism package.

| Peer | Declared range | Optional | Declared by | Unlocks | Install | Network |
| --- | --- | --- | --- | --- | --- | --- |
| `@napi-rs/keyring` | `^2.0.0` | yes | `@arnilo/prism-extensions` | `./keyring` OS backend | `bun add @napi-rs/keyring` | no |
| `@modelcontextprotocol/client` | `^2.3.0` | yes | `@arnilo/prism-extensions` | `./mcp` | `bun add @modelcontextprotocol/client zod` | no |
| `zod` | `^4.6.6` | yes | `@arnilo/prism-extensions` | `./mcp` validation | `bun add zod` | no |
| `@opentelemetry/api` | `^1.9.0` | yes | `@arnilo/prism-extensions` | `./observability` | `bun add @opentelemetry/api` | no |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-extensions` | `./store-postgres` | `bun add pg` | yes |
| `@agentclientprotocol/sdk` | `1.4.0` | yes | `@arnilo/prism-hosts` | `./acp` | `bun add @agentclientprotocol/sdk@1.4.0` | no |
| `@ag-ui/core` | `1.0.4` | yes | `@arnilo/prism-hosts` | `./ag-ui`, `./ag-ui/renderer` | `bun add @ag-ui/core@1.0.4` | no |
| `@modelcontextprotocol/server` | `^2.3.0` | yes | `@arnilo/prism-hosts` | `./mcp-server`, `./host-builder` MCP command | `bun add @modelcontextprotocol/server zod` | no |
| `zod` | `^4.6.6` | yes | `@arnilo/prism-hosts` | `./ag-ui`, `./mcp-server`, `./host-builder` validation | `bun add zod` | no |
| `@office-open/docx` | `0.14.5` | yes | `@arnilo/prism-tools` | `./work`, `./work/documents` | `bun add @office-open/docx@0.14.5` | no |
| `@office-open/pptx` | `0.14.5` | yes | `@arnilo/prism-tools` | `./work`, `./work/documents` | `bun add @office-open/pptx@0.14.5` | no |
| `@office-open/xlsx` | `0.14.5` | yes | `@arnilo/prism-tools` | `./work`, `./work/sheets` | `bun add @office-open/xlsx@0.14.5` | no |
| `@office-open/xml` | `0.14.5` | yes | `@arnilo/prism-tools` | `./work`, `./work/diagrams` | `bun add @office-open/xml@0.14.5` | no |
| `ajv` | `^8.17.1` | yes | `@arnilo/prism-tools` | `./work`, `./work/documents` validation | `bun add ajv` | no |
| `fast-xml-parser` | `5.11.1` | yes | `@arnilo/prism-tools` | `./work`, `./work/diagrams` | `bun add fast-xml-parser@5.11.1` | no |
| `@firecrawl/anydoc` | `0.2.4` | yes | `@arnilo/prism-tools` | `./work/document-extraction` | `bun add @firecrawl/anydoc@0.2.4` | no |
| `mammoth` | `^1.8.0` | yes | `@arnilo/prism-tools` | `./work/document-reader` | `bun add mammoth` | no |
| `pdf-parse` | `^2.4.5` | yes | `@arnilo/prism-tools` | `./work/document-reader` | `bun add pdf-parse` | no |
| `e2b` | `2.49.1` | yes | `@arnilo/prism-tools` | `./coding` | `bun add e2b@2.49.1` | yes |
| `playwright-core` | `1.63.0` | yes | `@arnilo/prism-tools` | `./browser`, `./web` | `bun add playwright-core@1.63.0` | yes |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-memory-system` | `.`, `./core/postgres` | `bun add pg` | yes |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-knowledge` | `./rag` | `bun add pg` | yes |

## Exact pins and why

Exact pins preserve the integration versions verified for this release:

- **`playwright-core@1.63.0`** (`@arnilo/prism-tools/browser`, `@arnilo/prism-tools/web`). Browser automation rides Playwright's CDP transport and accessibility snapshot shapes, which move between minors. Prism never launches, downloads, or bundles a browser: the host supplies the binary, the image, and the cache, and must match the pinned client. See [Browser automation](../packages/tools/browser/README.md).
- **`e2b@2.49.1`** (`@arnilo/prism-tools/coding`). Pause `keepMemory`, `Sandbox.connect` auto-resume, and `ServiceBusyError` 503 semantics are version-specific. Hosts may inject `{ client }` instead of installing the peer. See [Hosted sandboxes](../packages/tools/coding/README.md).
- **`@firecrawl/anydoc@0.2.4`** (`@arnilo/prism-tools/work/document-extraction`). Error codes and the wrapper's optional third argument were checked against this release. The wrapper can upload a PDF when `ocr` is `'hosted'`; the Prism subpath never passes that argument and does not read an API key.
- **Office peers and XML parser** stay on the versions measured and tested for the bundle: `@office-open/{docx,pptx,xlsx,xml}@0.14.5` and `fast-xml-parser@5.11.1`. See the [tools dependency table](../packages/tools/README.md#dependencies-and-footprint).
- **Protocol peers** `@agentclientprotocol/sdk@1.4.0` and `@ag-ui/core@1.0.4` match the host protocol implementations checked for this release. AG-UI handler validation also needs `zod@^4.6.6`. See the [hosts dependency table](../packages/hosts/README.md).

## Peers that touch the network

`pg`, `playwright-core`, and `e2b` open sockets. For a supply-chain review of those three:

- **Connection targets are host-owned.** Every one of them is passed a host-supplied connection string, endpoint list, browser instance, API key, or service URL. Prism holds no default endpoint, and no peer is reachable from the root import.
- **Bytes stay local otherwise.** `mammoth`, `pdf-parse`, and `@firecrawl/anydoc` (as called by Prism) are filesystem/process peers; Office peers, schema validators and `@opentelemetry/api` do not open connections themselves. Protocol SDK imports also do not connect: MCP transports and the HTTP/stdio servers connect only when explicitly configured by the host. SQLite is the runtime's `bun:sqlite`, not a peer. The anydoc package also ships a hosted-OCR option; `@arnilo/prism-tools/work/document-extraction` does not call it.
- **No secrets are read by the peers.** Prism resolves credentials through host providers and redacts them at the boundary; peers only ever receive a resolved connection string or model object. See [Credentials and redaction](credentials-and-redaction.md) and [Host security guide](host-security.md).
- **Nothing is installed implicitly.** Optional peers are never auto-installed by npm; missing peers fail closed through a package status note, an import error, or a typed call error, as described below.

Test-only uses do not add another peer declaration: the tools bundle declares `playwright-core` once for browser and web. The work diagrams embed takes a host-supplied iframe; its gated live draw.io test reuses the same development dependency.

## Implementation example

```bash
# Browser automation: pinned client, host-owned browser binary
bun add @arnilo/prism-tools playwright-core@1.63.0

# PostgreSQL session store: pool driver only
bun add @arnilo/prism-memory-system@experimental pg

# Document reader: pick the parser you need (both are independent)
bun add @arnilo/prism-tools pdf-parse mammoth
```

```ts
import { chromium } from "playwright-core"; // host supplies the binary/image
import { createBrowserTools } from "@arnilo/prism-tools/browser";

const browser = await chromium.launch({ headless: true }); // host-owned, never Prism's
const tools = await createBrowserTools({ browser });
```

## Extension and configuration notes

- A peer is an *implementation the host owns*. When a peer's default wiring is not what you want, pass your own implementation instead of installing theirs: the document reader accepts host parsers (`createReadTool({ documentReader })`), and the browser surfaces accept a host `Browser`.
- Subpaths that need a peer isolate that import, so importing another subpath of the same package never evaluates it. Work Office libraries require the optional Office, Ajv and XML peers described below. `@arnilo/prism-hosts/channels` also has no third-party peers: Telegram uses native `fetch`, and signal-cli is a host-operated binary rather than an npm peer.
- Adding a peer to a Prism package is a release-gated change: the declaration must be optional unless a hard dependency's own peer forces it, and exact pins must come with a version-gate or compatibility rationale.

## Security and performance notes

- Pinned peers must be updated through the release process, not by a host override: an unpinned browser client or AI SDK type surface is a silent behavior change.
- Peer installs are host-visible supply-chain additions. Prefer one peer per capability, keep them out of the root import, and audit transitive dependencies of the network-touching peers and configured protocol transports in your own policy.
- An uninstalled peer is never loaded; package setup reports its absence or the owning entrypoint fails closed.

## Related APIs

- [Release and install](release.md): install profiles that pair with each peer.
- Package-level detail: [Coding tools](../packages/tools/coding/README.md), [Core runtime](agent.md), [Session stores](../packages/extensions/store-jsonl/README.md), [Browser automation](../packages/tools/browser/README.md), [Document reader](../packages/tools/work/README.md), [Document extraction](../packages/tools/work/README.md), [Provider packages](models.md), [Messaging channels](../packages/hosts/channels/README.md).

## Extensions bundle peers

The matrix above records the extension peers once under their bundle name.

Missing peers produce package status notes. Keyring retains its fail-closed resolver and can use the encrypted-file backend without the native peer. MCP registers no tools or commands, Postgres registers no store, and observability registers no hooks without their peers. A supplied Postgres pool does not require `pg`.

## Tools bundle Office peers

`@arnilo/prism-tools` keeps `diff`, `@mozilla/readability`, `linkedom` and `turndown` required. It requires `@arnilo/prism-extensions` for coding workflows. Its Office peers are optional:

The matrix above lists each Office peer, its pin and the exported library entries it enables.

Missing Office peers write a work status note and disable Office tool registration; validation never falls back to unchecked models. PDF/DOCX optional parsers, connector credentials and sandbox requirements retain their existing behavior. See the [bundle footprint](../packages/tools/README.md#dependencies-and-footprint).

The `@arnilo/prism-hosts` protocol SDKs are optional peers: `@agentclientprotocol/sdk` for ACP, `@ag-ui/core` plus `zod` for AG-UI serving, and `@modelcontextprotocol/server` plus `zod` for MCP serving and host-builder MCP. The AG-UI renderer needs only `@ag-ui/core`. Install the peers for the subpath you use; protocol entrypoints fail at import when a peer is missing. The headless, devtools and host-builder installer entries work without them. See the [hosts dependency table](../packages/hosts/README.md).
