# Migrate Prism 0.11 to 0.12

> Archived host checklist for the 0.12.0 cut. Current install rules stay in [release and install](../release-and-install.md). Current extraction contract stays in [document extraction](../document-extraction.md).

0.12.0 moves all twelve publishable manifests together. The runtime is Bun `>=1.4.2`. Optional document extraction is not part of a default install.

## Runtime

Install with `bun add`, not `npm install`. Example: `bun add @arnilo/prism @arnilo/prism-core`.

Every publishable manifest declares `engines.bun >=1.4.2` and no longer declares `engines.node`. Bun 1.4.2 does not enforce `engines.bun`. A Node process still installs the tarball, then fails when it reaches SQLite:

- `@arnilo/prism-core/sessions/sqlite requires the Bun runtime (bun:sqlite).`
- `@arnilo/prism-core/governance/prompts requires the Bun runtime (bun:sqlite).`

A static `import "bun:sqlite"` on Node fails earlier with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. The published 0.11.x line remains the Node host path. Do not mix a 0.12.0 package into a Node process.

`prism init` and provider-add scaffolds write `packageManager` `bun@1.4.2` and Bun install commands. The dev hint is `bun add --dev @arnilo/prism-coding-tools`.

Release-host exception: `npm pack`, `npm publish`, and `npm sbom` stay on the release host. `bun pack` does not exist, and `bun publish` on 1.4.2 has no `--provenance`. Contributors do not run those commands.

## SQLite

The `better-sqlite3` optional peer is gone. There is no SQLite package to install. The driver is the runtime's `bun:sqlite`. Existing database files stay; FTS DDL is unchanged.

Measured on Bun 1.4.2, against the old driver:

| Row | `better-sqlite3` | `bun:sqlite` |
| --- | --- | --- |
| Blob read | `Buffer` | `Uint8Array`, not a `Buffer` |
| `lastInsertRowid` | number | number. `safeIntegers: true` makes it `bigint` |
| Integer above `2^53-1` | driver-defined | rounds (`9007199254740993n` stores as `9007199254740992`) unless `safeIntegers` |
| `undefined` bind | throws | stores NULL |
| `get()` miss | `undefined` | `null` |
| Constructor options | accepted | no options object. Set `PRAGMA` with `exec`, including `busy_timeout` |

Hosts that passed a constructor options object, or that treated a missing row as `undefined`, must update those call sites. Hosts that only used the Prism session store do not.

## Optional document extraction

Default hosts skip this. Nothing in the default import path installs Python, downloads a model, or calls OCR.

Hosts that want local Markdown conversion:

```bash
bun add @arnilo/prism-work @firecrawl/anydoc@0.2.4
```

`@firecrawl/anydoc` is an optional native peer. Conversion stays on the host. The subpath never passes hosted OCR options and never reads an API key. A missing peer fails closed. Unrelated work and memory imports do not need the peer.

Scanned PDFs and explicit image OCR need a host-provisioned Docling worker. Python and Docling are not npm dependencies. Pin `docling==2.130.0` and the CPU torch index. Prefetch models once (`docling-tools models download`, about 1.4 GiB and 150 s) and point the worker at that directory. The package ships `docling/ocr.py`. The host spawns it with a scrubbed env (`HF_HUB_OFFLINE=1`, telemetry off), one OCR job in flight, and no network egress. `WorkSandbox.execFile` cannot feed stdin, so it is not the runner.

OCR never uploads by default. A failed, partial, or over-page conversion returns no Markdown and must not be indexed. One scanned page was about 5 s cold and 2 s warm after prefetch, with about 2 GiB resident. Budget under 30 s and 4 GiB for inputs under 100 KiB. The default no-OCR path does not pay that cost.

## Rollback

Stay on 0.11.1 if the process must be Node, or if a host still depends on the `better-sqlite3` peer. 0.12.0 packages do not load under Node.
