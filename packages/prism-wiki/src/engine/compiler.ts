import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { computeSourceDelta, hashContent, loadManifest, saveManifest, scanRawFiles, updateManifestWithEntities } from "../manifest.js";
import type { ExtractedSymbol, ScannedFile } from "../profiles/codebase.js";
import { resolveProfile } from "../profiles/hybrid.js";
import type { SourceDelta, WikiEntityMetadata, WikiManifest, WikiProfileType, WikiSourceAnchor } from "../types.js";
import { ContradictionEngine } from "./contradictions.js";
import { scaffoldWiki } from "./scaffolder.js";

export interface CompileOptions {
  readonly workspaceRoot: string;
  readonly wikiRoot?: string;
  readonly rawRoots?: readonly string[];
  readonly profile?: WikiProfileType;
}

export interface CompileResult {
  readonly wikiRoot: string;
  readonly profile: WikiProfileType;
  readonly delta: SourceDelta;
  readonly compiledEntities: readonly WikiEntityMetadata[];
  readonly manifest: WikiManifest;
}

export function renderEntityMarkdown(
  workspaceRoot: string,
  entity: WikiEntityMetadata,
  symbols: readonly ExtractedSymbol[],
  summary?: string,
): string {
  const frontmatter = `---
id: ${entity.id}
title: ${JSON.stringify(entity.title)}
category: ${entity.category}
tags: [${entity.tags.map((t) => JSON.stringify(t)).join(", ")}]
rawSources: [${entity.rawSources.map((s) => JSON.stringify(s)).join(", ")}]
lastCompiledAt: ${JSON.stringify(entity.lastCompiledAt)}
---

# ${entity.title}

${summary ?? `Compiled architectural model and knowledge for ${entity.title}.`}

## Key Symbols & Source Anchors

${
  symbols.length > 0
    ? symbols
        .slice(0, 50)
        .map((s) => {
          const matchingAnchor = entity.anchors.find((a) => a.symbol === s.name);
          const file = matchingAnchor ? matchingAnchor.filePath : (entity.rawSources[0] ?? "");
          const absPath = resolve(workspaceRoot, file).replace(/\\/g, "/");
          const link = `[${s.name}](file:///${absPath.replace(/^\/+/, "")}#L${s.startLine}-L${s.endLine})`;
          return `- ${link} (\`${s.kind}\`): ${s.signature ?? s.name}`;
        })
        .join("\n")
    : "*No exported symbols indexed.*"
}

## Raw Sources
${entity.rawSources.map((src) => `- \`${src}\``).join("\n")}
`;

  return frontmatter;
}

export function renderIndexCatalog(entities: readonly WikiEntityMetadata[]): string {
  const modules = entities.filter((e) => e.category === "module");
  const concepts = entities.filter((e) => e.category === "concept");
  const decisions = entities.filter((e) => e.category === "decision");
  const others = entities.filter((e) => !["module", "concept", "decision"].includes(e.category));

  function renderGroup(group: readonly WikiEntityMetadata[]): string {
    if (group.length === 0) return "*None indexed yet.*\n";
    return [...group]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => `- [[entities/${e.id}.md|${e.title}]]: ${e.tags.join(", ") || "General"}`)
      .join("\n");
  }

  return `# Wiki Index

Catalog of compiled knowledge, modules, and architectural decisions.

## Modules

${renderGroup(modules)}

## Concepts

${renderGroup(concepts)}

## Decisions

${renderGroup(decisions)}
${
  others.length > 0
    ? `
## Additional Entities

${renderGroup(others)}
`
    : ""
}`;
}

export class WikiCompiler {
  async compile(options: CompileOptions): Promise<CompileResult> {
    const workspaceRoot = resolve(options.workspaceRoot);
    const wikiRoot = resolve(workspaceRoot, options.wikiRoot ?? ".wiki");
    const rawRoots = options.rawRoots ?? ["."];

    let manifest = await loadManifest(wikiRoot);
    if (!manifest) {
      const scaffolded = await scaffoldWiki({
        wikiRoot,
        rawRoots,
        profile: options.profile,
      });
      manifest = scaffolded.manifest;
    }

    const profileInstance = resolveProfile(options.profile ?? manifest.profile, []);
    const currentFiles = await scanRawFiles(workspaceRoot, rawRoots);
    const delta = computeSourceDelta(manifest, currentFiles);

    // If no changes and entities exist, return existing state
    if (
      delta.added.length === 0 &&
      delta.modified.length === 0 &&
      delta.deleted.length === 0 &&
      Object.keys(manifest.entities).length > 0
    ) {
      return {
        wikiRoot,
        profile: manifest.profile,
        delta,
        compiledEntities: Object.values(manifest.entities),
        manifest,
      };
    }

    // Read changed or newly added source files
    const relevantFilesToRead = Array.from(currentFiles.keys());
    const scannedFiles: ScannedFile[] = [];

    for (const relPath of relevantFilesToRead) {
      const absPath = resolve(workspaceRoot, relPath);
      try {
        const content = await readFile(absPath, "utf8");
        const hash = currentFiles.get(relPath) ?? "";
        scannedFiles.push({
          relativePath: relPath,
          content,
          hash,
          extension: extname(relPath),
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Derive entities using profile
    const drafts = profileInstance.deriveEntities(scannedFiles);
    const nowIso = new Date().toISOString();

    const compiledEntities: WikiEntityMetadata[] = [];

    const fileContentMap = new Map<string, string>(scannedFiles.map((f) => [f.relativePath, f.content]));

    const contradictionEngine = new ContradictionEngine();
    const contradictionRecords = [];

    for (const draft of drafts) {
      const existing = manifest.entities[draft.id];
      if (existing) {
        const contradictions = contradictionEngine.detectContradictions(existing, draft);
        if (contradictions.length > 0) {
          contradictionRecords.push(...contradictions);
        }
      }

      const anchors: WikiSourceAnchor[] = draft.symbols.map((sym) => {
        const sourceFile = draft.rawSources[0] ?? "";
        const fileContent = fileContentMap.get(sourceFile) ?? "";
        const lines = fileContent.split("\n");
        const chunk = lines.slice(sym.startLine - 1, sym.endLine).join("\n");
        return {
          filePath: sourceFile,
          startLine: sym.startLine,
          endLine: sym.endLine,
          symbol: sym.name,
          sourceHash: hashContent(chunk),
        };
      });

      const entityMeta: WikiEntityMetadata = {
        id: draft.id,
        title: draft.title,
        category: draft.category,
        tags: draft.tags,
        rawSources: draft.rawSources,
        anchors,
        lastCompiledAt: nowIso,
      };

      compiledEntities.push(entityMeta);

      const markdown = renderEntityMarkdown(workspaceRoot, entityMeta, draft.symbols, draft.summary);
      const entityFilePath = join(wikiRoot, "entities", `${draft.id}.md`);
      await writeFile(entityFilePath, markdown, "utf8");
    }

    // Update index.md
    const allEntities = Object.values({
      ...manifest.entities,
      ...Object.fromEntries(compiledEntities.map((e) => [e.id, e])),
    });

    const indexContent = renderIndexCatalog(allEntities);
    await writeFile(join(wikiRoot, "index.md"), indexContent, "utf8");

    // Append to log.md
    const logTimestamp = nowIso.replace("T", " ").slice(0, 16);
    let logEntry = `\n## [${logTimestamp}] compile | ${compiledEntities.length} entities compiled\n- Added ${delta.added.length} file(s), modified ${delta.modified.length}, deleted ${delta.deleted.length}.\n- Profile: \`${profileInstance.name}\`.\n`;

    if (contradictionRecords.length > 0) {
      logEntry += contradictionEngine.formatContradictionLogEntry(contradictionRecords);
    }

    const logPath = join(wikiRoot, "log.md");
    try {
      const existingLog = await readFile(logPath, "utf8");
      await writeFile(logPath, existingLog + logEntry, "utf8");
    } catch {
      await writeFile(logPath, `# Wiki Log\n${logEntry}`, "utf8");
    }

    // Update and persist manifest
    manifest = updateManifestWithEntities(manifest, compiledEntities, currentFiles);
    await saveManifest(wikiRoot, manifest);

    return {
      wikiRoot,
      profile: manifest.profile,
      delta,
      compiledEntities,
      manifest,
    };
  }
}
