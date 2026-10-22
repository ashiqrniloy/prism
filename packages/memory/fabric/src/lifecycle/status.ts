/** Lifecycle of a note that has to earn its place: `candidate` → `verified` → `archived` / `retired`. */
export type MemoryNoteStatus = "candidate" | "verified" | "archived" | "retired";

export function isMemoryNoteStatus(value: unknown): value is MemoryNoteStatus {
  return value === "candidate" || value === "verified" || value === "archived" || value === "retired";
}

/**
 * Normalize a stored status with an explicit fallback for rows that carry none: plain fabric notes
 * written before the lifecycle existed are `verified`; a missing status in the scoped layer is
 * `candidate`.
 */
export function normalizeNoteStatus(status: string | undefined, fallback: MemoryNoteStatus): MemoryNoteStatus {
  return isMemoryNoteStatus(status) ? status : fallback;
}

export interface ActiveNoteOptions {
  readonly asOfMs?: number;
  readonly allowCandidate?: boolean;
  /** Keep archived notes in the result: archive search, never injection. */
  readonly allowArchived?: boolean;
}

/**
 * Predicate shared by recall, passive injection, and the directory: a note is active when it is
 * verified (or candidate when explicitly allowed), and not archived (unless a historical `asOfMs`
 * query places the lookup before its archival timestamp).
 */
export function isActiveNote(
  noteOrStatus: { status?: MemoryNoteStatus | string; archivedAt?: string } | string | undefined,
  options: ActiveNoteOptions = {},
): boolean {
  const status = typeof noteOrStatus === "string" ? noteOrStatus : noteOrStatus?.status;
  const archivedAt = typeof noteOrStatus === "object" && noteOrStatus !== null ? noteOrStatus.archivedAt : undefined;
  const normalized = normalizeNoteStatus(status, "verified");
  if (normalized === "candidate") return options.allowCandidate === true;
  if (normalized === "archived") {
    if (options.allowArchived === true) return true;
    if (options.asOfMs !== undefined && archivedAt !== undefined) {
      const at = Date.parse(archivedAt);
      return Number.isFinite(at) && options.asOfMs < at;
    }
    return false;
  }
  return true;
}
