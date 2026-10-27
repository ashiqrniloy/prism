import type { Message, ToolCallContent, ToolResult } from "../contracts.js";
/** Internal dispatch seam used by {@link RunController.executeTools}. */
export interface ToolDispatchContext {
    readonly signal: AbortSignal;
    readonly toolConcurrency: number;
    chargeToolRound?(calls: readonly ToolCallContent[]): void | Promise<void>;
    dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
    isToolCallExclusive?(call: ToolCallContent): boolean;
    /** Persist one transcript row. The caller owns history insertion. */
    appendMessage(message: Message): Promise<void>;
}
export declare function throwIfAborted(signal: AbortSignal): void;
/** Calls the host must dispatch. Provider-hosted calls were executed server-side. */
export declare function dispatchableToolCalls(calls: readonly ToolCallContent[]): readonly ToolCallContent[];
/** Dispatch tool calls with bounded concurrency; append transcript rows in call order. */
export declare function dispatchToolCallsInOrder(calls: readonly ToolCallContent[], ctx: ToolDispatchContext): Promise<readonly ToolResult[]>;
