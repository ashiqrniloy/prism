import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@arnilo/prism";
import {
  foldObservationalMemoryLedger,
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "../../index.js";
import { buildObservationalMemoryProjection, createFoldedMemoryDetails } from "../projection.js";
import { recallObservationalMemory } from "../recall.js";
import { renderObservationalMemory } from "../render.js";
import { FOLDED_MEMORY, isMemoryId, isMemoryObservation, OBSERVATIONS_DROPPED } from "../types.js";

const obs: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  kind: "statement",
  description: "User prefers minimal diffs.",
  timestamp: "2026-06-20T00:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 6,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Keep implementation package-only.",
  supportingObservationIds: [obs.id],
  tokenCount: 5,
};

function entry(id: string, data?: unknown, kind: SessionEntry["kind"] = "custom"): SessionEntry {
  return { id, sessionId: "s1", timestamp: "2026-06-20T00:00:00.000Z", kind, data };
}

describe("observational memory ledger", () => {
  it("observational_memory_validates_memory_ids_and_records", () => {
    assert.equal(isMemoryId("abcdef123456"), true);
    assert.equal(isMemoryId("ABCDEF123456"), false);
    assert.equal(isMemoryObservation(obs), true);
    assert.equal(isMemoryObservation({ ...obs, description: "two\nlines" }), false);
  });

  it("observational_memory_fold_ignores_invalid_unknown_entries", () => {
    const ledger = foldObservationalMemoryLedger([
      entry("x", { type: "other", observations: [obs] }),
      entry("o", { type: OBSERVATIONS_RECORDED, observations: [obs, { ...obs, id: "bad" }], coversUpToId: "m1" }),
      entry("dup", { type: OBSERVATIONS_RECORDED, observations: [{ ...obs, description: "changed" }] }),
      entry("r", { type: REFLECTIONS_RECORDED, reflections: [reflection], coversUpToId: "o" }),
      entry("d", { type: OBSERVATIONS_DROPPED, observationIds: [obs.id], coversUpToId: "r" }),
    ]);

    assert.equal(ledger.observations[0]?.description, obs.description);
    assert.deepEqual(ledger.reflections, [reflection]);
    assert.deepEqual(ledger.droppedObservationIds, [obs.id]);
    assert.equal(ledger.latestObservationCoverageId, "m1");
  });

  it("observational_memory_fold_reads_a_package_log_record_off_the_branch", () => {
    // `state.log` keeps records as `package_state` entries whose payload is `data.value`; a consumer
    // that only has the branch (the memory fabric) must fold the same ledger `SessionLog.entries` returns.
    const recorded = entry(
      "ps1",
      {
        schemaVersion: 1,
        package: "arnilo:prism-memory-system",
        key: "memory.session.ledger",
        op: "append",
        value: { type: OBSERVATIONS_RECORDED, observations: [obs], coversUpToId: "m1" },
      },
      "package_state",
    );
    const reflected = entry(
      "ps2",
      {
        schemaVersion: 1,
        package: "arnilo:prism-memory-system",
        key: "memory.session.ledger",
        op: "append",
        value: { type: REFLECTIONS_RECORDED, reflections: [reflection], coversUpToId: "m1" },
      },
      "package_state",
    );
    const ledger = foldObservationalMemoryLedger([entry("m1", undefined, "message"), recorded, reflected]);
    assert.deepEqual(ledger.observations, [obs]);
    assert.deepEqual(ledger.reflections, [reflection]);
    assert.equal(ledger.latestObservationCoverageId, "m1");

    // A `set` state value is not a log record, even when it is shaped like one.
    const setState = entry(
      "ps3",
      {
        schemaVersion: 1,
        package: "other",
        key: "memory.session.ledger",
        op: "set",
        value: { type: OBSERVATIONS_RECORDED, observations: [{ ...obs, id: "cccccccccccc" }] },
      },
      "package_state",
    );
    assert.deepEqual(foldObservationalMemoryLedger([setState]).observations, []);

    // A branch fold maps entries through `recordData`, so an entry with no `data` contributes a bare
    // `undefined`. The fold skips it instead of reading `.kind` off it.
    assert.deepEqual(foldObservationalMemoryLedger([undefined, null, 0, "x"]).observations, []);
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
    assert.match(rendered, /call recall with an id/);
    assert.match(rendered, /\[bbbbbbbbbbbb\]/);
    assert.match(rendered, /\[aaaaaaaaaaaa\]/);
    assert.doesNotMatch(rendered, /secret-value/);
  });

  it("invalidated source ids drop observations, reflections, and recall content", () => {
    const recorded = entry("o", { type: OBSERVATIONS_RECORDED, observations: [obs] });
    const reflected = entry("r", { type: REFLECTIONS_RECORDED, reflections: [reflection] });
    const projection = buildObservationalMemoryProjection([recorded, reflected], undefined, {
      invalidatedIds: ["m1"],
    });
    assert.deepEqual(projection.observations, []);
    assert.deepEqual(projection.reflections, []);
    assert.ok(projection.droppedObservationIds.includes(obs.id));
    const recalled = recallObservationalMemory([recorded, reflected], obs.id, [], { invalidatedIds: ["m1"] });
    assert.equal(recalled.reason, "revoked");
    assert.doesNotMatch(recalled.text, /minimal diffs/);
    const reflectedRecall = recallObservationalMemory([recorded, reflected], reflection.id, [], {
      invalidatedIds: [obs.id],
    });
    assert.equal(reflectedRecall.reason, "revoked");
    assert.doesNotMatch(reflectedRecall.text, /package-only/);
  });
});
