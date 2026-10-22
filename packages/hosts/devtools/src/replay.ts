/**
 * Paged replay over a session's stored entries. Read-only: no run starts and no provider is consulted.
 * A cursor is the index of the next entry, so a page is a slice of the list the session already holds.
 */
import type { SessionEntry } from "@arnilo/prism";
import { DevtoolsError } from "./errors.js";

export const REPLAY_DEFAULT_LIMIT = 100;
export const REPLAY_MAX_LIMIT = 500;

export interface ReplayPage {
  readonly items: readonly SessionEntry[];
  readonly nextCursor?: string;
  readonly terminal: boolean;
}

export function replayPage(
  entries: readonly SessionEntry[],
  options: { readonly cursor?: string; readonly limit?: number } = {},
): ReplayPage {
  const start = parseCursor(options.cursor);
  const limit = options.limit ?? REPLAY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REPLAY_MAX_LIMIT) {
    throw new DevtoolsError(`limit must be an integer from 1 to ${REPLAY_MAX_LIMIT}`, "ERR_PRISM_DEVTOOLS_QUERY");
  }
  if (start > entries.length) throw new DevtoolsError("cursor is past the last entry", "ERR_PRISM_DEVTOOLS_QUERY");
  const end = Math.min(entries.length, start + limit);
  const terminal = end === entries.length;
  return { items: entries.slice(start, end), terminal, ...(terminal ? {} : { nextCursor: String(end) }) };
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d{1,15}$/.test(cursor)) throw new DevtoolsError("cursor must be a non-negative integer", "ERR_PRISM_DEVTOOLS_QUERY");
  return Number(cursor);
}
