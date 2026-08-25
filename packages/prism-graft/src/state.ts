import { createSessionEntry, type SessionEntry } from "@arnilo/prism";

import type { GraftFreshness } from "./types.js";

export const GRAFT_STATE_TYPE = "graft-state";

/** Payload of the session custom entry `{ kind: "custom", data }`. */
export interface GraftStateData {
  readonly type: typeof GRAFT_STATE_TYPE;
  readonly lastCheck?: GraftFreshness;
  /** Graph node ids already pushed this session (drop-oldest cap). */
  readonly seen?: readonly string[];
  /** Rough tokens the dedup gate has saved (chars/4 heuristic). */
  readonly savedTokensApprox?: number;
  /** An edit-tool touched a file since the last successful check/build. */
  readonly dirty?: boolean;
}

export function isGraftStateData(value: unknown): value is GraftStateData {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).type === GRAFT_STATE_TYPE;
}

/** Latest graft-state entry data on the branch, or `undefined`. */
export function resolveLatestGraftState(entries: readonly SessionEntry[]): GraftStateData | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "custom" && isGraftStateData(entry.data)) return entry.data;
  }
  return undefined;
}

export interface PersistGraftPatchOptions {
  readonly sessionId?: string;
  readonly patch: Partial<GraftStateData>;
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly appendEntry: (entry: SessionEntry, options?: { readonly expectedParentId?: string }) => Promise<void>;
}

/** Merge a patch into the latest graft-state and append one custom entry. No-op without sessionId. */
export async function persistGraftPatch(options: PersistGraftPatchOptions): Promise<void> {
  if (!options.sessionId) return;
  const entries = await options.getEntries();
  const latest = resolveLatestGraftState(entries);
  const parentId = entries.at(-1)?.id;
  const entry = createSessionEntry({
    sessionId: options.sessionId,
    parentId,
    kind: "custom",
    data: { type: GRAFT_STATE_TYPE, ...latest, ...options.patch },
  });
  await options.appendEntry(entry, { expectedParentId: parentId });
}
