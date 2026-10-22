import { DocumentsCapError } from "./errors.js";
import type { DeckModel, DocModel, DocumentModel, SheetModel } from "./types.js";

// --- Default and Hard Ceiling Constants ---

export const DEFAULT_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024; // 32 MiB
export const HARD_MAX_DOCUMENT_BYTES = 512 * 1024 * 1024; // 512 MiB

export const DEFAULT_MAX_BLOCKS = 10_000;
export const HARD_MAX_BLOCKS = 50_000;

export const DEFAULT_MAX_CELLS = 500_000;
export const HARD_MAX_CELLS = 2_000_000;

export const DEFAULT_MAX_SLIDES = 500;
export const HARD_MAX_SLIDES = 2_000;

export const DEFAULT_MAX_SHEETS = 100;
export const HARD_MAX_SHEETS = 1_000;

export const DEFAULT_MAX_IMAGES = 100;
export const HARD_MAX_IMAGES = 1_000;

export interface DocumentCaps {
  /** Maximum generated or parsed file size in bytes (default 32 MiB, hard 512 MiB). */
  readonly maxBytes?: number;
  /** Maximum total block elements in a doc model (default 10,000, hard 50,000). */
  readonly maxBlocks?: number;
  /** Maximum total table or worksheet cells (default 500,000, hard 2,000,000). */
  readonly maxCells?: number;
  /** Maximum presentation slides (default 500, hard 2,000). */
  readonly maxSlides?: number;
  /** Maximum workbook sheets (default 100, hard 1,000). */
  readonly maxSheets?: number;
  /** Maximum embedded images (default 100, hard 1,000). */
  readonly maxImages?: number;
}

export interface ResolvedDocumentCaps {
  readonly maxBytes: number;
  readonly maxBlocks: number;
  readonly maxCells: number;
  readonly maxSlides: number;
  readonly maxSheets: number;
  readonly maxImages: number;
}

function resolveCap(name: string, value: number | undefined, defaultVal: number, hardCap: number): number {
  if (value === undefined) return defaultVal;
  if (!Number.isInteger(value) || value <= 0 || value > hardCap) {
    throw new RangeError(`documents cap ${name} must be an integer in (0, ${hardCap}], got ${value}`);
  }
  return value;
}

/**
 * Resolves user-supplied caps against safe defaults and hard ceilings.
 */
export function resolveDocumentCaps(caps?: DocumentCaps): ResolvedDocumentCaps {
  return {
    maxBytes: resolveCap("maxBytes", caps?.maxBytes, DEFAULT_MAX_DOCUMENT_BYTES, HARD_MAX_DOCUMENT_BYTES),
    maxBlocks: resolveCap("maxBlocks", caps?.maxBlocks, DEFAULT_MAX_BLOCKS, HARD_MAX_BLOCKS),
    maxCells: resolveCap("maxCells", caps?.maxCells, DEFAULT_MAX_CELLS, HARD_MAX_CELLS),
    maxSlides: resolveCap("maxSlides", caps?.maxSlides, DEFAULT_MAX_SLIDES, HARD_MAX_SLIDES),
    maxSheets: resolveCap("maxSheets", caps?.maxSheets, DEFAULT_MAX_SHEETS, HARD_MAX_SHEETS),
    maxImages: resolveCap("maxImages", caps?.maxImages, DEFAULT_MAX_IMAGES, HARD_MAX_IMAGES),
  };
}

/**
 * Enforces element and structural caps on a DocumentModel before processing.
 * Throws {@link DocumentsCapError} if any cap is exceeded.
 */
export function validateModelCaps(model: DocumentModel, caps: ResolvedDocumentCaps): void {
  if (model.kind === "doc") {
    const doc = model as DocModel;
    if (doc.blocks.length > caps.maxBlocks) {
      throw new DocumentsCapError(`document contains ${doc.blocks.length} blocks, exceeding maxBlocks cap (${caps.maxBlocks})`);
    }
    let cellCount = 0;
    let imageCount = 0;
    for (const block of doc.blocks) {
      if (block.type === "table") {
        for (const row of block.cells) {
          cellCount += row.length;
        }
        if (cellCount > caps.maxCells) {
          throw new DocumentsCapError(`document tables contain > ${caps.maxCells} cells, exceeding maxCells cap`);
        }
      } else if (block.type === "image") {
        imageCount += 1;
        if (imageCount > caps.maxImages) {
          throw new DocumentsCapError(`document contains ${imageCount} images, exceeding maxImages cap (${caps.maxImages})`);
        }
      }
    }
  } else if (model.kind === "sheet") {
    const sheetModel = model as SheetModel;
    if (sheetModel.sheets.length > caps.maxSheets) {
      throw new DocumentsCapError(`workbook contains ${sheetModel.sheets.length} sheets, exceeding maxSheets cap (${caps.maxSheets})`);
    }
    let cellCount = 0;
    for (const sheet of sheetModel.sheets) {
      for (const row of sheet.cells) {
        cellCount += row.length;
        if (cellCount > caps.maxCells) {
          throw new DocumentsCapError(`sheet cells exceed maxCells cap (${caps.maxCells})`);
        }
      }
    }
  } else if (model.kind === "deck") {
    const deck = model as DeckModel;
    if (deck.slides.length > caps.maxSlides) {
      throw new DocumentsCapError(`presentation contains ${deck.slides.length} slides, exceeding maxSlides cap (${caps.maxSlides})`);
    }
    let imageCount = 0;
    for (const slide of deck.slides) {
      if (slide.image) {
        imageCount += 1;
        if (imageCount > caps.maxImages) {
          throw new DocumentsCapError(`presentation contains ${imageCount} images, exceeding maxImages cap (${caps.maxImages})`);
        }
      }
    }
  }
}

/**
 * Enforces byte size ceiling. Throws {@link DocumentsCapError} if exceeded.
 */
export function validateByteCap(byteLength: number, caps: ResolvedDocumentCaps): void {
  if (byteLength > caps.maxBytes) {
    throw new DocumentsCapError(`document size ${byteLength} bytes exceeds maxBytes cap (${caps.maxBytes})`);
  }
}
