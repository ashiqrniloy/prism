import { DocumentsValidationError } from "./errors.js";
import { validateDocumentModel } from "./model-schema.js";
import type { DocumentsTelemetry } from "./telemetry.js";
import type { CellValue, DeckModel, DocBlock, DocModel, DocumentModel, SheetData, SheetModel, SlideData } from "./types.js";

export interface BlockTarget {
  readonly block: number;
}

export interface BlockInsertTarget {
  readonly afterBlock?: number;
  readonly beforeBlock?: number;
  readonly atIndex?: number;
}

export interface TableCellTarget {
  readonly table: {
    readonly block: number;
    readonly row: number;
    readonly column: number;
  };
}

export interface SheetCellTarget {
  readonly cell: {
    readonly sheet: number;
    readonly row: number;
    readonly column: number;
  };
}

export interface SlideTarget {
  readonly slide: number;
}

export interface SlideInsertTarget {
  readonly afterSlide?: number;
  readonly beforeSlide?: number;
  readonly atIndex?: number;
}

export interface SheetTarget {
  readonly sheet: number;
}

export interface TitleTarget {
  readonly title: true;
}

export interface MetadataTarget {
  readonly metadata: string;
}

export type PatchTarget =
  | BlockTarget
  | BlockInsertTarget
  | TableCellTarget
  | SheetCellTarget
  | SlideTarget
  | SlideInsertTarget
  | SheetTarget
  | TitleTarget
  | MetadataTarget;

export interface SetPatch {
  readonly op: "set";
  readonly target: PatchTarget;
  readonly patch?: Record<string, unknown>;
  readonly value?: unknown;
  readonly block?: DocBlock;
  readonly slide?: SlideData;
  readonly sheet?: SheetData;
  readonly cell?: CellValue;
}

export interface InsertPatch {
  readonly op: "insert";
  readonly target: PatchTarget;
  readonly block?: DocBlock;
  readonly slide?: SlideData;
  readonly sheet?: SheetData;
  readonly value?: unknown;
}

export interface RemovePatch {
  readonly op: "remove";
  readonly target: PatchTarget;
}

export interface MovePatch {
  readonly op: "move";
  readonly from: PatchTarget;
  readonly to: PatchTarget;
}

export type DocumentPatch = SetPatch | InsertPatch | RemovePatch | MovePatch;

export interface PatchDocumentOptions {
  /** Optional telemetry seam hook. */
  readonly telemetry?: DocumentsTelemetry;
}

function applySetPatch(model: DocumentModel, patch: SetPatch): void {
  const target = patch.target;

  if ("title" in target && target.title === true) {
    const val = patch.value ?? (patch.patch as { title?: string } | undefined)?.title;
    if (typeof val === "string" || val === undefined) {
      (model as { title?: string }).title = val;
      return;
    }
    throw new DocumentsValidationError("patch 'set title' value must be a string or undefined");
  }

  if ("metadata" in target && typeof target.metadata === "string") {
    const val = patch.value;
    if (!model.metadata) {
      (model as { metadata?: Record<string, unknown> }).metadata = {};
    }
    if (val === undefined) {
      delete (model.metadata as Record<string, unknown>)[target.metadata];
    } else {
      (model.metadata as Record<string, unknown>)[target.metadata] = val;
    }
    return;
  }

  if ("table" in target && target.table) {
    if (model.kind !== "doc") {
      throw new DocumentsValidationError("table cell target can only be applied to doc model");
    }
    const doc = model as DocModel;
    const { block: blockIdx, row, column } = target.table;
    if (blockIdx < 0 || blockIdx >= doc.blocks.length) {
      throw new DocumentsValidationError(`table target block index ${blockIdx} out of bounds`);
    }
    const block = doc.blocks[blockIdx];
    if (block.type !== "table") {
      throw new DocumentsValidationError(`block at index ${blockIdx} is not a table`);
    }
    const cells = block.cells as CellValue[][];
    if (row < 0 || row >= cells.length) {
      throw new DocumentsValidationError(`table row index ${row} out of bounds`);
    }
    if (column < 0 || column >= cells[row].length) {
      throw new DocumentsValidationError(`table column index ${column} out of bounds`);
    }
    const cellVal = (patch.cell !== undefined ? patch.cell : patch.value) as CellValue;
    cells[row][column] = cellVal;
    return;
  }

  if ("cell" in target && target.cell) {
    if (model.kind !== "sheet") {
      throw new DocumentsValidationError("cell target can only be applied to sheet model");
    }
    const sheetModel = model as SheetModel;
    const { sheet: sheetIdx, row, column } = target.cell;
    if (sheetIdx < 0 || sheetIdx >= sheetModel.sheets.length) {
      throw new DocumentsValidationError(`sheet index ${sheetIdx} out of bounds`);
    }
    const sheet = sheetModel.sheets[sheetIdx];
    const cells = sheet.cells as CellValue[][];
    if (row < 0 || row >= cells.length) {
      throw new DocumentsValidationError(`sheet row index ${row} out of bounds`);
    }
    if (column < 0 || column >= cells[row].length) {
      throw new DocumentsValidationError(`sheet column index ${column} out of bounds`);
    }
    const cellVal = (patch.cell !== undefined ? patch.cell : patch.value) as CellValue;
    cells[row][column] = cellVal;
    return;
  }

  if ("block" in target && typeof target.block === "number") {
    if (model.kind !== "doc") {
      throw new DocumentsValidationError("block target can only be applied to doc model");
    }
    const doc = model as DocModel;
    const blocks = doc.blocks as DocBlock[];
    const idx = target.block;
    if (idx < 0 || idx >= blocks.length) {
      throw new DocumentsValidationError(`block index ${idx} out of bounds`);
    }
    if (patch.block) {
      blocks[idx] = patch.block;
    } else if (patch.patch) {
      blocks[idx] = { ...blocks[idx], ...patch.patch } as DocBlock;
    } else if (patch.value && typeof patch.value === "object") {
      blocks[idx] = patch.value as DocBlock;
    } else {
      throw new DocumentsValidationError("set patch on block requires block, patch, or value object");
    }
    return;
  }

  if ("slide" in target && typeof target.slide === "number") {
    if (model.kind !== "deck") {
      throw new DocumentsValidationError("slide target can only be applied to deck model");
    }
    const deck = model as DeckModel;
    const slides = deck.slides as SlideData[];
    const idx = target.slide;
    if (idx < 0 || idx >= slides.length) {
      throw new DocumentsValidationError(`slide index ${idx} out of bounds`);
    }
    if (patch.slide) {
      slides[idx] = patch.slide;
    } else if (patch.patch) {
      slides[idx] = { ...slides[idx], ...patch.patch } as SlideData;
    } else if (patch.value && typeof patch.value === "object") {
      slides[idx] = patch.value as SlideData;
    } else {
      throw new DocumentsValidationError("set patch on slide requires slide, patch, or value object");
    }
    return;
  }

  if ("sheet" in target && typeof target.sheet === "number") {
    if (model.kind !== "sheet") {
      throw new DocumentsValidationError("sheet target can only be applied to sheet model");
    }
    const sheetModel = model as SheetModel;
    const sheets = sheetModel.sheets as SheetData[];
    const idx = target.sheet;
    if (idx < 0 || idx >= sheets.length) {
      throw new DocumentsValidationError(`sheet index ${idx} out of bounds`);
    }
    if (patch.sheet) {
      sheets[idx] = patch.sheet;
    } else if (patch.patch) {
      sheets[idx] = { ...sheets[idx], ...patch.patch } as SheetData;
    } else if (patch.value && typeof patch.value === "object") {
      sheets[idx] = patch.value as SheetData;
    } else {
      throw new DocumentsValidationError("set patch on sheet requires sheet, patch, or value object");
    }
    return;
  }

  throw new DocumentsValidationError("unsupported target selector for set operation");
}

function resolveInsertIndex(target: PatchTarget, arrayLength: number): number {
  if ("afterBlock" in target && typeof target.afterBlock === "number") {
    if (target.afterBlock < -1 || target.afterBlock >= arrayLength) {
      throw new DocumentsValidationError(`afterBlock index ${target.afterBlock} out of bounds`);
    }
    return target.afterBlock + 1;
  }
  if ("beforeBlock" in target && typeof target.beforeBlock === "number") {
    if (target.beforeBlock < 0 || target.beforeBlock > arrayLength) {
      throw new DocumentsValidationError(`beforeBlock index ${target.beforeBlock} out of bounds`);
    }
    return target.beforeBlock;
  }
  if ("afterSlide" in target && typeof target.afterSlide === "number") {
    if (target.afterSlide < -1 || target.afterSlide >= arrayLength) {
      throw new DocumentsValidationError(`afterSlide index ${target.afterSlide} out of bounds`);
    }
    return target.afterSlide + 1;
  }
  if ("beforeSlide" in target && typeof target.beforeSlide === "number") {
    if (target.beforeSlide < 0 || target.beforeSlide > arrayLength) {
      throw new DocumentsValidationError(`beforeSlide index ${target.beforeSlide} out of bounds`);
    }
    return target.beforeSlide;
  }
  if ("atIndex" in target && typeof target.atIndex === "number") {
    if (target.atIndex < 0 || target.atIndex > arrayLength) {
      throw new DocumentsValidationError(`atIndex ${target.atIndex} out of bounds`);
    }
    return target.atIndex;
  }
  return arrayLength;
}

function applyInsertPatch(model: DocumentModel, patch: InsertPatch): void {
  if (model.kind === "doc") {
    const doc = model as DocModel;
    const item = (patch.block ?? patch.value) as DocBlock | undefined;
    if (!item || typeof item !== "object" || !("type" in item)) {
      throw new DocumentsValidationError("insert patch on doc requires a valid DocBlock");
    }
    const blocks = doc.blocks as DocBlock[];
    const idx = resolveInsertIndex(patch.target, blocks.length);
    blocks.splice(idx, 0, item);
    return;
  }

  if (model.kind === "deck") {
    const deck = model as DeckModel;
    const item = (patch.slide ?? patch.value) as SlideData | undefined;
    if (!item || typeof item !== "object" || !("layout" in item)) {
      throw new DocumentsValidationError("insert patch on deck requires a valid SlideData");
    }
    const slides = deck.slides as SlideData[];
    const idx = resolveInsertIndex(patch.target, slides.length);
    slides.splice(idx, 0, item);
    return;
  }

  if (model.kind === "sheet") {
    const sheetModel = model as SheetModel;
    const item = (patch.sheet ?? patch.value) as SheetData | undefined;
    if (!item || typeof item !== "object" || !("name" in item)) {
      throw new DocumentsValidationError("insert patch on sheet model requires a valid SheetData");
    }
    const sheets = sheetModel.sheets as SheetData[];
    const idx = resolveInsertIndex(patch.target, sheets.length);
    sheets.splice(idx, 0, item);
    return;
  }

  throw new DocumentsValidationError(`unsupported document kind for insert operation: ${String((model as DocumentModel).kind)}`);
}

function applyRemovePatch(model: DocumentModel, patch: RemovePatch): void {
  const target = patch.target;

  if ("block" in target && typeof target.block === "number") {
    if (model.kind !== "doc") {
      throw new DocumentsValidationError("remove block target can only be applied to doc model");
    }
    const doc = model as DocModel;
    const blocks = doc.blocks as DocBlock[];
    const idx = target.block;
    if (idx < 0 || idx >= blocks.length) {
      throw new DocumentsValidationError(`remove block index ${idx} out of bounds`);
    }
    blocks.splice(idx, 1);
    return;
  }

  if ("slide" in target && typeof target.slide === "number") {
    if (model.kind !== "deck") {
      throw new DocumentsValidationError("remove slide target can only be applied to deck model");
    }
    const deck = model as DeckModel;
    const slides = deck.slides as SlideData[];
    const idx = target.slide;
    if (idx < 0 || idx >= slides.length) {
      throw new DocumentsValidationError(`remove slide index ${idx} out of bounds`);
    }
    slides.splice(idx, 1);
    return;
  }

  if ("sheet" in target && typeof target.sheet === "number") {
    if (model.kind !== "sheet") {
      throw new DocumentsValidationError("remove sheet target can only be applied to sheet model");
    }
    const sheetModel = model as SheetModel;
    const sheets = sheetModel.sheets as SheetData[];
    const idx = target.sheet;
    if (idx < 0 || idx >= sheets.length) {
      throw new DocumentsValidationError(`remove sheet index ${idx} out of bounds`);
    }
    sheets.splice(idx, 1);
    return;
  }

  throw new DocumentsValidationError("unsupported target selector for remove operation");
}

function applyMovePatch(model: DocumentModel, patch: MovePatch): void {
  if (model.kind === "doc") {
    const doc = model as DocModel;
    if (!("block" in patch.from) || typeof patch.from.block !== "number") {
      throw new DocumentsValidationError("move patch 'from' must specify a block index");
    }
    const blocks = doc.blocks as DocBlock[];
    const fromIdx = patch.from.block;
    if (fromIdx < 0 || fromIdx >= blocks.length) {
      throw new DocumentsValidationError(`move from block index ${fromIdx} out of bounds`);
    }
    const [item] = blocks.splice(fromIdx, 1);
    const toIdx = resolveInsertIndex(patch.to, blocks.length);
    blocks.splice(toIdx, 0, item);
    return;
  }

  if (model.kind === "deck") {
    const deck = model as DeckModel;
    if (!("slide" in patch.from) || typeof patch.from.slide !== "number") {
      throw new DocumentsValidationError("move patch 'from' must specify a slide index");
    }
    const slides = deck.slides as SlideData[];
    const fromIdx = patch.from.slide;
    if (fromIdx < 0 || fromIdx >= slides.length) {
      throw new DocumentsValidationError(`move from slide index ${fromIdx} out of bounds`);
    }
    const [item] = slides.splice(fromIdx, 1);
    const toIdx = resolveInsertIndex(patch.to, slides.length);
    slides.splice(toIdx, 0, item);
    return;
  }

  throw new DocumentsValidationError(`move operation not supported on ${model.kind} model`);
}

/**
 * Applies a sequence of typed patch operations to a Prism Document Model.
 *
 * Immutably clones the input model, validates targets and bounds,
 * and validates the final output model against its schema.
 */
export function patchDocument(model: DocumentModel, patches: readonly DocumentPatch[], options?: PatchDocumentOptions): DocumentModel {
  const span = options?.telemetry?.startSpan("documents.patch", {
    "documents.kind": model?.kind ?? "unknown",
    "documents.patches_count": patches?.length ?? 0,
  });

  try {
    if (!patches || patches.length === 0) {
      return structuredClone(model);
    }

    const patched = structuredClone(model);

    for (const patch of patches) {
      if (!patch || typeof patch !== "object" || !("op" in patch)) {
        throw new DocumentsValidationError("invalid patch operation: missing 'op'");
      }

      switch (patch.op) {
        case "set":
          applySetPatch(patched, patch);
          break;
        case "insert":
          applyInsertPatch(patched, patch);
          break;
        case "remove":
          applyRemovePatch(patched, patch);
          break;
        case "move":
          applyMovePatch(patched, patch);
          break;
        default:
          throw new DocumentsValidationError(`unknown patch operation "${(patch as { op: string }).op}"`);
      }
    }

    // Structural trust boundary: every patch output passes validateDocumentModel
    validateDocumentModel(patched);

    return patched;
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
