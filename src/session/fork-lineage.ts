import type { SessionEntry } from "../contracts-core/session.js";

/** Entry metadata key `fork()` stamps on every copied entry: its ids in the sessions it was copied from, oldest first. */
const FORKED_FROM_METADATA_KEY = "forkedFrom";

/**
 * The ids an entry had in the sessions it was copied from by `fork()`, oldest first (empty for an entry written in its
 * own session). A package that recorded entry ids in the parent resolves them to the fork's copies through it
 * (plan 218.3 Task 4). Kept in entry `metadata`, so every store persists it without a schema change.
 */
export function sessionEntryForkedFrom(entry: Pick<SessionEntry, "metadata">): readonly string[] {
  const value = entry.metadata?.[FORKED_FROM_METADATA_KEY];
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** The metadata of `entry`'s copy in a fork: `entry.id` appended to its fork lineage. */
export function forkedEntryMetadata(entry: SessionEntry): Readonly<Record<string, unknown>> {
  return { ...entry.metadata, [FORKED_FROM_METADATA_KEY]: [...sessionEntryForkedFrom(entry), entry.id] };
}
