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
  // Plan 152 Task 8: the retired provider family workspace is deleted, so it must not be counted.
  assert.equal(counts.has("prism-providers"), false);
  assert.equal(counts.has("anthropic"), true);
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

test("package_truth_counts_grouped_provider_workspaces", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-grouped-pkg-"));
  try {
    // The grouped layout `packages/providers/<vendor>/` (plan 152 Task 2): a
    // package one level under a non-package group directory is still a workspace.
    mkdirSync(join(root, "packages", "providers", "demo"), { recursive: true });
    writeFileSync(join(root, "packages", "providers", "demo", "package.json"), "{}");
    mkdirSync(join(root, "packages", "providers", "not-a-package"), { recursive: true });
    const counts = workspacePackageCounts(root);
    assert.equal(counts.has("demo"), true, "a grouped provider package is counted");
    assert.equal(counts.has("providers"), false, "the group directory itself is not a package");
    assert.equal(counts.has("not-a-package"), false, "a group child without a manifest is not a package");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
