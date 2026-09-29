import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { computePackageTruth, workspacePackageCounts } from "./package-truth.mjs";

test("workspacePackageCounts matches the live workspace manifests", () => {
  const counts = workspacePackageCounts();
  assert.equal(counts.size, computePackageTruth().counts.workspace);
  assert.equal(counts.has("prism-coding-tools"), true);
  assert.equal(counts.has("prism-core"), true);
  assert.equal(counts.has("prism-work"), true);
  assert.equal(counts.has("prism-providers"), true);
});

test("a throwaway package is counted, not excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-pkg-"));
  try {
    const live = workspacePackageCounts();
    for (const name of live) {
      mkdirSync(join(root, "packages", name), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), "{}");
    }
    mkdirSync(join(root, "packages", "not-a-package"), { recursive: true });
    mkdirSync(join(root, "packages", "extra-widget"), { recursive: true });
    writeFileSync(join(root, "packages", "extra-widget", "package.json"), "{}");
    const counts = workspacePackageCounts(root);
    assert.equal(counts.size, live.size + 1);
    assert.equal(counts.has("extra-widget"), true);
    assert.equal(counts.has("not-a-package"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
