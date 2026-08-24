export type WikiProfileType = "codebase" | "pkm" | "hybrid" | "auto";

export type SearchMode = "search" | "vsearch" | "query";

export interface WikiSourceAnchor {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly symbol?: string;
  readonly sourceHash: string;
}

export interface WikiEntityMetadata {
  readonly id: string;
  readonly title: string;
  readonly category: "entity" | "concept" | "module" | "decision" | "person" | "tool";
  readonly tags: readonly string[];
  readonly rawSources: readonly string[];
  readonly anchors: readonly WikiSourceAnchor[];
  readonly lastCompiledAt: string;
}

export interface WikiManifest {
  readonly version: "1.0.0";
  readonly profile: WikiProfileType;
  readonly wikiRoot: string;
  readonly rawRoots: readonly string[];
  readonly sourceFileHashes: Record<string, string>;
  readonly entities: Record<string, WikiEntityMetadata>;
}

export interface SourceDelta {
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly deleted: readonly string[];
  readonly unchanged: readonly string[];
  readonly affectedEntities: readonly string[];
}

export interface QmdSearchResult {
  readonly docId: string;
  readonly file: string;
  readonly score: number;
  readonly snippet: string;
  readonly title?: string;
}

export interface HydratedSearchHit {
  readonly title: string;
  readonly wikiPath: string;
  readonly breadcrumbs: readonly string[];
  readonly summary: string;
  readonly anchors: readonly WikiSourceAnchor[];
  readonly isStale: boolean;
  readonly rawScore: number;
}

export interface WikiSearchResponse {
  readonly query: string;
  readonly mode: SearchMode;
  readonly hits: readonly HydratedSearchHit[];
  readonly formattedMarkdown: string;
}

export interface DeadAnchor {
  readonly entityId: string;
  readonly anchor: WikiSourceAnchor;
  readonly reason: "file_missing" | "symbol_missing" | "lines_shifted" | "content_changed";
}

export interface BrokenLink {
  readonly sourceFile: string;
  readonly target: string;
}

export interface LintReport {
  readonly deadAnchors: readonly DeadAnchor[];
  readonly brokenLinks: readonly BrokenLink[];
  readonly orphans: readonly string[];
  readonly gaps: readonly string[];
  readonly ok: boolean;
}

export interface WikiExtensionOptions {
  /** Root directory where .wiki/ lives. Defaults to `.wiki` in project root. */
  readonly wikiRoot?: string;
  /** Directories containing raw source files (code, notes, docs). Defaults to workspace root. */
  readonly rawRoots?: readonly string[];
  /** Operating profile. Defaults to "auto". */
  readonly profile?: WikiProfileType;
  /** Path to qmd binary or executable name. Defaults to "qmd". */
  readonly qmdPath?: string;
  /** Optional custom workspace root. Defaults to process.cwd(). */
  readonly workspaceRoot?: string;
  /** Callback to auto-deploy skills to .agents/skills/ on setup/init. Defaults to true. */
  readonly autoDeploySkills?: boolean;
}
