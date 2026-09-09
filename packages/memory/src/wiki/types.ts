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
  readonly description?: string;
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
  /** Optional host-injected extractor for formats the built-ins reject (compressed PDF, DOCX,
   *  unknown binaries). Return null to fail closed. e.g. `createDocumentReader().extract`. */
  readonly extractDocument?: (input: WikiIngestHookInput) => Promise<{ text: string; format: string } | null>;
  /** Optional host-injected fetcher for `url` ingest sources. The wiki never fetches itself.
   *  Return null to fail closed. e.g. an Obscura `web_fetch` wrapper. */
  readonly fetchUrl?: (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>;
}

/** Content to stage for {@link ingestWikiSource}. Exactly one source is used: `path` > `bytes` > `url` > `text`. */
export interface WikiIngestInput {
  /** Inline utf8 text (staged as `source.txt` unless `filename` gives an extension). */
  readonly text?: string;
  /** Workspace-relative or absolute file path; the file is staged as the immutable original. */
  readonly path?: string;
  /** In-memory upload (requires `filename` for the extension). */
  readonly bytes?: Uint8Array;
  /** URL to fetch via the host `fetchUrl` hook. The wiki never fetches on its own. */
  readonly url?: string;
  /** File name for `bytes`/`text` inputs; supplies the staged extension. */
  readonly filename?: string;
  /** Display title; defaults to the basename of `path`/`filename`. Sanitized to one line. */
  readonly title?: string;
}

/** Arguments passed to `WikiExtensionOptions.extractDocument` for formats the built-ins reject. */
export interface WikiIngestHookInput {
  readonly bytes: Uint8Array;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly title?: string;
}

/** Arguments passed to the host `fetchUrl` hook. */
export interface WikiIngestUrlHookInput {
  /** Already SSRF-checked (http(s), no credentials, no private hosts) before the hook runs. */
  readonly url: string;
}

/** Content a `fetchUrl` hook returns: utf8 text or raw bytes, plus an optional staged filename
 *  (default `source.md`; the URL pathname's extension wins when it has one, e.g. `.pdf`). */
export interface WikiIngestFetch {
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly filename?: string;
}

export interface WikiIngestOptions {
  /** Root the wiki lives in. Defaults to process.cwd(). */
  readonly workspaceRoot?: string;
  /** Wiki root used for the log append (only if it already exists). Defaults to `.wiki`. */
  readonly wikiRoot?: string;
  /** Raw layer root. Defaults to `raw/ingest` under `workspaceRoot` (never inside `.wiki/`). */
  readonly ingestRoot?: string;
  /** Input byte cap. Defaults to 32 MiB. */
  readonly maxInputBytes?: number;
  /** Extract byte cap; larger extracts are truncated. Defaults to 2 MiB. */
  readonly maxExtractBytes?: number;
  /** Host extractor for compressed PDF/DOCX/unknown binaries. Return null to fail closed. */
  readonly extractDocument?: (input: WikiIngestHookInput) => Promise<{ text: string; format: string } | null>;
  /** Host fetcher for `url` sources (wiki never fetches). Return null to fail closed. */
  readonly fetchUrl?: (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>;
}

export interface WikiIngestResult {
  /** Directory name under the ingest root: `<utc>-<slug>` (content-hash suffix on collision). */
  readonly id: string;
  /** Workspace-relative staged directory, e.g. `raw/ingest/2026-05-01T12-00-00Z-paper`. */
  readonly rawDir: string;
  /** Workspace-relative immutable original, e.g. `raw/ingest/.../source.pdf`. */
  readonly sourcePath: string;
  /** Workspace-relative utf8 extract, always `raw/ingest/.../extract.md`. */
  readonly extractPath: string;
  /** Derived media type (undefined for unknown binaries the hook handled). */
  readonly mediaType?: string;
  /** Original URL, present only when the source was staged from a `url` input. */
  readonly url?: string;
  /** Extract text as written to `extract.md` (already capped). */
  readonly extract: string;
  /** True when the extract hit the `maxExtractBytes` cap. */
  readonly truncated: boolean;
}
