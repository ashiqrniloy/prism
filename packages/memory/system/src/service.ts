/**
 * The `memory.system` service (design §6): one entry point other packages and hosts reach the memory system through.
 * `status()` answers now; `setScope`, `endEpisode` (plan 218), `rehearse` (plan 219) and `sleep` (plan 221) are
 * declared and reject with `not_available_yet` until their plans land.
 */
import { type MemorySystemComponents, MemorySystemError } from "./components.js";

export const MEMORY_SYSTEM_SERVICE = "memory.system";

export interface MemorySystemStatus {
  /** Which components this instance runs. */
  readonly components: MemorySystemComponents;
}

export interface MemorySystemService {
  status(): MemorySystemStatus;
  /** Sets the episode scope. Plan 218. */
  setScope(...args: readonly unknown[]): Promise<never>;
  /** Ends the current episode. Plan 218. */
  endEpisode(...args: readonly unknown[]): Promise<never>;
  /** Runs a rehearsal pass into long-term memory. Plan 219. */
  rehearse(...args: readonly unknown[]): Promise<never>;
  /** Runs an offline consolidation pass. Plan 221. */
  sleep(...args: readonly unknown[]): Promise<never>;
}

const notYet = (method: string, plan: number) => async (): Promise<never> => {
  throw new MemorySystemError("not_available_yet", `memory.system ${method} arrives with plan ${plan}`);
};

export function createMemorySystemService(components: MemorySystemComponents): MemorySystemService {
  const status: MemorySystemStatus = Object.freeze({ components: Object.freeze({ ...components }) });
  return Object.freeze({
    status: () => status,
    setScope: notYet("setScope", 218),
    endEpisode: notYet("endEpisode", 218),
    rehearse: notYet("rehearse", 219),
    sleep: notYet("sleep", 221),
  });
}
