import type { ModelClient, SecretRedactor } from "@arnilo/prism";
import { type ResolvedMemoryWorkerLimits } from "@arnilo/prism-memory-observational";
import type { MemoryConsolidationCandidate } from "./consolidate.js";
export type ConsolidationDecision = {
    readonly action: "ADD" | "NOOP";
} | {
    readonly action: "UPDATE" | "SUPERSEDE";
    readonly id: string;
};
/** One bounded model call; validate the whole response before the caller mutates any row. */
export declare function decideConsolidation(input: {
    readonly client: ModelClient;
    readonly text: string;
    readonly candidates: readonly MemoryConsolidationCandidate[];
    readonly limits: ResolvedMemoryWorkerLimits;
    readonly redactor?: SecretRedactor;
    readonly sessionId?: string;
    readonly signal?: AbortSignal;
}): Promise<ConsolidationDecision>;
