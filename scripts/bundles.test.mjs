import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBundles } from "./bundles.mjs";
import { loadRelease } from "./release.mjs";
import { generate } from "./retired-names.mjs";

const root = process.cwd();
const { bundles } = JSON.parse(readFileSync("scripts/bundles.json", "utf8"));
const active = bundles.filter((bundle) => existsSync(join(bundle.dir, "package.json")));

test("bundle gate rejects name, export, files and source-folder drift", () => {
  for (const change of [
    (manifest) => {
      manifest.name = "wrong-name";
    },
    (manifest) => {
      delete manifest.exports["./hyper"];
    },
    (manifest) => {
      manifest.files = [];
    },
    (_manifest, fixture) => {
      mkdirSync(join(fixture, "packages/providers/extra/src"), { recursive: true });
      writeFileSync(join(fixture, "packages/providers/extra/src/index.ts"), "");
    },
  ]) {
    const fixture = mkdtempSync(join(tmpdir(), "prism-bundle-"));
    try {
      mkdirSync(join(fixture, "scripts"));
      mkdirSync(join(fixture, "packages/providers/hyper/src"), { recursive: true });
      writeFileSync(join(fixture, "packages/providers/hyper/src/index.ts"), "");
      writeFileSync(
        join(fixture, "scripts/bundles.json"),
        JSON.stringify({ bundles: [{ ...bundles[0], subpaths: [bundles[0].subpaths.find((row) => row.path === "./hyper")] }] }),
      );
      const manifest = { name: bundles[0].name, exports: { "./hyper": "./hyper/src/index.ts" }, files: ["hyper/src"] };
      const file = join(fixture, "packages/providers/package.json");
      writeFileSync(file, JSON.stringify(manifest));
      assert.doesNotThrow(() => validateBundles(fixture));
      change(manifest, fixture);
      writeFileSync(file, JSON.stringify(manifest));
      assert.throws(() => validateBundles(fixture), /name must be|exports disagree|files must ship|source folders disagree/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test("load_release_treats_bundle_dir_as_one_unit", () => {
  assert.ok(active.some((bundle) => bundle.name === "@arnilo/prism-ai"));
  const release = loadRelease(root);
  for (const bundle of active) {
    assert.deepEqual(
      release.packages.filter((pkg) => pkg.path.startsWith(`${bundle.dir}/`)),
      [],
    );
    assert.equal(release.byName.get(bundle.name)?.path, bundle.dir);
  }
});

test("bundle_map_covers_every_workspace_subpath", () => {
  for (const bundle of active) {
    const folders = readdirSync(bundle.dir).filter((dir) => existsSync(join(bundle.dir, dir, "src/index.ts")));
    assert.deepEqual([...new Set(bundle.subpaths.map((row) => row.dir))].sort(), folders.sort());
  }
});

test("bundle_exports_match_map and bundle_files_ship_every_subpath_asset", () => {
  for (const bundle of active) {
    const manifest = JSON.parse(readFileSync(join(bundle.dir, "package.json"), "utf8"));
    assert.equal(manifest.name, bundle.name);
    assert.deepEqual(Object.keys(manifest.exports).sort(), bundle.subpaths.map((row) => row.path).sort());
    for (const row of bundle.subpaths) {
      assert.ok(existsSync(join(bundle.dir, manifest.exports[row.path])));
      for (const asset of [
        "src",
        "README.md",
        "skills",
        "data",
        "bin",
        "vendor",
        "docling",
        "sandbox",
        "vendor-lock.json",
        "THIRD_PARTY_NOTICES",
      ]) {
        if (existsSync(join(bundle.dir, row.dir, asset)))
          assert.ok(manifest.files.includes(`${row.dir}/${asset}`), `${bundle.name}: ${row.dir}/${asset}`);
      }
    }
  }
});

test("package_definition_name_equals_specifier", async () => {
  for (const bundle of active) {
    for (const row of bundle.subpaths.filter((row) => row.kind === "package")) {
      const specifier = bundle.name + (row.path === "." ? "" : row.path.slice(1));
      const { default: definition } = await import(specifier);
      assert.equal(definition.name, specifier);
    }
  }
});

test("former_names_are_retired_once_bundled and deleted_baseline_name_stays_retired", () => {
  const generated = generate({ root });
  for (const bundle of active) {
    for (const row of bundle.subpaths.filter(
      (row, index) => row.formerName !== bundle.name && bundle.subpaths.findIndex((entry) => entry.formerName === row.formerName) === index,
    )) {
      assert.ok(generated.packages.includes(row.formerName));
      assert.equal(generated.successors[row.formerName], bundle.name + (row.path === "." ? "" : row.path.slice(1)));
    }
  }
});

test("provider_subpath_import_loads_no_sibling", () => {
  const result = spawnSync(
    "bun",
    ["-e", 'await import("@arnilo/prism-ai/hyper"); console.log(JSON.stringify(Object.keys(require.cache)))'],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout).filter((path) => path.includes("/packages/providers/"));
  assert.ok(
    loaded.some((path) => path.includes("/hyper/src/index.ts")),
    "probe must observe the imported provider",
  );
  assert.deepEqual(
    loaded.filter((path) => !path.includes("/hyper/")),
    [],
  );
});
