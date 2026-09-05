/**
 * Plan 030 Task 2 — independent versioning machinery (dual-mode).
 * Tmp fixtures, injectable git/baseline seams, fake registry. No real git, no network.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  bumpPackage,
  incrementVersion,
  loadRelease,
  parseArgs,
  runRelease,
  satisfiesInternalRange,
  validateRelease,
  validateReleaseIndependent,
} from "./release.mjs";

function writeGraph(dir, pkgs) {
  const byPath = {};
  for (const p of pkgs) {
    const manifest = {
      name: p.name,
      version: p.version,
      publishConfig: { access: "public" },
      ...(p.deps ? { dependencies: p.deps } : {}),
    };
    const rel = p.path === "." ? "package.json" : `${p.path}/package.json`;
    mkdirSync(join(dir, p.path), { recursive: true });
    writeFileSync(join(dir, rel), `${JSON.stringify(manifest, null, 2)}\n`);
    byPath[p.path === "." ? "" : p.path] = manifest;
  }
  const lock = {
    name: "@arnilo/prism",
    lockfileVersion: 3,
    packages: Object.fromEntries(Object.entries(byPath).map(([path, m]) => [path, { version: m.version }])),
  };
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock, null, 2));
  return loadRelease(dir);
}

const CORE = "@arnilo/prism-core";
const CODING = "@arnilo/prism-coding-agent";
const ROOT = "@arnilo/prism";

function three(dir, { coreV, codingV, rootV, coreRange = "^0.3.0", codingRange = "^0.3.0" }) {
  return writeGraph(dir, [
    { path: "packages/core", name: CORE, version: coreV },
    { path: "packages/coding-agent", name: CODING, version: codingV, deps: { [CORE]: coreRange } },
    { path: ".", name: ROOT, version: rootV, deps: { [CORE]: coreRange, [CODING]: codingRange } },
  ]);
}

// Injectables: per-package changed flag + baseline version. No git required.
function seams(changedSet, baseline) {
  const gitDiff = (_root, _tag, path) => changedSet.has(path);
  const baselineVersion = () => baseline;
  return { gitDiff, baselineVersion, baseline: "v0.3.0" };
}

describe("phase30 release: semver helpers", () => {
  it("satisfiesInternalRange: exact, caret, tilde on 0.x", () => {
    assert.ok(satisfiesInternalRange("^0.3.0", "0.3.0"));
    assert.ok(satisfiesInternalRange("^0.3.0", "0.3.9"));
    assert.ok(!satisfiesInternalRange("^0.3.0", "0.4.0"));
    assert.ok(!satisfiesInternalRange("^0.3.0", "0.2.9"));
    assert.ok(satisfiesInternalRange("~0.3.5", "0.3.9"));
    assert.ok(!satisfiesInternalRange("~0.3.5", "0.4.0"));
    assert.ok(satisfiesInternalRange("0.3.0", "0.3.0"));
    assert.ok(!satisfiesInternalRange("0.3.0", "0.3.1"));
    assert.ok(!satisfiesInternalRange("0.2.9", "0.3.0"), "exact 0.2.9 must not satisfy 0.3.0");
  });

  it("incrementVersion: patch/minor/major", () => {
    assert.equal(incrementVersion("0.3.0", "patch"), "0.3.1");
    assert.equal(incrementVersion("0.3.9", "minor"), "0.4.0");
    assert.equal(incrementVersion("0.3.0", "major"), "1.0.0");
    assert.throws(() => incrementVersion("not-a-version", "patch"));
    assert.throws(() => incrementVersion("0.3.0", "bogus"));
  });
});

describe("phase30 release: explicit lockstep mode", () => {
  it("all-at-0.2.9 validates; mixed fails lockstep", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.2.9", codingV: "0.2.9", rootV: "0.2.9", coreRange: "0.2.9", codingRange: "0.2.9" });
    const order = validateRelease(release, "0.2.9");
    assert.deepEqual(order.map((p) => p.manifest.name).sort(), [CODING, CORE, ROOT].sort());
    const mixed = three(mkdtempSync(join(tmpdir(), "prism-rel-")), {
      coreV: "0.2.9",
      codingV: "0.3.0",
      rootV: "0.2.9",
      coreRange: "0.2.9",
      codingRange: "0.2.9",
    });
    assert.throws(() => validateRelease(mixed, "0.2.9"), /version is 0\.3\.0, expected 0\.2\.9/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("phase30 release: independent validate", () => {
  it("mixed versions with ^0.3.0 peers validate when changed package bumped", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.3.0", codingV: "0.3.1", rootV: "0.3.0" });
    // coding-agent changed (0.3.1 is a bump from baseline 0.3.0); core + root unchanged at 0.3.0.
    const order = validateReleaseIndependent(release, seams(new Set(["packages/coding-agent"]), "0.3.0"));
    assert.deepEqual(order.map((p) => p.manifest.name).sort(), [CODING, CORE, ROOT].sort());
    rmSync(dir, { recursive: true, force: true });
  });

  it("unsatisfied peer range (^0.3.0 vs core 0.4.0) fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.4.0", codingV: "0.3.1", rootV: "0.3.0" });
    // core + coding changed (valid bumps from 0.3.0 baseline); ranges still fail vs core 0.4.0.
    assert.throws(
      () => validateReleaseIndependent(release, seams(new Set(["packages/core", "packages/coding-agent"]), "0.3.0")),
      /does not satisfy/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("changed package without a bump fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.3.0", codingV: "0.3.0", rootV: "0.3.0" });
    // coding-agent changed but version still 0.3.0 == baseline.
    assert.throws(
      () => validateReleaseIndependent(release, seams(new Set(["packages/coding-agent"]), "0.3.0")),
      /changed since.*but version is still 0\.3\.0 \(bump required\)/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("unchanged package with a new version fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.3.0", codingV: "0.3.1", rootV: "0.3.0" });
    // coding-agent unchanged but version 0.3.1 != baseline 0.3.0.
    assert.throws(
      () => validateReleaseIndependent(release, seams(new Set(), "0.3.0")),
      /unchanged since.*but version is 0\.3\.1 \(was 0\.3\.0\)/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("phase30 release: independent publish", () => {
  function fakeRegistry(published) {
    // published: Map<`${name}@${version}`, manifest | undefined>
    return async (url) => {
      const m = url.match(/\/([^/]+)\/([^/]+)$/);
      const name = decodeURIComponent(m[1]);
      const version = decodeURIComponent(m[2]);
      const key = `${name}@${version}`;
      const entry = published.get(key);
      if (!entry) return { status: 404 };
      return { status: 200, ok: true, json: async () => entry };
    };
  }

  it("publishes unpublished only; resume skips same manifest; different fields throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.3.0", codingV: "0.3.1", rootV: "0.3.0" });
    const opts = seams(new Set(["packages/coding-agent"]), "0.3.0"); // only coding-agent changed and bumped

    const published = new Map();
    const publishedNames = [];
    const report = await runRelease({
      release,
      independent: true,
      independentOptions: opts,
      mode: "publish",
      dryRun: true,
      fetcher: fakeRegistry(published),
      publisher: (pkg) => {
        publishedNames.push(pkg.manifest.name);
        published.set(`${pkg.manifest.name}@${pkg.manifest.version}`, {
          name: pkg.manifest.name,
          version: pkg.manifest.version,
          dependencies: pkg.manifest.dependencies,
        });
      },
    });
    assert.deepEqual(publishedNames, [CODING]);
    assert.deepEqual(
      report.packages.map((p) => p.name),
      [CODING],
    );
    assert.equal(
      report.packages.every((p) => p.status === "dry-run" || p.status === "published"),
      true,
    );

    // Resume: every package already published with same fields -> all skipped, nothing republished.
    publishedNames.length = 0;
    const resume = await runRelease({
      release,
      independent: true,
      independentOptions: opts,
      mode: "publish",
      resume: true,
      dryRun: true,
      fetcher: fakeRegistry(published),
      publisher: (pkg) => {
        publishedNames.push(pkg.manifest.name);
      },
    });
    assert.equal(publishedNames.length, 0, "resume must not republish same-manifest packages");
    const codingStatus = resume.packages.find((p) => p.name === CODING).status;
    assert.equal(codingStatus, "skipped", "resume must skip already-published same-manifest package");

    // Different release fields -> throw (cannot republish with different deps).
    const tampered = new Map(published);
    tampered.set(`${CODING}@0.3.1`, { name: CODING, version: "0.3.1", dependencies: { [CORE]: "^0.2.9" } });
    await assert.rejects(
      () =>
        runRelease({
          release,
          independent: true,
          independentOptions: opts,
          mode: "publish",
          resume: true,
          dryRun: true,
          fetcher: fakeRegistry(tampered),
          publisher: () => {},
        }),
      /already exists on the registry/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("phase30 release: Task 9 independent default", () => {
  it("defaults check/publish/gate to independent and requires explicit lockstep", () => {
    assert.equal(parseArgs(["check"]).independent, true);
    assert.equal(parseArgs(["publish"]).independent, true);
    assert.equal(parseArgs(["gate"]).independent, true);
    assert.equal(parseArgs(["check", "--lockstep", "--version", "0.3.0"]).independent, undefined);
    assert.throws(() => parseArgs(["check", "--version", "0.3.0"]), /--independent and --version are mutually exclusive/);
    assert.throws(() => parseArgs(["check", "--lockstep"]), /--lockstep requires --version/);
  });

  it("accepts caret ranges in explicit lockstep validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    three(dir, { coreV: "0.3.0", codingV: "0.3.0", rootV: "0.3.0" });
    const manifest = JSON.parse(readFileSync(join(dir, "packages/coding-agent/package.json"), "utf8"));
    manifest.dependencies[CORE] = "^0.3.0";
    writeFileSync(join(dir, "packages/coding-agent/package.json"), JSON.stringify(manifest));
    assert.doesNotThrow(() => validateRelease(loadRelease(dir), "0.3.0"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("workflow publishes v0.3.0 once and package tags independently", () => {
    const workflow = readFileSync(join(import.meta.dirname, "..", ".github/workflows/release.yml"), "utf8");
    assert.match(workflow, /tags: \["v0\.3\.0", "v0\.4\.0", "v0\.5\.0", "@arnilo\/\*@\*"\]/);
    assert.match(workflow, /release:publish -- --lockstep --version /);
    assert.match(workflow, /release:publish -- --resume --report/);
    assert.doesNotMatch(workflow, /publish[\s\S]*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  });
});

describe("phase30 release: single-package bump", () => {
  it("bumpPackage increments only the named manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-rel-"));
    const release = three(dir, { coreV: "0.3.0", codingV: "0.3.0", rootV: "0.3.0" });
    const result = bumpPackage(release, CODING, "patch");
    assert.equal(result.from, "0.3.0");
    assert.equal(result.to, "0.3.1");
    const coding = JSON.parse(readFileSync(join(dir, "packages/coding-agent/package.json"), "utf8"));
    const core = JSON.parse(readFileSync(join(dir, "packages/core/package.json"), "utf8"));
    assert.equal(coding.version, "0.3.1");
    assert.equal(core.version, "0.3.0", "untouched manifest must not change");
    assert.throws(() => bumpPackage(release, "@arnilo/nope", "patch"), /unknown package/);
    rmSync(dir, { recursive: true, force: true });
  });
});
