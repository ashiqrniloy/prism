/**
 * The `memory.system` service (design §6): one entry point other packages and hosts reach the memory system through.
 * `status()`, `setScope()` (plan 218 Task 1) and `rehearse({ only: "wm" })` (plan 218 Task 2) answer now; `endEpisode`
 * (plan 218), the rest of `rehearse` (plan 219) and `sleep` (plan 221) are declared and reject with `not_available_yet`
 * until their plans land.
 */
import type { SessionContext } from "@arnilo/prism";
import { type MemorySystemComponents, MemorySystemError } from "./components.js";
import type { SessionTiers } from "./session/setup.js";

export const MEMORY_SYSTEM_SERVICE = "memory.system";

export interface MemorySystemStatus {
  /** Which components this instance runs. */
  readonly components: MemorySystemComponents;
}

/** What one `rehearse({ only: "wm" })` pass did. `skipped` when a pass was already in flight for the session. */
export interface MemorySystemWmPassResult {
  /** WM items the pass recorded. */
  readonly items: number;
  /** STM records that received a verdict (and left the STM surface). */
  readonly processed: number;
  readonly skipped?: "in_flight";
}

export interface MemorySystemRehearseOptions {
  /** `"wm"` runs one working-memory pass now, below `wm.triggerTokens`. Rehearsal into LTM arrives with plan 219. */
  readonly only: "wm";
  readonly signal?: AbortSignal;
}

/** A stored episode scope: its hash and size (the text stays in session state). */
export interface MemorySystemScopeResult {
  readonly hash: string;
  readonly bytes: number;
}

export interface MemorySystemService {
  status(): MemorySystemStatus;
  /**
   * Sets the session's episode scope: what the current body of work must achieve, read by WM and Rehearsal only.
   * Rejects with `scope_too_large` (naming `scope.maxBytes`; never truncated), `scope_empty`, or `component_off` when the
   * session tiers are off.
   */
  setScope(session: SessionContext, text: string): Promise<MemorySystemScopeResult>;
  /** Ends the current episode. Plan 218. */
  endEpisode(...args: readonly unknown[]): Promise<never>;
  /**
   * `{ only: "wm" }` runs one WM pass over the session's STM surface now (no pass runs while one is in flight). Rejects
   * with `component_off` when `stm` or `wm` is off. Without `only: "wm"`, rehearsal into LTM arrives with plan 219 and
   * rejects with `not_available_yet`.
   */
  rehearse(session: SessionContext, options: MemorySystemRehearseOptions): Promise<MemorySystemWmPassResult>;
  /** Runs an offline consolidation pass. Plan 221. */
  sleep(...args: readonly unknown[]): Promise<never>;
}

const notYet = (method: string, plan: number) => async (): Promise<never> => {
  throw new MemorySystemError("not_available_yet", `memory.system ${method} arrives with plan ${plan}`);
};

/** `tiers` answers once the session tiers' setup has run; it is absent while `stm` is off. */
export function createMemorySystemService(
  components: MemorySystemComponents,
  tiers: () => SessionTiers | undefined = () => undefined,
): MemorySystemService {
  const status: MemorySystemStatus = Object.freeze({ components: Object.freeze({ ...components }) });
  return Object.freeze({
    status: () => status,
    async setScope(session: SessionContext, text: string): Promise<MemorySystemScopeResult> {
      const current = tiers();
      if (!current) throw new MemorySystemError("component_off", "memory.system setScope needs the stm component");
      if (typeof text !== "string") throw new TypeError("memory.system setScope takes the scope as text");
      const result = await current.setScope(session, text);
      if (!result.ok) throw new MemorySystemError(result.reason, result.text);
      return { hash: result.scope.hash, bytes: result.scope.bytes };
    },
    endEpisode: notYet("endEpisode", 218),
    async rehearse(session: SessionContext, options: MemorySystemRehearseOptions): Promise<MemorySystemWmPassResult> {
      if (options?.only !== "wm") return notYet("rehearse", 219)();
      const current = tiers();
      if (!current || !components.wm)
        throw new MemorySystemError("component_off", 'memory.system rehearse({ only: "wm" }) needs the stm and wm components');
      const result = await current.runWm(session, options.signal);
      return { items: result.wmItems, processed: result.processed, ...(result.skipped ? { skipped: result.skipped } : {}) };
    },
    sleep: notYet("sleep", 221),
  });
}
