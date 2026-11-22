import { dirname, join } from "node:path";
import type { ModelRef, PackageInstance } from "@arnilo/prism";
import memorySystem from "@arnilo/prism-memory-system";
import type { HostConfig } from "./config.js";
import { sessionCompactAfterRunFor } from "./context-budgets.js";

/** True when session memory is the workers' compaction system (`compaction: "session-memory"`, plan 218.3 Task 2). */
export function sessionMemoryCompacts(config: HostConfig): boolean {
  return config.memory !== undefined && config.compaction === "session-memory";
}

/**
 * The memory-system profile a worker lists when the host's `memory` opt-in is set (plan 216 Task 6). The opt-in maps to
 * the `ltm` profile: long-term memory with the opt-in's preset, on for every session. OM's opt-in, the per-session
 * `memory:session` command, maps to the `session` profile: `stm` and `wm` are loaded and stay off until a session turns
 * them on. `rehearsal` is left to resolve: with `wm` and `ltm` both on it runs (today's dropper), as before the components
 * existed. `sleep` stays off.
 *
 * Compaction (plan 218.3 Task 2): by default the workers keep LLM compaction, so session memory's is off. With
 * `compaction: "session-memory"` session memory is on for every session and is the compaction system.
 */
export function memoryProfileFor(
  config: HostConfig & { readonly memory: NonNullable<HostConfig["memory"]> },
  model: ModelRef,
): PackageInstance {
  return memorySystem({
    ltm: { preset: config.memory, tools: { root: join(dirname(config.storePath), "memory") } },
    stm: {},
    wm: {},
    ...(sessionMemoryCompacts(config) ? { enabled: true, context: sessionContextFor(model) } : { context: { compaction: false } }),
  });
}

function sessionContextFor(model: ModelRef): { compactAfterRun?: { maxTokens: number } } {
  const compactAfterRun = sessionCompactAfterRunFor(model);
  return compactAfterRun === undefined ? {} : { compactAfterRun };
}
