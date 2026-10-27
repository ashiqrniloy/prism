import type { ContributionFileKind, DiscoveredContribution, Skill } from "../contracts.js";
import type { PermissionPolicy, TrustPolicy } from "../security.js";
export interface DiscoveryRoot {
    readonly dir: string;
    readonly origin: "global" | "workspace";
    readonly layout?: "kind-dir" | "flat";
}
export interface DiscoveryOptions {
    readonly kinds: readonly ContributionFileKind[];
    /** Workspace root. Scans `<root>/.agents/<kind>s/<name>/`. Gated by `trust`. Appended after any `roots`. */
    readonly workspaceRoot?: string;
    /** Explicit roots with origin and layout. Evaluated in order; later entries override earlier by `kind/name`. */
    readonly roots?: readonly DiscoveryRoot[];
    readonly permission?: PermissionPolicy;
    readonly trust?: TrustPolicy;
}
/**
 * Discover contributions on disk. Scans configured roots and/or the workspace `.agents/` tree.
 * One `readdir` per kind-root; no `import()`. Inert output —
 * executable behavior is host-owned.
 */
export declare function discoverContributions(options: DiscoveryOptions): Promise<readonly DiscoveredContribution[]>;
export declare function readOptionalFile(path: string): Promise<string | undefined>;
export interface LoadSkillDirectoryOptions {
    /** Per-file byte cap; defaults to `HARD_MAX_SKILL_INSTRUCTION_BYTES` (262 144). */
    readonly maxSkillBytes?: number;
}
/**
 * Load a host-supplied `<directory>/<name>/SKILL.md` tree (an upstream persona
 * or provider checkout) into inert {@link Skill} values. Bounded per file,
 * symlink-contained, and deterministic (sorted by directory name); nothing is
 * auto-activated — the host registers the result through `api.registerSkill` or
 * its own loader.
 *
 * Throws when `directory` is unreadable or a SKILL.md exceeds the cap. A
 * subdirectory without SKILL.md (or a symlink escaping `directory`) is skipped.
 */
export declare function loadSkillDirectory(directory: string, options?: LoadSkillDirectoryOptions): Promise<readonly Skill[]>;
