/** helpers (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import type { CompactionOptions, ContentBlock, ErrorInfo, Message, ProviderEvent, ToolCallContent, Usage } from "../contracts.js";
import { createId } from "../ids.js";
import type { AgentInput } from "../input.js";
export declare function providerContent(event: Extract<ProviderEvent, {
    type: "content_delta" | "tool_call";
}>): ContentBlock;
export declare function reconstructMissingToolCalls(deltas: readonly ProviderEvent[], calls: readonly ToolCallContent[]): readonly ToolCallContent[];
export declare function inputToMessages(input: AgentInput): Message[];
export declare function messageTextBytes(message: Message): number;
export declare class SteerSoftInterrupt extends Error {
    readonly code = "steer_soft_interrupt";
    constructor();
}
export declare function isSteerSoftInterrupt(error: unknown): boolean;
export declare function finalAssistantMessage(history: readonly Message[]): {
    readonly message?: Message;
    readonly content: readonly ContentBlock[];
    readonly text: string;
};
export declare class ProviderTurnFailure extends Error {
    readonly info: ErrorInfo;
    readonly observable: boolean;
    constructor(info: ErrorInfo, observable: boolean);
}
export declare function mergeCompaction(agent: false | CompactionOptions | undefined, run: false | CompactionOptions | undefined): CompactionOptions | undefined;
/**
 * Durable-run gate: the built-in default loop is durable via the pending-call mechanism; a custom
 * strategy must declare both snapshot and restore hooks.
 */
export declare function isDurableLoop(loop: import("../loop/index.js").LoopStrategy): boolean;
export declare function withoutTrailingInput(messages: readonly Message[], input: readonly Message[]): Message[];
export declare function bridgeAbort(signal: AbortSignal | undefined, controller: AbortController): () => void;
export declare function throwIfAborted(signal: AbortSignal): void;
export declare function throwIfAbortedSignal(signal: AbortSignal | undefined): void;
export declare function jsonBytes(value: unknown): number;
export declare function createUsageAccumulator(): {
    add(usage: Usage): void;
    value(): Usage | undefined;
};
export declare const randomId: typeof createId;
