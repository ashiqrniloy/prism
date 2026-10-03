import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assignSlot, configure, install, list, ManifestError, scopeDirs, setEnabled, verify, writeManifest } from "../manifest/index.js";

const FIXTURE = resolve("src/__tests__/fixtures/manifest/hello-package");

async function tmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-maintain-${label}-`));
}

/** A plain-object package whose `setup` throws, so any test that passes proves `setup` never ran. */
async function throwingPackage(name: string): Promise<string> {
  const dir = await tmp("pkg");
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", exports: { ".": "./src/index.ts" } }),
  );
  await writeFile(
    join(dir, "src", "index.ts"),
    `export default { name: ${JSON.stringify(name)}, version: "1.0.0", capabilities: [],
  config: { type: "object", properties: { apiKey: { type: "string", "x-prism-secret": true }, mode: { type: "string", enum: ["a", "b"] } } },
  setup() { throw new Error("setup must not run"); } };\n`,
  );
  return dir;
}

async function userHome(spec = `file:${FIXTURE}`): Promise<string> {
  const home = await tmp("home");
  await install(spec, { scope: "user", home });
  return home;
}

async function fileOf(home: string): Promise<string> {
  return readFile(scopeDirs({ scope: "user", home }).manifestPath, "utf8");
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

describe("manifest maintenance", () => {
  it("configure_validates_against_package_schema_without_setup", async () => {
    const home = await userHome(`file:${await throwingPackage("@acme/boom")}`);
    const root = await tmp("root");
    await configure("@acme/boom", { apiKey: "env:BOOM_KEY", mode: "a" }, { scope: "user", home, root });
    assert.deepEqual(JSON.parse(await fileOf(home)).packages[0].config, { apiKey: "env:BOOM_KEY", mode: "a" });
    await configure("@acme/boom", { mode: "b" }, { scope: "user", home, root });
    assert.deepEqual(JSON.parse(await fileOf(home)).packages[0].config, { apiKey: "env:BOOM_KEY", mode: "b" }, "patches merge");
  });

  it("configure_rejects_literal_secret_and_leaves_file_unchanged", async () => {
    const home = await userHome();
    const root = await tmp("root");
    const before = await fileOf(home);
    const error = await codeOf(() => configure("@acme/hello", { apiKey: "sk-live-123456" }, { scope: "user", home, root }));
    assert.equal(error.code, "secret_literal");
    assert.ok(!error.message.includes("sk-live-123456"), "the literal is never echoed");
    assert.equal(await fileOf(home), before);
    assert.ok(!(await fileOf(home)).includes("sk-live"));
  });

  it("configure_rejects_unknown_key", async () => {
    const home = await userHome();
    const root = await tmp("root");
    const before = await fileOf(home);
    assert.equal((await codeOf(() => configure("@acme/hello", { nope: 1 }, { scope: "user", home, root }))).code, "config_unknown_key");
    assert.equal((await codeOf(() => configure("@acme/hello", { greeting: 5 }, { scope: "user", home, root }))).code, "config_invalid");
    assert.equal((await codeOf(() => configure("@acme/missing", {}, { scope: "user", home, root }))).code, "package_missing");
    assert.equal(await fileOf(home), before);
  });

  it("project_disable_of_user_package_overrides_without_copying_config", async () => {
    const home = await userHome();
    const root = await tmp("root");
    await configure("@acme/hello", { greeting: "hi", apiKey: "env:K" }, { scope: "user", home, root });
    await setEnabled("@acme/hello", false, { scope: "project", home, root });
    const project = JSON.parse(await readFile(scopeDirs({ scope: "project", root }).manifestPath, "utf8"));
    assert.deepEqual(project.packages, [{ name: "@acme/hello", enabled: false }]);
    const view = await list({ home, root });
    assert.equal(view.packages[0]?.enabled, false);
    assert.equal(view.packages[0]?.scope, "user");
    assert.deepEqual(view.packages[0]?.configKeys, ["greeting", "apiKey"]);
    // A user-scope edit of an unlisted package, and a project edit of an unknown one, fail closed.
    assert.equal((await codeOf(() => setEnabled("@acme/none", false, { scope: "project", home, root }))).code, "package_missing");
    await setEnabled("@acme/hello", true, { scope: "project", home, root });
    assert.equal((await list({ home, root })).packages[0]?.enabled, true);
  });

  it("assign_slot_requires_listed_owner_and_known_slot", async () => {
    const home = await userHome();
    const root = await tmp("root");
    const before = await fileOf(home);
    assert.equal((await codeOf(() => assignSlot("loop", "@acme/none", { scope: "user", home, root }))).code, "manifest_slot_owner");
    assert.equal((await codeOf(() => assignSlot("bogus" as never, "@acme/hello", { scope: "user", home, root }))).code, "manifest_invalid");
    assert.equal(await fileOf(home), before);
    await assignSlot("store", "@acme/hello", { scope: "user", home, root });
    assert.deepEqual((await list({ home, root })).packages[0]?.slots, ["store"]);
    // The merged view guards a disable of the owner.
    assert.equal((await codeOf(() => setEnabled("@acme/hello", false, { scope: "user", home, root }))).code, "manifest_slot_owner");
    // A project slot may name a user package.
    await assignSlot("store", null, { scope: "user", home, root });
    await assignSlot("loop", "@acme/hello", { scope: "project", home, root });
    assert.equal((await list({ home, root })).slots.loop, "@acme/hello");
    assert.equal(JSON.parse(await fileOf(home)).slots, undefined, "clearing the last slot drops the key");
  });

  it("list_shows_keys_never_values", async () => {
    const home = await userHome();
    const root = await tmp("root");
    await configure("@acme/hello", { greeting: "TOP-SECRET-VALUE", apiKey: "env:SOME_KEY" }, { scope: "user", home, root });
    const view = await list({ home, root });
    const text = JSON.stringify(view);
    assert.ok(!text.includes("TOP-SECRET-VALUE") && !text.includes("SOME_KEY"));
    assert.deepEqual(view.packages[0]?.capabilities, ["host-ui"]);
  });

  it("verify_reports_every_entry_including_failures", async () => {
    const home = await userHome();
    const root = await tmp("root");
    const second = await throwingPackage("@acme/boom");
    await install(`file:${second}`, { scope: "user", home });
    await configure("@acme/boom", { mode: "a" }, { scope: "user", home, root });
    assert.deepEqual(
      (await verify({ home, root })).map((result) => [result.name, result.ok]),
      [
        ["@acme/hello", true],
        ["@acme/boom", true],
      ],
    );
    // Tamper with the first package and write a bad config for the second by hand.
    const dirs = scopeDirs({ scope: "user", home });
    await writeFile(join(dirs.packagesDir, "node_modules", "@acme", "hello", "src", "index.ts"), "export default {};\n");
    const manifest = JSON.parse(await fileOf(home));
    manifest.packages[1].config = { apiKey: "sk-live-literal-value" };
    await writeManifest(dirs, manifest);
    const results = await verify({ home, root });
    assert.equal(results.length, 2, "does not stop at the first failure");
    assert.equal(results[0]?.issues[0]?.code, "integrity_mismatch");
    assert.equal(results[1]?.issues[0]?.code, "secret_literal");
    assert.ok(!JSON.stringify(results).includes("sk-live-literal-value"));
  });
});
