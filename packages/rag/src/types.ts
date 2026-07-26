import type { ContextProvider, JsonObject, Message, SecretRedactor } from "@arnilo/prism";
import type { Embedder, MemoryVectorRecord, VectorStore } from "@arnilo/prism-memory";

export interface RagScope {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly corpusId: string;
}

export interface RagChunk {
  readonly id: string;
  readonly citationId: string;
  readonly sourceId: string;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly metadata?: JsonObject;
}

export interface ChunkOptions {
  readonly sourceId: string;
  readonly metadata?: JsonObject;
  readonly size?: number;
  readonly overlap?: number;
  readonly maxDocumentChars?: number;
  readonly maxChunks?: number;
}

export interface LoadedDocument {
  readonly uri: string;
  readonly sourceId?: string;
  readonly mediaType?: string;
  readonly text?: string;
  readonly data?: Uint8Array;
  readonly metadata?: JsonObject;
}

export interface ParsedDocument {
  readonly text: string;
  readonly metadata?: JsonObject;
}

export interface DocumentLoadOptions {
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
}

export interface DocumentParseOptions extends DocumentLoadOptions {
  readonly maxParseMs?: number;
  readonly maxPages?: number;
}

export interface DocumentLoader {
  load(uri: string, options?: DocumentLoadOptions): Promise<LoadedDocument>;
}

export interface Parser {
  parse(document: LoadedDocument, options?: DocumentParseOptions): Promise<ParsedDocument>;
}

export type Chunker = (text: string, options: ChunkOptions) => readonly RagChunk[];

export interface SourceVectorStore extends VectorStore {
  getBySource(
    scope: { readonly tenantId: string; readonly resourceId: string; readonly threadId: string },
    sourceId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly MemoryVectorRecord[]>;
}

export interface TransactionalVectorStore extends SourceVectorStore {
  transaction<T>(
    operation: (store: SourceVectorStore) => Promise<T>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<T>;
}

export type IngestionState = "pending" | "indexed" | "failed" | "partial";

export interface IngestionStatus {
  readonly sourceId: string;
  readonly scope: RagScope;
  readonly state: IngestionState;
  readonly bytes: number;
  readonly chunks: number;
  readonly error?: string;
  readonly updatedAt: string;
}

export interface IngestionStatusStore {
  set(status: IngestionStatus, options?: { readonly signal?: AbortSignal }): Promise<void>;
  delete(scope: RagScope, sourceId: string, options?: { readonly signal?: AbortSignal }): Promise<void>;
  list(
    scope: RagScope,
    options: { readonly limit: number; readonly cursor?: string; readonly signal?: AbortSignal },
  ): Promise<{ readonly entries: readonly IngestionStatus[]; readonly nextCursor?: string }>;
}

export interface IngestionStatusQuery {
  readonly store: IngestionStatusStore;
  readonly scope: RagScope;
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface IndexChunksOptions {
  readonly chunks: readonly RagChunk[];
  readonly embedder: Embedder;
  readonly store: VectorStore;
  readonly scope: RagScope;
  readonly batchSize?: number;
  readonly maxChunks?: number;
  readonly maxChunkChars?: number;
  readonly maxVectorDimensions?: number;
  readonly maxMetadataBytes?: number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly statusStore?: IngestionStatusStore;
  readonly signal?: AbortSignal;
}

export interface IndexChunksResult {
  readonly indexed: number;
  readonly sourceIds: readonly string[];
}

export interface ReplaceSourceOptions extends Omit<IndexChunksOptions, "chunks" | "store"> {
  readonly sourceId: string;
  readonly chunks: readonly RagChunk[];
  readonly store: TransactionalVectorStore;
}

export interface DeleteSourceOptions {
  readonly sourceId: string;
  readonly store: SourceVectorStore;
  readonly scope: RagScope;
  readonly statusStore?: IngestionStatusStore;
  readonly signal?: AbortSignal;
}

export interface ReplaceDocumentOptions extends Omit<ReplaceSourceOptions, "sourceId" | "chunks"> {
  readonly uri: string;
  readonly sourceId?: string;
  readonly loader: DocumentLoader;
  readonly parser: Parser;
  readonly chunker?: Chunker;
  readonly chunk?: Omit<ChunkOptions, "sourceId">;
  readonly loaderOptions?: DocumentLoadOptions;
  readonly parserOptions?: DocumentParseOptions;
}

export interface RagProvenance {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly citationId: string;
  readonly provider: string;
  readonly retrieval: "vector";
  readonly retrievedAt: string;
}

export interface RagContentTrust {
  readonly untrusted: true;
  readonly inert: true;
  readonly injectionCapable: true;
}

export interface RagCitation {
  readonly id: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly provenance: RagProvenance;
  readonly trust: RagContentTrust;
  readonly metadata?: JsonObject;
}

export interface RagHit extends RagChunk {
  readonly score: number;
  readonly retrievalRank: number;
  readonly provenance: RagProvenance;
  readonly trust: RagContentTrust;
}

export interface Reranker {
  rerank(
    input: { readonly query: string; readonly hits: readonly RagHit[]; readonly signal?: AbortSignal },
  ): Promise<readonly RagHit[]>;
}

export interface RetrieveContextOptions {
  readonly embedder: Embedder;
  readonly store: VectorStore;
  readonly scope: RagScope;
  readonly topK?: number;
  readonly queryCandidates?: number;
  readonly filter?: JsonObject;
  readonly maxResultBytes?: number;
  readonly maxContextTokens?: number;
  readonly maxMetadataBytes?: number;
  readonly maxVectorDimensions?: number;
  readonly reranker?: Reranker;
  readonly maxRerankBytes?: number;
  readonly maxRerankMs?: number;
  readonly rerankConcurrency?: number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export interface RagContextResult {
  readonly query: string;
  readonly trust: RagContentTrust;
  readonly text: string;
  readonly hits: readonly RagHit[];
  readonly citations: readonly RagCitation[];
  readonly truncated: boolean;
}

export interface RagContextProviderOptions extends Omit<RetrieveContextOptions, "signal"> {
  readonly name?: string;
  readonly title?: string;
  readonly query?: string | ((context: { readonly messages: readonly Message[] }) => string | undefined);
}

export type RagContextProvider = ContextProvider;
