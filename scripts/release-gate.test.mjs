#!/usr/bin/env node
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseBunLock } from "./bun-lock.mjs";
import { publishableWorkspaceDirs } from "./package-truth.mjs";
import { CONSOLIDATION_SPEC } from "./phase54-package-map.mjs";
import { loadRelease, publishArgs, satisfiesInternalRange, tarballName, validateRelease } from "./release.mjs";
import {
  assertTarballAllowDeny,
  BASELINE_DIR,
  baselineName,
  diffSurface,
  extractDeclaredSurface,
  packedFilePaths,
  parseDeclarationFile,
  parseSurface,
  runGates,
  serializeSurface,
} from "./release-gates.mjs";
import { STAGES } from "./run-all-tests.mjs";
import { buildSbom } from "./sbom.mjs";
import { verifySbom } from "./verify-sbom.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "prism-gate-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  return dir;
}

// Minimal release graph: root + two workspaces whose only internal ranges are the
// ones under test. The packages declare no `types`/`main`/`exports` and ship no
// dist/, so the compat-surface gate skips them and the range gate is isolated.
function lockstepFixture({ range = "^0.5.7" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "prism-lockstep-"));
  const manifests = [
    { path: ".", name: "@arnilo/prism", peerDependencies: { "@arnilo/prism-sample": range } },
    { path: "packages/core", name: "@arnilo/prism-sample" },
    { path: "packages/memory/core", name: "@arnilo/prism-memory-core", peerDependencies: { "@arnilo/prism": range } },
  ];
  for (const { path, name, peerDependencies } of manifests) {
    mkdirSync(join(dir, path), { recursive: true });
    const manifest = {
      name,
      version: "0.5.7",
      publishConfig: { access: "public" },
      ...(peerDependencies ? { peerDependencies } : {}),
    };
    writeFileSync(join(dir, path, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const workspaces = manifests.map(({ path, name }) => {
    const key = path === "." ? "" : path;
    const entry = { name, ...(path === "." ? {} : { version: "0.5.7" }) };
    return `    ${JSON.stringify(key)}: ${JSON.stringify(entry)},`;
  });
  // Real bun.lock is JSONC-shaped: trailing commas, root entry without a version.
  writeFileSync(join(dir, "bun.lock"), `{\n  "lockfileVersion": 2,\n  "workspaces": {\n${workspaces.join("\n")}\n  },\n}\n`);
  return { dir, release: loadRelease(dir) };
}

describe("release gates", () => {
  it("bun.lock reader strips trailing commas without eating commas inside strings", () => {
    const text =
      '{\n  "lockfileVersion": 2,\n  "packages": {\n    "comma-pkg@1.0.0": ["comma-pkg@1.0.0", "", {}, "sha512-a,b,c"],\n  },\n  "workspaces": {\n    "": { "name": "@arnilo/prism" },\n    "packages/core": { "name": "@arnilo/prism-sample", "version": "0.5.7" },\n  },\n}\n';
    const lock = parseBunLock(text);
    assert.equal(lock.packages["comma-pkg@1.0.0"][3], "sha512-a,b,c", "comma inside a string must survive");
    assert.equal(lock.workspaces[""].version, undefined, "root entry has no version");
    assert.equal(lock.workspaces["packages/core"].version, "0.5.7");
  });
  it("parses local declarations, re-exports, star exports, and default", () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "dist/mod.d.ts"),
      `export declare function foo(a: string): number;
export declare interface Bar { x: number }
export declare const BAZ: "baz";
export default function (): void;
`,
    );
    writeFileSync(
      join(dir, "dist/index.d.ts"),
      `export { foo, Bar as Renamed } from "./mod.js";
export * from "./mod.js";
export * as ns from "./mod.js";
`,
    );
    const surface = extractDeclaredSurface(join(dir, "dist"));
    for (const name of ["foo", "Bar", "BAZ", "default", "Renamed", "ns"]) assert.ok(surface.has(name), `missing ${name}`);
    assert.match(surface.get("foo"), /function foo\(a: string\): number/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("diffs removed, changed, and added names", () => {
    const baseline = parseSurface("a\texport declare function a(): void;\nb\texport declare const b: number;\n");
    const current = parseSurface("a\texport declare function a(x: number): void;\nc\texport declare const c: number;\n");
    const diff = diffSurface(current, baseline);
    assert.deepEqual(diff.removed, ["b"]);
    assert.deepEqual(diff.changed, ["a"]);
    assert.deepEqual(diff.added, ["c"]);
  });

  it("serializes deterministically", () => {
    const surface = new Map([
      ["z", "z-sig"],
      ["a", "a-sig"],
    ]);
    assert.equal(serializeSurface(surface), "a\ta-sig\nz\tz-sig\n");
    assert.equal(serializeSurface(parseSurface(serializeSurface(surface))), serializeSurface(surface));
  });

  it("tarball deny list blocks review/plan/map content and allows clean packs", () => {
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/index.js", "docs/review-coverage-2026.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/_evidence/release-0.2.7-evidence.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/release-0.2.7-evidence.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/api-page-template.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["plans/079.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/index.js.map"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/__tests__/x.test.js"]), /denied paths/);
    assert.ok(assertTarballAllowDeny("pkg", ["dist/index.js", "docs/index.md", "README.md", "CHANGELOG.md"]));
  });

  it("tarball deny list rejects unexpected file types and credential material", () => {
    for (const path of [
      "dist/native.node",
      "vendor/libcrypto.so",
      "bin/tool.exe",
      "dist/credentials.pem",
      "config/service-account.key",
      "cert/server.p12",
    ]) {
      assert.throws(() => assertTarballAllowDeny("pkg", [path]), /denied paths/, `${path} must be denied`);
    }
    assert.ok(assertTarballAllowDeny("pkg", ["dist/index.d.ts", "package.json", "LICENSE"]));
  });

  it("publish_uses_bun_with_prepacked_tarball", () => {
    const pkg = { path: "packages/core", manifest: { name: "@arnilo/prism-sample" } };
    const args = publishArgs(pkg, "0.13.0");
    assert.equal(args[0], "publish");
    assert.ok(args[1].endsWith("/arnilo-prism-sample-0.13.0.tgz"), `must name the prepacked tarball: ${args[1]}`);
    assert.ok(!args.includes("--provenance"), "npm provenance is retired");
    assert.ok(!args.some((arg) => arg.includes("packages/core")), "must never publish a package directory");
    assert.ok(publishArgs(pkg, "0.13.0", { dryRun: true }).includes("--dry-run"));
    assert.deepEqual(publishArgs(pkg, "0.13.0", { registry: "https://example.test" }).slice(-2), ["--registry", "https://example.test"]);
    assert.equal(tarballName("@arnilo/prism", "0.13.0"), "arnilo-prism-0.13.0.tgz");
  });

  it("baseline names are filesystem-safe", () => {
    assert.equal(baselineName("@arnilo/prism"), "arnilo__prism.txt");
    assert.equal(baselineName("@arnilo/prism-browser"), "arnilo__prism-browser.txt");
  });

  it("parseDeclarationFile ignores comment-free multi-line signatures by collapsing", () => {
    const dir = fixture();
    const file = join(dir, "dist/x.d.ts");
    writeFileSync(file, "export declare function multi(\n  a: string,\n  b: number\n): Promise<void>;\n");
    const { locals } = parseDeclarationFile(file);
    assert.match(locals.get("multi"), /multi\( a: string, b: number \): Promise<void>/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lockfile drift is reported: workspace version mismatch and a missing path", () => {
    const { dir, release } = lockstepFixture();
    const lockPath = join(dir, "bun.lock");
    const original = readFileSync(lockPath, "utf8");
    writeFileSync(lockPath, original.replace('"version":"0.5.7"', '"version":"0.5.6"'));
    assert.throws(() => validateRelease(release, "0.5.7"), /bun\.lock packages\/core version is 0\.5\.6, expected 0\.5\.7/);
    writeFileSync(lockPath, original.replace('    "packages/core": {"name":"@arnilo/prism-sample","version":"0.5.7"},\n', ""));
    assert.throws(() => validateRelease(release, "0.5.7"), /bun\.lock missing packages\/core/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lockstep range gate accepts exact and caret pins at the cut version", () => {
    const exact = lockstepFixture({ range: "0.5.7" });
    assert.deepEqual(runGates({ release: exact.release, version: "0.5.7", skipTarball: true }), {
      version: "0.5.7",
      updated: false,
      packages: 3,
    });
    rmSync(exact.dir, { recursive: true, force: true });

    const caret = lockstepFixture({ range: "^0.5.7" });
    assert.equal(runGates({ release: caret.release, version: "0.5.7", skipTarball: true }).packages, 3);
    rmSync(caret.dir, { recursive: true, force: true });
  });

  it("lockstep range gate rejects a skewed range that still satisfies semver", () => {
    const { dir, release } = lockstepFixture({ range: "^0.5.5" });
    // Positive control: the old satisfaction check accepts the skew, so a
    // rejection here can only come from the exact-pin lockstep gate.
    assert.ok(satisfiesInternalRange("^0.5.5", "0.5.7"), "lax check would have accepted ^0.5.5");
    assert.throws(
      () => runGates({ release, version: "0.5.7", skipTarball: true }),
      /ranges: @arnilo\/prism peerDependencies\.@arnilo\/prism-sample is \^0\.5\.5, expected 0\.5\.7[\s\S]*@arnilo\/prism-memory-core peerDependencies\.@arnilo\/prism is \^0\.5\.5, expected 0\.5\.7/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("compat baselines are current for every package with a built dist/", () => {
    // The release gate's compat leg, runnable without the coverage-evidence preflight
    // (`bun scripts/release.mjs gate` stops at checkReleaseEvidence before reaching it).
    // A stale baseline is a red gate, so this suite fails here rather than at release time.
    const release = loadRelease(join(import.meta.dirname, ".."));
    const stale = [];
    for (const pkg of release.packages) {
      const distDir = join(release.root, pkg.path, "dist");
      if (!existsSync(distDir)) continue; // manifest-only profiles ship no code
      const baselinePath = join(release.root, BASELINE_DIR, baselineName(pkg.manifest.name));
      const diff = diffSurface(extractDeclaredSurface(distDir), parseSurface(readFileSync(baselinePath, "utf8")));
      if (!diff.removed.length && !diff.changed.length) continue;
      stale.push(
        `${pkg.manifest.name} ${[
          diff.removed.length ? `removed: ${diff.removed.join(", ")}` : "",
          diff.changed.length ? `changed: ${diff.changed.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ")}`,
      );
    }
    assert.equal(
      stale.length,
      0,
      `compat baseline stale — review the removals against their owning plans, then run\n  bun scripts/release.mjs gate --version <line> --update-baseline\n${stale.join("\n")}`,
    );
  });

  it("gate_refuses_non_bun_runtime", () => {
    const root = join(import.meta.dirname, "..");
    const result = spawnSync("node", ["scripts/release.mjs", "gate"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1, `node must exit 1; got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /bun scripts\/release\.mjs gate/);
  });

  // Two source-export packages whose TypeScript does not compile, plus the shared
  // packages config. A single gate run must name both, not stop at the first emit.
  function emitFixture() {
    const root = mkdtempSync(join(import.meta.dirname, "..", ".gate-fixture-"));
    writeFileSync(
      join(root, "tsconfig.packages.json"),
      `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true } })}\n`,
    );
    const packages = [];
    for (const name of ["alpha", "beta"]) {
      const path = `packages/${name}`;
      mkdirSync(join(root, path, "src"), { recursive: true });
      const manifest = { name: `@arnilo/prism-${name}`, version: "1.0.0", exports: { ".": "./src/index.ts" } };
      writeFileSync(join(root, path, "package.json"), `${JSON.stringify(manifest)}\n`);
      writeFileSync(join(root, path, "src", "index.ts"), 'export const broken: number = "not a number";\n');
      packages.push({ path, manifest });
    }
    const release = { root, packages, byName: new Map(), validate: () => {}, validateIndependent: () => {} };
    release.byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
    return { root, release };
  }

  it("gate_collects_every_emit_failure", () => {
    const { root, release } = emitFixture();
    try {
      let error;
      try {
        runGates({ release, version: "1.0.0", skipTarball: true });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error, "the gate must fail when a declaration emit fails");
      assert.match(error.message, /@arnilo\/prism-alpha declaration emit failed/);
      assert.match(error.message, /@arnilo\/prism-beta declaration emit failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gate_cleans_types_dir", () => {
    const { root, release } = emitFixture();
    try {
      try {
        runGates({ release, version: "1.0.0", skipTarball: true });
      } catch {
        // expected: both emits fail
      }
      for (const name of ["alpha", "beta"]) {
        assert.equal(existsSync(join(root, "packages", name, ".types")), false, `${name} .types/ must be removed`);
        assert.equal(existsSync(join(root, "packages", name, ".types-tsconfig.json")), false, `${name} temp tsconfig must be removed`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gate_tarball_lists_with_bun", () => {
    const root = mkdtempSync(join(tmpdir(), "prism-pack-fixture-"));
    try {
      const pkgDir = join(root, "pkg");
      mkdirSync(join(pkgDir, "dist"), { recursive: true });
      mkdirSync(join(pkgDir, "__tests__"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        `${JSON.stringify({ name: "fixture-pkg", version: "1.0.0", files: ["dist", "__tests__"] })}\n`,
      );
      writeFileSync(join(pkgDir, "dist", "index.js"), "export {};\n");
      writeFileSync(join(pkgDir, "__tests__", "x.test.js"), "// test\n");
      const paths = packedFilePaths(root, "pkg");
      assert.ok(
        paths.some((path) => path.includes("__tests__")),
        `expected the packed test file in ${paths.join(", ")}`,
      );
      assert.throws(() => assertTarballAllowDeny("fixture-pkg", paths), /denied paths/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gate_rejects_duplicate_lock_keys", () => {
    const text =
      '{\n  "workspaces": {\n    "packages/core": { "name": "@arnilo/prism-sample", "version": "1.0.0" },\n    "packages/core": { "name": "@arnilo/prism-sample", "version": "1.0.0" },\n  },\n}\n';
    assert.throws(() => parseBunLock(text), /duplicate keys: packages\/core/);
  });

  it("release_workflow_publishes_attested_tarballs", () => {
    const yml = readFileSync(join(import.meta.dirname, "..", ".github/workflows/release.yml"), "utf8");
    assert.match(yml, /bun scripts\/release\.mjs pack --destination release-artifacts/);
    assert.match(yml, /subject-path: release-artifacts\/\*\.tgz/);
    assert.match(yml, /bun run release:publish/);
    assert.ok(!/\bnpm (pack|publish|sbom)\b/.test(yml), "the release job must invoke no npm");
  });

  it("release_workflow_runs_no_npm", () => {
    const yml = readFileSync(join(import.meta.dirname, "..", ".github/workflows/release.yml"), "utf8");
    const commands = yml
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && /\bnpm\s/.test(line));
    assert.deepEqual(commands, [], `release.yml must run no npm command: ${commands.join(" | ")}`);
  });

  it("sbom_from_bun_lock_passes_license_policy", () => {
    const root = join(import.meta.dirname, "..");
    const policy = JSON.parse(readFileSync(join(root, "security/license-policy.json"), "utf8"));
    const sbom = buildSbom(root);
    const result = verifySbom(sbom, policy);
    assert.ok(result.packages > 100, `expected the installed tree, got ${result.packages}`);
    const undeclared = {
      ...sbom,
      packages: [...sbom.packages, { name: "fixture-no-license", versionInfo: "1.0.0", licenseDeclared: "NOASSERTION" }],
    };
    assert.throws(() => verifySbom(undeclared, policy), /fixture-no-license/);
  });

  // Plan 173 Task 7: the reference host's scenario suite is a release gate leg, runs after
  // client-neutrality, and stays offline (no secret env, no skipped scenario).
  const APP = join(import.meta.dirname, "..", "apps", "prism-agent");
  const appManifest = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));

  it("release_gate_runs_reference_host_scenarios", () => {
    const leg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).scripts["release:gate"];
    const neutrality = leg.indexOf("check-client-neutrality.mjs");
    const app = leg.indexOf("--filter @arnilo/prism-agent test");
    const gate = leg.indexOf("release.mjs gate");
    assert.ok(neutrality !== -1, "release:gate must run check-client-neutrality");
    assert.ok(app !== -1, "release:gate must run the reference host suite");
    assert.ok(app > neutrality, "the reference host leg must run after check-client-neutrality");
    assert.ok(gate > app, "the reference host leg must run before release.mjs gate");
    assert.equal(appManifest.scripts.test, "bun ../../scripts/with-build-lock.mjs --shared bun test --parallel=4 --timeout=0 src");
    const workspace = STAGES.find((stage) => stage.name === "workspace suites");
    assert.ok(
      workspace?.parallel?.some((leaf) => leaf.name === "apps/prism-agent"),
      "run-all-tests must cover apps/prism-agent through the workspace glob",
    );
  });

  it("reference_host_suite_has_no_skips", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && /\b(?:test|it|describe)\.skip\s*\(/.test(readFileSync(path, "utf8"))) {
          offenders.push(relative(join(import.meta.dirname, ".."), path));
        }
      }
    };
    walk(join(APP, "src", "__tests__"));
    assert.deepEqual(offenders, [], `reference-host scenarios must fail, not skip: ${offenders.join(", ")}`);
  });

  it("reference_host_suite_reads_no_secret_env", () => {
    const leg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).scripts["release:gate"];
    const secretEnv = /PRISM_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)|API_KEY/;
    assert.doesNotMatch(leg, secretEnv, "the release:gate leg must set no secret env");
    assert.doesNotMatch(appManifest.scripts.test, secretEnv, "the app test script must read no secret env");
  });

  // Plan 174 Task 10: the kernel size budget is step 4 of runGates, and the constraint
  // tests ride the root suite stage `release:gate` runs.
  const REPO = join(import.meta.dirname, "..");
  const repoScripts = () => JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
  const publishableNames = () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    return [
      manifest.name,
      ...publishableWorkspaceDirs(REPO, manifest.workspaces).map((dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name),
    ];
  };

  // Plan 174 Task 11: the gate must cover the whole publishable set, not the set someone
  // remembered to list.
  it("release_gate_covers_every_publishable_workspace", () => {
    const expected = publishableNames().sort();
    assert.ok(expected.length >= 43, `expected the publishable set, found ${expected.length}`);
    const release = loadRelease(REPO);
    assert.deepEqual(
      release.packages.map((pkg) => pkg.manifest.name).sort(),
      expected,
      "loadRelease must name exactly the publishable workspaces plus the root",
    );

    // Negative control: a workspace the globs gain is picked up with no list to edit.
    const dir = mkdtempSync(join(tmpdir(), "prism-gate-set-"));
    try {
      mkdirSync(join(dir, "packages", "sample"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "@arnilo/prism", version: "1.0.0", private: true, workspaces: ["packages/*"] }, null, 2)}\n`,
      );
      writeFileSync(
        join(dir, "packages", "sample", "package.json"),
        `${JSON.stringify({ name: "@arnilo/prism-sample", version: "1.0.0" }, null, 2)}\n`,
      );
      writeFileSync(
        join(dir, "bun.lock"),
        `{\n  "lockfileVersion": 2,\n  "workspaces": {\n    "": { "name": "@arnilo/prism" },\n  },\n}\n`,
      );
      assert.deepEqual(
        loadRelease(dir)
          .packages.map((pkg) => pkg.manifest.name)
          .sort(),
        ["@arnilo/prism", "@arnilo/prism-sample"],
        "a newly globbed workspace must enter the release set",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("release_gate_runs_driver_process_adapter_conformance_and_vendor_neutrality", () => {
    const leg = repoScripts()["release:gate"];
    const order = [
      "release-skip-manifest.mjs",
      "check-client-neutrality.mjs",
      "--filter @arnilo/prism-agent test",
      "--filter @arnilo/prism-driver-process test",
      "examples/adapters/conformance.ts",
      "src/__tests__/driver-kit-vendor-neutral.test.ts",
      "src/__tests__/kernel-constraints.test.ts",
      "release.mjs gate",
    ];
    let cursor = -1;
    for (const part of order) {
      const at = leg.indexOf(part);
      assert.ok(at === -1 ? false : at > cursor, `release:gate must run ${part} after the previous leg, and only once`);
      cursor = at;
    }
    assert.equal(leg.match(/release\.mjs gate/g)?.length, 1, "release:gate runs the gate once, last");
    // The conformance leg is the reference-adapter run, so it must fail the gate when a leg fails.
    const conformance = readFileSync(join(REPO, "examples", "adapters", "conformance.ts"), "utf8");
    assert.match(conformance, /process\.exitCode = 1/, "the adapter conformance leg must exit non-zero on failure");
    for (const file of [
      "src/__tests__/driver-kit-vendor-neutral.test.ts",
      "src/__tests__/kernel-constraints.test.ts",
      "examples/adapters/conformance.ts",
    ])
      assert.ok(existsSync(join(REPO, file)), `${file} is a release:gate leg and must exist`);
  });

  // Plan 174 Task 11: a baseline for a workspace that no longer exists is dead weight in the
  // release path — but the 0.3.3 legacy-registry record reads one per retired/folded/draft
  // entry (`scripts/phase54-package-map.mjs` `retiredPackages`), so those are freeze literals.
  it("no_compat_baseline_without_workspace", () => {
    const live = new Set(publishableNames());
    // The 0.3.3 baseline union: retained 7 + retired 55 + office drafts 3 (the sets
    // `phase54-package-map.test.mjs` builds from the map). Those baselines are the symbol
    // source for the legacy-registry records, so they are freeze literals, not orphans.
    const legacy = new Set([
      ...CONSOLIDATION_SPEC.activePackages.map((entry) => entry.name),
      ...CONSOLIDATION_SPEC.retiredPackages.map((entry) => entry.name),
      ...CONSOLIDATION_SPEC.officeDrafts.map((entry) => entry.name),
    ]);
    const files = readdirSync(join(REPO, BASELINE_DIR)).filter((file) => file.endsWith(".txt"));
    const orphans = files.filter((file) => {
      const name = `@arnilo/${file.slice("arnilo__".length, -4)}`;
      return !live.has(name) && !legacy.has(name);
    });
    assert.deepEqual(orphans, [], `compat baseline with no live workspace and no legacy-registry record:\n${orphans.join("\n")}`);
    const missing = [...live].map(baselineName).filter((file) => !files.includes(file));
    assert.deepEqual(missing, [], `every publishable workspace needs a compat baseline:\n${missing.join("\n")}`);
  });

  it("kernel_budget_breach_fails_gate", () => {
    const root = mkdtempSync(join(tmpdir(), "prism-kernel-budget-"));
    mkdirSync(join(root, "src"), { recursive: true });
    // No types/main/exports, so the compat phase has nothing to diff and the pack is the only work.
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "@arnilo/prism", version: "1.0.0" })}\n`);
    const pkg = { path: ".", manifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) };
    const release = { root, packages: [pkg], byName: new Map([[pkg.manifest.name, pkg]]), validate: () => {} };
    const kernelBudget = {
      packedBytes: { ceiling: 1 },
      unpackedBytes: { ceiling: 1e9 },
      fileCount: { ceiling: 1e6 },
      rootExports: { ceiling: 1e6 },
      sourceLines: { ceiling: 1e6 },
    };
    try {
      assert.throws(
        () => runGates({ release, version: "1.0.0", kernelBudget }),
        /kernel packedBytes grew: measured \d+ vs ceiling 1 \(\+\d+\)/,
      );
      // Positive control: the same run passes when the ceiling fits, so the failure above is the budget.
      assert.ok(runGates({ release, version: "1.0.0", kernelBudget: { ...kernelBudget, packedBytes: { ceiling: 1e9 } } }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("release_gate_reaches_the_kernel_budget_and_constraint_tests", () => {
    assert.match(repoScripts()["release:gate"], /release\.mjs gate/, "release:gate must reach runGates, whose step 4 is the kernel budget");
    const kernel = JSON.parse(readFileSync(join(REPO, "scripts", "budgets.json"), "utf8")).kernel;
    assert.deepEqual(
      ["packedBytes", "unpackedBytes", "fileCount", "rootExports", "sourceLines"].filter(
        (metric) => typeof kernel?.[metric]?.ceiling !== "number",
      ),
      [],
      "budgets.json kernel must record a ceiling per metric",
    );
    const stage = STAGES.find((entry) => entry.name === "root suites");
    assert.equal(stage?.args.at(-1), "src", "the root suite stage must cover src/");
    assert.ok(
      existsSync(join(REPO, "src", "__tests__", "kernel-constraints.test.ts")),
      "the kernel constraint tests must live in the root suite stage",
    );
  });
});
