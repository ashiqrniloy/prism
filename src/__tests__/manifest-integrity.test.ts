import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelProvider, createAgent, providerDone, providerTextDelta } from "../index.js";
import {
  hashPackageClosure,
  hashPackageTree,
  installedPackageDir,
  loadManifest,
  ManifestError,
  MAX_CLOSURE_PACKAGES,
  scopeDirs,
  verifyInstalled,
  writeManifest,
} from "../manifest/index.js";
import { providerPackage } from "../provider-kit/index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const provider: ModelProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

async function tmp(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-integrity-${label}-`));
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

async function writePkg(
  dir: string,
  manifest: {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    capabilities?: string[];
  },
  files: Record<string, string> = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version ?? "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies: manifest.dependencies,
      peerDependencies: manifest.peerDependencies,
      peerDependenciesMeta: manifest.peerDependenciesMeta,
    }),
  );
  await mkdir(join(dir, "src"), { recursive: true });
  const indexContent =
    files["src/index.ts"] ??
    `export default {
  name: ${JSON.stringify(manifest.name)},
  version: ${JSON.stringify(manifest.version ?? "1.0.0")},
  requires: { api: 1 },
  capabilities: ${JSON.stringify(manifest.capabilities ?? [])},
  config: { type: "object" },
  setup(prism: any) {},
};
`;
  await writeFile(join(dir, "src", "index.ts"), indexContent);
  for (const [rel, content] of Object.entries(files)) {
    if (rel === "src/index.ts") continue;
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
}

describe("manifest closure integrity", () => {
  it("tampered_dependency_detected", async () => {
    const root = await tmp("tamper-dep");
    const dirs = scopeDirs({ scope: "project", root });
    const parentDir = installedPackageDir(dirs.packagesDir, "@acme/parent");
    const childDir = installedPackageDir(dirs.packagesDir, "child-pkg");

    await writePkg(parentDir, { name: "@acme/parent", dependencies: { "child-pkg": "^1.0.0" } });
    await writePkg(childDir, { name: "child-pkg" });

    const integrity = await hashPackageClosure(dirs.packagesDir, "@acme/parent", "project");
    await verifyInstalled({ name: "@acme/parent", integrity }, dirs.packagesDir, "project");

    // Tamper with child dependency
    await writeFile(join(childDir, "src", "index.ts"), "// tampered bytes\nexport default {};\n");

    const error = await codeOf(() => verifyInstalled({ name: "@acme/parent", integrity }, dirs.packagesDir, "project"));
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /@acme\/parent/);
    assert.match(error.message, /run 'prism add @acme\/parent' to reinstall/);
  });

  it("missing_dependency_detected", async () => {
    const root = await tmp("missing-dep");
    const dirs = scopeDirs({ scope: "project", root });
    const parentDir = installedPackageDir(dirs.packagesDir, "@acme/parent");

    await writePkg(parentDir, { name: "@acme/parent", dependencies: { "missing-lib": "^1.0.0" } });

    const error = await codeOf(() =>
      verifyInstalled({ name: "@acme/parent", integrity: "sha512-placeholder" }, dirs.packagesDir, "project"),
    );
    assert.equal(error.code, "package_missing");
    assert.equal(error.package, "@acme/parent");
    assert.equal(error.dependency, "missing-lib");
    assert.match(error.message, /Package @acme\/parent \(project\) dependency missing-lib is not installed/);
  });

  it("symlinked_dependency_refused", async () => {
    const root = await tmp("symlink-dep");
    const outside = await tmp("outside");
    const dirs = scopeDirs({ scope: "project", root });
    const parentDir = installedPackageDir(dirs.packagesDir, "@acme/parent");

    // Case 1: Dependency root directory is a symlink
    await writePkg(parentDir, { name: "@acme/parent", dependencies: { "symlinked-pkg": "^1.0.0" } });
    const outsidePkg = join(outside, "symlinked-pkg");
    await writePkg(outsidePkg, { name: "symlinked-pkg" });
    await symlink(outsidePkg, installedPackageDir(dirs.packagesDir, "symlinked-pkg"));

    const errDir = await codeOf(() =>
      verifyInstalled({ name: "@acme/parent", integrity: "sha512-placeholder" }, dirs.packagesDir, "project"),
    );
    assert.equal(errDir.code, "integrity_mismatch");
    assert.equal(errDir.package, "@acme/parent");
    assert.equal(errDir.dependency, "symlinked-pkg");
    assert.match(errDir.message, /Package @acme\/parent \(project\) dependency symlinked-pkg is a symlink, which is refused\./);

    // Case 2: File inside dependency is a symlink
    const root2 = await tmp("symlink-file");
    const dirs2 = scopeDirs({ scope: "project", root: root2 });
    const parent2Dir = installedPackageDir(dirs2.packagesDir, "@acme/parent2");
    const child2Dir = installedPackageDir(dirs2.packagesDir, "child-with-symlink");
    await writePkg(parent2Dir, { name: "@acme/parent2", dependencies: { "child-with-symlink": "^1.0.0" } });
    await writePkg(child2Dir, { name: "child-with-symlink" });
    const outsideSecret = join(outside, "secret.txt");
    await writeFile(outsideSecret, "secret content\n");
    await symlink(outsideSecret, join(child2Dir, "leak.txt"));

    const errFile = await codeOf(() =>
      verifyInstalled({ name: "@acme/parent2", integrity: "sha512-placeholder" }, dirs2.packagesDir, "project"),
    );
    assert.equal(errFile.code, "integrity_mismatch");
    assert.equal(errFile.package, "@acme/parent2");
    assert.equal(errFile.dependency, "child-with-symlink");
    assert.match(errFile.message, /Package @acme\/parent2 \(project\) dependency child-with-symlink contains a symlink at leak\.txt/);
  });

  it("closure_bound_enforced", async () => {
    const root = await tmp("bound");
    const dirs = scopeDirs({ scope: "project", root });
    const rootDir = installedPackageDir(dirs.packagesDir, "@acme/root");

    await writePkg(rootDir, {
      name: "@acme/root",
      dependencies: { "dep-a": "^1.0.0", "dep-b": "^1.0.0" },
    });
    await writePkg(installedPackageDir(dirs.packagesDir, "dep-a"), { name: "dep-a" });
    await writePkg(installedPackageDir(dirs.packagesDir, "dep-b"), { name: "dep-b" });

    assert.equal(MAX_CLOSURE_PACKAGES, 512);

    // Limit to 2 packages (root + 1 dep); having 2 deps means closure = 3 packages > 2
    const error = await codeOf(() =>
      hashPackageClosure(dirs.packagesDir, "@acme/root", "project", { maxClosurePackages: 2 }),
    );
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /dependency closure exceeds 2 packages/);
  });

  it("unchanged_closure_loads", async () => {
    const root = await tmp("unchanged");
    const home = await tmp("home");
    const dirs = scopeDirs({ scope: "project", root });
    const pkgDir = installedPackageDir(dirs.packagesDir, "@acme/feature");
    const depDir = installedPackageDir(dirs.packagesDir, "helper-lib");

    await writePkg(pkgDir, {
      name: "@acme/feature",
      dependencies: { "helper-lib": "^1.0.0" },
      capabilities: ["host-ui"],
    });
    await writePkg(depDir, { name: "helper-lib" });

    const integrity = await hashPackageClosure(dirs.packagesDir, "@acme/feature", "project");
    await writeManifest(dirs, {
      version: 1,
      packages: [
        {
          name: "@acme/feature",
          version: "^1.0.0",
          integrity,
          capabilities: ["host-ui"],
          enabled: true,
        },
      ],
    });

    const inputs = await loadManifest({ root, home, trustProject: () => true });
    assert.equal(inputs.length, 1);
    const agent = await createAgent({ model: MODEL, packages: [...inputs, providerPackage("test-p", [provider])] });
    const inspect = agent.inspect().packages.find((p) => p.name === "@acme/feature");
    assert.ok(inspect);
    assert.equal(inspect?.name, "@acme/feature");
    await agent.dispose();
  });

  it("transitive_dependency_tampered_fails", async () => {
    const root = await tmp("transitive");
    const dirs = scopeDirs({ scope: "project", root });
    const topDir = installedPackageDir(dirs.packagesDir, "@acme/top");
    const midDir = installedPackageDir(dirs.packagesDir, "mid-lib");
    const leafDir = installedPackageDir(dirs.packagesDir, "leaf-lib");

    await writePkg(topDir, { name: "@acme/top", dependencies: { "mid-lib": "^1.0.0" } });
    await writePkg(midDir, { name: "mid-lib", dependencies: { "leaf-lib": "^1.0.0" } });
    await writePkg(leafDir, { name: "leaf-lib" });

    const integrity = await hashPackageClosure(dirs.packagesDir, "@acme/top", "project");
    await verifyInstalled({ name: "@acme/top", integrity }, dirs.packagesDir, "project");

    // Tamper with transitive leaf
    await writeFile(join(leafDir, "src", "index.ts"), "// tampered leaf\n");

    const error = await codeOf(() => verifyInstalled({ name: "@acme/top", integrity }, dirs.packagesDir, "project"));
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /@acme\/top/);
  });

  it("optional_peer_dependency_not_required", async () => {
    const root = await tmp("opt-peer");
    const dirs = scopeDirs({ scope: "project", root });
    const pkgDir = installedPackageDir(dirs.packagesDir, "@acme/opt");

    await writePkg(pkgDir, {
      name: "@acme/opt",
      peerDependencies: { "optional-peer": "^2.0.0" },
      peerDependenciesMeta: { "optional-peer": { optional: true } },
    });

    // optional-peer is not installed, but verification succeeds because it is optional
    const integrity = await hashPackageClosure(dirs.packagesDir, "@acme/opt", "project");
    await verifyInstalled({ name: "@acme/opt", integrity }, dirs.packagesDir, "project");
  });

  it("old_integrity_format_fails_with_reinstall_guidance", async () => {
    const root = await tmp("old-format");
    const dirs = scopeDirs({ scope: "project", root });
    const pkgDir = installedPackageDir(dirs.packagesDir, "@acme/standalone");

    await writePkg(pkgDir, { name: "@acme/standalone" });
    const oldTreeHash = await hashPackageTree(pkgDir, { scope: "project", name: "@acme/standalone" });

    const error = await codeOf(() =>
      verifyInstalled({ name: "@acme/standalone", integrity: oldTreeHash }, dirs.packagesDir, "project"),
    );
    assert.equal(error.code, "integrity_mismatch");
    assert.match(error.message, /Package @acme\/standalone \(project\) does not match its recorded integrity hash; run 'prism add @acme\/standalone' to reinstall\./);
  });
});
