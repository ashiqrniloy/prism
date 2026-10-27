/**
 * Writing accepted consolidation notes (plan 188.3 Task 4).
 *
 * One write path for tools and promotion: an accepted note becomes a candidate through the same
 * `remember` the agent uses, so write-time consolidation, the optional decider, and the
 * never-demote-a-verified-note rule all apply. This module adds only what a session pass knows that
 * a tool write does not: where the note came from, what it contradicts, and whether it replaces an
 * existing note in place.
 */
import type { Memory } from "@arnilo/prism-memory-core";
import type { MemoryNoteStatus } from "../lifecycle/index.js";
import { type MemoryFabric, type MemoryFabricScopeBinding, type MemoryNoteScope } from "../types.js";
import type { ExtractedNote } from "./extract.js";
import type { PromotionScore } from "./score.js";
/** An active note the pass recalled: enough to route a contradiction and reconsolidate in place. */
export interface ConsolidationKnownNote {
    readonly id: string;
    readonly kind: string;
    readonly text: string;
    readonly level?: MemoryNoteScope;
    readonly key?: string;
    readonly status?: MemoryNoteStatus;
    readonly flags?: readonly string[];
    readonly sourceEntryIds?: readonly string[];
    readonly supersedes?: string;
}
/** One note the gate accepted, with the gathered candidates it cites already resolved. */
export interface AcceptedConsolidationNote {
    readonly note: ExtractedNote;
    readonly score: PromotionScore;
    /** Session entry ids behind `note.evidence`, stored as `sources[]`. */
    readonly evidenceEntryIds: readonly string[];
    /** An existing note this note updates in place (reconsolidation): same id, correction lineage kept. */
    readonly replacing?: ConsolidationKnownNote;
    /** A shown existing note this note contradicts. */
    readonly contradicts?: ConsolidationKnownNote;
    /** A shown note this keyed value replaces; the write path supersedes it. */
    readonly supersedes?: {
        readonly id: string;
    };
}
export interface WriteConsolidationNotesInput {
    readonly remember: MemoryFabric["remember"];
    /** The project memory; `scopes` names the other levels a wider note may live in. */
    readonly memory: Memory;
    readonly scopes?: readonly MemoryFabricScopeBinding[];
    readonly notes: readonly AcceptedConsolidationNote[];
    /** Reconsolidating notes the extractor returned nothing for: retired, never deleted. */
    readonly retire?: readonly {
        readonly id: string;
        readonly level?: MemoryNoteScope;
    }[];
    /** Exchange note ids → the scope they live in, so a fact links only exchanges its scope can read. */
    readonly exchangeEvidence?: ReadonlyMap<string, MemoryNoteScope>;
    readonly sessionId: string;
    readonly pass: string;
    /** The project id added to `contradictedIn`; required for an exception to be written. */
    readonly projectId?: string;
    readonly now?: string;
    readonly signal?: AbortSignal;
}
export interface SkippedConsolidationWrite {
    readonly text: string;
    readonly reason: "episode-view" | "exception-scope" | "exception-key" | "exception-project" | "contradicted-note-missing" | "flagged" | "retired";
}
export interface WriteConsolidationNotesResult {
    readonly written: number;
    readonly updated: number;
    readonly exceptions: number;
    readonly retired: number;
    readonly skipped: readonly SkippedConsolidationWrite[];
}
/**
 * Write the accepted notes, then retire the reconsolidating notes that produced nothing.
 *
 * A contradiction of a wider note becomes an exception in the narrower scope: same `key`, plus
 * `overrides` naming the wider note, so plan 188.2's narrowest-scope-wins shadowing applies. The
 * wider note gains this project id in `contradictedIn` (ids only, never text). An exception never
 * targets `user` or `agent` scope from a project session.
 */
export declare function writeConsolidationNotes(input: WriteConsolidationNotesInput): Promise<WriteConsolidationNotesResult>;
