import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { DeadAnchor, SourceDelta, WikiEntityMetadata, WikiManifest, WikiProfileType, WikiSourceAnchor } from "./types.js";

export const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  ".wiki",
  ".next",
  "build",
  ".cache",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return hashContent(content);
}

export interface ScanOptions {
  readonly ignorePatterns?: readonly string[];
  readonly allowedExtensions?: readonly string[];
}

export async function scanRawFiles(
  workspaceRoot: string,
  rawRoots: readonly string[] = ["."],
  options: ScanOptions = {},
): Promise<Map<string, string>> {
  const ignoreSet = new Set(options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS);
  const fileHashes = new Map<string, string>();

  async function walk(currentDir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignoreSet.has(entry.name) || entry.name.startsWith(".")) {
        // Skip hidden files and ignored directories (unless '.' root)
        if (entry.name !== "." && entry.name !== "..") {
          continue;
        }
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(workspaceRoot, fullPath).replace(/\\/g, "/");
        if (options.allowedExtensions && options.allowedExtensions.length > 0) {
          const hasExt = options.allowedExtensions.some((ext) => relPath.endsWith(ext));
          if (!hasExt) continue;
        }
        try {
          const hash = await hashFile(fullPath);
          fileHashes.set(relPath, hash);
        } catch {
          // Ignore unreadable files
        }
      }
    }
  }

  for (const root of rawRoots) {
    const absRoot = resolve(workspaceRoot, root);
    await walk(absRoot);
  }

  return fileHashes;
}

export function createEmptyManifest(
  wikiRoot: string,
  rawRoots: readonly string[] = ["."],
  profile: WikiProfileType = "auto",
): WikiManifest {
  return {
    version: "1.0.0",
    profile,
    wikiRoot,
    rawRoots,
    sourceFileHashes: {},
    entities: {},
  };
}

export function computeSourceDelta(manifest: WikiManifest, currentFiles: Map<string, string>): SourceDelta {
  const previousHashes = manifest.sourceFileHashes;
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  // Check current files against previous
  for (const [file, currentHash] of currentFiles.entries()) {
    const prevHash = previousHashes[file];
    if (!prevHash) {
      added.push(file);
    } else if (prevHash !== currentHash) {
      modified.push(file);
    } else {
      unchanged.push(file);
    }
  }

  // Check for deleted files
  for (const prevFile of Object.keys(previousHashes)) {
    if (!currentFiles.has(prevFile)) {
      deleted.push(prevFile);
    }
  }

  // Determine affected entities
  const changedFileSet = new Set([...added, ...modified, ...deleted]);
  const affectedEntities: string[] = [];

  for (const [entityId, entity] of Object.entries(manifest.entities)) {
    const touchesSources = entity.rawSources.some((src) => changedFileSet.has(src));
    const touchesAnchors = entity.anchors.some((anchor) => changedFileSet.has(anchor.filePath));
    if (touchesSources || touchesAnchors) {
      affectedEntities.push(entityId);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
    affectedEntities: affectedEntities.sort(),
  };
}

export function validateAnchor(anchor: WikiSourceAnchor, currentFileContent?: string): { isValid: boolean; reason?: DeadAnchor["reason"] } {
  if (currentFileContent === undefined) {
    return { isValid: false, reason: "file_missing" };
  }

  const lines = currentFileContent.split("\n");
  if (anchor.startLine > lines.length || anchor.endLine > lines.length) {
    return { isValid: false, reason: "lines_shifted" };
  }

  const targetLines = lines.slice(anchor.startLine - 1, anchor.endLine).join("\n");
  const currentChunkHash = hashContent(targetLines);

  if (anchor.symbol) {
    const hasSymbol = targetLines.includes(anchor.symbol);
    if (!hasSymbol) {
      // Check if symbol moved elsewhere in the file
      const wholeFileHasSymbol = currentFileContent.includes(anchor.symbol);
      return { isValid: false, reason: wholeFileHasSymbol ? "lines_shifted" : "symbol_missing" };
    }
  }

  if (anchor.sourceHash && currentChunkHash !== anchor.sourceHash) {
    return { isValid: false, reason: "content_changed" };
  }

  return { isValid: true };
}

export async function loadManifest(wikiRootPath: string): Promise<WikiManifest | undefined> {
  const manifestPath = join(wikiRootPath, ".manifest.json");
  try {
    const data = await readFile(manifestPath, "utf8");
    return JSON.parse(data) as WikiManifest;
  } catch {
    return undefined;
  }
}

export async function saveManifest(wikiRootPath: string, manifest: WikiManifest): Promise<void> {
  const manifestPath = join(wikiRootPath, ".manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function updateManifestWithEntities(
  manifest: WikiManifest,
  updatedEntities: readonly WikiEntityMetadata[],
  newFileHashes: Map<string, string>,
): WikiManifest {
  const nextEntities = { ...manifest.entities };
  for (const entity of updatedEntities) {
    nextEntities[entity.id] = entity;
  }

  const nextHashes: Record<string, string> = { ...manifest.sourceFileHashes };
  for (const [file, hash] of newFileHashes.entries()) {
    nextHashes[file] = hash;
  }

  return {
    ...manifest,
    sourceFileHashes: nextHashes,
    entities: nextEntities,
  };
}
