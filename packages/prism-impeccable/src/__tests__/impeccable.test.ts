import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";

import { createImpeccableExtension } from "../extension.js";
import { IMPECCABLE_SKILL_NAME } from "../skills.js";
import { MAX_SKILL_FILE_BYTES, readBoundedFile, resolveUpstreamRoot, UpstreamResolveError } from "../upstream.js";

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/upstream-minimal");
const secretPath = join(homedir(), "secret-impeccable-upstream");

describe("impeccable upstream", () => {
  it("resolveUpstreamRoot_accepts_skills_impeccable_skill_md", () => {
    const resolved = resolveUpstreamRoot({ upstreamPath: fixtureRoot });
    assert.equal(resolved.root, fixtureRoot);
    assert.equal(resolved.skillRelativePath, "skills/impeccable/SKILL.md");
  });

  it("resolveUpstreamRoot_accepts_skill_md_at_root", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-impeccable-root-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "---\nname: impeccable\ndescription: compiled\n---\n\nCompiled skill.\n");
      const resolved = resolveUpstreamRoot({ upstreamPath: dir });
      assert.equal(resolved.skillRelativePath, "SKILL.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveUpstreamRoot_fails_closed_when_skill_missing_or_empty_path", () => {
    assert.throws(
      () => resolveUpstreamRoot({ upstreamPath: import.meta.dirname }),
      (error: unknown) => error instanceof UpstreamResolveError && error.code === "upstream_resolve_failed",
    );
    assert.throws(() => resolveUpstreamRoot({ upstreamPath: "   " }), UpstreamResolveError);
  });

  it("resolveUpstreamRoot_redacts_absolute_paths_in_errors", () => {
    try {
      resolveUpstreamRoot({ upstreamPath: secretPath });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof UpstreamResolveError);
      assert.ok(!error.message.includes(secretPath));
      assert.ok(!error.message.includes(homedir()));
    }
  });

  it("readBoundedFile_rejects_path_escape_and_oversized_skill", () => {
    assert.throws(
      () => readBoundedFile(fixtureRoot, "../escape/SKILL.md", MAX_SKILL_FILE_BYTES),
      (error: unknown) => error instanceof UpstreamResolveError && String(error.message).includes("escapes"),
    );
    const dir = mkdtempSync(join(tmpdir(), "prism-impeccable-big-"));
    try {
      mkdirSync(join(dir, "skills", "impeccable"), { recursive: true });
      writeFileSync(join(dir, "skills", "impeccable", "SKILL.md"), "x".repeat(MAX_SKILL_FILE_BYTES + 1));
      assert.throws(
        () => resolveUpstreamRoot({ upstreamPath: dir }) && readBoundedFile(dir, "skills/impeccable/SKILL.md", MAX_SKILL_FILE_BYTES),
        UpstreamResolveError,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("impeccable extension", () => {
  it("setup_without_upstream_registers_nothing", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw", secrets: [secretPath] });
    await assert.rejects(() => kernel.load([createImpeccableExtension({ upstreamPath: secretPath })]), UpstreamResolveError);
    assert.equal(kernel.registries.skills.list().length, 0);
    assert.equal(kernel.registries.commands.list().length, 0);
  });

  it("setup_registers_impeccable_skill_and_load_skill_command", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([createImpeccableExtension({ upstreamPath: fixtureRoot })]);
    const skills = kernel.registries.skills.list();
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, IMPECCABLE_SKILL_NAME);
    assert.equal(kernel.registries.commands.list().length, 1);
    const command = kernel.registries.commands.get(IMPECCABLE_SKILL_NAME);
    assert.ok(command);
    const result = await command.execute({}, { sessionId: "s1" });
    assert.deepEqual(result.value, { skill: IMPECCABLE_SKILL_NAME, dispatch: "load_skill" });
    assert.equal(result.metadata?.skill, IMPECCABLE_SKILL_NAME);
    assert.ok(!kernel.registries.commands.get("craft"));
    assert.ok(!kernel.registries.instructionInjectors.get("impeccable"));
  });
});
