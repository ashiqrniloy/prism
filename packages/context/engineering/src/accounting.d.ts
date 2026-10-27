/**
 * Per-request context accounting and the injected-block share cap (plan 194 Task 5).
 *
 * One pass over the final provider request: classify every message by source, add the assembler's
 * tool-declaration text, and emit counts only — never text.
 * The optional `blocks.maxShare` cap drops whole injected blocks (prefix block messages and the
 * `metadata.contextBlocks` tail) by lowest priority, then latest-added. The system prompt and plain
 * instruction layers are never entries here, so they can never be counted against the share or
 * dropped by it.
 */
import type { ProviderRequest } from "@arnilo/prism";
export interface ContextAccountEvent {
    readonly turn: number;
    /** The model input cap the share is measured against; `0` when the model declares no window. */
    readonly inputCapTokens: number;
    readonly totalTokens: number;
    readonly bySource: {
        readonly system: number;
        readonly instructions: number;
        readonly skills: number;
        readonly history: number;
        readonly toolResults: number;
        readonly folded: number;
        readonly input: number;
        readonly blocks: Readonly<Record<string, number>>;
        readonly tail: Readonly<Record<string, number>>;
    };
    readonly dropped: readonly {
        readonly source: string;
        readonly tokens: number;
    }[];
}
export interface AccountRequestOptions {
    /** Fraction of the input cap injected blocks may occupy. Absent: no cap, measure only. */
    readonly maxShare?: number;
    readonly inputCapTokens: number;
}
export interface AccountedRequest {
    readonly request: ProviderRequest;
    readonly event: ContextAccountEvent;
}
/** Account one final provider request; optionally cap the injected context-block share. */
export declare function accountRequest(request: ProviderRequest, options: AccountRequestOptions): AccountedRequest;
