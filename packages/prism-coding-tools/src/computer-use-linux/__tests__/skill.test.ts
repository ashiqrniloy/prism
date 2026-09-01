import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { COMPUTER_USE_LINUX_SKILL_NAME, loadComputerUseLinuxSkill, MAX_SKILL_FILE_BYTES } from "../skill.js";

test("loadComputerUseLinuxSkill loads the bundled bounded skill", () => {
  const skill = loadComputerUseLinuxSkill();
  assert.equal(skill.name, COMPUTER_USE_LINUX_SKILL_NAME);
  assert.ok(skill.instructions);
  assert.ok(Buffer.byteLength(skill.instructions ?? "", "utf8") <= MAX_SKILL_FILE_BYTES);
});

test("desktop skill gives safe observation and targeting procedure", () => {
  const instructions = loadComputerUseLinuxSkill().instructions ?? "";
  for (const token of ["doctor", "get_app_state", "role|name", "one at a time", "host-only"]) {
    assert.ok(instructions.includes(token), `skill missing ${token}`);
  }
  assert.doesNotMatch(instructions, /includeSetupTools\s*:\s*true/);
  assert.doesNotMatch(instructions.toLowerCase(), /disable approval/);
});

test("desktop skill is packaged as a local file, not an upstream tree", () => {
  const packageRoot = resolve(import.meta.dirname, "../../..");
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { files?: string[] };
  assert.ok(manifest.files?.includes("skills"));
  assert.ok(readFileSync(resolve(packageRoot, "skills/computer-use-linux/SKILL.md"), "utf8").length > 0);
});
