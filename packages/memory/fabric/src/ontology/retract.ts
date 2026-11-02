/**
 * Id-carrying retraction events (plan 207 Task 2). `noteMemoryRetraction` (directory.ts) is a counter that ends
 * pinned prefix epochs; it knows no ids, so it cannot drive the concept deletion cascade. Every place the fabric
 * removes or demotes a note awaits {@link emitMemoryRetract} before the call returns, and the cascade listens.
 */

export type MemoryRetractReason =
  /** `memory.forget`, a propagator tombstone. */
  | "forgotten"
  /** A store delete by id: retention, import-replace, capacity eviction. */
  | "deleted"
  | "revoked"
  | "legal_hold"
  /** The note's text was corrected in place. */
  | "corrected"
  /** A newer note replaced it, or its validity closed. */
  | "superseded"
  | "archived"
  /** A verified note became a candidate. */
  | "downgraded"
  /** A trust-scan class flagged it. */
  | "flagged"
  /** An import replaced the scope. */
  | "import";

/** Reasons that remove the claims citing a note; every other reason marks them stale. */
const REMOVING: ReadonlySet<MemoryRetractReason> = new Set(["forgotten", "deleted", "revoked", "legal_hold"]);

export function retractionRemovesClaims(reason: MemoryRetractReason): boolean {
  return REMOVING.has(reason);
}

export interface MemoryRetractEvent {
  readonly ids: readonly string[];
  readonly reason: MemoryRetractReason;
}

export type MemoryRetractListener = (event: MemoryRetractEvent) => void | Promise<void>;

const listeners = new WeakMap<object, MemoryRetractListener>();

/** One listener per memory instance; setting `undefined` removes it. */
export function setMemoryRetractListener(memory: object, listener: MemoryRetractListener | undefined): void {
  if (listener === undefined) listeners.delete(memory);
  else listeners.set(memory, listener);
}

/** Awaited by the retracting call before it returns. A listener failure surfaces: the cascade is idempotent, so the caller can retry. */
export async function emitMemoryRetract(memory: object, event: MemoryRetractEvent): Promise<void> {
  if (event.ids.length === 0 && event.reason !== "import") return;
  await listeners.get(memory)?.(event);
}
