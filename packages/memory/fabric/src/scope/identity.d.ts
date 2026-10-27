export interface ProjectIdentity {
    /** First 8 hex characters of SHA-256 over the identity source string. */
    readonly id8: string;
    readonly slug: string;
    readonly source: "remote" | "path";
    /** Real paths this resolution saw: the git top level first when it differs from the root. */
    readonly roots: readonly string[];
}
/** `projects/<slug>--<id8>`, the project resource id under the memory tenant. */
export declare function projectResourceId(identity: Pick<ProjectIdentity, "slug" | "id8">): string;
/** Lowercase hyphenated repository name, `[a-z0-9-]` only, at most 40 characters. */
export declare function projectSlug(name: string): string;
/**
 * Normalise a git remote to `host/path`: scheme, credentials, a trailing `.git`, and a trailing
 * slash are dropped, and the host is lowercased. A scp-like `user@host:path` keeps its path.
 */
export declare function normalizeRemote(raw: string): string;
/** The `origin` remote url from a git config, else the first remote url; `[remote "x"]` sections only. */
export declare function remoteUrlFromConfig(config: string): string | undefined;
/** Resolve the stable project identity for `root`. Throws when the root does not exist. */
export declare function resolveProjectIdentity(root: string): ProjectIdentity;
export interface ProjectFileSections {
    readonly source?: string;
    readonly roots: readonly string[];
}
/** Read `prism.source` and `prism.roots` from a `project.md`, or undefined when it is unreadable. */
export declare function parseProjectFile(content: string): ProjectFileSections | undefined;
/**
 * Render `project.md`, keeping every root an earlier resolution recorded. The identity source and
 * roots are safe to write: a remote URL is normalised and carries no credentials.
 */
export declare function renderProjectFile(identity: {
    readonly resourceId: string;
    readonly source: "remote" | "path";
    readonly roots: readonly string[];
}, current?: string): string;
