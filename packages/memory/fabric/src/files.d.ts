/** File notes live in a host-owned directory; reads are bounded the way coding-tool reads are. */
export declare const DEFAULT_FABRIC_MAX_FILE_BYTES: number;
export declare const HARD_FABRIC_MAX_FILE_BYTES: number;
/** One `view` call lists at most this many entries, so a wide directory cannot flood a turn. */
export declare const HARD_FABRIC_VIEW_ENTRIES = 200;
export interface FabricFileEntry {
    readonly name: string;
    readonly kind: "file" | "directory";
    readonly bytes?: number;
}
export interface FabricFileListing {
    readonly path: string;
    readonly entries: readonly FabricFileEntry[];
    readonly truncated: boolean;
}
export interface FabricFileContent {
    readonly path: string;
    readonly text: string;
    readonly bytes: number;
    readonly truncated: boolean;
}
export interface CreateFabricFileJailOptions {
    /** Read/append ceiling for one file; default 50 KiB, hard cap 1 MiB. */
    readonly maxFileBytes?: number;
}
/**
 * A fail-closed view of one host directory. Every operation resolves inside `root`, refuses
 * `..` segments, and re-checks the real path so a symlink cannot point out of the jail.
 */
export interface FabricFileJail {
    readonly root: string;
    readonly maxFileBytes: number;
    /** Absolute path when `requested` stays inside the jail; throws otherwise. */
    resolve(requested: string): Promise<string>;
    view(requested?: string): Promise<FabricFileListing>;
    read(requested: string): Promise<FabricFileContent>;
    /** Append text, creating the file and its parent directories; throws when the cap would be crossed. */
    write(requested: string, text: string): Promise<void>;
    append(requested: string, text: string): Promise<{
        readonly path: string;
        readonly bytes: number;
    }>;
}
export declare function createFabricFileJail(root: string, options?: CreateFabricFileJailOptions): FabricFileJail;
