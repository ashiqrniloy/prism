/**
 * The consolidation extractor (plan 188.3 Task 2): one bounded model call per pass that turns the
 * gathered candidates into atomic, typed, scoped notes.
 *
 * Fail closed. A malformed answer — invalid shape, an unknown kind or scope, an evidence or
 * contradiction id that was not shown, an oversized item — throws `ConsolidationExtractionError`
 * and the caller writes nothing and keeps its cursor. Only the per-item trust scan and secret
 * redactor reject a single note and are counted; everything else rejects the whole answer.
 */
import type { ModelClient, SecretRedactor } from "@arnilo/prism";
import { type ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import { type MemoryNoteScope } from "../types.js";
import type { ConsolidationCandidate } from "./gather.js";
import { type ConsolidationExistingNote, type ConsolidationSegment, type ExtractedNoteKind } from "./prompts.js";
export type ExtractedNoteScope = Exclude<MemoryNoteScope, "agent">;
export interface ExtractedNote {
    readonly text: string;
    readonly kind: ExtractedNoteKind;
    /** Never `agent`: the extractor's agent scope is downgraded to `project`. */
    readonly scope: ExtractedNoteScope;
    readonly appliesTo?: readonly string[];
    readonly key?: string;
    /** When the fact or event happened; copied from the evidence when it carries a time. */
    readonly tRef?: string;
    readonly keywords: readonly string[];
    readonly aliases: readonly string[];
    /** Ids of the shown candidates (`c1`, `c2`, ...) that support the note. */
    readonly evidence: readonly string[];
    readonly explicit: boolean;
    readonly correction: boolean;
    readonly generality: number;
    readonly ephemerality: number;
    readonly derivable: boolean;
    /** A shown existing note this one cannot be reconciled with. */
    readonly contradicts?: string;
    /** The segment an episode summarises. */
    readonly segment?: string;
}
export interface ConsolidationExtraction {
    readonly notes: readonly ExtractedNote[];
    /** The existing notes the extractor was shown, for duplicate and contradiction bookkeeping. Never `agent`-downgraded. */
    readonly existing: readonly ConsolidationExistingNote[];
    readonly rejected: {
        readonly trust: number;
        readonly secret: number;
    };
    /** Actual extractor model calls: 1 for a valid pass, 2 only after one bounded repair. */
    readonly modelCalls: number;
    /** The subset of `modelCalls` spent repairing a malformed answer. */
    readonly correctionCalls: number;
    /** Calls that stopped on the output limit (`max_output_tokens`), repaired or not. */
    readonly outputLimited: number;
}
/** Safe validation reason codes; never raw model text. */
export type ConsolidationExtractionReason = "answer_shape" | "notes_shape" | "note_shape" | "note_kind" | "note_scope" | "path_scope" | "applies_to_shape" | "note_key" | "note_tref" | "evidence_shape" | "evidence_not_shown" | "contradicts_shape" | "contradicts_not_shown" | "episode_shape" | "segment_shape" | "segment_not_shown" | "segment_duplicate" | "tool_call_missing" | "tool_call_shape" | "output_truncated" | "model_call_failed";
/** The closed set, for a fail-closed read of a persisted tally. */
export declare const EXTRACTION_REASONS: ReadonlySet<ConsolidationExtractionReason>;
export declare class ConsolidationExtractionError extends Error {
    readonly reason: string;
    readonly reasonCode: ConsolidationExtractionReason;
    readonly repairable: boolean;
    readonly modelCalls: number;
    readonly correctionCalls: number;
    constructor(reason: string, options?: {
        readonly reasonCode?: ConsolidationExtractionReason;
        readonly modelCalls?: number;
        readonly correctionCalls?: number;
    });
}
export interface ExtractConsolidationNotesInput {
    /** Resolved by the caller only when a pass runs, exactly as the decider's client is. */
    readonly client: ModelClient;
    readonly candidates: readonly ConsolidationCandidate[];
    readonly segments?: readonly ConsolidationSegment[];
    /**
     * Lexical recall of active notes for one scope. Called four times at most, with the candidate text
     * as the query; the fabric's own recall supplies it, so this module never touches a store.
     */
    readonly recallExisting?: (query: string, scope: MemoryNoteScope, limit: number) => Promise<readonly ConsolidationExistingNote[]> | readonly ConsolidationExistingNote[];
    readonly limits: ResolvedMemoryWorkerLimits;
    readonly redactor?: SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
    readonly sessionId?: string;
    /** The project scope with a root is active, so the repository and derivability rules apply. */
    readonly repositoryRules?: boolean;
    /** Default 48, capped by `MAX_EXTRACTED_NOTES`. */
    readonly maxNotes?: number;
    /** The extractor's reasoning effort, passed through to the worker loop. */
    readonly thinkingLevel?: string;
    readonly signal?: AbortSignal;
}
/**
 * One extractor call over the gathered candidates. Returns typed notes, already downgraded and
 * filtered, plus the existing notes it was shown so the caller can resolve contradictions.
 */
export declare function extractConsolidationNotes(input: ExtractConsolidationNotesInput): Promise<ConsolidationExtraction>;
