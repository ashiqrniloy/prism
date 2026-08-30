#!/usr/bin/env node
// Plan 040 Task 5 — independent publish dry-run for `@arnilo/prism-dev` 0.0.1.
//
// Runs the existing release machinery (scripts/release.mjs exports) with its
// documented injectable seams:
//   - changed-set (`gitDiff`) scoped to the dev package cut: sibling versions
//     are untouched — the docs/scripts work of plan 040 rides in the baseline
//     commit and publishes with the next root release.
//   - registry `fetcher` stubbed to 404 (the target version is not published).
//   - real `npm publish --dry-run` (offline) proves tarball packability.
//
// The regenerated report is retained at
// docs/_evidence/phase40-dev-inspector-publish-dry-run.json.
// Publication itself stays the operator handoff (push the package tag;
// release.yml publishes with OIDC provenance after `check` on a clean tree).
import assert from "node:assert/strict";
import process from "node:process";
import { loadRelease, runRelease } from "./release.mjs";

const ROOT = import.meta.dirname ? new URL("..", import.meta.url).pathname : process.cwd();
const BASELINE = process.argv[process.argv.indexOf("--baseline") + 1];
if (!BASELINE) {
  console.error("usage: node scripts/phase40-release-dry-run.mjs --baseline <commit-without-packages/prism-dev>");
  process.exit(2);
}

const release = loadRelease(ROOT);
const onlyDevCut = (_root, _baseline, pkgPath) => pkgPath === "packages/prism-dev";

// Sibling immutability snapshot: every workspace manifest must be byte-identical after the run.
const { readFileSync } = await import("node:fs");
const before = new Map(release.packages.map((pkg) => [pkg.manifest.name, readFileSync(`${pkg.path}/package.json`, "utf8")]));

const report = await runRelease({
  release,
  independent: true,
  mode: "publish",
  dryRun: true,
  independentOptions: { baseline: BASELINE, gitDiff: onlyDevCut },
  fetcher: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  reportPath: `${ROOT}/docs/_evidence/phase40-dev-inspector-publish-dry-run.json`,
});

assert.equal(report.order.length, 1, `cut must be exactly the dev package, got ${report.order.join(", ")}`);
assert.equal(report.order[0], "@arnilo/prism-dev");
assert.equal(report.version, "independent");
assert.equal(report.dryRun, true);
for (const entry of report.packages) {
  assert.equal(entry.status, "dry-run", `${entry.name}: ${entry.status}`);
}
for (const [name, manifest] of before) {
  const pkg = release.packages.find((p) => p.manifest.name === name);
  assert.equal(readFileSync(`${pkg.path}/package.json`, "utf8"), manifest, `${name} manifest was mutated by the dry run`);
}

console.log(JSON.stringify({ order: report.order, packages: report.packages }, null, 2));
console.log("report written to docs/_evidence/phase40-dev-inspector-publish-dry-run.json");
