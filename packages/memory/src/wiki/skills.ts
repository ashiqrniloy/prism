import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "@arnilo/prism";
import { WIKI_READ_PAGE_TOOL_NAME, WIKI_RECORD_INSIGHT_TOOL_NAME, WIKI_SEARCH_TOOL_NAME } from "./extension.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DeployOptions {
  /** If true, overwrites existing skill files in target workspace. Defaults to false. */
  readonly overwrite?: boolean;
}

export function resolvePackageSkillsDir(): string {
  // If running from src/<family> or dist/<family>, skills directory is at package root
  const candidate1 = resolve(__dirname, "../../skills");
  const _candidate2 = resolve(__dirname, "../../skills");
  return candidate1;
}

export function parseSkillMarkdown(content: string): { name: string; description: string; instructions: string } {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      name: "unknown-skill",
      description: "",
      instructions: content.trim(),
    };
  }

  const [, rawYaml, body] = frontmatterMatch;
  let name = "unknown-skill";
  let description = "";

  // Linear line-scan field extraction replaces `/^key:\s*(.+(?:\n\s+.+)*)$/m` style regexes
  // (CodeQL js/polynomial-redos, alert 66): walk lines, join indented continuations.
  const nameMatch = matchYamlValue(rawYaml, "name");
  if (nameMatch) name = nameMatch.trim();

  const descMatch = matchYamlValue(rawYaml, "description");
  if (descMatch) description = descMatch.trim();

  return {
    name,
    description,
    instructions: body.trim(),
  };
}

function matchYamlValue(rawYaml: string, key: string): string | undefined {
  const lines = rawYaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(`${key}:`)) continue;
    const parts = [lines[i].slice(key.length + 1).trim()];
    let j = i + 1;
    while (j < lines.length && /^[ \t]+\S/.test(lines[j])) {
      parts.push(lines[j].trim());
      j += 1;
    }
    const value = parts
      .filter((p) => p !== "")
      .join(" ")
      .trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}

export async function deployWikiSkills(workspaceRoot: string, options: DeployOptions = {}): Promise<string[]> {
  const skillsSourceDir = resolvePackageSkillsDir();
  const targetBaseDir = join(workspaceRoot, ".agents/skills");
  const deployedPaths: string[] = [];

  const skillNames = ["wiki-maintainer", "wiki-searcher"];

  for (const skillName of skillNames) {
    const srcDir = join(skillsSourceDir, skillName);
    const destDir = join(targetBaseDir, skillName);

    try {
      const srcStat = await stat(srcDir);
      if (!srcStat.isDirectory()) continue;
    } catch {
      // Source directory not found (e.g. In custom bundled environments), skip file copy
      continue;
    }

    let destExists = false;
    try {
      const destStat = await stat(destDir);
      destExists = destStat.isDirectory();
    } catch {
      destExists = false;
    }

    if (!destExists || options.overwrite) {
      await mkdir(destDir, { recursive: true });
      await cp(srcDir, destDir, { recursive: true, force: true });
      deployedPaths.push(destDir);
    }
  }

  return deployedPaths;
}

export const wikiSearcherSkill: Skill = {
  name: "wiki-searcher",
  description:
    "Queries the compiled LLM Wiki (.wiki/) using local qmd hybrid search and Context7-style line navigation. Use when looking up architecture patterns, module relationships, design decisions (ADRs), or compounding newly synthesized insights back into the knowledge base.",
  instructions:
    "1. Run `wiki_search` with a descriptive conceptual query before using broad regex search (`grep`/`rg`).\n" +
    "2. Select mode: `search` (fast BM25), `vsearch` (vector semantic), or `query` (hybrid + LLM reranking).\n" +
    "3. Use returned `file:///` clickable line links directly to navigate code.\n" +
    "4. When discovering high-value new insights or solutions, call `wiki_record_insight` to compound knowledge into the wiki.",
  toolNames: [WIKI_SEARCH_TOOL_NAME, WIKI_READ_PAGE_TOOL_NAME, WIKI_RECORD_INSIGHT_TOOL_NAME],
};

export const wikiMaintainerSkill: Skill = {
  name: "wiki-maintainer",
  description:
    "Compiles, ingests, updates, reconciles contradictions, and lints the Karpathy LLM Wiki (.wiki/) for codebases and PKM vaults. Use when building a new wiki (wiki-init), incrementally updating changed sources (wiki-refresh), reconciling conflicting claims, or performing health checks (wiki-lint).",
  instructions:
    "1. Compilation over duplication: Synthesize architecture, workflows, and decisions; never copy full code files.\n" +
    "2. Precise anchors: Every factual claim about code must cite exact line links: `symbol (file:///path#L10-L40)`.\n" +
    "3. Contradiction reconciliation: Update existing entity pages on conflicting data; log resolutions in `.wiki/log.md`.\n" +
    "4. Keep `.wiki/index.md` (content catalog) and `.wiki/log.md` (audit ledger) synchronized.\n" +
    '5. Emit OKF v0.2: concept frontmatter `type`/`title`/`description`/`tags`/`sources`/`generated`; root `index.md` only `okf_version: "0.2"`; `log.md` date-grouped newest-first; plain markdown links (no `[[wikilinks]]`); attribute claims via `sources[].id` footnotes.',
};

export async function loadBundledSkills(packageRoot?: string): Promise<Map<string, Skill>> {
  const root = packageRoot ?? resolvePackageSkillsDir();
  const skills = new Map<string, Skill>();

  const skillEntries: [string, string[]][] = [
    ["wiki-searcher", [WIKI_SEARCH_TOOL_NAME, WIKI_READ_PAGE_TOOL_NAME, WIKI_RECORD_INSIGHT_TOOL_NAME]],
    ["wiki-maintainer", []],
  ];

  for (const [skillName, toolNames] of skillEntries) {
    const skillPath = join(root, skillName, "SKILL.md");
    try {
      const content = await readFile(skillPath, "utf8");
      const parsed = parseSkillMarkdown(content);
      skills.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        instructions: parsed.instructions,
        toolNames: toolNames.length > 0 ? toolNames : undefined,
      });
    } catch {
      // Fall back to exported static definitions if disk read fails
      if (skillName === "wiki-searcher") skills.set("wiki-searcher", wikiSearcherSkill);
      if (skillName === "wiki-maintainer") skills.set("wiki-maintainer", wikiMaintainerSkill);
    }
  }

  return skills;
}
