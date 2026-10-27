import type { MemoryFabric, MemoryFabricObservationSource } from "./types.js";
/** Matching messages one conversation search returns by default. */
export declare const DEFAULT_CONVERSATION_SEARCH_TOP_K = 5;
export declare function createFabricConversationSearch(deps: {
    readonly observational?: MemoryFabricObservationSource;
}): MemoryFabric["searchConversation"];
