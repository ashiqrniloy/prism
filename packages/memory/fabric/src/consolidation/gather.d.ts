/**
 * Candidate gathering for session consolidation (plan 188.3 Task 1).
 *
 * A pure, bounded function over `session.entries()`: it reads the records observational memory
 * already keeps (reflections, task-state decisions, high-relevance observations) plus the signals
 * in the transcript itself (explicit user statements, corrections, successful outcomes), and makes
 * no model or store call. Only the extractor (Task 2) interprets what is gathered here.
 */
import type { SessionEntry } from "@arnilo/prism";
export type ConsolidationSource = "explicit" | "correction" | "decision" | "observation" | "reflection" | "exchange";
/** The signals a candidate carries into scoring (Task 3); every other term comes from the extractor. */
export interface ConsolidationSignals {
    readonly explicit?: 1;
    readonly correction?: 1;
    readonly outcome?: 1;
}
export interface ConsolidationCandidate {
    readonly source: ConsolidationSource;
    readonly text: string;
    readonly evidenceIds: readonly string[];
    readonly signals: ConsolidationSignals;
    /** When the evidence happened, for a candidate that knows (an archived exchange). */
    readonly tRef?: string;
    /** Notes the assistant cited before the user corrected it; harmful evidence for those notes. */
    readonly citedNotes?: readonly string[];
}
export interface ConsolidationPatterns {
    readonly explicit: readonly string[];
    readonly correction: readonly string[];
    readonly outcomes: readonly string[];
}
/**
 * The default pattern sets, as exported data the README lists. Explicit statements are the user's
 * own instructions; corrections say the last assistant turn was wrong; outcomes are tool calls whose
 * success tags the work it produced.
 */
export declare const CONSOLIDATION_PATTERNS: ConsolidationPatterns;
export declare const DEFAULT_MAX_CONSOLIDATION_CANDIDATES = 48;
export interface GatherConsolidationOptions {
    /** The last entry id a previous pass covered; entries at or before it are skipped. */
    readonly cursor?: string;
    /** Most candidates a pass may gather. Default 48. */
    readonly maxCandidates?: number;
    /** Per-candidate text cap. Default `memory.limits.maxEntryTextChars`. */
    readonly maxTextChars?: number;
    /** Overrides for the default pattern sets; each key replaces that set whole. */
    readonly patterns?: Partial<ConsolidationPatterns>;
    /**
     * Session redactor applied to every candidate text. Entries as persisted are already redacted;
     * this is the second pass a host with its own secrets supplies.
     */
    readonly redact?: (text: string) => string;
}
/**
 * Gather the candidates a consolidation pass may extract from. Ordered by source priority, bounded
 * by `maxCandidates`, and idempotent for the same cursor.
 */
export declare function gatherConsolidationCandidates(entries: readonly SessionEntry[], options?: GatherConsolidationOptions): readonly ConsolidationCandidate[];
