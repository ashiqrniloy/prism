import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import {
  buildObservationalMemoryProjection,
  createFoldedMemoryDetails,
  FOLDED_MEMORY,
  foldObservationalMemoryLedger,
  isMemoryId,
  isMemoryObservation,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  renderObservationalMemory,
  type MemoryObservation,
  type MemoryReflection,
} from "../index.js";

const obs: MemoryObservation = { id: "aaaaaaaaaaaa", content: "User prefers minimal diffs.", timestamp: "2026-06-20T00:00:00.000Z", relevance: "high", sourceEntryIds: ["m1"], tokenCount: 6 };
const reflection: MemoryReflection = { id: "bbbbbbbbbbbb", content: "Keep implementation package-only.", supportingObservationIds: [obs.id], tokenCount: 5 };

function entry(id: string, data?: unknown, kind: SessionEntry["kind"] = "custom"): SessionEntry {
  return { id, sessionId: "s1", timestamp: "2026-06-20T00:00:00.000Z", kind, data };
}

describe("observational memory ledger", () => {
  it("observational_memory_validates_memory_ids_and_records", () => {
    assert.equal(isMemoryId("abcdef123456"), true);
    assert.equal(isMemoryId("ABCDEF123456"), false);
    assert.equal(isMemoryObservation(obs), true);
    assert.equal(isMemoryObservation({ ...obs, content: "two\nlines" }), false);
  });

  it("observational_memory_fold_ignores_invalid_unknown_entries", () => {
    const ledger = foldObservationalMemoryLedger([
      entry("x", { type: "other", observations: [obs] }),
      entry("o", { type: OBSERVATIONS_RECORDED, observations: [obs, { ...obs, id: "bad" }], coversUpToId: "m1" }),
      entry("dup", { type: OBSERVATIONS_RECORDED, observations: [{ ...obs, content: "changed" }] }),
      entry("r", { type: REFLECTIONS_RECORDED, reflections: [reflection], coversUpToId: "o" }),
      entry("d", { type: OBSERVATIONS_DROPPED, observationIds: [obs.id], coversUpToId: "r" }),
    ]);

    assert.equal(ledger.observations[0]?.content, obs.content);
    assert.deepEqual(ledger.reflections, [reflection]);
    assert.deepEqual(ledger.droppedObservationIds, [obs.id]);
    assert.equal(ledger.latestObservationCoverageId, "m1");
  });

  it("observational_memory_projection_tracks_visible_full_and_folded_details", () => {
    const folded = createFoldedMemoryDetails({ observations: [obs], reflections: [reflection], droppedObservationIds: [] }, true);
    const projection = buildObservationalMemoryProjection([
      entry("m1", undefined, "message"),
      entry("c", { throughEntryId: "m1", memory: folded }, "compaction"),
    ]);

    assert.equal(projection.folded?.type, FOLDED_MEMORY);
    assert.equal(projection.folded?.fullFold, true);
    assert.deepEqual(projection.observations, [obs]);
    assert.deepEqual(projection.full.reflections, [reflection]);
  });

  it("observational_memory_render_includes_reflections_observations_and_recall_guidance", () => {
    const rendered = renderObservationalMemory([reflection], [obs], ["secret-value"]);
    assert.match(rendered, /call recall with a 12-character id/);
    assert.match(rendered, /\[bbbbbbbbbbbb\]/);
    assert.match(rendered, /\[aaaaaaaaaaaa\]/);
    assert.doesNotMatch(rendered, /secret-value/);
  });
});
