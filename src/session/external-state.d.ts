/**
 * External-agent state (roadmap §2.12.9 K5). A driver archives what its vendor keeps outside Prism (a
 * transcript, a resume token) as `external_state` entries on the session's branch, so the archive follows
 * the session: `fork()` copies it, deleting the session deletes it, and it never enters `session.messages()`.
 *
 * Why not `package_state` with `op: "append"`: that log is unbounded per key, is owned by a package rather
 * than a loop, and shares a kind with values that tools and the observational fold read. An archive needs
 * its own per-key entry and byte caps and a kind no message projection or fold ever sees.
 */
import type { SessionEntry } from "../contracts-core/session.js";
import type { JsonValue } from "../contracts.js";
/** Most entries one `(vendor, key)` log may hold on a branch. */
export declare const MAX_EXTERNAL_STATE_ENTRIES = 10000;
/** Most JSON bytes one `(vendor, key)` log may hold on a branch. */
export declare const MAX_EXTERNAL_STATE_BYTES: number;
/** Largest single entry; the same bound `package_state` uses. */
export declare const MAX_EXTERNAL_STATE_ENTRY_BYTES: number;
/** The `data` of an `external_state` entry: one `append` call, `seq` counting records per key. */
export interface ExternalStateData {
    readonly vendor: string;
    readonly key: string;
    readonly seq: number;
    readonly data: readonly JsonValue[];
}
/** `run.state(key)`: an append-only archive scoped to the loop (`vendor`) and the session. */
export interface ExternalStateHandle {
    /** Persists `entries` (JSON, each at most 64 KiB, redacted first) as one record. Rejects with `external_state_limit` past the caps. */
    append(entries: readonly JsonValue[]): Promise<void>;
    /** Every entry for this key on the session's branch, in append order. */
    load(): Promise<readonly JsonValue[]>;
}
export interface ExternalStateHost {
    /** The branch, read once per call. */
    readonly branch: () => Promise<readonly SessionEntry[]>;
    /**
     * Runs `build` against the branch and appends the `external_state` entry it returns at the tip, as one
     * step in the session's append queue, so two overlapping appends cannot both pass the caps.
     */
    readonly write: (build: (branch: readonly SessionEntry[]) => ExternalStateData) => Promise<void>;
    /** The agent's redactor, applied before the size caps are measured. */
    readonly redact: <T>(value: T) => T;
}
/** Builds the handle a loop gets from `run.state(key)`. `vendor` is the loop slot's owner. */
export declare function createExternalState(host: ExternalStateHost, vendor: string, key: string): ExternalStateHandle;
