import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSkillFile, type Skill } from "@arnilo/prism";

export const COMPUTER_USE_LINUX_SKILL_NAME = "computer-use-linux";
export const MAX_SKILL_FILE_BYTES = 64 * 1024;
const SKILL_FILE_URL = new URL("../../skills/computer-use-linux/SKILL.md", import.meta.url);

/** Load Prism's bundled, host-independent desktop-control procedure. */
export function loadComputerUseLinuxSkill(): Skill {
  const path = fileURLToPath(SKILL_FILE_URL);
  const data = readFileSync(path);
  if (data.byteLength > MAX_SKILL_FILE_BYTES) {
    throw new Error(`computer-use-linux skill exceeds ${MAX_SKILL_FILE_BYTES} byte cap`);
  }
  const skill = parseSkillFile(data.toString("utf8"), path);
  if (skill.name !== COMPUTER_USE_LINUX_SKILL_NAME) {
    throw new Error(`Expected skill name ${COMPUTER_USE_LINUX_SKILL_NAME}, got ${skill.name}`);
  }
  return skill;
}
