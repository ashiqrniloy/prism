/**
 * Contracts barrel (0.1.4 god-module split): re-exports the full public
 * contracts surface from the three concern-split modules
 * (contracts-core / contracts-run-state / contracts-protocol) so the
 * import surface of `./contracts.js` is unchanged.
 */
export * from "./contracts-core.js";
export * from "./contracts-protocol.js";
export * from "./contracts-run-state.js";

/** Alias re-exports so `dist/contracts.d.ts` exposes implementer contract names. */
export type AgentIdentity = import("./identity.js").AgentIdentity;
export type Principal = import("./identity.js").Principal;
export type IdentityVerifier = import("./identity.js").IdentityVerifier;
export type PersistenceLifecycleStore = import("./persistence-lifecycle.js").PersistenceLifecycleStore;
export type LegalHoldRecord = import("./persistence-lifecycle.js").LegalHoldRecord;
export type TenantQuota = import("./persistence-lifecycle.js").TenantQuota;
export type PersistenceResourceKind = import("./persistence-lifecycle.js").PersistenceResourceKind;
