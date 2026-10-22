import { MemoryValidationError } from "./errors.js";
import { recordBlocked } from "./lineage.js";
import type { MemoryInvalidationRecord, MemoryVectorRecord } from "./types.js";

/** Most tags one `topTags` call returns, so a memory with thousands of distinct tags cannot flood a turn. */
export const HARD_DIRECTORY_TAGS = 500;

/**
 * An active note is one a recall at `asOf` could return: it carries a fabric `kind`, is inside its
 * validity window, has visible consent, is not invalidated, and is not an unverified `candidate`.
 */
export interface MemoryDirectoryQuery {
  /** ISO timestamp for the validity window; defaults to now. */
  readonly asOf?: string;
  readonly signal?: AbortSignal;
}

export interface MemoryTopTagsQuery extends MemoryDirectoryQuery {
  /** Defaults to 20, capped at {@link HARD_DIRECTORY_TAGS}. */
  readonly limit?: number;
}

export interface MemoryTagCount {
  readonly tag: string;
  readonly count: number;
}

/** Resolve `asOf` to an ISO string; a malformed value fails closed. */
export function resolveDirectoryAsOf(asOf: string | undefined): string {
  if (asOf === undefined) return new Date().toISOString();
  if (typeof asOf !== "string" || !Number.isFinite(Date.parse(asOf))) throw new MemoryValidationError("asOf must be an ISO timestamp");
  return new Date(asOf).toISOString();
}

export function resolveDirectoryLimit(limit: number | undefined): number {
  const resolved = limit ?? 20;
  if (!Number.isInteger(resolved) || resolved < 1) throw new MemoryValidationError("limit must be a positive integer");
  if (resolved > HARD_DIRECTORY_TAGS) throw new MemoryValidationError(`limit exceeds hard cap ${HARD_DIRECTORY_TAGS}`);
  return resolved;
}

function fabricFields(record: Pick<MemoryVectorRecord, "metadata">): Record<string, unknown> | undefined {
  const raw = record.metadata?.fabric;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/**
 * The scan form of the store predicates in the SQLite and Postgres aggregates; all three must agree.
 * Returns the note's kind and distinct tags/keywords, or `undefined` when the record is not active.
 */
export function activeDirectoryNote(
  record: MemoryVectorRecord,
  invalidations: ReadonlyMap<string, MemoryInvalidationRecord>,
  asOfMs: number,
): { readonly kind: string; readonly tags: readonly string[] } | undefined {
  const fields = fabricFields(record);
  if (!fields || typeof fields.kind !== "string") return undefined;
  if (
    record.consent?.visible === false ||
    record.metadata?.status === "candidate" ||
    (record.metadata?.status === "archived" &&
      (typeof fields.archivedAt !== "string" || !Number.isFinite(Date.parse(fields.archivedAt)) || Date.parse(fields.archivedAt) <= asOfMs))
  )
    return undefined;
  for (const [key, inside] of [
    ["validFrom", (ms: number) => ms <= asOfMs],
    ["validTo", (ms: number) => ms > asOfMs],
  ] as const) {
    if (fields[key] === undefined) continue;
    const ms = typeof fields[key] === "string" ? Date.parse(fields[key]) : Number.NaN;
    if (!Number.isFinite(ms) || !inside(ms)) return undefined;
  }
  if (recordBlocked(record, invalidations)) return undefined;
  const tags = new Set<string>();
  for (const key of ["tags", "keywords"]) {
    const list = fields[key];
    if (Array.isArray(list)) for (const tag of list) if (typeof tag === "string" && tag.length > 0) tags.add(tag);
  }
  return { kind: fields.kind, tags: [...tags] };
}

/** Count active notes by kind and rank their tags in one pass; the in-memory store's aggregate. */
export function scanDirectory(
  records: Iterable<MemoryVectorRecord>,
  invalidations: ReadonlyMap<string, MemoryInvalidationRecord>,
  asOf: string,
): { readonly counts: Readonly<Record<string, number>>; readonly tags: Map<string, number> } {
  const asOfMs = Date.parse(asOf);
  const counts: Record<string, number> = {};
  const tags = new Map<string, number>();
  for (const record of records) {
    const note = activeDirectoryNote(record, invalidations, asOfMs);
    if (!note) continue;
    counts[note.kind] = (counts[note.kind] ?? 0) + 1;
    for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return { counts, tags };
}

/** Count desc, then tag ascending by code unit: the order every store returns. */
export function rankDirectoryTags(tags: ReadonlyMap<string, number>, limit: number): readonly MemoryTagCount[] {
  return [...tags]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, limit);
}
