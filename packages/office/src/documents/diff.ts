import { DocumentsCapError, DocumentsValidationError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { validateDocumentModel } from "./model-schema.js";
import type { CellValue, DeckModel, DocBlock, DocModel, DocumentKind, DocumentModel, ImageBlock, SheetModel, SlideData } from "./types.js";

export const DEFAULT_MAX_DIFF_OPS = 4096;
export const HARD_MAX_DIFF_OPS = 16_384;
export const DEFAULT_MAX_DIFF_NODES = 8192;
export const HARD_MAX_DIFF_NODES = 32_768;

export type DocumentDiffOp = "add" | "remove" | "replace";

export interface DocumentDiffChange {
  readonly path: string;
  readonly op: DocumentDiffOp;
  readonly from?: unknown;
  readonly to?: unknown;
}

export interface DocumentDiff {
  readonly kind: DocumentKind;
  readonly changes: readonly DocumentDiffChange[];
  readonly truncated: boolean;
  readonly operations: number;
}

export interface DiffDocumentOptions {
  readonly maxOps?: number;
  readonly maxNodes?: number;
}

function bound(name: string, value: number | undefined, fallback: number, hard: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > hard) {
    throw new DocumentsCapError(`${name} must be an integer in 1..${hard}`);
  }
  return value;
}

function clip(value: unknown): unknown {
  if (typeof value === "string" && value.length > 256) return `${value.slice(0, 256)}…`;
  return value;
}

function cellKey(value: CellValue): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if ("type" in value) return `${value.type}:${value.value}`;
  if ("formula" in value) return `formula:${value.formula}:${String(value.cachedValue ?? "")}`;
  return JSON.stringify(value);
}

function imageKey(image: ImageBlock): string {
  const digest = image.data ? sha256Hex(Buffer.from(image.data)) : "";
  return `${image.ref ?? ""}:${image.mimeType ?? ""}:${image.alt ?? ""}:${digest}`;
}

function blockKey(block: DocBlock): string {
  switch (block.type) {
    case "heading":
      return `h${block.level}:${block.text}`;
    case "paragraph":
      return block.text ?? (block.runs ?? []).map((run) => run.text).join("");
    case "list":
      return JSON.stringify({ ordered: block.ordered ?? false, items: block.items });
    case "page-break":
      return "page-break";
    case "image":
      return imageKey(block);
    case "chart":
      return JSON.stringify({ chartType: block.chartType, title: block.title, data: block.data });
    case "table":
      return `table:${block.rows}x${block.columns}`;
    default:
      return JSON.stringify(block);
  }
}

function slideKey(slide: SlideData): string {
  return JSON.stringify({
    layout: slide.layout,
    title: slide.title,
    subtitle: slide.subtitle,
    bullets: slide.bullets,
    notes: slide.notes,
    image: slide.image ? imageKey(slide.image) : undefined,
    chart: slide.chart,
  });
}

interface Sink {
  visit(): boolean;
  emit(change: DocumentDiffChange): boolean;
  truncated: boolean;
  operations: number;
  changes: DocumentDiffChange[];
}

function createSink(maxOps: number, maxNodes: number): Sink {
  const changes: DocumentDiffChange[] = [];
  let operations = 0;
  let nodes = 0;
  let truncated = false;
  return {
    get truncated() {
      return truncated;
    },
    get operations() {
      return operations;
    },
    get changes() {
      return changes;
    },
    visit() {
      if (truncated) return false;
      if (nodes >= maxNodes) {
        truncated = true;
        return false;
      }
      nodes += 1;
      return true;
    },
    emit(change) {
      if (truncated) return false;
      if (operations >= maxOps) {
        truncated = true;
        return false;
      }
      operations += 1;
      changes.push({
        path: change.path,
        op: change.op,
        ...(change.from === undefined ? {} : { from: clip(change.from) }),
        ...(change.to === undefined ? {} : { to: clip(change.to) }),
      });
      return true;
    },
  };
}

function diffScalar(sink: Sink, path: string, from: unknown, to: unknown): boolean {
  if (!sink.visit()) return false;
  if (from === to) return true;
  if (from === undefined) return sink.emit({ path, op: "add", to });
  if (to === undefined) return sink.emit({ path, op: "remove", from });
  return sink.emit({ path, op: "replace", from, to });
}

function diffCells(sink: Sink, path: string, from: readonly (readonly CellValue[])[], to: readonly (readonly CellValue[])[]): boolean {
  const rows = Math.max(from.length, to.length);
  for (let r = 0; r < rows; r += 1) {
    const leftRow = from[r];
    const rightRow = to[r];
    if (!sink.visit()) return false;
    if (leftRow === undefined) {
      if (!sink.emit({ path: `${path}/${r}`, op: "add", to: rightRow?.map(cellKey) })) return false;
      continue;
    }
    if (rightRow === undefined) {
      if (!sink.emit({ path: `${path}/${r}`, op: "remove", from: leftRow.map(cellKey) })) return false;
      continue;
    }
    const cols = Math.max(leftRow.length, rightRow.length);
    for (let c = 0; c < cols; c += 1) {
      const left = leftRow[c];
      const right = rightRow[c];
      if (left === undefined) {
        if (!diffScalar(sink, `${path}/${r}/${c}`, undefined, right === undefined ? undefined : cellKey(right))) return false;
        continue;
      }
      if (right === undefined) {
        if (!diffScalar(sink, `${path}/${r}/${c}`, cellKey(left), undefined)) return false;
        continue;
      }
      if (!diffScalar(sink, `${path}/${r}/${c}`, cellKey(left), cellKey(right))) return false;
    }
  }
  return true;
}

function diffDoc(sink: Sink, from: DocModel, to: DocModel): boolean {
  if (!diffScalar(sink, "title", from.title, to.title)) return false;
  const n = Math.max(from.blocks.length, to.blocks.length);
  for (let i = 0; i < n; i += 1) {
    const left = from.blocks[i];
    const right = to.blocks[i];
    if (!sink.visit()) return false;
    if (left === undefined) {
      if (!sink.emit({ path: `blocks/${i}`, op: "add", to: right ? blockKey(right) : undefined })) return false;
      continue;
    }
    if (right === undefined) {
      if (!sink.emit({ path: `blocks/${i}`, op: "remove", from: blockKey(left) })) return false;
      continue;
    }
    if (left.type !== right.type) {
      if (!sink.emit({ path: `blocks/${i}`, op: "replace", from: blockKey(left), to: blockKey(right) })) return false;
      continue;
    }
    if (left.type === "table" && right.type === "table") {
      if (!diffCells(sink, `blocks/${i}/cells`, left.cells, right.cells)) return false;
      continue;
    }
    if (!diffScalar(sink, `blocks/${i}`, blockKey(left), blockKey(right))) return false;
  }
  return true;
}

function diffSheet(sink: Sink, from: SheetModel, to: SheetModel): boolean {
  if (!diffScalar(sink, "title", from.title, to.title)) return false;
  const n = Math.max(from.sheets.length, to.sheets.length);
  for (let i = 0; i < n; i += 1) {
    const left = from.sheets[i];
    const right = to.sheets[i];
    if (!sink.visit()) return false;
    if (left === undefined) {
      if (!sink.emit({ path: `sheets/${i}`, op: "add", to: right?.name })) return false;
      continue;
    }
    if (right === undefined) {
      if (!sink.emit({ path: `sheets/${i}`, op: "remove", from: left.name })) return false;
      continue;
    }
    if (!diffScalar(sink, `sheets/${i}/name`, left.name, right.name)) return false;
    if (!diffCells(sink, `sheets/${i}/cells`, left.cells, right.cells)) return false;
  }
  return true;
}

function diffDeck(sink: Sink, from: DeckModel, to: DeckModel): boolean {
  if (!diffScalar(sink, "title", from.title, to.title)) return false;
  const n = Math.max(from.slides.length, to.slides.length);
  for (let i = 0; i < n; i += 1) {
    const left = from.slides[i];
    const right = to.slides[i];
    if (!sink.visit()) return false;
    if (left === undefined) {
      if (!sink.emit({ path: `slides/${i}`, op: "add", to: right ? slideKey(right) : undefined })) return false;
      continue;
    }
    if (right === undefined) {
      if (!sink.emit({ path: `slides/${i}`, op: "remove", from: slideKey(left) })) return false;
      continue;
    }
    if (!diffScalar(sink, `slides/${i}`, slideKey(left), slideKey(right))) return false;
  }
  return true;
}

/** Structural Document Model diff. Caps report `truncated` instead of walking unbounded trees. Decimal cells compare as strings. */
export function diffDocument(from: DocumentModel, to: DocumentModel, options?: DiffDocumentOptions): DocumentDiff {
  validateDocumentModel(from);
  validateDocumentModel(to);
  if (from.kind !== to.kind) {
    throw new DocumentsValidationError(`cannot diff "${from.kind}" against "${to.kind}"`);
  }
  const maxOps = bound("maxOps", options?.maxOps, DEFAULT_MAX_DIFF_OPS, HARD_MAX_DIFF_OPS);
  const maxNodes = bound("maxNodes", options?.maxNodes, DEFAULT_MAX_DIFF_NODES, HARD_MAX_DIFF_NODES);
  const sink = createSink(maxOps, maxNodes);
  if (from.kind === "doc") diffDoc(sink, from, to as DocModel);
  else if (from.kind === "sheet") diffSheet(sink, from, to as SheetModel);
  else diffDeck(sink, from, to as DeckModel);
  return {
    kind: from.kind,
    changes: Object.freeze(sink.changes),
    truncated: sink.truncated,
    operations: sink.operations,
  };
}
