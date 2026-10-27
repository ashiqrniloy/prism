import type { Embedder, VectorStore, WorkingMemoryStore } from "@arnilo/prism-memory-core";
export interface MemoryConformanceStores {
    readonly embedder: Embedder;
    readonly vectorStore: VectorStore & Required<Pick<VectorStore, "listByThread" | "countByThread" | "countByKind" | "topTags">>;
    readonly workingStore: WorkingMemoryStore;
}
/**
 * Shared network-free conformance for Embedder + VectorStore + WorkingMemoryStore trios.
 */
export declare function runMemoryConformance(createStores: () => Promise<MemoryConformanceStores> | MemoryConformanceStores): Promise<void>;
