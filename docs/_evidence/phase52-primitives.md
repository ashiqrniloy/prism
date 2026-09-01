# Phase 52 (0.3.x) — Primitive Review: Sheets, XLSX/CSV Parsing, Decimal Safety, and Typed Schema Inference Inventory (Task 1)

Task 1 output for `plans/052-Prism-Sheets-Package.md`. Read-only survey of existing Prism primitives, `@office-open/xlsx` 0.12.3 boundaries, and CSV parsing requirements before implementing `@arnilo/prism-sheets` (P7–P9, P13–P15). Line refs verified against the working tree at review time.

**Verdict: Maximum reuse of existing Prism security, caps, error, telemetry, and validation patterns, combined with a dedicated safety-critical decimal pipeline.** `@arnilo/prism-sheets` establishes a strict invariant: **money-like data is always represented as decimal strings and never coerced to IEEE-754 floating-point numbers.** Raw XML `<v>` nodes from XLSX and raw tokens from CSV pass directly into canonical decimal validation without touching `Number()`.

---

## 1. `@office-open/xlsx` 0.12.3 Seams & Raw XML Ingestion

`@office-open/xlsx` version `0.12.3` is pinned as an exact dependency. While `@office-open/xlsx` provides high-level workbook parsing (`parseWorkbook`), its high-level parser coerces numeric cells into JavaScript numbers (`double`), which loses decimal precision for currency amounts. `@arnilo/prism-sheets` consumes the lower-level raw XML parsing seam (`parseXlsx`) to extract exact text nodes from the OpenXML package.

### 1.1 High-Level `parseWorkbook` vs. Low-Level `parseXlsx`

| Seam / Export | Type Signature / Structure | Mechanism & Behavior | Role in `@arnilo/prism-sheets` |
| --- | --- | --- | --- |
| `parseWorkbook` | `(data: DataType) => WorkbookOptions` | High-level DOM parser. Parses worksheets into rows and cell objects with numbers converted to JS `number`. | Used primarily in test assertions and round-trip verification fixtures. Not used on the production parsing path. |
| `parseXlsx` | `(data: DataType) => XlsxDocument` | Low-level archive unpacker. Returns `XlsxDocument` containing parsed OpenXML element trees: `workbook?: Element`, `worksheets: string[]`, `styles?: Element`, `sharedStrings?: Element`. | **Primary production ingestion seam.** Provides direct access to XML elements without float coercion. |
| `XlsxReadContext` | `new XlsxReadContext(xlsx: XlsxDocument)` | Helper managing part relationships and shared string indexing (`context.sharedStrings`, `context.getPart(path)`). | Used to resolve worksheet XML parts and shared string entries across the workbook container. |

### 1.2 OpenXML Cell Element `<c>` & Type Attribute `t` Mapping

In OpenXML spreadsheet ML (`sheet*.xml`), cells are represented by `<c>` elements with optional coordinate `r`, type `t`, style index `s`, and child elements for formula `<f>`, value `<v>`, or inline string `<is>`.

```xml
<!-- Example: Shared String (t="s") -->
<c r="A1" t="s"><v>0</v></c>

<!-- Example: Numeric / Decimal (no t or t="n") -->
<c r="B1"><v>1234.56</v></c>

<!-- Example: Inline String (t="inlineStr") -->
<c r="C1" t="inlineStr"><is><t>Revenue</t></is></c>

<!-- Example: Boolean (t="b") -->
<c r="D1" t="b"><v>1</v></c>

<!-- Example: Formula with cached value -->
<c r="E1"><f>SUM(B1:B10)</f><v>12345.60</v></c>
```

| Type Attribute `t` | Raw Child Node | Cell Content Resolution | Target Value Representation |
| --- | --- | --- | --- |
| `t="s"` (Shared String) | `<v>index</v>` | Look up integer index in `sharedStrings.xml` `<si><t>...</t></si>`. | String (`string`). |
| `t="inlineStr"` | `<is><t>text</t></is>` | Extract text directly from `<is><t>` child element. | String (`string`). |
| `t="str"` | `<v>text</v>` | Extract cached formula string or string literal directly from `<v>`. | String (`string`). |
| `t="b"` (Boolean) | `<v>1\|0\|true\|false</v>` | Parse `1` or `true` as `true`; `0` or `false` as `false`. | Boolean (`boolean`). |
| `t="e"` (Error) | `<v>#VALUE!</v>` | Extract error code string (e.g. `#REF!`, `#VALUE!`, `#N/A`). | String (`string`) flagged with error info. |
| `t="d"` (Date) | `<v>2026-08-31T...</v>` | Extract ISO 8601 date string. | Date / Datetime string. |
| Omitted / `t="n"` (Number) | `<v>raw_number_str</v>` | **Extract raw text string from `<v>` directly.** Do NOT invoke `Number(text)`. Pass to inference engine to determine `decimal`, `integer`, or `number`. | Decimal string (`"1234.56"`), Integer (`1234`), or Number (`1234.56`). |
| Any with `<f>` (Formula) | `<f>formula_text</f>`, `<v>cached_val</v>` | Extract formula string; extract `<v>` as `cachedValue` (if present). **Formula is never evaluated.** | `{ type: "formula", formula: "=...", cachedValue?: string \| number \| boolean \| null }`. |

### 1.3 Styles and Date Format Resolution

When `t` is omitted and the cell contains a numeric serial (e.g. `45200`), the style index attribute `s` references an `<xf>` record in `styles.xml` (`<cellXfs>`).
- The `numFmtId` attribute on the `<xf>` element identifies the number format.
- Built-in ECMA-376 date `numFmtId` ranges (e.g., 14–22, 27–36, 45–47) or custom date formats containing `yy`, `mm`, `dd`, `hh`, `ss` allow detecting date/datetime serials without executing arbitrary format scripts.
- If date detection is uncertain, the inference engine falls back to `number` or `string` with descriptive flags (`flags: ["date-ambiguous"]`).

---

## 2. Decimal-Safe Value Path & Anti-Corruption Invariant

This package represents the **safety-critical data ingestion boundary** for business data and money in Synapta and Prism applications. Synapta strictly requires money to be stored as decimal strings; IEEE-754 floating-point coercion produces irreversible precision loss (e.g. `0.1 + 0.2 !== 0.3`, `1234.56` becoming `1234.5599999999999`).

```
                              ┌───────────────────────────────────┐
                              │  Raw Input (XLSX <v> / CSV token) │
                              └─────────────────┬─────────────────┘
                                                │ Raw string (e.g. "$1,234.56")
                                                ▼
                              ┌───────────────────────────────────┐
                              │     Canonical Decimal Parser      │
                              │  (strip currency, validate signs, │
                              │    check thousand separator shape)│
                              └─────────────────┬─────────────────┘
                                                │ Clean decimal string ("1234.56")
                                                ▼
                    ┌───────────────────────────────────────────────────────┐
                    │               Typed Schema Inference                  │
                    ├───────────────────────────────────────────────────────┤
                    │ • Currency pattern detected ($/€/£/¥/...)  → decimal  │
                    │ • Column name heuristic (*_amount, price)  → decimal  │
                    │ • Mixed precision / inconsistent delimiter → string   │
                    │   with flags: ["numeric-ambiguous"]                   │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
                              ┌───────────────────────────────────┐
                              │  Row Output: { type: "decimal",   │
                              │                value: "1234.56" } │
                              │    *** ZERO FLOAT CONVERSION ***  │
                              └───────────────────────────────────┘
```

### 2.1 The Anti-Corruption Invariant
1. **No Float on Decimal Paths**: At no point from binary/text ingestion to final row output is `Number()`, `parseFloat()`, or unary `+` called on values inferred as `decimal`.
2. **Greppable Invariant Guard**: Task 4 establishes an automated source-scan unit test verifying that `Number(`, `parseFloat(`, and unary `+` do not occur on value transformation paths in `packages/sheets/src/{xlsx,csv,decimal,inference}.ts`.
3. **Canonical Normalization**:
   - Currency symbols (`$`, `€`, `£`, `¥`, `₹`, `元`, etc.) and ISO currency codes (`USD`, `EUR`, etc.) are stripped.
   - Thousands separators (`,` in US/UK `1,234.56`, `.` in EU `1.234,56`) are validated for standard 3-digit grouping before removal.
   - Negative amounts in standard format (`-1234.56`) or accounting parenthesis format (`(1,234.56)` -> `-1234.56`) are canonically converted to `-1234.56`.
   - Result must match `/^-?\d+(\.\d+)?$/`. If not valid, it is treated as `string` with `flags: ["numeric-ambiguous"]`.
4. **Inference Window & Full-Parse Validation**:
   - Inference scans a bounded window (default: first 500 non-empty rows) to establish column types.
   - The entire parse then validates all subsequent rows against the inferred schema.
   - Violations (type mismatches) do NOT trigger silent coercion; they are reported in the schema report as `warnings` with `mismatchCount` and a capped list of offending row indices (default: 20).

---

## 3. Cap Validation & Error Hierarchy Primitives

The caps and error management patterns are inherited from `@arnilo/prism-document-reader` and `@arnilo/prism-rag`.

### 3.1 Cap Validation (`@arnilo/prism-document-reader`)

`packages/document-reader/src/index.ts:L26-L38` establishes the standard cap resolution and validation mechanism:
- `validateCap(name, value, hardLimit)` enforces positive integer bounds `(0, hardLimit]`.
- Input limits are checked upfront before processing.

| Cap Constant | Default Value | Hard Ceiling | Purpose |
| --- | --- | --- | --- |
| `DEFAULT_MAX_SHEET_BYTES` | 32 MiB (`33_554_432`) | 512 MiB (`536_870_912`) | Rejects oversized XLSX or CSV buffers at entry. |
| `DEFAULT_MAX_SHEETS` | 100 | 1,000 | Limits number of worksheets parsed in a single workbook. |
| `DEFAULT_MAX_ROWS` | 100,000 | 1,000,000 | Limits maximum row count across parsed sheets / CSV. |
| `DEFAULT_MAX_COLUMNS` | 1,000 | 16,384 | Limits maximum column count (Excel maximum is 16,384). |
| `DEFAULT_INFERENCE_WINDOW_ROWS` | 500 | 5,000 | Bounded sample size for column schema type inference. |
| `DEFAULT_MAX_WARNINGS` | 100 | 1,000 | Caps total collected inference and dialect warnings. |

### 3.2 ZIP Signature Container Gating

Following `packages/document-reader/src/index.ts:L123-L129`, input bytes for `parseWorkbook` must be verified for the standard PKZIP local file header magic bytes (`0x50, 0x4b, 0x03, 0x04` / `PK\x03\x04`) before any archive unpacking or XML parsing is attempted:
- File extensions are never trusted.
- Non-ZIP inputs immediately throw `SheetsFormatError` (`ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT`) without allocating decompression buffers.

### 3.3 Error Hierarchy (`@arnilo/prism-rag` & `@arnilo/prism-documents`)

Following `packages/rag/src/errors.ts:L1-L37`, `@arnilo/prism-sheets` establishes a clean error taxonomy in `src/errors.ts`:

| Error Class | Stable Error Code | Trigger Condition |
| --- | --- | --- |
| `SheetsError` | `ERR_PRISM_SHEETS` | Base class for all sheets-related exceptions. |
| `SheetsCapError` | `ERR_PRISM_SHEETS_CAP` | Input bytes, sheets, rows, or columns exceed configured caps (e.g. 2 GiB or >5M rows). |
| `SheetsValidationError` | `ERR_PRISM_SHEETS_VALIDATION` | Invalid options, negative caps, or malformed schema constraints. |
| `SheetsFormatError` | `ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT` | Non-ZIP magic header for XLSX, invalid UTF-16 encoding for CSV. |
| `SheetsParseError` | `ERR_PRISM_SHEETS_PARSE_FAILED` | Corrupted archive, unparseable XML structure, or unrecoverable CSV token error. |

All error constructors sanitize diagnostic messages and **never leak raw cell values or confidential user data** into error strings.

---

## 4. CSV Parsing & Dialect Sniffing Precedents

A survey of existing in-repo CSV code was conducted to determine reusability.

### 4.1 In-Repo CSV Code Survey (`src/cli-runner.ts`)
- `src/cli-runner.ts:L286-L295` defines `parseKinds(csv: string, flag: string)`:
  ```ts
  function parseKinds(csv: string, flag: string): readonly ContributionFileKind[] {
    const kinds = csv.split(",").map((k) => k.trim()).filter(Boolean);
    ...
  }
  ```
- **Finding**: This is a simple CLI flag splitter for comma-delimited strings (`--discover-kinds`). It lacks RFC 4180 support, quote handling, escaping, newline preservation, delimiter detection, and streaming bounds.
- **Verdict**: There is **no reusable CSV parser** in the existing codebase. `@arnilo/prism-sheets` requires a dedicated implementation.

### 4.2 Hand-Rolled Bounded RFC 4180 State Machine

External CSV dependencies (e.g. `papaparse`) are rejected in alignment with Prism's dependency-minimal doctrine and the need for zero-copy byte cap enforcement. `packages/sheets/src/csv.ts` implements a self-contained, deterministic finite state machine (~200 LOC):

```
                        ┌──────────────┐
                        │  fieldStart  │◄─────────────────┐
                        └──────┬───────┘                  │
                   "           │          delimiter / \n  │
            ┌──────────────────┴──────────────────┐       │
            ▼                                     ▼       │
   ┌─────────────────┐                   ┌────────────────┐
   │  inQuotedField  │                   │    inField     │
   └────────┬────────┘                   └────────┬───────┘
            │ "                                   │ delimiter / \n
            ▼                                     │
   ┌─────────────────┐                            │
   │  quoteInQuoted  ├────────────────────────────┤
   └────────┬────────┘ (non-quote: end of field)  │
            │ " (escaped quote "")                │
            ▼                                     │
    (stay in quoted)                              ▼
                                           ┌──────────────┐
                                           │    rowEnd    │
                                           └──────────────┘
```

#### Sniffing & Dialect Rules:
1. **UTF-8 with BOM Support**: Detects and strips the 3-byte UTF-8 Byte Order Mark (`0xEF, 0xBB, 0xBF`). UTF-16 BOMs are explicitly rejected with `SheetsFormatError`.
2. **Delimiter Scoring**: Evaluates candidate delimiters (`,`, `;`, `\t`, `|`) across the sniff window (default: first 4 KiB or 50 lines) by counting occurrences outside quoted regions and checking row length consistency.
3. **Quoting and Escapes**: RFC 4180 doubled quotes (`""` inside `"..."`) and standard backslash escapes are handled deterministically.
4. **Sniff Once, Validate Throughout**: The sniffed dialect is locked for the file. If row field counts or quote rules break mid-stream, a warning is recorded with `mismatchCount` rather than re-sniffing per row.

---

## 5. Telemetry Seam & Observability Pattern

Following `packages/rag/src/telemetry.ts:L1-L19` and `packages/documents/src/telemetry.ts:L1-L37`, `@arnilo/prism-sheets` exports a zero-dependency telemetry seam in `src/telemetry.ts`.

### 5.1 Telemetry Interface Definition

```ts
export type SheetsTelemetryAttributeValue = string | number | boolean;

export interface SheetsTelemetrySpan {
  setAttribute(name: string, value: SheetsTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, SheetsTelemetryAttributeValue>>): void;
  recordError(): void;
  end(): void;
}

export interface SheetsTelemetry {
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, SheetsTelemetryAttributeValue>>,
    parent?: SheetsTelemetrySpan,
  ): SheetsTelemetrySpan;
}
```

### 5.2 Allow-Listed Spans and Attributes

When integrated with `@arnilo/prism-observability-opentelemetry`:
- **Allowed Spans**: `sheets.parse`, `sheets.infer`.
- **Allowed Attribute Keys**: `sheets.format` (`xlsx` | `csv`), `sheets.bytes`, `sheets.rows`, `sheets.columns`, `sheets.sheetCount`, `sheets.durationMs`, `sheets.warningCount`.
- **Data Privacy Guarantee**: Telemetry spans and events **never record cell text, column names, formula strings, or raw payload bytes**.

---

## 6. P7–P9 Comprehensive Primitive Mapping

| Requirement | Scope & Criteria | Reused Prism Primitives | New Sheets Primitives (`packages/sheets/src/`) |
| --- | --- | --- | --- |
| **P7: XLSX Parse** | `parseWorkbook(bytes, { caps }) → { sheets: [{ name, rows, schema }] }`, formula cells as `{ formula, cachedValue? }`, ZIP signature gating, cap enforcement. | `validateCap` (`document-reader`), ZIP magic byte detection (`document-reader`). | • `parseWorkbook` orchestrator (`src/index.ts`, `src/xlsx.ts`)<br>• OpenXML raw element parser (`src/xlsx.ts`)<br>• Sheet caps resolver `resolveSheetsCaps` (`src/caps.ts`)<br>• Formula & cell mapper (`src/xlsx.ts`) |
| **P8: CSV Parse** | `parseCsv(input, { caps }) → { rows, schema, dialect }`, RFC 4180 + variants, delimiter sniffing (`,`, `;`, `\t`, `\|`), BOM handling, cap refusal. | Byte length cap validation (`caps.ts`), UTF-8 buffer decoding. | • `parseCsv` orchestrator (`src/index.ts`, `src/csv.ts`)<br>• RFC 4180 FSM parser (`src/csv.ts`)<br>• Dialect sniffer (`src/csv.ts`) |
| **P9: Typed Schema Inference** | Column types `string \| integer \| number \| decimal \| date \| datetime \| boolean`, money heuristics → `decimal` string values, `numeric-ambiguous` fallback, bounded window + full validation. | Bounded iteration patterns, table-driven validation. | • Schema inference engine `inferSchema` (`src/inference.ts`)<br>• Canonical decimal validator & normalizer (`src/decimal.ts`)<br>• Date/datetime detector (`src/inference.ts`)<br>• Schema validation report builder (`src/inference.ts`) |
| **P13–P15: Cross-Package** | Decision B independent publication (0.3.0, peer `@arnilo/prism ^0.3.0`), zero I/O doctrine, dependency-free telemetry seam. | `RagTelemetry` seam pattern (`rag/src/telemetry.ts`), package build scripts (`scripts/with-build-lock.mjs`). | • `SheetsTelemetry` interface (`src/telemetry.ts`)<br>• Package manifest `packages/sheets/package.json`<br>• Error hierarchy `SheetsError` (`src/errors.ts`) |

---

## 7. Security, Trust Boundary & Invariant Summary

1. **Untrusted Input Boundary**:
   - All input buffers (XLSX, CSV) are treated as hostile and untrusted.
   - Magic bytes (`PK\x03\x04`) are checked before any XLSX decompression.
   - UTF-16 input for CSV is rejected cleanly.
2. **Fail-Closed Cap Enforcement**:
   - Byte caps (`maxBytes`), row caps (`maxRows`), column caps (`maxColumns`), and sheet caps (`maxSheets`) are verified before processing.
   - Violations immediately throw `SheetsCapError` (`ERR_PRISM_SHEETS_CAP`) without producing partial row allocations or degrading service.
3. **No Formula Execution**:
   - Formulas in spreadsheet cells are treated strictly as opaque text strings (`{ formula: "=SUM(A1:B1)", cachedValue: "100" }`). No formula engine is included or invoked.
4. **Decimal Anti-Corruption**:
   - Currency and money-like columns are mapped to strings and never coerced to floats.
   - Ambiguous numeric representations fallback to `string` with `flags: ["numeric-ambiguous"]`.
5. **Zero I/O Doctrine**:
   - Zero filesystem access (`fs`), zero child process execution, zero network sockets (`http`/`fetch`), zero `process.env` access.
   - All parsing and schema inference operates purely in-memory on caller-provided bytes and strings.

---

## 8. Architectural Decisions Locked by This Review

1. **Exact Pinning of `@office-open/xlsx@0.12.3`**: Confined strictly to `packages/sheets/src/xlsx.ts` to access low-level raw XML parsing (`parseXlsx`) for exact `<v>` text extraction.
2. **Hand-Rolled RFC 4180 CSV Engine**: Self-contained finite state machine in `packages/sheets/src/csv.ts` with prefix dialect sniffing and full-parse dialect consistency validation.
3. **String-Only Decimal Value Path**: Guaranteed by design and verified by static source-scan unit testing against floating-point coercion functions.
4. **Windowed Inference with Full Validation**: Samples default 500 rows for high-throughput type deduction while verifying the entire document to catch and report tail type mismatches as structured warnings.
5. **Shared Telemetry Seam**: Pure dependency-free `SheetsTelemetry` interface in `packages/sheets/src/telemetry.ts` adhering to the standard Prism observability pattern.
