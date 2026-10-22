import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { runManifestCommand } from "../cli-manifest.js";
import { scopeDirs } from "../manifest/index.js";

const FIXTURE = resolve("src/__tests__/fixtures/manifest/hello-package");
const SECRET = "sk-live-0123456789abcdef";

function sink(): { stream: Writable; text: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _enc, done) {
      text += chunk.toString();
      done();
    },
  });
  return { stream, text: () => text };
}

async function run(argv: string[], cwd: string, home: string): Promise<{ code: number; out: string; err: string }> {
  const out = sink();
  const err = sink();
  const previous = process.env.PRISM_HOME;
  process.env.PRISM_HOME = home;
  try {
    const code = await runManifestCommand(argv, { stdout: out.stream, stderr: err.stream, cwd });
    return { code, out: out.text(), err: err.text() };
  } finally {
    if (previous === undefined) delete process.env.PRISM_HOME;
    else process.env.PRISM_HOME = previous;
  }
}

async function project(): Promise<{ root: string; home: string }> {
  const base = await mkdtemp(join(tmpdir(), "prism-cli-manifest-"));
  const root = join(base, "project");
  const home = join(base, "home");
  await mkdir(root);
  await mkdir(home);
  return { root, home };
}

describe("prism manifest cli", () => {
  it("cli_add_prints_capabilities_then_records_entry", async () => {
    const { root, home } = await project();
    const result = await run(["add", `file:${FIXTURE}`], root, home);
    assert.equal(result.code, 0, result.err);
    const declared = result.out.indexOf("declares capabilities: host-ui");
    const added = result.out.indexOf("Added @acme/hello");
    assert.ok(declared >= 0 && added > declared, result.out);
    const manifest = JSON.parse(await readFile(scopeDirs({ scope: "project", root, home }).manifestPath, "utf8"));
    assert.equal(manifest.packages[0].name, "@acme/hello");
    assert.deepEqual(manifest.packages[0].capabilities, ["host-ui"]);

    const listed = await run(["list", "--json"], root, home);
    assert.equal(listed.code, 0, listed.err);
    assert.equal(JSON.parse(listed.out).packages[0].name, "@acme/hello");
    assert.equal((await run(["disable", "@acme/hello"], root, home)).code, 0);
    assert.match((await run(["list"], root, home)).out, /@acme\/hello \^1\.2\.3 \[project\] disabled/);
    assert.equal((await run(["remove", "@acme/hello"], root, home)).code, 0);
    assert.match((await run(["list"], root, home)).out, /No packages/);
  });

  it("cli_config_rejects_literal_secret_without_echoing_it", async () => {
    const { root, home } = await project();
    assert.equal((await run(["add", `file:${FIXTURE}`], root, home)).code, 0);
    const path = scopeDirs({ scope: "project", root, home }).manifestPath;
    const before = await readFile(path, "utf8");

    const refused = await run(["config", "@acme/hello", `apiKey=${SECRET}`], root, home);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /apiKey/);
    assert.match(refused.err, /env:/);
    assert.match(refused.err, /keyring:/);
    assert.equal(refused.err.includes(SECRET), false);
    assert.equal(refused.out.includes(SECRET), false);
    assert.equal(await readFile(path, "utf8"), before);

    assert.equal((await run(["config", "@acme/hello", "apiKey=env:HELLO_KEY", "greeting=hi"], root, home)).code, 0);
    const after = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(after.packages[0].config, { apiKey: "env:HELLO_KEY", greeting: "hi" });
  });

  it("cli_exit_codes_distinguish_usage_and_manifest_errors", async () => {
    const { root, home } = await project();
    assert.equal((await run(["add"], root, home)).code, 2);
    assert.equal((await run(["add", "x", "--bogus"], root, home)).code, 2);
    assert.equal((await run(["add", "x", "--user", "--project"], root, home)).code, 2);
    assert.equal((await run(["slot", "not-a-slot", "x"], root, home)).code, 2);
    assert.equal((await run(["config", "@acme/hello"], root, home)).code, 2);
    const missing = await run(["enable", "@acme/missing"], root, home);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /package_missing/);
    assert.equal((await run(["verify"], root, home)).code, 0);
  });

  it("cli_list_and_verify_never_spawn_bun", async () => {
    const { root, home } = await project();
    assert.equal((await run(["add", `file:${FIXTURE}`], root, home)).code, 0);
    const { runManifestCommand } = await import("../cli-manifest.js");
    const bun = join(root, "no-such-bun");
    const out = sink();
    const err = sink();
    const base = { stdout: out.stream, stderr: err.stream, cwd: root, home, bun };
    assert.equal(await runManifestCommand(["list"], base), 0, err.text());
    assert.equal(await runManifestCommand(["verify"], base), 0, err.text());
    // Control: a command that does spawn bun fails on the bogus executable.
    assert.equal(await runManifestCommand(["remove", "@acme/hello"], base), 1);
    // A host that is not Bun fails closed before touching anything.
    assert.equal(await runManifestCommand(["list"], { ...base, isBun: false }), 1);
    assert.match(err.text(), /bun_required/);
  });

  it("init_and_providers_add_are_unknown_subcommands", async () => {
    const { root, home } = await project();
    for (const argv of [
      ["init", "app"],
      ["providers", "add", "x"],
    ]) {
      const result = await run(argv, root, home);
      assert.equal(result.code, 2, argv.join(" "));
      assert.equal((await readdir(root)).length, 0, "nothing is scaffolded");
      assert.equal(/prism init|providers add/.test(result.err), false, result.err);
    }
  });
});

describe("prism new package", () => {
  it("new_package_skeleton_passes_its_own_conformance_test", async () => {
    const { root, home } = await project();
    const created = await run(["new", "package", "@acme/prism-audit"], root, home);
    assert.equal(created.code, 0, created.err);
    const dir = join(root, "prism-audit");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.equal(pkg.name, "@acme/prism-audit");
    assert.deepEqual(pkg.exports, { ".": "./src/index.ts" });
    const source = await readFile(join(dir, "src", "index.ts"), "utf8");
    assert.match(source, /definePackage/);
    assert.match(source, /requires: \{ api: 1 \}/);
    assert.equal(source.includes("{{"), false);
    assert.match(await readFile(join(dir, "src", "__tests__", "package.test.ts"), "utf8"), /packageConformance/);

    // The generated test resolves the kernel through node_modules, as a real package would.
    await mkdir(join(dir, "node_modules", "@arnilo"), { recursive: true });
    await symlink(resolve("."), join(dir, "node_modules", "@arnilo", "prism"), "dir");
    const test = spawnSync(process.execPath, ["test"], { cwd: dir, encoding: "utf8" });
    assert.equal(test.status, 0, `${test.stdout}${test.stderr}`);

    const again = await run(["new", "package", "@acme/prism-audit"], root, home);
    assert.equal(again.code, 1);
    assert.equal((await run(["new", "package", "Bad Name"], root, home)).code, 2);
    assert.equal((await run(["new", "package", "x", "--dir", join(root, "elsewhere")], root, home)).code, 0);
    await writeFile(join(root, "elsewhere", "marker"), "");
  });

  it("new_provider_package_scaffolds_provider_skeleton", async () => {
    const { root, home } = await project();
    const created = await run(["new", "package", "--provider", "@acme/prism-provider-vertex"], root, home);
    assert.equal(created.code, 0, created.err);
    const dir = join(root, "prism-provider-vertex");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.equal(pkg.name, "@acme/prism-provider-vertex");
    assert.deepEqual(pkg.exports, { ".": "./src/index.ts" });
    const source = await readFile(join(dir, "src", "index.ts"), "utf8");
    assert.match(source, /defineProviderPackage/);
    assert.match(source, /secretRefProperty/);
    assert.match(source, /VERTEX_DEFAULT_API_KEY_REF/);
    assert.equal(source.includes("{{"), false);

    const providerSource = await readFile(join(dir, "src", "provider.ts"), "utf8");
    assert.match(providerSource, /createRoutedProvider/);

    const modelsSource = await readFile(join(dir, "src", "models.ts"), "utf8");
    assert.match(modelsSource, /vertexModels/);

    assert.ok(existsSync(join(dir, "src", "__tests__", "wire", "README.md")));
    assert.ok(existsSync(join(dir, "src", "__tests__", "live.test.ts")));
  });
});
