#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadRelease, publishArgs, satisfiesInternalRange, validateRelease } from "./release.mjs";
import { parseBunLock } from "./bun-lock.mjs";
import {
  BASELINE_DIR,
  assertTarballAllowDeny,
  baselineName,
  diffSurface,
  extractDeclaredSurface,
  parseDeclarationFile,
  parseSurface,
  runGates,
  serializeSurface,
} from "./release-gates.mjs";

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
    { path: ".", name: "@arnilo/prism", peerDependencies: { "@arnilo/prism-core": range } },
    { path: "packages/core", name: "@arnilo/prism-core" },
    { path: "packages/memory", name: "@arnilo/prism-memory", peerDependencies: { "@arnilo/prism": range } },
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
      '{\n  "lockfileVersion": 2,\n  "packages": {\n    "better-sqlite3@13.0.3": ["better-sqlite3@13.0.3", "", {}, "sha512-a,b,c"],\n  },\n  "workspaces": {\n    "": { "name": "@arnilo/prism" },\n    "packages/core": { "name": "@arnilo/prism-core", "version": "0.5.7" },\n  },\n}\n';
    const lock = parseBunLock(text);
    assert.equal(lock.packages["better-sqlite3@13.0.3"][3], "sha512-a,b,c", "comma inside a string must survive");
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

  it("publish provenance flag is mandatory in CI and detectable when missing in dry run", () => {
    const pkg = { path: ".", manifest: { name: "@arnilo/prism" } };
    const ci = publishArgs(pkg, false, true);
    assert.ok(ci.includes("--provenance"), "CI publish must request npm provenance");
    const ciDryRun = publishArgs(pkg, true, true);
    assert.ok(ciDryRun.includes("--provenance"), "CI dry-run must keep the provenance flag so the gate is observable");
    // Negative fixture: provenance suppressed in CI (e.g. tampered invocation)
    // is detectable — the flag is absent from the dry-run argument list.
    const suppressed = publishArgs(pkg, true, false);
    assert.ok(!suppressed.includes("--provenance"), "suppressed provenance must be visible in dry-run args");
    const local = publishArgs(pkg, false, false);
    assert.ok(!local.includes("--provenance"), "local publish without OIDC must not claim provenance");
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
    writeFileSync(lockPath, original.replace('    "packages/core": {"name":"@arnilo/prism-core","version":"0.5.7"},\n', ""));
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
      /ranges: @arnilo\/prism peerDependencies\.@arnilo\/prism-core is \^0\.5\.5, expected 0\.5\.7[\s\S]*@arnilo\/prism-memory peerDependencies\.@arnilo\/prism is \^0\.5\.5, expected 0\.5\.7/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("compat baselines are current for every package with a built dist/", () => {
    // The release gate's compat leg, runnable without the coverage-evidence preflight
    // (`node scripts/release.mjs gate` stops at checkReleaseEvidence before reaching it).
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
      `compat baseline stale — review the removals against their owning plans, then run\n  node scripts/release.mjs gate --version <line> --update-baseline\n${stale.join("\n")}`,
    );
  });
});
