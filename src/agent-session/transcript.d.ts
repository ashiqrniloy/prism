import type { Message } from "../contracts-core/content.js";
import type { SessionEntry } from "../contracts-core/session.js";
/** A bounded, portable slice of a conversation: what a sub-agent or a second opinion is given. */
export interface TranscriptSlice {
    /** Summaries of the parts a compaction folded away, oldest first. */
    readonly summaries: readonly string[];
    /** Messages always kept, in order, charged against `maxChars` first. */
    readonly pinned: readonly Message[];
    /** The selected turns, oldest first. Text only: tool activity is rendered inline. */
    readonly messages: readonly Message[];
    /** Turns in the slice; a turn starts at a `user` message. */
    readonly turns: number;
    /** Turns dropped to stay inside `lastTurns` or `maxChars`. */
    readonly omittedTurns: number;
    /** A message was cut to fit `maxChars`. */
    readonly truncated: boolean;
}
export interface TranscriptOptions {
    /** How many newest turns to keep. Omitted keeps every turn that fits `maxChars`. */
    readonly lastTurns?: number;
    /** Budget in characters of rendered text. */
    readonly maxChars: number;
    /** Cap on one rendered tool result. Default 2,000. */
    readonly maxToolChars?: number;
    /** Messages rendered with the same rules and always included. */
    readonly pinned?: readonly Message[];
}
/**
 * The newest conversation a bounded consumer may see, rendered portable: text only, tool calls and
 * results as text, thinking and provider metadata dropped. A dangling assistant tool call is dropped,
 * because a provider rejects a call whose result never follows.
 */
export declare function selectTranscript(entries: readonly SessionEntry[] | readonly Message[], options: TranscriptOptions): TranscriptSlice;
