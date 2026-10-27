/** Lifecycle of a note that has to earn its place: `candidate` → `verified` → `archived` / `retired`. */
export type MemoryNoteStatus = "candidate" | "verified" | "archived" | "retired";
export declare function isMemoryNoteStatus(value: unknown): value is MemoryNoteStatus;
/**
 * Normalize a stored status with an explicit fallback for rows that carry none: plain fabric notes
 * written before the lifecycle existed are `verified`; a missing status in the scoped layer is
 * `candidate`.
 */
export declare function normalizeNoteStatus(status: string | undefined, fallback: MemoryNoteStatus): MemoryNoteStatus;
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
export declare function isActiveNote(noteOrStatus: {
    status?: MemoryNoteStatus | string;
    archivedAt?: string;
} | string | undefined, options?: ActiveNoteOptions): boolean;
