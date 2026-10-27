/**
 * One maintenance pass (plan 188.4 Tasks 4-6): archive, capacity, widening, narrowing — in that
 * order, once per active scope, metadata-only except for the opt-in episode merge.
 *
 * The pass is where the lifecycle's slow work happens: no turn waits for it, nothing here runs on
 * the read path, and every step stops where the store says it cannot go.
 */
import type { ModelClient, SecretRedactor } from "@arnilo/prism";
import { type Memory, type VectorStore } from "@arnilo/prism-memory-core";
import type { ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import type { ResolvedLifecycleConfig } from "../config.js";
import { type MemoryFabric, type MemoryFabricMaintainOptions, type MemoryFabricMaintenanceReport, type MemoryNoteScope } from "../types.js";
import type { FabricLifecycle } from "./index.js";
export interface MaintenanceDeps {
    /** Active scope memories, narrowest first, as the package resolved them. */
    readonly memories: readonly Memory[];
    readonly levels: readonly MemoryNoteScope[];
    readonly lifecycles: readonly FabricLifecycle[];
    /** The store behind the memories; `maintain()` needs `scanMetadata`. */
    readonly store?: VectorStore;
    readonly remember: MemoryFabric["remember"];
    readonly lifecycle?: ResolvedLifecycleConfig;
    /** Resolved once by the caller: episode merging is the only step that can call a model. */
    readonly workerLimits: ResolvedMemoryWorkerLimits;
    readonly resolveModelClient?: (model?: string) => ModelClient;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
    readonly notify?: (message: string) => void;
    /** The process-wide scope ordinal, used when the store has no counter. */
    readonly clock?: () => number;
    /** Opens a project the host did not bind; see `CreateMemoryFabricOptions.openScope`. */
    readonly openScope?: (input: {
        readonly level: MemoryNoteScope;
        readonly tenantId: string;
        readonly resourceId: string;
    }) => Memory | undefined | Promise<Memory | undefined>;
}
export declare function runMaintenance(deps: MaintenanceDeps, options?: MemoryFabricMaintainOptions): Promise<MemoryFabricMaintenanceReport>;
