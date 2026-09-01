import { type DocumentCaps, resolveDocumentCaps, validateByteCap, validateModelCaps } from "./caps.js";
import { DocumentsParseError } from "./errors.js";
import { validateDocumentModel } from "./model-schema.js";
import type { DocumentsTelemetry } from "./telemetry.js";
import { parseDocxBytes } from "./translate/docx.js";
import { parsePptxBytes } from "./translate/pptx.js";
import { parseXlsxBytes } from "./translate/xlsx.js";
import type {
  CellValue,
  DeckModel,
  DocBlock,
  DocModel,
  DocRun,
  DocumentKind,
  DocumentModel,
  ListItem,
  SheetData,
  SheetModel,
  SlideData,
} from "./types.js";

export interface SecretRedactor {
  redact(text: string): string;
}

export interface ParseDocumentOptions {
  /** Expected document kind to parse from the OOXML container. */
  readonly kind: DocumentKind;
  /** Optional caps overrides. */
  readonly caps?: DocumentCaps;
  /** Optional SecretRedactor hook to sanitize extracted string content at the parse boundary. */
  readonly redactor?: SecretRedactor;
  /** Optional telemetry seam hook. */
  readonly telemetry?: DocumentsTelemetry;
}

/**
 * Checks whether the binary buffer begins with standard PK zip container magic bytes (0x50, 0x4B, 0x03, 0x04).
 */
export function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function redactRun(run: DocRun, redactor: SecretRedactor): DocRun {
  return {
    ...run,
    text: redactor.redact(run.text),
  };
}

function redactListItem(item: string | ListItem, redactor: SecretRedactor): string | ListItem {
  if (typeof item === "string") {
    return redactor.redact(item);
  }
  return {
    ...item,
    text: redactor.redact(item.text),
    runs: item.runs ? item.runs.map((r) => redactRun(r, redactor)) : undefined,
  };
}

function redactCellValue(cell: CellValue, redactor: SecretRedactor): CellValue {
  if (cell === null || cell === undefined) return cell;
  if (typeof cell === "string") return redactor.redact(cell);
  if (typeof cell === "number" || typeof cell === "boolean") return cell;
  if ("type" in cell) {
    if (cell.type === "decimal") return cell;
    return {
      ...cell,
      value: redactor.redact(cell.value),
    };
  }
  if ("formula" in cell) {
    return {
      ...cell,
      formula: redactor.redact(cell.formula),
      cachedValue: typeof cell.cachedValue === "string" ? redactor.redact(cell.cachedValue) : cell.cachedValue,
    };
  }
  return cell;
}

function redactDocBlock(block: DocBlock, redactor: SecretRedactor): DocBlock {
  switch (block.type) {
    case "heading":
      return { ...block, text: redactor.redact(block.text) };
    case "paragraph":
      return {
        ...block,
        text: block.text !== undefined ? redactor.redact(block.text) : undefined,
        runs: block.runs ? block.runs.map((r) => redactRun(r, redactor)) : undefined,
      };
    case "list":
      return {
        ...block,
        items: block.items.map((i) => redactListItem(i, redactor)),
      };
    case "table":
      return {
        ...block,
        headers: block.headers ? block.headers.map((h) => redactor.redact(h)) : undefined,
        cells: block.cells.map((row) => row.map((c) => redactCellValue(c, redactor))),
      };
    case "image":
      return {
        ...block,
        alt: block.alt !== undefined ? redactor.redact(block.alt) : undefined,
      };
    case "chart":
      return {
        ...block,
        title: block.title !== undefined ? redactor.redact(block.title) : undefined,
      };
    default:
      return block;
  }
}

function redactSlide(slide: SlideData, redactor: SecretRedactor): SlideData {
  return {
    ...slide,
    title: slide.title !== undefined ? redactor.redact(slide.title) : undefined,
    subtitle: slide.subtitle !== undefined ? redactor.redact(slide.subtitle) : undefined,
    notes: slide.notes !== undefined ? redactor.redact(slide.notes) : undefined,
    bullets: slide.bullets
      ? slide.bullets.map((b) => (typeof b === "string" ? redactor.redact(b) : (redactListItem(b, redactor) as ListItem)))
      : undefined,
    image: slide.image ? { ...slide.image, alt: slide.image.alt !== undefined ? redactor.redact(slide.image.alt) : undefined } : undefined,
    chart: slide.chart
      ? { ...slide.chart, title: slide.chart.title !== undefined ? redactor.redact(slide.chart.title) : undefined }
      : undefined,
  };
}

function redactSheetData(sheet: SheetData, redactor: SecretRedactor): SheetData {
  return {
    ...sheet,
    name: redactor.redact(sheet.name),
    cells: sheet.cells.map((row) => row.map((c) => redactCellValue(c, redactor))),
  };
}

function redactModel(model: DocumentModel, redactor: SecretRedactor): DocumentModel {
  if (model.kind === "doc") {
    const doc = model as DocModel;
    return {
      ...doc,
      title: doc.title !== undefined ? redactor.redact(doc.title) : undefined,
      blocks: doc.blocks.map((b) => redactDocBlock(b, redactor)),
    };
  }
  if (model.kind === "sheet") {
    const sheet = model as SheetModel;
    return {
      ...sheet,
      title: sheet.title !== undefined ? redactor.redact(sheet.title) : undefined,
      sheets: sheet.sheets.map((s) => redactSheetData(s, redactor)),
    };
  }
  if (model.kind === "deck") {
    const deck = model as DeckModel;
    return {
      ...deck,
      title: deck.title !== undefined ? redactor.redact(deck.title) : undefined,
      slides: deck.slides.map((s) => redactSlide(s, redactor)),
    };
  }
  return model;
}

/**
 * Parses spec-compliant or real-world OOXML package bytes into a typed Prism Document Model.
 *
 * Enforces ZIP magic byte verification, size & element caps, and structural validation.
 * Supports optional P6 text sanitization via SecretRedactor hook.
 */
export async function parseDocument(bytes: Uint8Array, options: ParseDocumentOptions): Promise<DocumentModel> {
  const { kind, caps: userCaps, redactor, telemetry } = options;

  const span = telemetry?.startSpan("documents.parse", {
    "documents.kind": kind,
    "documents.bytes": bytes.byteLength,
  });

  try {
    if (!isZipContainer(bytes)) {
      throw new DocumentsParseError("invalid document package: missing ZIP container signature");
    }

    const caps = resolveDocumentCaps(userCaps);
    validateByteCap(bytes.byteLength, caps);

    let model: DocumentModel;
    try {
      switch (kind) {
        case "doc":
          model = parseDocxBytes(bytes);
          break;
        case "sheet":
          model = parseXlsxBytes(bytes);
          break;
        case "deck":
          model = parsePptxBytes(bytes);
          break;
        default:
          throw new DocumentsParseError(`unsupported document kind for parsing: "${String(kind)}"`);
      }
    } catch (err: unknown) {
      if (err instanceof DocumentsParseError) throw err;
      throw new DocumentsParseError(`failed to parse OOXML document package: ${err instanceof Error ? err.message : String(err)}`);
    }

    validateModelCaps(model, caps);

    if (redactor) {
      model = redactModel(model, redactor);
    }

    validateDocumentModel(model);

    if (model.kind === "doc") {
      span?.setAttribute("documents.blocks", (model as DocModel).blocks.length);
    } else if (model.kind === "sheet") {
      span?.setAttribute("documents.sheets", (model as SheetModel).sheets.length);
    } else if (model.kind === "deck") {
      span?.setAttribute("documents.slides", (model as DeckModel).slides.length);
    }

    return model;
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
