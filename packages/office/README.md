# @arnilo/prism-office

Prism office capabilities as one family package with explicit subpaths. Import only what
you use; no subpath activates a browser or loads another subpath's parser peers.

| Subpath | Contents |
| --- | --- |
| `@arnilo/prism-office/documents` | Prism Document Model (kinds `doc`/`sheet`/`deck`), `generateDocument` (docx/xlsx/pptx), `parseDocument` + `patchDocument` round-trip, `renderPreviewBlocks`/`renderPreviewHtml`, patch history, fail-closed `ERR_PRISM_DOCUMENTS_*` namespace. |
| `@arnilo/prism-office/sheets` | CSV/XLSX ingest with dialect sniffing, exact-decimal safety, bounded schema inference. |
| `@arnilo/prism-office/diagrams` | draw.io embed model: canonical XML, origin validation, bounded postMessage protocol. |

## Install

```bash
npm i @arnilo/prism-office@^0.3.0
```

```ts
import { generateDocument } from "@arnilo/prism-office/documents";
import { parseCsv } from "@arnilo/prism-office/sheets";
```

## Dependencies and trust boundaries

- The `@office-open/{docx,xlsx,pptx,xml}` internals are exact-pinned regular dependencies
  of this manifest; bytes/JSON in and out, no filesystem, no network, no `process.env`.
- `/diagrams` requires the optional `playwright-core` peer (and a host-provided browser)
  only when you use the live embed bridge; the XML/canonicalization API is peer-free.
- The document parser peers (`mammoth`, `pdf-parse`) belong to
  `@arnilo/prism-coding-tools/document-reader`, not to this package.
- Caps are enforced before any bytes are produced: oversize models fail closed with
  `ERR_PRISM_DOCUMENTS_CAP` / sheets caps / diagrams caps, never with partial output.

## History

Plans 051–053 drafted three separate packages; the maintainer amendment (plan 054 Task 8)
ships them as one family. See `docs/migrate-to-0.4.md` for the full 0.4 package map.