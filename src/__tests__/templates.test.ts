import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The template catalog ships in the kernel tarball (`package.json` `files`), so a template that names a
 * retired package or a package that does not exist is a shipped defect. `templates_load` reads every
 * catalog manifest and checks its `packages` against the live workspace set.
 *
 * `loadManifest` does not apply: it loads *installed* packages from a `.prism/` store, while a catalog
 * manifest is `{ name, description, version, tags, packages }` and is not installed by any 0.13 command.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Catalog keys a template manifest may carry. */
const CATALOG_KEYS = new Set(["name", "description", "version", "tags", "packages"]);

/** Retired package names the 0.13 native packages replace. */
const RETIRED = /^@arnilo\/prism-(providers|memory|work|web-tools)$/;

/** A raw credential value that must never appear in a shipped manifest. */
const SECRET_VALUE = /(sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

/** Workspace package names, from the grouped `packages/<group>/<name>` and `apps/<name>` layout. */
function workspaceNames(): Set<string> {
  const names = new Set<string>();
  const add = (leaf: string): void => {
    try {
      const manifest = JSON.parse(readFileSync(join(leaf, "package.json"), "utf8"));
      if (typeof manifest.name === "string" && !manifest.private) {
        names.add(manifest.name);
        for (const key of Object.keys(manifest.exports ?? {})) {
          if (key.startsWith("./")) names.add(manifest.name + key.slice(1));
        }
      }
    } catch {
      // not a package leaf
    }
  };
  add(root);
  for (const base of ["packages", "apps"]) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const group of readdirSync(baseDir, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      const groupDir = join(baseDir, group.name);
      if (existsSync(join(groupDir, "package.json"))) add(groupDir);
      else for (const leaf of readdirSync(groupDir, { withFileTypes: true })) if (leaf.isDirectory()) add(join(groupDir, leaf.name));
    }
  }
  return names;
}

/** Any nested key that names a secret must hold an `env:`/`keyring:` ref, never a value. */
function secretRefViolations(value: unknown, path: string, out: string[]): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const where = `${path}.${key}`;
    if (/secret|token|password|apikey|api_key/i.test(key) && typeof child === "string" && !/^(env|keyring):/.test(child)) {
      out.push(`${where} is not an env:/keyring: ref`);
    }
    secretRefViolations(child, where, out);
  }
}

test("templates_load", () => {
  const dir = join(root, "templates");
  const templates = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "manifest.json")))
    .map((entry) => entry.name);
  assert.ok(templates.length >= 4, `expected the template catalog, found ${templates.join(", ")}`);

  const names = workspaceNames();
  assert.ok(names.size >= 40, `the workspace name set must be real, got ${names.size}`);

  for (const template of templates) {
    const text = readFileSync(join(dir, template, "manifest.json"), "utf8");
    const manifest = JSON.parse(text) as Record<string, unknown>;
    assert.equal(typeof manifest.name, "string", `${template}: name`);
    assert.equal(manifest.name, template, `${template}: the catalog name is the directory name`);
    assert.equal(typeof manifest.version, "string", `${template}: version`);
    for (const key of Object.keys(manifest)) assert.ok(CATALOG_KEYS.has(key), `${template}: unexpected key ${key}`);
    assert.ok(!SECRET_VALUE.test(text), `${template}: catalog manifests carry refs, never secret values`);
    const refs: string[] = [];
    secretRefViolations(manifest, template, refs);
    assert.deepEqual(refs, [], `${template}: secret fields must be env:/keyring: refs`);
    for (const pkg of (manifest.packages as string[] | undefined) ?? []) {
      assert.ok(!RETIRED.test(pkg), `${template}: names retired package ${pkg}`);
      assert.ok(names.has(pkg), `${template}: ${pkg} is not a live workspace package`);
    }
  }
});
