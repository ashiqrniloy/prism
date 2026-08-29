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
  // Index-scanned BT..ET block extraction instead of /BT[\s\S]*?ET/gu (CodeQL js/polynomial-redos, alert 11).
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < pdf.length) {
    const begin = pdf.indexOf("BT", cursor);
    if (begin === -1) break;
    const end = pdf.indexOf("ET", begin + 2);
    if (end === -1) break;
    blocks.push(pdf.slice(begin, end + 2));
    cursor = end + 2;
  }
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

// Single-pass linear HTML-to-text scanner (CodeQL js/incomplete-multi-character-sanitization
// and js/polynomial-redos on the former regex chain, alerts 17-19): comments, script/style
// bodies, and tags are consumed by index — hostile adjacency cannot re-form dangerous tags.
function htmlToText(html: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.charCodeAt(i) === 60) {
      const gt = html.indexOf(">", i + 1);
      if (gt === -1) {
        out.push(html.slice(i));
        break;
      }
      const tag = html.slice(i + 1, gt);
      i = gt + 1;
      const closing = tag.startsWith("/");
      const name = (closing ? tag.slice(1) : tag).match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? "";
      if (closing) {
        out.push(" ");
      } else if (name === "br" || name === "p" || name === "div" || name === "li" || name === "tr" || /^h[1-6]$/u.test(name)) {
        out.push("\n");
      } else if (name === "script" || name === "style") {
        // Consume the raw element body through its matching close tag.
        const closeIdx = html.toLowerCase().indexOf(`</${name}`, i);
        const next = closeIdx === -1 ? html.length : html.indexOf(">", closeIdx);
        i = next === -1 ? html.length : next + 1;
      } else {
        out.push(" ");
      }
      continue;
    }
    out.push(html[i++]);
  }
  return collapseTextWhitespace(decodeEntities(out.join(""))).trim();
}

/** Linear whitespace normalization: `[ \t]` runs collapse; 3+ newlines collapse to 2; edge spaces drop. */
function collapseTextWhitespace(text: string): string {
  const out: string[] = [];
  let i = 0;
  let lineStart = true;
  let spaceRun = false;
  let newlineRun = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t") {
      if (!lineStart) spaceRun = true;
      i += 1;
      continue;
    }
    if (c === "\n") {
      newlineRun += 1;
      spaceRun = false;
      lineStart = true;
      i += 1;
      continue;
    }
    if (newlineRun > 0) {
      out.push("\n".repeat(Math.min(newlineRun, 2)));
      newlineRun = 0;
    } else if (spaceRun) {
      out.push(" ");
      spaceRun = false;
    }
    lineStart = false;
    out.push(c);
    i += 1;
  }
  if (newlineRun > 0) out.push("\n".repeat(Math.min(newlineRun, 2)));
  return out.join("");
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return text.replace(/&([a-z]+|#39);/giu, (_match, name: string) => entities[name.toLowerCase()] ?? `&${name};`);
}

function pdfBlockText(block: string): string[] {
  const strings: string[] = [];
  // Linear index scanners replace ambiguous nested-quantifier regexes (CodeQL js/polynomial-redos, alerts 15-16, 20-21).
  const extractLiteral = (text: string, from: number): { literal: string; next: number } | undefined => {
    const open = text.indexOf("(", from);
    if (open === -1) return undefined;
    let i = open + 1;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === ")") return { literal: text.slice(open + 1, i), next: i + 1 };
      i += 1;
    }
    return undefined; // unterminated literal - ignore
  };

  let cursor = 0;
  while (cursor < block.length) {
    const literal = extractLiteral(block, cursor);
    if (!literal) break;
    let j = literal.next;
    while (j < block.length && /\s/.test(block[j])) j += 1;
    if (block[j] === "T" && block[j + 1] === "j") {
      strings.push(decodePdfString(`(${literal.literal})`));
      cursor = j + 2;
    } else if (block[j] === "'" || block[j] === '"') {
      strings.push(decodePdfString(`(${literal.literal})`));
      cursor = j + 1;
    } else {
      cursor = literal.next;
    }
  }

  cursor = 0;
  while (cursor < block.length) {
    const open = block.indexOf("[", cursor);
    if (open === -1) break;
    const close = block.indexOf("]", open + 1);
    if (close === -1) break;
    let j = close + 1;
    while (j < block.length && /\s/.test(block[j])) j += 1;
    if (block.startsWith("TJ", j)) {
      const arr = block.slice(open + 1, close);
      let arrCursor = 0;
      for (;;) {
        const literal = extractLiteral(arr, arrCursor);
        if (!literal) break;
        strings.push(decodePdfString(`(${literal.literal})`));
        arrCursor = literal.next;
      }
      cursor = j + 2;
    } else {
      cursor = open + 1;
    }
  }
  return strings.filter(Boolean);
}

function decodePdfString(value: string): string {
  return value.slice(1, -1).replace(/\\([0-7]{1,3}|[nrtbf()\\])/gu, (_match, escape: string) => {
    if (/^[0-7]+$/u.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[escape]!;
  });
}
