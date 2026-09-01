import type { SheetsTelemetry } from "./telemetry.js";

/**
 * Supported data types inferred for sheet and CSV columns.
 */
export type ColumnType = "string" | "integer" | "number" | "decimal" | "date" | "datetime" | "boolean";

/**
 * Explicit decimal value represented as a canonical string to prevent IEEE-754 floating point loss.
 */
export interface DecimalCellValue {
  readonly type: "decimal";
  /** Canonical decimal string (e.g. "1234.56", "-0.05", "42"). */
  readonly value: string;
}

/**
 * ISO-8601 date string representation (YYYY-MM-DD).
 */
export interface DateCellValue {
  readonly type: "date";
  readonly value: string;
}

/**
 * ISO-8601 datetime string representation.
 */
export interface DateTimeCellValue {
  readonly type: "datetime";
  readonly value: string;
}

/**
 * Spreadsheet formula cell with optional cached computation result.
 */
export interface FormulaCellValue {
  readonly type?: "formula";
  /** Formula expression (e.g. "=SUM(A1:A10)"). */
  readonly formula: string;
  /** Cached or pre-calculated evaluation result (if present in the file). */
  readonly cachedValue?: string | number | boolean | null;
}

/**
 * Cell value in a parsed worksheet or CSV row.
 */
export type CellValue = string | number | boolean | DecimalCellValue | DateCellValue | DateTimeCellValue | FormulaCellValue | null;

/**
 * Inferred schema for a single column.
 */
export interface ColumnSchema {
  /** Column name / header label. */
  readonly name: string;
  /** Inferred data type. */
  readonly type: ColumnType;
  /** Fraction of rows with null/empty values in (0.0, 1.0]. */
  readonly nullRate: number;
  /** Representative non-null sample value as a string. */
  readonly sample?: string;
  /** Special flags (e.g. "numeric-ambiguous", "date-ambiguous", "mixed-types"). */
  readonly flags: readonly string[];
}

/**
 * Warning produced during parsing or schema inference.
 */
export interface InferenceWarning {
  readonly kind: string;
  readonly message: string;
  readonly column?: string;
  readonly row?: number;
  readonly mismatchCount?: number;
  readonly samples?: readonly string[];
}

/**
 * Parsed individual worksheet structure.
 */
export interface SheetParse {
  /** Worksheet name. */
  readonly name: string;
  /** 2D grid of parsed cell values [rowIndex][colIndex]. */
  readonly rows: readonly (readonly CellValue[])[];
  /** Inferred column schema. */
  readonly schema: readonly ColumnSchema[];
}

/**
 * Output of `parseWorkbook` containing all sheets and workbook-level warnings.
 */
export interface WorkbookParse {
  readonly sheets: readonly SheetParse[];
  readonly warnings: readonly InferenceWarning[];
}

/**
 * Detected CSV dialect attributes.
 */
export interface CsvDialect {
  readonly delimiter: string;
  readonly quote: string;
  readonly escape?: string;
  readonly hasHeader?: boolean;
}

/**
 * Output of `parseCsv` containing parsed rows, schema, dialect, and warnings.
 */
export interface CsvParse {
  readonly rows: readonly (readonly CellValue[])[];
  readonly schema: readonly ColumnSchema[];
  readonly dialect: CsvDialect;
  readonly warnings: readonly InferenceWarning[];
}

/**
 * User-configurable limits for sheet and CSV parsing operations.
 */
export interface SheetsCaps {
  /** Maximum input size in bytes (default 32 MiB, hard ceiling 512 MiB). */
  readonly maxBytes?: number;
  /** Maximum number of sheets in a workbook (default 100, hard ceiling 1,000). */
  readonly maxSheets?: number;
  /** Maximum number of rows per sheet or CSV (default 100,000, hard ceiling 1,000,000). */
  readonly maxRows?: number;
  /** Maximum number of columns per sheet or CSV (default 1,000, hard ceiling 16,384). */
  readonly maxColumns?: number;
  /** Number of rows to sample for schema inference (default 500, hard ceiling 5,000). */
  readonly inferenceWindowRows?: number;
  /** Maximum warnings collected (default 100, hard ceiling 1,000). */
  readonly maxWarnings?: number;
}

/**
 * Fully resolved caps with defaults and hard ceilings applied.
 */
export interface ResolvedSheetsCaps {
  readonly maxBytes: number;
  readonly maxSheets: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly inferenceWindowRows: number;
  readonly maxWarnings: number;
}

/**
 * Options passed to `parseWorkbook`.
 */
export interface ParseWorkbookOptions {
  readonly caps?: SheetsCaps;
  readonly telemetry?: SheetsTelemetry;
}

/**
 * Options passed to `parseCsv`.
 */
export interface ParseCsvOptions {
  readonly caps?: SheetsCaps;
  readonly telemetry?: SheetsTelemetry;
  readonly dialect?: Partial<CsvDialect>;
}
