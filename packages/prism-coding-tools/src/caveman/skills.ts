import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseSkillFile, type Skill } from "@arnilo/prism";

import { MAX_SKILL_FILE_BYTES, readBoundedFile, SKILLS_DIR_NAME } from "./upstream.js";

export const CAVEMAN_SKILL_NAMES = [
  "caveman",
  "caveman-commit",
  "caveman-review",
  "caveman-stats",
  "caveman-compress",
  "caveman-help",
  "cavecrew",
] as const;

/** O(skills) scan. Dirs without SKILL.md (engine junk) skipped, not fatal. */
export function loadUpstreamSkills(upstreamRoot: string): Skill[] {
  const skillsDir = join(upstreamRoot, SKILLS_DIR_NAME);
  const skills: Skill[] = [];
  for (const name of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const relative = join(SKILLS_DIR_NAME, name.name, "SKILL.md");
    if (!existsSync(join(upstreamRoot, relative))) continue;
    const skillPath = join(skillsDir, name.name, "SKILL.md");
    const text = readBoundedFile(upstreamRoot, relative, MAX_SKILL_FILE_BYTES);
    skills.push(parseSkillFile(text, skillPath));
  }
  return skills;
}

export function requireCavemanSkills(skills: readonly Skill[]): Map<string, Skill> {
  const byName = new Map(skills.map((skill) => [skill.name, skill] as const));
  for (const name of CAVEMAN_SKILL_NAMES) {
    if (!byName.has(name)) throw new Error(`Missing upstream Caveman skill: ${name}`);
  }
  return byName;
}
