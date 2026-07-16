import type { RagChunk, ChunkOptions } from "./types.js";
import { resolveRagLimits } from "./limits.js";
import { RagLimitError } from "./errors.js";
import { assertBytes, requireSourceId } from "./util.js";

export function chunkText(text: string, options: ChunkOptions): readonly RagChunk[] {
  return chunkDocument(text, options, false);
}

export function chunkMarkdown(markdown: string, options: ChunkOptions): readonly RagChunk[] {
  return chunkDocument(markdown, options, true);
}

function chunkDocument(text: string, options: ChunkOptions, markdown: boolean): readonly RagChunk[] {
  const sourceId = requireSourceId(options.sourceId);
  const limits = resolveRagLimits({
    chunkSize: options.size,
    chunkOverlap: options.overlap,
    maxDocumentChars: options.maxDocumentChars,
    maxChunks: options.maxChunks,
  });
  if (text.length > limits.maxDocumentChars) {
    throw new RagLimitError(`document exceeds ${limits.maxDocumentChars} characters`);
  }
  if (options.metadata) assertBytes(options.metadata, 64 * 1024, "chunk metadata");
  if (!text.trim()) return Object.freeze([]);

  const chunks: RagChunk[] = [];
  let start = 0;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start]!)) start += 1;
    if (start >= text.length) break;
    const ceiling = Math.min(start + limits.chunkSize, text.length);
    const end = ceiling === text.length ? ceiling : preferredEnd(text, start, ceiling, markdown);
    const raw = text.slice(start, end).trimEnd();
    if (raw) {
      const index = chunks.length;
      const citationId = `${sourceId}#${String(index + 1).padStart(4, "0")}`;
      chunks.push(Object.freeze({
        id: citationId,
        citationId,
        sourceId,
        index,
        start,
        end: start + raw.length,
        text: raw,
        ...(options.metadata ? { metadata: Object.freeze({ ...options.metadata }) } : {}),
      }));
      if (chunks.length > limits.maxChunks) throw new RagLimitError(`chunk count exceeds ${limits.maxChunks}`);
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - limits.chunkOverlap);
  }
  return Object.freeze(chunks);
}

function preferredEnd(text: string, start: number, ceiling: number, markdown: boolean): number {
  const floor = start + Math.floor((ceiling - start) / 2);
  const candidates = markdown ? ["\n#", "\n\n", "\n", " "] : ["\n\n", "\n", " "];
  for (const separator of candidates) {
    const found = text.lastIndexOf(separator, ceiling);
    if (found >= floor) return separator === "\n#" ? found : found + separator.length;
  }
  return ceiling;
}
