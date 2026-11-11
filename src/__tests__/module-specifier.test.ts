import { describe, it, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  install,
  list,
  loadManifest,
  ManifestError,
  manifestSchemaDocument,
  parseManifest,
  readManifest,
  remove,
  scopeDirs,
  toPackageDefinition,
  verify,
  writeManifest,
} from "../manifest/index.js";
import * as integrity from "../manifest/integrity.js";
import { definePackage, MODULE_SPECIFIER, splitSpecifier } from "../packages/define.js";

const valid = ["a", "@a/b", "a/b", "@a/b/c/d", "a~b/c._~-1", "a".repeat(214)];
const invalid = ["", "@a", "@a/b/..", "@a/b/./c", "@a/b/", "a//b", "a/.x", "A", "a".repeat(215), "a\n", "https://a/b", "a/%2e%2e", "a/\\b"];
const tmp = () => mkdtemp(join(tmpdir(), "prism-specifier-"));
async function bundle(rootExport = false) {
  const dir = await tmp();
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@acme/bundle",
      version: "1.0.0",
      type: "module",
      exports: {
        ...(rootExport ? { ".": "./library.js" } : {}),
        "./one": "./one.js",
        "./nested/two": "./two.js",
        "./library": "./library.js",
      },
    }),
  );
  for (const [file, name] of [
    ["one", "one"],
    ["two", "nested/two"],
  ]) {
    await writeFile(
      join(dir, `${file}.js`),
      `export default {name: '@acme/bundle/${name}', version: '1.0.0', requires: {api: 1}, capabilities: [], setup() {}};`,
    );
  }
  await writeFile(join(dir, "library.js"), "globalThis.__prismUnlistedLibrary = true; export default 42;");
  return dir;
}
async function code(run: () => Promise<unknown>, expected: string) {
  await assert.rejects(run, (e: unknown) => e instanceof ManifestError && e.code === expected);
}

describe("module specifiers", () => {
  it("module_specifier_accepts_root_and_subpaths", () => {
    for (const name of valid) {
      assert.ok(MODULE_SPECIFIER.test(name), name);
      assert.equal(definePackage({ name, version: "1.0.0", setup() {} }).name, name);
    }
    assert.deepEqual(splitSpecifier("@a/b/c/d"), { root: "@a/b", subpath: "c/d" });
    assert.deepEqual(splitSpecifier("a/b"), { root: "a", subpath: "b" });
    assert.deepEqual(splitSpecifier("@a/b"), { root: "@a/b" });
  });
  it("module_specifier_rejects_dot_segments_and_trailing_slash", () => {
    for (const name of invalid) {
      assert.equal(MODULE_SPECIFIER.test(name), false, name);
      assert.throws(() => splitSpecifier(name));
      assert.throws(() => definePackage({ name, version: "1.0.0", setup() {} }));
    }
  });
  it("manifest_schema_json_name_pattern_matches_runtime_rule", async () => {
    const doc = manifestSchemaDocument() as any;
    const published = JSON.parse(await readFile("manifest/schema.json", "utf8"));
    for (const schema of [doc, published]) {
      const rule = new RegExp(schema.properties.packages.items.properties.name.pattern);
      for (const name of [...valid, ...invalid]) assert.equal(rule.test(name), MODULE_SPECIFIER.test(name), name);
    }
  });
  it("definition_name_must_equal_specifier", () => {
    assert.throws(
      () => toPackageDefinition({ name: "@acme/bundle", setup() {} }, { name: "@acme/bundle/one", scope: "project" }),
      /differs from the specifier it was installed as/,
    );
  });
  it("manifest_rejects_sibling_entries_with_different_versions", () => {
    const entry = { version: "^1.0.0", integrity: `sha512-${"A".repeat(86)}==`, capabilities: [] };
    assert.throws(
      () =>
        parseManifest(
          {
            version: 1,
            packages: [
              { ...entry, name: "@a/b/one" },
              { ...entry, name: "@a/b/two", version: "^2.0.0" },
            ],
          },
          { scope: "project", path: "test" },
        ),
      (e: unknown) => e instanceof ManifestError && e.code === "manifest_invalid",
    );
  });
  it("install_second_subpath_refreshes_sibling_integrity_and_remove_keeps_root", async () => {
    const root = await tmp();
    const source = await bundle();
    const log = join(root, "bun-calls");
    const bun = join(root, "bun-wrapper");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\nexec '${process.execPath}' "$@"\n`);
    await chmod(bun, 0o755);
    const options = { scope: "project" as const, root, packFrom: source, bun };
    const first = await install("@acme/bundle/one", options);
    assert.equal(first.name, "@acme/bundle/one");
    assert.equal((await readFile(log, "utf8")).split("\n").filter((x) => x === "add").length, 1);
    const dirs = scopeDirs(options);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(join(dirs.packagesDir, "package.json"), "utf8")).dependencies), [
      "@acme/bundle",
    ]);
    await writeFile(join(source, "package.json"), (await readFile(join(source, "package.json"), "utf8")).replace('"1.0.0"', '"2.0.0"'));
    await writeFile(
      join(source, "two.js"),
      "export default {name: '@acme/bundle/nested/two', version: '2.0.0', requires: {api: 1}, setup() {}};",
    );
    const second = await install("@acme/bundle/nested/two@^2.0.0", options);
    const manifest = (await readManifest(dirs))!;
    assert.notEqual(second.integrity, first.integrity);
    assert.equal(manifest.packages[0]!.integrity, second.integrity);
    assert.equal(manifest.packages[0]!.version, second.version);
    assert.equal(second.version, "^2.0.0");
    assert.ok((await verify({ root, trustProject: () => true })).every((x) => x.ok));
    assert.deepEqual(
      (await list({ root })).packages.map((x) => x.name),
      [first.name, second.name],
    );
    const spy = spyOn(integrity, "hashPackageClosure");
    try {
      assert.equal((await loadManifest({ root, trustProject: () => true })).length, 2);
      assert.equal(spy.mock.calls.length, 1, "one hash for both subpaths");
    } finally {
      spy.mockRestore();
    }
    await writeManifest(dirs, {
      ...manifest,
      packages: manifest.packages.map((e) =>
        e.version !== undefined && e.name === second.name ? { ...e, capabilities: ["host-ui"] as const } : e,
      ),
    });
    await assert.rejects(
      () => loadManifest({ root, trustProject: () => true }),
      (e: unknown) => e instanceof ManifestError && e.code === "capabilities_drift" && e.package === second.name,
    );
    const drift = await verify({ root, trustProject: () => true });
    assert.equal(drift[0]!.ok, true);
    assert.equal(drift[1]!.issues[0]!.code, "capabilities_drift");
    await writeManifest(dirs, {
      ...manifest,
      packages: manifest.packages.map((e) =>
        e.version !== undefined && e.name === second.name ? { ...e, integrity: first.integrity } : e,
      ),
    });
    await assert.rejects(
      () => loadManifest({ root, trustProject: () => true }),
      (e: unknown) => e instanceof ManifestError && e.code === "integrity_mismatch" && e.package === second.name,
    );
    await writeManifest(dirs, { ...manifest, slots: { store: first.name } });
    await remove(first.name, options);
    assert.equal((await readManifest(dirs))!.slots, undefined);
    await lstat(integrity.installedPackageDir(dirs.packagesDir, second.name));
    await remove(second.name, options);
    await assert.rejects(lstat(integrity.installedPackageDir(dirs.packagesDir, second.name)));
  });
  for (const rootExport of [false, true])
    it(`install_bundle_root_lists_subpaths_${rootExport}`, async () => {
      const root = await tmp();
      const source = await bundle(rootExport);
      delete (globalThis as any).__prismUnlistedLibrary;
      await assert.rejects(
        () => install("@acme/bundle", { root, scope: "project", packFrom: source }),
        (e: unknown) => e instanceof ManifestError && e.code === "not_a_package" && e.message.includes("@acme/bundle/one"),
      );
      if (!rootExport) assert.equal((globalThis as any).__prismUnlistedLibrary, undefined);
      await assert.rejects(lstat(scopeDirs({ root, scope: "project" }).manifestPath));
    });
  it("install_unexported_subpath_rolls_back_upgrade", async () => {
    const root = await tmp();
    const source = await bundle();
    const options = { root, scope: "project" as const, packFrom: source };
    const first = await install("@acme/bundle/one", options);
    const managed = join(scopeDirs(options).packagesDir, "package.json");
    const before = await readFile(managed, "utf8");
    const lock = await readFile(join(scopeDirs(options).packagesDir, "bun.lock"), "utf8");
    await writeFile(join(source, "extra.txt"), "new bytes");
    const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    metadata.exports["./blocked"] = { require: null, default: "./one.js" };
    await writeFile(join(source, "package.json"), JSON.stringify(metadata));
    for (const name of ["@acme/bundle/private", "@acme/bundle/one.js", "@acme/bundle/blocked"])
      await code(() => install(name, options), "import_failed");
    assert.equal(await readFile(managed, "utf8"), before);
    assert.equal(await readFile(join(scopeDirs(options).packagesDir, "bun.lock"), "utf8"), lock);
    await integrity.verifyInstalled(first, scopeDirs(options).packagesDir, "project");
    assert.equal((await readManifest(scopeDirs(options)))!.packages.length, 1);
  });
  it("exports_patterns_and_conditions_resolve_without_loading_siblings", async () => {
    const root = await tmp();
    const source = await bundle();
    const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    metadata.exports["./wild/*"] = "./wild-*.js";
    metadata.exports["./conditional"] = { require: { unknown: "./private.js" }, default: "./conditional.js" };
    for (const name of ["wild/one", "conditional"]) {
      const file = name.replace("/", "-");
      await writeFile(join(source, `${file}.js`), `export default {name: '@acme/bundle/${name}', version: '1.0.0', setup() {}};`);
    }
    await writeFile(join(source, "package.json"), JSON.stringify(metadata));
    delete (globalThis as any).__prismUnlistedLibrary;
    for (const name of ["wild/one", "conditional"]) await install(`@acme/bundle/${name}`, { root, scope: "project", packFrom: source });
    assert.equal((globalThis as any).__prismUnlistedLibrary, undefined);
  });
  it("registry_subpath_passes_only_root_and_range_to_bun_add", async () => {
    const root = await tmp();
    const source = await bundle();
    await install("@acme/bundle/one", { root, scope: "project", packFrom: source });
    const tarballs = join(scopeDirs({ root, scope: "project" }).packagesDir, ".tarballs");
    const packed = join(tarballs, (await readdir(tarballs))[0]!);
    const log = join(root, "registry-args");
    const bun = join(root, "registry-bun");
    await writeFile(
      bun,
      `#!/bin/sh\nif [ "$1" = add ]; then\n  printf '%s\\n' "$@" > '${log}'\n  exec '${process.execPath}' add --ignore-scripts 'file:${packed}'\nfi\nexec '${process.execPath}' "$@"\n`,
    );
    await chmod(bun, 0o755);
    const entry = await install("@acme/bundle/nested/two@latest", { root, scope: "project", bun });
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
      "add",
      "--ignore-scripts",
      "--backend=copyfile",
      "@acme/bundle@latest",
    ]);
    assert.equal(entry.name, "@acme/bundle/nested/two");
    assert.equal(entry.version, "^1.0.0");
  });
  it("optional_missing_root_yields_one_stub_per_specifier", async () => {
    const root = await tmp();
    const source = await bundle();
    const options = { root, scope: "project" as const, packFrom: source };
    await install("@acme/bundle/one", options);
    await install("@acme/bundle/nested/two", options);
    const dirs = scopeDirs(options);
    const manifest = (await readManifest(dirs))!;
    await writeManifest(dirs, { ...manifest, packages: manifest.packages.map((e) => ({ ...e, optional: true })) });
    await rm(integrity.installedPackageDir(dirs.packagesDir, "@acme/bundle"), { recursive: true });
    assert.equal((await loadManifest({ root, trustProject: () => true })).length, 2);
  });
});
