# @arnilo/prism-tools-work

First-party work tools for Prism: Office documents, spreadsheets, diagrams, M365/Google connectors, and a bounded document reader, as one package with a `definePackage` entry and the 0.12 family subpaths kept for direct imports.

```ts
import toolsWork from "@arnilo/prism-tools-work";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [toolsWork({ root: process.cwd() })],
});
```

## What it registers

| Group | Tools | Effects | Enabled by |
| --- | --- | --- | --- |
| Office documents | `office_parse`, `office_import`, `office_diff`, `office_preview` | `read` | `office.enabled` (default `true`) |
| Office documents | `office_generate`, `office_patch` | `write` | `office.enabled` (default `true`) |
| Sandbox exec | `work_exec` | `execute` | `work.enabled` (default `true`) plus a host `work.sandbox` service |
| Connectors | `m365_*` / `gws_*` | `network` (reads) or `network` + `external` (drafts/writes) | a resolvable `connectors.*.credential` ref |

`office_parse` / `office_import` return results tagged `trust: "untrusted_external"`, which the kernel
wraps in its envelope (`docs/tools.md`). `work_exec` runs an argv command inside the host-injected `WorkSandbox`; without that service the package notes why and registers the rest.

The bounded document reader is **not** a tool: it is provided as the `work.reader` service so `@arnilo/prism-tools-coding`'s `read` tool can consume it.

The vendored Hermes MIT skills (`docx`, `xlsx`, `powerpoint`, `pdf`) are added from `vendor/hermes-agent/skills/productivity` through `prism.skills.addDir`.

## Config

| Field | Default | Notes |
| --- | --- | --- |
| `root` | — | **Required.** Absolute workspace root the file-touching tools stay inside. |
| `office.enabled` | `true` | `false` registers no `office_*` tool. |
| `office.maxBytes` | document cap default | OOXML byte cap. |
| `work.enabled` | `true` | `false` drops `work_exec`. |
| `reader.formats` | all four | `["pdf", "docx", "xlsx", "pptx"]` subset. A format whose optional peer is missing is dropped with one warn note. |
| `reader.maxBytes` / `maxPages` / `maxTextBytes` | reader defaults | Hard caps. |
| `reader.ocr` | off | `{ provider: "mistral", apiKey: "env:MISTRAL_API_KEY" }`; **one external call per page**. |
| `connectors.microsoft365` | none | `{ credential: "keyring:m365", binary?, configDir, identity, allowedOps? }`. |
| `connectors.google` | none | `{ credential: "keyring:gws", binary?, configDir, identity, allowedOps? }`. |
| `env` | `{}` | Non-token env for the sandbox. `M365_*` / `GOOGLE_*` names are refused. |

`connectors.*.credential` and `reader.ocr.apiKey` are ref-only (`env:NAME` or `keyring:NAME`) and resolved through `prism.credentials.resolve`; a literal fails config validation and a resolved value is redacted from events, notes, logs, errors, and tool results. A credential that resolves to a JSON object is injected as the connector's token env map; any other value becomes the provider's default access-token variable.

## Optional peers

| Peer | Unlocks | Missing |
| --- | --- | --- |
| `mammoth` | `docx` reader format | that format is dropped with a note |
| `pdf-parse` | `pdf` reader format | that format is dropped with a note |
| `@firecrawl/anydoc` | `/document-extraction` local Markdown conversion | `createDocumentExtractor()` throws at call time |

## Direct subpath imports

The family shares type names (`validateByteCap`, `CellValue`) across libraries, so a single flat barrel cannot re-export them unambiguously. The root entry holds the `definePackage` surface; the libraries stay importable as subpaths:

`@arnilo/prism-tools-work/{connectors,connectors/drafts,connectors/google-workspace,connectors/microsoft365,documents,sheets,diagrams,document-extraction,document-reader,sandbox,skills,tools}`

## Install

```bash
bun add @arnilo/prism @arnilo/prism-tools-work
```

## Security and cost

- File tools stay inside `root`; paths are resolved and contained before any read or write.
- Connector credentials and the OCR key are ref-only and redacted everywhere after resolution.
- The worker pool starts lazily and is closed in `onDispose`.
- OCR is off by default and costs one external Mistral call per page when enabled.
