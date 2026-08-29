import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { computeSourceDelta, hashContent, loadManifest, saveManifest, scanRawFiles, updateManifestWithEntities } from "../manifest.js";
import type { ExtractedSymbol, ScannedFile } from "../profiles/codebase.js";
import { resolveProfile } from "../profiles/hybrid.js";
import type { SourceDelta, WikiEntityMetadata, WikiManifest, WikiProfileType, WikiSourceAnchor } from "../types.js";
import { ContradictionEngine } from "./contradictions.js";
import {
  fileResource,
  OKF_TYPE_BY_CATEGORY,
  oneLine,
  prependLog,
  renderConceptFrontmatter,
  renderDirIndex,
  renderRootIndex,
  sourcesFromEntity,
  wikiActor,
  wikiDate,
} from "./okf.js";
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
  const description = oneLine(summary ?? entity.description ?? `Compiled architectural model and knowledge for ${entity.title}.`);
  const frontmatter = renderConceptFrontmatter({
    type: OKF_TYPE_BY_CATEGORY[entity.category],
    title: entity.title,
    description,
    tags: entity.tags,
    sources: sourcesFromEntity(workspaceRoot, entity),
    generatedBy: wikiActor(),
    generatedAt: entity.lastCompiledAt,
  });

  const symbolsSection =
    symbols.length > 0
      ? symbols
          .slice(0, 50)
          .map((s) => {
            const matchingAnchor = entity.anchors.find((a) => a.symbol === s.name);
            const file = matchingAnchor ? matchingAnchor.filePath : (entity.rawSources[0] ?? "");
            const link = `[${s.name}](${fileResource(workspaceRoot, file, s.startLine, s.endLine)})`;
            return `- ${link} (\`${s.kind}\`): ${s.signature ?? s.name}`;
          })
          .join("\n")
      : "*No exported symbols indexed.*";

  return `${frontmatter}

# ${entity.title}

${description}

## Key Symbols & Source Anchors

${symbolsSection}

## Raw Sources
${entity.rawSources.map((src) => `- \`${src}\``).join("\n")}
`;
}

export function renderIndexCatalog(entities: readonly WikiEntityMetadata[]): string {
  return renderRootIndex(entities);
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
        description: oneLine(draft.summary ?? `Compiled architectural model and knowledge for ${draft.title}.`),
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
    await writeFile(join(wikiRoot, "entities", "index.md"), renderDirIndex("entities", allEntities), "utf8");
    await writeFile(join(wikiRoot, "decisions", "index.md"), renderDirIndex("decisions", allEntities), "utf8");
    await writeFile(join(wikiRoot, "concepts", "index.md"), renderDirIndex("concepts", allEntities), "utf8");

    const logPath = join(wikiRoot, "log.md");
    let existingLog: string | undefined;
    try {
      existingLog = await readFile(logPath, "utf8");
    } catch {
      existingLog = undefined;
    }
    const logItems = [
      {
        verb: "Compiled",
        text: `${compiledEntities.length} entities compiled (added ${delta.added.length}, modified ${delta.modified.length}, deleted ${delta.deleted.length}). Profile \`${profileInstance.name}\`.`,
      },
      ...contradictionEngine.formatContradictionLogItems(contradictionRecords),
    ];
    await writeFile(logPath, prependLog(existingLog, wikiDate(nowIso), logItems), "utf8");

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
