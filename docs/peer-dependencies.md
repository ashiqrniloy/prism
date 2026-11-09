# Optional peer dependencies

## What it does

Lists every third-party peer a Prism package declares, what importing that peer unlocks, and the exact install line for it. Prism keeps optional integrations behind peer dependencies so a host installs a browser, a database driver, or a vendor SDK only when it actually uses that surface — and so the host, not Prism, owns the version, the binary, and the supply chain.

## When to use it

- Before installing a subpath: check whether it needs an extra package.
- Reviewing supply chain: which peers open a network connection, and which are pinned.
- Debugging a "peer not installed" error from a gated subpath.
- Auditing which of your already-installed packages a Prism surface will reuse.

Internal `@arnilo/*` peers are not listed here: every first-party package declares a required `@arnilo/prism` peer, and the release gate keeps all internal ranges locked to the cut version. This page covers the **12 third-party declarations across 10 packages**.

## Matrix

One row per declaration. `Unlocks` names the subpath whose import reaches the peer; `Install` is the exact command for a host that has already installed the Prism package.

| Peer | Declared range | Optional | Declared by | Unlocks | Install | Network |
| --- | --- | --- | --- | --- | --- | --- |
| `@firecrawl/anydoc` | `0.2.4` | yes | `@arnilo/prism-tools-work` | `./document-extraction` | `bun add @firecrawl/anydoc@0.2.4` | no |
| `mammoth` | `^1.8.0` | yes | `@arnilo/prism-tools-work` | `./document-reader` | `bun add mammoth` | no |
| `pdf-parse` | `^2.4.5` | yes | `@arnilo/prism-tools-work` | `./document-reader` | `bun add pdf-parse` | no |
| `e2b` | `2.49.1` | yes | `@arnilo/prism-tools-coding` | `.` | `bun add e2b@2.49.1` | yes |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-memory-core` | `./postgres` | `bun add pg` | yes |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-memory-system` | `.` | `bun add pg` | yes |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-rag` | `.` | `bun add pg` | yes |
| `playwright-core` | `1.63.0` | yes | `@arnilo/prism-tools-browser` | `.` | `bun add playwright-core@1.63.0` | yes |
| `playwright-core` | `1.63.0` | yes | `@arnilo/prism-tools-web` | `.` | `bun add playwright-core@1.63.0` | yes |
| `@opentelemetry/api` | `^1.9.0` | yes | `@arnilo/prism-observability` | `.` | `bun add @opentelemetry/api` | no |

## Exact pins and why

Three peers are pinned to an exact version instead of a range, because the pin is a contract rather than a convenience:

- **`playwright-core@1.63.0`** (`@arnilo/prism-tools-browser`, `@arnilo/prism-tools-web`). Browser automation rides Playwright's CDP transport and accessibility snapshot shapes, which move between minors. Prism never launches, downloads, or bundles a browser: the host supplies the binary, the image, and the cache, and must match the pinned client. See [Browser automation](../packages/tools/browser/README.md).
- **`e2b@2.49.1`** (`@arnilo/prism-tools-coding`). Pause `keepMemory`, `Sandbox.connect` auto-resume, and `ServiceBusyError` 503 semantics are version-specific. Hosts may inject `{ client }` instead of installing the peer. See [Hosted sandboxes](../packages/tools/coding/README.md).
- **`@firecrawl/anydoc@0.2.4`** (`@arnilo/prism-tools-work/document-extraction`). Error codes and the wrapper's optional third argument were checked against this release. The wrapper can upload a PDF when `ocr` is `'hosted'`; the Prism subpath never passes that argument and does not read an API key.


## Peers that touch the network

`pg`, `playwright-core`, and `e2b` open sockets. For a supply-chain review of those three:

- **Connection targets are host-owned.** Every one of them is passed a host-supplied connection string, endpoint list, browser instance, API key, or service URL. Prism holds no default endpoint, and no peer is reachable from the root import.
- **Bytes stay local otherwise.** `mammoth`, `pdf-parse`, and `@firecrawl/anydoc` (as called by Prism) are filesystem/process peers; the remaining one (`@opentelemetry/api`) is pure types/schemas. SQLite is the runtime's `bun:sqlite`, not a peer. The anydoc package also ships a hosted-OCR option; `@arnilo/prism-tools-work/document-extraction` does not call it.
- **No secrets are read by the peers.** Prism resolves credentials through host providers and redacts them at the boundary; peers only ever receive a resolved connection string or model object. See [Credentials and redaction](credentials-and-redaction.md) and [Host security guide](host-security.md).
- **Nothing is installed implicitly.** Optional peers are never auto-installed by npm; a missing one fails closed at the call site with a typed error naming the peer and the subpath.

Test-only dependencies are *not* peers. `playwright-core` appears in `@arnilo/prism-tools-work` as a devDependency only, because the office diagrams embed takes a host-supplied iframe and the sole consumer is the gated live draw.io conformance test.

## Implementation example

```bash
# Browser automation: pinned client, host-owned browser binary
bun add @arnilo/prism-tools-browser playwright-core@1.63.0

# PostgreSQL session store: pool driver only
bun add @arnilo/prism-memory-core@experimental pg

# Document reader: pick the parser you need (both are independent)
bun add @arnilo/prism-tools-work pdf-parse mammoth
```

```ts
import { chromium } from "playwright-core"; // host supplies the binary/image
import { createBrowserTools } from "@arnilo/prism-tools-browser";

const browser = await chromium.launch({ headless: true }); // host-owned, never Prism's
const tools = await createBrowserTools({ browser });
```

## Extension and configuration notes

- A peer is an *implementation the host owns*. When a peer's default wiring is not what you want, pass your own implementation instead of installing theirs: the document reader accepts host parsers (`createReadTool({ documentReader })`), and the browser surfaces accept a host `Browser`.
- Subpaths that need a peer isolate that import, so importing another subpath of the same package never evaluates it. The office family is the extreme case: zero peers, because it takes structural inputs. `@arnilo/prism-channels` also has no third-party peers: Telegram uses native `fetch`, and signal-cli is a host-operated binary rather than an npm peer.
- Adding a peer to a Prism package is a release-gated change: the declaration must be optional unless a hard dependency's own peer forces it, and exact pins must come with a version-gate or compatibility rationale.

## Security and performance notes

- Pinned peers must be updated through the release process, not by a host override: an unpinned browser client or AI SDK type surface is a silent behavior change.
- Peer installs are host-visible supply-chain additions. Prefer one peer per capability, keep them out of the root import, and audit transitive dependencies of the five network-touching peers in your own policy.
- Prism adds no runtime cost for an uninstalled peer; the failure is a typed error at first use.

## Related APIs

- [Release and install](release.md): install profiles that pair with each peer.
- Package-level detail: [Coding tools](../packages/tools/coding/README.md), [Core runtime](agent.md), [Session stores](../packages/stores/jsonl/README.md), [Browser automation](../packages/tools/browser/README.md), [Document reader](../packages/tools/work/README.md), [Document extraction](../packages/tools/work/README.md), [Provider packages](models.md), [Messaging channels](../packages/hosts/channels/README.md).
