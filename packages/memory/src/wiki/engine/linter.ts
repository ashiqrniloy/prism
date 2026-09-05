import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { loadManifest, validateAnchor } from "../manifest.js";
import type { BrokenLink, DeadAnchor, LintReport } from "../types.js";
import { isIso8601Utc, parseConceptFrontmatter, resolveMarkdownHref } from "./okf.js";

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

    const rootFiles = ["index.md", "SCHEMA.md", "log.md"];
    const reservedPages = new Set([...rootFiles, "entities/index.md", "decisions/index.md", "concepts/index.md"]);
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

        if (relPath === "index.md") {
          const fm = parseConceptFrontmatter(content);
          if (fm?.type !== undefined && fm.type !== "" && !content.includes("okf_version:")) {
            gaps.push(`${relPath}: index.md must not carry concept type`);
          }
          if (!/^---\s*\nokf_version:\s*"0\.2"\s*\n---/m.test(content) && !content.includes('okf_version: "0.2"')) {
            gaps.push(`${relPath}: missing okf_version: "0.2"`);
          }
        } else if (!reservedPages.has(relPath) && relPath.endsWith(".md")) {
          const fm = parseConceptFrontmatter(content);
          if (!fm?.type) gaps.push(`${relPath}: missing type`);
          if (fm?.generatedAt && !isIso8601Utc(fm.generatedAt)) gaps.push(`${relPath}: generated.at is not ISO 8601`);
        }

        for (const match of sanitizedContent.matchAll(/\[\[([^\]]+)\]\]/g)) {
          brokenLinks.push({
            sourceFile: relPath,
            target: `[[${match[1].trim()}]]`,
          });
        }

        for (const match of sanitizedContent.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
          const href = match[2].trim();
          const resolved = resolveMarkdownHref(relPath, href);
          if (!resolved) continue;
          const key = resolved.toLowerCase();
          let resolvedKey: string | undefined;
          if (pageKeySet.has(key)) resolvedKey = key;
          else if (basenameMap.has(basename(resolved, ".md").toLowerCase())) {
            resolvedKey = basenameMap.get(basename(resolved, ".md").toLowerCase());
          }
          if (!resolvedKey) {
            brokenLinks.push({ sourceFile: relPath, target: href });
          } else {
            inboundCounts.set(resolvedKey, (inboundCounts.get(resolvedKey) ?? 0) + 1);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    for (const [page, count] of inboundCounts.entries()) {
      if (reservedPages.has(page)) continue;
      if (count === 0 && allPages.size > reservedPages.size + 1) {
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
