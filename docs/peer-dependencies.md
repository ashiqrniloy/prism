# Optional peer dependencies

## What it does

Lists every third-party peer a Prism package declares, what importing that peer unlocks, and the exact install line for it. Prism keeps optional integrations behind peer dependencies so a host installs a browser, a database driver, or a vendor SDK only when it actually uses that surface — and so the host, not Prism, owns the version, the binary, and the supply chain.

## When to use it

- Before installing a subpath: check whether it needs an extra package.
- Reviewing supply chain: which peers open a network connection, and which are pinned.
- Debugging a "peer not installed" error from a gated subpath.
- Auditing which of your already-installed packages a Prism surface will reuse.

Internal `@arnilo/*` peers are not listed here: every first-party package declares a required `@arnilo/prism` peer, and the release gate keeps all internal ranges locked to the cut version. This page covers the **11 third-party declarations across 6 packages**.

## Matrix

One row per declaration. `Unlocks` names the subpath whose import reaches the peer; `Install` is the exact command for a host that has already installed the Prism package.

| Peer | Declared range | Optional | Declared by | Unlocks | Install | Network |
| --- | --- | --- | --- | --- | --- | --- |
| `zod` | `^3.25.0 \|\| ^4.0.0` | no | `@arnilo/prism-ag-ui` | `./acp` | `npm i zod` | no |
| `@nanonets/graft` | `^0.16.0 \|\| ^0.18.0` | yes | `@arnilo/prism-memory` | `./graft` | `npm i @nanonets/graft` | no |
| `@dietrichgebert/ponytail` | `^4.9.0` | yes | `@arnilo/prism-coding-tools` | `./ponytail` | `npm i @dietrichgebert/ponytail` | no |
| `mammoth` | `^1.8.0` | yes | `@arnilo/prism-coding-tools` | `./document-reader` | `npm i mammoth` | no |
| `pdf-parse` | `^2.4.5` | yes | `@arnilo/prism-coding-tools` | `./document-reader` | `npm i pdf-parse` | no |
| `better-sqlite3` | `^13.0.3` | yes | `@arnilo/prism-core` | `./sessions/sqlite`, `./governance/prompts` | `npm i better-sqlite3` | no |
| `pg` | `^8.23.0` | yes | `@arnilo/prism-core` | `./sessions/postgres`, `./enterprise/postgres`, `./governance/prompts` | `npm i pg` | yes |
| `@nats-io/jetstream` | `^3.4.0` | yes | `@arnilo/prism-core` | `./sessions/nats` | `npm i @nats-io/jetstream @nats-io/transport-node` | yes |
| `@nats-io/transport-node` | `^3.4.0` | yes | `@arnilo/prism-core` | `./sessions/nats` | `npm i @nats-io/transport-node` | yes |
| `@ai-sdk/provider` | `4.0.13` | yes | `@arnilo/prism-providers` | `./ai-sdk` | `npm i @ai-sdk/provider@4.0.13` | no |
| `playwright-core` | `1.63.0` | yes | `@arnilo/prism-web-tools` | `./browser`, `./obscura` | `npm i playwright-core@1.63.0` | yes |

## Exact pins and why

Two peers are pinned to an exact version instead of a range, because the pin is a contract rather than a convenience:

- **`playwright-core@1.63.0`** (`@arnilo/prism-web-tools/browser`, `/obscura`). Browser automation rides Playwright's CDP transport and accessibility snapshot shapes, which move between minors. Prism never launches, downloads, or bundles a browser: the host supplies the binary, the image, and the cache, and must match the pinned client. See [Browser automation](browser-automation.md).
- **`@ai-sdk/provider@4.0.13`** (`@arnilo/prism-providers/ai-sdk`). The adapter consumes deterministic specification-versioned types (`LanguageModelV4`) and gates on an exact supported-version matrix at construction, so an unlisted version fails closed instead of silently mis-mapping. See [AI SDK provider](providers/ai-sdk.md).

`zod` is the only **required** third-party peer. `@agentclientprotocol/sdk` — a hard dependency of `@arnilo/prism-ag-ui` — declares `zod: ^3.25.0 || ^4.0.0` as its own peer, so `@arnilo/prism-ag-ui` re-declares the same range to keep the install tree satisfiable; the range is deliberately identical to the SDK's. Nothing in Prism imports zod directly.

## Peers that touch the network

`pg`, `@nats-io/jetstream`, `@nats-io/transport-node`, and `playwright-core` open sockets. For a supply-chain review of those four:

- **Connection targets are host-owned.** Every one of them is passed a host-supplied connection string, endpoint list, browser instance, or service URL. Prism holds no default endpoint, and no peer is reachable from the root import.
- **Bytes stay local otherwise.** `better-sqlite3`, `mammoth`, `pdf-parse`, `@nanonets/graft`, and `@dietrichgebert/ponytail` are filesystem/process peers; the remaining two (`zod`, `@ai-sdk/provider`) are pure types/schemas.
- **No secrets are read by the peers.** Prism resolves credentials through host providers and redacts them at the boundary; peers only ever receive a resolved connection string or model object. See [Credentials and redaction](credentials-and-redaction.md) and [Host security guide](host-security.md).
- **Nothing is installed implicitly.** Optional peers are never auto-installed by npm; a missing one fails closed at the call site with a typed error naming the peer and the subpath. Required peers (today only `zod`) are installed by npm with the package.

Test-only dependencies are *not* peers. `playwright-core` appears in `@arnilo/prism-office` as a devDependency only, because the office diagrams embed takes a host-supplied iframe and the sole consumer is the gated live draw.io conformance test.

## Implementation example

```bash
# Browser automation: pinned client, host-owned browser binary
npm i @arnilo/prism-web-tools playwright-core@1.63.0

# PostgreSQL session store: pool driver only
npm i @arnilo/prism-core pg

# NATS JetStream event source: transport + jetstream together
npm i @arnilo/prism-core @nats-io/transport-node @nats-io/jetstream

# Document reader: pick the parser you need (both are independent)
npm i @arnilo/prism-coding-tools pdf-parse mammoth
```

```ts
import { chromium } from "playwright-core"; // host supplies the binary/image
import { createBrowserTools } from "@arnilo/prism-web-tools/browser";

const browser = await chromium.launch({ headless: true }); // host-owned, never Prism's
const tools = await createBrowserTools({ browser });
```

## Extension and configuration notes

- A peer is an *implementation the host owns*. When a peer's default wiring is not what you want, pass your own implementation instead of installing theirs: the document reader accepts host parsers (`createReadTool({ documentReader })`), the memory `/graft` resolver accepts an explicit package root, and the browser surfaces accept a host `Browser`.
- Subpaths that need a peer isolate that import, so importing another subpath of the same package never evaluates it. The office family is the extreme case: zero peers, because it takes structural inputs.
- Adding a peer to a Prism package is a release-gated change: the declaration must be optional unless a hard dependency's own peer forces it (the `zod` case), and exact pins must come with a version-gate or compatibility rationale.

## Security and performance notes

- Pinned peers must be updated through the release process, not by a host override: an unpinned browser client or AI SDK type surface is a silent behavior change.
- Peer installs are host-visible supply-chain additions. Prefer one peer per capability, keep them out of the root import, and audit transitive dependencies of the four network-touching peers in your own policy.
- Prism adds no runtime cost for an uninstalled peer; the failure is a typed error at first use.

## Related APIs

- [Release and install](release-and-install.md): install profiles that pair with each peer.
- [Configuration options index](options-index.md): the option surfaces each peer unlocks.
- Package-level detail: [Coding tools](coding-tools.md), [Core runtime](core.md), [Session stores](session-stores.md), [Browser automation](browser-automation.md), [Document reader](document-reader.md), [Graft](graft.md), [Ponytail](ponytail.md), [Provider packages](provider-packages.md).
