import type { ContentBlock, JsonObject, ProviderEvent, ProviderStopReason, ToolCallContent, ToolCallDeltaContent, Usage } from "../contracts.js";
export declare function providerTextDelta(text: string): ProviderEvent;
export declare function providerThinkingDelta(text: string, signature?: string): ProviderEvent;
export declare function providerContentDelta(content: ContentBlock): ProviderEvent;
export declare function providerToolCall(call: ToolCallContent): ProviderEvent;
export declare function providerToolCallDelta(delta: {
    readonly index: number;
    readonly id?: string;
    readonly name?: string;
    readonly argumentsText?: string;
}): ProviderEvent;
export declare function providerToolCallDeltaContent(delta: Omit<ToolCallDeltaContent, "type">): ToolCallDeltaContent;
export declare function providerContinuationRequired(cursor: string, reason?: string): ProviderEvent;
export declare function reconstructToolCallDeltas(events: readonly ProviderEvent[]): readonly ToolCallContent[];
export declare function providerUsage(usage: Usage): ProviderEvent;
/**
 * Map a native provider stop/finish reason onto the closed taxonomy. A missing, non-string, or
 * unmapped value returns `"unknown"` rather than throwing, so a new wire value can never fail a
 * run (plan 087 T1).
 */
export declare function mapProviderStopReason(native: string | null | undefined): ProviderStopReason;
/** A `done` event's stop reason on the closed taxonomy: a value already in it stays, anything else maps through `mapProviderStopReason`. */
export declare function normalizeStopReason(reason: ProviderStopReason | string | undefined): ProviderStopReason | undefined;
export declare function providerDone(usage?: Usage, stopReason?: ProviderStopReason): ProviderEvent;
export declare function providerError(error: unknown, secrets?: readonly (string | undefined)[]): Extract<ProviderEvent, {
    type: "error";
}>;
export declare function toolCallContent(id: string, name: string, args?: JsonObject): ToolCallContent;
/** Build a tool call from streamed arguments text; malformed JSON becomes a blocked call (no throw). */
export declare function toolCallFromArgumentsText(id: string, name: string, argumentsText: string): ToolCallContent;
