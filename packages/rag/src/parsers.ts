import { RagLimitError, RagValidationError } from "./errors.js";
import { resolveRagLimits } from "./limits.js";
import type { DocumentParseOptions, LoadedDocument, ParsedDocument, Parser } from "./types.js";
import { assertNotAborted } from "./util.js";

export const textParser: Parser = { parse: (document, options) => parseText(document, options, ["text/plain"]) };
export const markdownParser: Parser = { parse: (document, options) => parseText(document, options, ["text/markdown", "text/x-markdown"]) };
export const htmlParser: Parser = {
  parse: (document, options) => parseText(document, options, ["text/html", "application/xhtml+xml"], htmlToText),
};
export const pdfParser: Parser = { parse: parsePdf };

async function parseText(
  document: LoadedDocument,
  options: DocumentParseOptions = {},
  mediaTypes: readonly string[],
  transform: (text: string) => string = (text) => text,
): Promise<ParsedDocument> {
  assertMediaType(document, mediaTypes);
  const { bytes, limits, started } = boundedDocument(document, options);
  assertNotAborted(options.signal);
  let text: string;
  try {
    text = document.text ?? new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RagValidationError("document is not valid UTF-8 text");
  }
  const parsed = transform(text);
  assertParseTime(started, limits.maxParseMs);
  assertNotAborted(options.signal);
  return Object.freeze({ text: parsed, ...(document.metadata ? { metadata: document.metadata } : {}) });
}

async function parsePdf(document: LoadedDocument, options: DocumentParseOptions = {}): Promise<ParsedDocument> {
  assertMediaType(document, ["application/pdf"]);
  const { bytes, limits, started } = boundedDocument(document, options);
  if (document.text !== undefined) throw new RagValidationError("PDF parser requires binary document data");
  const pdf = Buffer.from(bytes).toString("latin1");
  if (!pdf.startsWith("%PDF-")) throw new RagValidationError("document is not a PDF");
  if (/\/Filter\s*\//u.test(pdf)) throw new RagValidationError("compressed PDFs require a host parser");
  const pages = [...pdf.matchAll(/\/Type\s*\/Page\b/gu)].length;
  if (pages > limits.maxPdfPages) throw new RagLimitError(`PDF exceeds ${limits.maxPdfPages} pages`);
  const blocks = pdf.match(/BT[\s\S]*?ET/gu) ?? [];
  const text = blocks.flatMap(pdfBlockText).join("\n").trim();
  if (!text) throw new RagValidationError("PDF has no uncompressed text");
  assertParseTime(started, limits.maxParseMs);
  assertNotAborted(options.signal);
  return Object.freeze({ text, ...(document.metadata ? { metadata: document.metadata } : {}) });
}

function boundedDocument(document: LoadedDocument, options: DocumentParseOptions) {
  assertNotAborted(options.signal);
  const limits = resolveRagLimits({
    maxDocumentBytes: options.maxBytes,
    maxParseMs: options.maxParseMs,
    maxPdfPages: options.maxPages,
  });
  const bytes = document.data ?? Buffer.from(document.text ?? "", "utf8");
  if (bytes.byteLength > limits.maxDocumentBytes) throw new RagLimitError(`document exceeds ${limits.maxDocumentBytes} bytes`);
  return { bytes, limits, started: Date.now() };
}

function assertMediaType(document: LoadedDocument, expected: readonly string[]): void {
  if (document.mediaType && !expected.includes(document.mediaType.toLowerCase())) {
    throw new RagValidationError(`parser does not accept ${document.mediaType}`);
  }
}

function assertParseTime(started: number, maxParseMs: number): void {
  if (Date.now() - started > maxParseMs) throw new RagLimitError(`document parsing exceeded ${maxParseMs}ms`);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
      .replace(/<(?:br|p|div|li|h[1-6]|tr)\b[^>]*>/giu, "\n")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return text.replace(/&([a-z]+|#39);/giu, (_match, name: string) => entities[name.toLowerCase()] ?? `&${name};`);
}

function pdfBlockText(block: string): string[] {
  const strings: string[] = [];
  for (const match of block.matchAll(/\((?:\\.|[^\\)])*\)\s*(?:Tj|['"])/gu))
    strings.push(decodePdfString(match[0]!.replace(/\s*(?:Tj|['"])$/u, "")));
  for (const match of block.matchAll(/\[([\s\S]*?)\]\s*TJ/gu)) {
    for (const value of match[1]!.matchAll(/\((?:\\.|[^\\)])*\)/gu)) strings.push(decodePdfString(value[0]!));
  }
  return strings.filter(Boolean);
}

function decodePdfString(value: string): string {
  return value.slice(1, -1).replace(/\\([0-7]{1,3}|[nrtbf()\\])/gu, (_match, escape: string) => {
    if (/^[0-7]+$/u.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[escape]!;
  });
}
