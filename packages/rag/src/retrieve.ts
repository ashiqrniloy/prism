import { type JsonObject, resolveRedactor } from "@arnilo/prism";
import type { MemoryVectorHit } from "@arnilo/prism-memory";
import { RagError, RagLimitError, RagScopeError, RagValidationError } from "./errors.js";
import { fuseReciprocalRankLists } from "./fusion.js";
import { HARD_CHUNK_SIZE_CAP, HARD_RETRIEVE_SCOPE_CAP, resolveRagLimits } from "./limits.js";
import { rerankHits } from "./rerank.js";
import type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "./telemetry.js";
import type { RagCitation, RagContentTrust, RagContextResult, RagHit, RagProvenance, RagScope, RetrieveContextOptions } from "./types.js";
import {
  assertBytes,
  assertNotAborted,
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
  const scopes = resolveRetrieveScopes(options);
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
    rrfK: options.rrfK,
  });
  if (
    !Number.isInteger(options.embedder.dimensions) ||
    options.embedder.dimensions <= 0 ||
    options.embedder.dimensions > limits.maxVectorDimensions
  ) {
    throw new RagValidationError(`embedder dimensions must be an integer in 1..${limits.maxVectorDimensions}`);
  }
  if (options.filter) assertBytes(options.filter, limits.maxMetadataBytes, "metadata filter");
  const lexical = options.lexical ?? (options.store.lexicalQuery ? "fts" : "off");
  if (lexical !== "fts" && lexical !== "bm25" && lexical !== "off") {
    throw new RagValidationError('lexical must be "fts", "bm25", or "off"');
  }
  if (options.fusion !== undefined && options.fusion !== "rrf") {
    throw new RagValidationError('fusion must be "rrf"');
  }
  if (lexical !== "off" && !options.store.lexicalQuery) {
    throw new RagValidationError(`lexical "${lexical}" requested but the store has no lexicalQuery capability`);
  }
  if (lexical === "bm25" && !options.store.lexicalModes?.includes("bm25")) {
    throw new RagValidationError('lexical "bm25" requested but the store does not declare BM25 support');
  }
  const useLexical = lexical !== "off";
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const telemetry = options.telemetry;
  const root = telemetry?.startSpan("rag_request", {
    ...(scopes[0] ? { "rag.scope.tenant_id": scopes[0].tenantId } : {}),
    "rag.scope_count": scopes.length,
    "rag.embedder_id": options.embedder.id,
    "rag.top_k": limits.topK,
    "rag.lexical_mode": lexical,
  });
  try {
    const safeQuery = redactor?.redact(query) ?? query;
    assertNotAborted(options.signal);
    if (scopes.length === 0) {
      return emptyResult(safeQuery);
    }
    if (scopes.length === 1) {
      const currentGeneration = await options.store.getCurrentGeneration?.({
        tenantId: scopes[0]!.tenantId,
        resourceId: scopes[0]!.resourceId,
        threadId: scopes[0]!.corpusId,
      });
      if (currentGeneration !== undefined) root?.setAttribute("rag.index_generation", Number(currentGeneration));
    }
    const vectors = await span(telemetry, "embedding.query", undefined, root, () =>
      options.embedder.embed([safeQuery], { signal: options.signal }),
    );
    const embedding = vectors[0];
    if (
      vectors.length !== 1 ||
      !embedding ||
      embedding.length !== options.embedder.dimensions ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new RagValidationError("embedder returned invalid query vector");
    }
    const vectorLists: MemoryVectorHit[][] = [];
    await span(telemetry, "retrieval.vector_search", undefined, root, async (leg) => {
      let total = 0;
      for (const scope of scopes) {
        assertNotAborted(options.signal);
        const found = await options.store.query({
          tenantId: scope.tenantId,
          resourceId: scope.resourceId,
          threadId: scope.corpusId,
          embedding,
          topK: limits.queryCandidates,
          signal: options.signal,
        });
        const sliced = found.slice(0, limits.queryCandidates);
        vectorLists.push(sliced);
        total += sliced.length;
      }
      leg?.setAttribute("rag.vector_candidates", total);
    });

    const lexicalLists: MemoryVectorHit[][] = [];
    if (useLexical && options.store.lexicalQuery) {
      await span(telemetry, "retrieval.lexical", undefined, root, async (leg) => {
        let total = 0;
        for (const scope of scopes) {
          assertNotAborted(options.signal);
          const found = await options.store.lexicalQuery!({
            tenantId: scope.tenantId,
            resourceId: scope.resourceId,
            threadId: scope.corpusId,
            text: safeQuery,
            topK: limits.queryCandidates,
            signal: options.signal,
          });
          const sliced = found.slice(0, limits.queryCandidates);
          lexicalLists.push(sliced);
          total += sliced.length;
        }
        leg?.setAttribute("rag.lexical_candidates", total);
      });
    }

    const retrievedAt = new Date().toISOString();
    const retrieved: RagHit[] = [];
    const fused = await span(telemetry, "retrieval.fusion", undefined, root, (fusion) => {
      const lists = [
        ...vectorLists.map((hits) => ({ hits, leg: "vector" as const })),
        ...lexicalLists.map((hits) => ({ hits, leg: "lexical" as const })),
      ];
      const fusedCandidates = fuseReciprocalRankLists(lists, limits.rrfK);
      fusion?.setAttribute("rag.fused_candidates", fusedCandidates.length);
      return fusedCandidates;
    });
    for (const { hit: candidate, retrieval } of fused) {
      assertRequestedScope(scopes, candidate);
      if (candidate.embedderId === undefined) {
        throw new RagError(
          `stored record ${candidate.id} has no embedderId; re-index the source to stamp embedder identity`,
          "ERR_PRISM_RAG_EMBEDDER_MISMATCH",
        );
      }
      if (candidate.embedderId !== options.embedder.id || candidate.embedding.length !== options.embedder.dimensions) {
        throw new RagError(
          `embedder mismatch: record ${candidate.id} was embedded by "${candidate.embedderId}" (${candidate.embedding.length} dims) but the query embedder is "${options.embedder.id}" (${options.embedder.dimensions} dims)`,
          "ERR_PRISM_RAG_EMBEDDER_MISMATCH",
        );
      }
      const parsed = parseHit(candidate, retrieved.length, retrievedAt, retrieval);
      if (!matchesFilter(parsed.metadata, options.filter)) continue;
      retrieved.push(Object.freeze(redactor?.redact(parsed) ?? parsed));
    }
    const reranker = options.reranker;
    const ranked = reranker
      ? await span(telemetry, "retrieval.rerank", undefined, root, () =>
          rerankHits(safeQuery, retrieved, {
            reranker,
            maxBytes: limits.maxRerankBytes,
            maxMs: limits.maxRerankMs,
            concurrency: limits.rerankConcurrency,
            signal: options.signal,
            redactor: options.redactor,
            secrets: options.secrets,
          }),
        )
      : retrieved;

    const hits: RagHit[] = [];
    const citations: RagCitation[] = [];
    const rendered: string[] = [];
    const maxChars = limits.maxContextTokens * 4;
    let usedBytes = 0;
    let usedChars = 0;
    let truncated = false;
    const assemblySpan = telemetry?.startSpan("prompt.assembly", undefined, root);
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
    assemblySpan?.setAttribute("rag.result_count", hits.length);
    assemblySpan?.end();
    for (const hit of hits) {
      root?.addEvent("chunk_retrieved", {
        "rag.chunk.source_id": hit.sourceId,
        "rag.chunk.id": hit.id,
        "rag.chunk.rank": hit.retrievalRank,
        "rag.chunk.score": hit.score,
        "rag.chunk.embedder_id": options.embedder.id,
        "rag.chunk.tenant_id": hit.provenance.tenantId,
        "rag.chunk.corpus_id": hit.provenance.corpusId,
      });
    }
    return Object.freeze({
      query: safeQuery,
      trust: RETRIEVED_CONTENT_TRUST,
      text: rendered.join(""),
      hits: Object.freeze(hits),
      citations: Object.freeze(citations),
      truncated,
    });
  } catch (error) {
    root?.recordError();
    throw error;
  } finally {
    root?.end();
  }
}

/** Opens a child span only when telemetry is present; otherwise runs the section untouched. */
async function span<T>(
  telemetry: RagTelemetry | undefined,
  name: string,
  attributes: Readonly<Record<string, RagTelemetryAttributeValue>> | undefined,
  parent: RagTelemetrySpan | undefined,
  fn: (child: RagTelemetrySpan | undefined) => T | Promise<T>,
): Promise<T> {
  if (!telemetry) return await fn(undefined);
  const child = telemetry.startSpan(name, attributes, parent);
  try {
    return await fn(child);
  } catch (error) {
    child.recordError();
    throw error;
  } finally {
    child.end();
  }
}

function parseHit(hit: MemoryVectorHit, retrievalRank: number, retrievedAt: string, retrieval: "vector" | "lexical" | "hybrid"): RagHit {
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
  const provenance: RagProvenance = Object.freeze({
    sourceId,
    chunkId: hit.id,
    citationId,
    provider,
    tenantId: hit.tenantId,
    resourceId: hit.resourceId,
    corpusId: hit.threadId,
    retrieval,
    retrievedAt,
  });
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

function resolveRetrieveScopes(options: RetrieveContextOptions): RagScope[] {
  const hasScope = options.scope !== undefined;
  const hasScopes = options.scopes !== undefined;
  if (hasScope && hasScopes) throw new RagValidationError("provide either scope or scopes, not both");
  if (!hasScope && !hasScopes) throw new RagValidationError("scope or scopes is required");
  const raw = hasScopes ? options.scopes! : [options.scope!];
  if (raw.length > HARD_RETRIEVE_SCOPE_CAP) throw new RagLimitError(`scopes exceeds hard cap ${HARD_RETRIEVE_SCOPE_CAP}`);
  const seen = new Set<string>();
  const resolved: RagScope[] = [];
  for (const item of raw) {
    const scope = requireScope(item);
    const key = `${scope.tenantId} ${scope.resourceId} ${scope.corpusId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(scope);
  }
  return resolved;
}

function assertRequestedScope(scopes: readonly RagScope[], actual: { tenantId: string; resourceId: string; threadId: string }): void {
  if (
    scopes.some(
      (scope) => scope.tenantId === actual.tenantId && scope.resourceId === actual.resourceId && scope.corpusId === actual.threadId,
    )
  ) {
    return;
  }
  throw new RagScopeError("vector hit crossed tenant/resource/corpus boundary");
}

function emptyResult(query: string): RagContextResult {
  return Object.freeze({
    query,
    trust: RETRIEVED_CONTENT_TRUST,
    text: "",
    hits: Object.freeze([]),
    citations: Object.freeze([]),
    truncated: false,
  });
}
