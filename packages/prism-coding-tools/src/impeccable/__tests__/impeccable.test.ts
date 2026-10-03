import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createAgent } from "@arnilo/prism";

import { impeccable } from "../extension.js";
import { IMPECCABLE_SKILL_NAME } from "../skills.js";
import { MAX_SKILL_FILE_BYTES, readBoundedFile, resolveUpstreamRoot, UpstreamResolveError } from "../upstream.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/impeccable/upstream-minimal");
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

describe("impeccable package", () => {
  it("setup_without_upstream_registers_nothing", async () => {
    await assert.rejects(
      () => createAgent({ model: { provider: "mock", model: "impeccable" }, packages: [impeccable({ upstreamPath: secretPath })] }),
      (error: unknown) => error instanceof Error && !error.message.includes(secretPath) && !error.message.includes(homedir()),
    );
  });

  it("setup_registers_impeccable_skill_and_load_skill_command", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "impeccable" },
      packages: [impeccable({ upstreamPath: fixtureRoot })],
    });
    try {
      const inspected = agent.inspect();
      assert.equal(inspected.skills.length, 1);
      assert.equal(inspected.skills[0]?.name, IMPECCABLE_SKILL_NAME);
      assert.equal(inspected.commands.length, 1);
      const result = (await agent.commands.run(IMPECCABLE_SKILL_NAME, {})) as { value: unknown; metadata?: { skill?: string } };
      assert.deepEqual(result.value, { skill: IMPECCABLE_SKILL_NAME, dispatch: "load_skill" });
      assert.equal(result.metadata?.skill, IMPECCABLE_SKILL_NAME);
      assert.equal(
        inspected.commands.some((command) => command.name === "craft"),
        false,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("setup_accepts_a_matching_snapshot_digest_pin", async () => {
    const expected = createHash("sha256")
      .update(readFileSync(join(fixtureRoot, "skills/impeccable/SKILL.md"), "utf8"), "utf8")
      .digest("hex");
    const agent = await createAgent({
      model: { provider: "mock", model: "impeccable" },
      packages: [impeccable({ upstreamPath: fixtureRoot, expectedSnapshotDigest: expected })],
    });
    try {
      assert.equal(agent.inspect().skills[0]?.name, IMPECCABLE_SKILL_NAME);
    } finally {
      await agent.dispose();
    }
  });

  it("setup_fails_closed_on_snapshot_digest_drift", async () => {
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "mock", model: "impeccable" },
          packages: [impeccable({ upstreamPath: fixtureRoot, expectedSnapshotDigest: "0".repeat(64) })],
        }),
      /Expected upstream impeccable SKILL.md to match recorded snapshot digest/,
    );
  });
});
