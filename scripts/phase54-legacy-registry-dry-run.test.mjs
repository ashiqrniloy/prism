// scripts/phase54-legacy-registry-dry-run.test.mjs
// Plan 054 Task 7 legacy npm dist-tag + deprecation plan tests: the pure message/anchor
// contract and the offline dry-run. Plan 115 Task 2 split the single critical-path file
// into one file per independent mkdtemp() scenario so `node --test` workers overlap the
// three slow registry runs; every assertion is unchanged. Fixture shim:
// scripts/fixtures/phase54-legacy-registry-fixture.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { guide, makeFixture, mkdtemp, NAMES, PUBLISHED, readState, run, UNPUBLISHED } from "./fixtures/phase54-legacy-registry-fixture.mjs";
import { buildPlanEntries, githubSlug, guideAnchors } from "./phase54-legacy-registry.mjs";

test("phase54 legacy registry: message contract names legacy status, exact successor/recipe, and a valid guide anchor", () => {
  const entries = buildPlanEntries(Object.fromEntries(NAMES.map((n) => [n, "0.3.1"])));
  assert.equal(entries.length, 55, "exactly 55 retired names");
  assert.equal(new Set(entries.map((e) => e.name)).size, 55, "retired names are distinct");
  const anchors = guideAnchors(guide);
  assert.ok(anchors.size > 0, "guide headings parsed");
  for (const entry of entries.filter((e) => !UNPUBLISHED.includes(e.name))) {
    assert.ok(entry.message.startsWith("Legacy 0.3 "), `legacy status first: ${entry.name}`);
    assert.ok(entry.message.includes("Prism 0.4+:"), `successor clause present: ${entry.name}`);
    assert.ok(
      entry.message.includes(`https://github.com/ashiqrniloy/prism/blob/main/docs/history/migrate-to-0.4.md${entry.migrationAnchor}`),
      `guide URL+anchor present: ${entry.name}`,
    );
    assert.ok(anchors.has(entry.migrationAnchor.slice(1)), `anchor exists in guide: ${entry.name} -> ${entry.migrationAnchor}`);
    assert.match(entry.distTagCommand, /^npm dist-tag add @arnilo\/prism[^ ]*@\d+\.\d+\.\d+ legacy$/, `tag command shape: ${entry.name}`);
    assert.ok(entry.deprecateCommand.includes('@"<0.4.0"'), `deprecate range: ${entry.name}`);
    assert.ok(entry.deprecateCommand.includes(JSON.stringify(entry.message).slice(1, -1)), `deprecate message: ${entry.name}`);
  }
  assert.equal(new Set(entries.map((e) => e.message)).size, 55, "every warning names its own successor");
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

test("phase54 legacy registry: fixture dry-run plans exactly 55 tags and <0.4.0 deprecations without mutating state", () => {
  const dir = mkdtemp();
  const statePath = makeFixture(dir);
  const before = readFileSync(statePath, "utf8");
  const res = run(["--dry-run"], dir, statePath);
  assert.equal(res.status, 0, `dry-run exit 0\nstderr: ${res.stderr}`);
  const plan = JSON.parse(readFileSync(join(dir, "legacy-registry-plan.json"), "utf8"));
  assert.equal(plan.entries.length, 55, "plan covers every retired name");
  assert.equal(plan.summary.unpublished, 2, "never-published names are recorded");
  const publishedEntries = plan.entries.filter((e) => e.status !== "unpublished");
  assert.equal(publishedEntries.length, 53, "53 published retired names");
  assert.equal(new Set(publishedEntries.map((e) => e.distTagCommand)).size, 53, "53 distinct tag commands");
  assert.equal(new Set(publishedEntries.map((e) => e.deprecateCommand)).size, 53, "53 distinct deprecations");
  for (const entry of publishedEntries) {
    assert.equal(entry.status, "pending", "dry-run never marks applied");
  }
  assert.equal(readFileSync(statePath, "utf8"), before, "fixture registry state unmodified");
  for (const pkg of Object.values(readState(statePath).packages)) {
    assert.deepEqual(pkg.tags, {}, "no legacy tag added by dry-run");
    assert.deepEqual(pkg.deprecated, {}, "no deprecation added by dry-run");
  }
});
