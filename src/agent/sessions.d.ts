/** `agent.sessions` (roadmap §2.3): list, get, delete and search over the `store` slot's declared capabilities. */
import type { OwnershipScope, SessionIndex, SessionStore } from "../contracts.js";
/** What a scope conflict does: `throw` for an authorization scope (session open, run), `base` for a query filter. */
type ScopeConflictMode = "throw" | "base";
/**
 * Plan 177 Task 4: the one scope-narrowing helper. A caller may add fields the base left undefined and may
 * repeat a base field, but never change one. `mode` decides what a changed field does: `"throw"` (the
 * session and run paths, where the request claims an identity) rejects it with `OwnershipScopeError`;
 * `"base"` (a `sessions.list/get/delete/search` query filter) keeps the base scope.
 */
export declare function narrowScope<T extends OwnershipScope>(base: OwnershipScope | undefined, requested: T | undefined, kind: string, mode?: ScopeConflictMode): T | undefined;
/**
 * `SessionIndex` over a store without an `Agent`: list, get, delete and search under `ownership`, enforced
 * exactly as `agent.sessions` enforces it. `store` is a store or a getter (the agent resolves its slot lazily).
 */
export declare function createSessionIndex(store: SessionStore | (() => SessionStore), options?: {
    readonly ownership?: OwnershipScope;
}): SessionIndex;
export {};
