/**
 * The scoped ledger keeps only what the note lifecycle does not own: pending approvals and write
 * statistics (plan 188.4 Task 1). Note status and use counts live on the note.
 */
export interface ScopedMemoryLedger {
    readonly pending: readonly unknown[];
    readonly stats?: {
        readonly writes: number;
        readonly duplicates: number;
    };
}
/** Where a legacy ledger report goes; the fabric package wires it to `prism.status`. */
export declare function onLegacyScopedLedger(sink: ((ignored: number) => void) | undefined): void;
export declare function scopedLedgerPath(scopeRoot: string): string;
/**
 * Read the ledger. A file written by an earlier build is still read for its pending approvals and
 * statistics; its retired note-lifecycle fields are ignored and reported once per file.
 */
export declare function loadScopedLedger(path: string, options?: {
    readonly onLegacy?: (ignored: number) => void;
}): Promise<ScopedMemoryLedger>;
export declare function saveScopedLedger(path: string, ledger: ScopedMemoryLedger): Promise<void>;
