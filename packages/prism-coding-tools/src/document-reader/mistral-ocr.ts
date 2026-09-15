/**
 * Optional Mistral Document AI OCR parser. Host-selected only — never wired
 * into default `createDocumentReader()`. Native fetch (no SDK peer). Inline
 * base64 by default so nothing is uploaded to the Files API (no cleanup).
 */

import { assertSsrfAllowedUrl, pinnedFetch, type SsrfPolicy } from "@arnilo/prism";
import { DocumentReaderError } from "./errors.js";
import type { DocumentParser } from "./index.js";

export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";
export const DEFAULT_OCR_BASE_URL = "https://api.mistral.ai";
export const DEFAULT_OCR_TIMEOUT_MS = 60_000;
export const HARD_OCR_TIMEOUT_MS = 180_000;
export const DEFAULT_OCR_MAX_BYTES = 8 * 1024 * 1024;
export const HARD_OCR_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_OCR_MAX_PAGES = 32;
export const HARD_OCR_MAX_PAGES = 10_000;
export const DEFAULT_OCR_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const HARD_OCR_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_OCR_MAX_CONCURRENT = 1;
export const HARD_OCR_MAX_CONCURRENT = 4;

const PDF_MAGIC = "%PDF-";

export interface OcrUsage {
  readonly model: string;
  readonly pagesProcessed: number;
  readonly bytes: number;
}

export interface OcrPageSpan {
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

export interface CreateMistralOcrParserOptions {
  /** Mistral API key. Required. Never read from the environment. */
  readonly apiKey: string;
  /** OCR model alias. Default `mistral-ocr-latest`. */
  readonly model?: string;
  /** API origin (residency). Default `https://api.mistral.ai`. */
  readonly baseUrl?: string;
  /**
   * Host-authorized document URL Mistral should fetch. SSRF-checked.
   * When omitted, the buffer is sent as a data URL (no Files API upload).
   */
  readonly documentUrl?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxPages?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrent?: number;
  readonly ssrf?: SsrfPolicy;
  /** Host transport; host owns DNS/SSRF when set. */
  readonly fetch?: typeof globalThis.fetch;
  /** Task 7 admission hook. Called after a successful HTTP 200, before over-page refusal. */
  readonly recordUsage?: (usage: OcrUsage) => void | Promise<void>;
}

function cap(name: string, value: number, hard: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > hard) {
    throw new RangeError(`mistral-ocr ${name} must be an integer in (0, ${hard}], got ${value}`);
  }
  return value;
}

function detectKind(buffer: Buffer): "pdf" | "image" | null {
  if (buffer.length >= PDF_MAGIC.length && buffer.toString("latin1", 0, PDF_MAGIC.length) === PDF_MAGIC) return "pdf";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image";
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") return "image";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image";
  }
  return null;
}

function imageMediaType(buffer: Buffer): string {
  if (buffer[0] === 0x89) return "image/png";
  if (buffer[0] === 0xff) return "image/jpeg";
  if (buffer.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return "image/webp";
}

function originUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new DocumentReaderError("mistral-ocr baseUrl must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DocumentReaderError("mistral-ocr baseUrl must use http(s)");
  }
  if (url.username || url.password) throw new DocumentReaderError("mistral-ocr baseUrl must not embed credentials");
  if (url.hash) throw new DocumentReaderError("mistral-ocr baseUrl must not contain a fragment");
  try {
    assertSsrfAllowedUrl(url.href);
  } catch (error) {
    throw new DocumentReaderError("mistral-ocr baseUrl is not allowed", { cause: error });
  }
  return url;
}

function limiter(max: number) {
  let active = 0;
  const wait: Array<() => void> = [];
  return {
    async acquire(signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted();
      while (active >= max) {
        await new Promise<void>((resolve, reject) => {
          const resume = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          };
          const onAbort = () => {
            const i = wait.indexOf(resume);
            if (i >= 0) wait.splice(i, 1);
            reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          };
          wait.push(resume);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
        signal?.throwIfAborted();
      }
      active += 1;
    },
    release(): void {
      active -= 1;
      wait.shift()?.();
    },
  };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

interface OcrPage {
  readonly index?: number;
  readonly markdown?: string;
}

function parseOcrBody(body: unknown): { pages: OcrPage[]; model: string; pagesProcessed: number } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DocumentReaderError("mistral-ocr: invalid response");
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.pages) || record.pages.length === 0) throw new DocumentReaderError("mistral-ocr: invalid response");
  const pages: OcrPage[] = [];
  for (const page of record.pages) {
    if (typeof page !== "object" || page === null) throw new DocumentReaderError("mistral-ocr: invalid response");
    const row = page as Record<string, unknown>;
    pages.push({
      index: typeof row.index === "number" ? row.index : undefined,
      markdown: typeof row.markdown === "string" ? row.markdown : undefined,
    });
  }
  const usage = record.usage_info;
  const pagesProcessed =
    typeof usage === "object" && usage !== null && typeof (usage as { pages_processed?: unknown }).pages_processed === "number"
      ? (usage as { pages_processed: number }).pages_processed
      : pages.length;
  return {
    pages,
    model: typeof record.model === "string" ? record.model : DEFAULT_OCR_MODEL,
    pagesProcessed,
  };
}

function assemblePages(
  pages: readonly OcrPage[],
  maxTextBytes: number,
): { text: string; pageSpans: OcrPageSpan[]; truncatedBy: "bytes" | null } {
  const spans: OcrPageSpan[] = [];
  let text = "";
  for (let i = 0; i < pages.length; i += 1) {
    const markdown = pages[i]?.markdown ?? "";
    const page = pages[i]?.index ?? i + 1;
    const chunk = `${i === 0 ? "" : "\n\n"}<!-- prism-page ${page} -->\n${markdown}`;
    const next = text + chunk;
    if (Buffer.byteLength(next, "utf8") > maxTextBytes) {
      const buf = Buffer.from(next, "utf8").subarray(0, maxTextBytes).toString("utf8");
      spans.push({ page, start: text.length, end: buf.length });
      return { text: buf, pageSpans: spans, truncatedBy: "bytes" };
    }
    spans.push({ page, start: text.length, end: next.length });
    text = next;
  }
  return { text, pageSpans: spans, truncatedBy: null };
}

/**
 * Host-selected OCR/layout parser. Not a default `createDocumentReader` parser.
 * Extracted content is untrusted inert text.
 */
export function createMistralOcrParser(options: CreateMistralOcrParserOptions): DocumentParser {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new DocumentReaderError("mistral-ocr requires apiKey");
  const model = options.model?.trim() || DEFAULT_OCR_MODEL;
  const origin = originUrl(options.baseUrl?.trim() || DEFAULT_OCR_BASE_URL);
  const timeoutMs = cap("timeoutMs", options.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS, HARD_OCR_TIMEOUT_MS);
  const maxBytes = cap("maxBytes", options.maxBytes ?? DEFAULT_OCR_MAX_BYTES, HARD_OCR_MAX_BYTES);
  const parserMaxPages = cap("maxPages", options.maxPages ?? DEFAULT_OCR_MAX_PAGES, HARD_OCR_MAX_PAGES);
  const maxResponseBytes = cap("maxResponseBytes", options.maxResponseBytes ?? DEFAULT_OCR_MAX_RESPONSE_BYTES, HARD_OCR_MAX_RESPONSE_BYTES);
  const maxConcurrent = cap("maxConcurrent", options.maxConcurrent ?? DEFAULT_OCR_MAX_CONCURRENT, HARD_OCR_MAX_CONCURRENT);
  const documentUrl = options.documentUrl?.trim();
  if (documentUrl) {
    try {
      assertSsrfAllowedUrl(documentUrl, options.ssrf);
    } catch (error) {
      throw new DocumentReaderError("mistral-ocr documentUrl is not allowed", { cause: error });
    }
  }
  const gate = limiter(maxConcurrent);
  const transport = options.fetch;

  return {
    format: "ocr",
    detect: (buffer) => detectKind(buffer) !== null,
    extract: async (buffer, { maxPages, maxTextBytes, signal }) => {
      signal?.throwIfAborted();
      if (buffer.byteLength > maxBytes) {
        throw new DocumentReaderError(`mistral-ocr document exceeds maxBytes cap (${maxBytes})`);
      }
      const kind = detectKind(buffer);
      if (!kind) throw new DocumentReaderError("mistral-ocr: buffer is not a PDF or image");
      const pageCap = Math.min(maxPages, parserMaxPages);
      const endpoint = new URL("/v1/ocr", origin);
      const document = documentUrl
        ? kind === "pdf"
          ? { type: "document_url", document_url: documentUrl }
          : { type: "image_url", image_url: documentUrl }
        : kind === "pdf"
          ? { type: "document_url", document_url: `data:application/pdf;base64,${buffer.toString("base64")}` }
          : { type: "image_url", image_url: `data:${imageMediaType(buffer)};base64,${buffer.toString("base64")}` };
      const payload = JSON.stringify({
        model,
        document,
        include_image_base64: false,
      });
      await gate.acquire(signal);
      const timed = withTimeout(signal, timeoutMs);
      try {
        const init: RequestInit = {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: payload,
          signal: timed.signal,
        };
        const response = transport
          ? await transport(endpoint, init)
          : await pinnedFetch(endpoint, init, {
              errorPrefix: "mistral-ocr",
              ssrf: options.ssrf,
              maxResponseBytes,
            });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new DocumentReaderError(`mistral-ocr HTTP ${response.status}`);
        }
        const raw = Buffer.from(await response.arrayBuffer());
        if (raw.byteLength > maxResponseBytes) {
          throw new DocumentReaderError(`mistral-ocr response exceeds maxResponseBytes cap (${maxResponseBytes})`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch {
          throw new DocumentReaderError("mistral-ocr: invalid response");
        }
        const body = parseOcrBody(parsed);
        await options.recordUsage?.({
          model: body.model,
          pagesProcessed: body.pagesProcessed,
          bytes: buffer.byteLength,
        });
        if (body.pages.length > pageCap) {
          throw new DocumentReaderError(`document has ${body.pages.length} pages, exceeds maxPages cap (${pageCap}); refusing to extract`);
        }
        const assembled = assemblePages(body.pages, maxTextBytes);
        return {
          text: assembled.text,
          pages: body.pages.length,
          truncatedBy: assembled.truncatedBy,
          pageSpans: assembled.pageSpans,
        };
      } finally {
        timed.dispose();
        gate.release();
      }
    },
  };
}
