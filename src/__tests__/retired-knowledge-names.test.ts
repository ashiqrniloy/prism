/**
 * Plan 216 Task 3: `@arnilo/prism-memory-wiki` and `@arnilo/prism-memory-rag` were renamed `@arnilo/prism-knowledge/wiki` and
 * `@arnilo/prism-knowledge/rag` with no alias. A manifest or host config that still names an old package fails closed with the
 * loader's existing code, which names the package; there is no `package_renamed` code (the kernel names no package).
 * The migration page carries the successor.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importDefinition } from "../manifest/definition.js";
import { ManifestError } from "../manifest/errors.js";

const RETIRED = ["@arnilo/prism-memory-wiki", "@arnilo/prism-memory-rag"] as const;
const SUCCESSOR: Record<(typeof RETIRED)[number], string> = {
  "@arnilo/prism-memory-wiki": "@arnilo/prism-knowledge/wiki",
  "@arnilo/prism-memory-rag": "@arnilo/prism-knowledge/rag",
};

describe("retired knowledge package names (plan 216 Task 3)", () => {
  it("old_wiki_and_rag_names_absent_and_manifest_entry_fails_closed_naming_them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-retired-knowledge-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "managed-packages", private: true }));
      for (const name of RETIRED) {
        await assert.rejects(importDefinition(dir, { name, integrity: `sha256-${"0".repeat(44)}` }, "project"), (error: unknown) => {
          assert.ok(error instanceof ManifestError);
          assert.equal(error.code, "import_failed");
          assert.equal(error.package, name);
          assert.ok(error.message.includes(name), "the error names the package");
          return true;
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const migration = readFileSync("docs/migrate-to-0.13.md", "utf8");
    for (const name of RETIRED) {
      assert.ok(
        migration.split("\n").some((line) => line.includes(name) && line.includes(SUCCESSOR[name])),
        `docs/migrate-to-0.13.md maps ${name} to ${SUCCESSOR[name]}`,
      );
    }
    // No workspace, release list or lockfile names the old packages.
    const lists = [
      "package.json",
      "scripts/independent-packages.json",
      "scripts/package-truth.json",
      "bun.lock",
      "packages/knowledge/package.json",
      "packages/knowledge/package.json",
    ];
    for (const file of lists) {
      const text = readFileSync(file, "utf8");
      for (const name of RETIRED) assert.equal(text.includes(`"${name}"`), false, `${file} still names ${name}`);
    }
  });
});
