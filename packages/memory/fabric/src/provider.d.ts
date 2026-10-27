import { type FabricCitationTracker } from "./context.js";
import type { MemoryFabric } from "./types.js";
import type { MemoryFabricInjectConfig } from "./config.js";
import type { HookRegistrar } from "@arnilo/prism";
import type { Memory, MemoryContextProviderOptions } from "@arnilo/prism-memory-core";
/** Registration id a host uses to tell this contribution apart from other memory handlers. */
export declare const DEFAULT_MEMORY_FABRIC_PROVIDER_NAME = "memory-fabric";
/** Register the fabric-filtered projection after context engineering; passive recall is opt-in. */
export declare function registerMemoryFabricContext(hooks: HookRegistrar, memory: Memory, options?: MemoryContextProviderOptions, recall?: MemoryFabric["recall"], inject?: false | MemoryFabricInjectConfig, tracker?: FabricCitationTracker, lifecycle?: {
    recordUses: (sessionKey: string, ids: readonly string[], options?: {
        readonly signal?: AbortSignal;
    }) => Promise<unknown>;
}, touchedPaths?: (sessionId: string) => readonly string[]): void;
