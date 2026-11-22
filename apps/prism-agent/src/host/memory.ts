import { dirname, join } from "node:path";
import type { ModelRef, PackageInstance } from "@arnilo/prism";
import memorySystem from "@arnilo/prism-memory-system";
import type { HostConfig } from "./config.js";
import { sessionCompactAfterRunFor } from "./context-budgets.js";

/**
 * True when session memory is the workers' compaction system: the default since plan 240 Task 6. `compaction: "llm"`
 * opts into LLM compaction instead (one compaction system per agent, plan 218.3 Task 2).
 */
export function sessionMemoryCompacts(config: HostConfig): boolean {
  return config.compaction !== "llm";
}

/**
 * The memory-system packages a coding or research worker lists (plan 240 Task 6).
 * - **Session memory** (the default): STM records and compacts every session (`enabled: true`). Working memory stays off
 *   (an experimental opt-in in the memory system). The host's `memory` opt-in adds long-term memory with its preset.
 * - **`compaction: "llm"`**: no memory package unless `memory` is set. Then long-term memory loads, with session
 *   compaction off and STM off until a session runs `memory:session`.
 */
export function memoryPackagesFor(config: HostConfig, model: ModelRef): readonly PackageInstance[] {
  const ltm =
    config.memory === undefined ? {} : { ltm: { preset: config.memory, tools: { root: join(dirname(config.storePath), "memory") } } };
  if (sessionMemoryCompacts(config)) return [memorySystem({ ...ltm, enabled: true, context: sessionContextFor(model) })];
  if (config.memory === undefined) return [];
  return [memorySystem({ ...ltm, stm: {}, context: { compaction: false } })];
}

function sessionContextFor(model: ModelRef): { compactAfterRun?: { maxTokens: number } } {
  const compactAfterRun = sessionCompactAfterRunFor(model);
  return compactAfterRun === undefined ? {} : { compactAfterRun };
}
