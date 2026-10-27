import type { ToolDefinition } from "@arnilo/prism";
import type { Memory, MemoryVectorRecord } from "@arnilo/prism-memory-core";
import type { FabricCitationTracker } from "./context.js";
import { type FabricDirectoryHandle } from "./directory.js";
import { type FabricScopeLevel, type MemoryFabric, type MemoryFabricToolsOptions } from "./types.js";
/** Everything the tools call back into; all of it comes from the fabric closure. */
export interface MemoryFabricToolDeps {
    readonly memory: Memory;
    readonly remember: MemoryFabric["remember"];
    readonly recall: MemoryFabric["recall"];
    readonly forget: MemoryFabric["forget"];
    /** When it answers `false`, indexed notes are unavailable and their tool branches fail closed. */
    readonly isIndexedNotesAvailable?: () => boolean;
    /** When present, `memory.view` without a path pages the long-term memory directory instead of listing the root. */
    readonly directory?: FabricDirectoryHandle;
    /** Candidate lifecycle: a confirming edit verifies, and `replace { id, pin }` exempts a note. */
    readonly lifecycle?: {
        readonly verify: (id: string, signal?: AbortSignal) => Promise<unknown>;
        readonly pin?: (id: string, pinned: boolean, signal?: AbortSignal) => Promise<unknown>;
    };
    /** Citation tracker: recalled notes join the tracker so citations in assistant output can be verified. */
    readonly tracker?: FabricCitationTracker;
    /** Locate the active scope memory that holds `id`; without it every note operation uses `memory`. */
    readonly noteMemory?: (id: string, signal?: AbortSignal) => Promise<Memory | undefined>;
    /**
     * Read notes by id across every active scope, through the same consent, invalidation and redaction
     * filters as recall; without it a read falls back to this fabric's single `memory`.
     */
    readonly readNotes?: (ids: readonly string[], signal?: AbortSignal) => Promise<readonly MemoryVectorRecord[]>;
    /** The session's touched files, used to arm a `path` note's prior. */
    readonly touchedPaths?: (sessionId: string) => readonly string[];
    /** The scope this tool set runs in; set only when the fabric is scoped. Widening writes `agent`. */
    readonly scopeLevel?: FabricScopeLevel;
}
/**
 * The fabric's tool set: `memory.view`, `memory.read`, `memory.insert`, `memory.recall`,
 * `memory.replace`, `memory.forget`. Each call builds fresh inert definitions — nothing is registered globally and
 * nothing executes until a host puts them on `AgentConfig.tools` and attaches a session.
 *
 * `memory.insert` appends to a labeled working block or to a file inside `root`; a file insert
 * also refreshes the `kind: "file"` note for that path so recall can find the content. `view` and
 * `read` never leave `root`, and every tool fails closed when the fabric has no attached session.
 */
export declare function createMemoryFabricTools(deps: MemoryFabricToolDeps): (options?: MemoryFabricToolsOptions) => readonly ToolDefinition[];
