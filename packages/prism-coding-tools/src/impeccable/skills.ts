import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseSkillFile, type Skill } from "@arnilo/prism";

import { MAX_SKILL_FILE_BYTES, readBoundedFile } from "./upstream.js";

export const IMPECCABLE_SKILL_NAME = "impeccable";

/**
 * Digest-pin the resolved snapshot when the host provides one: the pin is the
 * sha256 of the SKILL.md bytes. Hosts record it when they vendor a snapshot
 * (git HEAD of their upstream checkout) so upstream security fixes arrive as a
 * deliberate bump, not a silent content swap.
 */
function snapshotDigestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadImpeccableSkill(root: string, skillRelativePath: string, expectedDigest?: string): Skill {
  const text = readBoundedFile(root, skillRelativePath, MAX_SKILL_FILE_BYTES);
  if (expectedDigest && snapshotDigestOf(text) !== expectedDigest) {
    throw new Error(
      `Expected upstream impeccable SKILL.md to match recorded snapshot digest ${expectedDigest.slice(0, 12)}…, got ${snapshotDigestOf(text).slice(0, 12)}… (refresh the vendored snapshot and bump the pin)`,
    );
  }
  const skill = parseSkillFile(text, join(root, skillRelativePath));
  if (skill.name !== IMPECCABLE_SKILL_NAME) {
    throw new Error(`Expected upstream skill name ${IMPECCABLE_SKILL_NAME}, got ${skill.name}`);
  }
  return skill;
}
