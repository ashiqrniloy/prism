/**
 * Core Prism Document Model types.
 *
 * All models are plain JSON-serializable structures with zero required class
 * instantiation. Discriminated union on `kind` ("doc" | "sheet" | "deck") with
 * stamped `modelVersion`.
 */

export type DocumentKind = "doc" | "sheet" | "deck";

// --- Document Runs & Inline Elements ---

export interface DocRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly code?: boolean;
  readonly link?: string;
}

export interface ListItem {
  readonly text: string;
  readonly runs?: readonly DocRun[];
}

// --- Cell Values (Document Tables & Sheets) ---

export interface DecimalCellValue {
  readonly type: "decimal";
  /** Canonical decimal string (e.g. "1234.56", "-0.05", "42"). */
  readonly value: string;
}

export interface DateCellValue {
  readonly type: "date";
  /** ISO-8601 date string (YYYY-MM-DD). */
  readonly value: string;
}

export interface DateTimeCellValue {
  readonly type: "datetime";
  /** ISO-8601 datetime string (e.g. "2026-08-31T18:00:00Z"). */
  readonly value: string;
}

export interface FormulaCellValue {
  /** Formula expression starting with "=" (read-only, not evaluated by Prism). */
  readonly formula: string;
  /** Optional pre-computed or cached value. */
  readonly cachedValue?: string | number | boolean | null;
}

export type CellValue = string | number | boolean | DecimalCellValue | DateCellValue | DateTimeCellValue | FormulaCellValue | null;

// --- Chart Data ---

export type ChartType = "bar" | "line" | "pie" | "scatter";

export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
}

export interface ChartData {
  readonly categories: readonly string[];
  readonly series: readonly ChartSeries[];
}

// --- Document Blocks (DocModel) ---

export interface HeadingBlock {
  readonly type: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly id?: string;
}

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly text?: string;
  readonly runs?: readonly DocRun[];
}

export interface ListBlock {
  readonly type: "list";
  readonly ordered?: boolean;
  readonly items: readonly (string | ListItem)[];
}

export interface TableBlock {
  readonly type: "table";
  readonly rows: number;
  readonly columns: number;
  readonly headers?: readonly string[];
  readonly cells: readonly (readonly CellValue[])[];
}

export interface ImageBlock {
  readonly type: "image";
  /** Base64-encoded image data or empty when referencing via `ref`. */
  readonly data?: string;
  readonly mimeType?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  /** Host-supplied opaque asset reference. */
  readonly ref?: string;
}

export interface PageBreakBlock {
  readonly type: "page-break";
}

export interface ChartBlock {
  readonly type: "chart";
  readonly chartType: ChartType;
  readonly title?: string;
  readonly data: ChartData;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

export type DocBlock = HeadingBlock | ParagraphBlock | ListBlock | TableBlock | ImageBlock | PageBreakBlock | ChartBlock;

// --- Sheet Model Elements ---

export interface ColumnWidth {
  readonly column: number;
  readonly width: number;
}

export interface FrozenPanes {
  readonly rows?: number;
  readonly columns?: number;
}

export interface SheetData {
  readonly name: string;
  readonly cells: readonly (readonly CellValue[])[];
  readonly columnWidths?: readonly ColumnWidth[];
  readonly frozenPanes?: FrozenPanes;
  readonly numberFormats?: Readonly<Record<string, string>>;
}

// --- Presentation Slide Elements ---

export type SlideLayout = "title" | "title-and-content" | "section-header" | "two-column" | "blank";

export interface SlideData {
  readonly layout: SlideLayout;
  readonly title?: string;
  readonly subtitle?: string;
  readonly bullets?: readonly (string | ListItem)[];
  readonly notes?: string;
  readonly image?: ImageBlock;
  readonly chart?: ChartBlock;
}

// --- Top-Level Document Models ---

export interface DocModel {
  readonly kind: "doc";
  readonly modelVersion: number;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly blocks: readonly DocBlock[];
}

export interface SheetModel {
  readonly kind: "sheet";
  readonly modelVersion: number;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly sheets: readonly SheetData[];
}

export interface DeckModel {
  readonly kind: "deck";
  readonly modelVersion: number;
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly slides: readonly SlideData[];
}

export type DocumentModel = DocModel | SheetModel | DeckModel;
