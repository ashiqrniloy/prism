import { readdirSync } from "node:fs";
import { join } from "node:path";

import { parseSkillFile, type Skill } from "@arnilo/prism";

import { MAX_SKILL_FILE_BYTES, readBoundedFile, SKILLS_DIR_NAME } from "./upstream.js";

export const PONYTAIL_SKILL_NAMES = [
  "ponytail",
  "ponytail-audit",
  "ponytail-debt",
  "ponytail-gain",
  "ponytail-help",
  "ponytail-review",
] as const;

export type PonytailSkillName = (typeof PONYTAIL_SKILL_NAMES)[number];

/** O(skills) scan of upstream skills directories; no repo walk. */
export function loadUpstreamSkills(upstreamRoot: string): Skill[] {
  const skillsDir = join(upstreamRoot, SKILLS_DIR_NAME);
  const skills: Skill[] = [];
  for (const name of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const skillPath = join(skillsDir, name.name, "SKILL.md");
    const text = readBoundedFile(upstreamRoot, join(SKILLS_DIR_NAME, name.name, "SKILL.md"), MAX_SKILL_FILE_BYTES);
    const skill = parseSkillFile(text, skillPath);
    skills.push(skill);
  }
  return skills;
}

export function requirePonytailSkills(skills: readonly Skill[]): Map<PonytailSkillName, Skill> {
  const byName = new Map(skills.map((skill) => [skill.name, skill] as const));
  for (const name of PONYTAIL_SKILL_NAMES) {
    if (!byName.has(name)) throw new Error(`Missing upstream Ponytail skill: ${name}`);
  }
  return byName as Map<PonytailSkillName, Skill>;
}
