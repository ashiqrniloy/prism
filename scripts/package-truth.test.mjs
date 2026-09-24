import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspacePackageCounts } from "./package-truth.mjs";

test("workspacePackageCounts matches the live 11 workspace packages", () => {
  const counts = workspacePackageCounts();
  assert.equal(counts.size, 11);
  assert.equal(counts.has("prism-coding-tools"), true);
  assert.equal(counts.has("prism-core"), true);
  assert.equal(counts.has("prism-work"), true);
  assert.equal(counts.has("prism-providers"), true);
});

test("a 12th throwaway package is counted, not excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-pkg-"));
  try {
    for (const name of workspacePackageCounts()) {
      mkdirSync(join(root, "packages", name), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), "{}");
    }
    mkdirSync(join(root, "packages", "not-a-package"), { recursive: true });
    mkdirSync(join(root, "packages", "extra-widget"), { recursive: true });
    writeFileSync(join(root, "packages", "extra-widget", "package.json"), "{}");
    const counts = workspacePackageCounts(root);
    assert.equal(counts.size, 12);
    assert.equal(counts.has("extra-widget"), true);
    assert.equal(counts.has("not-a-package"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
