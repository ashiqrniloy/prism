# Documents, spreadsheets, and presentations (`@arnilo/prism-work/documents`)

## What it does

The `@arnilo/prism-work/documents` package provides specification-compliant, AI-native OpenXML document generation, parsing, patching, and bounded preview rendering for Microsoft Word (`.docx`), Microsoft Excel (`.xlsx`), and Microsoft PowerPoint (`.pptx`) artifacts.

It operates on a canonical, typed abstract syntax tree (AST) called the **Prism Document Model** (`DocModel`, `SheetModel`, `DeckModel`):
- **Pure in-memory doctrine**: Functions accept `Uint8Array` container buffers or typed model objects and emit `Uint8Array` buffers or JSON models. Zero filesystem reads, zero network I/O, zero `process.env` lookups, and zero child process spawns.
- **Draft-07 JSON Schema validation & slicing**: Full runtime structural validation with transitive closure slicing (`getDocumentModelSchema`) allowing LLM tools and agent prompts to extract minimal, self-contained sub-schemas (e.g. `doc.paragraph`, `doc.table`).
- **Bidirectional round-trip fidelity**: Prism-generated documents parse back into structurally equivalent models verified against a per-kind equality specification. `importDocument` also reports ZIP parts the model drops (macros, comments, media, charts, OLE, pivots) instead of silently omitting them.
- **Typed model patch engine**: Immutably applies `set`, `insert`, `remove`, and `move` operations to document blocks, worksheet cells, and presentation slides with schema re-validation and an interactive `createPatchHistory` undo/redo stack.
- **Framework-neutral preview blocks & bounded HTML**: Generates structured snapshots (`PreviewBlock[]`) for native desktop/web UI grids and outline trees, as well as safe, sanitize-by-construction HTML fragments (`renderPreviewHtml`) guaranteed to contain no executable scripts, no active pseudo-protocols, and no external hyperlinks.
- **Boundary text redaction**: Pluggable `SecretRedactor` hook to sanitize extracted text content (paragraphs, cells, notes, tables) at the parse boundary before models are returned.
- **Dependency-free telemetry seam**: Zero-overhead `DocumentsTelemetry` hook for OpenTelemetry-compatible span tracing without leaking document or chunk text into telemetry collectors.

## When to use it

Use `@arnilo/prism-work/documents` whenever autonomous agents, coding assistants, workflow orchestrators, or enterprise applications need to:
1. Synthesize professional DOCX reports, financial XLSX spreadsheets, or PPTX presentation decks from structured LLM outputs.
2. Ingest existing OOXML artifacts into a structured, validated document model for analysis or automated summarization.
3. Perform atomic, validated updates or localized edits to documents using typed patch operations.
4. Render safe, bounded HTML previews or framework-neutral outline and grid snapshots in web and desktop hosts.

Do **not** use this package for collaborative real-time editing (OT/CRDT), macro execution, in-memory spreadsheet formula evaluation (formulas are preserved verbatim as `{ formula, cachedValue? }` read-only pairs), or OLE binaries (`.doc` / `.xls` / `.ppt`). Recalculation, slide PNG QA, and legacy convert run out of process in the [work sandbox](work-sandbox.md) (`xlsx_recalc.py`, `soffice --convert-to pdf|docx|xlsx|pptx`, `pdftoppm`).

## Inputs / request

### Generation & Parsing Functions

| Function | Signature | Description |
| --- | --- | --- |
| `generateDocument` | `(model: DocumentModel, options: GenerateDocumentOptions) => Promise<GenerateDocumentResult>` | Translates a typed model into spec-compliant OOXML binary bytes (PK zip container) with a SHA-256 content hash. |
| `parseDocument` | `(bytes: Uint8Array, options: ParseDocumentOptions) => Promise<DocumentModel>` | Verifies PK zip signature, enforces caps, translates OOXML parts, applies optional redaction, and returns a validated model. |
| `importDocument` | `(bytes: Uint8Array, options: ParseDocumentOptions) => Promise<ImportDocumentResult>` | Same parse plus a ZIP-name **fidelity** report of structures the Document Model drops (macros, comments, media, charts, OLE, pivots). `parseDocument` returns `.model` only. |
| `patchDocument` | `(model: DocumentModel, patches: readonly DocumentPatch[], options?: PatchDocumentOptions) => DocumentModel` | Clones the model, applies typed structural patch operations, and validates the resulting model against Draft-07 schemas. |
| `diffDocument` | `(from: DocumentModel, to: DocumentModel, options?: DiffDocumentOptions) => DocumentDiff` | Structural paragraph/table/cell/slide diff. Decimal cells compare as canonical strings. Caps report `truncated` instead of unbounded walk. |
| `createPatchHistory` | `(initialModel: DocumentModel) => PatchHistory` | Creates an interactive undo/redo history manager for host editing workflows. |
| `renderPreviewBlocks` | `(model: DocumentModel, options?: PreviewBlocksOptions) => PreviewBlock[]` | Emits framework-neutral structured blocks (document outlines, bounded sheet grid chunks, slide summaries). |
| `renderPreviewHtml` | `(model: DocumentModel, options?: PreviewHtmlOptions) => string` | Emits safe, bounded HTML fragments with all entities escaped and external URLs neutralized. |
| `documentModelSchema` | `(kind: DocumentKind, slice?: string \| readonly string[]) => JsonSchema` | Retrieves the Draft-07 JSON Schema for a document kind, or a self-contained sliced sub-schema with resolved `$defs` (`docModelSchema` / `sheetModelSchema` / `deckModelSchema` expose the unsliced schemas). |
| `validateDocumentModel`| `(model: unknown) => asserts model is DocumentModel` | Validates arbitrary JSON objects against Draft-07 document schemas and structural invariants. |

### Agent tool facade

`@arnilo/prism-work/tools` exports `createOfficeTools({ caps?, redactor?, filesystem?, artifacts? })`: six thin wrappers over this package — `office_parse`, `office_import`, `office_generate`, `office_patch`, `office_diff`, and `office_preview`.

- Parse/import accept a document `kind` plus exactly one bounded `bytesBase64` or sandbox-relative `path`; results are marked `untrusted_external`.
- Generate returns only `{ contentHash, byteLength, format }`; set `outputPath` for a contained sandbox write or `artifact: true` for the host-provided `ArtifactBodyStore`. Raw OOXML never enters tool content.
- Patch is pure unless it also writes generated bytes. Parse/import/diff/preview declare no effect; generate/patch declare an external mutation only when a sandbox/artifact target is requested.
- Filesystem paths must be relative to the configured root and pass the host/sandbox realpath containment hook when supplied. OOXML is still PK-gated, cap-limited, redacted at parse, and never executes macros.

```ts
import { createOfficeTools } from "@arnilo/prism-work/tools";

const tools = createOfficeTools({
  filesystem: { root: "/workspace", readFile, writeFile },
  artifacts: { bodies, createRef }, // host-owned ArtifactBodyStore and ownership-aware ref factory
});
```

### Capacity Limits and Defaults

Caps are strictly enforced in memory before compute-intensive translation or parsing:

| Cap | Default | Hard Ceiling | Target |
| --- | --- | --- | --- |
| `maxBytes` | 32 MiB (`33,554,432`) | 512 MiB (`536,870,912`) | Binary input buffer & generated OOXML bytes |
| `maxBlocks` | 10,000 | 50,000 | Total blocks in a `DocModel` |
| `maxSheets` | 50 | 250 | Worksheets in a `SheetModel` |
| `maxRows` | 100,000 | 1,000,000 | Rows per worksheet |
| `maxColumns` | 1,000 | 16,384 | Columns per worksheet |
| `maxCells` | 1,000,000 | 10,000,000 | Total cells across all worksheets |
| `maxSlides` | 500 | 2,000 | Total slides in a `DeckModel` |
| `maxParagraphs` | 10,000 | 50,000 | Total paragraphs in a document |
| `maxRuns` | 50,000 | 250,000 | Total formatted text runs in a document |

## Outputs / response / events

### Error Hierarchy

All package operations throw typed exceptions derived from `DocumentsError`:

| Error Class | Error Code | Trigger Condition |
| --- | --- | --- |
| `DocumentsValidationError` | `ERR_PRISM_DOCUMENTS_INVALID_MODEL` | Input JSON fails Draft-07 schema validation, has dimension mismatches, or invalid decimal string syntax. |
| `DocumentsCapExceededError` | `ERR_PRISM_DOCUMENTS_CAP_EXCEEDED` | Document exceeds byte size, block count, cell count, or slide count caps. |
| `DocumentsParseError` | `ERR_PRISM_DOCUMENTS_PARSE_FAILED` | Input buffer lacks PK zip signature, is corrupted, or fails OOXML part parsing. |
| `DocumentsFormatError` | `ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT` | Format mismatch (e.g. attempting to generate PPTX from a `DocModel`). |
| `DocumentsPatchError` | `ERR_PRISM_DOCUMENTS_UNSAFE_PATH` | `__proto__`, `prototype`, or `constructor` appears as a `metadata` target or inside a block/slide/sheet `patch` segment (rejected before mutation to prevent `Object.prototype` pollution). |
| `DocumentsPatchError` | `ERR_PRISM_DOCUMENTS_PATCH_FAILED` | Out-of-bounds index target, unknown patch operation, or invalid patch structure. |

## Request/response example

### JSON Schema Document Models

```json
{
  "kind": "sheet",
  "modelVersion": 1,
  "title": "Q3 Financial Summary",
  "sheets": [
    {
      "name": "Revenue",
      "columnWidths": [{ "column": 0, "width": 25 }, { "column": 1, "width": 15 }],
      "frozenPanes": { "rows": 1, "columns": 0 },
      "cells": [
        ["Department", "Operating Budget", "Actual Expense"],
        ["Engineering", { "type": "decimal", "value": "1500000.00" }, { "type": "decimal", "value": "1420000.50" }],
        ["Operations", { "type": "decimal", "value": "450000.00" }, { "type": "decimal", "value": "435000.00" }],
        ["Total", { "formula": "=SUM(B2:B3)", "cachedValue": 1950000 }, { "formula": "=SUM(C2:C3)", "cachedValue": 1855000.5 }]
      ]
    }
  ]
}
```

## Implementation example

```ts
import {
  generateDocument,
  parseDocument,
  patchDocument,
  createPatchHistory,
  renderPreviewBlocks,
  renderPreviewHtml,
  type DocModel,
} from "@arnilo/prism-work/documents";

// 1. Define typed document model
const doc: DocModel = {
  kind: "doc",
  modelVersion: 1,
  title: "Architecture Review",
  blocks: [
    { type: "heading", level: 1, text: "System Architecture" },
    {
      type: "paragraph",
      runs: [
        { text: "Prism operates purely in memory with ", bold: false },
        { text: "zero-trust security boundaries.", bold: true, italic: true },
      ],
    },
    {
      type: "table",
      rows: 2,
      columns: 2,
      cells: [
        ["Module", "Latency"],
        ["Parser", "12ms"],
      ],
    },
  ],
};

// 2. Generate in-memory DOCX binary with SHA-256 contentHash
const { bytes, contentHash } = await generateDocument(doc, { format: "docx" });
console.log(`Generated DOCX (${bytes.byteLength} bytes, SHA-256: ${contentHash})`);

// 3. Parse OOXML bytes back to a validated model
const parsed = await parseDocument(bytes, { kind: "doc" });
const { model, fidelity } = await importDocument(bytes, { kind: "doc" });
// fidelity.issues[].code: macros | comments | media | …  lost: dropped | approximated

// 4. Apply typed model patches
const patched = patchDocument(parsed, [
  { op: "set", target: { block: 0 }, block: { type: "heading", level: 1, text: "Executive Summary" } },
  { op: "insert", target: { afterBlock: 0 }, block: { type: "paragraph", text: "New introduction." } },
]);

// 5. Interactive Undo/Redo editing
const history = createPatchHistory(patched);
history.apply([{ op: "set", target: { title: true }, value: "Updated Review" }]);
console.log(history.canUndo()); // true
const restored = history.undo(); // restored to "Executive Summary" state

import { diffDocument } from "@arnilo/prism-work/documents";
const diff = diffDocument(parsed, restored, { maxOps: 4096 });

// 6. Generate structured preview blocks & safe HTML
const blocks = renderPreviewBlocks(restored);
const htmlSnippet = renderPreviewHtml(restored, { maxHtmlBytes: 256 * 1024 });
```

## Extension and configuration notes

### Sub-package Pinning
To avoid pulling in CLI frameworks or extraneous dependencies, `@arnilo/prism-work/documents` directly pins the exact underlying modular packages:
- `@office-open/docx@0.12.3`
- `@office-open/xlsx@0.12.3`
- `@office-open/pptx@0.12.3`

### Draft-07 JSON Schema Slicing
For AI agent tool generation where token budgets are constrained, `getDocumentModelSchema` provides closure slicing:
```ts
// Returns only TableBlock, CellValue, and their transitively required definitions in $defs
const tableSchema = getDocumentModelSchema({ kind: "doc", slice: "table" });
```

### Text Redaction Hook (`SecretRedactor`)
When parsing untrusted or sensitive OOXML containers, hosts can inject a redaction hook to scrub PII or secrets before the document model enters memory:
```ts
const sanitizedModel = await parseDocument(rawBytes, {
  kind: "doc",
  redactor: {
    redact: (text: string) => text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED-SSN]"),
  },
});
```

### Telemetry Seam
The dependency-free `DocumentsTelemetry` seam allows optional OpenTelemetry instrumentation without adding runtime telemetry dependencies:
```ts
const telemetry: DocumentsTelemetry = {
  startSpan(name, attributes) {
    // Maps to tracer.startSpan with allow-listed metadata (kind, format, bytes, counts)
    // Model content and document text are NEVER passed to telemetry spans.
    return activeSpan;
  },
};
```

### Decimal Fidelity Ceiling
Financial worksheets often require exact decimal representations that JavaScript 64-bit binary floating-point numbers cannot represent without precision loss. `@arnilo/prism-work/documents` supports canonical string decimals (`{ type: "decimal", value: "1500000.00" }`). Generate emits that string; it does not coerce through `Number()`. Parse round-trips `{ type: "decimal", value: "1500000.00" }`.

`list` blocks generate as OOXML numbering (`w:numPr`), not a `• ` prefix in `w:t`. Charts, pivots, comments, and headers remain fidelity-reported drops.

## Security and performance notes

- **Pure In-Memory Operation**: No temporary files, no shell execution, no binary spawning, and zero network sockets.
- **ZIP Signature Gating**: Buffers must begin with PK zip container signatures (`0x50, 0x4B, 0x03, 0x04`). Extension-based type inference is strictly prohibited. OLE compound files (`.doc` / `.xls` / `.ppt`, magic `D0 CF 11 E0`) fail this gate. Convert them in the [work sandbox](work-sandbox.md) then `office_parse`. Encrypted OOXML is still dropped on import.
- **Fail-Closed Caps**: Input size and element count caps are evaluated before entering XML translation passes, preventing zip-bomb and decompression amplification attacks.
- **Sanitize-by-Construction HTML**: `renderPreviewHtml` strictly entity-encodes all text fields, neutralizes dangerous protocols (`javascript:`, `http://`, `https://`), strips raw script/image tags, and caps output size to prevent DOM-based XSS and memory exhaustion.
- **Performance Budget**: Warm generation of 200-block documents completes in under 15 ms; parse and round-trip equality checks complete in under 100 ms.

## Related APIs

- [`@arnilo/prism-work/document-reader`](./document-reader.md): Bounded literal text extraction from PDF and DOCX documents for coding agent tools; optional host-selected Mistral OCR parser.
- [`@arnilo/prism-work/connectors`](./work-tools.md): Microsoft 365 and Google Workspace identity-scoped connectors.
- [`@arnilo/prism-coding-tools/agent`](./coding-agent-tools.md): Coding tools and file operations.
- [`@arnilo/prism-core/governance/observability`](./observability.md): OpenTelemetry instrumentation and trace adapters.
- [Work artifacts and review](work-artifacts-and-review.md): evidence-bound artifact citations and `evidenceDigest` approvals.
- [Work sandbox](work-sandbox.md): LibreOffice formula recalc, slide rasterization, and OLE convert; this package still does not spawn `soffice`.
