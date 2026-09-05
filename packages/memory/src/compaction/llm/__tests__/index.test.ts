import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { packageName } from "../index.js";

test("compaction_llm_package_entrypoint_exists", () => {
  assert.equal(packageName, "@arnilo/prism-memory/compaction/llm");
});

test("compaction_llm_live_tests_are_skipped_by_default", async () => {
  // ponytail: reads the TypeScript source from the repo checkout (dist sits beside src)
  const source = await readFile(new URL("../../../../src/compaction/llm/__tests__/live.test.ts", import.meta.url), "utf8");
  assert.match(source, /PRISM_LIVE_COMPACTION_TESTS/);
  assert.match(source, /skip:/);
});

test("compaction_llm_subpath_ships_from_the_memory_family_manifest", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.exports["./compaction/llm"], "family manifest must expose ./compaction/llm");
  assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
  assert.equal(pkg.scripts.postinstall, undefined);
});
