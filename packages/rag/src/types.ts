import type { ContextProvider, JsonObject, Message, SecretRedactor } from "@arnilo/prism";
import type { Embedder, VectorStore } from "@arnilo/prism-memory";

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
  readonly signal?: AbortSignal;
}

export interface IndexChunksResult {
  readonly indexed: number;
  readonly sourceIds: readonly string[];
}

export interface RagCitation {
  readonly id: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly metadata?: JsonObject;
}

export interface RagHit extends RagChunk {
  readonly score: number;
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
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export interface RagContextResult {
  readonly query: string;
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
