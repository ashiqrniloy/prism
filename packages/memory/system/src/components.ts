/**
 * The memory system's components (plan 216 Task 6, design §6): `stm`, `wm`, `rehearsal`, `ltm` and `sleep`, each an
 * object (on) or `false` (off). An omitted component resolves from the others; an explicitly configured one whose
 * dependency is off fails closed with `memory_system_component_missing`, naming both components.
 */
import type { Capability } from "@arnilo/prism";
import type { MemorySystemConfig } from "./config.js";

/** The memory system's component names, in pipeline order. */
export const MEMORY_SYSTEM_COMPONENTS = ["stm", "wm", "rehearsal", "ltm", "sleep"] as const;
export type MemorySystemComponent = (typeof MEMORY_SYSTEM_COMPONENTS)[number];

/** Which components are on for one package instance. */
export type MemorySystemComponents = Readonly<Record<MemorySystemComponent, boolean>>;

export type MemorySystemErrorCode =
  | "memory_system_component_missing"
  | "not_available_yet"
  | "component_off"
  | "scope_too_large"
  | "scope_empty";

/**
 * A named memory-system failure: a component whose dependency is off, a service method whose plan has not landed or
 * whose component is off, or a refused episode scope.
 */
export class MemorySystemError extends Error {
  constructor(
    readonly code: MemorySystemErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "MemorySystemError";
  }
}

const isOn = (value: unknown): boolean => typeof value === "object" && value !== null;

/**
 * Resolves the enabled components and fails closed on a missing dependency. Omitted (`undefined` or `null`):
 * `stm` is on; `wm` follows `stm`; `rehearsal` is on only when `wm` and `ltm` are; `ltm` and `sleep` are off.
 */
export function resolveMemorySystemComponents(config: MemorySystemConfig = {}): MemorySystemComponents {
  const omitted = (value: unknown) => value === undefined || value === null;
  const stm = config.stm !== false;
  const ltm = isOn(config.ltm);
  const wm = omitted(config.wm) ? stm : config.wm !== false;
  if (wm && !stm) missing("wm", "stm");
  const rehearsal = omitted(config.rehearsal) ? wm && ltm : config.rehearsal !== false;
  if (rehearsal && !wm) missing("rehearsal", "wm");
  if (rehearsal && !ltm) missing("rehearsal", "ltm");
  const sleep = isOn(config.sleep);
  if (sleep && !ltm) missing("sleep", "ltm");
  return { stm, wm, rehearsal, ltm, sleep };
}

function missing(component: MemorySystemComponent, needs: MemorySystemComponent): never {
  throw new MemorySystemError(
    "memory_system_component_missing",
    `memory-system component "${component}" needs "${needs}", which is off; configure "${needs}" or set ${component}: false`,
  );
}

/**
 * The capabilities the enabled components use. A component that is off declares nothing; with every component off,
 * the package holds none (the `memory.system` service needs no capability).
 */
export function memorySystemCapabilities(components: MemorySystemComponents): readonly Capability[] {
  const capabilities = new Set<Capability>();
  // The session tiers: worker model calls, the toggle and ledger, the background pass, the compaction slot, and host UI
  // (`memory:scope { path }` asks the host to resolve the file).
  if (components.stm)
    for (const capability of ["models", "session-state", "background", "slot:compaction", "host-ui"] as const) capabilities.add(capability);
  // Long-term memory: worker and decision model calls, its session state, background passes, store credentials, host UI.
  if (components.ltm)
    for (const capability of ["models", "session-state", "background", "credentials", "host-ui"] as const) capabilities.add(capability);
  return [...capabilities];
}
