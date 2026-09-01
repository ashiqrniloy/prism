// scripts/phase54-legacy-registry.test.mjs
// Plan 054 Task 7: legacy npm dist-tag + deprecation plan tests, run against an offline
// npm fixture shim (PRISM_LEGACY_NPM) that emulates view / dist-tag / deprecate against a
// JSON state file, so the release-only registry flow is verified without network or tokens.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPlanEntries, githubSlug, guideAnchors, legacyMessage } from "./phase54-legacy-registry.mjs";
import { CONSOLIDATION_SPEC } from "./phase54-package-map.mjs";

const rootDir = join(fileURLToPath(import.meta.url), "../..");
const script = join(rootDir, "scripts/phase54-legacy-registry.mjs");
const guide = join(rootDir, "docs/migrate-to-0.4.md");

const NAMES = CONSOLIDATION_SPEC.retiredPackages.map((r) => r.name);
// Mirrors the real registry: two retired names were never published.
const UNPUBLISHED = ["@arnilo/prism-prompts", "@arnilo/prism-dev"];
const PUBLISHED = NAMES.filter((n) => !UNPUBLISHED.includes(n));

function makeFixture(dir, { corruptLegacy = [], corruptMessage = [] } = {}) {
  const state = { packages: {} };
  for (const name of PUBLISHED) {
    state.packages[name] = {
      versions: ["0.3.1", "0.3.0"],
      latest: "0.3.1",
      tags: corruptLegacy.includes(name) ? { legacy: "0.3.0" } : {},
      deprecated: corruptMessage.includes(name) ? { "0.3.1": "some other warning" } : {},
    };
  }
  const statePath = join(dir, "fixture-state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

function makeShim(dir) {
  // Executable npm fixture: emulates the npm surface the registry script uses.
  const shimPath = join(dir, "npm-fixture.mjs");
  writeFileSync(
    shimPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.PRISM_LEGACY_FIXTURE;
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const fail = (msg) => { console.error(msg); process.exit(1); };
if (args[0] === "view") {
  const spec = args[1];
  const core = spec.startsWith("@") ? spec.slice(1) : spec;
  const at = core.lastIndexOf("@");
  const name = spec.startsWith("@") ? "@" + (at === -1 ? core : core.slice(0, at)) : core.slice(0, at === -1 ? core.length : at);
  const version = at === -1 ? undefined : core.slice(at + 1);
  const pkg = state.packages[name];
  if (!pkg) fail("npm ERR! 404 not found: " + name);
  if (args[2] === "version") {
    if (version === undefined) { if (pkg.tags?.latest === undefined && !pkg.latest) fail("no latest"); console.log(pkg.latest); }
    else if (!pkg.versions.includes(version)) fail("npm ERR! 404 no version " + version + " for " + name);
    else console.log(version);
  } else if (args[2] === "deprecated") {
    const msg = pkg.deprecated?.[version];
    if (msg) console.log(msg);
  } else fail("unsupported view field: " + args[2]);
} else if (args[0] === "dist-tag" && args[1] === "ls") {
  const pkg = state.packages[args[2]];
  if (!pkg) fail("npm ERR! 404 not found: " + args[2]);
  console.log("latest: " + pkg.latest);
  for (const [tag, version] of Object.entries(pkg.tags ?? {})) console.log(tag + ": " + version);
} else if (args[0] === "dist-tag" && args[1] === "add") {
  const spec = args[2];
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const pkg = state.packages[name];
  if (!pkg || !pkg.versions.includes(version)) fail("npm ERR! cannot tag " + spec);
  pkg.tags = pkg.tags ?? {};
  pkg.tags[args[3]] = version;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log("+" + args[3] + ": " + name + "@" + version);
} else if (args[0] === "deprecate") {
  const spec = args[1];
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const range = spec.slice(at + 1);
  if (range !== "<0.4.0") fail("unexpected deprecate range: " + range);
  const pkg = state.packages[name];
  if (!pkg) fail("npm ERR! 404 not found: " + name);
  pkg.deprecated = pkg.deprecated ?? {};
  // fixture versions are all 0.3.x, so the <0.4.0 range covers every listed version
  for (const version of pkg.versions) pkg.deprecated[version] = args[2];
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log("~" + name);
} else fail("unsupported fixture npm command: " + args.join(" "));
`,
  );
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function run(args, dir, statePath) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PRISM_LEGACY_NPM: makeShim(dir),
      PRISM_LEGACY_FIXTURE: statePath,
      PRISM_LEGACY_PLAN: join(dir, "legacy-registry-plan.json"),
    },
  });
}

function readState(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

test("phase54 legacy registry: message contract names legacy status, exact successor/recipe, and a valid guide anchor", () => {
  const entries = buildPlanEntries(Object.fromEntries(NAMES.map((n) => [n, "0.3.1"])));
  assert.equal(entries.length, 54, "exactly 54 retired names");
  assert.equal(new Set(entries.map((e) => e.name)).size, 54, "retired names are distinct");
  const anchors = guideAnchors(guide);
  assert.ok(anchors.size > 0, "guide headings parsed");
  for (const entry of entries.filter((e) => !UNPUBLISHED.includes(e.name))) {
    assert.ok(entry.message.startsWith("Legacy 0.3 "), `legacy status first: ${entry.name}`);
    assert.ok(entry.message.includes("Prism 0.4+:"), `successor clause present: ${entry.name}`);
    assert.ok(
      entry.message.includes(`https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md${entry.migrationAnchor}`),
      `guide URL+anchor present: ${entry.name}`,
    );
    assert.ok(anchors.has(entry.migrationAnchor.slice(1)), `anchor exists in guide: ${entry.name} -> ${entry.migrationAnchor}`);
    assert.match(entry.distTagCommand, /^npm dist-tag add @arnilo\/prism[^ ]*@\d+\.\d+\.\d+ legacy$/, `tag command shape: ${entry.name}`);
    assert.ok(entry.deprecateCommand.includes('@"<0.4.0"'), `deprecate range: ${entry.name}`);
    assert.ok(entry.deprecateCommand.includes(JSON.stringify(entry.message).slice(1, -1)), `deprecate message: ${entry.name}`);
  }
  assert.equal(new Set(entries.map((e) => e.message)).size, 54, "every warning names its own successor");
  const partial = buildPlanEntries(Object.fromEntries(PUBLISHED.map((n) => [n, "0.3.1"])));
  for (const name of UNPUBLISHED) {
    const entry = partial.find((e) => e.name === name);
    assert.equal(entry.status, "unpublished", `never-published name recorded without mutations: ${name}`);
    assert.equal(entry.finalVersion, null, `no final version for unpublished: ${name}`);
    assert.equal(entry.distTagCommand, null, `no tag command for unpublished: ${name}`);
    assert.equal(entry.deprecateCommand, null, `no deprecate command for unpublished: ${name}`);
  }
});

test("phase54 legacy registry: guide anchors are stable GitHub slugs of real headings", () => {
  const headings = readFileSync(guide, "utf8")
    .split("\n")
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#+\s+/, ""));
  for (const h of headings) {
    assert.ok(guideAnchors(guide).has(githubSlug(h)), `slug round-trips: ${h}`);
  }
  assert.ok(guideAnchors(guide).has("removed-profile-packages"), "profile section anchor present");
});

test("phase54 legacy registry: fixture dry-run plans exactly 54 tags and <0.4.0 deprecations without mutating state", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const before = readFileSync(statePath, "utf8");
  const res = run(["--dry-run"], dir, statePath);
  assert.equal(res.status, 0, `dry-run exit 0\nstderr: ${res.stderr}`);
  const plan = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan.entries.length, 54, "plan covers every retired name");
  assert.equal(plan.summary.unpublished, 2, "never-published names are recorded");
  const publishedEntries = plan.entries.filter((e) => e.status !== "unpublished");
  assert.equal(publishedEntries.length, 52, "52 published retired names");
  assert.equal(new Set(publishedEntries.map((e) => e.distTagCommand)).size, 52, "52 distinct tag commands");
  assert.equal(new Set(publishedEntries.map((e) => e.deprecateCommand)).size, 52, "52 distinct deprecations");
  for (const entry of publishedEntries) {
    assert.equal(entry.status, "pending", "dry-run never marks applied");
  }
  assert.equal(readFileSync(statePath, "utf8"), before, "fixture registry state unmodified");
  for (const pkg of Object.values(readState(statePath).packages)) {
    assert.deepEqual(pkg.tags, {}, "no legacy tag added by dry-run");
    assert.deepEqual(pkg.deprecated, {}, "no deprecation added by dry-run");
  }
});

test("phase54 legacy registry: apply is idempotent and a second apply only skips", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const first = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(first.status, 0, `first apply exit 0\nstderr: ${first.stderr}`);
  const state = readState(statePath);
  for (const name of PUBLISHED) {
    assert.equal(state.packages[name].tags.legacy, "0.3.1", `legacy tag on final release: ${name}`);
    assert.equal(
      state.packages[name].deprecated["0.3.1"],
      legacyMessage(CONSOLIDATION_SPEC.retiredPackages.find((r) => r.name === name)),
      `warning message: ${name}`,
    );
  }
  const afterFirst = readFileSync(statePath, "utf8");
  const plan1 = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan1.summary.applied, 52, "52 published entries applied on first run");
  assert.equal(plan1.summary.unpublished, 2, "never-published entries stay recorded");

  const second = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(second.status, 0, `second apply exit 0\nstderr: ${second.stderr}`);
  assert.equal(readFileSync(statePath, "utf8"), afterFirst, "second apply is a registry no-op");
  const plan2 = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan2.summary.skipped, 52, "already-correct entries are skipped");
  assert.equal(plan2.summary.applied, 0, "no re-application");
});

test("phase54 legacy registry: mismatched tag/warning fails closed with zero mutations; repair resumes", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir, { corruptLegacy: ["@arnilo/prism-browser"], corruptMessage: ["@arnilo/prism-rag"] });
  const before = readFileSync(statePath, "utf8");
  const res = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(res.status, 1, "apply fails closed");
  assert.ok(res.stderr.includes("@arnilo/prism-browser"), "report names the mismatched tag");
  assert.ok(res.stderr.includes("@arnilo/prism-rag"), "report names the mismatched warning");
  assert.ok(res.stderr.includes("unmodified names safe for resume"), "resume report present");
  assert.equal(readFileSync(statePath, "utf8"), before, "zero registry mutations on mismatch");

  // Repair the fixture, then resume: remaining 52 apply, and a later run skips all.
  const state = readState(statePath);
  delete state.packages["@arnilo/prism-browser"].tags.legacy;
  delete state.packages["@arnilo/prism-rag"].deprecated["0.3.1"];
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const resumed = run(["--apply", "--confirm"], dir, statePath);
  assert.equal(resumed.status, 0, `resume exit 0\nstderr: ${resumed.stderr}`);
  const plan = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan.summary.applied, 52, "resume completes all published entries");
});

test("phase54 legacy registry: apply without --confirm refuses and never mutates", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const before = readFileSync(statePath, "utf8");
  const res = run(["--apply"], dir, statePath);
  assert.equal(res.status, 2, "refuses without --confirm");
  assert.ok(res.stderr.includes("--confirm"), "refusal names the gate");
  assert.equal(readFileSync(statePath, "utf8"), before, "no mutation without confirmation");
});

function mkdtemp() {
  const dir = mkdtempSync(join(tmpdir(), "prism-legacy-registry-"));
  return dir;
}
