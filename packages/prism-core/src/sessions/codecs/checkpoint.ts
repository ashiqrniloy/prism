import { CheckpointConflictError } from "@arnilo/prism";

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
