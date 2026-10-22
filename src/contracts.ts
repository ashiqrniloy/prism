/**
 * Contracts barrel (0.1.4 god-module split): re-exports the full public
 * contracts surface from the three concern-split modules
 * (contracts-core / contracts-run-state / contracts-protocol) so the
 * import surface of `./contracts.js` is unchanged.
 */
export * from "./contracts-core.js";
export * from "./contracts-protocol.js";
export * from "./contracts-run-state.js";

