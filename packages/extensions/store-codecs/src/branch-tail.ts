import { isCompactionEntryData, type SessionEntry } from "@arnilo/prism";

/** Where a {@link BranchTailSource.walk} stops: after the first `compaction` entry, after the entry with this id, or at the root. */
export type BranchWalkStop = { readonly kind: "compaction" } | { readonly id: string } | undefined;

/** The two reads a SQL store answers a `from: "compaction"` branch read with. */
export interface BranchTailSource {
  /**
   * The ancestors of `seedId` in this session, the seed first and walking toward the root, ending at the
   * entry that matches `stop` (included). `seed` marks the leaf walk, where the store applies its seed filters.
   */
  walk(seedId: string, stop: BranchWalkStop, seed: boolean): Promise<SessionEntry[]>;
  /** The entries with these ids in this session, in any order. */
  byIds(ids: readonly string[]): Promise<SessionEntry[]>;
}

/**
 * Plan 230 Task 3: `readBranchPath({ from: "compaction" })` for a SQL store. One walk from the leaf stops
 * at the newest compaction; a second goes on to its `throughEntryId` (included); then the entries its
 * `keepEntryIds` name that neither walk reached are read by id and put first. A branch with no compaction,
 * or one whose compaction names no reachable `throughEntryId`, comes back whole. Branch order, leaf last.
 */
export async function readBranchTail(source: BranchTailSource, leafId: string): Promise<SessionEntry[]> {
  const head = await source.walk(leafId, { kind: "compaction" }, true);
  const compaction = head.at(-1);
  if (compaction?.kind !== "compaction" || compaction.parentId === undefined) return head.reverse();
  const data = isCompactionEntryData(compaction.data) ? compaction.data : undefined;
  const through = data?.throughEntryId;
  const rest = await source.walk(compaction.parentId, through === undefined ? undefined : { id: through }, false);
  const chain = [...head, ...rest].reverse();
  if (through === undefined || rest.at(-1)?.id !== through) return chain;
  const walked = new Set(chain.map((entry) => entry.id));
  const missing = [...new Set(data?.keepEntryIds ?? [])].filter((id) => !walked.has(id));
  return [...(missing.length > 0 ? await source.byIds(missing) : []), ...chain];
}
