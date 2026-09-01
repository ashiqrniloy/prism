# Prism documents, sheets, and diagrams packages

Status: **requested** — filed against new packages `@arnilo/prism-documents` / `@arnilo/prism-sheets` / `@arnilo/prism-diagrams` (next release line). Synapta Plans **122–127** are **blocked** until a release implements every item below and Synapta pins that release. Architecture: [`docs/architecture/adhoc-data-and-documents-analysis.md`](../architecture/adhoc-data-and-documents-analysis.md). Sibling of [`prism-production-rag.md`](prism-production-rag.md) (P1–P8).

## Summary

Prism 0.3.x ships no Office generation and no structured sheet parsing: the only Office-adjacent package is `@arnilo/prism-document-reader` (read-only literal-text extraction of PDF/DOCX for the coding `read` tool). Three new bounded packages are requested so that **every Prism-hosting app** gets the same portable core instead of each app vendoring office libraries:

- `@arnilo/prism-documents` — Prism Document Model (doc/sheet/deck), generate/parse/patch, model-native preview blocks.
- `@arnilo/prism-sheets` — XLSX/CSV parsing with decimal-safe typed schema inference.
- `@arnilo/prism-diagrams` — draw.io embed client and mxGraph XML validation.

Doctrine unchanged: **Prism defines contracts, not apps.** Hosts own storage, credentials, network, and UI shells. The packages do no filesystem or network I/O, take and return bytes/JSON, enforce caps, and fail closed.

## Why Synapta wants it

- Org users upload XLSX/CSV business data that must become typed lake datasets; decimal-unsafe inference would corrupt money (Synapta stores money as decimal strings — floats are forbidden). This is a host engine concern, not app policy.
- Agents generate Word/Excel/PowerPoint and draw.io diagrams from governed data and wiki/RAG. Synapta stores models in Postgres and artifacts in RustFS; it needs a portable model + generate/parse/patch + preview contract, not app-internal types.
- The requester is the Prism maintainer: the core belongs in Prism so other Prism apps reuse it; the Plan 080-style external-timing risk is accepted and controlled (Synapta plans simply stay blocked until the pin).

## Requested behavior

### Package A — `@arnilo/prism-documents`

**P1 — Prism Document Model (kinds: `doc` / `sheet` / `deck`).**

- Typed JSON models, discriminated unions per kind, each stamped `modelVersion`.
- `doc` blocks: heading, paragraph, bullet/numbered list, table, image, page break, generated-chart image.
- `sheet`: workbook → sheets → cells with typed values (`string | number | decimal | date | datetime | boolean`), number formats, column widths, frozen panes. Formulas are **read-only strings** (`{ formula, cachedValue? }`); no evaluation engine.
- `deck`: slides with a constrained `layout` enum, title, bullets, notes, image, chart.
- JSON Schema (draft-07) per kind; `validateDocumentModel` throws on invalid models; `documentModelSchema(kind, slice?)` serves LLM context budgets with on-demand slicing (office-open-style).
- Plain JSON in/out — no class instantiation required; a fully typed API may wrap it.

**P2 — Generate.**

- `generateDocument(model, { format: "docx" | "xlsx" | "pptx" }) → { bytes, contentHash }`.
- Internally office-open (pin exact) or an equivalent spec-compliant OOXML writer; output should validate against OOXML Transitional (ISO/IEC 29500) and open in Word/Excel/PowerPoint, LibreOffice, and Google Workspace.
- Caps: block/cell/slide/image counts and a byte cap; violations throw `ERR_PRISM_DOCUMENTS_CAP` with **no partial bytes**.
- No filesystem, no network — bytes in/out only.

**P3 — Parse and patch (round-trip).**

- `parseDocument(bytes, { kind, caps }) → model` — the same JSON shape `generateDocument` accepts. Round-trip identity for Prism-generated files; external files best-effort with `fidelity: "partial"` flags where content could not be represented.
- `patchDocument(model, patch[]) → model` — typed operations (set/insert/remove/move) validated against the model schema; unknown or out-of-bounds operations throw.
- Optional template-patch seam (placeholder replacement) may follow.

**P4 — Preview blocks (model-native preview).**

- `renderPreviewBlocks(model) → PreviewBlock[]` — framework-neutral structured blocks (document outline, bounded sheet grid snapshot, slide list) with per-block row/cell bounds. Hosts render them natively (React, Svelte, terminal).
- `renderPreviewHtml(model) → string` — bounded, sanitized HTML (no `<script>`, no external resources) for simple hosts.
- No UI-framework components in the core package; optional adapter subpaths may come later.

**P5 — Editing contract.**

- Editing = validated patches (P3). Ship a patch-history helper (`createPatchHistory` with undo) for hosts building editors. No collaborative editing, no OT/CRDT.

**P6 — Fail-closed and redaction.**

- Error namespace `ERR_PRISM_DOCUMENTS_*` (cap, invalid-model, unsupported-format, parse-failed).
- Optional `SecretRedactor`-style hook at the parse boundary, matching the `prism-document-reader` precedent.

### Package B — `@arnilo/prism-sheets`

**P7 — XLSX parse.**

- `parseWorkbook(bytes, { caps }) → { sheets: [{ name, rows, schema }] }` with byte/sheet/row/column caps and ZIP-signature gating (no extension trust).
- Formula cells returned as `{ formula, cachedValue? }` — never executed.

**P8 — CSV parse.**

- `parseCsv(input, { caps }) → { rows, schema, dialect }` — RFC 4180 plus common variants; delimiter/quote/escape sniffing; UTF-8 with BOM handling.

**P9 — Typed schema inference (safety-critical).**

- Column types: `string | integer | number | decimal | date | datetime | boolean`.
- **Money-like columns (currency symbols/patterns, or name heuristics like `*_amount`, `price`, `total`) infer `decimal`, and values are returned as decimal strings — never floats.**
- Ambiguous numeric columns (mixed precision, inconsistent locale separators, scientific notation) infer `string` with `flags: ["numeric-ambiguous"]`.
- Inference samples a bounded window (default first 500 non-empty rows) and then validates the inferred types over the full parse; violations are reported (`mismatchCount`, capped offender list) rather than silently coerced.
- Schema report: `{ columns: [{ name, type, nullRate, sample, flags }], rowCount, warnings[] }`.
- Error namespace `ERR_PRISM_SHEETS_*`; oversized input refuses rather than degrades.

### Package C — `@arnilo/prism-diagrams`

**P10 — draw.io embed client.**

- `createDrawioEmbed({ iframe, origin })` implementing the diagrams.net embed protocol (`proto=json`): `init` / `load` / `save` / `autosave` / `exit` / `configure` / `export` with typed messages and callbacks.
- `export({ format: "xml" | "xmlsvg" | "xmlpng" | "json" })` for save-with-preview flows.
- **Origin and `event.source` verification enforced inside the client**; posting with `targetOrigin: "*"` is rejected. No default public `embed.diagrams.net` — an explicit origin is required and self-hosting is the documented deployment.

**P11 — mxGraph model helpers.**

- `validateDrawioXml(xml)` — well-formedness plus required-element checks, under element/attribute caps with an XXE-safe parser configuration (external entities disabled; billion-laughs fixtures must fail).
- `canonicalizeDrawioXml(xml)` — stable formatting so hosts can content-hash diagrams.

**P12 — Visio is out of scope by decision.** No `.vsd`/`.vsdx` import or export anywhere in these packages (Synapta decision 2026-08-30: skip Visio entirely).

### Cross-package

**P13 — Versioning.** Synapta pins exact versions; pre-1.0 breaking changes are acceptable with changelog entries; semver discipline from 1.0.

**P14 — No storage, credentials, or network** in any of the three packages. Hosts own persistence (Synapta: Postgres models + RustFS artifacts) and deployment (Synapta self-hosts the Apache-2.0 draw.io webapp).

**P15 — Optional OpenTelemetry** spans for generate/parse/patch/export (kind, byte counts, durations). No content bytes in attributes.

## Existing behavior to keep

- `@arnilo/prism-document-reader` stays read-only literal-text extraction for the coding `read` tool; generation is **not** folded into it (separate packages, separate activation).
- The coding tool set is unchanged; these packages are host engines, not coding tools.
- Prism core gains no Office dependency; the packages are optional installs.

## Out of scope (do not add)

- Hosted or cloud rendering; Microsoft Office or LibreOffice runtime dependency
- Formula evaluation engine
- Collaborative editing / OT / CRDT
- UI-framework components in core packages (adapters later, if ever)
- Visio (dropped — P12)
- Mermaid→draw.io conversion (host concern)
- Turning Prism core into a document product

## Acceptance criteria

- `generateDocument` → `parseDocument` round-trip on a Prism-generated docx/xlsx/pptx returns an equal model per a per-kind equality spec.
- Golden files in the Prism repo: one generated file per format opens in Word/Excel/PowerPoint and LibreOffice without repair prompts.
- Cap violations throw `ERR_PRISM_DOCUMENTS_CAP` and produce no partial bytes.
- `patchDocument` with an unknown operation throws; every successful patch output passes `validateDocumentModel`.
- `renderPreviewBlocks` bounds rows (e.g. 200) per block; `renderPreviewHtml` output contains no `<script>` and no external URLs.
- Sheets: a `$1,234.56` column infers `decimal` with string values `"1234.56"` — no float anywhere in the row output; a mixed-precision column infers `string` with `numeric-ambiguous`; a 2 GiB or >5M-row input refuses with a cap error; CSV dialect sniffing handles comma/semicolon/tab delimiters and quoted fields containing delimiters and newlines.
- Diagrams: the embed client rejects a message from a wrong origin and rejects `targetOrigin: "*"`; `validateDrawioXml` accepts draw.io-saved XML and rejects truncated XML and a billion-laughs fixture under caps.
- A CI fixture runs the self-hosted Apache-2.0 draw.io webapp and exercises load → edit → save → `export xmlsvg` through the client.
- No package reads `process.env`, opens sockets, or touches the filesystem.

## Suggested package surface

```ts
// @arnilo/prism-documents
generateDocument(model: DocumentModel, opts: { format: "docx" | "xlsx" | "pptx" }): Promise<{ bytes: Uint8Array; contentHash: string }>;
parseDocument(bytes: Uint8Array, opts: { kind: "doc" | "sheet" | "deck"; caps?: DocumentCaps }): Promise<DocumentModel>;
patchDocument(model: DocumentModel, patch: DocumentPatch[]): DocumentModel;
validateDocumentModel(model: DocumentModel): void;
documentModelSchema(kind: DocumentKind, slice?: string): JsonSchema;
renderPreviewBlocks(model: DocumentModel, opts?: PreviewOptions): PreviewBlock[];
renderPreviewHtml(model: DocumentModel, opts?: PreviewOptions): string;

// @arnilo/prism-sheets
parseWorkbook(bytes: Uint8Array, opts?: SheetsCaps): Promise<WorkbookParse>;
parseCsv(input: string | Uint8Array, opts?: SheetsCaps): Promise<CsvParse>;
// WorkbookParse / CsvParse: { rows: CellValue[][]; schema: ColumnSchema[]; warnings: InferenceWarning[]; dialect?: CsvDialect }

// @arnilo/prism-diagrams
createDrawioEmbed(opts: { iframe: HTMLIFrameElement; origin: string }): DrawioEmbed;
validateDrawioXml(xml: string, opts?: XmlCaps): DrawioModelSummary;
canonicalizeDrawioXml(xml: string): string;
```

Exact names may change; Synapta Plans 122–127 pin the shipped names.

## Reproduction (current 0.3.x gaps)

```ts
// No document generation, parse, or patch exists anywhere in the 0.3.x line.
// @arnilo/prism-document-reader: read-only literal text (pdf-parse/mammoth) for the coding read tool.
// No XLSX/CSV typed parsing; no draw.io embed client; no mxGraph validation.
```