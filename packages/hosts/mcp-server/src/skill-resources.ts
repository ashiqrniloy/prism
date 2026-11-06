import type { Skill } from "@arnilo/prism";
import { MAX_RESOURCE_BYTES } from "./serve-tools.js";
import type { ServeToolsResource } from "./types.js";

/** A lent skill is served as `prism-skill://<name>`. */
const SKILL_RESOURCE_SCHEME = "prism-skill://";

/** A skill that qualified for lending but could not be served. Never truncated: the vendor either gets the whole skill or none of it. */
export interface SkippedSkillResource {
  readonly name: string;
  readonly reason: "oversized";
  /** The rendered `SKILL.md` size in UTF-8 bytes. */
  readonly bytes: number;
}

/** What {@linkcode skillResources} returns: pass `resources` to `serveTools`, and report `skipped`. */
export interface SkillResources {
  readonly resources: readonly ServeToolsResource[];
  readonly skipped: readonly SkippedSkillResource[];
}

/** One frontmatter value in block style (the subset every Agent Skills reader accepts): quoted strings, nested mappings, `- ` lists. */
function renderYaml(key: string, value: unknown, indent: string): string[] {
  const label = `${indent}${/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)}:`;
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${label} []`];
    return [
      label,
      ...value.map((item) => `${indent}  - ${typeof item === "object" && item !== null ? JSON.stringify(item) : scalar(item)}`),
    ];
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    return entries.length === 0 ? [`${label} {}`] : [label, ...entries.flatMap(([k, v]) => renderYaml(k, v, `${indent}  `))];
  }
  return [`${label} ${scalar(value)}`];
}

const scalar = (value: unknown): string => (typeof value === "string" ? JSON.stringify(value) : String(value));

/**
 * The skill as a standard Agent Skills `SKILL.md`: frontmatter (`name`, `description`, then every other key the
 * skill carries), a blank line, and the body. Built from the in-memory skill, so it needs no file and cannot drift
 * from what the agent loaded.
 */
function renderSkillMarkdown(skill: Skill): string {
  const front = [`name: ${JSON.stringify(skill.name)}`];
  if (skill.description !== undefined) front.push(`description: ${JSON.stringify(skill.description)}`);
  for (const [key, value] of Object.entries(skill.metadata ?? {})) front.push(...renderYaml(key, value, ""));
  return `---\n${front.join("\n")}\n---\n\n${skill.instructions ?? ""}`;
}

/**
 * Skills to lend alongside served tools, as `serveTools` resources (`options.resources`).
 *
 * A skill is lent only when its `requiresTools` is non-empty and every name in it is in `servedToolNames`, so a
 * vendor agent never reads guidance for a tool it was not given. A skill with no `requiresTools` is not lent (its
 * applicability to these tools is unknown), and neither is one with no body. A skill whose rendered `SKILL.md`
 * exceeds the 256 KiB resource bound is reported in `skipped`, never truncated. A repeated skill name keeps the
 * first one. Pure and deterministic: input order is kept, nothing is read or sent.
 *
 * `servedToolNames` are the registered names (the `allow` list), the same ones a skill's `requiresTools` uses.
 * `serveTools`' `prefix` is not applied to skill text, so a prefixed endpoint shows the vendor different tool names
 * than the skill names.
 */
export function skillResources(skills: readonly Skill[], servedToolNames: readonly string[]): SkillResources {
  const served = new Set(servedToolNames);
  const seen = new Set<string>();
  const resources: ServeToolsResource[] = [];
  const skipped: SkippedSkillResource[] = [];
  for (const skill of skills) {
    const required = skill.requiresTools;
    if (required === undefined || required.length === 0 || !required.every((name) => served.has(name))) continue;
    if (skill.instructions === undefined || skill.instructions.trim() === "" || seen.has(skill.name)) continue;
    seen.add(skill.name);
    const text = renderSkillMarkdown(skill);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_RESOURCE_BYTES) {
      skipped.push({ name: skill.name, reason: "oversized", bytes });
      continue;
    }
    resources.push({ uri: `${SKILL_RESOURCE_SCHEME}${encodeURIComponent(skill.name)}`, name: skill.name, mimeType: "text/markdown", text });
  }
  return { resources, skipped };
}
