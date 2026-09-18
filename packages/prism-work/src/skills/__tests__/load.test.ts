import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { loadWorkSkills, MAX_SKILL_FILE_BYTES, WORK_SKILL_NAMES, WORK_SKILL_TOOLS } from "../index.js";

const packageRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(packageRoot, "../../scripts/vendor-hermes-skills.mjs");

describe("loadWorkSkills", () => {
  it("returns four vendored skills with overlay toolNames", () => {
    const skills = loadWorkSkills();
    assert.deepEqual(
      skills.map((skill) => skill.name),
      [...WORK_SKILL_NAMES],
    );
    for (const skill of skills) {
      assert.ok(skill.description);
      assert.ok(skill.instructions);
      assert.deepEqual(skill.toolNames, [...WORK_SKILL_TOOLS[skill.name as keyof typeof WORK_SKILL_TOOLS]]);
    }
  });

  it("throws when a SKILL.md exceeds the byte cap", () => {
    const root = mkdtempSync(join(tmpdir(), "prism-work-skills-"));
    for (const name of WORK_SKILL_NAMES) {
      const dir = join(root, "skills/productivity", name);
      mkdirSync(dir, { recursive: true });
      const pad = name === "docx" ? "x".repeat(MAX_SKILL_FILE_BYTES) : "ok";
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n${pad}\n`);
    }
    assert.throws(() => loadWorkSkills({ vendorRoot: root }), /exceeds/);
  });

  it("vendor-lock SHA is 40-hex and LICENSE is MIT Nous Research", () => {
    const lock = JSON.parse(readFileSync(join(packageRoot, "vendor-lock.json"), "utf8")) as {
      repo: string;
      sha: string;
      paths: string[];
      license: string;
    };
    assert.match(lock.sha, /^[a-f0-9]{40}$/);
    assert.equal(lock.license, "MIT");
    assert.equal(lock.repo, "NousResearch/hermes-agent");
    const license = readFileSync(join(packageRoot, "vendor/hermes-agent/LICENSE"), "utf8");
    assert.match(license, /MIT License/);
    assert.match(license, /Nous Research/);
  });
});

describe("vendor-hermes-skills", () => {
  it("dry-run fails if a required path is missing", () => {
    const source = mkdtempSync(join(tmpdir(), "prism-hermes-src-"));
    for (const name of ["docx", "xlsx", "powerpoint"]) {
      const dir = join(source, "skills/productivity", name);
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\nlicense: MIT\n---\nbody\n`);
      writeFileSync(join(dir, "LICENSE"), "MIT License\nCopyright (c) 2025 Nous Research\n");
      writeFileSync(join(dir, "scripts/noop.py"), "print(0)\n");
    }
    const result = spawnSync(process.execPath, [script, "--dry-run", "--source", source], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing skills\/productivity\/pdf/);
  });
});
