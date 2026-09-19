/**
 * Plan 089 Task 3: wiki-side re-pointing.
 *
 * Wiki pages are projections of raw source *paths* (`WikiEntityMetadata.rawSources`
 * plus anchors, hashes, and the `## Raw Sources` / frontmatter `sources:` body). When
 * a source's grant identity moves to a new path or source id, the projection follows:
 * the manifest, the file hash entry, and every page that names the old path are
 * rewritten in place. No compilation, no re-embedding — the raw content is unchanged,
 * only the identity it hangs off.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MemoryValidationError } from "../errors.js";
import type { RepointContext, RepointHandler } from "../repoint.js";
import { prependLog, wikiDate } from "./engine/okf.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { normalizeWikiSourcePath, writeWikiIndexes } from "./retire.js";
import type { WikiEntityMetadata, WikiManifest } from "./types.js";

export interface RepointWikiSourcesOptions {
  readonly workspaceRoot: string;
  /** Default `.wiki`, resolved against `workspaceRoot`. */
  readonly wikiRoot?: string;
  /** Old workspace-relative (or absolute) paths, paired 1:1 with `to`. */
  readonly from: readonly string[];
  /** Replacement paths, same length as `from`. */
  readonly to: readonly string[];
  /** ISO timestamp for the manifest/log entry; defaults to now. */
  readonly at?: string;
}

export interface RepointWikiSourcesResult {
  /** Entity ids whose source references moved. */
  readonly repointed: readonly string[];
  readonly movedSources: readonly { readonly from: string; readonly to: string }[];
}

/**
 * Move manifest/hash/page references from `from[i]` to `to[i]`. Paths that appear in a
 * page are substituted literally, so symbols, anchors, and prose links follow the move.
 */
export async function repointWikiSources(options: RepointWikiSourcesOptions): Promise<RepointWikiSourcesResult> {
  if (options.from.length !== options.to.length) {
    throw new MemoryValidationError("repointWikiSources requires the same number of from and to paths");
  }
  const workspaceRoot = resolve(options.workspaceRoot);
  const wikiRoot = resolve(workspaceRoot, options.wikiRoot ?? ".wiki");
  const moves = new Map<string, string>();
  for (let index = 0; index < options.from.length; index += 1) {
    const fromPath = options.from[index];
    const toPath = options.to[index];
    if (fromPath === undefined || toPath === undefined) break;
    const from = normalizeWikiSourcePath(workspaceRoot, fromPath);
    const to = normalizeWikiSourcePath(workspaceRoot, toPath);
    if (from !== to) moves.set(from, to);
  }
  const manifest = await loadManifest(wikiRoot);
  if (!manifest || moves.size === 0) {
    return Object.freeze({ repointed: [], movedSources: [] });
  }

  const entities: Record<string, WikiEntityMetadata> = { ...manifest.entities };
  const hashes: Record<string, string> = { ...manifest.sourceFileHashes };
  const repointed: string[] = [];
  const movedSources: { from: string; to: string }[] = [];

  for (const [entityId, entity] of Object.entries(manifest.entities)) {
    const rawSources = entity.rawSources.map((source) => moves.get(normalizeWikiSourcePath(workspaceRoot, source)) ?? source);
    const anchors = entity.anchors.map((anchor) => {
      const next = moves.get(normalizeWikiSourcePath(workspaceRoot, anchor.filePath));
      return next === undefined ? anchor : Object.freeze({ ...anchor, filePath: next });
    });
    const changed =
      rawSources.some((source, index) => source !== entity.rawSources[index]) ||
      anchors.some((anchor, index) => anchor.filePath !== entity.anchors[index]?.filePath);
    if (!changed) continue;
    entities[entityId] = Object.freeze({ ...entity, rawSources: Object.freeze(rawSources), anchors: Object.freeze(anchors) });
    repointed.push(entityId);
    const pagePath = join(wikiRoot, "entities", `${entityId}.md`);
    const page = await readFile(pagePath, "utf8").catch(() => undefined);
    if (page !== undefined) {
      let next = page;
      for (const [from, to] of moves) next = next.split(from).join(to);
      if (next !== page) await writeFile(pagePath, next, "utf8");
    }
  }

  for (const [from, to] of moves) {
    const hash = hashes[from];
    if (hash !== undefined) {
      hashes[to] = hash;
      delete hashes[from];
    }
    movedSources.push({ from, to });
  }

  const next: WikiManifest = Object.freeze({
    ...manifest,
    wikiRoot,
    sourceFileHashes: Object.freeze(hashes) as Record<string, string>,
    entities: Object.freeze(entities) as Record<string, WikiEntityMetadata>,
  });
  await writeWikiIndexes(wikiRoot, Object.values(entities));
  const logPath = join(wikiRoot, "log.md");
  const existingLog = await readFile(logPath, "utf8").catch(() => undefined);
  await writeFile(
    logPath,
    prependLog(existingLog, wikiDate(options.at), [
      {
        verb: "Repointed",
        text: `${movedSources.length} raw source(s): ${movedSources.map((move) => `${move.from} → ${move.to}`).join(", ")}.`,
      },
    ]),
    "utf8",
  );
  await saveManifest(wikiRoot, next);
  return Object.freeze({ repointed: Object.freeze(repointed), movedSources: Object.freeze(movedSources) });
}

/**
 * Plan 089 Task 3: the wiki layer's re-point handler. `pathsFor` maps a prism source id
 * onto the raw paths it projected (default: the id is the path); both sides must map to
 * the same number of paths or the handler fails closed.
 */
export function createWikiRepointHandler(options: {
  readonly workspaceRoot: string;
  readonly wikiRoot?: string;
  readonly pathsFor?: (sourceId: string) => readonly string[];
}): RepointHandler {
  const pathsFor = options.pathsFor ?? ((sourceId: string) => [sourceId]);
  return {
    kind: "wiki",
    async repoint({ from, to }: RepointContext) {
      const fromPaths = pathsFor(from);
      const toPaths = pathsFor(to);
      if (fromPaths.length !== toPaths.length) {
        throw new MemoryValidationError(`wiki re-point needs one destination path per source path (${from} → ${to})`);
      }
      const result = await repointWikiSources({
        workspaceRoot: options.workspaceRoot,
        ...(options.wikiRoot === undefined ? {} : { wikiRoot: options.wikiRoot }),
        from: fromPaths,
        to: toPaths,
      });
      return result.repointed.length + result.movedSources.length;
    },
  };
}
