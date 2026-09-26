import type { CellValue, DocumentKind, DocumentModel } from "../documents/types.js";
import { DocumentReaderError } from "./errors.js";
import type { DocumentParser } from "./index.js";

/**
 * Default parser wiring for the document reader, split out of `index.ts` so the worker entry
 * (`runtime/worker-pool-entry.ts`) can build the same parsers on the pool thread (plan 127 Task 3).
 * Non-public module: the package export map points `./document-reader` at `index.js`, which
 * re-exports the two historical public factories. The documents stack is imported lazily inside
 * the OOXML parser so a PDF-only worker does not load it.
 */

let parseDocumentModule: Promise<typeof import("../documents/parse.js")> | undefined;

/** `%PDF-` as bytes: a plain `Uint8Array` stringifies to "37,80,68,70,45", so the gate compares bytes. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/**
 * Zero-copy `Buffer` view over any byte input. `Buffer`-only helpers (`includes`, `toString`) answer
 * wrongly for a plain `Uint8Array` — the shape a worker payload arrives as (plan 127 further action
 * #2) — so the byte checks that need a string view go through this.
 */
function byteView(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Byte-safe truncation to at most `maxBytes` UTF-8 bytes. */
function truncateToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

async function loadPeer(name: string): Promise<unknown> {
  try {
    const mod = await import(name);
    // CJS peers expose their export as `default` under Node ESM interop.
    return (mod as { default?: unknown }).default ?? mod;
  } catch {
    throw new DocumentReaderError(
      `document-reader: optional peer parser "${name}" is not installed. ` +
        `Install it (npm i ${name}) or supply a host-selected parser via createDocumentReader({ parsers }); ` +
        `refusing to create a reader that cannot extract this format.`,
    );
  }
}

/** v2 `PDFParse` surface used by the adapter (typed locally; the package is ambient). */
type PdfParseResult = { readonly total: number; readonly text: string };
type PdfParseCtor = new (options: {
  readonly data: Uint8Array;
  readonly isEvalSupported?: boolean;
}) => {
  getText(options?: { readonly pageJoiner?: string }): Promise<PdfParseResult>;
  destroy(): Promise<void>;
};

/** Default PDF parser backed by the optional `pdf-parse` peer (v2 `PDFParse` class). */
export async function createPdfParser(): Promise<DocumentParser> {
  const ctor = (await loadPeer("pdf-parse")) as { PDFParse?: unknown };
  if (typeof ctor.PDFParse !== "function") {
    throw new DocumentReaderError('document-reader: optional peer "pdf-parse" (v2+) does not export the PDFParse class');
  }
  const PDFParse = ctor.PDFParse as PdfParseCtor;
  return {
    format: "pdf",
    detect: (bytes) => bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, index) => bytes[index] === byte),
    extract: async (bytes, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      // v2 runs pdf.js in a worker thread and claims the TypedArray (transfer);
      // the adapter never reuses the buffer after parse, so passing a fresh
      // Uint8Array view is safe. isEvalSupported:false keeps PDF functions from
      // executing embedded scripts — the document-reader contract forbids it.
      const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
      let data: { total: number; text: string };
      try {
        // pageJoiner:'' keeps v2's page-boundary markers out of extracted text
        // (v1 emitted none; goldens assert on raw page text).
        data = await parser.getText({ pageJoiner: "" });
      } finally {
        await parser.destroy();
      }
      if (data.total > maxPages) {
        throw new DocumentReaderError(`document has ${data.total} pages, exceeds maxPages cap (${maxPages}); refusing to extract`);
      }
      const text = data.text ?? "";
      if (Buffer.byteLength(text, "utf8") > maxTextBytes) {
        return { text: truncateToBytes(text, maxTextBytes), pages: data.total, truncatedBy: "bytes" };
      }
      return { text, pages: data.total, truncatedBy: null };
    },
  };
}

/** Default DOCX parser backed by the optional `mammoth` peer (raw text only). */
export async function createDocxParser(): Promise<DocumentParser> {
  const mammoth = (await loadPeer("mammoth")) as {
    extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
  };
  return {
    format: "docx",
    // zip container + main document part marker; entry names are stored
    // uncompressed, so the literal name appears verbatim in the headers.
    detect: (bytes) =>
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04 &&
      byteView(bytes).includes("word/document.xml"),
    extract: async (bytes, { maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      const { value } = await mammoth.extractRawText({ buffer: byteView(bytes) });
      const text = value ?? "";
      if (Buffer.byteLength(text, "utf8") > maxTextBytes) {
        return { text: truncateToBytes(text, maxTextBytes), pages: 1, truncatedBy: "bytes" };
      }
      return { text, pages: 1, truncatedBy: null };
    },
  };
}

function cellText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value !== "object") return String(value);
  if ("formula" in value) return value.cachedValue === undefined || value.cachedValue === null ? value.formula : String(value.cachedValue);
  return value.value;
}

function modelText(model: DocumentModel): string {
  if (model.kind === "sheet") {
    return model.sheets.map((sheet) => [sheet.name, ...sheet.cells.map((row) => row.map(cellText).join("\t"))].join("\n")).join("\n\n");
  }
  if (model.kind === "deck") {
    return model.slides
      .map((slide, index) => [`Slide ${index + 1}`, slide.title, slide.subtitle, ...(slide.bullets ?? [])].filter(Boolean).join("\n"))
      .join("\n\n");
  }
  return "";
}

/** OOXML (xlsx/pptx) parser over the documents model — the same shared core the tools use. */
export function createOoxmlParser(format: "xlsx" | "pptx", kind: DocumentKind, part: string): DocumentParser {
  return {
    format,
    detect: (bytes) =>
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04 &&
      byteView(bytes).includes(part),
    extract: async (bytes, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      parseDocumentModule ??= import("../documents/parse.js");
      const { parseDocument } = await parseDocumentModule;
      const model = await parseDocument(bytes, {
        kind,
        caps:
          kind === "sheet"
            ? { maxBytes: bytes.byteLength, maxSheets: Math.min(maxPages, 1_000) }
            : { maxBytes: bytes.byteLength, maxSlides: Math.min(maxPages, 2_000) },
      });
      const pages = model.kind === "sheet" ? model.sheets.length : model.kind === "deck" ? model.slides.length : 0;
      const text = modelText(model);
      return Buffer.byteLength(text, "utf8") > maxTextBytes
        ? { text: truncateToBytes(text, maxTextBytes), pages, truncatedBy: "bytes" as const }
        : { text, pages, truncatedBy: null };
    },
  };
}
