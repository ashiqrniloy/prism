import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: one config entry per published package; adding a package is one line
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
  // Pure-manifest umbrellas (no dist/exports): pack + install, but skip dynamic-import.
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers", isMeta: true },
  { dir: "packages/prism-compaction", name: "@arnilo/prism-compaction", isMeta: true },
  { dir: "packages/prism-all", name: "@arnilo/prism-all", isMeta: true },
];

// Derive every documented core import specifier from the root `exports` map so
// the smoke test cannot drift from the public contract.
function coreSpecifiers(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const specs = ["@arnilo/prism"];
  for (const key of Object.keys(pkg.exports)) {
    if (key === ".") continue;
    specs.push("@arnilo/prism" + key.slice(1)); // "./node/config" -> "@arnilo/prism/node/config"
  }
  return specs;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const staging = mkdtempSync(join(tmpdir(), "prism-smoke-stage-"));
const consumer = mkdtempSync(join(tmpdir(), "prism-smoke-consumer-"));

const result = { installStatus: -1, smokeStatus: -1, smokeOut: "", junk: [] as string[], tarballNames: [] as string[] };

before(() => {
  // 1. Pack core + every first-party package into the staging dir.
  for (const pkg of packages) {
    const r = run("npm", ["pack", "--pack-destination", staging], join(repoRoot, pkg.dir));
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}:\n${r.stdout}\n${r.stderr}`);
  }
  const tarballs = readdirSync(staging)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(staging, f));
  result.tarballNames = tarballs.map((f) => f.split("/").pop()!);

  // 2. Fresh consumer project; install all tarballs together so the required
  //    `prism` peer is satisfied locally with no registry traffic.
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "@arnilo-prism-install-smoke", type: "module" }, null, 2),
  );
  const installArgs = [
    "install",
    ...tarballs,
    "--offline",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier",
  ];
  let install = run("npm", installArgs, consumer);
  if (install.status !== 0) {
    // Fallback: cold cache or offline-unfriendly environment; no runtime deps
    // means this still makes zero registry fetches.
    install = run(
      "npm",
      ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"],
      consumer,
    );
  }
  result.installStatus = install.status;
  if (install.status !== 0) {
    result.smokeOut = `install failed:\n${install.stdout}\n${install.stderr}`;
    return;
  }

  // 3. Dynamic-import every documented specifier from the fresh install.
  const specs = [...coreSpecifiers(), ...packages.filter((p) => !p.isCore && !p.isMeta).map((p) => p.name)];
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const specs = ${JSON.stringify(specs)};\n` +
      "for (const s of specs) {\n" +
      "  try { await import(s); }\n" +
      "  catch (e) { console.error('IMPORT FAILED:', s, e.message); process.exit(1); }\n" +
      "}\nconsole.log('ALL IMPORTS OK');\n",
  );
  const smoke = run("node", ["smoke.mjs"], consumer);
  result.smokeStatus = smoke.status;
  result.smokeOut = smoke.stdout + smoke.stderr;

  // 4. Walk the installed node_modules for leaked test artifacts / source maps.
  const nodeModules = join(consumer, "node_modules");
  for (const file of walkFiles(nodeModules)) {
    const rel = file.slice(nodeModules.length + 1);
    if (rel.includes("__tests__") || rel.endsWith(".map")) {
      result.junk.push(rel);
    }
  }
});

after(() => {
  rmSync(staging, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
});

describe("install smoke (fresh offline tarball install)", () => {
  it("installs core plus all first-party packages with a satisfied @arnilo/prism peer", () => {
    assert.equal(result.installStatus, 0, result.smokeOut);
  });

  it("every documented core subpath and every first-party package imports", () => {
    assert.equal(result.smokeStatus, 0, result.smokeOut);
  });

  it("installed packages contain no test artifacts or source maps", () => {
    assert.deepEqual(result.junk, [], `leaked into installed node_modules: ${result.junk.join(", ")}`);
  });

  // ponytail: npm strips @scope/ from tarball names; core (@arnilo/prism) -> arnilo-prism-0.0.2.tgz.
  // Regression guard so a future rename can't silently re-mangle the published filename.
  it("core tarball filename is arnilo-prism-0.0.2.tgz (npm strips the @scope/)", () => {
    assert.ok(
      result.tarballNames.includes("arnilo-prism-0.0.2.tgz"),
      `expected 'arnilo-prism-0.0.2.tgz' in ${JSON.stringify(result.tarballNames)}`,
    );
    assert.equal(result.tarballNames.length, packages.length, "tarball count must match package count");
    // The 3 umbrella metas must be present too.
    for (const meta of ["arnilo-prism-providers-0.0.2.tgz", "arnilo-prism-compaction-0.0.2.tgz", "arnilo-prism-all-0.0.2.tgz"]) {
      assert.ok(result.tarballNames.includes(meta), `missing umbrella tarball ${meta}`);
    }
  });
});
