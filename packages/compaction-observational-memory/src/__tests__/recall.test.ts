import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "prism";
import { OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, recallObservationalMemory, REFLECTIONS_RECORDED, type MemoryObservation, type MemoryReflection } from "../index.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Prefer the shortest path; token secret-value" }] },
};
const observation: MemoryObservation = { id: "aaaaaaaaaaaa", content: "User prefers shortest path.", timestamp: source.timestamp, relevance: "high", sourceEntryIds: [source.id, "missing"], tokenCount: 5 };
const reflection: MemoryReflection = { id: "bbbbbbbbbbbb", content: "Prefer minimal package-only changes.", supportingObservationIds: [observation.id], tokenCount: 5 };

function custom(id: string, data: unknown): SessionEntry {
  return { id, sessionId: "s1", timestamp: source.timestamp, kind: "custom", data };
}

describe("observational memory recall", () => {
  it("observational_memory_recall_observation_returns_current_branch_sources", () => {
    const result = recallObservationalMemory([source, custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] })], observation.id, ["secret-value"]);
    assert.equal(result.found, true);
    assert.equal(result.kind, "observation");
    assert.deepEqual(result.sourceEntries?.map((entry) => entry.id), [source.id]);
    assert.deepEqual(result.missingSourceEntryIds, ["missing"]);
    assert.doesNotMatch(result.text, /secret-value/);
  });

  it("observational_memory_recall_reflection_returns_supporting_observation_sources", () => {
    const result = recallObservationalMemory([
      source,
      custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      custom("r", { type: REFLECTIONS_RECORDED, reflections: [reflection] }),
    ], reflection.id);

    assert.equal(result.found, true);
    assert.equal(result.kind, "reflection");
    assert.deepEqual(result.supportingObservations?.map((item) => item.id), [observation.id]);
    assert.match(result.text, /Supporting observations/);
    assert.match(result.text, /Source evidence/);
  });

  it("observational_memory_recall_invalid_or_missing_id_fails_closed", () => {
    assert.deepEqual(recallObservationalMemory([], "not-an-id").reason, "invalid_id");
    assert.deepEqual(recallObservationalMemory([], "cccccccccccc").reason, "not_found");
  });

  it("observational_memory_recall_reports_dropped_observation", () => {
    const result = recallObservationalMemory([
      source,
      custom("o", { type: OBSERVATIONS_RECORDED, observations: [observation] }),
      custom("d", { type: OBSERVATIONS_DROPPED, observationIds: [observation.id] }),
    ], observation.id);

    assert.equal(result.found, true);
    assert.equal(result.dropped, true);
    assert.match(result.text, /dropped/);
  });
});
