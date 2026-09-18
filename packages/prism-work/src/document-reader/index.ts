/**
 * Bounded PDF/Office literal-text extraction adapter for the Prism coding
 * read tool (plan 018 closeout `doc-reader`).
 *
 * Explicit activation only: the host wires the returned {@link DocumentReader}
 * into `createReadTool({ documentReader })`; no file-extension sniffing ever
 * enables parsing. Bounds live here (input bytes, pages, output text bytes);
 * parsing is delegated to optional peer libraries (`pdf-parse`, `mammoth`)
 * that fail closed at creation when absent. Literal text only — no embedded
 * script execution, no macro evaluation, no external resource fetching.
 */

import type { SecretRedactor } from "@arnilo/prism";
import { parseDocument } from "../documents/parse.js";
import type { CellValue, DocumentKind, DocumentModel } from "../documents/types.js";
import { DocumentReaderError } from "./errors.js";

export { DocumentReaderError };

/** Structural reader contract accepted by coding-tools' host injection seam. */
export interface DocumentReader {
  readonly maxInputBytes: number;
  readonly maxTextBytes: number;
  extract(input: { readonly buffer: Buffer; readonly path: string; readonly signal?: AbortSignal }): Promise<DocumentReaderResult | null>;
}

export interface DocumentReaderResult {
  readonly text: string;
  readonly format: string;
  readonly pages: number;
  readonly truncatedBy: "pages" | "bytes" | null;
  readonly pageSpans?: readonly { readonly page: number; readonly start: number; readonly end: number }[];
}

// --- caps (module-local; additive package, no shared limits surface) ---

export const DEFAULT_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const HARD_MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_DOCUMENT_PAGES = 1000;
export const HARD_MAX_DOCUMENT_PAGES = 10_000;
export const DEFAULT_MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024;
export const HARD_MAX_DOCUMENT_TEXT_BYTES = 64 * 1024 * 1024;

function validateCap(name: string, value: number, hard: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > hard) {
    throw new RangeError(`document-reader ${name} must be an integer in (0, ${hard}], got ${value}`);
  }
  return value;
}

/** Byte-safe truncation to at most `maxBytes` UTF-8 bytes. */
function truncateToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

/** Host-selected per-format parser implementation. */
export interface DocumentParser {
  readonly format: string;
  /** Cheap magic-byte gate; false means "this buffer is not my format" (never reaches the parser). */
  detect(buffer: Buffer): boolean;
  /**
   * Extract literal text. Must never execute embedded content or fetch
   * external resources. Over-page documents must refuse; over-text results
   * must be truncated with `truncatedBy: "bytes"`.
   */
  extract(
    buffer: Buffer,
    options: { readonly maxPages: number; readonly maxTextBytes: number; readonly signal?: AbortSignal },
  ): Promise<Omit<DocumentReaderResult, "format">>;
}

export interface CreateDocumentReaderOptions {
  /** Hard input size cap in bytes (default 32 MiB, hard ceiling 512 MiB). */
  readonly maxBytes?: number;
  /** Hard page/sheet cap for formats that report pages (default 1000, ceiling 10000). */
  readonly maxPages?: number;
  /** Hard extracted-literal-text cap in bytes (default 2 MiB, ceiling 64 MiB). */
  readonly maxTextBytes?: number;
  /** Host-selected parsers; default wiring uses the pdf-parse and mammoth optional peers. */
  readonly parsers?: readonly DocumentParser[];
  /** Optional redactor applied to extracted text at the adapter boundary. */
  readonly redactor?: SecretRedactor;
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

const PDF_MAGIC = "%PDF-";

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
    detect: (buffer) => buffer.length >= PDF_MAGIC.length && buffer.toString("latin1", 0, PDF_MAGIC.length) === PDF_MAGIC,
    extract: async (buffer, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      // v2 runs pdf.js in a worker thread and claims the TypedArray (transfer);
      // the adapter never reuses the buffer after parse, so passing a fresh
      // Uint8Array view is safe. isEvalSupported:false keeps PDF functions from
      // executing embedded scripts — the document-reader contract forbids it.
      const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
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
    detect: (buffer) =>
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04 &&
      buffer.includes("word/document.xml"),
    extract: async (buffer, { maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      const { value } = await mammoth.extractRawText({ buffer });
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

function createOoxmlParser(format: "xlsx" | "pptx", kind: DocumentKind, part: string): DocumentParser {
  return {
    format,
    detect: (buffer) =>
      buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04 && buffer.includes(part),
    extract: async (buffer, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      const model = await parseDocument(buffer, {
        kind,
        caps:
          kind === "sheet"
            ? { maxBytes: buffer.byteLength, maxSheets: Math.min(maxPages, 1_000) }
            : { maxBytes: buffer.byteLength, maxSlides: Math.min(maxPages, 2_000) },
      });
      const pages = model.kind === "sheet" ? model.sheets.length : model.kind === "deck" ? model.slides.length : 0;
      const text = modelText(model);
      return Buffer.byteLength(text, "utf8") > maxTextBytes
        ? { text: truncateToBytes(text, maxTextBytes), pages, truncatedBy: "bytes" as const }
        : { text, pages, truncatedBy: null };
    },
  };
}

/**
 * Create a bounded document reader for `createReadTool({ documentReader })`.
 * Throws {@link DocumentReaderError} when a selected format's peer parser is
 * absent. Unsupported buffers return `null` from `extract` (the read tool
 * falls through to its 0.1.5 text path).
 */
export async function createDocumentReader(options: CreateDocumentReaderOptions = {}): Promise<DocumentReader> {
  const maxBytes = validateCap("maxBytes", options.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES, HARD_MAX_DOCUMENT_BYTES);
  const maxPages = validateCap("maxPages", options.maxPages ?? DEFAULT_MAX_DOCUMENT_PAGES, HARD_MAX_DOCUMENT_PAGES);
  const maxTextBytes = validateCap("maxTextBytes", options.maxTextBytes ?? DEFAULT_MAX_DOCUMENT_TEXT_BYTES, HARD_MAX_DOCUMENT_TEXT_BYTES);
  const parsers = options.parsers ?? [
    // Default wiring: the optional peers, probed once at creation (fail closed).
    await createPdfParser(),
    await createDocxParser(),
    createOoxmlParser("xlsx", "sheet", "xl/workbook.xml"),
    createOoxmlParser("pptx", "deck", "ppt/presentation.xml"),
  ];
  if (parsers.length === 0) {
    throw new DocumentReaderError("createDocumentReader requires at least one parser (or the optional peers installed)");
  }

  return {
    maxInputBytes: maxBytes,
    maxTextBytes,
    extract: async (input) => {
      input.signal?.throwIfAborted();
      if (input.buffer.byteLength > maxBytes) {
        throw new DocumentReaderError(`document exceeds maxBytes cap (${maxBytes}); refusing to extract`);
      }
      const parser = parsers.find((candidate) => candidate.detect(input.buffer));
      if (!parser) return null;
      const result = await parser.extract(input.buffer, { maxPages, maxTextBytes, signal: input.signal });
      if (Buffer.byteLength(result.text, "utf8") > maxTextBytes) {
        throw new DocumentReaderError(`parser returned text beyond the maxTextBytes cap (${maxTextBytes})`);
      }
      const redacted = options.redactor ? options.redactor.redact(result.text) : result.text;
      return {
        text: redacted,
        format: parser.format,
        pages: result.pages,
        truncatedBy: result.truncatedBy,
        ...(!options.redactor && result.pageSpans ? { pageSpans: result.pageSpans } : {}),
      } satisfies DocumentReaderResult;
    },
  };
}

export type { CreateMistralOcrParserOptions, OcrPageSpan, OcrUsage } from "./mistral-ocr.js";

export {
  createMistralOcrParser,
  DEFAULT_OCR_BASE_URL,
  DEFAULT_OCR_MAX_BYTES,
  DEFAULT_OCR_MAX_CONCURRENT,
  DEFAULT_OCR_MAX_PAGES,
  DEFAULT_OCR_MAX_RESPONSE_BYTES,
  DEFAULT_OCR_MODEL,
  DEFAULT_OCR_TIMEOUT_MS,
  HARD_OCR_MAX_BYTES,
  HARD_OCR_MAX_CONCURRENT,
  HARD_OCR_MAX_PAGES,
  HARD_OCR_MAX_RESPONSE_BYTES,
  HARD_OCR_TIMEOUT_MS,
} from "./mistral-ocr.js";
