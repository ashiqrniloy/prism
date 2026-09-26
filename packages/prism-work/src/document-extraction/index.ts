/**
 * Optional local Markdown extraction via `@firecrawl/anydoc`.
 *
 * The peer loads only when `createDocumentExtractor()` runs. This module never
 * passes `ocr: 'hosted'`, never reads `FIRECRAWL_API_KEY`, and never spawns a
 * process. Docling runs only when the host injects a runner, and only for an
 * anydoc `needsOcr` PDF or an explicit image OCR call.
 */
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_EXTRACTION_BYTES = 32 * 1024 * 1024;
export const HARD_MAX_EXTRACTION_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_EXTRACTION_TEXT_BYTES = 2 * 1024 * 1024;
export const HARD_MAX_EXTRACTION_TEXT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_OCR_PAGES = 32;
export const HARD_MAX_OCR_PAGES = 256;
export const DEFAULT_OCR_TIMEOUT_MS = 120_000;
export const HARD_OCR_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_OCR_STDERR_BYTES = 1024 * 1024;
export const HARD_MAX_OCR_STDERR_BYTES = 4 * 1024 * 1024;

/** Packaged helper. Host runner executes it; this module does not. */
export const doclingOcrHelperPath = fileURLToPath(new URL("../../docling/ocr.py", import.meta.url));

const IMAGE_FORMATS = ["png", "jpeg", "webp", "bmp", "tiff"] as const;
type ImageFormat = (typeof IMAGE_FORMATS)[number];
type OcrFormat = "pdf" | ImageFormat;

const MISSING_PEER =
  'optional peer "@firecrawl/anydoc" is not installed. Install it (bun add @firecrawl/anydoc) to use @arnilo/prism-work/document-extraction';

const REASON_MESSAGE = {
  needsOcr: "document needs OCR",
  unsupported: "document format is unsupported",
  encrypted: "document is encrypted",
  malformed: "document is malformed",
  resourceLimit: "document exceeds an extractor resource limit",
  missingPart: "document is missing a required part",
  io: "document extraction failed",
  hosted: "hosted document extraction is disabled",
  missingPeer: MISSING_PEER,
  inputLimit: "document exceeds maxBytes cap",
  outputLimit: "extracted markdown exceeds maxTextBytes cap",
  busy: "document extraction is busy",
} as const;

export type DocumentExtractionReason = keyof typeof REASON_MESSAGE;

const UPSTREAM = new Set<string>(["unsupported", "malformed", "encrypted", "resourceLimit", "missingPart", "io", "hosted"]);

export class DocumentExtractionError extends Error {
  readonly code = "ERR_PRISM_DOCUMENT_EXTRACTION";
  readonly reason: DocumentExtractionReason;
  constructor(reason: DocumentExtractionReason, message?: string) {
    super(message ?? REASON_MESSAGE[reason]);
    this.name = "DocumentExtractionError";
    this.reason = reason;
  }
}

/** Scanned or image-only PDF. No markdown. Pages are 1-indexed when the peer reported them. */
export class NeedsOcrError extends DocumentExtractionError {
  readonly pages: readonly number[];
  readonly pageCount: number;
  constructor(pages: readonly number[], pageCount: number) {
    super("needsOcr");
    this.name = "NeedsOcrError";
    this.pages = pages;
    this.pageCount = pageCount;
  }
}

export interface DocumentExtractionResult {
  readonly markdown: string;
  readonly format: string;
  /** True only after a host Docling runner returns ConversionStatus.SUCCESS. */
  readonly ocrUsed: boolean;
  /** Present only when Docling reported `document.num_pages()`. */
  readonly pages?: number;
}

export interface DocumentExtractor {
  readonly maxInputBytes: number;
  readonly maxTextBytes: number;
  extract(input: {
    readonly bytes: Uint8Array;
    readonly filename?: string;
    /** Image OCR only. Ignored for formats anydoc converts. PDFs OCR on `needsOcr`, not this flag. */
    readonly ocr?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<DocumentExtractionResult>;
}

export interface OcrWorkerRequest {
  readonly bytes: Uint8Array;
  readonly format: OcrFormat;
  readonly maxPages: number;
  readonly maxBytes: number;
  readonly maxTextBytes: number;
  readonly timeoutMs: number;
  readonly maxStderrBytes: number;
  readonly signal?: AbortSignal;
  readonly helperPath: string;
}

export interface OcrWorkerResult {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut?: boolean;
  readonly aborted?: boolean;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
}

/** Host-owned worker. Must kill the process on abort and when a byte cap trips. */
export type OcrRunner = (request: OcrWorkerRequest) => Promise<OcrWorkerResult>;

export interface CreateDocumentExtractorOptions {
  readonly maxBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxPages?: number;
  readonly ocrTimeoutMs?: number;
  readonly maxStderrBytes?: number;
  /** Absent: scanned PDFs throw `NeedsOcrError` and images stay unsupported. */
  readonly ocr?: OcrRunner;
}

interface AnydocApi {
  formatFromBytes(bytes: Uint8Array): string | null;
  formatFromExtension(extension: string): string | null;
  toMarkdownBytes(bytes: Uint8Array, format?: string | null): Promise<string>;
}

function validateCap(name: string, value: number, hard: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > hard) {
    throw new RangeError(`document-extraction ${name} must be an integer in (0, ${hard}], got ${value}`);
  }
  return value;
}

function isCsvName(filename: string | undefined): boolean {
  if (!filename) return false;
  const base = filename.split(/[/\\]/).pop() ?? "";
  return base.length > ".csv".length && base.toLowerCase().endsWith(".csv") && !base.includes("\0");
}

function pagesOf(error: object): { pages: number[]; pageCount: number } {
  const raw = "pages" in error ? error.pages : undefined;
  const pages = Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n) && n > 0 && n <= 100_000).slice(0, 10_000) : [];
  const count = "pageCount" in error ? error.pageCount : undefined;
  const pageCount = Number.isInteger(count) && (count as number) >= 0 && (count as number) <= 100_000 ? (count as number) : pages.length;
  return { pages, pageCount };
}

function mapError(error: unknown): DocumentExtractionError {
  if (error instanceof DocumentExtractionError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "needsOcr" && error !== null && typeof error === "object") {
    const { pages, pageCount } = pagesOf(error);
    return new NeedsOcrError(pages, pageCount);
  }
  const reason = typeof code === "string" && UPSTREAM.has(code) ? (code as DocumentExtractionReason) : "io";
  return new DocumentExtractionError(reason);
}

async function loadAnydoc(): Promise<AnydocApi> {
  try {
    const mod = (await import("@firecrawl/anydoc")) as Partial<AnydocApi>;
    if (
      typeof mod.toMarkdownBytes !== "function" ||
      typeof mod.formatFromBytes !== "function" ||
      typeof mod.formatFromExtension !== "function"
    ) {
      throw new DocumentExtractionError("missingPeer");
    }
    return mod as AnydocApi;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("missingPeer");
  }
}

function createSlot() {
  let running: Promise<void> | null = null;
  let waiting = false;
  return async function occupy(signal?: AbortSignal): Promise<() => void> {
    for (;;) {
      signal?.throwIfAborted();
      if (!running) {
        let release!: () => void;
        running = new Promise((resolve) => {
          release = () => {
            running = null;
            resolve();
          };
        });
        return release;
      }
      if (waiting) throw new DocumentExtractionError("busy");
      const current = running;
      waiting = true;
      try {
        await waitTurn(current, signal);
      } finally {
        waiting = false;
      }
    }
  };
}

function waitTurn(running: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return running;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    running.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function detectImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
  ) {
    return "tiff";
  }
  return null;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new DOMException("The operation was aborted", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR");
}

const OCR_ERROR: Record<string, DocumentExtractionReason> = {
  over_page: "resourceLimit",
  input_limit: "resourceLimit",
  output_limit: "outputLimit",
  partial: "io",
  missing_models: "io",
  unsupported: "unsupported",
  io: "io",
};

function stdoutCap(maxTextBytes: number): number {
  return maxTextBytes * 6 + 64 * 1024;
}

function ocrFailure(stdout: Uint8Array): DocumentExtractionError {
  let code: unknown;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(stdout).toString("utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "error" in parsed) {
      code = parsed.error;
    }
  } catch {
    code = undefined;
  }
  const reason = typeof code === "string" ? OCR_ERROR[code] : undefined;
  return new DocumentExtractionError(reason ?? "io");
}

/** Argv for the packaged helper. Bytes stay on stdin. Rejects URL artifacts. */
export function doclingOcrArgs(request: OcrWorkerRequest, artifactsPath: string): string[] {
  if (!artifactsPath || /[\0\r\n]/.test(artifactsPath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(artifactsPath)) {
    throw new DocumentExtractionError("unsupported");
  }
  return [
    request.helperPath,
    "--format",
    request.format,
    "--max-pages",
    String(request.maxPages),
    "--max-bytes",
    String(request.maxBytes),
    "--max-text-bytes",
    String(request.maxTextBytes),
    "--timeout-s",
    String(Math.max(1, Math.ceil(request.timeoutMs / 1000))),
    "--artifacts",
    artifactsPath,
  ];
}

async function runOcr(
  runner: OcrRunner,
  bytes: Uint8Array,
  format: OcrFormat,
  limits: { maxPages: number; maxBytes: number; maxTextBytes: number; timeoutMs: number; maxStderrBytes: number },
  signal?: AbortSignal,
): Promise<DocumentExtractionResult> {
  signal?.throwIfAborted();
  let result: OcrWorkerResult;
  try {
    result = await runner({
      bytes,
      format,
      maxPages: limits.maxPages,
      maxBytes: limits.maxBytes,
      maxTextBytes: limits.maxTextBytes,
      timeoutMs: limits.timeoutMs,
      maxStderrBytes: limits.maxStderrBytes,
      signal,
      helperPath: doclingOcrHelperPath,
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw isAbort(error) ? error : abortError(signal);
    throw new DocumentExtractionError("io");
  }
  if (result.aborted || signal?.aborted) throw abortError(signal);
  if (result.timedOut) throw new DocumentExtractionError("resourceLimit");
  if (!(result.stdout instanceof Uint8Array) || !(result.stderr instanceof Uint8Array)) {
    throw new DocumentExtractionError("io");
  }
  if (result.stdoutTruncated || result.stderrTruncated || result.stderr.byteLength > limits.maxStderrBytes) {
    throw new DocumentExtractionError("io");
  }
  if (result.stdout.byteLength > stdoutCap(limits.maxTextBytes)) {
    throw new DocumentExtractionError("outputLimit");
  }
  if (result.exitCode !== 0) throw ocrFailure(result.stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(result.stdout).toString("utf8"));
  } catch {
    throw new DocumentExtractionError("io");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || !("ok" in parsed) || parsed.ok !== true) {
    throw ocrFailure(result.stdout);
  }
  const markdown = "markdown" in parsed ? parsed.markdown : undefined;
  const pages = "pages" in parsed ? parsed.pages : undefined;
  if (typeof markdown !== "string" || !Number.isInteger(pages) || (pages as number) < 1 || (pages as number) > limits.maxPages) {
    throw new DocumentExtractionError("io");
  }
  if (Buffer.byteLength(markdown, "utf8") > limits.maxTextBytes) {
    throw new DocumentExtractionError("outputLimit");
  }
  return { markdown, format, ocrUsed: true, pages: pages as number };
}

export async function createDocumentExtractor(options: CreateDocumentExtractorOptions = {}): Promise<DocumentExtractor> {
  const maxBytes = validateCap("maxBytes", options.maxBytes ?? DEFAULT_MAX_EXTRACTION_BYTES, HARD_MAX_EXTRACTION_BYTES);
  const maxTextBytes = validateCap(
    "maxTextBytes",
    options.maxTextBytes ?? DEFAULT_MAX_EXTRACTION_TEXT_BYTES,
    HARD_MAX_EXTRACTION_TEXT_BYTES,
  );
  const maxPages = validateCap("maxPages", options.maxPages ?? DEFAULT_MAX_OCR_PAGES, HARD_MAX_OCR_PAGES);
  const ocrTimeoutMs = validateCap("ocrTimeoutMs", options.ocrTimeoutMs ?? DEFAULT_OCR_TIMEOUT_MS, HARD_OCR_TIMEOUT_MS);
  const maxStderrBytes = validateCap("maxStderrBytes", options.maxStderrBytes ?? DEFAULT_MAX_OCR_STDERR_BYTES, HARD_MAX_OCR_STDERR_BYTES);
  if (options.ocr !== undefined && typeof options.ocr !== "function") {
    throw new TypeError("document extraction ocr runner must be a function");
  }
  const runner = options.ocr;
  const limits = { maxPages, maxBytes, maxTextBytes, timeoutMs: ocrTimeoutMs, maxStderrBytes };
  const anydoc = await loadAnydoc();
  const occupy = createSlot();

  return {
    maxInputBytes: maxBytes,
    maxTextBytes,
    extract: async (input) => {
      input.signal?.throwIfAborted();
      if (!(input.bytes instanceof Uint8Array)) {
        throw new TypeError("document extraction bytes must be a Uint8Array");
      }
      if (input.filename !== undefined && typeof input.filename !== "string") {
        throw new TypeError("document extraction filename must be a string");
      }
      if (input.ocr !== undefined && typeof input.ocr !== "boolean") {
        throw new TypeError("document extraction ocr must be a boolean");
      }
      if (input.bytes.byteLength > maxBytes) {
        throw new DocumentExtractionError("inputLimit", `${REASON_MESSAGE.inputLimit} (${maxBytes})`);
      }
      const release = await occupy(input.signal);
      try {
        input.signal?.throwIfAborted();
        // Copy so a subarray cannot expose a larger backing buffer to native code.
        const bytes = new Uint8Array(input.bytes);
        const image = input.ocr === true ? detectImage(bytes) : null;
        if (image) {
          if (!runner) throw new NeedsOcrError([], 1);
          return await runOcr(runner, bytes, image, limits, input.signal);
        }
        const detected = anydoc.formatFromBytes(bytes);
        let format = detected;
        if (format === null) {
          if (!isCsvName(input.filename) || anydoc.formatFromExtension(".csv") !== "csv") {
            throw new DocumentExtractionError("unsupported");
          }
          format = "csv";
        }
        let markdown: string;
        try {
          // Two arguments only. A third argument is ConvertOptions and can set ocr:'hosted'.
          markdown = await anydoc.toMarkdownBytes(bytes, format);
        } catch (error) {
          const mapped = mapError(error);
          if (mapped instanceof NeedsOcrError && format === "pdf" && runner) {
            if (mapped.pageCount > maxPages) throw new DocumentExtractionError("resourceLimit");
            return await runOcr(runner, bytes, "pdf", limits, input.signal);
          }
          throw mapped;
        }
        input.signal?.throwIfAborted();
        if (typeof markdown !== "string") throw new DocumentExtractionError("io");
        if (Buffer.byteLength(markdown, "utf8") > maxTextBytes) {
          throw new DocumentExtractionError("outputLimit", `${REASON_MESSAGE.outputLimit} (${maxTextBytes})`);
        }
        return { markdown, format, ocrUsed: false };
      } finally {
        release();
      }
    },
  };
}

export interface DocumentIngestStats {
  readonly extractions: number;
  readonly ocrCount: number;
  readonly durationMs: number;
}

export interface DocumentIngest {
  /** Wiki `extractDocument` hook. Throws on extractor failure; does not return partial Markdown. */
  extractDocument(input: {
    readonly bytes: Uint8Array;
    readonly filename?: string;
    readonly mediaType?: string;
    readonly title?: string;
    readonly signal?: AbortSignal;
  }): Promise<{ text: string; format: string }>;
  /** RAG `Parser`. Metadata is trust plus provenance, never the Markdown body. */
  readonly parser: {
    parse(
      document: { readonly uri: string; readonly data?: Uint8Array; readonly mediaType?: string },
      options?: { readonly signal?: AbortSignal; readonly maxParseMs?: number },
    ): Promise<{ text: string; metadata: Record<string, string | number | boolean> }>;
  };
  /** True when image calls pass `ocr: true`. Hosts must set the same flag on wiki ingest. */
  readonly ocrImages: boolean;
  stats(): DocumentIngestStats;
}

const IMAGE_MEDIA = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"]);

function uriName(uri: string): string | undefined {
  const base = uri.split(/[/\\]/).pop();
  if (!base || base.includes("\0") || base.length > 255) return undefined;
  return base;
}

/** Host composition. Does not import the memory package. Counts and timings only — no document bodies. */
export function createDocumentIngest(
  extractor: Pick<DocumentExtractor, "extract">,
  options?: { readonly ocrImages?: boolean },
): DocumentIngest {
  if (typeof extractor?.extract !== "function") {
    throw new TypeError("document ingest requires an extractor");
  }
  const ocrImages = options?.ocrImages === true;
  let extractions = 0;
  let ocrCount = 0;
  let durationMs = 0;

  async function convert(input: {
    readonly bytes: Uint8Array;
    readonly filename?: string;
    readonly mediaType?: string;
    readonly signal?: AbortSignal;
  }): Promise<DocumentExtractionResult> {
    const started = Date.now();
    try {
      const image = ocrImages && (IMAGE_MEDIA.has(input.mediaType ?? "") || detectImage(input.bytes) !== null);
      return await extractor.extract({
        bytes: input.bytes,
        filename: input.filename,
        ...(image ? { ocr: true } : {}),
        signal: input.signal,
      });
    } finally {
      durationMs += Date.now() - started;
    }
  }

  return {
    ocrImages,
    stats: () => ({ extractions, ocrCount, durationMs }),
    extractDocument: async (input) => {
      const result = await convert(input);
      extractions += 1;
      if (result.ocrUsed) ocrCount += 1;
      return { text: result.markdown, format: result.format };
    },
    parser: {
      parse: async (document, parseOptions) => {
        if (!(document.data instanceof Uint8Array)) throw new DocumentExtractionError("io");
        const started = Date.now();
        const result = await convert({
          bytes: document.data,
          filename: uriName(document.uri),
          mediaType: document.mediaType,
          signal: parseOptions?.signal,
        });
        if (parseOptions?.maxParseMs !== undefined && Date.now() - started > parseOptions.maxParseMs) {
          throw new DocumentExtractionError("resourceLimit");
        }
        extractions += 1;
        if (result.ocrUsed) ocrCount += 1;
        return {
          text: result.markdown,
          metadata: {
            untrusted: true,
            inert: true,
            injectionCapable: true,
            format: result.format,
            ocrUsed: result.ocrUsed,
            uri: document.uri,
            ...(result.pages !== undefined ? { pages: result.pages } : {}),
          },
        };
      },
    },
  };
}
