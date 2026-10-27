/**
 * Package state (roadmap §2.6). Session state is a value per `(package, key)` kept in `package_state`
 * entries on the session's branch: restored when a session reads its branch, and copied by `fork()` and
 * `clone()` because they carry the branch. Agent state is process memory.
 */
import type { SessionEntry } from "../contracts-core/session.js";
import type { JsonValue } from "../contracts.js";
import type { SessionContext } from "../session-context.js";
/** Largest JSON value one `set` may persist. Every `set` is a store entry, so it is bounded. */
export declare const MAX_STATE_VALUE_BYTES: number;
/** A session-scoped value a package owns. `get` is synchronous; `set` appends one `package_state` entry. */
export interface SessionState<T extends JsonValue> {
    /**
     * The latest value on this session's branch, or `initial`. The value is frozen: replace it with `set`.
     * Throws `state_not_ready` before the session has read its branch (a run, command, or `close()` does).
     */
    get(session: SessionContext): T;
    /** Persists `value` (JSON, at most 64 KiB, redacted first) and makes it the value `get` returns. */
    set(session: SessionContext, value: T): Promise<void>;
}
/**
 * A session-scoped append-only record log a package owns. Unlike {@link SessionState}, later records
 * never replace earlier ones: the branch is the order. `entries` is synchronous, because the session
 * already holds the branch it read.
 */
export interface SessionLog<T extends JsonValue> {
    /**
     * Every record on this session's branch, in append order. Throws `state_not_ready` before the session
     * has read its branch (a run, command, or `close()` does). A fork carries the records up to the fork point.
     */
    entries(session: SessionContext): readonly T[];
    /** Appends `value` (JSON, at most 64 KiB, redacted first) as one `package_state` entry. */
    append(session: SessionContext, value: T): Promise<void>;
}
/** A value kept in process memory for the agent's lifetime, reset to `initial` on dispose. */
export interface AgentState<T> {
    get(): T;
    set(value: T): void;
}
/** The `data` of a `package_state` entry. `op` is absent only on entries written before 0.13, which read as `"set"`. */
export interface PackageStateData {
    readonly schemaVersion: 1;
    readonly package: string;
    readonly key: string;
    readonly value: JsonValue;
    /** `"append"` records join the key's log and never replace its latest value. */
    readonly op?: "set" | "append";
}
export interface SessionStateStoreOptions {
    /** Appends one `package_state` entry at the branch tip. */
    readonly append: (data: PackageStateData) => Promise<void>;
    /** Reads the branch once, if it has not been read. A `set` waits for it. */
    readonly ready: () => Promise<void>;
    /** The agent's redactor and every resolved secret, applied before a value is persisted. */
    readonly redact: <T>(value: T) => T;
}
/** The state one session holds. The session owns it and binds it to every {@link SessionContext} it hands out. */
export declare class SessionStateStore {
    private readonly options;
    private values;
    private records;
    private hydrated;
    constructor(options: SessionStateStoreOptions);
    get isReady(): boolean;
    /**
     * Replaces the held state with the branch: the latest value per `(package, key)` for `set` records,
     * and every `append` record in branch order. A malformed entry is skipped.
     */
    hydrate(branch: readonly SessionEntry[]): void;
    read(owner: string, key: string): JsonValue | undefined;
    readRecords(owner: string, key: string): readonly JsonValue[];
    write(owner: string, key: string, value: unknown): Promise<void>;
    append(owner: string, key: string, value: unknown): Promise<void>;
    private assertReady;
    private persist;
}
/** Called by the session for each view it creates, so `SessionState` can find the session's store. */
export declare function bindSessionState(view: SessionContext, store: SessionStateStore): void;
/** `prism.state.session(key, initial)` for `owner`. State is namespaced by the package that declared it. */
export declare function createSessionState<T extends JsonValue>(owner: string, key: string, initial: T): SessionState<T>;
/** `prism.state.log(key)` for `owner`: an append-only record log kept on each session's branch. */
export declare function createSessionLog<T extends JsonValue>(owner: string, key: string): SessionLog<T>;
/** `prism.state.agent(key, initial)`: process memory. `reset` runs on dispose. */
export declare function createAgentState<T>(key: string, initial: T): AgentState<T> & {
    reset(): void;
};
