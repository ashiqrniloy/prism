/**
 * `@arnilo/prism-memory-system` — the memory system as one package (roadmap Phase 11, memory model of
 * 2026-11-08: STM → WM → Rehearsal → LTM, plus Sleep).
 *
 * Components (plan 216 Task 6): `stm`, `wm`, `rehearsal`, `ltm` and `sleep`, each an object or `false`. The session
 * tiers (`src/session`) are `stm` (the per-session toggle, the background pass, the ledger, the `recall` tool, the
 * context block and the compaction slot; today's observer), `wm` (today's reflector) and `rehearsal` (today's dropper),
 * unchanged until plans 217–219. Long-term memory (`src/ltm`, the former fabric package) is `ltm`; `sleep` is a no-op
 * until plan 221. A component that is off loads and registers nothing, and declares no capability; a configured
 * component whose dependency is off fails the load with `memory_system_component_missing`. The host imports nothing and
 * wires nothing: installing the package is the opt-in, and `memory:session` turns the session tiers on per session.
 *
 * Cost: the session tiers are off by default. With the toggle off, `context.build`, `turn.completed`,
 * and `compaction.when` each return after one synchronous state read — no model call, no store write,
 * no branch read. With it on, one pass per threshold reads the branch once and appends one ledger
 * record per recorded batch; each worker makes its own model call. Long-term memory retrieval is
 * lexical and makes no model call.
 *
 * ```ts
 * import memorySystem from "@arnilo/prism-memory-system";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "anthropic/claude-sonnet-4-5",
 *   packages: [memorySystem({ stm: { triggerTokens: 4_000 }, ltm: { preset: "conversational", tools: { root: "./memory" } } })],
 * });
 * const session = await agent.session();
 * await agent.commands.run("memory:session", {}, { session });
 * ```
 */

import { definePackage } from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };

import { memorySystemCapabilities, resolveMemorySystemComponents } from "./components.js";
import { type MemorySystemConfig, memorySystemConfigSchema } from "./config.js";
import { createMemorySystemService, MEMORY_SYSTEM_SERVICE } from "./service.js";

// The library surface: the components, the `memory.system` service, the session tiers (ledger, render, config) and
// long-term memory (notes, stores, recall, lifecycle, OKF bundles, the `memory.ltm` port).
export {
  type ChunkOp,
  type ChunkPrepareFailure,
  type ChunkReferrer,
  type ChunkStore,
  type ChunkStoreLocation,
  createSqliteChunkStore,
  MEMORY_CHUNK_STORE_SERVICE,
  type PreparedChunk,
  SqliteChunkStore,
  type StoredChunk,
} from "./chunks.js";
export {
  MEMORY_SYSTEM_COMPONENTS,
  type MemorySystemComponent,
  type MemorySystemComponents,
  MemorySystemError,
  type MemorySystemErrorCode,
  resolveMemorySystemComponents,
} from "./components.js";
export {
  type MemorySleepConfig,
  type MemorySystemComponentConfig,
  type MemorySystemConfig,
  memorySystemConfigSchema,
} from "./config.js";
export * from "./ltm/public.js";
export {
  MEMORY_SYSTEM_SERVICE,
  type MemorySystemService,
  type MemorySystemStatus,
} from "./service.js";
export * from "./session/exports.js";

const definition = definePackage<MemorySystemConfig>({
  name: "@arnilo/prism-memory-system",
  version: manifest.version,
  description:
    "The memory system: session tiers (STM, WM, rehearsal) with a source-backed ledger, recall, and ledger-driven compaction, plus long-term memory (ltm).",
  requires: { api: 1 },
  // The union every component may use; `capabilitiesFor` narrows it to the enabled components'.
  capabilities: ["models", "session-state", "background", "slot:compaction", "credentials", "host-ui"],
  capabilitiesFor(config) {
    // A config with a missing dependency holds nothing; `setup` then fails with the named error.
    try {
      return memorySystemCapabilities(resolveMemorySystemComponents(config));
    } catch {
      return [];
    }
  },
  config: memorySystemConfigSchema,
  async setup(prism) {
    // Composition first: a missing dependency fails before anything registers.
    const config = prism.config ?? {};
    const components = resolveMemorySystemComponents(config);
    prism.services.provide(MEMORY_SYSTEM_SERVICE, createMemorySystemService(components));
    // Each component's code loads only when it is on. Long-term memory first: its hooks ran before the session tiers'
    // when the two were separate packages listed fabric-first, and the provider requests stay byte-identical (Task 5).
    if (components.ltm && typeof config.ltm === "object" && config.ltm !== null) {
      const { setupLongTermMemory } = await import("./ltm/index.js");
      await setupLongTermMemory(prism, config.ltm);
    }
    if (components.stm) {
      const { setupSessionTiers } = await import("./session/setup.js");
      setupSessionTiers(prism, components);
    }
  },
});

export default definition;
