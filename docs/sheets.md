# Spreadsheets, CSV parsing, and typed schema inference (`@arnilo/prism-office/sheets`)

## What it does

The `@arnilo/prism-office/sheets` package provides fail-closed, high-fidelity spreadsheet (XLSX) and delimiter-separated (CSV/TSV/PSV) data ingestion with automatic dialect sniffing, typed column schema inference, and **strict financial decimal safety**.

### Headline Guarantee: Strict Financial Decimal Safety

> [!IMPORTANT]
> **Zero Float Coercion on Decimal Paths**:
> In financial and enterprise data processing, floating-point rounding errors (IEEE-754 `double`) silently distort monetary totals, balance ledgers, and transaction reconciliations.
>
> In `@arnilo/prism-office/sheets`:
> - Money-like and decimal values are **never converted to JavaScript numbers (`Number()`, `parseFloat()`, or unary `+`)**.
> - All decimal and currency values are parsed, normalized, and emitted as exact canonical decimal strings: `{ type: "decimal", value: "1234.56" }`.
> - Currency markers (`$`, `€`, `£`, `¥`, `₹`, `CHF`, `USD`, `EUR`, etc.) and accounting parentheses `($1,234.56)` are normalized safely into canonical strings (`"-1234.56"`).
> - Ambiguous numbers (e.g. scientific notation `1.23e5` or inconsistent locale separators) are preserved as raw strings with `flags: ["numeric-ambiguous"]` rather than guessed.
> - An automated source-scan test in the regression suite enforces that no floating-point conversions exist on decimal paths across the codebase.

### Core Capabilities

- **Pure In-Memory Operation**: Accepts `Uint8Array` binary archives or `string | Uint8Array` CSV text. Zero filesystem access, zero network I/O, zero `process.env` lookups, and zero background worker threads.
- **Fail-Closed Container Gating**: XLSX archives must begin with the standard ZIP container magic signature (`PK\x03\x04`). CSV inputs support UTF-8 (with automatic BOM stripping); UTF-16 encoded buffers are refused fail-closed with `ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT`.
- **Automatic CSV Dialect Sniffing**: Analyzes the first 4 KiB / 50 lines to detect candidate delimiters (`,`, `;`, `\t`, `|`) using variance-based scoring outside quoted regions, correctly distinguishing delimiters from commas within quoted addresses or company names.
- **RFC 4180 State Machine**: Handles embedded newlines in quoted fields, doubled-quote escaping (`""`), and CRLF / LF line endings in a single, non-backtracking linear pass (<60 ms for 1 MB CSVs).
- **Read-Only Formula Preservation**: OpenXML formula cells are extracted as `{ type: "formula", formula: "=SUM(A1:A10)", cachedValue: "100" }` and are **never evaluated or executed**.
- **Bounded Sampling Window + Full Validation**: Infers column types across an initial window (default 500 rows) and validates all subsequent records against the inferred schema, reporting structured `type-mismatch` warnings without silent coercion.
- **Privacy-Guaranteed Telemetry Seam**: Optional, dependency-free `SheetsTelemetry` hook emits `sheets.parse` spans carrying byte, row, column, and duration metrics with zero cell text or confidential payload leakage.

## When to use it

Use `@arnilo/prism-office/sheets` when autonomous agents, data pipelines, or enterprise workflows need to:
1. Ingest untrusted customer XLSX or CSV files with strict, unbypassable byte, row, column, and sheet caps.
2. Parse tabular financial records, invoices, ledgers, or pricing sheets with mathematical decimal precision guarantees.
3. Automatically determine CSV delimiters, quotes, and headers without manual dialect configuration.
4. Extract structural column schemas (`name`, `type`, `nullRate`, `sample`, `flags`) for automated data cataloging, SQL generation, or tool routing.

Do **not** use this package for interactive spreadsheet calculation/formula engines, macro execution, chart generation, or real-time collaborative editing.

## Inputs / request

### Primary Parsing Functions

| Function | Signature | Description |
| --- | --- | --- |
| `parseWorkbook` | `(bytes: Uint8Array, options?: ParseWorkbookOptions) => Promise<WorkbookParse>` | Parses an XLSX workbook binary buffer, enforces caps and ZIP signature gating, extracts raw cells, resolves shared strings and styles, and infers schemas per worksheet. |
| `parseCsv` | `(input: string \| Uint8Array, options?: ParseCsvOptions) => Promise<CsvParse>` | Parses CSV/TSV/PSV input with automatic dialect sniffing, BOM stripping, RFC 4180 state machine processing, and schema inference. |
| `inferAndTransformRows` | `(rows: readonly (readonly CellValue[])[], caps: ResolvedSheetsCaps) => InferAndTransformResult` | Pure function that infers column types over a sampling window and validates full rows against the inferred schema. |

### Decimal & Normalization Utilities

| Function | Signature | Description |
| --- | --- | --- |
| `normalizeDecimal` | `(input: string) => NormalizedDecimalResult \| null` | Normalizes currency strings, accounting negatives, and thousands separators into canonical decimal strings (`^-?\d+(\.\d+)?$`). Returns `null` if ambiguous or invalid. |
| `isCanonicalDecimal` | `(str: string) => boolean` | Checks if a string is already in canonical decimal format (e.g. `"1234.56"`, `"-0.05"`, `"42"`). |
| `isCurrencyString` | `(str: string) => boolean` | Checks if a string contains explicit currency symbols or currency codes (`$`, `€`, `USD`, etc.). |
| `isScientificNotation` | `(str: string) => boolean` | Checks if a string represents scientific notation (e.g. `"1.23e5"`, `"4.56E-3"`). |

### Cap Validation Utilities

| Function | Signature | Description |
| --- | --- | --- |
| `resolveSheetsCaps` | `(caps?: SheetsCaps) => ResolvedSheetsCaps` | Resolves user-configured limits against safe defaults and hard ceilings. |
| `validateByteCap` | `(byteLength: number, caps: ResolvedSheetsCaps) => void` | Validates input size against `caps.maxBytes`, throwing `SheetsCapError` if exceeded. |
| `validateZipSignature` | `(bytes: Uint8Array) => void` | Validates standard PKZIP magic bytes (`0x50, 0x4b, 0x03, 0x04`), throwing `SheetsFormatError` if missing. |

### Capacity Limits and Defaults

Limits are verified upfront and enforced progressively to prevent memory exhaustion and denial-of-service from adversarial inputs:

| Cap | Default | Hard Ceiling | Description |
| --- | --- | --- | --- |
| `maxBytes` | 32 MiB (`33,554,432`) | 512 MiB (`536,870,912`) | Maximum input buffer or string byte length. |
| `maxSheets` | 100 | 1,000 | Maximum worksheets in a workbook archive. |
| `maxRows` | 100,000 | 1,000,000 | Maximum rows per worksheet or CSV document. |
| `maxColumns` | 1,000 | 16,384 | Maximum columns per worksheet or CSV document. |
| `inferenceWindowRows` | 500 | 5,000 | Number of rows sampled for column schema inference. |
| `maxWarnings` | 100 | 1,000 | Maximum validation and dialect warnings recorded. |

## Outputs / response / events

### Error Hierarchy

All error classes inherit from `SheetsError` and carry structured error codes:

| Error Class | Code | Cause / Trigger |
| --- | --- | --- |
| `SheetsCapError` | `ERR_PRISM_SHEETS_CAP` | Input size, sheet count, row count, or column count exceeds configured caps. |
| `SheetsValidationError` | `ERR_PRISM_SHEETS_VALIDATION` | Invalid cap configuration (e.g. non-integer or exceeding hard ceiling). |
| `SheetsFormatError` | `ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT` | Missing ZIP container signature on XLSX input or unsupported encoding (UTF-16) on CSV input. |
| `SheetsParseError` | `ERR_PRISM_SHEETS_PARSE_FAILED` | Corrupt archive structure or malformed XML parts. |

### Schema & Warnings Output Shape

```ts
export interface ColumnSchema {
  readonly name: string;
  readonly type: "string" | "integer" | "number" | "decimal" | "date" | "datetime" | "boolean";
  readonly nullRate: number;
  readonly sample?: string;
  readonly flags?: readonly ("numeric-ambiguous" | "mixed-types")[];
}

export interface InferenceWarning {
  readonly row: number;
  readonly column: number;
  readonly columnName?: string;
  readonly expectedType: string;
  readonly actualValue: string;
  readonly message: string;
}
```

## Request/response example

### Input CSV

```csv
transaction_id,item_description,total_amount,unit_price,refund_fee
TXN-1001,"Software Consulting","$1,234.56",1234.56,"($ 50.00)"
TXN-1002,"Cloud Server Hosting","€ 450.00",450.00,"-$ 10.00"
TXN-1003,"Hardware Device","£ 2,500.00",2500.00,"$ 0.00"
```

### Parsed Output (`CsvParse`)

```json
{
  "dialect": {
    "delimiter": ",",
    "quote": "\"",
    "hasHeader": true
  },
  "schema": [
    { "name": "transaction_id", "type": "string", "nullRate": 0, "sample": "TXN-1001", "flags": [] },
    { "name": "item_description", "type": "string", "nullRate": 0, "sample": "Software Consulting", "flags": [] },
    { "name": "total_amount", "type": "decimal", "nullRate": 0, "sample": "$1,234.56", "flags": [] },
    { "name": "unit_price", "type": "decimal", "nullRate": 0, "sample": "1234.56", "flags": [] },
    { "name": "refund_fee", "type": "decimal", "nullRate": 0, "sample": "($ 50.00)", "flags": [] }
  ],
  "rows": [
    ["transaction_id", "item_description", "total_amount", "unit_price", "refund_fee"],
    ["TXN-1001", "Software Consulting", { "type": "decimal", "value": "1234.56" }, { "type": "decimal", "value": "1234.56" }, { "type": "decimal", "value": "-50.00" }],
    ["TXN-1002", "Cloud Server Hosting", { "type": "decimal", "value": "450.00" }, { "type": "decimal", "value": "450.00" }, { "type": "decimal", "value": "-10.00" }],
    ["TXN-1003", "Hardware Device", { "type": "decimal", "value": "2500.00" }, { "type": "decimal", "value": "2500.00" }, { "type": "decimal", "value": "0.00" }]
  ],
  "warnings": []
}
```

## Implementation example

```ts
import { parseWorkbook, parseCsv, type SheetsTelemetry } from "@arnilo/prism-office/sheets";

// 1. Parse XLSX workbook with custom caps
const xlsxBytes = new Uint8Array([...]); // Untrusted file bytes
const workbook = await parseWorkbook(xlsxBytes, {
  caps: {
    maxRows: 50_000,
    maxColumns: 500,
    maxBytes: 16 * 1024 * 1024,
  },
});

for (const sheet of workbook.sheets) {
  console.log(`Sheet: ${sheet.name} (${sheet.rows.length} rows)`);
  for (const col of sheet.schema) {
    console.log(`  Column [${col.name}] inferred as ${col.type} (nullRate: ${col.nullRate})`);
  }
}

// 2. Parse CSV with automatic dialect sniffing and telemetry
const csvText = `id;name;revenue\n1;"Acme, Corp";1000000.00\n2;"Global, Inc";500000.50\n`;

const telemetry: SheetsTelemetry = {
  startSpan(name, attributes) {
    console.log(`Span started: ${name}`, attributes);
    return {
      setAttribute() {},
      addEvent() {},
      recordError() {},
      end() {},
    };
  },
};

const csvResult = await parseCsv(csvText, { telemetry });
console.log(`Detected delimiter: "${csvResult.dialect.delimiter}"`);
console.log(`Revenue value:`, csvResult.rows[1][2]);
// Output: { type: "decimal", value: "1000000.00" }
```

## Extension and configuration notes

### Sub-package Pinning
To avoid pulling in CLI frameworks or extraneous dependencies, `@arnilo/prism-office/sheets` directly pins the exact underlying modular packages:
- `@office-open/xlsx@0.12.3`
- `@office-open/xml@0.12.3`

### Custom Telemetry Hook
The `SheetsTelemetry` seam allows optional OpenTelemetry instrumentation without adding runtime telemetry dependencies:
```ts
const telemetry: SheetsTelemetry = {
  startSpan(name, attributes) {
    // Maps to tracer.startSpan with allow-listed metadata (bytes, rows, columns, sheetCount)
    // Cell contents and user data are NEVER passed to telemetry spans.
    return activeSpan;
  },
};
```

### Self-Hosting & Operational Notes
- **Zero Network & Storage Dependencies**: `@arnilo/prism-office/sheets` does not write files or contact network services. Host engines own persistence, storage buckets, and lake datasets.
- **Fail-Closed Container Gating**: Malicious or non-standard files are rejected before allocation or XML decompression occurs.

## Security and performance notes

- **Pure In-Memory Operation**: No temporary files, no shell execution, no binary spawning, and zero network sockets.
- **ZIP Signature Gating**: Buffers must begin with standard PKZIP container signatures (`0x50, 0x4B, 0x03, 0x04`). Extension-based type inference is strictly prohibited.
- **Fail-Closed Caps**: Input size and element count caps are evaluated before entering XML translation passes, preventing zip-bomb and decompression amplification attacks.
- **Strict Anti-Corruption Invariant**: Zero floating-point conversions on decimal paths guarantee exact financial calculations and ledger balances.
- **Performance Budget**: Warm parsing of 1 MB CSV files completes in under 60 ms; workbook parsing completes in under 100 ms.

## Related APIs

- [`@arnilo/prism-office/documents`](./documents.md): Specification-compliant OpenXML document generation, parsing, patching, and preview rendering for DOCX, XLSX, and PPTX.
- [`@arnilo/prism-coding-tools/document-reader`](./document-reader.md): Bounded literal text extraction from PDF and DOCX documents for coding agent tools.
- [`@arnilo/prism-core/governance/observability`](./observability.md): OpenTelemetry instrumentation and trace adapters.
