/**
 * `@arnilo/prism/testing` (roadmap §2.2): the package conformance suite, the loop conformance
 * harness, and the mock provider, so a package test needs only `@arnilo/prism` and this subpath.
 * The per-suite subpaths (`./testing/provider-conformance`, …) stay until their owning phases
 * consolidate them.
 */

export { createMockProvider, type MockProviderOptions } from "../mock-provider.js";
export { mockProvider, type MockProviderPackageOptions } from "./mock-provider-package.js";
export {
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "../models/events.js";
export { createScriptedHostUi, type ScriptedAnswer, type ScriptedHostUi } from "./host-ui.js";
export {
  echoTool,
  type LoopConformanceOptions,
  type LoopConformanceResult,
  loopConformance,
  textProvider,
  twoTurnProvider,
} from "./loop-conformance.js";
export {
  type ConformanceCheck,
  loadProviderPackage,
  type PackageConformanceCheckName,
  type PackageConformanceOptions,
  type PackageConformanceResult,
  packageConformance,
} from "./package-conformance.js";
export { assertPersistenceSearchQueryParity } from "./query-conformance.js";
export {
  STORE_CONFORMANCE_STEPS,
  storeConformance,
  type StoreConformanceFactory,
  type StoreConformanceOptions,
  type StoreConformanceStep,
} from "./store-conformance.js";
