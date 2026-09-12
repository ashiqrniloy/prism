import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadUpstreamSkills, PONYTAIL_SKILL_NAMES, requirePonytailSkills } from "../skills.js";
import { MAX_SKILL_FILE_BYTES, PONYTAIL_PEER_PACKAGE, readBoundedFile, resolveUpstreamRoot, UpstreamResolveError } from "../upstream.js";

/**
 * Contract smoke tests against the real optional peer installed as a devDependency
 * (see plan 070 Task 3). Fixture suites cover fail-closed paths; these cover the
 * documented floor's packaging layout: peer root discovery, `skills/` marker,
 * skill parsing within caps, and bounded reads of peer files.
 */
describe("ponytail real peer contract", () => {
  it("resolveUpstreamRoot_finds_real_peer_without_path", () => {
    const root = resolveUpstreamRoot();
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string; version?: string };
    assert.equal(manifest.name, PONYTAIL_PEER_PACKAGE);
    assert.equal(manifest.version?.split(".")[0], "4", "declared peer range is ^4.9.0");
  });

  it("loadUpstreamSkills_parses_every_required_skill_from_real_peer", () => {
    const skills = loadUpstreamSkills(resolveUpstreamRoot());
    assert.ok(skills.length >= 1);
    const byName = requirePonytailSkills(skills);
    for (const name of PONYTAIL_SKILL_NAMES) {
      assert.ok(byName.get(name)?.instructions?.trim(), `upstream skill ${name} must carry instructions`);
    }
  });

  it("readBoundedFile_enforces_the_skill_cap_on_peer_files", () => {
    const root = resolveUpstreamRoot();
    assert.ok(readBoundedFile(root, join("skills", "ponytail", "SKILL.md"), MAX_SKILL_FILE_BYTES).includes("ponytail"));
    assert.throws(() => readBoundedFile(root, join("skills", "ponytail", "SKILL.md"), 8), UpstreamResolveError);
    assert.throws(() => readBoundedFile(root, "../package.json", MAX_SKILL_FILE_BYTES), UpstreamResolveError);
  });

  it("resolveUpstreamRoot_still_fails_closed_for_an_uninstalled_package", () => {
    assert.throws(
      () => resolveUpstreamRoot({ packageName: "@arnilo/prism-ponytail-fixture-missing-peer" }),
      (error: unknown) => error instanceof UpstreamResolveError && error.code === "upstream_resolve_failed",
    );
  });
});
