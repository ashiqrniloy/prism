import type { CompactionEntryData } from "./contracts.js";
import type { Compactor } from "./slots/types.js";
export interface DefaultCompactorOptions {
    readonly name?: string;
    readonly keepRecentEntries?: number;
    readonly maxSummaryChars?: number;
    readonly secrets?: readonly (string | undefined)[];
}
export declare function createDefaultCompactor(options?: DefaultCompactorOptions): Compactor;
export declare function isCompactionEntryData(value: unknown): value is CompactionEntryData;
