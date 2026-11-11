/**
 * Plan 216 Task 5: `@arnilo/prism-memory-fabric` moved into `@arnilo/prism-memory-system` as its `ltm` component with no
 * alias: `memoryFabric(config)` is `memorySystem({ ltm: config })` and `createMemoryFabric` is `createLongTermMemory`. A
 * manifest or host config that still names the old package fails closed with the loader's existing code, which names
 * the package (Task 1 finding F1). The migration page carries the successor, and no live code names the old surface.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importDefinition } from "../manifest/definition.js";
import { ManifestError } from "../manifest/errors.js";

const RETIRED = "@arnilo/prism-memory-fabric";
const SUCCESSOR = "@arnilo/prism-memory-system";

describe("retired fabric package name (plan 216 Task 5)", () => {
  it("old_fabric_name_absent_and_manifest_entry_fails_closed_naming_it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-retired-fabric-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "managed-packages", private: true }));
      await assert.rejects(importDefinition(dir, { name: RETIRED, integrity: `sha256-${"0".repeat(44)}` }, "project"), (error: unknown) => {
        assert.ok(error instanceof ManifestError);
        assert.equal(error.code, "import_failed");
        assert.equal(error.package, RETIRED);
        assert.ok(error.message.includes(RETIRED), "the error names the package");
        return true;
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(existsSync("packages/memory/fabric"), false, "the fabric workspace is gone");
    const migration = readFileSync("docs/migrate-to-0.13.md", "utf8");
    assert.ok(
      migration.split("\n").some((line) => line.includes(RETIRED) && line.includes(SUCCESSOR)),
      `docs/migrate-to-0.13.md maps ${RETIRED} to ${SUCCESSOR}`,
    );
    for (const name of ["memoryFabric", "createMemoryFabric", "createLongTermMemory"]) {
      assert.ok(migration.includes(name), `docs/migrate-to-0.13.md names ${name}`);
    }
    for (const file of [
      "package.json",
      "scripts/independent-packages.json",
      "scripts/package-truth.json",
      "bun.lock",
      "packages/memory/package.json",
    ]) {
      assert.equal(readFileSync(file, "utf8").includes(`"${RETIRED}"`), false, `${file} still names ${RETIRED}`);
    }
  });

  it("fabric_names_absent_repo_wide", () => {
    // The old package name, its factory and SDK constructor, and the old ontology service, in live code and docs. The
    // migration pages, CHANGELOGs, plans, history and evidence keep them; so do this test, the retired-name lists, the
    // frozen 0.12 compat baseline, the dated rationale notes, the LTM port's negative guard, the system README's migration lines, and the closed plan 202
    // Task 5 tooling and frozen criteria that fingerprint the fabric at historical revisions.
    const patterns = [RETIRED, "memoryFabric(", "createMemoryFabric", 'memory.fabric"'];
    const allowed = [
      /^docs\/(history|_evidence)\//,
      /^docs\/migrate-to-0\.(7|9|13)\.md$/,
      /^plans\//,
      /CHANGELOG\.md$/,
      /^scripts\/compat-baseline\/arnilo__prism-memory\.txt$/,
      /^scripts\/(budgets|coverage-thresholds|independent-packages|retired-names)\.json$/, // dated rationale notes
      /^packages\/memory\/system\/src\/ltm\/__tests__\/ltm-port\.test\.ts$/, // asserts the old service stays retired
      /^scripts\/memory-bench\/(task5-[a-z-]+\.mjs|cleanup-criteria\.json)$/,
      /^packages\/memory\/system\/README\.md$/,
      /^src\/__tests__\/(docs|retired-fabric-names)\.test\.ts$/,
    ];
    const hits: string[] = [];
    for (const pattern of patterns) {
      const result = spawnSync(
        "git",
        [
          "grep",
          "-l",
          "-F",
          pattern,
          "--",
          "src",
          "packages",
          "apps",
          "scripts",
          "examples",
          "templates",
          "docs",
          "README.md",
          "PRODUCT.md",
        ],
        {
          encoding: "utf8",
        },
      );
      for (const file of result.stdout.split("\n").filter(Boolean)) {
        if (!allowed.some((rule) => rule.test(file))) hits.push(`${file}: ${pattern}`);
      }
    }
    assert.deepEqual(hits, []);
  });
});
