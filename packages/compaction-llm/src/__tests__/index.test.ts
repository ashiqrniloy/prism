import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { packageName } from "../index.js";

test("compaction_llm_package_entrypoint_exists", () => {
  assert.equal(packageName, "@arnilo/prism-compaction-llm");
});

test("compaction_llm_live_tests_are_skipped_by_default", async () => {
  const source = await readFile(new URL("../../src/__tests__/live.test.ts", import.meta.url), "utf8");
  assert.match(source, /PRISM_LIVE_COMPACTION_TESTS/);
  assert.match(source, /skip:/);
});

test("compaction_llm_package_metadata_is_minimal", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.files, ["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]);
  assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.96");
  assert.deepEqual(pkg.devDependencies, { "@arnilo/prism": "file:../.." });
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
});
