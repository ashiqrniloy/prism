import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFile, type Skill } from "@arnilo/prism";

export const WORK_SKILL_NAMES = ["docx", "xlsx", "powerpoint", "pdf"] as const;
export type WorkSkillName = (typeof WORK_SKILL_NAMES)[number];
export const MAX_SKILL_FILE_BYTES = 64 * 1024;

/**
 * What the vendored Hermes skills need. They teach `python`, `openpyxl`, `python-docx`, `pypdf` and `soffice`
 * run through the sandbox, and never name an `office_*` tool, so the one tool they depend on is `work_exec`.
 * Declared here, in code, so the vendored bytes stay untouched and pinned to `vendor-lock.json`.
 */
export const WORK_SKILL_REQUIRES_TOOLS = ["work_exec"] as const;

export interface LoadWorkSkillsOptions {
  readonly vendorRoot?: string;
}

const DEFAULT_VENDOR_ROOT = fileURLToPath(new URL("../../vendor/hermes-agent", import.meta.url));

/** The four vendored office skills, each declaring `requiresTools: work_exec`, so a request without the sandbox tool hides them. */
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
  return { ...skill, requiresTools: [...WORK_SKILL_REQUIRES_TOOLS] };
}
