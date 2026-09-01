import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import {
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  recallObservationalMemory,
  recallObservationalMemoryBranchPage,
} from "../index.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Prefer the shortest path; token secret-value" }] },
};
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "User prefers shortest path.",
  timestamp: source.timestamp,
  relevance: "high",
  sourceEntryIds: [source.id, "missing"],
  tokenCount: 5,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Prefer minimal package-only changes.",
  supportingObservationIds: [observation.id],
  tokenCount: 5,
};

function custom(id: string, data: unknown): SessionEntry {
  return { id, sessionId: "s1", timestamp: source.timestamp, kind: "custom", data };
}

describe("observational memory recall", () => {
  it("observational_memory_recall_observation_returns_current_branch_sources", () => {
    const result = recallObservationalMemory(
      [source, custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] })],
      observation.id,
      ["secret-value"],
    );
    assert.equal(result.found, true);
    assert.equal(result.kind, "observation");
    assert.deepEqual(
      result.sourceEntries?.map((entry) => entry.id),
      [source.id],
    );
    assert.deepEqual(result.missingSourceEntryIds, ["missing"]);
    assert.doesNotMatch(result.text, /secret-value/);
  });

  it("observational_memory_recall_reflection_returns_dropped_supporting_observations", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("r", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
        custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
      ],
      reflection.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.kind, "reflection");
    assert.deepEqual(
      result.supportingObservations?.map((item) => item.id),
      [observation.id],
    );
    assert.deepEqual(result.droppedSupportingObservationIds, [observation.id]);
    assert.match(result.text, /\(dropped\)/);
    assert.deepEqual(
      result.sourceEntries?.map((entry) => entry.id),
      [source.id],
    );
  });

  it("observational_memory_recall_reflection_returns_supporting_observation_sources", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("r", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
      ],
      reflection.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.kind, "reflection");
    assert.deepEqual(
      result.supportingObservations?.map((item) => item.id),
      [observation.id],
    );
    assert.match(result.text, /Supporting observations/);
    assert.match(result.text, /Source evidence/);
  });

  it("observational_memory_recall_invalid_or_missing_id_fails_closed", () => {
    assert.deepEqual(recallObservationalMemory([], "not-an-id").reason, "invalid_id");
    assert.deepEqual(recallObservationalMemory([], "cccccccccccc").reason, "not_found");
  });

  it("observational_memory_recall_reports_dropped_observation", () => {
    const result = recallObservationalMemory(
      [
        source,
        custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
        custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
      ],
      observation.id,
    );

    assert.equal(result.found, true);
    assert.equal(result.dropped, true);
    assert.match(result.text, /dropped/);
  });

  it("observational_memory_branch_page_pages_backward_and_forward", () => {
    const m = (id: string, text: string): SessionEntry => ({
      id,
      sessionId: "s1",
      timestamp: source.timestamp,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    const entries = [m("m1", "one"), m("m2", "two"), m("m3", "three"), m("m4", "four")];
    const backward = recallObservationalMemoryBranchPage(entries, { cursor: "m3", limit: 2, direction: "backward" });
    assert.equal(backward.found, true);
    assert.deepEqual(
      backward.entries.map((entry) => entry.id),
      ["m2", "m3"],
    );
    assert.equal(backward.nextCursor, "m1");

    const forward = recallObservationalMemoryBranchPage(entries, { cursor: "m2", limit: 2, direction: "forward" });
    assert.deepEqual(
      forward.entries.map((entry) => entry.id),
      ["m2", "m3"],
    );
    assert.equal(forward.nextCursor, "m4");
  });

  it("observational_memory_branch_page_fails_closed_for_missing_or_invalid_cursor", () => {
    const entries = [source];
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "" }).reason, "invalid_cursor");
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "missing" }).reason, "cursor_not_found");
    assert.equal(
      recallObservationalMemoryBranchPage([source, custom("x", { type: OBSERVATIONS_RECORDED, observations: [] })], {
        cursor: "x",
      }).reason,
      "cursor_not_message",
    );
    assert.equal(recallObservationalMemoryBranchPage(entries, { cursor: "m1", limit: 10_000 }).reason, "limit_exceeded");
  });
});
