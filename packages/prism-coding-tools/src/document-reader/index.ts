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
import type { DocumentReader, DocumentReaderResult } from "../agent/index.js";

export class DocumentReaderError extends Error {
  readonly code = "ERR_PRISM_DOCUMENT_READER";
  constructor(message: string) {
    super(message);
    this.name = "DocumentReaderError";
  }
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

/** Default PDF parser backed by the optional `pdf-parse` peer. */
export async function createPdfParser(): Promise<DocumentParser> {
  const pdfParse = (await loadPeer("pdf-parse")) as (data: Uint8Array) => Promise<{ numpages: number; text: string }>;
  return {
    format: "pdf",
    detect: (buffer) => buffer.length >= PDF_MAGIC.length && buffer.toString("latin1", 0, PDF_MAGIC.length) === PDF_MAGIC,
    extract: async (buffer, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      // pdf.js v1.10.100 mis-parses Node Buffers; a fresh Uint8Array view is required.
      const data = await pdfParse(new Uint8Array(buffer));
      if (data.numpages > maxPages) {
        throw new DocumentReaderError(`document has ${data.numpages} pages, exceeds maxPages cap (${maxPages}); refusing to extract`);
      }
      const text = data.text ?? "";
      if (Buffer.byteLength(text, "utf8") > maxTextBytes) {
        return { text: truncateToBytes(text, maxTextBytes), pages: data.numpages, truncatedBy: "bytes" };
      }
      return { text, pages: data.numpages, truncatedBy: null };
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
  ];
  if (parsers.length === 0) {
    throw new DocumentReaderError("createDocumentReader requires at least one parser (or the optional peers installed)");
  }

  return {
    maxInputBytes: maxBytes,
    maxTextBytes,
    extract: async (input) => {
      input.signal?.throwIfAborted();
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
      } satisfies DocumentReaderResult;
    },
  };
}

/** Re-exported slot type for host convenience. */
export type { DocumentReader, DocumentReaderResult };
