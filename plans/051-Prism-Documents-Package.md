# 051 — `@arnilo/prism-documents`: Prism Document Model, generate/parse/patch, model-native preview

Source request: `prism-documents.md` (Package A, P1–P6, plus the P13–P15 cross-package items
that land in this package), filed against new package `@arnilo/prism-documents` (next release
line). Sibling plans: `052-Prism-Sheets-Package.md` (P7–P9), `053-Prism-Diagrams-Package.md`
(P10–P12). The requested architecture doc `docs/architecture/adhoc-data-and-documents-analysis.md`
does not exist in-repo (same situation as plan 034's missing reference; noted, not created here).

Doctrine unchanged: Prism defines contracts, not apps. No filesystem, no network, no
`process.env` reads; bytes/JSON in/out; caps enforced; fail closed. Office generation is
**not** folded into `@arnilo/prism-document-reader` (stays read-only literal-text extraction
for the coding `read` tool) and the coding tool set is unchanged.

**Amendment (maintainer decision, 2026-09-01):** the three requested packages ship as **one
package `@arnilo/prism-office`** with subpath exports `/documents`, `/sheets`, `/diagrams`.
All tasks below are reinterpreted accordingly: the package scaffold lands at
`packages/office/src/documents`, the initial cut is `@arnilo/prism-office@0.3.0` (peer
`@arnilo/prism ^0.3.0`, omitted from umbrellas), the release task cuts the single office
manifest, and the docs pages (`docs/documents.md`, `docs/sheets.md`, `docs/diagrams.md`)
document the subpaths of one package under one index group. Feature scope, APIs, tests, and
security criteria are unchanged. The `@office-open/{docx,xlsx,pptx}` pins become regular
dependencies of the office manifest.

**Packaging note.** `prism-documents.md` requests three bounded packages; `plans/054` reviews
Prism's package count explosion and floats a single `@arnilo/prism-office` alternative with
subpaths. This plan implements the request as written (separate package). If the 054
alternative is adopted before Task 2, only the manifest name/subpath table changes — every
task below is unchanged.

## Objectives

- Implement P1–P6: the Prism Document Model (kinds `doc`/`sheet`/`deck`), `generateDocument`
  (docx/xlsx/pptx), `parseDocument` + `patchDocument` round-trip, `renderPreviewBlocks` +
  `renderPreviewHtml`, the patch-history editing helper, and the fail-closed error namespace
  with optional parse-boundary redaction.
- Ship `@arnilo/prism-documents` as a new optional package (initial cut `0.3.0`, peer
  `@arnilo/prism ^0.3.0`, omitted from umbrellas) using `office-open` internals pinned exact
  (`@office-open/docx`, `@office-open/xlsx`, `@office-open/pptx` `0.12.3` — sub-packages, not
  the umbrella, to keep `citty`/CLI weight out).
- Enforce every cross-package constraint that lands here: P13 (Decision B independent
  publication, exact-pin friendly), P14 (no storage/credentials/network), P15 (optional
  dependency-free telemetry seam for generate/parse/patch/export; no content bytes in
  attributes).

## Expected Outcome

- `generateDocument(model, { format })` produces spec-compliant OOXML bytes plus SHA-256
  `contentHash`; `parseDocument` on those bytes returns an equal model per a per-kind equality
  spec; cap violations throw `ERR_PRISM_DOCUMENTS_CAP` with no partial bytes.
- `validateDocumentModel` rejects invalid models; `documentModelSchema(kind, slice?)` serves
  draft-07 JSON Schema slices for LLM context budgets (office-open-style on-demand slicing).
- `patchDocument` applies typed set/insert/remove/move operations validated against the model
  schema; unknown or out-of-bounds operations throw; every successful patch output passes
  `validateDocumentModel`; `createPatchHistory` provides undo.
- `renderPreviewBlocks` emits bounded framework-neutral blocks (per-block row/cell bounds,
  default 200 rows/block); `renderPreviewHtml` emits sanitized HTML with no `<script>` and no
  external URLs.
- Golden files (one per format) committed to the repo open in Word/Excel/PowerPoint and
  LibreOffice without repair prompts (CI proxy: LibreOffice headless conversion + round-trip
  identity; Word check recorded as release evidence).
- All tests network-free; package reads no `process.env`, opens no sockets, touches no
  filesystem; `npm run release:check` passes with the new manifest.

## Tasks

- [x] Task 1: Primitive review — inventory document/office/hash/redaction/telemetry primitives before implementation
  - Acceptance Criteria:
    - Functional: Written inventory at `docs/_evidence/phase51-primitives.md` covering: document-reader's cap validation (`validateCap`, `DEFAULT_MAX_*`, optional-peer fail-closed probing) as the cap/redaction template; `RagError`-family error-class pattern with `ERR_PRISM_*` codes; SHA-256 content-hash precedents (rag `hash.ts`, audit-export canonical envelopes); `createRagTelemetry` seam shape (dependency-free interface, otel adapter side); office-open 0.12.3 API surface actually used (`@office-open/docx` `generateDocument`/`parseDocument`/`patchDocument`, `@office-open/xlsx` `generateWorkbook`/`parseWorkbook`/`parseXlsx` (raw XML access — decimal-safe `<v>` reads), `@office-open/pptx` `generatePresentation`/`parsePresentation`); JSON Schema draft-07 validation approach (ajv precedent from `tool-validator-json-schema`).
    - Performance: n/a (read-only task).
    - Code Quality: Every P1–P6 item mapped to an existing primitive to reuse or a named new primitive; the office-open translation boundary (Prism model ⇄ office-open options) is explicitly designed as the only place office-open types leak.
    - Security: Inventory records which existing seams already enforce caps, redaction, and fail-closed behavior so new code reuses rather than reimplements them.
  - Approach:
    - Documentation Reviewed:
      - Graft nodes: `packages/document-reader/src/index.ts:L148-L181` (`createDocumentReader` cap validation + redactor hook), `packages/rag/src/errors.ts:L1-L33` (`RagError` code pattern), `packages/rag/src/hash.ts`, `packages/rag/src/limits.ts` (`resolveRagLimits`), `packages/rag/src/telemetry.ts` + `packages/observability-opentelemetry/src/rag-telemetry.ts:L35-L88` (`createRagTelemetry` attribute filtering, span-name allow-list), `packages/tool-validator-json-schema` (ajv usage precedent).
      - office-open 0.12.3 docs (Context7 `/demomacro/office-open`): `generate({type, options, outputType})`, per-format `parseDocument`/`patchDocument` with `outputType: "nodebuffer"`, `parseXlsx` raw XML components (workbook/worksheets/styles/sharedStrings), draft-07 schemas + `sliceDocumentSchema` slicing pattern in `office-open/schemas`.
      - Repo conventions: `CHANGELOG.md` Decision B entries, `scripts/release.mjs` `validateIndependent`, `docs/document-reader.md` page structure, gated test scripts precedent (`PRISM_TEST_POSTGRES_URL`, obscura `test:live`).
    - Options Considered:
      - `office-open` umbrella vs `@office-open/{docx,xlsx,pptx}` sub-packages — chosen: sub-packages (umbrella drags `citty` CLI framework and the AI-SDK tools surface; sub-packages keep the dependency tree minimal and pinned).
      - ajv direct dep vs peer on `@arnilo/prism-tool-validator-json-schema` — chosen: ajv direct pinned dep (the tool-validator package's API is shaped for `tool.parameters`, not arbitrary model validation).
      - zod vs draft-07 JSON Schema for the model — chosen: draft-07 (explicitly requested; also the wire format `documentModelSchema` serves to hosts/LLMs, independent of runtime validation library).
    - Chosen Approach:
      - Reuse: cap validation shape from document-reader, error-class pattern from rag, telemetry seam shape from rag/otel, SHA-256 hashing precedent.
      - New primitives (all generic): `DocumentModel` discriminated union with `modelVersion`, draft-07 schemas with slice closure, model⇄office-open translators, `PreviewBlock` contract, `DocumentPatch` operations.
    - API Notes and Examples:
      ```ts
      // office-open translation boundary (the only office-open-typed seam):
      import { generateDocument as ooGenerateDocx } from "@office-open/docx";
      const options = docModelToDocxOptions(model); // packages/documents/src/translate/docx.ts
      const bytes = ooGenerateDocx(options); // Uint8Array, in-memory, no fs
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase51-primitives.md`: inventory (created in this task).
    - References:
      - `prism-documents.md` P1–P6, P13–P15; `plans/034-Release-0-3-1-Production-RAG-Engine.md` Task 1 (primitive-review precedent); `docs/_evidence/phase34-primitives.md` (inventory format precedent).
  - Test Cases to Write:
    - None (review task; output is the inventory itself).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (analysis only).
    - Docs pages to create/edit: none with reason — read-only inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 2: Package scaffold + Prism Document Model, JSON Schema, validation — request P1
  - Acceptance Criteria:
    - Functional: New workspace `packages/documents` (name `@arnilo/prism-documents`) with `src/types.ts` defining the discriminated union `DocumentModel = DocModel | SheetModel | DeckModel` (`kind` discriminator, `modelVersion` stamped, plain JSON — no class instantiation required); `doc` blocks: heading, paragraph, bullet/numbered list, table, image, page break, generated-chart image; `sheet`: workbook → sheets → cells with typed values `string | number | decimal | date | datetime | boolean`, number formats, column widths, frozen panes, formulas as read-only `{ formula, cachedValue? }` strings (no evaluation engine); `deck`: slides with constrained `layout` enum, title, bullets, notes, image, chart. `src/model-schema.ts` exports draft-07 JSON Schema per kind; `validateDocumentModel(model)` throws on invalid models; `documentModelSchema(kind, slice?)` returns the full schema or the dependency closure of named slices (office-open-style).
    - Performance: Schema compiled once and cached (ajv instance per kind, lazy); validation of a 100-block model completes in <10 ms after warm compile; schema slices are small (slice closure, never the whole schema) so LLM context budgets stay bounded.
    - Code Quality: `tsc -p tsconfig.json` strict-clean extending `tsconfig.packages.json`; exported types are structural and JSON-serializable; `sideEffects: false`; no office-open import in model/schema files (model layer is engine-independent).
    - Security: Model validation is the trust boundary — every later task validates input through `validateDocumentModel` before any translation; schema itself rejects unknown `kind`, negative counts, oversized strings via `maxLength`s; no `process.env` reads anywhere in the package.
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory; `prism-documents.md` P1; office-open `office-open/schemas` slicing pattern (`sliceDocumentSchema("docx", ["ParagraphOptions", "RunOptions"])` — dependency-closure slicing).
      - `packages/rag/src/types.ts` + `packages/rag/src/errors.ts` for type/error conventions; `packages/obscura/package.json` for new-package manifest shape (peer `@arnilo/prism ^0.3.x`, file: devDeps, `files: ["dist", ...]`).
    - Options Considered:
      - One mega-schema vs per-kind schemas with shared `$defs` — chosen: per-kind schemas with a shared definitions module (draft-07 `$ref` closure) so `documentModelSchema(kind)` stays bounded and slicing is meaningful.
      - Typed API wrapper required vs plain JSON in/out — chosen: plain JSON + fully-typed TypeScript types around it (request explicitly allows a typed API to wrap plain JSON).
    - Chosen Approach:
      - Scaffold mirrors obscura/rag package layout (`src/index.ts`, `src/errors.ts`, `src/__tests__/`, `tsconfig.json` extending `../../tsconfig.packages.json`, scripts `build`/`typecheck`/`test`/`pack:dry-run` via `scripts/with-build-lock.mjs`).
      - `errors.ts` first: `DocumentsError` base with `code` field, subclasses `DocumentsCapError` (`ERR_PRISM_DOCUMENTS_CAP`), `DocumentsValidationError` (`ERR_PRISM_DOCUMENTS_INVALID_MODEL`), `DocumentsFormatError` (`ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT`), `DocumentsParseError` (`ERR_PRISM_DOCUMENTS_PARSE_FAILED`) — the full P6 namespace in one place.
      - Hand-written draft-07 schema objects (not generated from zod) so the served schema is the source of truth; ajv validates models against them.
    - API Notes and Examples:
      ```ts
      const model: DocumentModel = {
        kind: "doc",
        modelVersion: 1,
        title: "Q3 Report",
        blocks: [
          { type: "heading", level: 1, text: "Q3 Report" },
          { type: "paragraph", text: "Revenue grew.", runs: [{ text: "Revenue grew." }] },
          { type: "table", rows: 2, columns: 2, cells: [["Label", "Value"], ["Revenue", { type: "decimal", value: "1234.56" }]] },
        ],
      };
      validateDocumentModel(model); // throws DocumentsValidationError on invalid
      const slice = documentModelSchema("doc", ["doc.paragraph", "doc.table"]); // dependency closure only
      ```
    - Files to Create/Edit:
      - `packages/documents/package.json` (new manifest; peer `@arnilo/prism ^0.3.0`; deps `ajv` pinned, `@office-open/docx`/`@office-open/xlsx`/`@office-open/pptx` exact `0.12.3` declared here so the pin lives in one file)
      - `packages/documents/tsconfig.json`, `packages/documents/src/index.ts`, `packages/documents/src/types.ts`, `packages/documents/src/model-schema.ts`, `packages/documents/src/errors.ts`
      - `packages/documents/src/__tests__/model.test.ts`, `packages/documents/src/__tests__/schema-slice.test.ts`
      - `packages/documents/README.md`, `packages/documents/CHANGELOG.md`, `packages/documents/LICENSE`
      - `package.json` (root): workspaces already glob `packages/*` — verify, no edit expected.
    - References:
      - `prism-documents.md` P1, P6, "Suggested package surface"; `docs/api-page-template.md`; `scripts/package-truth.mjs` (regenerated at release).
  - Test Cases to Write:
    - `model.test.ts`: valid doc/sheet/deck fixtures pass `validateDocumentModel`; invalid `kind`, missing `modelVersion`, unknown block type, negative table dimensions, decimal value that is not a canonical decimal string → throw with the right code.
    - `schema-slice.test.ts`: full schema is valid draft-07 (ajv meta-schema compile); `documentModelSchema("doc")` includes all block defs; `documentModelSchema("doc", ["doc.paragraph"])` closure contains paragraph + run defs and not table defs; every served slice compiles standalone (no dangling `$ref`s).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package + public API (`DocumentModel`, `validateDocumentModel`, `documentModelSchema`).
    - Docs pages to create/edit: `docs/documents.md` (new page, created in Task 8 following `api-page-template.md`).
    - `docs/index.md` update: yes — Task 8 adds the entry under a new "Documents, sheets, and diagrams" group.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 3: Generate — request P2
  - Acceptance Criteria:
    - Functional: `generateDocument(model, { format: "docx" | "xlsx" | "pptx" }) → Promise<{ bytes: Uint8Array; contentHash: string }>`; doc/sheet/deck models map to their natural formats (`doc`→docx, `sheet`→xlsx, `deck`→pptx; cross-kind generation throws `ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT`); validates the model first; translates to office-open options and generates in memory (`outputType: "nodebuffer"`); `contentHash` = SHA-256 hex of the bytes. Caps (block/cell/slide/image counts, byte cap) enforced **before** generation — violations throw `ERR_PRISM_DOCUMENTS_CAP` and no bytes are returned/partially written.
    - Performance: A 200-block doc generates in <500 ms warm (office-open writer cost dominates; measured in test with a soft threshold to avoid flaky CI); byte cap checked before translation so oversized models fail without paying the translation cost.
    - Code Quality: Translation lives in `src/translate/{docx,xlsx,pptx}.ts` — the only files importing `@office-open/*`; generators are pure functions model→bytes; no fs/network in any path (office-open generate is in-memory).
    - Security: No `process.env`; caps fail closed; image blocks accept bytes-or-ref only as opaque model fields (hosts resolve refs before calling — documented, never fetched).
  - Approach:
    - Documentation Reviewed:
      - office-open docs (Context7): `generateDocumentSync(data)` (docx), `generateWorkbook`, `generatePresentation`, JSON structures for sections/tables (`children`, `rows`, `cells`), worksheets (`rows`/`cells`/`value`), slides (`shapes`, `textBody`).
      - Task 1 inventory (hash precedent: `packages/rag/src/hash.ts`).
    - Options Considered:
      - Async office-open umbrella `generate({type, options, outputType})` vs per-format sync generators — chosen: per-format sub-package generators (sync, no `citty`/umbrella import, pinned exact).
      - Decimal cell handling for xlsx generation: numeric cell via `Number(value)` vs text cell — chosen: numeric cell with the decimal string passed where office-open accepts it, else `Number()`; **documented fidelity ceiling**: xlsx numeric cells are IEEE-754 doubles in Excel itself, so decimal-string exactness through Excel round-trips is bounded by shortest-repr — the Prism sheet model keeps the original decimal string, parse reads the raw `<v>` decimal string (Task 4), and the per-kind equality spec (Task 7) defines decimal equality as string equality after canonical decimal normalization. `# ponytail:` comment marks the ceiling and the escape hatch (host opt-in text cells for exact-string display).
    - Chosen Approach:
      - `src/generate.ts` orchestrates: validate → caps check → translate → generate → hash. Translation modules are per-kind pure functions with exhaustive block switch (unknown block type impossible post-validation).
    - API Notes and Examples:
      ```ts
      const { bytes, contentHash } = await generateDocument(model, { format: "docx" });
      // bytes: Uint8Array (OOXML zip), contentHash: sha256 hex
      ```
    - Files to Create/Edit:
      - `packages/documents/src/generate.ts`, `packages/documents/src/caps.ts` (defaults + hard maxima + `validateDocumentsCaps`), `packages/documents/src/translate/docx.ts`, `packages/documents/src/translate/xlsx.ts`, `packages/documents/src/translate/pptx.ts`, `packages/documents/src/hash.ts`
      - `packages/documents/src/__tests__/generate.test.ts`
      - `packages/documents/src/index.ts` (export)
    - References:
      - `prism-documents.md` P2, acceptance "Cap violations throw `ERR_PRISM_DOCUMENTS_CAP` and produce no partial bytes".
  - Test Cases to Write:
    - `generate.test.ts`: each kind×format happy path returns non-empty zip bytes (PK signature) + matching SHA-256; wrong kind×format throws unsupported; block-count and byte-cap fixtures throw cap error with no bytes; invalid model throws validation error before any office-open call (spy).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `generateDocument` export.
    - Docs pages to create/edit: `docs/documents.md` generate section — Task 8.
    - `docs/index.md` update: yes — Task 8.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 4: Parse and patch round-trip — requests P3, P5
  - Acceptance Criteria:
    - Functional: `parseDocument(bytes, { kind, caps? }) → Promise<DocumentModel>`; ZIP-signature gating (no extension trust); round-trip identity for Prism-generated files (generate → parse → equal model per the Task 7 equality spec); external files best-effort with `fidelity: "partial"` flags where content could not be represented. `patchDocument(model, patch[]) → model` with typed ops `set`/`insert`/`remove`/`move` validated against the model schema; unknown or out-of-bounds operations throw; every successful patch output passes `validateDocumentModel`. `createPatchHistory(model)` helper with `apply(patch)`/`undo()` for hosts building editors (no collaborative editing, no OT/CRDT). Optional `SecretRedactor`-style hook at the parse boundary (P6): `parseDocument(..., { redactor })` redacts extracted text content.
    - Performance: Parse of a 1 MB docx <300 ms warm; patch application is O(patch size), not O(model) beyond a single validation pass.
    - Code Quality: office-open `parseDocument`/`parseWorkbook`/`parsePresentation` outputs mapped through the same translate modules (bidirectional, shared cell-value mappers); patch ops expressed as a discriminated union with path targets referencing model structure (typed, not string paths); no formula evaluation (formula cells map to `{ formula, cachedValue? }` read-only).
    - Security: Parse enforces byte/element caps before handing to office-open; ZIP-signature check rejects non-OOXML bytes with `ERR_PRISM_DOCUMENTS_PARSE_FAILED`; redactor runs on all extracted string content (paragraph/run/cell/note text) at the boundary before the model is returned.
  - Approach:
    - Documentation Reviewed:
      - office-open docs (Context7): `parseDocument(buffer)` → `{sections, title, creator}`, `parseWorkbook(buffer)` → `{worksheets, styles}`, `parsePresentation(buffer)` → `{slides, size, title}`; `patchDocument({outputType, data, placeholders})` (office-open's patch is placeholder replacement — the optional template-patch seam, P3's "may follow", is deferred unless trivially layered on this).
      - `prism-documents.md` P3, P5, P6; document-reader redactor precedent (`packages/document-reader/src/index.ts` options.redactor).
    - Options Considered:
      - office-open `patchDocument` (placeholder replacement on bytes) vs Prism-model patch ops — chosen: Prism-model ops (request contract; also engine-independent and validatable); office-open placeholder patching noted as the template seam, deferred.
      - String JSON-pointer paths vs typed op unions — chosen: typed unions with index/field selectors (request says "typed operations"; string paths are injection surface).
    - Chosen Approach:
      - `src/parse.ts` (signature gate → caps → office-open parse → reverse-translate → fidelity flags → optional redact) and `src/patch.ts` (ops as discriminated union; apply → validate output; history stacks validated patches for undo).
    - API Notes and Examples:
      ```ts
      const model = await parseDocument(bytes, { kind: "doc" });
      const patched = patchDocument(model, [
        { op: "set", target: { block: 1 }, patch: { text: "Revenue grew 12%." } },
        { op: "insert", target: { afterBlock: 1 }, block: { type: "page-break" } },
      ]);
      const history = createPatchHistory(model);
      history.apply([{ op: "remove", target: { block: 0 } }]);
      history.undo(); // model equals original
      ```
    - Files to Create/Edit:
      - `packages/documents/src/parse.ts`, `packages/documents/src/patch.ts`, `packages/documents/src/patch-history.ts`, `packages/documents/src/translate/` (reverse mappers added to existing modules)
      - `packages/documents/src/__tests__/parse.test.ts`, `packages/documents/src/__tests__/patch.test.ts`, `packages/documents/src/__tests__/patch-history.test.ts`
      - `packages/documents/src/index.ts` (exports)
    - References:
      - `prism-documents.md` P3, P5, P6; acceptance "patchDocument with an unknown operation throws; every successful patch output passes validateDocumentModel".
  - Test Cases to Write:
    - `parse.test.ts`: generate→parse round-trip equality per kind (doc/sheet/deck, one format each); non-zip bytes and wrong-kind bytes throw parse-failed; oversized bytes throw cap; external-file fixture (hand-built minimal docx from a golden) reports `fidelity: "partial"` where features drop; redactor hook redacts paragraph and cell text (fixture redactor).
    - `patch.test.ts`: each op happy path; unknown op throws; out-of-bounds block index throws; invalid resulting model throws validation error (op applied but output fails schema); empty patch list returns equal model.
    - `patch-history.test.ts`: apply/undo sequence restores byte-equal (structural) model; undo with empty history throws.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `parseDocument`, `patchDocument`, `createPatchHistory`.
    - Docs pages to create/edit: `docs/documents.md` parse/patch/editing sections — Task 8.
    - `docs/index.md` update: yes — Task 8.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 5: Model-native preview blocks and bounded HTML — request P4
  - Acceptance Criteria:
    - Functional: `renderPreviewBlocks(model, opts?) → PreviewBlock[]` — framework-neutral structured blocks (document outline, bounded sheet grid snapshot, slide list) with per-block row/cell bounds (default 200 rows per block, options to adjust); `renderPreviewHtml(model, opts?) → string` — bounded, sanitized HTML with no `<script>`, no external resources (no external URLs, no iframes); no UI-framework components in the package (adapters later, if ever).
    - Performance: `renderPreviewBlocks` over a 10k-row sheet touches only bounded windows (bounded snapshot per block); HTML output size capped (byte budget, excess truncates with a terminal note block).
    - Code Quality: `PreviewBlock` is a small discriminated union (outline/grid/slide/break kinds) with plain-JSON payloads hosts render natively; HTML renderer builds from blocks (single sanitize point, allow-list escaping — never string-concat raw model text into markup).
    - Security: All text escaped (entity-encode `<>&"'`); attribute allow-list only; the HTML test asserts absence of `<script`, `javascript:`, `http://`, `https://` in output.
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory (bounded page/snapshot precedents in coding-agent read tool paging); `prism-documents.md` P4 + acceptance "renderPreviewHtml output contains no `<script>` and no external URLs".
    - Options Considered:
      - Full HTML document render vs fragment — chosen: fragment (hosts own the shell); sanitize-by-construction (escape-everything renderer with no attribute surface) vs post-hoc sanitizer dep — chosen: sanitize-by-construction (no sanitizer dependency, provable by test).
    - Chosen Approach:
      - `src/preview.ts` (blocks) and `src/preview-html.ts` (blocks → string with a tiny escape helper); both pure, no DOM dependency (string building works in Node and browsers).
    - API Notes and Examples:
      ```ts
      const blocks = renderPreviewBlocks(sheetModel); // [{ type: "grid", sheet: 0, rows: [...≤200], bounds: { fromRow: 0, toRow: 199 } }, ...]
      const html = renderPreviewHtml(sheetModel); // sanitized fragment
      ```
    - Files to Create/Edit:
      - `packages/documents/src/preview.ts`, `packages/documents/src/preview-html.ts`
      - `packages/documents/src/__tests__/preview.test.ts`, `packages/documents/src/__tests__/preview-html.test.ts`
      - `packages/documents/src/index.ts` (exports)
    - References:
      - `prism-documents.md` P4, "Out of scope" (no UI-framework components in core).
  - Test Cases to Write:
    - `preview.test.ts`: 10k-row sheet model yields grid blocks each ≤200 rows with correct bounds and a final truncation block; doc outline lists headings in order; deck lists slides with layouts.
    - `preview-html.test.ts`: output contains no `<script`, no `javascript:`, no external URLs; text with `<img src=x onerror=alert(1)>` renders escaped and inert; byte budget truncates with terminal note.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `renderPreviewBlocks`, `renderPreviewHtml`.
    - Docs pages to create/edit: `docs/documents.md` preview section — Task 8.
    - `docs/index.md` update: yes — Task 8.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 6: Telemetry seam — request P15 (documents portion)
  - Acceptance Criteria:
    - Functional: Dependency-free `DocumentsTelemetry` seam mirroring the `RagTelemetry` shape (span names allow-listed: `documents.generate` / `documents.parse` / `documents.patch` / `documents.preview`), wired into generate/parse/patch/preview call sites; attributes carry kind, format, byte counts, durations — never content bytes or model text; default = noop.
    - Performance: No-op seam adds no measurable overhead (guarded fast path); attribute filtering strips non-`[A-Za-z0-9._-]` keys like `createRagTelemetry`.
    - Code Quality: Seam interface lives in `src/telemetry.ts` with zero imports; otel adaptation stays host-side (documented pattern reference to `createRagTelemetry`).
    - Security: No raw chunk/document text in attributes (explicit test).
  - Approach:
    - Documentation Reviewed:
      - Graft node `packages/observability-opentelemetry/src/rag-telemetry.ts:L35-L88` (`createRagTelemetry` — span allow-list, attribute key regex, value filtering); `packages/rag/src/telemetry.ts` (dependency-free seam side).
    - Options Considered:
      - Direct otel dependency vs seam + host adapter — chosen: seam (request says "optional OpenTelemetry spans"; otel package gains nothing new — hosts already have the adapter pattern).
    - Chosen Approach:
      - Copy the rag seam shape with a documents span-name set; call sites pass redacted attribute objects.
    - API Notes and Examples:
      ```ts
      const telemetry: DocumentsTelemetry | undefined = options.telemetry;
      const span = telemetry?.startSpan("documents.generate", { kind: model.kind, format: "docx" });
      try { /* generate */ } finally { span?.end(); }
      ```
    - Files to Create/Edit:
      - `packages/documents/src/telemetry.ts`, call-site wiring in `generate.ts`/`parse.ts`/`patch.ts`/`preview.ts`
      - `packages/documents/src/__tests__/telemetry.test.ts`
      - `packages/documents/src/index.ts` (export type)
    - References:
      - `prism-documents.md` P15; `docs/observability.md` (instrumentation attach pattern).
  - Test Cases to Write:
    - `telemetry.test.ts`: noop default (no throw without telemetry); fake seam records spans with kind/format/byte attributes and no text attributes for a model containing marker strings (assert marker absent).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional `telemetry` option + exported seam type.
    - Docs pages to create/edit: `docs/documents.md` observability notes — Task 8.
    - `docs/index.md` update: no (covered by the Task 8 entry).
    - Documentation structure reference: prism-wiki.md.

- [x] Task 7: Golden files, round-trip equality spec, and CI Office validation (acceptance)
  - Acceptance Criteria:
    - Functional: `packages/documents/golden/` commits one generated file per format (`golden.docx`, `golden.xlsx`, `golden.pptx`) plus the source models (`golden.doc.model.json` etc.) and a `golden.README.md`; a per-kind equality spec (`src/__tests__/equality.ts`) defines structural equality incl. canonical decimal normalization; a gated CI leg (`test:office`, skipped without `PRISM_TEST_LIBREOFFICE=1`, mirroring the `PRISM_TEST_POSTGRES_URL` pattern) converts each golden through `soffice --headless --convert-to pdf` and asserts exit 0 (no repair prompt proxy); every golden also round-trips through `parseDocument` to an equal model. Word/Excel/PowerPoint opening is recorded once as release evidence (`scripts/release-evidence.json` / changelog note) since Word cannot run in CI.
    - Performance: CI leg bounded (<60 s per format conversion).
    - Code Quality: Golden regeneration is a checked-in script (`src/__tests__/regen-golden.ts` behind a flag) — goldens are reproducible from committed models, not hand-edited binaries.
    - Security: Goldens are inert fixtures in the repo, never executed; conversion leg runs in the CI container sandbox (soffice profile isolation via `-env:UserInstallation` fresh profile per run — documented gotcha).
  - Approach:
    - Documentation Reviewed:
      - LibreOffice headless conversion (`soffice --headless --convert-to pdf --outdir`, profile-lock gotcha requiring a fresh `-env:UserInstallation` per invocation); repo CI gating precedents (`.github/workflows/coding-journey.yml` `PRISM_TEST_*` env, `scripts/require-postgres-url.mjs` fail-closed gate pattern).
    - Options Considered:
      - OOXML schema validation service vs LibreOffice conversion vs both — chosen: LibreOffice conversion + zip/XML well-formedness checks + round-trip identity (repair-prompt proxy; full ISO/IEC 29500 validation is not practical in CI and LibreOffice strictness is the acceptance proxy the request names).
      - Byte-level golden compare — rejected: zip embeds timestamps, byte equality is flaky; model-level equality + committed binary goldens for manual opening is the stable contract.
    - Chosen Approach:
      - Equality helpers live beside tests; CI workflow job installs `libreoffice` apt package, sets `PRISM_TEST_LIBREOFFICE=1`, runs `test:office`.
    - API Notes and Examples:
      ```bash
      soffice --headless -env:UserInstallation=file:///tmp/lo-prism --convert-to pdf --outdir /tmp/out golden.docx
      ```
    - Files to Create/Edit:
      - `packages/documents/golden/{golden.doc.model.json, golden.sheet.model.json, golden.deck.model.json, golden.docx, golden.xlsx, golden.pptx, README.md}`
      - `packages/documents/src/__tests__/equality.ts`, `packages/documents/src/__tests__/golden.test.ts`
      - `packages/documents/package.json` (`test:office` gated script)
      - `.github/workflows/` (extend release/coding-journey workflow with the libreoffice leg — tentative placement; follow existing workflow layout)
    - References:
      - `prism-documents.md` acceptance ("Golden files … open in Word/Excel/PowerPoint and LibreOffice without repair prompts", "generateDocument → parseDocument round-trip … equal model per a per-kind equality spec").
  - Test Cases to Write:
    - `golden.test.ts` (always-on, network-free): each golden parses to a model equal to its committed source model per the equality spec; each golden has PK zip signature.
    - `golden.test.ts` gated leg: LibreOffice converts docx/xlsx/pptx goldens to PDF exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (fixtures/CI only; equality spec is test-internal).
    - Docs pages to create/edit: `docs/documents.md` release-evidence note (Task 8); golden regeneration instructions in `packages/documents/golden/README.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 8: Documentation sweep — `docs/documents.md` + index navigation
  - Acceptance Criteria:
    - Functional: `docs/documents.md` created following `api-page-template.md` (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs), covering the model, generate, parse/patch, preview, redaction, telemetry, caps table, and the decimal fidelity ceiling; `docs/index.md` gains a "Documents, sheets, and diagrams" group with entries for this package (and sibling packages as their plans land); `docs/release-and-install.md` package list + `scripts/package-truth.json` updated.
    - Performance: n/a (docs).
    - Code Quality: Docs build/test (`docs` truth gate) passes; every exported symbol from `src/index.ts` documented.
    - Security: Page documents trust boundaries: untrusted bytes at parse, caps fail-closed, redaction hook, no-network doctrine.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`; `docs/document-reader.md` and `docs/rag.md` as concrete precedents; `scripts/package-truth.mjs` (manifest-derived counts — regenerate).
    - Options Considered:
      - One combined `docs/office.md` for all three packages vs per-package pages — chosen: one page per package (each has a distinct API surface; sibling plans 052/053 add `docs/sheets.md`, `docs/diagrams.md`).
    - Chosen Approach:
      - Single comprehensive page for prism-documents; index group shared by the three sibling plans (first plan creates the group).
    - API Notes and Examples: (page contents mirror Tasks 2–6 examples)
    - Files to Create/Edit:
      - `docs/documents.md` (new), `docs/index.md` (new group + entry), `docs/release-and-install.md` (package list), `scripts/package-truth.json` (regenerated)
      - `packages/documents/README.md` (finalize)
    - References:
      - prism-wiki.md documentation requirements.
  - Test Cases to Write:
    - Docs truth gate (existing `npm test` docs test) covers page linkage — no new tests beyond keeping it green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task is the documentation of it.
    - Docs pages to create/edit: `docs/documents.md`, `docs/index.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — "Documents, sheets, and diagrams" group with the prism-documents entry.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 9: Release cut — request P13 (Decision B initial publication)
  - Acceptance Criteria:
    - Functional: `packages/documents/package.json` at initial `0.3.0` with peer `@arnilo/prism ^0.3.0`, `publishConfig.access: public`, omitted from `@arnilo/prism-all` and every profile (host engines like obscura/computer-use-linux precedent); `CHANGELOG.md` (root) entry documents the new package, the office-open exact pin, and the decimal fidelity ceiling; `npm run sdk:ready`, `npm run release:check -- --allow-dirty --allow-untagged`, and `pack:dry-run` pass; publish via `npm run release:publish` Decision B flow with the new package tagged.
    - Performance: Tarball size check (office-open tree inflates install — record measured size in changelog/evidence; sub-package pinning keeps it minimal).
    - Code Quality: No other package version changes; no internal range edits (nothing depends on the new package).
    - Security: `npm pack --dry-run` output verified to contain only `dist`, goldens excluded or included deliberately (decision recorded — goldens in tarball bloat vs reproducibility; default: exclude via `files` negation).
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` (`validateIndependent`, topological order — new package is a leaf); obscura 0.3.0 initial-cut precedent from `docs/release-and-install.md`.
    - Options Considered:
      - Initial `0.0.1` independent line (wiki/graft precedent) vs `0.3.0` in-window — chosen: `0.3.0` (host engines on the main line like obscura; Synapta pins exact and expects changelog-disciplined pre-1.0 evolution, which the 0.3.x Decision B window already provides).
    - Chosen Approach:
      - Standard changed-package/new-package cut; evidence recorded in `scripts/release-evidence.json`.
    - API Notes and Examples: `npm run release:publish -- --dry-run --allow-dirty --allow-untagged`
    - Files to Create/Edit:
      - `packages/documents/package.json` (version finalize), `CHANGELOG.md` (root), `plans/051-Prism-Documents-Package.md` (checkboxes)
    - References:
      - `prism-documents.md` P13; `docs/release-and-install.md` release workflow.
  - Test Cases to Write:
    - Release gates themselves (release:check / pack:dry-run) are the check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — first npm publication of `@arnilo/prism-documents`.
    - Docs pages to create/edit: `docs/release-and-install.md` package list (Task 8 overlap — finalize here if the cut lands first).
    - `docs/index.md` update: yes — entry already added in Task 8; verify description accuracy.
    - Documentation structure reference: prism-wiki.md.

## Compromises Made

- **Decimal fidelity ceiling**: Sheet numeric cells with `{ type: "decimal", value: string }` preserve exact string notation within the Prism Document Model AST, but OpenXML `.xlsx` containers store cell values numerically as IEEE-754 double precision floats. Excel round-tripping for values exceeding IEEE-754 precision is bounded by the OpenXML container format specification.
- **Exact sub-package pinning**: `@office-open/docx@0.12.3`, `@office-open/xlsx@0.12.3`, and `@office-open/pptx@0.12.3` are pinned exactly to eliminate upstream container layout drift and ensure deterministic binary generation.
- **Preview rendering self-containment**: Preview HTML output is rendered using inline styling and sanitize-by-construction guarantees (escaping entities, eliminating script tags, and disallowing active URL protocols) without external CSS dependencies.
- **Tarball asset diet**: Golden test models, binary fixtures, and source mapping files are excluded from the published `@arnilo/prism-documents` tarball (25.9 kB packed / 117.0 kB unpacked), preserving a lean footprint.

## Further Actions

1. **Sibling Package Coordination**: Implement `@arnilo/prism-sheets` (Plan 052) and `@arnilo/prism-diagrams` (Plan 053) leveraging the same architectural primitives, shared telemetry seams, and documents index section in `docs/index.md`. Priority: Medium.
2. **LibreOffice CI Test Environment**: Configure LibreOffice `soffice` headless conversion testing in dedicated automated merge workflows when runner environments supply the binary. Priority: Low.