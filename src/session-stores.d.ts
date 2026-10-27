import { type BranchReader, type Message, type OwnershipScope, type PersistencePage, type SessionBranchRead, type SessionEntry, type SessionLinkFilter, type SessionLinks, type SessionSearchHit, type SessionSearchQuery, type SessionStore, type SessionStoreCapability, type SessionSummary } from "./contracts.js";
export interface CreateSessionEntryOptions extends Omit<SessionEntry, "id" | "timestamp"> {
    readonly id?: string;
    readonly timestamp?: string;
    readonly createId?: () => string;
    readonly now?: () => Date;
}
export interface SessionBranchOptions {
    readonly leafId?: string;
}
export interface SessionBranch {
    readonly leafId: string;
    readonly entries: readonly SessionEntry[];
}
export interface SessionContextSnapshot {
    readonly leafId?: string;
    readonly entries: readonly SessionEntry[];
    readonly messages: readonly Message[];
    readonly summaries: readonly string[];
}
export declare function createSessionEntry(options: CreateSessionEntryOptions): SessionEntry;
export declare function getSessionBranchEntries(reader: BranchReader, query: SessionBranchRead): Promise<readonly SessionEntry[]>;
export declare function getSessionBranchEntries(entries: readonly SessionEntry[], options?: SessionBranchOptions): readonly SessionEntry[];
export declare function listSessionBranches(entries: readonly SessionEntry[]): readonly SessionBranch[];
export declare function rebuildSessionContext(reader: BranchReader, query: SessionBranchRead): Promise<SessionContextSnapshot>;
export declare function rebuildSessionContext(entries: readonly SessionEntry[], options?: SessionBranchOptions): SessionContextSnapshot;
export type MemorySessionSearchMode = "linear" | "unsupported";
export interface CreateMemorySessionStoreOptions {
    /** Default `"linear"`: capped in-process scan. `"unsupported"`: typed throw. */
    readonly sessionSearchMode?: MemorySessionSearchMode;
    /**
     * Optional overrides for the capped in-process scan. Hosts with a small session set can
     * raise the caps (bounded by the contract `HARD_MAX_SESSION_SEARCH_LINEAR_*` values);
     * defaults are the contract `DEFAULT_MAX_SESSION_SEARCH_LINEAR_*` caps. Values below 1
     * or above the hard cap fail store construction closed with a `TypeError`.
     */
    readonly search?: {
        readonly maxLinearSessions?: number;
        readonly maxLinearEntries?: number;
        readonly maxLinearBytes?: number;
    };
}
/** Resolved bounds for the capped linear session scan. */
export interface LinearSearchCaps {
    readonly sessions: number;
    readonly entries: number;
    readonly bytes: number;
}
/**
 * The optional `agent.sessions` capabilities a store implements, in contract order. The kernel derives
 * capabilities from method presence: `inspect()` reports them, and a store that implements none leaves
 * `agent.sessions` failing closed with `UnsupportedStoreCapabilityError`.
 */
export declare function sessionStoreCapabilities(store: SessionStore): readonly SessionStoreCapability[];
export declare function createMemorySessionStore(initialEntries?: readonly SessionEntry[], options?: CreateMemorySessionStoreOptions): SessionStore;
/**
 * Shared linear (unindexed) session search over already-grouped entries: the memory store's default
 * mode and the JSONL store's implementation. `caps` defaults to the contract linear caps.
 */
export declare function searchLinearSessions(bySession: Map<string, SessionEntry[]>, leafBySession: Map<string, string>, query: SessionSearchQuery, caps?: LinearSearchCaps): PersistencePage<SessionSearchHit>;
/** The `OwnershipScope` fields, in stamp order. Shared with `narrowScope` so the two never drift. */
export declare const OWNERSHIP_SCOPE_KEYS: readonly ["tenantId", "accountId", "userId"];
/**
 * Whether every entry carries each field of `scope` with the same value. An undefined scope (or an undefined
 * field) constrains nothing; an entry written without the stamp is outside any scope that names the field.
 */
export declare function entriesInScope(entries: readonly SessionEntry[], scope: OwnershipScope | undefined): boolean;
/** The links a `metadata` entry carries in `data[SESSION_LINKS_DATA_KEY]`, or `undefined`. */
export declare function sessionLinksOfEntry(entry: SessionEntry): SessionLinks | undefined;
/** The links a session was opened with: the first links entry among `entries`, or `undefined`. */
export declare function sessionLinksOf(entries: readonly SessionEntry[]): SessionLinks | undefined;
/** Whether `links` satisfy every link filter field set on `filter`. A session without links matches no set field. */
export declare function sessionLinksMatch(links: SessionLinks | undefined, filter: SessionLinkFilter): boolean;
/** The summary fields a session's links contribute. */
export declare function summaryLinkFields(links: SessionLinks | undefined): Partial<SessionSummary>;
/** Summary of one session from its entries: no transcript, only counts, times, and display metadata. */
export declare function summarizeSession(sessionId: string, entries: readonly SessionEntry[], leafId: string | undefined): SessionSummary;
