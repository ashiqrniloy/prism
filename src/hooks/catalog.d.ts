import { type DecideHookName, type HookKind, type HookName, type ObserveHookName } from "./types.js";
export declare const OBSERVE_HOOK_NAMES: readonly ObserveHookName[];
export interface HookCatalogEntry {
    readonly kind: HookKind;
}
/** Frozen catalog: every hook name with its kind. */
export declare const HOOK_CATALOG: Readonly<Record<HookName, HookCatalogEntry>>;
/** Combination rule ids for decide hooks, kept as data so Phase 2 extends the table, not control flow. */
export type DecideCombination = "any-stop" | "tool-call" | "first-continue" | "any-compact";
export declare const HOOK_COMBINATION: Readonly<Record<DecideHookName, DecideCombination>>;
