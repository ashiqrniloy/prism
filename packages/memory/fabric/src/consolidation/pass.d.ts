/**
 * One consolidation pass (plan 188.3 Task 5): gather, extract once, score, gate, write.
 *
 * The pass owns no timer and no session state. A trigger checks `hasNewObservationalMaterial` and
 * hands the cursor in; the cursor comes back only when every write succeeded, so a failed pass
 * leaves the material for the next trigger.
 */
import type { ModelClient, SecretRedactor, SessionEntry } from "@arnilo/prism";
import { type Memory, type MemoryVectorRecord } from "@arnilo/prism-memory-core";
import { type ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import type { FabricConsolidationReport, ResolvedPromoteConfig } from "../promote.js";
import { type MemoryFabric, type MemoryFabricScopeBinding, type MemoryNoteScope } from "../types.js";
import type { ConsolidationExistingNote } from "./prompts.js";
/** The lifecycle work a pass needs; structurally `createFabricLifecycle(memory)`. */
export interface ConsolidationLifecycle {
    handleSupersededReflections(ids: ReadonlySet<string>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly supersededNotes: Map<string, MemoryVectorRecord>;
    }>;
    reconsolidating(options?: {
        readonly signal?: AbortSignal;
    }): Promise<readonly MemoryVectorRecord[]>;
}
export interface ConsolidationPassInput {
    readonly sessionId: string;
    readonly entries: readonly SessionEntry[];
    readonly cursor?: string;
    readonly remember: MemoryFabric["remember"];
    readonly memory: Memory;
    readonly scopes?: readonly MemoryFabricScopeBinding[];
    readonly lifecycleFor: (memory: Memory) => ConsolidationLifecycle;
    readonly config: ResolvedPromoteConfig;
    /** Resolved only when a pass actually calls the extractor. */
    readonly resolveClient: () => ModelClient;
    readonly limits: ResolvedMemoryWorkerLimits;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
    /** Workspace root the `derivableFrom` files resolve inside. */
    readonly root: string;
    /** The project scope has a root, so the extractor gets the repository and derivability rules. */
    readonly repositoryRules?: boolean;
    /**
     * Not-yet-consolidated archived exchanges, gathered by the caller from the store. They join the
     * pass's candidates so one extractor call turns verbatim history into dated, keyed facts.
     */
    readonly exchanges?: readonly ConsolidationExchangeCandidate[];
    /** Marks the gathered exchanges as consolidated, after the pass wrote (or found nothing to write). */
    readonly markExchangesConsolidated?: (ids: readonly string[], at: string) => Promise<void>;
    readonly scratchDir?: string;
    /** The `<slug>--<id8>` id an exception records in the wider note's `contradictedIn`. */
    readonly projectId?: string;
    readonly now?: Date;
    readonly pass?: string;
    readonly signal?: AbortSignal;
    readonly recallExisting?: (query: string, scope: MemoryNoteScope, limit: number) => Promise<readonly ConsolidationExistingNote[]> | readonly ConsolidationExistingNote[];
}
/** One archived exchange offered to the pass as evidence. */
export interface ConsolidationExchangeCandidate {
    readonly id: string;
    readonly text: string;
    readonly level: MemoryNoteScope;
    readonly tRef?: string;
}
export interface ConsolidationPassResult {
    readonly report: FabricConsolidationReport;
    /** The new cursor: the last entry the pass covered, absent when nothing ran. */
    readonly cursor?: string;
}
/** True when OM appended a reflection, superseded one, or a task-state decision after `cursor`. */
export declare function hasNewObservationalMaterial(entries: readonly SessionEntry[], cursor: string | undefined): boolean;
/** Entries strictly after the cursor; an unknown cursor covers everything (fail towards re-gathering). */
export declare function entriesAfter(entries: readonly SessionEntry[], cursor: string | undefined): readonly SessionEntry[];
/** One pass per session at a time; a trigger during a running pass is dropped, never queued. */
export declare function createConsolidationLease(): {
    readonly enter: (sessionId: string) => boolean;
    readonly exit: (sessionId: string) => void;
};
/** The zero report every pass starts from; a failed pass persists one so `memory:status` keeps the reason. */
export declare function consolidationReport(at: string, fields?: Partial<FabricConsolidationReport>, pass?: string): FabricConsolidationReport;
/** Gather, extract once, score, gate, write; returns the report and the cursor to persist on success. */
export declare function runConsolidationPass(input: ConsolidationPassInput): Promise<ConsolidationPassResult>;
