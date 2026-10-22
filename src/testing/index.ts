/**
 * `@arnilo/prism/testing` (roadmap §2.2): the package conformance suite, the loop conformance
 * harness, and the mock provider, so a package test needs only `@arnilo/prism` and this subpath.
 * The per-suite subpaths (`./testing/provider-conformance`, …) stay until their owning phases
 * consolidate them.
 */

export { assertAgentEventSourceConforms } from "./agent-event-source-conformance.js";
export { createMemoryAgentEventSource } from "./memory-event-source.js";
export { createMockProvider, type MockProviderOptions } from "../mock-provider.js";
export {
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "../models/events.js";
export { bindManifestInstance } from "../packages/define.js";
export {
  DriverConformanceError,
  type DriverConformanceFixtures,
  type DriverConformanceLeg,
  type DriverConformanceOptions,
  type DriverConformanceResult,
  driverConformance,
} from "./driver-conformance.js";
export { createScriptedHostUi, type ScriptedAnswer, type ScriptedHostUi } from "./host-ui.js";
export {
  echoTool,
  type LoopConformanceOptions,
  type LoopConformanceResult,
  loopConformance,
  textProvider,
  twoTurnProvider,
} from "./loop-conformance.js";
export { type MockProviderPackageOptions, mockProvider } from "./mock-provider-package.js";
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
  createScriptedCli,
  defineScriptedDialect,
  type HookCall,
  type ScriptedCli,
  type ScriptedCliOptions,
  type ScriptedDialect,
  type ScriptedDialectName,
  type ScriptedInput,
  type ScriptedOutput,
  type ScriptedRecordEntry,
  type ScriptFrame,
  type ScriptHook,
  type ScriptStep,
} from "./scripted-cli.js";
export { jsonRpcDialect } from "./scripted-dialects/json-rpc.js";
export { jsonlStreamDialect } from "./scripted-dialects/jsonl-stream.js";
export {
  STORE_CONFORMANCE_STEPS,
  type StoreConformanceFactory,
  type StoreConformanceOptions,
  type StoreConformanceStep,
  storeConformance,
} from "./store-conformance.js";

export { recordFixtures, type RecordedFixture, type RecordFixtureOptions } from "./record-fixtures.js";

export {
  runProviderLiveScenarios,
  runSystemOneLiveScenarios,
  executeProviderLiveScenarios,
  executeSystemOneLiveScenarios,
  checkLayaServerReachable,
  DEFAULT_LIVE_CACHE_PREFIX,
  LIVE_WEATHER_TOOL,
  type ProviderLiveScenariosOptions,
  type SystemOneLiveScenariosOptions,
  type LiveRouteConfig,
  type LiveRouteInput,
  type LiveRouteName,
  type ProviderLiveScenarioResult,
  type ProviderLiveScenariosExecutionResult,
  type SystemOneLiveScenarioResult,
  type SystemOneLiveScenariosExecutionResult,
} from "./provider-live-scenarios.js";
