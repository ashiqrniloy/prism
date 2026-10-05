import { LeaseConflictError } from "@arnilo/prism";
import { throwIfAborted } from "./util.js";

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
