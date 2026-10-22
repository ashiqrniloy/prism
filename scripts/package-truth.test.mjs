import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { computePackageTruth, workspacePackageCounts } from "./package-truth.mjs";

test("workspacePackageCounts matches the live workspace manifests", () => {
  const counts = workspacePackageCounts();
  assert.equal(counts.size, computePackageTruth().counts.workspace);
  assert.equal(counts.has("prism-" + "coding-tools"), false, "the retired coding-tools workspace must not be counted");
  assert.equal(counts.has("work"), true);
  // Plan 152 Task 8: the retired provider family workspace is deleted, so it must not be counted.
  assert.equal(counts.has("prism-providers"), false);
  assert.equal(counts.has("anthropic"), false);
  assert.equal(counts.has("hyper"), true);
  // Plan 158 Task 6: the memory family workspace is deleted too; its six packages are the workspaces.
  assert.equal(counts.has("memory"), false);
  for (const name of ["core", "compaction", "observational", "rag", "fabric", "wiki"]) {
    assert.equal(counts.has(name), true, `packages/memory/${name} must be a workspace`);
  }
});

test("a throwaway package is counted, not excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-pkg-"));
  try {
    const live = workspacePackageCounts();
    for (const name of live) {
      mkdirSync(join(root, "packages", name), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }));
    }
    mkdirSync(join(root, "packages", "not-a-package"), { recursive: true });
    mkdirSync(join(root, "packages", "extra-widget"), { recursive: true });
    writeFileSync(join(root, "packages", "extra-widget", "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }));
    const counts = workspacePackageCounts(root);
    assert.equal(counts.size, live.size + 1);
    assert.equal(counts.has("extra-widget"), true);
    assert.equal(counts.has("not-a-package"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package_truth_counts_memory_group", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-memory-group-pkg-"));
  try {
    // Plan 158 Task 6: `packages/memory` is now a pure group directory. The six
    // package dirs are workspaces, the group dir itself is not, and a group child
    // without a manifest is not counted.
    for (const name of ["core", "compaction", "observational", "rag", "fabric", "wiki"]) {
      mkdirSync(join(root, "packages", "memory", name), { recursive: true });
      writeFileSync(join(root, "packages", "memory", name, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }));
    }
    mkdirSync(join(root, "packages", "memory", "not-a-package"), { recursive: true });
    const counts = workspacePackageCounts(root);
    for (const name of ["core", "compaction", "observational", "rag", "fabric", "wiki"]) {
      assert.equal(counts.has(name), true, `packages/memory/${name} is counted`);
    }
    assert.equal(counts.has("memory"), false, "the group directory itself is not a package");
    assert.equal(counts.has("not-a-package"), false, "a group child without a manifest is not a package");
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
    writeFileSync(join(root, "packages", "providers", "demo", "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }));
    mkdirSync(join(root, "packages", "providers", "not-a-package"), { recursive: true });
    const counts = workspacePackageCounts(root);
    assert.equal(counts.has("demo"), true, "a grouped provider package is counted");
    assert.equal(counts.has("providers"), false, "the group directory itself is not a package");
    assert.equal(counts.has("not-a-package"), false, "a group child without a manifest is not a package");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
