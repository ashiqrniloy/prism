import type { JsonObject } from "@arnilo/prism";
import type { MemoryVectorHit } from "@arnilo/prism-memory";
import { HARD_CHUNK_SIZE_CAP, resolveRagLimits } from "./limits.js";
import { RagScopeError, RagValidationError } from "./errors.js";
import type { RagCitation, RagContextResult, RagHit, RetrieveContextOptions } from "./types.js";
import {
  assertBytes,
  assertNotAborted,
  assertScope,
  byteLength,
  isJsonObject,
  matchesFilter,
  nonEmpty,
  requireScope,
  requireSourceId,
  resolveRedactor,
  truncateUtf8,
} from "./util.js";

export async function retrieveContext(query: string, options: RetrieveContextOptions): Promise<RagContextResult> {
  nonEmpty(query, "query");
  if (query.length > HARD_CHUNK_SIZE_CAP) {
    throw new RagValidationError(`query exceeds ${HARD_CHUNK_SIZE_CAP} characters`);
  }
  const scope = requireScope(options.scope);
  const limits = resolveRagLimits({
    topK: options.topK,
    queryCandidates: options.queryCandidates,
    maxResultBytes: options.maxResultBytes,
    maxContextTokens: options.maxContextTokens,
    maxMetadataBytes: options.maxMetadataBytes,
    maxVectorDimensions: options.maxVectorDimensions,
  });
  if (
    !Number.isInteger(options.embedder.dimensions)
    || options.embedder.dimensions <= 0
    || options.embedder.dimensions > limits.maxVectorDimensions
  ) {
    throw new RagValidationError(`embedder dimensions must be an integer in 1..${limits.maxVectorDimensions}`);
  }
  if (options.filter) assertBytes(options.filter, limits.maxMetadataBytes, "metadata filter");
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const safeQuery = redactor?.redact(query) ?? query;
  assertNotAborted(options.signal);
  const vectors = await options.embedder.embed([safeQuery], { signal: options.signal });
  const embedding = vectors[0];
  if (
    vectors.length !== 1
    || !embedding
    || embedding.length !== options.embedder.dimensions
    || embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new RagValidationError("embedder returned invalid query vector");
  }
  const candidates = await options.store.query({
    tenantId: scope.tenantId,
    resourceId: scope.resourceId,
    threadId: scope.corpusId,
    embedding,
    topK: limits.queryCandidates,
    signal: options.signal,
  });
  assertNotAborted(options.signal);

  const hits: RagHit[] = [];
  const citations: RagCitation[] = [];
  const rendered: string[] = [];
  const maxChars = limits.maxContextTokens * 4;
  let usedBytes = 0;
  let usedChars = 0;
  let truncated = false;

  for (const candidate of candidates.slice(0, limits.queryCandidates)) {
    assertScope(scope, candidate);
    const parsed = parseHit(candidate);
    if (!matchesFilter(parsed.metadata, options.filter)) continue;
    if (hits.length >= limits.topK) break;
    const safe = redactor?.redact(parsed) ?? parsed;
    const prefix = `[${parsed.citationId}] `;
    const separator = rendered.length ? "\n\n" : "";
    const availableBytes = limits.maxResultBytes - usedBytes - byteLength(separator + prefix);
    const availableChars = maxChars - usedChars - separator.length - prefix.length;
    if (availableBytes <= 0 || availableChars <= 0) {
      truncated = true;
      break;
    }
    let text = safe.text.slice(0, availableChars);
    text = truncateUtf8(text, availableBytes);
    if (!text) {
      truncated = true;
      break;
    }
    if (text.length < safe.text.length) truncated = true;
    const hit = Object.freeze({ ...safe, text });
    const citation = Object.freeze({
      id: hit.citationId,
      sourceId: hit.sourceId,
      chunkId: hit.id,
      ...(hit.metadata ? { metadata: hit.metadata } : {}),
    });
    const block = `${separator}${prefix}${text}`;
    rendered.push(block);
    usedBytes += byteLength(block);
    usedChars += block.length;
    hits.push(hit);
    citations.push(citation);
    if (truncated) break;
  }

  return Object.freeze({
    query: safeQuery,
    text: rendered.join(""),
    hits: Object.freeze(hits),
    citations: Object.freeze(citations),
    truncated,
  });
}

function parseHit(hit: MemoryVectorHit): RagHit {
  const metadata = hit.metadata;
  const rag = metadata?._rag;
  if (!isJsonObject(rag)) throw new RagScopeError("vector hit is missing RAG source metadata");
  const sourceId = requireSourceId(rag.sourceId);
  const citationId = nonEmpty(rag.citationId, "metadata._rag.citationId");
  if (
    !Number.isInteger(rag.chunkIndex)
    || Number(rag.chunkIndex) < 0
    || !Number.isInteger(rag.start)
    || Number(rag.start) < 0
    || !Number.isInteger(rag.end)
    || Number(rag.end) < Number(rag.start)
    || !Number.isFinite(hit.score)
  ) {
    throw new RagValidationError("vector hit has invalid RAG offsets");
  }
  if (hit.id !== citationId || !citationId.startsWith(`${sourceId}#`)) {
    throw new RagValidationError("vector hit has inconsistent citation identity");
  }
  const userMetadata: Record<string, JsonObject[string]> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) if (key !== "_rag") userMetadata[key] = value;
  return {
    id: hit.id,
    citationId,
    sourceId,
    index: rag.chunkIndex,
    start: rag.start,
    end: rag.end,
    text: hit.text,
    score: hit.score,
    ...(Object.keys(userMetadata).length ? { metadata: userMetadata } : {}),
  } as RagHit;
}
