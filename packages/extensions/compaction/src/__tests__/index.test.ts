import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import manifest from "../../../package.json" with { type: "json" };
import definition from "../index.js";

test("memory_compaction_package_entrypoint_is_a_definePackage_definition", () => {
  assert.equal(definition.name, "@arnilo/prism-extensions/compaction");
  assert.equal(definition.version, manifest.version);
  assert.equal(definition.requires?.api, 1, "declares the kernel API level it needs");
  assert.deepEqual([...(definition.capabilities ?? [])], ["models", "slot:compaction"]);
  assert.equal(definition.config?.type, "object");
  assert.equal(typeof definition.setup, "function");
  assert.equal(typeof definition, "function", "callable: the definition returns a PackageInstance");
});

test("memory_compaction_live_tests_are_skipped_by_default", async () => {
  const source = await readFile(new URL("./live.test.ts", import.meta.url), "utf8");
  assert.match(source, /PRISM_LIVE_COMPACTION_TESTS/);
  assert.match(source, /skipIf/);
});

test("memory_compaction_manifest_points_at_the_source_entry", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./compaction"], "./compaction/src/index.ts");
  assert.equal(pkg.dependencies, undefined, "no runtime dependencies");
  assert.equal(pkg.peerDependencies["@arnilo/prism"], ">=0.13.0 <1.0.0");
});
