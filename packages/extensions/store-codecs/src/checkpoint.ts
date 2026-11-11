/**
 * Store-side checkpoint conflict error (plan 168 Task 4).
 *
 * The `checkpoints` service contract lives in `@arnilo/prism-extensions/workflows`, but a store package must not
 * load that engine at runtime. The **code** is the cross-package contract: every implementation throws
 * an error carrying `CHECKPOINT_CONFLICT_CODE`, so consumers match on `error.code` rather than
 * `instanceof`.
 */
export const CHECKPOINT_CONFLICT_CODE = "ERR_PRISM_CHECKPOINT_CONFLICT";

export class CheckpointConflictError extends Error {
  readonly code = CHECKPOINT_CONFLICT_CODE;

  constructor(message: string) {
    super(message);
    this.name = "CheckpointConflictError";
  }
}

export function assertCheckpointInput(input: { namespace: string; key: string; version: number }): void {
  if (!input.namespace || !input.key || !Number.isSafeInteger(input.version) || input.version < 1)
    throw new CheckpointConflictError("Invalid checkpoint key or version");
}

export function staleCheckpoint(version: number, current?: number): CheckpointConflictError {
  return new CheckpointConflictError(`Stale checkpoint version ${version} (current ${current ?? "unknown"})`);
}

export function staleCheckpointExpected(expected: number, current: number): CheckpointConflictError {
  return new CheckpointConflictError(`Checkpoint compare-and-swap failed (expected ${expected}, current ${current})`);
}

export function staleCheckpointFence(fence: number | undefined, current: number): CheckpointConflictError {
  return new CheckpointConflictError(`Stale checkpoint fencing token ${fence ?? "missing"} (current ${current})`);
}

export function encodeCheckpointJson(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON serializable");
    return encoded;
  } catch (error) {
    throw new CheckpointConflictError(`${label} must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function decodeCheckpointCursor(cursor?: string): number {
  const value = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new CheckpointConflictError("Invalid checkpoint cursor");
  return value;
}
