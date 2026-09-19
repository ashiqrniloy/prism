/**
 * Plan 089 Task 1: wiki-side deletion propagation.
 *
 * Compiled entity pages are projections of raw sources (`WikiEntityMetadata.rawSources`
 * plus anchors). The compiler only ever adds or rewrites them, so a deleted source
 * leaves its page behind as stale authority. `retireWikiSources` removes the pages
 * whose every raw source is gone and prunes the deleted references from entities that
 * still have surviving sources; both outcomes land in `log.md` and the manifest.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { DeletionPropagationHandler } from "../propagation.js";
import { prependLog, renderDirIndex, renderRootIndex, wikiDate } from "./engine/okf.js";
import { loadManifest, saveManifest } from "./manifest.js";
import type { WikiEntityMetadata, WikiManifest } from "./types.js";

export interface RetireWikiSourcesOptions {
  readonly workspaceRoot: string;
  /** Default `.wiki`, resolved against `workspaceRoot`. */
  readonly wikiRoot?: string;
  /** Workspace-relative (or absolute) paths of the deleted raw sources. */
  readonly sourcePaths: readonly string[];
  /** ISO timestamp for the manifest/log entry; defaults to now. */
  readonly at?: string;
}

export interface RetireWikiSourcesResult {
  /** Entity ids whose pages were deleted (no raw source left). */
  readonly retired: readonly string[];
  /** Entity ids that lost source/anchors references but kept their page. */
  readonly pruned: readonly string[];
  /** Workspace-relative source paths actually dropped from the manifest. */
  readonly removedSources: readonly string[];
}

/** `./docs/x.md` and `docs\..\docs\x.md` collapse onto the manifest's posix-relative keys. */
export function normalizeWikiSourcePath(workspaceRoot: string, value: string): string {
  return relative(workspaceRoot, resolve(workspaceRoot, value)).split(sep).join("/");
}

/** Index pages for a manifest's entity set; both retire and re-point rewrite them. */
export async function writeWikiIndexes(wikiRoot: string, entities: readonly WikiEntityMetadata[]): Promise<void> {
  await mkdir(join(wikiRoot, "entities"), { recursive: true });
  await mkdir(join(wikiRoot, "decisions"), { recursive: true });
  await mkdir(join(wikiRoot, "concepts"), { recursive: true });
  await writeFile(join(wikiRoot, "index.md"), renderRootIndex(entities), "utf8");
  await writeFile(join(wikiRoot, "entities", "index.md"), renderDirIndex("entities", entities), "utf8");
  await writeFile(join(wikiRoot, "decisions", "index.md"), renderDirIndex("decisions", entities), "utf8");
  await writeFile(join(wikiRoot, "concepts", "index.md"), renderDirIndex("concepts", entities), "utf8");
}

export async function retireWikiSources(options: RetireWikiSourcesOptions): Promise<RetireWikiSourcesResult> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const wikiRoot = resolve(workspaceRoot, options.wikiRoot ?? ".wiki");
  const targets = new Set(options.sourcePaths.map((value) => normalizeWikiSourcePath(workspaceRoot, value)));
  const manifest = await loadManifest(wikiRoot);
  if (!manifest || targets.size === 0) {
    return Object.freeze({ retired: [], pruned: [], removedSources: [] });
  }

  const entities: Record<string, WikiEntityMetadata> = { ...manifest.entities };
  const hashes: Record<string, string> = { ...manifest.sourceFileHashes };
  const retired: string[] = [];
  const pruned: string[] = [];
  const removedSources = new Set<string>();

  for (const [entityId, entity] of Object.entries(manifest.entities)) {
    if (entity.rawSources.length === 0) continue;
    const keptSources = entity.rawSources.filter((source) => {
      const normalized = normalizeWikiSourcePath(workspaceRoot, source);
      if (!targets.has(normalized)) return true;
      removedSources.add(normalized);
      return false;
    });
    const keptAnchors = entity.anchors.filter((anchor) => !targets.has(normalizeWikiSourcePath(workspaceRoot, anchor.filePath)));
    if (keptSources.length === entity.rawSources.length && keptAnchors.length === entity.anchors.length) continue;
    if (keptSources.length === 0) {
      delete entities[entityId];
      retired.push(entityId);
      await rm(join(wikiRoot, "entities", `${entityId}.md`), { force: true });
      continue;
    }
    entities[entityId] = Object.freeze({ ...entity, rawSources: Object.freeze(keptSources), anchors: Object.freeze(keptAnchors) });
    pruned.push(entityId);
  }

  if (retired.length === 0 && pruned.length === 0) {
    return Object.freeze({ retired: [], pruned: [], removedSources: [] });
  }
  for (const source of removedSources) delete hashes[source];

  const next: WikiManifest = Object.freeze({
    ...manifest,
    wikiRoot,
    sourceFileHashes: Object.freeze(hashes) as Record<string, string>,
    entities: Object.freeze(entities) as Record<string, WikiEntityMetadata>,
  });
  const all = Object.values(entities);
  await writeWikiIndexes(wikiRoot, all);
  const logPath = join(wikiRoot, "log.md");
  const existingLog = await readFile(logPath, "utf8").catch(() => undefined);
  await writeFile(
    logPath,
    prependLog(existingLog, wikiDate(options.at), [
      {
        verb: "Retired",
        text: `${retired.length} entit${retired.length === 1 ? "y" : "ies"} retired, ${pruned.length} pruned for deleted sources: ${[...removedSources].join(", ") || "none"}.`,
      },
    ]),
    "utf8",
  );
  await saveManifest(wikiRoot, next);
  return Object.freeze({
    retired: Object.freeze(retired),
    pruned: Object.freeze(pruned),
    removedSources: Object.freeze([...removedSources]),
  });
}

/**
 * Plan 089 Task 1: the wiki layer's propagation handler. `pathsFor` maps a prism
 * source id onto the raw paths it projected (default: the id is the path).
 */
export function createWikiDeletionHandler(options: {
  readonly workspaceRoot: string;
  readonly wikiRoot?: string;
  readonly pathsFor?: (sourceId: string) => readonly string[];
}): DeletionPropagationHandler {
  const pathsFor = options.pathsFor ?? ((sourceId: string) => [sourceId]);
  return {
    kind: "wiki",
    async delete({ sourceId }) {
      const result = await retireWikiSources({
        workspaceRoot: options.workspaceRoot,
        ...(options.wikiRoot === undefined ? {} : { wikiRoot: options.wikiRoot }),
        sourcePaths: pathsFor(sourceId),
      });
      return result.retired.length + result.pruned.length;
    },
  };
}
