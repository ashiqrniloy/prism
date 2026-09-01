# 052 — `@arnilo/prism-sheets`: XLSX/CSV parsing with decimal-safe typed schema inference

Source request: `prism-documents.md` (Package B, P7–P9, plus P13–P15 cross-package items that
land in this package). Sibling plans: `051-Prism-Documents-Package.md` (Package A, P1–P6),
`053-Prism-Diagrams-Package.md` (Package C, P10–P12).

This package is the **safety-critical one** in the request: Synapta stores money as decimal
strings and floats are forbidden. Decimal-unsafe inference corrupts money. Every parse path
returns decimal strings for money-like columns — never floats.

**Amendment (maintainer decision, 2026-09-01):** ships as the `/sheets` subpath of **one
package `@arnilo/prism-office`** (with `/documents` from plan 051 and `/diagrams` from plan
053). Package scaffold lands at `packages/office/src/sheets`; initial cut
`@arnilo/prism-office@0.3.0`; release cuts the single office manifest; `docs/sheets.md`
documents the `/sheets` subpath. Feature scope, APIs, tests, and security criteria unchanged.

## Objectives

- Implement P7–P9: `parseWorkbook` (XLSX) and `parseCsv` with bounded caps and ZIP-signature
  gating, and the typed schema inference engine (`string | integer | number | decimal | date |
  datetime | boolean`) with money heuristics → `decimal` string values, `numeric-ambiguous`
  fallback to `string`, bounded inference window with full-parse validation, and the schema
  report shape.
- Ship `@arnilo/prism-sheets` as a new optional package (initial cut `0.3.0`, peer
  `@arnilo/prism ^0.3.0`, omitted from umbrellas), reusing `@office-open/xlsx` `0.12.3`
  pinned exact for the XLSX zip/XML layer (including its `parseXlsx` raw-XML seam for
  decimal-safe `<v>` reads) and a hand-rolled bounded RFC 4180 CSV parser (no new dependency).
- Enforce the cross-package constraints: P13 Decision B publication, P14 no
  storage/credentials/network, P15 optional dependency-free telemetry seam, P6-style
  fail-closed error namespace `ERR_PRISM_SHEETS_*` and oversized-input refusal (a 2 GiB or
  >5M-row input refuses with a cap error, never degrades).

## Expected Outcome

- `parseWorkbook(bytes, { caps })` returns `{ sheets: [{ name, rows, schema }] }` with
  formula cells as `{ formula, cachedValue? }` — never executed; ZIP-signature gating (no
  extension trust); byte/sheet/row/column caps fail closed.
- `parseCsv(input, { caps })` returns `{ rows, schema, dialect }` — RFC 4180 plus common
  variants; delimiter/quote/escape sniffing across comma/semicolon/tab; UTF-8 with BOM
  handling; quoted fields containing delimiters and newlines parse correctly.
- A `$1,234.56` column infers `decimal` with string values `"1234.56"` — no float anywhere in
  the row output; a mixed-precision column infers `string` with `flags: ["numeric-ambiguous"]`;
  money-name heuristics (`*_amount`, `price`, `total`) infer `decimal` too.
- Inference samples a bounded window (default first 500 non-empty rows) and validates the
  inferred types over the full parse; violations are reported (`mismatchCount`, capped
  offender list) rather than silently coerced.
- Schema report: `{ columns: [{ name, type, nullRate, sample, flags }], rowCount, warnings[] }`;
  error namespace `ERR_PRISM_SHEETS_*`; all tests network-free; no `process.env`, no sockets,
  no filesystem.

## Tasks

- [x] Task 1: Primitive review — sheets-specific inventory before implementation
  - Acceptance Criteria:
    - Functional: Written inventory at `docs/_evidence/phase52-primitives.md` covering: the `@office-open/xlsx` 0.12.3 seams actually used (`parseWorkbook` structure, `parseXlsx` raw-XML components — workbook/worksheets/styles/sharedStrings — for raw `<v>` decimal-string reads); cell type attribute mapping (`t="s|str|b|inlineStr|e"` + shared strings) for exact value fidelity; document-reader cap-validation + optional-peer fail-closed pattern; rag limits/caps resolution pattern; decimal handling precedents in-repo (none expected — this is the new safety-critical primitive); any existing CSV code (`src/cli-runner.ts` mention — confirm it is not a reusable parser); telemetry seam shape (shared with plan 051 Task 6 — reuse `DocumentsTelemetry`-style pattern with `sheets.*` span names).
    - Performance: n/a (read-only task).
    - Code Quality: P7–P9 each mapped to an existing primitive or a named new one; the decimal-safe value path (raw `<v>` string → typed value, never `Number()` on the money path) is designed before any code.
    - Security: Inventory records the trust boundary (bytes are untrusted; every read is capped) and confirms no existing float-based parsing is reused on the decimal path.
  - Approach:
    - Documentation Reviewed:
      - office-open docs (Context7 `/demomacro/office-open`): `parseWorkbook(data) → WorkbookOptions`, `parseXlsx(data) → XlsxDocument` with `.workbook`, `.worksheets`, `.styles`, `.sharedStrings` raw XML access.
      - Graft nodes: `packages/document-reader/src/index.ts:L148-L181` (caps), `packages/rag/src/limits.ts` (cap resolution), `packages/rag/src/errors.ts` (error pattern), `packages/rag/src/telemetry.ts` + `packages/observability-opentelemetry/src/rag-telemetry.ts:L35-L88`.
    - Options Considered:
      - Hand-rolled XLSX unzip+XML parse vs `@office-open/xlsx` — chosen: `@office-open/xlsx` pinned exact (request: "Internally office-open (pin exact) or an equivalent spec-compliant OOXML writer"; the raw-XML seam preserves decimal strings; hand-rolling zip inflate + XML is a new parser where a pinned reviewed one exists).
      - CSV: `papaparse` dependency vs hand-rolled bounded parser — chosen: hand-rolled (bounded RFC 4180 + dialect sniffing is well-specified and small; repo doctrine is dependency-minimal; a CSV parser is also the one piece office-open does not provide).
    - Chosen Approach:
      - Reuse office-open for XLSX structure; own the typed-value mapping layer (the decimal-safety core); own the CSV parser; own inference engine.
    - API Notes and Examples:
      ```ts
      // Decimal-safe seam: read the raw <v> text, never Number() it on the decimal path
      const doc = parseXlsx(bytes); // @office-open/xlsx raw XML components
      const raw = readCellRawValue(doc.worksheets[0].element, "A1"); // "1234.56" as written
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase52-primitives.md` (created in this task).
    - References:
      - `prism-documents.md` P7–P9; plan 051 Task 1 (shared conventions; keep inventories cross-linked).
  - Test Cases to Write:
    - None (review task).
  - Task 1 complete (2026-08-31):
    - Written inventory created at `docs/_evidence/phase52-primitives.md`.
    - Low-level `@office-open/xlsx@0.12.3` raw XML parsing seam (`parseXlsx`) verified for direct `<v>` text access, shared strings lookup (`t="s"`), inline string extraction (`t="inlineStr"`), boolean/error types, and date format detection via `styles.xml`.
    - Cell type attribute mapping and formula extraction (`{ formula, cachedValue? }`, never executed) established.
    - Safety-critical decimal pipeline designed: raw text to canonical decimal normalizer and validator (`^-?\d+(\.\d+)?$`), ensuring zero `Number()` conversions on decimal/money paths.
    - Document reader caps pattern (`DEFAULT_*`, `HARD_*`, `validateCap`) and ZIP signature magic bytes (`PK\x03\x04`) identified for upfront fail-closed checks.
    - Error hierarchy `SheetsError` with `ERR_PRISM_SHEETS_*` codes designed.
    - Survey of `src/cli-runner.ts:L286-L295` confirmed `parseKinds` is not a reusable CSV parser; hand-rolled bounded RFC 4180 FSM with prefix dialect sniffing specified for `src/csv.ts`.
    - Telemetry seam shape `SheetsTelemetry` (`sheets.parse`, `sheets.infer`) specified with zero user-data leakage.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none with reason — read-only inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 2: Package scaffold + XLSX parse with caps and ZIP gating — request P7
  - Acceptance Criteria:
    - Functional: New workspace `packages/sheets` (`@arnilo/prism-sheets`) exporting `parseWorkbook(bytes, opts?) → Promise<WorkbookParse>` where `WorkbookParse = { sheets: [{ name, rows, schema }], warnings: InferenceWarning[] }` (schema filled by Task 4; shipped shape-complete with placeholder inference); ZIP-signature gating (`PK\x03\x04`, no extension trust); caps: max input bytes, sheets, rows, columns — violations throw `ERR_PRISM_SHEETS_CAP` and refuse the input rather than degrade; formula cells returned as `{ formula, cachedValue? }` — never executed; cell values are typed unions (`string | integer | number | decimal | date | datetime | boolean` with decimal as string) — no raw JS float ever emitted for a decimal-typed cell.
    - Performance: Streaming/bounded reads — a 2 GiB or >5M-row input refuses at the cap check before full parse (bytes.length/row-count cap first); a 10 MB / 50k-row workbook parses in <2 s warm (soft threshold).
    - Code Quality: `@office-open/xlsx` imports confined to `src/xlsx.ts` (the seam); typed-value mapper is a pure function over raw XML cell data; error classes (`SheetsError` base + `ERR_PRISM_SHEETS_*` subclasses) in `src/errors.ts`; strict TS extending `tsconfig.packages.json`.
    - Security: Untrusted bytes at the boundary: signature gate, caps, no formula evaluation (formulas are opaque strings), no `process.env`, no filesystem (office-open parse is in-memory), no network.
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory; office-open `parseWorkbook`/`parseXlsx` API (Context7); `packages/obscura/package.json` manifest shape precedent; `scripts/with-build-lock.mjs` test script wiring.
    - Options Considered:
      - `parseWorkbook` (full options object) vs `parseXlsx` (raw XML) + own cell reader — chosen: `parseXlsx` + own bounded cell reader for value fidelity (decimal strings survive; shared-strings resolution and `t` attribute mapping owned by us; `parseWorkbook` used only for round-trip/structure tests as a cross-check).
    - Chosen Approach:
      - `src/xlsx.ts` walks worksheet XML elements under element/attribute caps, resolving shared strings and mapping `t` types to the typed union; raw `<v>` text passes through for numeric cells (Task 4 decides integer/number/decimal per column); dates detected via styles/number formats (best-effort, flagged).
    - API Notes and Examples:
      ```ts
      const parsed = await parseWorkbook(bytes, { caps: { maxRows: 100_000 } });
      // parsed.sheets[0].rows[1][2] → { type: "decimal", value: "1234.56" } (Task 4 typing)
      // formula cell → { type: "formula", formula: "=SUM(A1:A2)", cachedValue: "3" }
      ```
    - Files to Create/Edit:
      - `packages/sheets/package.json` (peer `@arnilo/prism ^0.3.0`; deps `@office-open/xlsx` exact `0.12.3`), `packages/sheets/tsconfig.json`
      - `packages/sheets/src/index.ts`, `src/errors.ts`, `src/caps.ts`, `src/xlsx.ts`, `src/types.ts`
      - `packages/sheets/src/__tests__/xlsx.test.ts`
      - `packages/sheets/README.md`, `packages/sheets/CHANGELOG.md`, `packages/sheets/LICENSE`
    - References:
      - `prism-documents.md` P7, "Suggested package surface"; acceptance "a 2 GiB or >5M-row input refuses with a cap error".
  - Test Cases to Write:
    - `xlsx.test.ts`: happy-path workbook (built via plan 051's `generateDocument` or a committed fixture) returns sheet names + rows; non-zip bytes throw `ERR_PRISM_SHEETS_CAP`-family signature error; row/column/byte-cap fixtures refuse; formula cell returns `{formula, cachedValue}` and is never evaluated; shared-string and inline-string cells resolve to text; boolean and error-typed cells map correctly.
  - Task 2 complete (2026-08-31):
    - `packages/sheets` workspace package scaffolded at initial version `0.3.0` with `package.json`, `tsconfig.json`, `LICENSE`, `README.md`, and `CHANGELOG.md`.
    - Added `packages/sheets` to root `package.json` `workspaces`.
    - Created `src/types.ts` defining `WorkbookParse`, `SheetParse`, `CellValue`, `FormulaCellValue`, `DecimalCellValue`, `ColumnSchema`, `ColumnType`, `InferenceWarning`, `SheetsCaps`, `ResolvedSheetsCaps`, and `ParseWorkbookOptions`.
    - Created `src/errors.ts` implementing `SheetsError`, `SheetsCapError` (`ERR_PRISM_SHEETS_CAP`), `SheetsValidationError` (`ERR_PRISM_SHEETS_VALIDATION`), `SheetsFormatError` (`ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT`), and `SheetsParseError` (`ERR_PRISM_SHEETS_PARSE_FAILED`).
    - Created `src/caps.ts` implementing `resolveSheetsCaps`, `validateByteCap`, and `validateZipSignature` (`PK\x03\x04` gating).
    - Created `src/telemetry.ts` implementing zero-dependency `SheetsTelemetry` seam (`sheets.parse` span).
    - Created `src/xlsx.ts` implementing low-level `parseWorkbook` consuming `@office-open/xlsx` `parseXlsx`, extracting raw `<v>` text without float conversion, resolving shared strings (`t="s"`), inline strings (`t="inlineStr"`), booleans (`t="b"`), error codes (`t="e"`), date serials, formulas (`{ type: "formula", formula, cachedValue }`, read-only and never evaluated), and enforcing sheet, row, and column caps.
    - Created `src/index.ts` re-exporting the complete public surface.
    - Added 12 unit tests in `src/__tests__/xlsx.test.ts` covering multi-sheet workbooks, formula preservation, decimal string preservation, container signature gating, cap refusals, invalid caps validation, telemetry attributes without payload leakage, and archive corruption; all 12 tests green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package + `parseWorkbook`.
    - Docs pages to create/edit: `docs/sheets.md` (new page, created in Task 6).
    - `docs/index.md` update: yes — Task 6 (shares the group created by plan 051 Task 8; if 052 lands first, it creates the group).
    - Documentation structure reference: prism-wiki.md.

- [x] Task 3: CSV parse with dialect sniffing — request P8
  - Acceptance Criteria:
    - Functional: `parseCsv(input: string | Uint8Array, opts?) → Promise<CsvParse>` with `CsvParse = { rows, schema, dialect, warnings }`; RFC 4180 plus common variants; delimiter sniffing across comma/semicolon/tab (and pipe — cheap), quote-char (`"` default) and escape handling, quoted fields containing delimiters and newlines; UTF-8 with BOM handling (BOM stripped, BOM-less UTF-8 assumed; UTF-16 refused with a clear error — out of scope, documented); caps identical to XLSX (bytes/rows/columns) refusing rather than degrading; dialect reported: `{ delimiter, quote, escape, hasHeader? }` (header detection is inference's job — Task 4 — but the dialect object carries it once inferred).
    - Performance: Single-pass linear parse (no regex backtracking hazards on adversarial input — hand-rolled state machine over a bounded window; pathological quoting under caps); 1 MB CSV <200 ms warm.
    - Code Quality: `src/csv.ts` is a self-contained state machine (~200 lines expected) with no dependencies; sniffing samples a bounded prefix (default first 4 KiB or 50 lines) and the sniffed dialect is validated over the full parse (rows rejected if the dialect breaks mid-file → reported as warning + `mismatchCount`, never silently re-sniffed per row).
    - Security: Untrusted input bounded everywhere; no `eval`-adjacent anything; no env/fs/network.
  - Approach:
    - Documentation Reviewed:
      - RFC 4180 (CSV common format and MIME type) — field quoting, embedded CRLF, escape-by-doubling rules; Task 1 inventory (no existing reusable parser).
    - Options Considered:
      - `papaparse` dep vs hand-rolled — chosen: hand-rolled (Task 1 decision; bounded state machine is the lazy-correct choice: fewer deps, exact cap control, no hidden worker threads).
      - Sniff once globally vs re-sniff per block — chosen: sniff once, validate throughout (deterministic dialect is part of the output contract).
    - Chosen Approach:
      - State machine states: `fieldStart`, `inField`, `inQuotedField`, `quoteInQuoted` (doubled-quote disambiguation), `rowEnd`; BOM strip before sniffing; delimiter score = counts outside quoted regions in the sniff window.
    - API Notes and Examples:
      ```ts
      const { rows, dialect } = await parseCsv("a;b\n1;2\n"); // dialect: { delimiter: ";", quote: "\"" }
      ```
    - Files to Create/Edit:
      - `packages/sheets/src/csv.ts`, `packages/sheets/src/__tests__/csv.test.ts`, `packages/sheets/src/index.ts` (export)
    - References:
      - `prism-documents.md` P8; acceptance "CSV dialect sniffing handles comma/semicolon/tab delimiters and quoted fields containing delimiters and newlines".
  - Test Cases to Write:
    - `csv.test.ts`: comma/semicolon/tab sniffing (incl. ambiguous fixture resolved by quoted-region scoring); quoted fields with embedded delimiters, quotes, newlines, escaped quotes; BOM stripped; CRLF and LF row ends; caps refuse oversized input; dialect break mid-file → warning + mismatch report; UTF-16 input refused with clear error; empty input → empty rows (not an error).
  - Task 3 complete (2026-08-31):
    - Created `packages/sheets/src/csv.ts` implementing `parseCsv` backed by a zero-dependency RFC 4180 finite state machine.
    - Added prefix delimiter sniffing (evaluating `,`, `;`, `\t`, `|` outside quotes with variance-based scoring over the first 4 KiB / 50 lines).
    - Implemented UTF-8 BOM stripping (`0xEF, 0xBB, 0xBF` and `\uFEFF`) and clean fail-closed UTF-16 refusal with `ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT`.
    - Handled embedded newlines, delimiters inside quotes, doubled-quote escaping (`""`), and CRLF/LF line terminators.
    - Enforced byte caps, row caps, and column caps throwing `ERR_PRISM_SHEETS_CAP`.
    - Emitted structured `dialect-mismatch` warnings when rows deviate from expected column counts without aborting valid rows.
    - Re-exported `parseCsv` and `ParseCsvOptions` from `packages/sheets/src/index.ts`.
    - Added 13 unit tests in `src/__tests__/csv.test.ts` (all 25 package tests green); verified 1 MB CSV benchmark parsed in ~54 ms (well within <200 ms target).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `parseCsv`.
    - Docs pages to create/edit: `docs/sheets.md` CSV section — Task 6.
    - `docs/index.md` update: yes — Task 6.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 4: Typed schema inference engine, decimal-safe — request P9 (+ P15 telemetry seam)
  - Acceptance Criteria:
    - Functional: Column types `string | integer | number | decimal | date | datetime | boolean`; **money-like columns (currency symbols/patterns, or name heuristics like `*_amount`, `price`, `total`) infer `decimal`, and values are returned as decimal strings — never floats**; ambiguous numeric columns (mixed precision, inconsistent locale separators, scientific notation) infer `string` with `flags: ["numeric-ambiguous"]`; inference samples a bounded window (default first 500 non-empty rows) then validates inferred types over the full parse; violations reported (`mismatchCount`, capped offender list — default 20) rather than silently coerced; schema report `{ columns: [{ name, type, nullRate, sample, flags }], rowCount, warnings[] }`. Optional dependency-free telemetry seam (`sheets.parse` span: bytes, rows, columns, durations; no cell text in attributes), mirroring plan 051 Task 6.
    - Performance: Inference is one bounded pass over the window + one validation pass already paid by parsing (no third pass); window size configurable via caps.
    - Code Quality: Inference is a pure function `inferSchema(rows window, hints?) → ColumnSchema[]` separated from parse; canonical decimal normalization (strip currency symbols and thousands separators, validate `^-?\d+(\.\d+)?$` shape) shared by XLSX and CSV legs; heuristics table-driven (`src/inference.ts`) and unit-tested in isolation.
    - Security: This is the data-corruption trust boundary: the decimal path is string-only from raw `<v>`/CSV token to output (`grep`-able invariant: no `Number(` on typed-value paths — enforced by a source-scan test); date/locale detection conservative (falls back to `string` + flag rather than guessing).
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory (decimal-safe path design); `prism-documents.md` P9 verbatim criteria; telemetry seam shape (`packages/observability-opentelemetry/src/rag-telemetry.ts:L35-L88` precedent).
    - Options Considered:
      - Locale-aware thousands-separator normalization vs conservative fallback — chosen: normalize the two dominant shapes (`,` thousands + `.` decimal, and the mirrored variant) when the column is *consistent*; any inconsistency → `string` + `numeric-ambiguous` (money corruption risk dominates convenience).
      - Per-column inference over full data vs bounded window + full validation — chosen: window + validate (explicitly requested; bounded cost, exact reporting).
    - Chosen Approach:
      - `src/inference.ts` (heuristics + typing), `src/decimal.ts` (canonical normalization, shared), telemetry wiring in parse entry points.
    - API Notes and Examples:
      ```ts
      const { schema, rows } = await parseWorkbook(bytes);
      // schema: [{ name: "amount", type: "decimal", nullRate: 0.01, sample: "1234.56", flags: [] }]
      // rows[0][schema.indexOf(amountCol)] → { type: "decimal", value: "1234.56" }  // string, never 1234.56
      ```
    - Files to Create/Edit:
      - `packages/sheets/src/inference.ts`, `packages/sheets/src/decimal.ts`, `packages/sheets/src/telemetry.ts`
      - `packages/sheets/src/__tests__/inference.test.ts`, `packages/sheets/src/__tests__/decimal.test.ts`, `packages/sheets/src/__tests__/telemetry.test.ts`
      - `packages/sheets/src/index.ts` (exports; `parseWorkbook`/`parseCsv` now emit real schemas)
    - References:
      - `prism-documents.md` P9, P15; acceptance "a `$1,234.56` column infers `decimal` with string values `"1234.56"` — no float anywhere in the row output".
  - Test Cases to Write:
    - `inference.test.ts`: `$1,234.56` column → `decimal` with string `"1234.56"`; `*_amount`/`price`/`total` name heuristics; mixed-precision column → `string` + `numeric-ambiguous`; scientific-notation column → `string` + flag; integer/number/date/datetime/boolean columns; window-boundary case (type visible only after row 500 → `mismatchCount` reported with offender list, not coerced); `nullRate`/`sample` fields.
    - `decimal.test.ts`: currency variants, negative amounts, parenthesized negatives `(1,234.56)` → `-1234.56` (accounting style — if implemented; otherwise flagged `numeric-ambiguous`; decide in task), separator-mirrored locales, non-canonical input → `null` (flag).
    - `telemetry.test.ts`: span attributes carry counts, never cell text (marker-string fixture).
    - Source-scan test: no `Number(` on value paths in `src/xlsx.ts`/`src/csv.ts`/`src/decimal.ts` (string-literal grep guard — the anti-corruption invariant).
  - Task 4 complete (2026-08-31):
    - Created `packages/sheets/src/decimal.ts` implementing `normalizeDecimal`, `isCanonicalDecimal`, `isCurrencyString`, and `isScientificNotation` supporting currency variants (`$`, `€`, `£`, `¥`, `₹`, `CHF`, `USD`, `EUR`, etc.), accounting negative parentheses `(1,234.56)` -> `-1234.56`, Indian grouping, and EU separators with strict string-only preservation.
    - Created `packages/sheets/src/inference.ts` implementing `inferAndTransformRows` with bounded sampling window (`inferenceWindowRows`), money column heuristics (currency markers + name patterns like `*_amount`, `price`, `total`, `cost`, `salary`), fallback to `string` with `numeric-ambiguous` flag for scientific notation and separator conflicts, and full-parse validation reporting type mismatches with capped offender lists.
    - Wired `inferAndTransformRows` into `parseWorkbook` (`src/xlsx.ts`) and `parseCsv` (`src/csv.ts`).
    - Re-exported decimal and inference helpers from `src/index.ts`.
    - Added comprehensive unit test suites: `src/__tests__/decimal.test.ts` (including AST source scan anti-corruption invariant test enforcing no floating-point coercion on decimal paths), `src/__tests__/inference.test.ts`, and `src/__tests__/telemetry.test.ts` (privacy verification asserting zero cell text leakage); all 40 tests across 5 suites green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — schema inference is the package's core contract.
    - Docs pages to create/edit: `docs/sheets.md` inference section with the decimal-safety guarantees — Task 6.
    - `docs/index.md` update: yes — Task 6.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 5: Adversarial and golden fixtures — oversize refusal, round-trip corpus
  - Acceptance Criteria:
    - Functional: Committed fixture corpus under `packages/sheets/fixtures/`: money workbook (currency + name-heuristic columns), dialect corpus (comma/semicolon/tab/quoted-newline CSVs), ambiguous corpus (mixed precision, scientific notation, locale-mirrored), oversize probes (byte-cap and row-cap synthetic fixtures generated by test code, not committed binaries); the 2 GiB/>5M-row acceptance is exercised by synthetic generation at cap boundaries (a synthetic 5M+1 row CSV via a streaming writer in the test) refusing with `ERR_PRISM_SHEETS_CAP`; XLSX fixtures generated through plan 051's `generateDocument` where possible (cross-package coherence, no third-party files).
    - Performance: Oversize probes are generated in-memory/streamed under a test timeout; no multi-GB allocations (cap check must refuse *before* allocation — byte-cap fixture proves refusal happens without an OOM path).
    - Code Quality: Fixtures are declarative JSON/scripts; regeneration documented in the fixtures README.
    - Security: Fixtures inert; adversarial corpus includes the billion-quotes CSV (pathological quoting) under caps.
  - Approach:
    - Documentation Reviewed:
      - Acceptance criteria in `prism-documents.md`; synthetic-fixture precedents in repo tests (conformance suites generate data in-test).
    - Options Considered:
      - Committed binary XLSX goldens vs generate-on-the-fly via plan 051 — chosen: generate-on-the-fly (cross-checks the sibling package and keeps fixtures reproducible) with two committed minimal binaries for parser independence (parse must not depend on plan 051 being correct).
    - Chosen Approach:
      - Small committed corpus + synthetic generators for scale probes.
    - API Notes and Examples: (fixture layout documented in `packages/sheets/fixtures/README.md`)
    - Files to Create/Edit:
      - `packages/sheets/fixtures/` (corpus + README), `packages/sheets/src/__tests__/caps.test.ts`, `packages/sheets/src/__tests__/corpus.test.ts`
      - `packages/sheets/package.json` (`files` includes `fixtures` or excludes — decide: exclude from tarball, they are dev fixtures)
    - References:
      - `prism-documents.md` acceptance block.
  - Test Cases to Write:
    - `caps.test.ts`: 5M+1-row synthetic CSV refuses; byte-cap boundary fixture refuses before allocation; per-sheet/per-column cap refusals.
    - `corpus.test.ts`: full corpus type assertions (every fixture → expected schema snapshot, committed as JSON).
  - Task 5 complete (2026-08-31):
    - Created committed fixture corpus in `packages/sheets/fixtures/`:
      - `money.csv` (currency markers `$`, `€`, `£`, `¥`, accounting negative parenthesis, name heuristics).
      - `dialects/` (`comma.csv`, `semicolon.csv` with embedded commas in fields, `tab.tsv`, `pipe.psv`, `quoted-newlines.csv`).
      - `ambiguous/` (`mixed-precision.csv` with scientific notation tokens, `locale-mirrored.csv` with EU number format).
      - `adversarial/` (`billion-quotes.csv` exercising pathological quoting).
      - `xlsx/` (`minimal.xlsx`, `financial.xlsx` with formulas and decimal columns).
      - `README.md` documenting fixture layout and usage.
    - Created `src/__tests__/caps.test.ts` testing synthetic oversize row streams, pre-allocation byte cap refusals, per-sheet caps, per-column caps, and hard ceiling boundary validation.
    - Created `src/__tests__/corpus.test.ts` verifying all committed fixtures, dialect resolutions, schema snapshots, adversarial linear safety (<100ms parse without recursion or memory explosion), and binary XLSX roundtrips.
    - All 50 unit tests across 7 test suites pass cleanly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (fixtures/tests).
    - Docs pages to create/edit: none with reason — test corpus.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 6: Documentation sweep — `docs/sheets.md` + index navigation
  - Acceptance Criteria:
    - Functional: `docs/sheets.md` created per `api-page-template.md`: parse APIs, caps table, dialect report, the typed-schema contract with the **decimal-safety guarantees as the headline** (money → decimal strings, never floats; ambiguous → `string` + `numeric-ambiguous`; window + full-parse validation), warnings shape, telemetry option, self-hosting notes (no storage/network — hosts own the lake datasets); `docs/index.md` entry under the "Documents, sheets, and diagrams" group; `docs/release-and-install.md` package list + `scripts/package-truth.json` regenerated.
    - Performance: n/a (docs).
    - Code Quality: Docs truth gate green; every exported symbol documented.
    - Security: Page documents the trust boundary (untrusted bytes, fail-closed caps, no formula execution).
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`; `docs/rag.md` (page with guarantees/headline pattern); prism-wiki.md requirements.
    - Options Considered:
      - Fold into `docs/documents.md` — rejected: distinct package, distinct surface, host engines choose them independently.
    - Chosen Approach:
      - Own page; shared index group.
    - API Notes and Examples: (mirror Tasks 2–4 examples)
    - Files to Create/Edit:
      - `docs/sheets.md` (new), `docs/index.md` (entry), `docs/release-and-install.md` (list), `scripts/package-truth.json` (regenerated), `packages/sheets/README.md` (finalize)
    - References:
      - prism-wiki.md.
  - Test Cases to Write:
    - Docs truth gate stays green.
  - Task 6 complete (2026-08-31):
    - Created `docs/sheets.md` adhering strictly to `api-page-template.md` with all 9 required sections: Overview, Invariant & Decimal-Safety Guarantees (headline), Capabilities & Caps, API Reference (`parseWorkbook`, `parseCsv`, `inferAndTransformRows`, `normalizeDecimal`), Errors, Telemetry, Anti-Patterns & Pitfalls, Self-Hosting & Lake Architecture, and Testing & Verification.
    - Linked `docs/sheets.md` in `docs/index.md` under `## Documents, sheets, and diagrams`.
    - Added `@arnilo/prism-sheets` in `docs/release-and-install.md` capability packages table and install profile tables.
    - Updated `README.md` package tables and omission listings for `@arnilo/prism-all`.
    - Updated and regenerated `scripts/package-truth.json` via `node scripts/package-truth.mjs` (64 publishable, 63 workspace, 36 capability packages).
    - Synchronized package metadata counts and filters across `src/__tests__/docs.test.ts`, `src/__tests__/release.test.ts`, `scripts/phase24-truth.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase29-freeze.test.mjs`, `scripts/phase30-freeze.test.mjs`, `scripts/phase13-freeze.test.mjs` through `scripts/phase21-freeze.test.mjs`, and `scripts/benchmark-multi-agent.test.mjs`.
    - Biome linting clean (0 errors, 0 warnings); `npm test` and `npm run typecheck` 100% green across all packages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documentation of the new package's public API.
    - Docs pages to create/edit: `docs/sheets.md`, `docs/index.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — prism-sheets entry in the shared group.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 7: Release cut — request P13 (Decision B initial publication)
  - Acceptance Criteria:
    - Functional: `packages/sheets/package.json` at initial `0.3.0`, peer `@arnilo/prism ^0.3.0`, `publishConfig.access: public`, omitted from umbrellas; root `CHANGELOG.md` entry (decimal-safety contract, `@office-open/xlsx` exact pin); `npm run sdk:ready`, `release:check -- --allow-dirty --allow-untagged`, `pack:dry-run` green; publish via the Decision B flow.
    - Performance: Tarball contains `dist` + docs only (fixtures excluded via `files` negation — verify in pack dry-run).
    - Code Quality: No other package version changes.
    - Security: Pack dry-run output reviewed for fixture exclusion.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` Decision B flow; obscura initial-cut precedent.
    - Options Considered:
      - Same-window `0.3.0` vs independent `0.0.1` line — chosen: `0.3.0` (consistent with plan 051 reasoning).
    - Chosen Approach:
      - Standard new-package cut; coordinate one combined changelog note with plans 051/053 if they cut together.
    - API Notes and Examples: `npm run release:publish -- --dry-run --allow-dirty --allow-untagged`
    - Files to Create/Edit:
      - `packages/sheets/package.json` (version finalize), `CHANGELOG.md` (root), `plans/052-Prism-Sheets-Package.md` (checkboxes)
    - References:
      - `prism-documents.md` P13; `docs/release-and-install.md`.
  - Test Cases to Write:
    - Release gates are the check.
  - Task 7 complete (2026-08-31):
    - Finalized `packages/sheets/package.json` at `0.3.0` with peer dependency `@arnilo/prism: ^0.3.0`, `publishConfig.access: "public"`, and omitted from all umbrella bundles (`@arnilo/prism-all`, `prism-base`, `prism-sdk`).
    - Added `@arnilo/prism-sheets@0.3.0` entry to root `CHANGELOG.md` under `## [0.3.3] - 2026-08-31`.
    - Added `@arnilo/prism-sheets` threshold configuration in `scripts/coverage-thresholds.json` (lines >= 85%, branches >= 80%, functions >= 75%); verified actual coverage exceeds thresholds (88.05% lines, 85.71% branches).
    - Emitted compatibility baseline in `scripts/compat-baseline/arnilo__prism-sheets.txt`.
    - Verified `npm pack --dry-run` for `@arnilo/prism-sheets` (22 files, 17.5 kB; `fixtures/` and dev artifacts cleanly excluded).
    - Verified release gates and publish dry-run via `node scripts/release.mjs gate --independent`.
    - Full test suite `npm test` and typechecks `npm run typecheck` 100% green across all packages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — first npm publication of `@arnilo/prism-sheets`.
    - Docs pages to create/edit: `docs/release-and-install.md` list (finalize).
    - `docs/index.md` update: yes — verify entry accuracy.
    - Documentation structure reference: prism-wiki.md.

## Compromises Made

- **Accounting Negative Parentheses**: Parenthesized negative numbers common in general ledger reports (e.g. `(1,234.56)`) are canonicalized to standard negative decimal strings `-1234.56` in `normalizeDecimal`, ensuring zero precision loss without requiring consumer post-processing.
- **Ambiguous Numeric Fallback**: Values formatted with scientific notation (e.g. `1.23e4`) or conflicting locale punctuation (e.g. multiple distinct separators in ambiguous positions) fall back safely to `string` with the `numeric-ambiguous` column flag, eliminating float coercion risks at the trust boundary.
- **Formula Cell Preservation**: Formula expressions are captured as `{ type: "formula", formula: string, value?: CellValue }` without AST or JS evaluation to prevent formula injection / arbitrary execution vulnerabilities.
- **Test Fixture Isolation**: Test harnesses create transient files strictly in `dist/__tests__/` subtrees to prevent workspace git pollution during automated verification runs.

## Further Actions

- **Plan 053 (Prism Diagrams Engine)**: Implement `@arnilo/prism-diagrams` to complete the documents/sheets/diagrams trinity with Mermaid, Graphviz, and architecture diagram generation and validation.
- **Large Dataset Streaming / Iterators**: Consider adding an async row iterator API (`streamRows()`) in a future minor release for multi-gigabyte CSV feeds where batch array allocation is prohibitive.
- **Plan 054 (Package Consolidation)**: Review consolidation opportunities across the workspace packages.