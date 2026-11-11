import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type ModelProvider, createAgent, providerDone, providerTextDelta } from "../index.js";
import {
  install,
  installedPackageDir,
  loadManifest,
  ManifestError,
  type ManifestTrustRequest,
  readManifest,
  scopeDirs,
  writeManifest,
} from "../manifest/index.js";
import { providerPackage } from "../provider-kit/index.js";

const FIXTURE = resolve("src/__tests__/fixtures/manifest/hello-package");
const marks = globalThis as unknown as Record<string, number | undefined>;
const MODEL = { provider: "mock", model: "demo" } as const;
const provider: ModelProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

async function tmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-load-${label}-`));
}

/** Writes a plain-object package (no kernel import) and returns its directory. */
async function makePackage(name: string, options: { capabilities?: string[]; setup?: string } = {}): Promise<string> {
  const dir = await tmp("pkg");
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", exports: { ".": "./src/index.ts" } }),
  );
  await writeFile(
    join(dir, "src", "index.ts"),
    `const m = globalThis as any;
m.__prismImported = [...(m.__prismImported ?? []), ${JSON.stringify(name)}];
export default {
  name: ${JSON.stringify(name)},
  version: "1.0.0",
  requires: { api: 1 },
  capabilities: ${JSON.stringify(options.capabilities ?? [])},
  config: { type: "object", properties: { greeting: { type: "string", default: "hello" }, apiKey: { type: "string", "x-prism-secret": true } } },
  setup(prism: any) { ${options.setup ?? ""} },
};
`,
  );
  return dir;
}

/**
 * Installs into a scratch scope, then copies the scope to `target`. The installer imports a package once, and
 * a module is cached by path, so a package installed in place would have run already; the copy has a new path.
 */
async function installCopied(spec: string, scope: "user" | "project", target: string): Promise<void> {
  const scratch = await tmp("scratch");
  const dirs = scopeDirs({ scope, ...(scope === "project" ? { root: scratch } : { home: scratch }) });
  await install(spec, { scope, ...(scope === "project" ? { root: scratch } : { home: scratch }) });
  const to = scopeDirs({ scope, ...(scope === "project" ? { root: target } : { home: target }) });
  await cp(dirs.base, to.base, { recursive: true });
}

const imported = (): string[] => (globalThis as unknown as { __prismImported?: string[] }).__prismImported ?? [];
const resetImports = (): void => {
  delete (globalThis as unknown as Record<string, unknown>).__prismImported;
  marks.__prismHelloImports = 0;
};

async function codeOf(run: () => Promise<unknown>): Promise<ManifestError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ManifestError, String(error));
    return error;
  }
  return assert.fail("expected a ManifestError");
}

async function patchEntries(
  root: string | undefined,
  home: string | undefined,
  scope: "user" | "project",
  patch: (entries: any[]) => void,
): Promise<void> {
  const dirs = scopeDirs({ scope, ...(root ? { root } : {}), ...(home ? { home } : {}) });
  const manifest = JSON.parse(await readFile(dirs.manifestPath, "utf8"));
  patch(manifest.packages);
  await writeManifest(dirs, manifest);
}

describe("loadManifest", () => {
  it("loads_enabled_entries_as_packages_that_run_with_no_host_wiring", async () => {
    resetImports();
    const home = await tmp("home");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    const inputs = await loadManifest({ home, root: await tmp("empty-root") });
    assert.equal(inputs.length, 1);
    const agent = await createAgent({ model: MODEL, packages: [...inputs, providerPackage("test-provider", [provider])] });
    const view = agent.inspect().packages[0]!;
    assert.equal(view.name, "@acme/hello");
    assert.equal(view.source, "manifest:user");
    assert.equal(view.configSources.greeting, "default");
    await agent.dispose();
  });

  it("untrusted_project_manifest_never_imports_project_code", async () => {
    const root = await tmp("untrusted");
    const home = await tmp("untrusted-home");
    await installCopied(`file:${FIXTURE}`, "project", root);
    resetImports();
    for (const trustProject of [undefined, async () => false, () => "yes" as never]) {
      const inputs = await loadManifest({ root, home, ...(trustProject ? { trustProject } : {}) });
      assert.deepEqual(inputs, [], "a project-only package is not loaded");
      assert.equal(marks.__prismHelloImports, 0, "the project package's module code never ran");
    }
    const trusted = await loadManifest({ root, home, trustProject: async () => true });
    assert.equal(trusted.length, 1);
    assert.equal(marks.__prismHelloImports, 1);
  });

  it("no_trust_callback_skips_project_scope_keeps_user_values", async () => {
    const home = await tmp("keep-home");
    const root = await tmp("keep-root");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    await patchEntries(undefined, home, "user", (entries) => {
      entries[0].config = { greeting: "from-user" };
    });
    // The project overrides the user's config and disables nothing; it also adds a package of its own.
    await installCopied(`file:${await makePackage("@acme/project-only")}`, "project", root);
    await patchEntries(root, undefined, "project", (entries) =>
      entries.unshift({ name: "@acme/hello", config: { greeting: "from-project" } }),
    );
    resetImports();

    const skipped = await loadManifest({ root, home });
    assert.deepEqual(
      skipped.map((input) => (input as any).definition.name),
      ["@acme/hello"],
    );
    assert.deepEqual((skipped[0] as any).config, { greeting: "from-user" });
    assert.deepEqual(imported(), []);

    const trusted = await loadManifest({ root, home, trustProject: () => true });
    assert.deepEqual(
      trusted.map((input) => (input as any).definition.name),
      ["@acme/hello", "@acme/project-only"],
    );
    assert.deepEqual((trusted[0] as any).config, { greeting: "from-project" });
    assert.equal((trusted[0] as any).source.scope, "user", "the install still lives in the user scope");
    assert.equal((trusted[1] as any).source.scope, "project");
  });

  it("trust_callback_receives_names_versions_capabilities_only", async () => {
    const root = await tmp("req");
    const home = await tmp("req-home");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    await install(`file:${await makePackage("@acme/p", { capabilities: ["models"] })}`, { scope: "project", root });
    await patchEntries(root, undefined, "project", (entries) => {
      entries[0].config = { apiKey: "env:SECRET_REF_NAME", greeting: "LITERAL-CONFIG-VALUE" };
      entries.push({ name: "@acme/hello", enabled: false });
    });
    let seen: ManifestTrustRequest | undefined;
    await loadManifest({
      root,
      home,
      trustProject: (request) => {
        seen = request;
        return false;
      },
    });
    assert.ok(seen);
    assert.equal(seen.path, scopeDirs({ scope: "project", root }).manifestPath);
    assert.deepEqual(seen.packages, [
      { name: "@acme/p", version: "^1.0.0", capabilities: ["models"] },
      { name: "@acme/hello", version: "^1.2.3", capabilities: ["host-ui"] },
    ]);
    assert.equal(JSON.stringify(seen).includes("LITERAL-CONFIG-VALUE"), false);
    assert.equal(JSON.stringify(seen).includes("SECRET_REF_NAME"), false);
  });

  it("throwing_trust_callback_fails_closed", async () => {
    const root = await tmp("throw");
    await installCopied(`file:${FIXTURE}`, "project", root);
    resetImports();
    const error = await codeOf(() =>
      loadManifest({
        root,
        home: join(root, "no-home"),
        trustProject: () => {
          throw new Error("callback secret sk-live-123");
        },
      }),
    );
    assert.equal(error.code, "trust_failed");
    assert.equal(error.message.includes("sk-live-123"), false);
    assert.equal(marks.__prismHelloImports, 0);
  });

  it("disabled_entry_is_not_imported", async () => {
    const home = await tmp("disabled");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    await patchEntries(undefined, home, "user", (entries) => {
      entries[0].enabled = false;
    });
    // Even a tampered disabled package costs nothing: it is neither hashed nor imported.
    const dirs = scopeDirs({ scope: "user", home });
    await writeFile(join(installedPackageDir(dirs.packagesDir, "@acme/hello"), "src", "index.ts"), "throw new Error('imported');\n");
    resetImports();
    assert.deepEqual(await loadManifest({ home, root: await tmp("r") }), []);
    assert.equal(marks.__prismHelloImports, 0);
  });

  it("tampered_package_fails_closed_before_import_through_load", async () => {
    const home = await tmp("tamper");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    const file = join(installedPackageDir(scopeDirs({ scope: "user", home }).packagesDir, "@acme/hello"), "src", "index.ts");
    await writeFile(file, `${await readFile(file, "utf8")}\n// edited\n`);
    resetImports();
    const emptyRoot = await tmp("r");
    const error = await codeOf(() => loadManifest({ home, root: emptyRoot }));
    assert.equal(error.code, "integrity_mismatch");
    assert.equal(marks.__prismHelloImports, 0);
  });

  it("manifest_slot_assignment_resolves_conflict_and_host_slots_win", async () => {
    const home = await tmp("slots");
    const provide = 'prism.slots.compaction.provide({ async compact() { return { summary: "x" }; } });';
    await install(`file:${await makePackage("@acme/c1", { capabilities: ["slot:compaction"], setup: provide })}`, { scope: "user", home });
    await install(`file:${await makePackage("@acme/c2", { capabilities: ["slot:compaction"], setup: provide })}`, { scope: "user", home });
    const root = await tmp("slots-root");
    const noAssignment = await loadManifest({ home, root });
    await assert.rejects(
      createAgent({ model: MODEL, packages: [...noAssignment, providerPackage("test-provider", [provider])] }),
      /conflict/i,
    );

    const dirs = scopeDirs({ scope: "user", home });
    const manifest = JSON.parse(await readFile(dirs.manifestPath, "utf8"));
    await writeManifest(dirs, { ...manifest, slots: { compaction: "@acme/c2" } });
    const assigned = await loadManifest({ home, root });
    const agent = await createAgent({ model: MODEL, packages: [...assigned, providerPackage("test-provider", [provider])] });
    assert.equal(agent.inspect().slots.compaction, "@acme/c2");
    await agent.dispose();

    const hostWins = await createAgent({
      model: MODEL,
      packages: [...assigned, providerPackage("test-provider", [provider])],
      slots: { compaction: "@acme/c1" },
    });
    assert.equal(hostWins.inspect().slots.compaction, "@acme/c1");
    await hostWins.dispose();
  });

  it("capabilities_drift_fails_closed", async () => {
    const home = await tmp("drift");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    await patchEntries(undefined, home, "user", (entries) => {
      entries[0].capabilities = [];
    });
    const emptyRoot = await tmp("r");
    const error = await codeOf(() => loadManifest({ home, root: emptyRoot }));
    assert.equal(error.code, "capabilities_drift");
    assert.equal(error.package, "@acme/hello");
  });

  it("missing_installed_package_fails_closed_unless_optional", async () => {
    const home = await tmp("missing");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    const dirs = scopeDirs({ scope: "user", home });
    await rm(installedPackageDir(dirs.packagesDir, "@acme/hello"), { recursive: true });
    const emptyRoot = await tmp("r");
    const error = await codeOf(() => loadManifest({ home, root: emptyRoot }));
    assert.equal(error.code, "package_missing");

    await patchEntries(undefined, home, "user", (entries) => {
      entries[0].optional = true;
    });
    const inputs = await loadManifest({ home, root: await tmp("r") });
    const agent = await createAgent({ model: MODEL, packages: [...inputs, providerPackage("test-provider", [provider])] });
    const view = agent.inspect();
    assert.deepEqual(
      view.packages.filter((p) => p.name !== "test-provider").map((p) => [p.name, p.status, p.source]),
      [["@acme/hello", "skipped", "manifest:user"]],
    );
    assert.deepEqual(
      (view.statusNotes ?? []).map((note) => note.package),
      ["@acme/hello"],
    );
    await agent.dispose();
  });

  it("inspect_reports_manifest_scope_and_config_sources_without_values", async () => {
    const home = await tmp("inspect");
    const root = await tmp("inspect-root");
    process.env.PRISM_TEST_MANIFEST_KEY = "sk-live-from-env-0123456789";
    try {
      await install(`file:${FIXTURE}`, { scope: "user", home });
      await install(`file:${await makePackage("@acme/proj")}`, { scope: "project", root });
      await patchEntries(undefined, home, "user", (entries) => {
        entries[0].config = { apiKey: "env:PRISM_TEST_MANIFEST_KEY", greeting: "hi" };
      });
      const inputs = await loadManifest({ home, root, trustProject: () => true });
      const agent = await createAgent({
        model: MODEL,
        packages: [...inputs, providerPackage("test-provider", [provider])],
        packageConfig: { "@acme/proj": { greeting: "host" } },
      });
      const packages = agent.inspect().packages.filter((p) => p.name !== "test-provider");
      assert.deepEqual(
        packages.map((p) => [p.name, p.source]),
        [
          ["@acme/hello", "manifest:user"],
          ["@acme/proj", "manifest:project"],
        ],
      );
      assert.deepEqual(packages[0]!.configSources, { apiKey: "user", greeting: "user" });
      assert.equal(packages[1]!.configSources.greeting, "host");
      const text = JSON.stringify(agent.inspect());
      assert.ok(text.includes("env:PRISM_TEST_MANIFEST_KEY"));
      assert.equal(text.includes("sk-live-from-env-0123456789"), false);
      await agent.dispose();
    } finally {
      delete process.env.PRISM_TEST_MANIFEST_KEY;
    }
  });

  it("load_manifest_does_not_import_installer_module", async () => {
    const seen = new Set<string>();
    const walk = async (file: string): Promise<void> => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await readFile(file, "utf8");
      assert.equal(/node:child_process/.test(text), false, `${file} imports child_process`);
      for (const match of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
        await walk(resolve(dirname(file), (match[1] as string).replace(/\.js$/, ".ts")));
      }
    };
    await walk(resolve("src/manifest/load.ts"));
    assert.equal(
      [...seen].some((file) => file.endsWith("manifest/install.ts")),
      false,
    );
    assert.ok(seen.size > 3, "the walk followed the imports");
  });

  it("read_manifest_round_trips_what_load_reads", async () => {
    const home = await tmp("rt");
    await install(`file:${FIXTURE}`, { scope: "user", home });
    assert.equal((await readManifest(scopeDirs({ scope: "user", home })))?.packages.length, 1);
  });
});
