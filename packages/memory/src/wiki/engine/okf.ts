import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WikiEntityMetadata } from "../types.js";

export const OKF_VERSION = "0.2";

export const OKF_TYPE_BY_CATEGORY = {
  module: "Module",
  concept: "Concept",
  decision: "Decision Record",
  entity: "Entity",
  person: "Person",
  tool: "Tool",
} as const;

export type WikiCategory = keyof typeof OKF_TYPE_BY_CATEGORY;

export function wikiActor(): string {
  return `prism-wiki/${readPackageVersion()}`;
}

function readPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function fileResource(workspaceRoot: string, filePath: string, startLine?: number, endLine?: number): string {
  const absPath = resolve(workspaceRoot, filePath).replace(/\\/g, "/");
  const uri = `file:///${absPath.replace(/^\/+/, "")}`;
  return startLine !== undefined && endLine !== undefined ? `${uri}#L${startLine}-L${endLine}` : uri;
}

export function isIso8601Utc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export interface OkfSource {
  readonly id?: string;
  readonly resource: string;
  readonly title?: string;
}

export function renderConceptFrontmatter(input: {
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly sources: readonly OkfSource[];
  readonly generatedBy: string;
  readonly generatedAt: string;
}): string {
  const sources =
    input.sources.length === 0
      ? "sources: []"
      : `sources:\n${input.sources
          .map((source) => {
            const idLine = source.id ? `  - id: ${source.id}\n    ` : "  - ";
            const titleLine = source.title ? `\n    title: ${JSON.stringify(source.title)}` : "";
            return `${idLine}resource: ${JSON.stringify(source.resource)}${titleLine}`;
          })
          .join("\n")}`;
  return `---
type: ${input.type}
title: ${JSON.stringify(input.title)}
description: ${JSON.stringify(oneLine(input.description))}
tags: [${input.tags.map((tag) => JSON.stringify(tag)).join(", ")}]
${sources}
generated: { by: ${input.generatedBy}, at: ${input.generatedAt} }
---`;
}

function catalogLine(entity: WikiEntityMetadata, href: string): string {
  const description = oneLine(entity.description ?? (entity.tags.join(", ") || "Compiled knowledge."));
  return `* [${entity.title}](${href}) - ${description}`;
}

function renderGroup(entities: readonly WikiEntityMetadata[], hrefFor: (entity: WikiEntityMetadata) => string): string {
  if (entities.length === 0) return "*None indexed yet.*\n";
  return [...entities]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((entity) => catalogLine(entity, hrefFor(entity)))
    .join("\n");
}

export function renderRootIndex(entities: readonly WikiEntityMetadata[]): string {
  const modules = entities.filter((entity) => entity.category === "module");
  const concepts = entities.filter((entity) => entity.category === "concept");
  const decisions = entities.filter((entity) => entity.category === "decision");
  const others = entities.filter((entity) => !["module", "concept", "decision"].includes(entity.category));
  const href = (entity: WikiEntityMetadata) => `entities/${entity.id}.md`;
  return `---
okf_version: "${OKF_VERSION}"
---

# Wiki Index

Catalog of compiled knowledge, modules, and architectural decisions.

## Modules

${renderGroup(modules, href)}

## Concepts

${renderGroup(concepts, href)}

## Decisions

${renderGroup(decisions, href)}
${
  others.length > 0
    ? `
## Additional Entities

${renderGroup(others, href)}
`
    : ""
}`;
}

export function renderDirIndex(dir: "entities" | "decisions" | "concepts", entities: readonly WikiEntityMetadata[]): string {
  const filtered =
    dir === "entities"
      ? entities.filter((entity) => entity.category !== "concept" && entity.category !== "decision")
      : entities.filter((entity) => entity.category === (dir === "concepts" ? "concept" : "decision"));
  const href = (entity: WikiEntityMetadata) => (dir === "entities" ? `${entity.id}.md` : `../entities/${entity.id}.md`);
  const heading = dir === "entities" ? "Entities" : dir === "concepts" ? "Concepts" : "Decisions";
  return `# ${heading}

${renderGroup(filtered, href)}`;
}

export function renderSchema(profileName: string, profileRules: string): string {
  return `# Wiki Schema & Operational Protocol

Profile: \`${profileName}\`

OKF v${OKF_VERSION} bundle (GoogleCloudPlatform/open-knowledge-format). Karpathy compilation protocol retained.

${profileRules}

## OKF mapping
- Root \`index.md\`: only \`okf_version: "${OKF_VERSION}"\` frontmatter; sectioned bullet listings per OKF §8.
- Per-directory \`index.md\` (\`entities/\`, \`decisions/\`, \`concepts/\`): no frontmatter.
- Concept pages: \`type\` (from category: Module / Concept / Decision Record / Entity / Person / Tool), \`title\`, \`description\`, \`tags\`, \`sources[].resource\`, \`generated.by/at\`.
- Compilation ledger stays in \`.manifest.json\` (id, category, rawSources, lastCompiledAt).
- Links: standard relative markdown. No \`[[wikilinks]]\`.
- \`log.md\`: ISO \`YYYY-MM-DD\` headings, newest first, bold leading verbs.

## Formatting Conventions
- **Entity Files**: \`.wiki/entities/<id>.md\` with OKF frontmatter.
- **Decision Records**: \`.wiki/decisions/<slug>.md\`.
- **Linking**: relative markdown links to wiki pages; \`file://\` line anchors for code.
- **Index**: Keep \`.wiki/index.md\` alphabetized and categorized.
- **Log**: Prepend operations under today's date heading in \`.wiki/log.md\`.
`;
}

export function prependLog(
  existing: string | undefined,
  date: string,
  items: readonly { readonly verb: string; readonly text: string }[],
): string {
  const title = "# Directory Update Log";
  const bullets = items.map((item) => `* **${item.verb}**: ${item.text}`).join("\n");
  const rest = (existing ?? "").replace(/^# Directory Update Log\s*/, "").trim();
  const heading = `## ${date}`;
  if (rest.startsWith(heading)) {
    const after = rest.slice(heading.length).replace(/^\n+/, "");
    return `${title}\n\n${heading}\n${bullets}\n${after}\n`;
  }
  return rest ? `${title}\n\n${heading}\n${bullets}\n\n${rest}\n` : `${title}\n\n${heading}\n${bullets}\n`;
}

export function parseConceptFrontmatter(content: string):
  | {
      readonly type?: string;
      readonly title?: string;
      readonly description?: string;
      readonly generatedAt?: string;
    }
  | undefined {
  if (!content.startsWith("---")) return undefined;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const yaml = content.slice(4, end);
  const scalar = (key: string): string | undefined => {
    for (const line of yaml.split("\n")) {
      const prefix = `${key}:`;
      if (!line.startsWith(prefix)) continue;
      const raw = line.slice(prefix.length).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) {
        try {
          return JSON.parse(raw) as string;
        } catch {
          return raw.slice(1, -1);
        }
      }
      return raw || undefined;
    }
    return undefined;
  };
  const generatedLine = yaml.split("\n").find((line) => line.trimStart().startsWith("generated:"));
  const generatedAt = generatedLine?.match(/at:\s*([^,}\s]+)/)?.[1];
  return {
    type: scalar("type"),
    title: scalar("title"),
    description: scalar("description"),
    generatedAt,
  };
}

export function sourcesFromEntity(workspaceRoot: string, entity: WikiEntityMetadata): OkfSource[] {
  if (entity.anchors.length > 0) {
    return entity.anchors.map((anchor) => ({
      id: anchor.symbol,
      resource: fileResource(workspaceRoot, anchor.filePath, anchor.startLine, anchor.endLine),
      title: anchor.filePath,
    }));
  }
  return entity.rawSources.map((src) => ({
    resource: fileResource(workspaceRoot, src),
    title: src,
  }));
}

export function wikiDate(iso: string = new Date().toISOString()): string {
  return iso.slice(0, 10);
}

export function resolveMarkdownHref(fromRelPath: string, href: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  const noQuery = trimmed.split("#")[0].split("?")[0];
  if (!noQuery.endsWith(".md") && !noQuery.endsWith("/")) {
    if (!noQuery.includes(".")) return undefined;
  }
  const fromDir = posix.dirname(fromRelPath.replace(/\\/g, "/"));
  const joined = noQuery.startsWith("/") ? noQuery.slice(1) : posix.normalize(fromDir === "." ? noQuery : posix.join(fromDir, noQuery));
  return joined.replace(/^\.\//, "");
}
