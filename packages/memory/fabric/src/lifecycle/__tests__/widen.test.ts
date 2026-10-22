/** Plan 188.4 Task 6: the widening and narrowing decisions, without a store or a write. */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { resolveLifecycleConfig } from "../../config.js";
import type { MemoryNoteMetadata, MemoryNoteStatus } from "../../types.js";
import type { CapacityNote } from "../capacity.js";
import { crossProjectGroups, narrowingCandidates, siblingGroups, type WidenNote } from "../widen.js";

function at(
  project: string,
  id: string,
  fields: Partial<Omit<MemoryNoteMetadata, "v">>,
  text = "Drain the canary pool before a rollback",
): WidenNote {
  return {
    project,
    id,
    text,
    tokens: Math.ceil(text.length / 4),
    status: "verified" as MemoryNoteStatus,
    metadata: { v: 1, kind: "fact", ...fields },
  };
}

describe("widening decisions (plan 188.4 Task 6)", () => {
  it("one_key_in_two_projects_widens_and_the_strongest_note_survives", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain", useSessions: 1 }),
      at("projects/b--22222222", "b1".padEnd(12, "0"), { key: "canary.drain", useSessions: 4 }),
    ];
    const groups = crossProjectGroups(notes);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.survivor.id, "b1".padEnd(12, "0"), "the most used note supplies the text");
    assert.deepEqual(groups[0]!.projects, ["projects/a--11111111", "projects/b--22222222"]);
    assert.deepEqual(
      groups[0]!.others.map((note) => note.id),
      ["a1".padEnd(12, "0")],
    );
  });

  it("a_single_project_never_widens_and_the_floor_cannot_be_lowered", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain" }),
      at("projects/a--11111111", "a2".padEnd(12, "0"), { key: "canary.drain" }),
    ];
    assert.deepEqual(crossProjectGroups(notes), []);
    assert.deepEqual(crossProjectGroups(notes, { minProjects: 1 }), [], "replication is the poisoning bound");
  });

  it("keyless_notes_match_on_their_text_only_when_it_is_readable", () => {
    const near = "Drain the canary pool before every rollback";
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), {}, near),
      at("projects/b--22222222", "b1".padEnd(12, "0"), {}, near),
      { ...at("projects/c--33333333", "c1".padEnd(12, "0"), {}, near), text: undefined },
    ];
    assert.equal(crossProjectGroups(notes).length, 1);
    const unrelated = [
      at("projects/a--11111111", "a2".padEnd(12, "0"), {}, near),
      at("projects/b--22222222", "b2".padEnd(12, "0"), {}, "Tag every release twice"),
    ];
    assert.deepEqual(crossProjectGroups(unrelated), []);
  });

  it("harmful_contradicted_pinned_or_unverified_notes_are_not_widenable", () => {
    const clean = { key: "canary.drain" };
    for (const [label, blocker] of [
      ["harmful", { harmful: 1 }],
      ["contradicted", { contradictedIn: ["a--11111111"] }],
      ["pinned", { pinned: true }],
    ] as const) {
      const notes = [
        at("projects/a--11111111", "a1".padEnd(12, "0"), { ...clean, ...blocker }),
        at("projects/b--22222222", "b1".padEnd(12, "0"), { ...clean, ...blocker }),
      ];
      assert.deepEqual(crossProjectGroups(notes), [], label);
    }
    const candidate = [at("projects/a--11111111", "a1".padEnd(12, "0"), clean), at("projects/b--22222222", "b1".padEnd(12, "0"), clean)];
    for (const note of candidate) (note as { status: MemoryNoteStatus }).status = "candidate";
    assert.deepEqual(crossProjectGroups(candidate), [], "a candidate has to be verified first");
  });

  it("path_notes_widen_when_their_globs_cover_sibling_subtrees", () => {
    const path = (id: string, appliesTo: readonly string[], key = "tests.run"): CapacityNote => ({
      id: id.padEnd(12, "0"),
      tokens: 4,
      text: "Run the integration suite before merging",
      status: "verified",
      metadata: { v: 1, kind: "fact", scope: "path", key, appliesTo },
    });
    const siblings = siblingGroups([path("a1", ["src/api/**"]), path("b1", ["src/web/**"]), path("c1", ["src/api/**"], "api.client")]);
    assert.equal(siblings.length, 1);
    assert.equal(siblings[0]!.key, "tests.run");
    assert.deepEqual(siblings[0]!.subtrees, ["src/api", "src/web"]);
    assert.equal(siblings[0]!.survivor.text, "Run the integration suite before merging");
    // Different parents are not siblings, and one subtree is not a pattern.
    assert.deepEqual(siblingGroups([path("a2", ["src/api/**"]), path("b2", ["tests/api/**"])]), []);
    assert.deepEqual(siblingGroups([path("a3", ["src/api/**"]), path("b3", ["src/api/**"])]), []);
  });

  it("same_key_different_project_values_do_not_widen", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain" }, "Drain the canary pool before a rollback"),
      at("projects/b--22222222", "b1".padEnd(12, "0"), { key: "canary.drain" }, "Drain the canary pool after a rollback"),
    ];
    assert.deepEqual(crossProjectGroups(notes), []);
    // A third agreeing project never bridges a contested subject.
    notes.push(at("projects/c--33333333", "c1".padEnd(12, "0"), { key: "canary.drain" }, "Drain the canary pool before a rollback"));
    assert.deepEqual(crossProjectGroups(notes), []);
  });

  it("opposite_keyless_instructions_do_not_widen", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), {}, "Always drain the canary pool before a rollback"),
      at("projects/b--22222222", "b1".padEnd(12, "0"), {}, "Never drain the canary pool before a rollback"),
    ];
    assert.deepEqual(crossProjectGroups(notes), []);
  });

  it("unreadable_project_is_not_agreement_evidence", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain" }),
      { ...at("projects/b--22222222", "b1".padEnd(12, "0"), { key: "canary.drain" }), text: undefined },
    ];
    assert.deepEqual(crossProjectGroups(notes), []);
    // A third readable project does not make an unreadable witness safe.
    notes.push(at("projects/c--33333333", "c1".padEnd(12, "0"), { key: "canary.drain" }));
    assert.deepEqual(crossProjectGroups(notes), []);
  });

  it("copied_source_is_not_independent_corroboration", () => {
    const source = { sourceEntryIds: ["same-session-entry"] };
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain", ...source }),
      at("projects/b--22222222", "b1".padEnd(12, "0"), { key: "canary.drain", ...source }),
    ];
    assert.deepEqual(crossProjectGroups(notes), []);
    notes[1] = at("projects/b--22222222", "b2".padEnd(12, "0"), { key: "canary.drain", sourceEntryIds: ["other-entry"] });
    assert.equal(crossProjectGroups(notes).length, 1);
  });

  it("independent_identical_lessons_still_widen", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), { key: "canary.drain" }, "Drain  the canary pool before a rollback."),
      at("projects/b--22222222", "b1".padEnd(12, "0"), { key: "canary.drain" }, "drain the canary pool before a rollback"),
    ];
    assert.equal(crossProjectGroups(notes).length, 1);
  });

  it("same_project_bound_value_in_two_projects_is_not_global_truth", () => {
    const notes = [
      at("projects/alpha--11111111", "a1".padEnd(12, "0"), { key: "deploy.region" }, "alpha region = eu-west"),
      at("projects/beta--22222222", "b1".padEnd(12, "0"), { key: "deploy.region" }, "alpha region = eu-west"),
    ];
    assert.deepEqual(crossProjectGroups(notes), [], "text naming a resource is project-bound");
  });

  it("similarity_chains_cannot_bridge_conflicting_groups", () => {
    const notes = [
      at("projects/a--11111111", "a1".padEnd(12, "0"), {}, "always flush before retry"),
      at("projects/b--22222222", "b1".padEnd(12, "0"), {}, "always flush before retry now"),
      at("projects/c--33333333", "c1".padEnd(12, "0"), {}, "never flush before retry"),
    ];
    assert.deepEqual(crossProjectGroups(notes), [], "no lexical chain between always and never");
  });

  it("multiple_globs_do_not_forge_independent_corroboration", () => {
    const path = (id: string, appliesTo: readonly string[]): CapacityNote => ({
      id: id.padEnd(12, "0"),
      tokens: 4,
      text: "Run the integration suite before merging",
      status: "verified",
      metadata: { v: 1, kind: "fact", scope: "path", key: "tests.run", appliesTo },
    });
    assert.deepEqual(siblingGroups([path("a1", ["src/api/**", "src/web/**"]), path("b1", ["src/api/**"])]), []);
    assert.equal(siblingGroups([path("a1", ["src/api/**", "src/web/**"])]).length, 0);
  });

  it("conflicting_sibling_values_and_kinds_do_not_widen", () => {
    const path = (id: string, text: string, kind: "fact" | "procedure" = "fact"): CapacityNote => ({
      id: id.padEnd(12, "0"),
      tokens: 4,
      text,
      status: "verified",
      metadata: { v: 1, kind, scope: "path", key: "tests.run", appliesTo: [`${id}/**`] },
    });
    assert.deepEqual(siblingGroups([path("api", "Run integration tests"), path("web", "Never run integration tests")]), []);
    assert.deepEqual(siblingGroups([path("api", "Run integration tests"), path("web", "Run integration tests", "procedure")]), []);
  });

  it("large_same_key_bucket_stays_deterministic_and_bounded", () => {
    const notes = Array.from({ length: 10_000 }, (_, index) =>
      at(`projects/${index % 2 === 0 ? "a--11111111" : "b--22222222"}`, `n${String(index).padStart(11, "0")}`, {
        key: "canary.drain",
        useSessions: index % 5,
      }),
    );
    const started = performance.now();
    const groups = crossProjectGroups(notes);
    const elapsed = performance.now() - started;
    assert.equal(groups.length, 1);
    assert.ok(elapsed < 2_000, `large bucket took ${elapsed.toFixed(0)}ms`);
    assert.deepEqual(groups, crossProjectGroups([...notes].reverse()), "grouping and tie-breaks are deterministic");
  });

  it("contradicted_notes_narrow_at_the_threshold", () => {
    const note = (id: string, contradictedIn: readonly string[]): CapacityNote => ({
      id: id.padEnd(12, "0"),
      tokens: 1,
      status: "verified",
      metadata: { v: 1, kind: "preference", contradictedIn },
    });
    assert.deepEqual(narrowingCandidates([note("a1", ["a--11111111"])]), []);
    assert.deepEqual(narrowingCandidates([note("b1", ["a--11111111", "b--22222222"])]), ["b1".padEnd(12, "0")]);
    assert.deepEqual(narrowingCandidates([note("c1", ["a--11111111"])], 1), [], "a caller cannot go below two");
  });

  it("resolver_bounds_widen", () => {
    const defaults = resolveLifecycleConfig(undefined).widen;
    assert.deepEqual(defaults, { minProjects: 2, minSiblings: 2, contradictionsToSupersede: 2 });
    assert.deepEqual(resolveLifecycleConfig({ widen: { minProjects: 3, minSiblings: 4, contradictionsToSupersede: 5 } }).widen, {
      minProjects: 3,
      minSiblings: 4,
      contradictionsToSupersede: 5,
    });
    assert.throws(() => resolveLifecycleConfig({ widen: { minProjects: 1 } }), /minProjects must be an integer in \[2,10\]/);
    assert.throws(() => resolveLifecycleConfig({ widen: { minSiblings: 1 } }), /minSiblings/);
    assert.throws(() => resolveLifecycleConfig({ widen: { contradictionsToSupersede: 99 } }), /contradictionsToSupersede/);
  });
});
