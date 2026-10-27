/** Provider-neutral decision-call contract (plan 195).
 *  A decision model answers typed questions about one state in a single pass and returns
 *  calibrated probabilities, instead of generating text. The vocabulary and answer shapes
 *  mirror System One because every endpoint known today speaks it; the kernel names no vendor.
 *  Validation lives here, once, and runs before any adapter; callers chunk nothing. */
import type { JsonObject, ModelCapabilities, ModelConfig, Usage } from "./content.js";
/** Text, structured criteria, or message-part arrays accepted as question instructions. */
export type DecisionInstructions = string | JsonObject | readonly unknown[];
export interface DecisionNoulQuestion {
    readonly type: "noul";
    readonly instructions: DecisionInstructions;
    /** Optional descriptions for the true/false outcomes. */
    readonly criteria?: {
        readonly true?: string;
        readonly false?: string;
    };
}
export interface DecisionChoiceQuestion {
    readonly type: "choice";
    readonly instructions: DecisionInstructions;
    /** Option → description (or `null` for no description); 2–255 options. */
    readonly criteria: Readonly<Record<string, string | null>>;
}
export interface DecisionScoreQuestion {
    readonly type: "score";
    readonly instructions: DecisionInstructions;
    /** Ordered level descriptions; 2–10 levels. */
    readonly criteria: readonly string[];
}
/** One typed decision question, discriminated by `type`. */
export type DecisionQuestion = DecisionNoulQuestion | DecisionChoiceQuestion | DecisionScoreQuestion;
export interface DecisionNoulAnswer {
    readonly type: "noul";
    /** Calibrated probability in 0..1. */
    readonly noul: number;
}
export interface DecisionChoiceAnswer {
    readonly type: "choice";
    readonly choice: string;
    readonly probabilities?: Readonly<Record<string, number>>;
    /** Calibrated confidence in 0..1. */
    readonly confidence?: number;
}
export interface DecisionScoreAnswer {
    readonly type: "score";
    /** May land between levels. */
    readonly score: number;
    readonly legend?: Readonly<Record<string, string>>;
    readonly probabilities?: Readonly<Record<string, number>>;
    readonly confidence?: number;
}
/** One answered question, discriminated by `type`. */
export type DecisionAnswer = DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer;
/** Conversation content only — questions written into `state` get judged, not answered. */
export type DecisionState = string | JsonObject | readonly unknown[];
export interface DecisionInput {
    /** Bound by `prism.models.decisions(ref)`; required on the raw `provider.decisions()` adapter. */
    readonly model?: string;
    readonly state?: DecisionState;
    /** Inline `data:image/*` URLs; remote URLs are rejected (no fetch, no SSRF surface). */
    readonly images?: readonly string[];
    readonly questions: Readonly<Record<string, DecisionQuestion>>;
    readonly signal?: AbortSignal;
}
export interface DecisionRequest extends DecisionInput {
    readonly model: string;
}
export interface DecisionResult {
    /** Checkpoint that actually answered; the request's `model` is advisory. */
    readonly model: string;
    /** Raw answers by question id: noul probability, choice probabilities/confidence, score/legend. */
    readonly answers: Readonly<Record<string, DecisionAnswer>>;
    readonly usage?: Usage;
    /** Wall-clock milliseconds for the whole call. */
    readonly timingMs: number;
}
export interface DecisionsProvider {
    readonly id: string;
    decide(request: DecisionRequest): Promise<DecisionResult>;
}
/** A package-facing adapter with the model id already bound. */
export interface DecisionsClient {
    readonly id: string;
    decide(request: DecisionInput): Promise<DecisionResult>;
}
export type DecisionsErrorCode = "unsupported_model" | "invalid_request" | "state_too_large";
export declare class DecisionsError extends Error {
    readonly code: DecisionsErrorCode;
    constructor(code: DecisionsErrorCode, message: string);
}
/** One request may carry at most this many questions (portable kernel bound; the raw System One cap is 256). */
export declare const MAX_DECISION_QUESTIONS = 64;
/** Choice questions accept at most this many options. */
export declare const MAX_DECISION_CHOICE_OPTIONS = 255;
/** Score rubrics accept at most this many levels. */
export declare const MAX_DECISION_SCORE_LEVELS = 10;
/** Serialized `state` ceiling for one decision call: 256 KiB. */
export declare const DEFAULT_MAX_DECISION_STATE_BYTES = 262144;
/** Total inline image ceiling for one decision call: 8 MiB. */
export declare const DEFAULT_MAX_DECISION_IMAGE_BYTES: number;
export declare function modelSupportsDecisions(capabilities?: ModelCapabilities): boolean;
export declare function assertDecisionsSupported(model: ModelConfig): void;
/** Enforces every kernel bound before an adapter builds a request. */
export declare function assertDecisionRequest(request: DecisionRequest, model: ModelConfig): void;
