/**
 * The long-term memory library surface (`ltm`, the former fabric package's root): config and presets,
 * stores, notes, recall, lifecycle, OKF bundles and the read-only `memory.ltm` port. The package root re-exports it.
 */
export {
  CODING_PRESET_REVISION,
  CONVERSATIONAL_PRESET_REVISION,
  type MemoryFabricConfig,
  type MemoryFabricCuesConfig,
  type MemoryFabricExchangesConfig,
  type MemoryFabricInjectConfig,
  type MemoryFabricLifecycleConfig,
  type MemoryFabricMarkdownStoreConfig,
  type MemoryFabricPostgresStoreConfig,
  type MemoryFabricPresetName,
  type MemoryFabricProjectScopeConfig,
  type MemoryFabricRulesConfig,
  type MemoryFabricScopesConfig,
  type MemoryFabricTeamConfig,
  type MemoryFabricToolsConfig,
  memoryFabricConfigSchema,
  type ResolvedFabricExchangesOptions,
  type ResolvedFabricRulesOptions,
  type ResolvedFabricScope,
  type ResolvedFabricTeamOptions,
  type ResolvedLifecycleConfig,
  type ResolvedMemoryFabricConfig,
  resolveLifecycleConfig,
  resolveMemoryFabricConfig,
} from "./config.js";
export { type MemoryConformanceStores, runMemoryConformance } from "./conformance.js";
export type {
  DecisionCandidate,
  DecisionPoint,
  DecisionPointSpec,
  FabricDecisions,
  MemoryFabricDecisionsConfig,
  ResolvedDecisionsConfig,
} from "./decisions.js";
export * from "./exports.js";
export { createMemory } from "./memory.js";
