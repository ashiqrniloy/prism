// Plan 057 Task 2: current-invariant truth suite (b) — every active package
// packs, exports, and installs (consolidated from src/__tests__/packaging /
// install-smoke, data-driven from computePackageTruth()). Zero hard-coded
// package names or counts: the package set derives from the workspace globs.
// Offline: npm pack --dry-run and the Bun consumer install never fetch first-party content.
// Plan 125 Task 2: the consumer simulation is Bun — tarballs still come from `npm pack` (the
// release-host registry toolchain), but they are installed and executed on Bun only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { installedVersion } from "./fixtures/packed-consumer.mjs";
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
  // release-host registry toolchain — runner images ship Node; contributors never invoke npm
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(result.status, 0, `npm pack --dry-run failed for ${name}: ${result.stderr}`);
  // npm 12 emits an object keyed by package name; npm 11 and earlier emitted an array of entries.
  const parsed = JSON.parse(result.stdout);
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const files = (entries[0]?.files ?? []).map((f) => f.path);
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

test("every publishable manifest declares engines.bun and no engines.node (plan 125 Task 1)", () => {
  for (const pkg of packages) {
    const manifest = readManifest(join(pkg.dir, "package.json"));
    assert.equal(manifest.engines?.bun, ">=1.4.2", `${pkg.name} must declare engines.bun >=1.4.2`);
    assert.equal(manifest.engines?.node, undefined, `${pkg.name} must not declare the retired engines.node`);
  }
});

test("dist-stage hand lists (packaging/install-smoke) still name every truth package", () => {
  const names = packages.map((p) => `"${p.name}"`);
  for (const file of ["src/__tests__/packaging.test.ts", "src/__tests__/install-smoke.test.ts"]) {
    const content = readFileSync(join(ROOT, file), "utf8");
    for (const n of names) {
      assert.ok(content.includes(n), `${file} no longer covers ${n}`);
    }
  }
});

/**
 * Plan 125 Task 2: one call per package from the packed tarball, proving the installed graph is
 * the real public API and not just an importable shell. `spec` is the package's primary subpath
 * (four packages have no `.` export).
 */
const FAMILY_CALLS = [
  { name: "@arnilo/prism", spec: "@arnilo/prism", call: "(m) => m.isJsonObject({})", expect: true },
  { name: "@arnilo/prism-core", spec: "@arnilo/prism-core/runtime/server", call: '(m) => m.isAdmitOperation("agent.run")', expect: true },
  { name: "@arnilo/prism-memory", spec: "@arnilo/prism-memory", call: "(m) => m.resolveMemoryLimits().topK", expect: 5 },
  {
    name: "@arnilo/prism-providers",
    spec: "@arnilo/prism-providers/openai",
    call: "(m) => m.createOpenAIProviderPackage().name",
    expect: "@arnilo/prism-providers/openai",
  },
  {
    name: "@arnilo/prism-coding-tools",
    spec: "@arnilo/prism-coding-tools/agent",
    call: "(m) => m.fingerprintJson({ a: 1 })",
    expect: "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
  },
  { name: "@arnilo/prism-work", spec: "@arnilo/prism-work/documents", call: '(m) => m.escapeHtml("<b>&")', expect: "&lt;b&gt;&amp;" },
  {
    name: "@arnilo/prism-web-tools",
    spec: "@arnilo/prism-web-tools",
    call: '(m) => m.canonicalUrl("https://EXAMPLE.com/a?b=1#f")',
    expect: "https://example.com/a?b=1",
  },
  { name: "@arnilo/prism-channels", spec: "@arnilo/prism-channels", call: "(m) => m.resolveChannelLimits().maxInputBytes", expect: 32768 },
  { name: "@arnilo/prism-mcp", spec: "@arnilo/prism-mcp", call: '(m) => m.defaultMcpNamePrefix("srv")', expect: "mcp:srv:" },
  { name: "@arnilo/prism-hooks", spec: "@arnilo/prism-hooks", call: '(m) => m.estimateContextTokens("hello world")', expect: 3 },
  { name: "@arnilo/prism-ag-ui", spec: "@arnilo/prism-ag-ui", call: "(m) => m.resolveAgUiLimits().maxEventBytes", expect: 65536 },
  {
    name: "@arnilo/prism-acp-agent",
    spec: "@arnilo/prism-acp-agent",
    call: `(m) => m.parseConfig('{"userId":"probe","cwd":"/tmp"}', "/tmp").userId`,
    expect: "probe",
  },
];

/**
 * Positive control: a subpath that no package exports. Assembled at runtime so this gate's own
 * source stays clean under `workflow-liveness`'s script-import scan (it matches literal
 * `@arnilo/*` specifiers in `scripts/**`).
 */
const UNKNOWN_SUBPATH = `@arnilo/prism/${["definitely", "not", "a", "subpath"].join("-")}`;

/** `bun -e` body: import every public subpath of every installed package, then make one call each. */
const CONSUMER_SWEEP = (calls) => `
const { readdirSync, readFileSync } = require("node:fs");
const CALLS = ${JSON.stringify(calls)};
(async () => {
  const names = readdirSync("node_modules/@arnilo").map((dir) => "@arnilo/" + dir).sort();
  const imported = [];
  const values = {};
  const failures = [];
  for (const name of names) {
    const manifest = JSON.parse(readFileSync("node_modules/" + name + "/package.json", "utf8"));
    for (const subpath of Object.keys(manifest.exports ?? {})) {
      const spec = subpath === "." ? name : name + "/" + subpath.slice(2);
      try {
        await import(spec);
        imported.push(spec);
      } catch (error) {
        failures.push(spec + ": " + String(error).split("\\n")[0]);
      }
    }
  }
  for (const entry of CALLS) {
    try {
      const module = await import(entry.spec);
      values[entry.name] = await eval(entry.call)(module);
    } catch (error) {
      failures.push("call " + entry.spec + ": " + String(error).split("\\n")[0]);
    }
  }
  let control = "resolved";
  try {
    await import(${JSON.stringify(UNKNOWN_SUBPATH)});
  } catch {
    control = "rejected";
  }
  console.log(JSON.stringify({ packages: names.length, imported: imported.length, values, failures, control }));
  if (failures.length > 0) process.exit(1);
})();
`;

/** Pack every publishable tarball with `npm pack` (the release-host registry toolchain). */
function packTarballs(staging) {
  // release-host registry toolchain — runner images ship Node; contributors never invoke npm
  const workspaces = spawnSync("npm", ["pack", "--workspaces", "--pack-destination", staging, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.equal(workspaces.status, 0, `npm pack --workspaces failed: ${workspaces.stderr}`);
  // release-host registry toolchain — runner images ship Node; contributors never invoke npm
  const root = spawnSync("npm", ["pack", "--pack-destination", staging, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.equal(root.status, 0, `npm pack failed: ${root.stderr}`);
  return readdirSync(staging)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(staging, file));
}

/**
 * Install the tarballs with Bun. `--offline` cannot resolve third-party ranges from a cold cache
 * (bun needs cached manifests, and a fresh CI cache has none), so the retry is `--prefer-offline`:
 * registry metadata for externals only — first-party content always comes from the tarballs.
 */
function bunInstall(consumer, tarballs) {
  const offline = spawnSync("bun", ["install", ...tarballs, "--offline", "--no-audit", "--no-fund"], { cwd: consumer, encoding: "utf8" });
  if (offline.status === 0) return { status: 0, mode: "offline", output: offline.stdout + offline.stderr };
  const preferOffline = spawnSync("bun", ["install", ...tarballs, "--prefer-offline", "--no-audit", "--no-fund"], {
    cwd: consumer,
    encoding: "utf8",
  });
  return { status: preferOffline.status, mode: "prefer-offline", output: preferOffline.stdout + preferOffline.stderr };
}

test("Bun consumer: every packed tarball installs, imports, and answers one call", () => {
  const staging = mkdtempSync(join(tmpdir(), "prism-pack-"));
  const consumer = mkdtempSync(join(tmpdir(), "prism-consumer-"));
  try {
    const tarballs = packTarballs(staging);
    assert.equal(tarballs.length, packages.length, `expected ${packages.length} tarballs, got ${tarballs.length}`);
    // Internal ranges (e.g. `@arnilo/prism-core@^0.12.0`) are unpublished at gate time,
    // so `overrides` pin every packed name to its tarball and keep resolution local.
    const overrides = Object.fromEntries(
      packages.map((pkg) => {
        const manifest = readManifest(join(pkg.dir, "package.json"));
        const tgz = `${manifest.name.replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`;
        return [pkg.name, `file:${join(staging, tgz)}`];
      }),
    );
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "prism-consumer", private: true, type: "module", overrides }));

    const started = Date.now();
    const install = bunInstall(consumer, tarballs);
    const installMs = Date.now() - started;
    assert.equal(install.status, 0, `bun install (${install.mode}) failed:\n${install.output}`);
    console.log(`bun consumer install: ${tarballs.length} tarballs in ${installMs}ms (${install.mode})`);

    // Provenance: the consumer lockfile must resolve every first-party package to the packed
    // tarball, so a registry copy can never stand in for the tree under test.
    const lock = readFileSync(join(consumer, "bun.lock"), "utf8");
    for (const pkg of packages) {
      assert.ok(
        lock.includes(`"${pkg.name}": ["${pkg.name}@${staging}/`),
        `${pkg.name} must resolve from the packed tarball, not the registry`,
      );
      const manifest = readManifest(join(pkg.dir, "package.json"));
      assert.equal(installedVersion(consumer, pkg.name), manifest.version, `${pkg.name} installed version`);
    }

    const sweep = spawnSync("bun", ["-e", CONSUMER_SWEEP(FAMILY_CALLS)], { cwd: consumer, encoding: "utf8" });
    assert.equal(sweep.status, 0, `consumer sweep failed:\n${sweep.stdout}\n${sweep.stderr}`);
    const report = JSON.parse(sweep.stdout.trim().split("\n").at(-1));
    const expectedImports = packages.reduce(
      (total, pkg) => total + Object.keys(readManifest(join(pkg.dir, "package.json")).exports ?? {}).length,
      0,
    );
    assert.deepEqual(report.failures, [], "every public subpath of every packed package must import on Bun");
    assert.equal(report.packages, packages.length, "every packed package must be installed");
    assert.equal(report.imported, expectedImports, "every public export subpath must import");
    assert.equal(report.control, "rejected", "an unknown subpath must not resolve");
    for (const entry of FAMILY_CALLS) {
      assert.deepEqual(report.values[entry.name], entry.expect, `${entry.spec} must answer its packed call`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(consumer, { recursive: true, force: true });
  }
});
