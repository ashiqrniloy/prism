import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  hashPackageClosure,
  hashPackageTree,
  install,
  installedPackageDir,
  ManifestError,
  parseManifest,
  remove,
  resolveUserHome,
  scopeDirs,
  verifyInstalled,
  writeManifest,
} from "../manifest/index.js";

const FIXTURE = resolve("src/__tests__/fixtures/manifest/hello-package");
const marker = globalThis as unknown as Record<string, number | undefined>;

async function tmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-manifest-${label}-`));
}

async function codeOf(run: () => Promise<unknown>): Promise<ManifestError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ManifestError, String(error));
    return error;
  }
  return assert.fail("expected a ManifestError");
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("manifest install", () => {
  it("install_file_spec_records_name_range_integrity_and_capabilities", async () => {
    const root = await tmp("root");
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root });
    assert.equal(entry.name, "@acme/hello");
    assert.equal(entry.version, "^1.2.3");
    assert.deepEqual(entry.capabilities, ["host-ui"]);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);

    const dirs = scopeDirs({ scope: "project", root });
    const onDisk = parseManifest(await readJson(dirs.manifestPath), { scope: "project", path: dirs.manifestPath });
    assert.deepEqual(onDisk.packages, [entry]);
    await verifyInstalled(entry, dirs.packagesDir, "project");
    assert.equal(await hashPackageClosure(dirs.packagesDir, entry.name, "project"), entry.integrity);
    assert.notEqual(
      await hashPackageTree(installedPackageDir(dirs.packagesDir, entry.name), { scope: "project", name: entry.name }),
      entry.integrity,
    );
  });

  it("install_file_directory_spec_installs_real_copies_not_symlinks", async () => {
    const root = await tmp("copies");
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root });
    const dir = installedPackageDir(scopeDirs({ scope: "project", root }).packagesDir, entry.name);
    for (const file of ["package.json", "src/index.ts"]) assert.equal((await lstat(join(dir, file))).isSymbolicLink(), false, file);
    // A relative file: spec resolves against `cwd`, not the managed directory.
    const again = await install("file:./src/__tests__/fixtures/manifest/hello-package", { scope: "project", root, cwd: resolve(".") });
    assert.equal(again.integrity, entry.integrity);
  });

  it("reinstall_keeps_config_enabled_and_position", async () => {
    const root = await tmp("reinstall");
    const dirs = scopeDirs({ scope: "project", root });
    const first = await install(`file:${FIXTURE}`, { scope: "project", root });
    const manifest = parseManifest(await readJson(dirs.manifestPath), { scope: "project", path: dirs.manifestPath });
    await writeManifest(dirs, { ...manifest, packages: [{ ...first, config: { greeting: "hi" }, enabled: false }] });
    await install(`file:${FIXTURE}`, { scope: "project", root });
    const after = await readJson(dirs.manifestPath);
    assert.equal(after.packages.length, 1);
    assert.deepEqual(after.packages[0].config, { greeting: "hi" });
    assert.equal(after.packages[0].enabled, false);
  });

  it("tampered_file_fails_closed_before_import", async () => {
    const root = await tmp("tamper");
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root });
    const dirs = scopeDirs({ scope: "project", root });
    const file = join(installedPackageDir(dirs.packagesDir, entry.name), "src", "index.ts");
    await writeFile(file, `${await readFile(file, "utf8")}\n(globalThis as any).__prismHelloTampered = true;\n`);
    delete (globalThis as Record<string, unknown>).__prismHelloTampered;
    const error = await codeOf(() => verifyInstalled(entry, dirs.packagesDir, "project"));
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /@acme\/hello/);
    assert.match(error.message, /project/);
    // verifyInstalled never imports, so the tampered module's side effect did not run.
    assert.equal((globalThis as Record<string, unknown>).__prismHelloTampered, undefined);
  });

  it("missing_package_fails_closed", async () => {
    const root = await tmp("missing");
    const dirs = scopeDirs({ scope: "project", root });
    const error = await codeOf(() => verifyInstalled({ name: "@acme/none", integrity: "sha512-x" }, dirs.packagesDir, "project"));
    assert.equal(error.code, "package_missing");
  });

  it("symlink_escape_in_package_tree_fails_closed", async () => {
    const root = await tmp("symlink");
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root });
    const dirs = scopeDirs({ scope: "project", root });
    const outside = await tmp("outside");
    await writeFile(join(outside, "secret.txt"), "outside bytes");
    await symlink(join(outside, "secret.txt"), join(installedPackageDir(dirs.packagesDir, entry.name), "link.txt"));
    const error = await codeOf(() => verifyInstalled(entry, dirs.packagesDir, "project"));
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /symlink/);
  });

  it("non_package_default_export_is_rejected_and_rolled_back", async () => {
    const root = await tmp("notpkg");
    const source = await tmp("notpkg-src");
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({ name: "@acme/notpkg", version: "1.0.0", type: "module", main: "index.js" }),
    );
    await writeFile(join(source, "index.js"), "export default 42;\n");
    const error = await codeOf(() => install(`file:${source}`, { scope: "project", root }));
    assert.equal(error.code, "not_a_package");
    const dirs = scopeDirs({ scope: "project", root });
    assert.deepEqual((await readJson(join(dirs.packagesDir, "package.json"))).dependencies ?? {}, {});
    await assert.rejects(lstat(installedPackageDir(dirs.packagesDir, "@acme/notpkg")));
    await assert.rejects(lstat(dirs.manifestPath));
  });

  it("remove_drops_entry_and_its_slot_assignment_only_in_that_scope", async () => {
    const root = await tmp("rm-root");
    const home = await tmp("rm-home");
    await install(`file:${FIXTURE}`, { scope: "project", root });
    await install(`file:${FIXTURE}`, { scope: "user", home });
    const project = scopeDirs({ scope: "project", root });
    const user = scopeDirs({ scope: "user", home });
    const text = await readJson(project.manifestPath);
    await writeManifest(project, { ...text, slots: { store: "@acme/hello", loop: "@acme/hello" } });
    await remove("@acme/hello", { scope: "project", root });

    const after = await readJson(project.manifestPath);
    assert.deepEqual(after.packages, []);
    assert.equal(after.slots, undefined);
    await assert.rejects(lstat(installedPackageDir(project.packagesDir, "@acme/hello")));
    assert.equal((await readJson(user.manifestPath)).packages.length, 1);
    await verifyInstalled((await readJson(user.manifestPath)).packages[0], user.packagesDir, "user");
    assert.equal((await codeOf(() => remove("@acme/hello", { scope: "project", root }))).code, "package_missing");
  });

  it("manifest_write_is_atomic", async () => {
    const root = await tmp("atomic");
    const dirs = scopeDirs({ scope: "project", root });
    await writeManifest(dirs, { version: 1, packages: [] });
    const before = await readFile(dirs.manifestPath, "utf8");
    const entry = await install(`file:${FIXTURE}`, { scope: "project", root });
    const installed = await readFile(dirs.manifestPath, "utf8");
    assert.notEqual(installed, before);

    await assert.rejects(
      writeManifest(dirs, { version: 1, packages: [] }, { rename: async () => Promise.reject(new Error("crash between temp and rename")) }),
      /crash/,
    );
    assert.equal(await readFile(dirs.manifestPath, "utf8"), installed, "the old manifest survives");
    assert.deepEqual(
      (await readdir(dirs.base)).filter((name) => name.endsWith(".tmp")),
      [],
      "the temp file is cleaned up",
    );
    assert.equal(entry.name, "@acme/hello");
  });

  it("a_manifest_the_reader_would_refuse_is_never_written", async () => {
    const dirs = scopeDirs({ scope: "user", home: await tmp("refuse") });
    const bad = { version: 1, packages: [{ name: "a" }] } as never;
    assert.equal((await codeOf(() => writeManifest(dirs, bad))).code, "manifest_invalid");
    await assert.rejects(lstat(dirs.manifestPath));
  });

  it("install_failed_redacts_stderr_and_names_missing_bun", async () => {
    const root = await tmp("fail");
    const bin = await tmp("bin");
    const script = join(bin, "fake-bun");
    await writeFile(script, '#!/bin/sh\necho "registry said no: token=$NPM_TOKEN //r/:_authToken=abc123def456" >&2\nexit 1\n');
    await chmod(script, 0o755);
    const secret = "npm_SECRETVALUE_123456";
    const error = await codeOf(() =>
      install("some-package", { scope: "project", root, bun: script, env: { PATH: process.env.PATH, NPM_TOKEN: secret } }),
    );
    assert.equal(error.code, "install_failed");
    assert.equal(error.message.includes(secret), false, error.message);
    assert.equal(error.message.includes("abc123def456"), false, error.message);
    assert.match(error.message, /registry said no/);

    const missing = await codeOf(() => install("some-package", { scope: "project", root, bun: join(bin, "does-not-exist") }));
    assert.equal(missing.code, "install_failed");
    assert.match(missing.message, /bun was not found/);
  });

  it("install_rejects_flag_like_and_url_specs_without_spawning", async () => {
    const root = await tmp("specs");
    const bin = await tmp("bin2");
    const script = join(bin, "fake-bun");
    await writeFile(script, `#!/bin/sh\ntouch "${join(bin, "ran")}"\nexit 0\n`);
    await chmod(script, 0o755);
    for (const spec of [
      "--global",
      "-e",
      "https://example.com/p.tgz",
      "git+https://example.com/p.git",
      "github:a/b",
      "npm:other@1",
      "a b",
      "file:./nope-missing",
    ]) {
      assert.equal((await codeOf(() => install(spec, { scope: "project", root, bun: script }))).code, "install_failed", spec);
    }
    await assert.rejects(lstat(join(bin, "ran")), "no child was spawned for a rejected spec");
  });

  it("user_scope_honours_prism_home_rule", () => {
    assert.equal(resolveUserHome({ PRISM_HOME: "/srv/prism-home" }), "/srv/prism-home");
    assert.throws(
      () => resolveUserHome({ PRISM_HOME: "relative/home" }),
      (e) => e instanceof ManifestError,
    );
    assert.equal(scopeDirs({ scope: "user", home: "/h" }).manifestPath, "/h/packages.json");
    assert.equal(scopeDirs({ scope: "project", root: "/r" }).packagesDir, "/r/.prism/packages");
  });

  it("per_load_hash_cost_for_a_50_file_package_is_small", async () => {
    const dir = await tmp("fifty");
    await mkdir(join(dir, "src"), { recursive: true });
    for (let i = 0; i < 50; i++) await writeFile(join(dir, "src", `f${i}.js`), `export const v${i} = "${"x".repeat(5000)}";\n`);
    await hashPackageTree(dir, { scope: "project", name: "p" });
    const start = performance.now();
    await hashPackageTree(dir, { scope: "project", name: "p" });
    const ms = performance.now() - start;
    console.log(`manifest hash cost, 50 files x 5 KB: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 250, `hashing took ${ms} ms`);
    assert.equal(typeof marker, "object");
  });
});
