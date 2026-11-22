/**
 * The `@arnilo/prism-memory-system` config (plan 216 Task 6): one schema over the components `stm`, `wm`, `rehearsal`,
 * `ltm` and `sleep` (each an object, or `false` to turn it off) plus the shared `context`, `worker`, `recall` and
 * `enabled` fields. `ltm` carries the former fabric package's config, same fields. Which components an omitted value
 * turns on, and which dependency a configured one needs, is `resolveMemorySystemComponents` (`components.ts`).
 */
import type { JsonSchema } from "@arnilo/prism";
import { type MemoryFabricConfig, memoryFabricConfigSchema } from "./ltm/config.js";
import { type MemorySessionConfig, memorySessionConfigSchema } from "./session/config.js";

/** A component's config: an object turns it on, `false` turns it off, omitted (or `null`) resolves the default. */
export type MemorySystemComponentConfig<T> = T | false | null;

/** `sleep` takes no fields until plan 221; `{}` turns the (no-op) component on. */
export type MemorySleepConfig = Readonly<Record<string, never>>;

/** Validated `packageConfig` for `@arnilo/prism-memory-system`. Every key is optional. */
export interface MemorySystemConfig extends Omit<MemorySessionConfig, "stm" | "wm" | "rehearsal"> {
  /** Short-term memory: the observer, ledger, `recall` tool, context block and compaction slot. Omitted, it is on. */
  readonly stm?: MemorySystemComponentConfig<NonNullable<MemorySessionConfig["stm"]>>;
  /** Working memory (experimental): the reflector. Needs `stm`. Off unless an object is given (`wm: {}`). */
  readonly wm?: MemorySystemComponentConfig<NonNullable<MemorySessionConfig["wm"]>>;
  /** Rehearsal: today's dropper. Needs `wm` and `ltm`. Omitted, it is on only when both are. */
  readonly rehearsal?: MemorySystemComponentConfig<NonNullable<MemorySessionConfig["rehearsal"]>>;
  /** Long-term memory: typed notes, scopes, recall and lifecycle behind the `memory.*` tools. Omitted, it is off. */
  readonly ltm?: MemorySystemComponentConfig<MemoryFabricConfig>;
  /** Offline consolidation. Needs `ltm`. A no-op until plan 221. Omitted, it is off. */
  readonly sleep?: MemorySystemComponentConfig<MemorySleepConfig>;
}

/** `null` (the default: resolve from the other components), `false` (off) or an object (on, with the node's fields). */
const COMPONENT_SHAPES: JsonSchema["anyOf"] = [{ const: null }, { const: false }, { type: "object", additionalProperties: true }];

/**
 * A component node. It keeps the object's own `properties` (so an unknown or retired key keeps its named
 * `/<component>/<key>` error) without `type`, so `false` validates. `default: null` stops the kernel from materialising
 * the object from its fields' defaults, which would turn the component on whenever it is omitted.
 */
function componentNode(node: JsonSchema, description: string): JsonSchema {
  const { type: _object, ...shape } = node;
  return { ...shape, description, anyOf: COMPONENT_SHAPES, default: null, "x-prism-stability": "contract" };
}

const session = memorySessionConfigSchema.properties ?? {};

/**
 * Config sections outside the stability promise (plan 240 Task 4): every path under them is documented
 * `experimental` in the README's config stability table and may change or be removed in any release. The session
 * tier (`enabled`, `stm`, `context`, `worker`, `recall`, `recallLimits`) is under the promise.
 */
export const MEMORY_SYSTEM_EXPERIMENTAL_SECTIONS: ReadonlySet<string> = new Set(["wm", "rehearsal", "scope", "ltm", "sleep"]);

export const memorySystemConfigSchema: JsonSchema = {
  ...memorySessionConfigSchema,
  properties: {
    ...session,
    stm: componentNode(
      session.stm as JsonSchema,
      "Short-term memory (today's observer): an object turns it on, false turns it off. Omitted, it is on.",
    ),
    wm: componentNode(
      session.wm as JsonSchema,
      "Working memory (experimental; today's reflector). Needs stm. Off unless an object is given; {} turns it on.",
    ),
    rehearsal: componentNode(
      session.rehearsal as JsonSchema,
      "Rehearsal (today's dropper). Needs wm and ltm. Omitted, it is on only when both are; false turns it off.",
    ),
    ltm: componentNode(
      memoryFabricConfigSchema,
      "Long-term memory: typed notes, scopes, recall and lifecycle behind the memory.* tools. Omitted, it is off.",
    ),
    sleep: componentNode(
      { type: "object", additionalProperties: false, properties: {} },
      "Offline consolidation. Needs ltm. A no-op until plan 221, with no fields yet. Omitted, it is off.",
    ),
  },
};
