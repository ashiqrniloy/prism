import type { DocumentsTelemetry } from "./telemetry.js";
import type { CellValue, DeckModel, DocBlock, DocModel, DocumentModel, HeadingBlock, SheetData, SheetModel, SlideData } from "./types.js";

// --- Preview Block Definitions ---

export interface DocOutlineHeading {
  readonly level: number;
  readonly text: string;
  readonly id?: string;
}

export interface DocOutlinePreviewBlock {
  readonly type: "doc-outline";
  readonly title?: string;
  readonly headings: readonly DocOutlineHeading[];
}

export interface DocBlocksPreviewBlock {
  readonly type: "doc-blocks";
  readonly title?: string;
  readonly blocks: readonly DocBlock[];
  readonly totalBlocks: number;
  readonly bounds: {
    readonly fromIndex: number;
    readonly toIndex: number;
  };
}

export interface SheetGridPreviewBlock {
  readonly type: "sheet-grid";
  readonly sheetIndex: number;
  readonly name: string;
  readonly rows: readonly (readonly CellValue[])[];
  readonly totalRows: number;
  readonly totalColumns: number;
  readonly bounds: {
    readonly fromRow: number;
    readonly toRow: number;
  };
}

export interface DeckSlideListPreviewBlock {
  readonly type: "deck-slides";
  readonly title?: string;
  readonly slides: readonly SlideData[];
  readonly totalSlides: number;
  readonly bounds: {
    readonly fromIndex: number;
    readonly toIndex: number;
  };
}

export interface TruncationNotePreviewBlock {
  readonly type: "truncation-note";
  readonly message: string;
  readonly droppedItems: number;
}

export type PreviewBlock =
  | DocOutlinePreviewBlock
  | DocBlocksPreviewBlock
  | SheetGridPreviewBlock
  | DeckSlideListPreviewBlock
  | TruncationNotePreviewBlock;

export interface PreviewBlocksOptions {
  /** Maximum rows per sheet-grid snapshot block (default: 200). */
  readonly maxRowsPerBlock?: number;
  /** Maximum total rows previewed per sheet across all grid blocks (default: 1,000). */
  readonly maxTotalRowsPerSheet?: number;
  /** Maximum blocks per document preview chunk (default: 200). */
  readonly maxBlocksPerChunk?: number;
  /** Maximum slides previewed (default: 100). */
  readonly maxSlides?: number;
  /** Optional telemetry seam hook. */
  readonly telemetry?: DocumentsTelemetry;
}

const DEFAULT_MAX_ROWS_PER_BLOCK = 200;
const DEFAULT_MAX_TOTAL_ROWS_PER_SHEET = 1_000;
const DEFAULT_MAX_BLOCKS_PER_CHUNK = 200;
const DEFAULT_MAX_SLIDES = 100;

function renderDocPreviewBlocks(doc: DocModel, options?: PreviewBlocksOptions): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const maxBlocksPerChunk = options?.maxBlocksPerChunk ?? DEFAULT_MAX_BLOCKS_PER_CHUNK;

  // 1. Extract outline
  const headings: DocOutlineHeading[] = [];
  for (const block of doc.blocks) {
    if (block.type === "heading") {
      const h = block as HeadingBlock;
      headings.push({
        level: h.level,
        text: h.text,
        id: h.id,
      });
    }
  }

  blocks.push({
    type: "doc-outline",
    title: doc.title,
    headings,
  });

  // 2. Chunk document blocks into bounded windows
  const total = doc.blocks.length;
  for (let i = 0; i < total; i += maxBlocksPerChunk) {
    const chunk = doc.blocks.slice(i, i + maxBlocksPerChunk);
    blocks.push({
      type: "doc-blocks",
      title: doc.title,
      blocks: chunk,
      totalBlocks: total,
      bounds: {
        fromIndex: i,
        toIndex: i + chunk.length - 1,
      },
    });
  }

  return blocks;
}

function renderSheetPreviewBlocks(model: SheetModel, options?: PreviewBlocksOptions): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const maxRowsPerBlock = options?.maxRowsPerBlock ?? DEFAULT_MAX_ROWS_PER_BLOCK;
  const maxTotalRows = options?.maxTotalRowsPerSheet ?? DEFAULT_MAX_TOTAL_ROWS_PER_SHEET;

  for (let sheetIdx = 0; sheetIdx < model.sheets.length; sheetIdx += 1) {
    const sheet: SheetData = model.sheets[sheetIdx];
    const totalRows = sheet.cells.length;
    let maxCols = 0;
    for (const r of sheet.cells) {
      if (r.length > maxCols) maxCols = r.length;
    }

    const previewableRows = Math.min(totalRows, maxTotalRows);

    for (let r = 0; r < previewableRows; r += maxRowsPerBlock) {
      const chunk = sheet.cells.slice(r, r + maxRowsPerBlock);
      blocks.push({
        type: "sheet-grid",
        sheetIndex: sheetIdx,
        name: sheet.name,
        rows: chunk,
        totalRows,
        totalColumns: maxCols,
        bounds: {
          fromRow: r,
          toRow: r + chunk.length - 1,
        },
      });
    }

    if (totalRows > maxTotalRows) {
      const dropped = totalRows - maxTotalRows;
      blocks.push({
        type: "truncation-note",
        message: `Sheet "${sheet.name}" truncated. Showing first ${maxTotalRows} of ${totalRows} rows.`,
        droppedItems: dropped,
      });
    }
  }

  return blocks;
}

function renderDeckPreviewBlocks(deck: DeckModel, options?: PreviewBlocksOptions): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const maxSlides = options?.maxSlides ?? DEFAULT_MAX_SLIDES;
  const total = deck.slides.length;
  const previewSlides = deck.slides.slice(0, maxSlides);

  blocks.push({
    type: "deck-slides",
    title: deck.title,
    slides: previewSlides,
    totalSlides: total,
    bounds: {
      fromIndex: 0,
      toIndex: previewSlides.length - 1,
    },
  });

  if (total > maxSlides) {
    const dropped = total - maxSlides;
    blocks.push({
      type: "truncation-note",
      message: `Presentation preview truncated. Showing first ${maxSlides} of ${total} slides.`,
      droppedItems: dropped,
    });
  }

  return blocks;
}

/**
 * Renders a Prism Document Model into framework-neutral, structured preview blocks.
 *
 * Produces bounded snapshots with configurable row/block pagination for native UI rendering.
 */
export function renderPreviewBlocks(model: DocumentModel, options?: PreviewBlocksOptions): PreviewBlock[] {
  const span = options?.telemetry?.startSpan("documents.preview", {
    "documents.kind": model?.kind ?? "unknown",
    "documents.preview_type": "blocks",
  });

  try {
    switch (model.kind) {
      case "doc":
        return renderDocPreviewBlocks(model as DocModel, options);
      case "sheet":
        return renderSheetPreviewBlocks(model as SheetModel, options);
      case "deck":
        return renderDeckPreviewBlocks(model as DeckModel, options);
      default:
        return [];
    }
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
