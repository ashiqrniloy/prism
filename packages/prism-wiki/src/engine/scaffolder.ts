import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyManifest, saveManifest } from "../manifest.js";
import { resolveProfile } from "../profiles/hybrid.js";
import type { WikiManifest, WikiProfileType } from "../types.js";

export interface ScaffoldOptions {
  readonly wikiRoot: string;
  readonly rawRoots?: readonly string[];
  readonly profile?: WikiProfileType;
  readonly sampleFiles?: readonly string[];
}

export interface ScaffoldResult {
  readonly wikiRoot: string;
  readonly profile: WikiProfileType;
  readonly createdFiles: readonly string[];
  readonly manifest: WikiManifest;
}

export async function scaffoldWiki(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const wikiRoot = options.wikiRoot;
  const rawRoots = options.rawRoots ?? ["."];
  const sampleFiles = options.sampleFiles ?? [];
  const profileInstance = resolveProfile(options.profile ?? "auto", sampleFiles);

  const subdirs = [wikiRoot, join(wikiRoot, "entities"), join(wikiRoot, "decisions"), join(wikiRoot, "concepts")];

  for (const dir of subdirs) {
    await mkdir(dir, { recursive: true });
  }

  const createdFiles: string[] = [];

  // 1. SCHEMA.md
  const schemaPath = join(wikiRoot, "SCHEMA.md");
  const schemaContent = `# Wiki Schema & Operational Protocol

Profile: \`${profileInstance.name}\`

${profileInstance.generateSchemaRules()}

## Formatting Conventions
- **Entity Files**: \`.wiki/entities/<id>.md\` with YAML frontmatter (\`id\`, \`title\`, \`category\`, \`tags\`, \`rawSources\`).
- **Decision Records**: \`.wiki/decisions/ADR-<num>-<title>.md\`.
- **Linking**: Use \`[[entity-id]]\` for wiki page cross-references and \`symbol (file:///path#Lxx-Lyy)\` for code anchors.
- **Index**: Keep \`.wiki/index.md\` alphabetized and categorized.
- **Log**: Append every operation chronologically to \`.wiki/log.md\`.
`;
  await writeFile(schemaPath, schemaContent, "utf8");
  createdFiles.push(schemaPath);

  // 2. index.md
  const indexPath = join(wikiRoot, "index.md");
  const indexContent = `# Wiki Index

Catalog of compiled knowledge, modules, and architectural decisions.

## Modules

*No modules compiled yet.*

## Concepts

*No concepts compiled yet.*

## Decisions

*No decision records yet.*
`;
  await writeFile(indexPath, indexContent, "utf8");
  createdFiles.push(indexPath);

  // 3. log.md
  const logPath = join(wikiRoot, "log.md");
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const logContent = `# Wiki Operations Log

## [${now}] init | Wiki Scaffolding
- Initialized \`${wikiRoot}\` directory layout.
- Instantiated \`SCHEMA.md\` under profile \`${profileInstance.name}\`.
- Created baseline \`index.md\` and \`log.md\`.
`;
  await writeFile(logPath, logContent, "utf8");
  createdFiles.push(logPath);

  // 4. .manifest.json
  const manifest = createEmptyManifest(wikiRoot, rawRoots, profileInstance.name);
  await saveManifest(wikiRoot, manifest);
  createdFiles.push(join(wikiRoot, ".manifest.json"));

  return {
    wikiRoot,
    profile: profileInstance.name,
    createdFiles,
    manifest,
  };
}
