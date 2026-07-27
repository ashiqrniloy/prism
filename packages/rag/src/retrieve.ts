import { type JsonObject, resolveRedactor } from "@arnilo/prism";
import type { MemoryVectorHit } from "@arnilo/prism-memory";
import { RagScopeError, RagValidationError } from "./errors.js";
import { HARD_CHUNK_SIZE_CAP, resolveRagLimits } from "./limits.js";
import { rerankHits } from "./rerank.js";
import type { RagCitation, RagContentTrust, RagContextResult, RagHit, RagProvenance, RetrieveContextOptions } from "./types.js";
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
  truncateUtf8,
} from "./util.js";

const RETRIEVED_CONTENT_TRUST: RagContentTrust = Object.freeze({ untrusted: true, inert: true, injectionCapable: true });

export async function retrieveContext(query: string, options: RetrieveContextOptions): Promise<RagContextResult> {
  nonEmpty(query, "query");
  if (query.length > HARD_CHUNK_SIZE_CAP) throw new RagValidationError(`query exceeds ${HARD_CHUNK_SIZE_CAP} characters`);
  const scope = requireScope(options.scope);
  const limits = resolveRagLimits({
    topK: options.topK,
    queryCandidates: options.queryCandidates,
    maxResultBytes: options.maxResultBytes,
    maxContextTokens: options.maxContextTokens,
    maxMetadataBytes: options.maxMetadataBytes,
    maxVectorDimensions: options.maxVectorDimensions,
    maxRerankBytes: options.maxRerankBytes,
    maxRerankMs: options.maxRerankMs,
    rerankConcurrency: options.rerankConcurrency,
  });
  if (
    !Number.isInteger(options.embedder.dimensions) ||
    options.embedder.dimensions <= 0 ||
    options.embedder.dimensions > limits.maxVectorDimensions
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
    vectors.length !== 1 ||
    !embedding ||
    embedding.length !== options.embedder.dimensions ||
    embedding.some((value) => !Number.isFinite(value))
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

  const retrievedAt = new Date().toISOString();
  const retrieved: RagHit[] = [];
  for (const candidate of candidates.slice(0, limits.queryCandidates)) {
    assertScope(scope, candidate);
    const parsed = parseHit(candidate, retrieved.length, retrievedAt);
    if (!matchesFilter(parsed.metadata, options.filter)) continue;
    retrieved.push(Object.freeze(redactor?.redact(parsed) ?? parsed));
  }
  const ranked = options.reranker
    ? await rerankHits(safeQuery, retrieved, {
        reranker: options.reranker,
        maxBytes: limits.maxRerankBytes,
        maxMs: limits.maxRerankMs,
        concurrency: limits.rerankConcurrency,
        signal: options.signal,
        redactor: options.redactor,
        secrets: options.secrets,
      })
    : retrieved;

  const hits: RagHit[] = [];
  const citations: RagCitation[] = [];
  const rendered: string[] = [];
  const maxChars = limits.maxContextTokens * 4;
  let usedBytes = 0;
  let usedChars = 0;
  let truncated = false;
  for (const hit of ranked) {
    if (hits.length >= limits.topK) break;
    const prefix = `[${hit.citationId}] `;
    const separator = rendered.length ? "\n\n" : "";
    const availableBytes = limits.maxResultBytes - usedBytes - byteLength(separator + prefix);
    const availableChars = maxChars - usedChars - separator.length - prefix.length;
    if (availableBytes <= 0 || availableChars <= 0) {
      truncated = true;
      break;
    }
    let text = hit.text.slice(0, availableChars);
    text = truncateUtf8(text, availableBytes);
    if (!text) {
      truncated = true;
      break;
    }
    if (text.length < hit.text.length) truncated = true;
    const renderedHit = Object.freeze({ ...hit, text });
    const citation = Object.freeze({
      id: renderedHit.citationId,
      sourceId: renderedHit.sourceId,
      chunkId: renderedHit.id,
      provenance: renderedHit.provenance,
      trust: renderedHit.trust,
      ...(renderedHit.metadata ? { metadata: renderedHit.metadata } : {}),
    });
    const block = `${separator}${prefix}${text}`;
    rendered.push(block);
    usedBytes += byteLength(block);
    usedChars += block.length;
    hits.push(renderedHit);
    citations.push(citation);
    if (truncated) break;
  }
  return Object.freeze({
    query: safeQuery,
    trust: RETRIEVED_CONTENT_TRUST,
    text: rendered.join(""),
    hits: Object.freeze(hits),
    citations: Object.freeze(citations),
    truncated,
  });
}

function parseHit(hit: MemoryVectorHit, retrievalRank: number, retrievedAt: string): RagHit {
  const metadata = hit.metadata;
  const rag = metadata?._rag;
  if (!isJsonObject(rag)) throw new RagScopeError("vector hit is missing RAG source metadata");
  const sourceId = requireSourceId(rag.sourceId);
  const citationId = nonEmpty(rag.citationId, "metadata._rag.citationId");
  if (
    !Number.isInteger(rag.chunkIndex) ||
    Number(rag.chunkIndex) < 0 ||
    !Number.isInteger(rag.start) ||
    Number(rag.start) < 0 ||
    !Number.isInteger(rag.end) ||
    Number(rag.end) < Number(rag.start) ||
    !Number.isFinite(hit.score)
  ) {
    throw new RagValidationError("vector hit has invalid RAG offsets");
  }
  if (hit.id !== citationId || !citationId.startsWith(`${sourceId}#`))
    throw new RagValidationError("vector hit has inconsistent citation identity");
  const userMetadata: Record<string, JsonObject[string]> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) if (key !== "_rag") userMetadata[key] = value;
  const web = isJsonObject(userMetadata.web) ? userMetadata.web : undefined;
  const provider = typeof web?.provider === "string" && web.provider.trim() ? web.provider : "host";
  const provenance: RagProvenance = Object.freeze({ sourceId, chunkId: hit.id, citationId, provider, retrieval: "vector", retrievedAt });
  return {
    id: hit.id,
    citationId,
    sourceId,
    index: rag.chunkIndex,
    start: rag.start,
    end: rag.end,
    text: hit.text,
    score: hit.score,
    retrievalRank,
    provenance,
    trust: RETRIEVED_CONTENT_TRUST,
    ...(Object.keys(userMetadata).length ? { metadata: userMetadata } : {}),
  } as RagHit;
}
