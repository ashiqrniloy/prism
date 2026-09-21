/**
 * Contract of the shared persona-upstream primitives (plan 070 Task 6): bounded reads,
 * path redaction, and the single `UpstreamResolveError` class the personas share.
 *
 * Caveman and Ponytail were removed (plan 107 Task 2); the surviving heavyweight
 * persona suite is `impeccable/__tests__/`. These cases cover the shared module directly.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { redactPaths as impeccableRedactPaths, UpstreamResolveError as impeccableUpstreamResolveError } from "../../impeccable/upstream.js";
import { MAX_SKILL_FILE_BYTES, readBoundedFile, redactPaths, UpstreamResolveError } from "../index.js";

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

  it("one_error_class_and_one_constant_set_serve_the_surviving_personas", () => {
    assert.equal(UpstreamResolveError, impeccableUpstreamResolveError);
    assert.equal(redactPaths, impeccableRedactPaths, "public impeccable re-exports keep the shared identity");
    assert.equal(MAX_SKILL_FILE_BYTES, 262_144);
  });
});
