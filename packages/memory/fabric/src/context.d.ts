import { type ContentBlock, type ContextDraft, type HookContext } from "@arnilo/prism";
import { type Memory, type MemoryContextProviderOptions } from "@arnilo/prism-memory-core";
import type { MemoryFabricInjectConfig } from "./config.js";
import type { FabricCore } from "./delivery/core.js";
import type { FabricCues } from "./delivery/cues.js";
import { type FabricDirectoryHandle } from "./directory.js";
import type { MemoryFabric, MemoryFabricRecallOptions } from "./types.js";
/** Tracks notes shown to the model in each session and records citations in assistant text. */
export interface FabricCitationTracker {
    /** Record notes shown to the model in this session (via passive injection or recall tool). */
    show(sessionId: string, noteIds: readonly string[]): void;
    /** Scan assistant response text for bracketed ids `[<id>]`. */
    observe(sessionId: string, textChunk: string): void;
    /** Return all cited ids for the session (only ids previously shown count). */
    cited(sessionId: string): readonly string[];
    /** Take the retrieval counts accumulated since the previous call; diagnostics only, never a use. */
    takeRetrievals(sessionId: string): Readonly<Record<string, number>>;
    /** Clear tracking state for a session. */
    clear?(sessionId: string): void;
}
export declare function createFabricCitationTracker(): FabricCitationTracker;
/** Resolve periods as UTC calendar intervals against the persisted message time. */
export declare function recallPeriod(text: string, timestamp: string): {
    text: string;
    options: MemoryFabricRecallOptions;
};
export declare function createFabricContext(memory: Memory, recall: MemoryFabric["recall"], inject?: false | MemoryFabricInjectConfig, options?: MemoryContextProviderOptions, directory?: FabricDirectoryHandle, tracker?: FabricCitationTracker, touchedPaths?: (sessionId: string) => readonly string[], core?: FabricCore, cues?: FabricCues): {
    build(draft: ContextDraft, context: HookContext): Promise<ContextDraft>;
    observe(content: ContentBlock, context: HookContext): void;
    cited(context: HookContext): readonly string[];
    tracker: FabricCitationTracker;
};
