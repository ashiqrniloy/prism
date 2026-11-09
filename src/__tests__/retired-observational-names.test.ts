/**
 * Plan 216 Task 4: `@arnilo/prism-memory-observational` moved into `@arnilo/prism-memory-system` with no alias, and
 * its commands, event, config and record types took the memory model's component names. A manifest or host config
 * that still names the old package fails closed with the loader's existing code, which names the package (Task 1
 * finding F1). The migration page carries the successor, and no live code names the old surface.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importDefinition } from "../manifest/definition.js";
import { ManifestError } from "../manifest/errors.js";

const RETIRED = "@arnilo/prism-memory-observational";
const SUCCESSOR = "@arnilo/prism-memory-system";

describe("retired observational package name (plan 216 Task 4)", () => {
  it("old_observational_name_absent_and_manifest_entry_fails_closed_naming_it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-retired-observational-"));
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

    const migration = readFileSync("docs/migrate-to-0.13.md", "utf8");
    assert.ok(
      migration.split("\n").some((line) => line.includes(RETIRED) && line.includes(SUCCESSOR)),
      `docs/migrate-to-0.13.md maps ${RETIRED} to ${SUCCESSOR}`,
    );
    for (const file of ["package.json", "scripts/independent-packages.json", "scripts/package-truth.json", "bun.lock", "packages/memory/system/package.json"]) {
      assert.equal(readFileSync(file, "utf8").includes(`"${RETIRED}"`), false, `${file} still names ${RETIRED}`);
    }
  });

  it("observational_names_absent_repo_wide", () => {
    // The old package name, its commands, event and rendered heading, in live code and docs. The migration page,
    // CHANGELOGs, plans, history and evidence keep them; so do this test, the retired-name lists, the system
    // package's own migration error and README migration lines, and the compat baselines of retired 0.12 names.
    const patterns = [RETIRED, 'run("om"', '"om:model"', '"om:status"', '"om:view"', '"om.status"', "om.observe\"", "# Observational Memory"];
    const allowed = [
      /^docs\/(history|_evidence)\//,
      /^docs\/migrate-to-0\.(7|9|13)\.md$/,
      /^plans\//,
      /CHANGELOG\.md$/,
      /^scripts\/compat-baseline\/arnilo__prism-(memory|compaction-observational-memory)\.txt$/,
      /^src\/__tests__\/(docs|retired-observational-names)\.test\.ts$/,
      /^packages\/memory\/system\/src\/session\/types\.ts$/,
      /^packages\/memory\/system\/README\.md$/,
      /^scripts\/memory-bench\/(cleanup-criteria|memory-model-criteria)\.json$/,
    ];
    const hits: string[] = [];
    for (const pattern of patterns) {
      const result = spawnSync("git", ["grep", "-l", "-F", pattern, "--", "src", "packages", "apps", "scripts", "examples", "templates", "docs", "README.md", "PRODUCT.md"], {
        encoding: "utf8",
      });
      for (const file of result.stdout.split("\n").filter(Boolean)) {
        if (!allowed.some((rule) => rule.test(file))) hits.push(`${file}: ${pattern}`);
      }
    }
    assert.deepEqual(hits, []);
  });
});
