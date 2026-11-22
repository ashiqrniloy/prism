import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRelease, publishArgs } from "./release.mjs";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";

const memory = "@arnilo/prism-memory-system";
const knowledge = "@arnilo/prism-knowledge";

test("experimental_bundles_are_exactly_knowledge", () => {
  // Plan 240 Task 7 (owner D1): the memory-system bundle left the experimental line at 0.14.0.
  const release = loadRelease();
  assert.deepEqual(
    release.packages.filter((pkg) => pkg.experimental).map((pkg) => pkg.manifest.name),
    [knowledge],
  );
  const pkg = release.byName.get(knowledge);
  assert.match(pkg.manifest.version, /^\d+\.\d+\.\d+-experimental\.\d+$/);
  const args = publishArgs(pkg, pkg.manifest.version);
  assert.equal(args[args.indexOf("--tag") + 1], "experimental");
});

test("memory_system_is_on_the_stable_line", () => {
  const release = loadRelease();
  const pkg = release.byName.get(memory);
  assert.equal(pkg.experimental, false);
  assert.match(pkg.manifest.version, /^\d+\.\d+\.\d+$/);
  const args = publishArgs(pkg, pkg.manifest.version);
  assert.equal(args[args.indexOf("--tag") + 1], "latest");
});

test("knowledge_depends_on_a_memory_range", () => {
  const release = loadRelease();
  const manifest = release.byName.get(knowledge)?.manifest;
  assert.equal(manifest?.dependencies[memory], `^${release.byName.get(memory).manifest.version}`);
  assert.equal(manifest?.peerDependenciesMeta["@arnilo/prism-tools"].optional, true);
  assert.equal(release.byName.get(memory).manifest.dependencies?.[knowledge], undefined);
});

test("packed_experimental_bundles_resolve_and_wiki_loads_no_web_ingestion", () => {
  const fixture = createPackedConsumer([{ dir: "packages/knowledge", name: knowledge }]);
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    writeFileSync(
      join(fixture.consumer, "probe.ts"),
      `
      import assert from "node:assert/strict";
      import wiki from "${knowledge}/wiki";
      assert.equal(wiki.name, "${knowledge}/wiki");
      const loaded = Object.keys(require.cache);
      assert.ok(loaded.some((path) => path.includes("/wiki/src/index.ts")));
      assert.deepEqual(loaded.filter((path) => /\\/(?:rag\\/src\\/web|tools\\/web\\/|playwright)/.test(path)), []);
      for (const specifier of ["${memory}", "${memory}/core", "${memory}/core/fabric", "${memory}/core/sqlite", "${memory}/core/postgres", "${knowledge}/rag"]) {
        await import(specifier);
      }
    `,
    );
    const probe = spawnSync("bun", ["probe.ts"], { cwd: fixture.consumer, encoding: "utf8", timeout: 30_000 });
    assert.equal(probe.status, 0, probe.stderr);
    const release = loadRelease();
    for (const name of [memory, knowledge]) {
      const manifest = JSON.parse(readFileSync(join(fixture.consumer, "node_modules", name, "package.json"), "utf8"));
      assert.equal(manifest.version, release.byName.get(name).manifest.version);
    }
  } finally {
    fixture.cleanup();
  }
});
