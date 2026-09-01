# Phase 51 (0.3.x) — Primitive Review: Documents, Office, Hash, Redaction, and Telemetry Inventory (Task 1)

Task 1 output for `plans/051-Prism-Documents-Package.md`. Read-only survey of existing Prism primitives and `office-open` 0.12.3 boundaries before implementing `@arnilo/prism-documents` (P1–P6, P13–P15). Line refs verified against the working tree at review time.

**Verdict: Maximum reuse of existing Prism security, caps, error, telemetry, and validation patterns.** The `@arnilo/prism-documents` package introduces engine-independent document models and validation schemas while strictly confining all `office-open` dependencies to internal translation modules (`src/translate/*.ts`). No filesystem, network, or environment access is introduced.

---

## 1. Cap Validation & Redaction Primitives (`@arnilo/prism-document-reader`)

The cap validation, peer loading, and redaction patterns in `@arnilo/prism-document-reader` serve as the direct template for `@arnilo/prism-documents`.

| Primitive / Pattern | Location | Role & Mechanism | Application in `@arnilo/prism-documents` |
| --- | --- | --- | --- |
| `validateCap` | `packages/document-reader/src/index.ts:L33-L38` | Enforces positive integer in `(0, hardCap]`; throws `RangeError` with formatted message. | Reused in `src/caps.ts` as `validateDocumentsCap` for input byte caps, element/block caps, cell limits, and slide limits. |
| Cap Constants Pattern (`DEFAULT_*`, `HARD_*`) | `packages/document-reader/src/index.ts:L26-L31` | Defines module-local safe defaults and immovable hard ceilings (e.g. `DEFAULT_MAX_DOCUMENT_BYTES = 32 MiB`, `HARD_MAX_DOCUMENT_BYTES = 512 MiB`). | Define `DEFAULT_MAX_DOCUMENT_BYTES` (32 MiB), `HARD_MAX_DOCUMENT_BYTES` (512 MiB), `DEFAULT_MAX_BLOCKS` (10,000), `HARD_MAX_BLOCKS` (50,000), `DEFAULT_MAX_CELLS` (500,000), `HARD_MAX_CELLS` (2,000,000), `DEFAULT_MAX_SLIDES` (500), `HARD_MAX_SLIDES` (2,000). |
| `truncateToBytes` | `packages/document-reader/src/index.ts:L41-L45` | Slices UTF-8 strings at byte boundaries using `Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")`. | Reused in `renderPreviewHtml` and preview block formatting to ensure text chunks never exceed byte budgets. |
| Optional-Peer Probing / `loadPeer` | `packages/document-reader/src/index.ts:L76-L88` | Probes optional peer packages dynamically at creation and fails closed with an actionable error if missing. | Not required for `@office-open/*` since they are declared as exact pinned dependencies (`0.12.3`) of `@arnilo/prism-documents`, but the fail-closed factory validation pattern is preserved. |
| Magic Byte / Container Detection | `packages/document-reader/src/index.ts:L123-L129` | Verifies ZIP local header signature `PK\x03\x04` (`0x50, 0x4b, 0x03, 0x04`) and part markers before parsing. | Reused in `src/parse.ts` as the initial gate to reject non-OOXML/non-ZIP buffers with `ERR_PRISM_DOCUMENTS_PARSE_FAILED` before parsing. |
| `SecretRedactor` Seam | `packages/document-reader/src/index.ts:L73, L172` | Accepts optional `SecretRedactor` from `@arnilo/prism` and applies `redactor.redact(text)` at the parse boundary before returning. | Reused in `parseDocument(bytes, { kind, redactor })`: redacts all extracted text strings (headings, paragraphs, table cells, slide notes) at the return boundary. |

---

## 2. Error Hierarchy & Code Patterns (`@arnilo/prism-rag`)

Prism packages maintain structured error hierarchies where every error class has a unique, stable `code: string` matching `ERR_PRISM_<PACKAGE>_<REASON>`.

| Primitive / Pattern | Location | Role & Mechanism | Application in `@arnilo/prism-documents` |
| --- | --- | --- | --- |
| `RagError` Base Class | `packages/rag/src/errors.ts:L1-L9` | Base class extending `Error`, setting `this.name = "RagError"` and `this.code = code` (defaulting to `"ERR_PRISM_RAG"`). | Scaffold `DocumentsError` (`ERR_PRISM_DOCUMENTS`) in `packages/documents/src/errors.ts`. |
| Specialized Subclasses | `packages/rag/src/errors.ts:L11-L37` | Concrete subclasses with hardcoded error codes (`ERR_PRISM_RAG_VALIDATION`, `ERR_PRISM_RAG_LIMIT`, `ERR_PRISM_RAG_SCOPE`, `ERR_PRISM_RAG_ABORTED`). | Define P6 error namespace: <br>• `DocumentsCapError` (`ERR_PRISM_DOCUMENTS_CAP`)<br>• `DocumentsValidationError` (`ERR_PRISM_DOCUMENTS_INVALID_MODEL`)<br>• `DocumentsFormatError` (`ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT`)<br>• `DocumentsParseError` (`ERR_PRISM_DOCUMENTS_PARSE_FAILED`) |
| No-Leak Error Construction | `packages/rag/src/errors.ts` | Error messages describe the structural constraint violated without leaking raw document text or payload values. | All `DocumentsError` instances sanitize diagnostic strings and omit raw model payload text. |

---

## 3. Content Hashing & Canonical Serialization Precedents

Deterministic hashing and canonical serialization are established across several Prism packages.

| Primitive / Pattern | Location | Role & Mechanism | Application in `@arnilo/prism-documents` |
| --- | --- | --- | --- |
| `isValidContentHash` | `packages/rag/src/hash.ts:L6-L8` | Validates lowercase hex digest format (`/^[0-9a-f]{32,128}$/`). | Reused in document metadata and patch validation to verify host-provided hashes. |
| `sha256Hex` / `sha256` | `packages/coding-agent/src/artifacts.ts:L13-L15`, `packages/policy/src/audit-export.ts:L187-L193` | Computes SHA-256 hex digest using `createHash("sha256").update(bytes).digest("hex")`. | Used in `generateDocument` to compute `contentHash` over generated OOXML bytes. |
| `canonicalValue` / `canonicalJson` | `packages/policy/src/canonical.ts:L28-L69`, `packages/enterprise-postgres/src/erp-messaging.ts:L400-L409` | Deterministically serializes JSON objects with sorted keys, safe finite numbers, and cycle detection. | Used in test equality assertions (`src/__tests__/equality.ts`) and patch-history state verification. |

---

## 4. Telemetry Seam & OpenTelemetry Adapter Patterns

Prism packages separate the telemetry definition (zero-dependency seam in the domain package) from the telemetry instrumentation (OpenTelemetry adapter in `@arnilo/prism-observability-opentelemetry`).

| Primitive / Pattern | Location | Role & Mechanism | Application in `@arnilo/prism-documents` |
| --- | --- | --- | --- |
| `RagTelemetry` / `RagTelemetrySpan` | `packages/rag/src/telemetry.ts:L1-L19` | Dependency-free interface: `startSpan(name, attributes?, parent?)`, `setAttribute(k, v)`, `addEvent(name, attrs)`, `recordError()`, `end()`. | Define `DocumentsTelemetry` and `DocumentsTelemetrySpan` in `packages/documents/src/telemetry.ts` with zero external imports. |
| Guarded Optional Telemetry Call-Sites | `packages/rag/src/retrieve.ts:L24-L32` | Call-sites use optional chaining (`options.telemetry?.startSpan(...)`), resulting in zero runtime overhead when omitted. | Wire optional `telemetry` in `generateDocument`, `parseDocument`, `patchDocument`, and `renderPreviewBlocks`. |
| Span Allow-List & Attribute Sanitization | `packages/observability-opentelemetry/src/rag-telemetry.ts:L15-L29, L40-L51` | Limits span names to an explicit `Set` (`SPAN_NAMES`) and attributes to regex `/^documents\.[a-z0-9_.]+$/`. Values must be primitive (`string \| number \| boolean`). | Allow-list spans: `documents.generate`, `documents.parse`, `documents.patch`, `documents.preview`. Record attributes: `kind`, `format`, `byteCount`, `blockCount`, `durationMs`. **Never record document text, cell values, or raw bytes.** |

---

## 5. JSON Schema Draft-07 & Ajv Validation Patterns

`@arnilo/prism-tool-validator-json-schema` provides established patterns for secure draft-07 JSON Schema compilation and validation via Ajv.

| Primitive / Pattern | Location | Role & Mechanism | Application in `@arnilo/prism-documents` |
| --- | --- | --- | --- |
| Strict Ajv Configuration | `packages/tool-validator-json-schema/src/json-schema.ts:L208` | `new Ajv({ strict: true, allErrors: true, validateSchema: true, allowUnionTypes: true, addUsedSchema: false })`. | Used in `src/model-schema.ts` for schema validation and compiling model validators. |
| Prototype Pollution Guards | `packages/tool-validator-json-schema/src/json-schema.ts:L105-L107, L153` | `isSafeJsonKey(key)` explicitly forbids `__proto__`, `prototype`, and `constructor`. | Applied to model schema definitions and model validation inputs. |
| Schema Slicing Pattern | `office-open/schemas` / `prism-documents.md` P1 | Serves the dependency closure of selected schema definitions rather than the full document schema. | `documentModelSchema(kind, slice?)` extracts target definition nodes and resolves local `$ref` dependencies to produce compact draft-07 schemas for LLM prompts. |
| Schema Compilation Caching | `packages/tool-validator-json-schema/src/json-schema.ts:L209-L235` | Compiles schemas once and caches `ValidateFunction` instances in memory. | Pre-compile or lazily compile and cache validators per document kind (`doc`, `sheet`, `deck`). |

---

## 6. `office-open` 0.12.3 API Surface & Translation Boundary Architecture

To prevent third-party library leakage and preserve Prism's engine-independent architecture, `office-open` sub-packages are isolated exclusively within `packages/documents/src/translate/`.

### 6.1 Dependency Strategy
- **Sub-Packages Used**: `@office-open/docx@0.12.3`, `@office-open/xlsx@0.12.3`, `@office-open/pptx@0.12.3`.
- **Reasoning**: The root `office-open` umbrella package bundles the `citty` CLI framework and AI-SDK tool wrappers. Pinned sub-packages keep the bundle minimal, avoid CLI bloat, and isolate exact dependencies.

### 6.2 Target API Surface
1. **Word (`@office-open/docx`)**:
   - `generateDocument(options)`: Synchronous/in-memory generation producing `Uint8Array` / `Buffer`.
   - `parseDocument(buffer)`: Extracts document sections, headings, paragraphs, runs, and tables.
   - `patchDocument(...)`: Placeholder-based byte patching (reserved for optional template seam).
2. **Excel (`@office-open/xlsx`)**:
   - `generateWorkbook(options)`: Generates XLSX workbook from structured sheets, rows, and cells.
   - `parseWorkbook(buffer)`: Parses worksheets, shared strings, and cell values.
   - `parseXlsx(buffer)`: Raw XML parsing of workbook parts (`workbook.xml`, `sheet*.xml`, `styles.xml`, `sharedStrings.xml`) to access exact `<v>` node strings without IEEE-754 double coercion.
3. **PowerPoint (`@office-open/pptx`)**:
   - `generatePresentation(options)`: Generates PPTX presentation from slides, shapes, text frames, and layouts.
   - `parsePresentation(buffer)`: Extracts slides, titles, bullet lists, notes, and shape dimensions.

### 6.3 Translation Boundary Isolation
```
                     ┌───────────────────────────────┐
                     │   Host Application / Caller   │
                     └───────────────┬───────────────┘
                                     │ DocumentModel (plain JSON)
                                     ▼
                     ┌───────────────────────────────┐
                     │   @arnilo/prism-documents     │
                     │  (types, schemas, validation) │
                     └───────────────┬───────────────┘
                                     │ Typed DocumentModel
                                     ▼
         ┌───────────────────────────────────────────────────────┐
         │       Translation Boundary: src/translate/            │
         │  (ONLY modules allowed to import @office-open/*)      │
         ├───────────────────┬───────────────────┬───────────────┤
         │ docx.ts           │ xlsx.ts           │ pptx.ts       │
         │ docModelToDocx    │ sheetModelToXlsx  │ deckModelToPpt│
         │ docxToDocModel    │ xlsxToSheetModel  │ pptToDeckModel│
         └─────────┬─────────┴─────────┬─────────┴───────┬───────┘
                   │                   │                 │
                   ▼                   ▼                 ▼
          @office-open/docx   @office-open/xlsx   @office-open/pptx
```

---

## 7. P1–P6 Comprehensive Mapping

| Item | Request Scope | Reused Prism Primitives | New Generic Primitive Needed |
| --- | --- | --- | --- |
| **P1: Document Model & Schema** | Discriminated union `DocumentModel = DocModel \| SheetModel \| DeckModel` (`kind`, `modelVersion`), plain JSON, draft-07 schemas with on-demand slicing. | Ajv compilation pattern, prototype pollution guards (`tool-validator-json-schema`), bounds resolution. | • `DocumentModel`, `DocModel`, `SheetModel`, `DeckModel` types (`src/types.ts`)<br>• Draft-07 schemas per kind with `$defs` (`src/model-schema.ts`)<br>• `validateDocumentModel(model)`<br>• `documentModelSchema(kind, slice?)` with closure slicing |
| **P2: Generate** | `generateDocument(model, { format }) → { bytes, contentHash }`, byte/element caps, in-memory only. | Cap validation (`document-reader`), SHA-256 hash helper (`artifacts.ts`, `audit-export.ts`). | • `generateDocument` orchestrator (`src/generate.ts`)<br>• Caps validator `validateDocumentsCaps` (`src/caps.ts`)<br>• Forward translators `docModelToDocxOptions`, `sheetModelToWorkbookOptions`, `deckModelToPresentationOptions` (`src/translate/*.ts`) |
| **P3: Parse & Patch Round-Trip** | `parseDocument(bytes, { kind, caps }) → model`, ZIP-signature check, round-trip fidelity, `patchDocument(model, patch[]) → model`. | ZIP magic byte detection (`document-reader`), `SecretRedactor` hook (`document-reader`), canonical JSON serialization (`policy`). | • `parseDocument` parser with ZIP magic validation (`src/parse.ts`)<br>• Reverse translators `docxToDocModel`, `xlsxToSheetModel`, `pptxToDeckModel` with `fidelity: "full" \| "partial"` (`src/translate/*.ts`)<br>• Typed `DocumentPatch` ops (`set`, `insert`, `remove`, `move`) and `patchDocument` engine (`src/patch.ts`) |
| **P4: Preview Blocks & HTML** | `renderPreviewBlocks(model, opts) → PreviewBlock[]` (bounded grid ≤200 rows), `renderPreviewHtml(model, opts) → string` (sanitized, script-free). | `truncateToBytes` (`document-reader`), HTML entity escaping helper. | • `renderPreviewBlocks` structuring outlines, bounded grid blocks, slide overviews (`src/preview.ts`)<br>• `renderPreviewHtml` sanitizing HTML fragment renderer (`src/preview-html.ts`) |
| **P5: Editing Contract & History** | `createPatchHistory(model)` with `apply(patch)` / `undo()` stack. | Model validation (`validateDocumentModel`). | • `createPatchHistory` history helper with undo/redo stack (`src/patch-history.ts`) |
| **P6: Fail-Closed & Redaction** | Error namespace `ERR_PRISM_DOCUMENTS_*`, parse-boundary `SecretRedactor` hook. | `RagError` error hierarchy (`packages/rag/src/errors.ts`), `SecretRedactor` application (`document-reader`). | • `DocumentsError`, `DocumentsCapError`, `DocumentsValidationError`, `DocumentsFormatError`, `DocumentsParseError` (`src/errors.ts`)<br>• Redaction traversal over extracted strings at parse boundary |
| **P13–P15: Cross-Package** | Decision B independent publication, no-network/storage doctrine, OpenTelemetry seam. | Decision B manifest conventions (`packages/obscura`), `RagTelemetry` seam shape (`packages/rag/src/telemetry.ts`). | • Package scaffold `packages/documents/package.json` (0.3.0, peer `@arnilo/prism ^0.3.0`)<br>• `DocumentsTelemetry` interface (`src/telemetry.ts`) |

---

## 8. Security, Caps, Redaction, and Fail-Closed Enforcement Summary

1. **Trust Boundary at Input**:
   - Every input model is validated through `validateDocumentModel` (via Ajv draft-07 schemas) before entering generators, patchers, or preview renderers.
   - Every input binary buffer is verified for standard ZIP container signature `PK\x03\x04` before invoking format parsers.
2. **Cap Enforcement Before Execution**:
   - Caps (file bytes, total blocks, table cells, slide counts) are enforced before memory-intensive translations occur.
   - Cap violations immediately throw `DocumentsCapError` (`ERR_PRISM_DOCUMENTS_CAP`) with **zero partial bytes emitted**.
3. **Strict Redaction Seam**:
   - `SecretRedactor` hook runs at the parse boundary across all extracted text runs, headings, cells, and notes before returning the `DocumentModel`.
4. **Zero I/O Doctrine**:
   - No filesystem access (`fs`), no child process spawning, no network sockets (`http`/`fetch`), no `process.env` reads.
   - Images in document models accept inline bytes (`Uint8Array` or base64) or opaque identifiers; host applications resolve and supply image bytes prior to calling `generateDocument`.
5. **Sanitization by Construction in HTML Previews**:
   - `renderPreviewHtml` strictly entity-encodes all text (`&`, `<`, `>`, `"`, `'`) and generates inert HTML fragments.
   - Script tags, external CSS links, iframes, and external `http://`/`https://` URLs are completely prohibited and tested for absence.

---

## 9. Architectural Decisions Locked by This Review

1. **Exact Sub-Package Pinning**: Depend directly on `@office-open/docx@0.12.3`, `@office-open/xlsx@0.12.3`, and `@office-open/pptx@0.12.3` in `packages/documents/package.json`, omitting the root `office-open` umbrella package.
2. **Strict Boundary Isolation**: `@office-open/*` imports are confined strictly to `packages/documents/src/translate/`. All other modules operate purely on `DocumentModel` and TypeScript contracts.
3. **Draft-07 JSON Schema as Source of Truth**: Hand-written draft-07 schemas with `$defs` ensure clean LLM context slicing via `documentModelSchema(kind, slice?)`.
4. **Decimal Fidelity Ceiling & Raw XML Ingestion**: XLSX numbers in Excel are IEEE-754 floats. The Prism sheet model stores decimal strings; parse uses raw XML extraction (`parseXlsx`) to read exact `<v>` text representation, and test equality normalizes decimal strings canonically.
5. **No-op Telemetry Seam**: `DocumentsTelemetry` mirrors `RagTelemetry` as a pure, dependency-free interface, allowing hosts to bind OpenTelemetry without runtime cost when omitted.
