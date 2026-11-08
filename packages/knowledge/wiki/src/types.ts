import type { WikiOntologyPort } from "./ontology/port.js";
import type { WikiScopeLevel } from "./ontology/types.js";
import type { WikiPassReport } from "./consolidate/pass.js";

/** Content to stage for the ingest. Exactly one source is used: `path` > `bytes` > `url` > `text`. */
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
  /** Workspace root that contains `path` sources. Defaults to process.cwd(). */
  readonly workspaceRoot?: string;
  /** Where `sources/<id>/` is staged: the wiki's root. Defaults to `workspaceRoot`. */
  readonly stageRoot?: string;
  /** Input byte cap. Defaults to 32 MiB. */
  readonly maxInputBytes?: number;
  /** Extract byte cap; larger extracts are truncated. Defaults to 2 MiB. */
  readonly maxExtractBytes?: number;
  /** Host fetcher for `url` sources (wiki never fetches). Return null to fail closed. */
  readonly fetchUrl?: (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>;
}

/** What staging produced. Paths are relative to the stage root (the wiki's root). */
export interface WikiStagedSource {
  /** Directory name under `sources/`: `<utc>-<slug>` (content-hash suffix on collision). */
  readonly id: string;
  /** Staged directory, e.g. `sources/2026-05-01T12-00-00Z-paper`. */
  readonly rawDir: string;
  /** Immutable original, e.g. `sources/.../source.pdf`. */
  readonly sourcePath: string;
  /** The utf8 extract, always `sources/.../extract.md`. This is the `file` note's path. */
  readonly extractPath: string;
  /** Derived media type (undefined for unknown binaries the hook handled). */
  readonly mediaType?: string;
  /** Original URL, present only when the source was staged from a `url` input. */
  readonly url?: string;
  /** Extract text as written to `extract.md` (already capped). */
  readonly extract: string;
  /** True when the extract hit the `maxExtractBytes` cap. */
  readonly truncated: boolean;
  /** SHA-256 (hex) of the extract text. */
  readonly contentHash: string;
  /** Enrichment keywords derived from the title and extract. */
  readonly keywords: readonly string[];
}

/** The `wiki_ingest` result: the staged paths plus the wiki source that now carries the extract. */
export interface WikiIngestResult extends Omit<WikiStagedSource, "contentHash" | "keywords"> {
  /** Scope of the `file` note. */
  readonly scope: WikiScopeLevel;
  /** False when the trust scan refused the text: the files are staged but nothing was indexed. */
  readonly indexed: boolean;
  /** The `file` note id; claims cite it. Absent when not indexed. */
  readonly noteId?: string;
  /** The subject the note was bound to at write time, when exactly one fit. */
  readonly subject?: string;
  /** The trust class that refused the text. */
  readonly refused?: string;
}

/** What the ingest tool and command need from the package: the workspace root, the fetch seam and the caps. */
export interface WikiExtensionOptions {
  /** Workspace root for `path` sources. Defaults to process.cwd(). */
  readonly workspaceRoot?: string;
  readonly maxInputBytes?: number;
  readonly maxExtractBytes?: number;
  /** The wiki's ontology port: it supplies the stage root and records the source. */
  readonly port?: () => WikiOntologyPort | undefined;
  /** Host-injected fetcher for `url` ingest sources. The wiki never fetches itself.
   *  Return null to fail closed. `@arnilo/prism-wiki` wires this from the `web.fetch` service. */
  readonly fetchUrl?: (input: WikiIngestUrlHookInput) => Promise<WikiIngestFetch | null>;
}

/** One readable scope in `wiki:status`. Counts only: the report never carries note or claim text. */
export interface WikiStatusScope {
  readonly scope: string;
  /** Concept notes in the scope. */
  readonly subjects: number;
  /** Concepts that need a pass. */
  readonly dirty: number;
  /** Dirty concepts by reason (`removed`, `stale`, `evidence`, `edited`). */
  readonly reasons: Readonly<Record<string, number>>;
}

/** The `wiki:status` result. Computed from the wiki's store; no model call. */
export interface WikiStatusReport {
  /** Long-term memory is attached (`memory.ltm`). Without it the wiki runs on its own sources. */
  readonly memory: boolean;
  /** Ingested sources in the wiki's store. */
  readonly sources: number;
  readonly scopes: readonly WikiStatusScope[];
  readonly subjects: number;
  readonly dirty: number;
  /** The last concept pass that did work in this process, with its cost. Absent before the first one. */
  readonly last?: WikiPassReport;
}
