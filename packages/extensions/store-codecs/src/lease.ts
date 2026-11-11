import { throwIfAborted } from "./util.js";

/**
 * Store-side lease conflict error (plan 168 Task 4). The `code` is the cross-package contract, so a
 * consumer matches on `error.code` rather than `instanceof` (see `checkpoint.ts`).
 */
export const LEASE_CONFLICT_CODE = "ERR_PRISM_LEASE_CONFLICT";

export class LeaseConflictError extends Error {
  readonly code = LEASE_CONFLICT_CODE;

  constructor(message: string) {
    super(message);
    this.name = "LeaseConflictError";
  }
}

export function assertLeaseInput(
  namespace: string,
  key: string,
  ownerId: string,
  ttlMs?: number,
  signal?: AbortSignal,
  token?: string,
): void {
  throwIfAborted(signal);
  if (
    !namespace ||
    !key ||
    !ownerId ||
    (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1)) ||
    (token !== undefined && !token)
  )
    throw new LeaseConflictError("Invalid lease input");
}
