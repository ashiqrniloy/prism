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
import { reviveWorkerTaskError, runInPool, shouldOffloadToPool } from "../runtime/worker-pool.js";
import { DocumentReaderError } from "./errors.js";
import { createDocxParser, createOoxmlParser, createPdfParser } from "./parsers.js";

export { DocumentReaderError };
export { createDocxParser, createPdfParser } from "./parsers.js";

/** Structural reader contract accepted by coding-tools' host injection seam. */
export interface DocumentReader {
  readonly maxInputBytes: number;
  readonly maxTextBytes: number;
  extract(input: {
    readonly buffer: Uint8Array;
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<DocumentReaderResult | null>;
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

/** Host-selected per-format parser implementation. */
export interface DocumentParser {
  readonly format: string;
  /**
   * Cheap magic-byte gate; false means "this buffer is not my format" (never reaches the parser).
   * Receives `Uint8Array` so a worker-shaped payload works without a `Buffer.from` wrap; every
   * `Buffer`-only helper (`toString`, `includes`) must go through a view first.
   */
  detect(bytes: Uint8Array): boolean;
  /**
   * Extract literal text. Must never execute embedded content or fetch
   * external resources. Over-page documents must refuse; over-text results
   * must be truncated with `truncatedBy: "bytes"`.
   */
  extract(
    bytes: Uint8Array,
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
  const usesDefaultParsers = options.parsers === undefined;
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
      // Plan 127 Task 3 + further action #1: the 250-378 ms default-parser extract runs on the pool
      // for large buffers, priced in both directions — bytes in at the flat clone rate, and one text
      // value plus up to `maxPages` page spans back (a cloned string is shared rather than copied:
      // 27 KiB and 2 MB text payloads both clone in ~0.06 ms, evidence §12). The inline estimate is
      // the measured ~1 ms per KiB of PDF (§3: 250-378 ms for the 281 KiB fixture).
      // Host-supplied parsers are functions and stay in-process; caps, redaction and the result
      // shape stay here. The parser itself never honors a mid-parse abort either, so checking the
      // signal before and after preserves the existing observable behavior.
      let result: Omit<DocumentReaderResult, "format">;
      if (
        usesDefaultParsers &&
        shouldOffloadToPool({
          inputBytes: input.buffer.byteLength,
          resultValues: 1 + maxPages * 4,
          computeMs: input.buffer.byteLength / 1024,
        })
      ) {
        try {
          result = await runInPool({
            kind: "document.extract",
            payload: { format: parser.format, bytes: input.buffer, maxPages, maxTextBytes },
          });
        } catch (error) {
          throw reviveWorkerTaskError(error, [DocumentReaderError]) ?? error;
        }
      } else {
        result = await parser.extract(input.buffer, { maxPages, maxTextBytes, signal: input.signal });
      }
      input.signal?.throwIfAborted();
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
