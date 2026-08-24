import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { loadManifest, validateAnchor } from "../manifest.js";
import type { BrokenLink, DeadAnchor, LintReport } from "../types.js";

export interface LinterOptions {
  readonly wikiRoot?: string;
  readonly workspaceRoot?: string;
}

export class WikiLinter {
  async lint(wikiRootPath: string, workspaceRootPath: string = process.cwd()): Promise<LintReport> {
    const absWikiRoot = resolve(workspaceRootPath, wikiRootPath);
    const absWorkspaceRoot = resolve(workspaceRootPath);

    const manifest = await loadManifest(absWikiRoot);
    const deadAnchors: DeadAnchor[] = [];
    const brokenLinks: BrokenLink[] = [];
    const orphans: string[] = [];
    const gaps: string[] = [];

    if (!manifest) {
      return {
        deadAnchors: [],
        brokenLinks: [
          {
            sourceFile: `${wikiRootPath}/.manifest.json`,
            target: "Manifest not found. Run wiki-init first.",
          },
        ],
        orphans: [],
        gaps: [],
        ok: false,
      };
    }

    // 1. Validate anchors against workspace source files
    for (const [entityId, entity] of Object.entries(manifest.entities)) {
      for (const anchor of entity.anchors) {
        const srcPath = resolve(absWorkspaceRoot, anchor.filePath);
        let content: string | undefined;
        try {
          content = await readFile(srcPath, "utf8");
        } catch {
          content = undefined;
        }

        const validation = validateAnchor(anchor, content);
        if (!validation.isValid && validation.reason) {
          deadAnchors.push({
            entityId,
            anchor,
            reason: validation.reason,
          });
        }
      }
    }

    // 2. Discover all markdown pages across .wiki/
    const subdirs = ["entities", "decisions", "concepts"];
    const allPages = new Map<string, string>(); // relativePath -> fullPath
    const inboundCounts = new Map<string, number>();

    // Also include root pages
    const rootFiles = ["index.md", "SCHEMA.md", "log.md"];
    for (const rf of rootFiles) {
      allPages.set(rf, join(absWikiRoot, rf));
      inboundCounts.set(rf, 0);
    }

    for (const sub of subdirs) {
      const subPath = join(absWikiRoot, sub);
      try {
        const entries = await readdir(subPath);
        for (const entry of entries) {
          if (entry.endsWith(".md")) {
            const rel = `${sub}/${entry}`;
            allPages.set(rel, join(subPath, entry));
            inboundCounts.set(rel, 0);
          }
        }
      } catch {
        // Subdir might not exist
      }
    }

    // 3. Scan wikilinks and check targets
    const pageKeySet = new Set(Array.from(allPages.keys()).map((k) => k.toLowerCase()));
    // Also allow linking by plain basename (e.g. [[module-auth]] or [[module-auth.md]])
    const basenameMap = new Map<string, string>();
    for (const key of allPages.keys()) {
      const base = basename(key, ".md").toLowerCase();
      basenameMap.set(base, key);
      basenameMap.set(`${base}.md`, key);
    }

    for (const [relPath, fullPath] of allPages.entries()) {
      if (relPath === "SCHEMA.md") continue;
      try {
        const content = await readFile(fullPath, "utf8");
        const sanitizedContent = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");

        const linkMatches = sanitizedContent.matchAll(/\[\[([a-zA-Z0-9_\-./]+)(?:\|[^\]]+)?\]\]/g);

        for (const match of linkMatches) {
          const rawTarget = match[1].trim();
          let targetNormalized = rawTarget.toLowerCase();
          if (!targetNormalized.endsWith(".md") && !targetNormalized.includes("/")) {
            targetNormalized = `${targetNormalized}.md`;
          }

          let resolvedKey: string | undefined;
          if (pageKeySet.has(targetNormalized)) {
            resolvedKey = targetNormalized;
          } else if (basenameMap.has(rawTarget.toLowerCase())) {
            resolvedKey = basenameMap.get(rawTarget.toLowerCase());
          }

          if (!resolvedKey) {
            brokenLinks.push({
              sourceFile: relPath,
              target: rawTarget,
            });
          } else {
            inboundCounts.set(resolvedKey, (inboundCounts.get(resolvedKey) ?? 0) + 1);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // 4. Identify orphan pages (entities with 0 inbound links)
    for (const [page, count] of inboundCounts.entries()) {
      if (rootFiles.includes(page)) continue;
      if (count === 0 && allPages.size > rootFiles.length + 1) {
        orphans.push(page);
      }
    }

    // 5. Identify potential knowledge gaps
    // If a symbol is referenced across multiple source files but has no matching entity page
    const knownEntityIds = new Set(Object.keys(manifest.entities));
    for (const entity of Object.values(manifest.entities)) {
      for (const anchor of entity.anchors) {
        if (anchor.symbol && anchor.symbol.length > 5 && !knownEntityIds.has(anchor.symbol.toLowerCase())) {
          // If referenced but not represented
        }
      }
    }

    const ok = deadAnchors.length === 0 && brokenLinks.length === 0;
    return {
      deadAnchors,
      brokenLinks,
      orphans: orphans.sort(),
      gaps,
      ok,
    };
  }
}
