import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFile, type Skill } from "@arnilo/prism";

export const WORK_SKILL_NAMES = ["docx", "xlsx", "powerpoint", "pdf"] as const;
export type WorkSkillName = (typeof WORK_SKILL_NAMES)[number];
export const MAX_SKILL_FILE_BYTES = 64 * 1024;

export const WORK_SKILL_TOOLS = {
  docx: ["office_parse", "office_generate", "office_patch", "office_import"],
  xlsx: ["office_parse", "office_generate", "office_patch", "office_import"],
  powerpoint: ["office_parse", "office_generate", "office_patch", "office_import"],
  pdf: ["office_parse", "office_import"],
} as const;

export interface LoadWorkSkillsOptions {
  readonly vendorRoot?: string;
}

const DEFAULT_VENDOR_ROOT = fileURLToPath(new URL("../../vendor/hermes-agent", import.meta.url));

export function loadWorkSkills(options: LoadWorkSkillsOptions = {}): Skill[] {
  const root = options.vendorRoot ?? DEFAULT_VENDOR_ROOT;
  return WORK_SKILL_NAMES.map((name) => loadOne(root, name));
}

function loadOne(root: string, name: WorkSkillName): Skill {
  const path = join(root, "skills/productivity", name, "SKILL.md");
  const data = readFileSync(path);
  if (data.byteLength > MAX_SKILL_FILE_BYTES) {
    throw new Error(`work skill ${name} exceeds ${MAX_SKILL_FILE_BYTES} byte cap`);
  }
  const skill = parseSkillFile(data.toString("utf8"), path);
  if (skill.name !== name) {
    throw new Error(`Expected skill name ${name}, got ${skill.name}`);
  }
  if (!skill.description || !skill.instructions) {
    throw new Error(`work skill ${name} missing description or instructions`);
  }
  return { ...skill, toolNames: [...WORK_SKILL_TOOLS[name]] };
}
