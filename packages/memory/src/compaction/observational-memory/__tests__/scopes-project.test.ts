import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import {
  buildObservationalMemoryContextBlocks,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  OBSERVATIONS_RECORDED,
  projectWorkMemory,
  recallObservationalMemory,
  REFLECTIONS_RECORDED,
  renderObservationalMemory,
  SESSION_WORK_SCOPE_ID,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_CLOSED,
  WORK_SCOPE_ENTERED,
  WORK_SCOPE_OPENED,
  type MemoryObservation,
  type MemoryReflection,
  type ProjectWorkMemoryOptions,
} from "../index.js";

const now = "2026-09-15T00:00:00.000Z";
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "task one only",
  timestamp: now,
  relevance: "high",
  sourceEntryIds: ["source"],
  tokenCount: 3,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "task one reflection",
  supportingObservationIds: [observation.id],
  tokenCount: 3,
};

function entry(id: string, data: unknown): SessionEntry {
  return { id, sessionId: "scopes", timestamp: now, kind: "custom", data };
}

function scope(id: string, parentId?: string, kind = "task", label = id): SessionEntry {
  return entry(`open-${id}`, { type: WORK_SCOPE_OPENED, id, ...(parentId === undefined ? {} : { parentId }), kind, label });
}

function project(entries: readonly SessionEntry[], options: ProjectWorkMemoryOptions) {
  return projectWorkMemory(foldObservationalMemoryLedger(entries), foldWorkScopeMap(entries), options);
}

function taskEntries(): readonly SessionEntry[] {
  return [
    entry("observations", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
    entry("reflections", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
    scope("phase:1", SESSION_WORK_SCOPE_ID, "phase", "secret-value phase"),
    scope("plan:1", "phase:1", "plan"),
    scope("task:1", "plan:1"),
    scope("task:15", "plan:1", "task", "Task fifteen"),
    entry("bind-task-1", { type: WORK_SCOPE_BOUND, scopeId: "task:1", refs: ["om:aaaaaaaaaaaa", "reflection:bbbbbbbbbbbb"] }),
    entry("enter-task-15", { type: WORK_SCOPE_ENTERED, scopeId: "task:15" }),
  ];
}

describe("observational memory work-scope projection", () => {
  it("task15_does_not_see_task1_until_bind_on_plan", () => {
    const before = project(taskEntries(), { from: "task:15", include: "self+ancestors" });
    assert.deepEqual(before.observations, []);
    assert.deepEqual(before.reflections, []);

    const after = project(
      [
        ...taskEntries(),
        entry("bind-plan", { type: WORK_SCOPE_BOUND, scopeId: "plan:1", refs: ["om:aaaaaaaaaaaa", "reflection:bbbbbbbbbbbb"] }),
      ],
      { from: "task:15", include: "self+ancestors" },
    );
    assert.deepEqual(
      after.observations.map((item) => item.id),
      [observation.id],
    );
    assert.deepEqual(
      after.reflections.map((item) => item.id),
      [reflection.id],
    );
    assert.deepEqual(
      project(taskEntries(), { from: "task:1", include: "self" }).observations.map((item) => item.id),
      [observation.id],
    );
    assert.deepEqual(
      project([...taskEntries(), entry("bind-plan", { type: WORK_SCOPE_BOUND, scopeId: "plan:1", refs: ["om:aaaaaaaaaaaa"] })], {
        from: "plan:1",
        include: "lineage",
      }).observations.map((item) => item.id),
      [observation.id],
    );
  });

  it("closed_ancestor_still_in_self_plus_ancestors", () => {
    const entries = [
      entry("observations", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      scope("phase:1", SESSION_WORK_SCOPE_ID, "phase"),
      scope("plan:1", "phase:1", "plan"),
      scope("task:1", "plan:1"),
      entry("bind-phase", { type: WORK_SCOPE_BOUND, scopeId: "phase:1", refs: ["om:aaaaaaaaaaaa"] }),
      entry("close-phase", { type: WORK_SCOPE_CLOSED, scopeId: "phase:1" }),
    ];
    const view = project(entries, { from: "task:1", include: "self+ancestors", closed: "hide" });
    assert.deepEqual(
      view.outline.map((item) => item.id),
      [SESSION_WORK_SCOPE_ID, "phase:1", "plan:1", "task:1"],
    );
    assert.deepEqual(
      view.observations.map((item) => item.id),
      [observation.id],
    );
  });

  it("closed_hide_omits_closed_non_ancestors", () => {
    const entries = [
      entry("observations", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      scope("phase:library", SESSION_WORK_SCOPE_ID, "phase"),
      entry("bind-library", { type: WORK_SCOPE_BOUND, scopeId: "phase:library", refs: ["om:aaaaaaaaaaaa"] }),
      entry("close-library", { type: WORK_SCOPE_CLOSED, scopeId: "phase:library" }),
      scope("task:15"),
    ];
    const view = project(entries, { from: SESSION_WORK_SCOPE_ID, include: "self+descendants", closed: "hide" });
    assert.equal(
      view.outline.some((item) => item.id === "phase:library"),
      false,
    );
    assert.deepEqual(view.observations, []);
  });

  it("closed_include_returns_closed_phase_library", () => {
    const entries = [
      entry("observations", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      scope("phase:library", SESSION_WORK_SCOPE_ID, "phase"),
      entry("bind-library", { type: WORK_SCOPE_BOUND, scopeId: "phase:library", refs: ["om:aaaaaaaaaaaa"] }),
      entry("close-library", { type: WORK_SCOPE_CLOSED, scopeId: "phase:library" }),
    ];
    const view = project(entries, { from: SESSION_WORK_SCOPE_ID, include: "self+descendants", closed: "include" });
    assert.deepEqual(
      view.observations.map((item) => item.id),
      [observation.id],
    );
    assert.equal(
      view.outline.some((item) => item.id === "phase:library"),
      true,
    );
  });

  it("unscoped_projection_equals_active_pool", () => {
    const entries = [
      entry("observations", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      entry("reflections", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
    ];
    const view = project(entries, { from: SESSION_WORK_SCOPE_ID, include: "self+ancestors" });
    assert.deepEqual(view.observations, [observation]);
    assert.deepEqual(view.reflections, [reflection]);
    assert.deepEqual(view.outline, []);
  });

  it("render_outline_then_reflections_then_observations", () => {
    const text = renderObservationalMemory([reflection], [observation], {
      outline: [{ id: "task:15", label: "secret-value task" }],
      secrets: ["secret-value"],
    });
    assert.ok(text.indexOf("## Scope Outline") < text.indexOf("## Reflections"));
    assert.ok(text.indexOf("## Reflections") < text.indexOf("## Observations"));
    assert.match(text, /task:15/);
    assert.doesNotMatch(text, /secret-value/);
  });

  it("recall_by_id_ignores_projection", () => {
    const entries = taskEntries();
    assert.deepEqual(project(entries, { from: "task:15", include: "self+ancestors" }).observations, []);
    assert.equal(recallObservationalMemory(entries, observation.id).found, true);
  });

  it("context_block_uses_projection_when_host_scopes_exist", () => {
    const blocks = buildObservationalMemoryContextBlocks(taskEntries(), { secrets: ["secret-value"] });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.title, "observational-memory");
    assert.match(String(blocks[0]?.content), /## Scope Outline/);
    assert.match(String(blocks[0]?.content), /Task fifteen/);
    assert.doesNotMatch(String(blocks[0]?.content), /task one only|secret-value/);
  });
});
