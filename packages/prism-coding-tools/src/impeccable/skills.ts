import { join } from "node:path";
import { parseSkillFile, type Skill } from "@arnilo/prism";

import { MAX_SKILL_FILE_BYTES, readBoundedFile } from "./upstream.js";

export const IMPECCABLE_SKILL_NAME = "impeccable";

export function loadImpeccableSkill(root: string, skillRelativePath: string): Skill {
  const text = readBoundedFile(root, skillRelativePath, MAX_SKILL_FILE_BYTES);
  const skill = parseSkillFile(text, join(root, skillRelativePath));
  if (skill.name !== IMPECCABLE_SKILL_NAME) {
    throw new Error(`Expected upstream skill name ${IMPECCABLE_SKILL_NAME}, got ${skill.name}`);
  }
  return skill;
}
