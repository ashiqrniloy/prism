import type { MemoryNoteHit } from "./types.js";
/** `content[start, end)`, clamped, with an ellipsis on each side that was cut. */
export declare function windowAt(content: string, start: number, end: number): string;
/**
 * At most `maxChars` of `content`, cut markers included, centred on the window that holds the most
 * matched query-term tokens; the head when nothing matches. One linear pass over the content.
 */
export declare function queryExcerpt(content: string, queryTerms: ReadonlySet<string>, maxChars: number): string;
/**
 * The passive-injection rendering decision, shared with the delivery diagnostic. `hits` are already
 * eligible and ranked. Delivery fills by rank: each hit renders whole while it fits the remaining
 * budget, up to `topK`, and a hit that does not fit whole is skipped rather than truncated (a later,
 * shorter hit may still fit). The best hit is always shown: if it alone exceeds the budget it renders
 * as a query-centred excerpt of the whole budget and names the id to `memory.read` in full. When
 * fewer notes are shown than `eligibleCount` after the floor, the block ends with one line that says
 * so and names the tools that can widen the search, so the agent knows the block was cut. Shown hits
 * are delivered facts first and then exchanges, each group in time order (`tRef` else `ingestedAt`,
 * ties by rank), so a later value is read last, while selection stays by rank. Rendering changes how much of a note is shown, never which ranked
 * notes are considered.
 */
export declare function fitInjection(hits: Iterable<MemoryNoteHit>, queryTerms: ReadonlySet<string>, budgetTokens: number, topK: number, eligibleCount?: number): {
    hits: MemoryNoteHit[];
    lines: string[];
    tokens: number;
};
