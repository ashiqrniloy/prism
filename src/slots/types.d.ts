import type { CompactionContext, CompactionResult, CredentialResolver, SessionStore } from "../contracts.js";
import type { LoopStrategy } from "../loop/types.js";
/** Compaction slot contract (roadmap §2.5). The default implementation is `createDefaultCompactor`. */
export interface Compactor {
    readonly name?: string;
    compact(context: CompactionContext): Promise<CompactionResult> | CompactionResult;
}
/** The four slots and their contracts. */
export interface SlotContracts {
    readonly loop: LoopStrategy;
    readonly compaction: Compactor;
    readonly store: SessionStore;
    readonly credentials: CredentialResolver;
}
export type SlotName = keyof SlotContracts;
/**
 * Direct host assignments. A direct implementation always wins over registered providers. A string
 * names the package that owns the slot, which resolves a conflict between two package providers.
 */
export interface SlotAssignments {
    readonly loop?: LoopStrategy | string;
    readonly compaction?: Compactor | string;
    readonly store?: SessionStore | string;
    readonly credentials?: CredentialResolver | string;
}
export interface SlotProvider<N extends SlotName> {
    readonly owner: string;
    readonly impl: SlotContracts[N];
}
/** A slot resolved to more than one provider with no direct assignment. */
export declare class SlotConflictError extends Error {
    readonly slot: SlotName;
    readonly owners: readonly string[];
    readonly code = "ERR_PRISM_SLOT_CONFLICT";
    constructor(slot: SlotName, owners: readonly string[]);
}
/** A slot assignment names an owner that did not provide that slot. */
export declare class UnknownSlotOwnerError extends Error {
    readonly slot: SlotName;
    readonly owner: string;
    readonly code = "ERR_PRISM_UNKNOWN_SLOT_OWNER";
    constructor(slot: SlotName, owner: string);
}
export declare class UnknownSlotError extends Error {
    readonly slot: string;
    readonly code = "ERR_PRISM_UNKNOWN_SLOT";
    constructor(slot: string);
}
export interface SlotRegistry {
    /** Register a provider under an owner. Conflicts are detected at {@link resolve}, not here. */
    provide<N extends SlotName>(name: N, owner: string, impl: SlotContracts[N]): void;
    /** The kernel default for a slot. */
    default<N extends SlotName>(name: N): SlotContracts[N];
    /** Providers registered for a slot, in registration order. */
    providers(name: SlotName): readonly SlotProvider<SlotName>[];
    /**
     * Resolve a slot. A direct implementation wins; a string assignment picks the provider that owner
     * registered ({@link UnknownSlotOwnerError} if it did not); otherwise exactly one provider is used;
     * zero providers falls back to the default; two or more throw {@link SlotConflictError}.
     */
    resolve<N extends SlotName>(name: N, assigned?: SlotContracts[N] | string): SlotContracts[N];
    /**
     * Who owns a slot after resolution: `"host"` for a direct implementation, the package name for a
     * provider, `"kernel"` for the default. Throws as {@link resolve} does.
     */
    ownerOf(name: SlotName, assigned?: SlotContracts[SlotName] | string): string;
    /** Removes every provider an owner registered, across all slots. Used to unwind and dispose a package. */
    remove(owner: string): void;
}
