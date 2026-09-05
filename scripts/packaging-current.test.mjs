// Plan 057 Task 2: current-invariant truth suite (b) — every active package
// packs, exports, and installs (consolidated from src/__tests__/packaging /
// install-smoke, data-driven from computePackageTruth()). Zero hard-coded
// package names or counts: the package set derives from the workspace globs.
// Offline: npm pack --dry-run and --offline installs never touch the registry.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computePackageTruth, expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DENIED = [
  [/__tests__\//, "compiled tests"],
  [/\.map$/, "source maps"],
  [/\.tsbuildinfo$/, "tsbuildinfo"],
  [/^src\//, "source"],
  [/^plans\//, "plans"],
  [/^\.agents\//, "agents"],
  [/^roadmap\.md$/, "roadmap"],
  [/^tsconfig/, "tsconfig"],
  [/^packages\//, "workspace packages"],
  [/^examples\//, "examples"],
];

const truth = computePackageTruth(ROOT);
const rootManifest = readManifest(join(ROOT, "package.json"));
const workspaceDirs = expandWorkspaceDirs(ROOT, rootManifest.workspaces).sort();
const nameToDir = new Map(workspaceDirs.map((d) => [readManifest(join(d, "package.json")).name, d]));
const packages = [
  { dir: ROOT, name: rootManifest.name, isCore: true },
  ...[...nameToDir].map(([name, dir]) => ({ dir, name, isCore: false })),
];

const packCache = new Map();
function packList(dir, name) {
  const cached = packCache.get(dir);
  if (cached) return cached;
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(result.status, 0, `npm pack --dry-run failed for ${name}: ${result.stderr}`);
  const files = JSON.parse(result.stdout)[0].files.map((f) => f.path);
  packCache.set(dir, files);
  return files;
}

test("package set derives from truth: workspace dirs and taxonomy agree, names unique", () => {
  assert.equal(truth.counts.workspace, workspaceDirs.length);
  const names = packages.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, "package names must be unique");
  assert.equal(packages.length, truth.counts.publishable, "pack list = root + every workspace package");
});

for (const pkg of packages) {
  test(`${pkg.name}: packs clean (no tests/maps/source/plans/workspace files)`, () => {
    const files = packList(pkg.dir, pkg.name);
    const junk = files.filter((f) => !f.startsWith("templates/") && DENIED.some(([pattern]) => pattern.test(f)));
    assert.deepEqual(junk, [], `${pkg.name} packs denied files: ${junk.join(", ")}`);
  });

  test(`${pkg.name}: ships README + LICENSE + CHANGELOG`, () => {
    const files = packList(pkg.dir, pkg.name);
    for (const required of ["README.md", "LICENSE", "CHANGELOG.md"]) {
      assert.ok(files.includes(required), `${pkg.name} missing ${required} in pack`);
    }
  });

  test(`${pkg.name}: every exports target ships as compiled output`, () => {
    const files = packList(pkg.dir, pkg.name);
    const manifest = readManifest(join(pkg.dir, "package.json"));
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      for (const field of ["types", "default"]) {
        const rel = target[field]?.replace(/^\.\//, "");
        if (!rel) continue;
        assert.ok(files.includes(rel), `${pkg.name} exports ${subpath} ${field} (${rel}) missing from pack`);
      }
    }
  });

  if (pkg.isCore) {
    test(`${pkg.name} (core): ships docs hub, CLI bin, and init templates`, () => {
      const files = packList(pkg.dir, pkg.name);
      for (const required of ["docs/index.md", "dist/cli.js", "templates/init/package.json.tmpl", "templates/README.md"]) {
        assert.ok(files.includes(required), `${pkg.name} missing ${required} in pack`);
      }
    });
  }
}

test("dist-stage hand lists (packaging/install-smoke) still name every truth package", () => {
  const names = packages.map((p) => `"${p.name}"`);
  for (const file of ["src/__tests__/packaging.test.ts", "src/__tests__/install-smoke.test.ts"]) {
    const content = readFileSync(join(ROOT, file), "utf8");
    for (const n of names) {
      assert.ok(content.includes(n), `${file} no longer covers ${n}`);
    }
  }
});

test("install canary: root tarball installs offline and its exports resolve", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-pack-"));
  try {
    const pack = spawnSync("npm", ["pack", "--pack-destination", dir, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    assert.equal(pack.status, 0, `npm pack failed for ${rootManifest.name}`);
    const tarball = join(dir, JSON.parse(pack.stdout)[0].filename);

    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
    const install = spawnSync("npm", ["install", "--offline", "--no-audit", "--no-fund", tarball], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(install.status, 0, `offline install failed: ${install.stderr}`);

    const installedDir = join(dir, "node_modules", rootManifest.name);
    const installedManifest = readManifest(join(installedDir, "package.json"));
    assert.equal(installedManifest.version, rootManifest.version, "installed version must match the manifest");

    // every exports target exists in the installed copy; main entry imports
    const entry = await import(pathToFileURL(join(installedDir, "dist", "index.js")));
    assert.ok(entry && typeof entry === "object", "installed main entry must resolve");
    for (const [subpath, target] of Object.entries(rootManifest.exports)) {
      for (const field of ["types", "default"]) {
        const rel = target[field]?.replace(/^\.\//, "");
        if (!rel) continue;
        assert.ok(existsSync(join(installedDir, rel)), `${subpath} ${field} (${rel}) missing in installed copy`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
