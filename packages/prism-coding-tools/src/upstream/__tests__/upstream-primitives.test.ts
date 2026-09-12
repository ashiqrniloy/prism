/**
 * Contract of the shared persona-upstream primitives (plan 070 Task 6): bounded reads,
 * path redaction, the `skills/` marker, optional-peer root discovery, and the single
 * `UpstreamResolveError` class the three personas now share.
 *
 * Persona resolvers keep their own suites (`caveman/__tests__/upstream.test.ts`,
 * `ponytail/__tests__/upstream.test.ts`, `impeccable/__tests__/`); these cases cover the
 * shared module directly, including the peer-root fallback for peers that hide
 * `./package.json` in their `exports` map (the 4.9 ponytail defect).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { MAX_SKILL_FILE_BYTES as cavemanSkillCap, resolveUpstreamRoot as resolveCaveman } from "../../caveman/upstream.js";
import { redactPaths as impeccableRedactPaths, UpstreamResolveError as impeccableUpstreamResolveError } from "../../impeccable/upstream.js";
import {
  PONYTAIL_PEER_PACKAGE,
  MAX_SKILL_FILE_BYTES as ponytailSkillCap,
  resolveUpstreamRoot as resolvePonytail,
} from "../../ponytail/upstream.js";
import {
  assertSkillsMarker,
  MAX_SKILL_FILE_BYTES,
  readBoundedFile,
  redactPaths,
  resolvePeerPackageRoot,
  UpstreamResolveError,
} from "../index.js";

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "prism-upstream-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function isResolveError(error: unknown): boolean {
  return error instanceof UpstreamResolveError && error.code === "upstream_resolve_failed" && error.name === "UpstreamResolveError";
}

describe("shared upstream primitives", () => {
  it("readBoundedFile_reads_within_the_cap_and_rejects_oversize_or_escaping_paths", () => {
    withTempDir((root) => {
      writeFileSync(join(root, "SKILL.md"), "skill body");
      assert.equal(readBoundedFile(root, "SKILL.md", MAX_SKILL_FILE_BYTES), "skill body");
      assert.throws(() => readBoundedFile(root, "SKILL.md", 4), isResolveError);
      assert.throws(() => readBoundedFile(root, "../escape.md", MAX_SKILL_FILE_BYTES), isResolveError);
    });
  });

  it("redactPaths_replaces_the_given_paths_and_the_home_directory_and_truncates", () => {
    const secret = join(homedir(), "secret-upstream");
    const redacted = redactPaths(`failed at ${secret} under ${process.cwd()}`, [process.cwd()]);
    assert.equal(redacted.includes(secret), false);
    assert.equal(redacted.includes(process.cwd()), false);
    assert.ok(redacted.includes("<path>"));
    assert.ok(redacted.includes("~"));
    const long = redactPaths("x".repeat(1000));
    assert.ok(long.length <= 512);
    assert.ok(long.endsWith("…"));
  });

  it("assertSkillsMarker_fails_closed_without_a_readable_skills_directory", () => {
    withTempDir((root) => {
      assert.throws(() => assertSkillsMarker(root), isResolveError);
      mkdirSync(join(root, "skills"));
      assert.doesNotThrow(() => assertSkillsMarker(root));
    });
  });

  it("resolvePeerPackageRoot_finds_the_real_optional_peer_without_a_manifest_export", () => {
    const root = resolvePeerPackageRoot(PONYTAIL_PEER_PACKAGE);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string };
    assert.equal(manifest.name, PONYTAIL_PEER_PACKAGE);
    assert.ok(existsSync(join(root, "skills")), "peer root must expose the skills/ marker");
    assert.equal(resolvePonytail(), root, "the persona resolver uses the shared peer lookup");
  });

  it("resolvePeerPackageRoot_fails_closed_for_an_uninstalled_package", () => {
    assert.throws(() => resolvePeerPackageRoot("@arnilo/prism-fixture-missing-peer"), isResolveError);
  });

  it("one_error_class_and_one_constant_set_serve_all_three_personas", () => {
    assert.equal(UpstreamResolveError, impeccableUpstreamResolveError);
    assert.equal(redactPaths, impeccableRedactPaths, "public impeccable re-exports keep the shared identity");
    assert.equal(cavemanSkillCap, MAX_SKILL_FILE_BYTES);
    assert.equal(ponytailSkillCap, MAX_SKILL_FILE_BYTES);

    let cavemanError: unknown;
    try {
      resolveCaveman({ upstreamPath: import.meta.dirname });
    } catch (error) {
      cavemanError = error;
    }
    assert.ok(cavemanError instanceof impeccableUpstreamResolveError, "a caveman failure is catchable with the impeccable class");
  });
});
