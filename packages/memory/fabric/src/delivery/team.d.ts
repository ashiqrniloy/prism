import type { Memory } from "@arnilo/prism-memory-core";
/** The team store's fixed tenant and resource: one shared store per checkout, not per person. */
export declare const TEAM_TENANT = "team";
export declare const TEAM_RESOURCE = "project";
export interface MemoryFabricTeamConfig {
    /** Directory relative to the project root; default `.prism/memory`. */
    readonly dir?: string;
    /** `ask` (default) asks through `host.ui` before every write; `off` refuses every share. */
    readonly write?: "ask" | "off";
}
export interface ResolvedFabricTeamOptions {
    /** Absolute team directory, always inside the project root. */
    readonly dir: string;
    readonly write: "ask" | "off";
}
/**
 * Resolve `team` against the project root. Off when unset, `false`, or when no project root is known:
 * the team store is the project's, and its index is named by the project id.
 */
export declare function resolveFabricTeamOptions(value: boolean | MemoryFabricTeamConfig | undefined, projectRoot: string | undefined): false | ResolvedFabricTeamOptions;
export interface FabricTeamCensus {
    readonly verified: number;
    readonly candidate: number;
    readonly archived: number;
    /** Candidates carrying a trust flag: refused by the scan on load. */
    readonly quarantined: number;
}
/** What a person answered when asked to share: the caller owns `host.ui`. */
export type FabricTeamApproval = "approved" | "denied" | "unavailable";
export type FabricTeamShareReason = "write_off" | "not_found" | "not_shareable" | "not_verified" | "flagged" | "host_unavailable" | "denied" | "failed";
export interface FabricTeamShareInput {
    readonly id: string;
    /** The private project memory the note lives in. */
    readonly source: Memory;
    readonly approve: (request: {
        readonly title: string;
        readonly detail: string;
    }) => Promise<FabricTeamApproval>;
}
export type FabricTeamShareResult = {
    readonly ok: true;
    readonly id: string;
    readonly path: string;
    readonly text: string;
} | {
    readonly ok: false;
    readonly reason: FabricTeamShareReason;
    readonly text: string;
};
export interface FabricTeam {
    readonly memory: Memory;
    readonly options: ResolvedFabricTeamOptions;
    /** Absolute path of the derived index, outside the checked-in tree. */
    readonly index: string;
    /** Notes quarantined by the load-time trust scan. */
    readonly quarantined: number;
    census(): Promise<FabricTeamCensus>;
    share(input: FabricTeamShareInput): Promise<FabricTeamShareResult>;
    close(): Promise<void>;
}
/**
 * Open the team store at `options.dir`, index it at `input.index`, and quarantine what the trust scan
 * refuses. The caller checks that the directory exists (a team store is opt-in per checkout).
 */
export declare function createFabricTeam(input: {
    readonly options: ResolvedFabricTeamOptions;
    readonly index: string;
    readonly signal?: AbortSignal;
}): Promise<FabricTeam>;
