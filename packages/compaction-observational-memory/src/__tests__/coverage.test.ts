import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  foldObservationalMemoryLedger,
  isEligibleObservationSourceEntry,
  observationsUncoveredByReflection,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  unscannedEntries,
  type MemoryObservation,
} from "../index.js";

const obs: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "User prefers minimal diffs.",
  timestamp: "2026-06-20T00:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 6,
};
const obs2: MemoryObservation = {
  id: "cccccccccccc",
  content: "Second fact.",
  timestamp: "2026-06-20T00:01:00.000Z",
  relevance: "medium",
  sourceEntryIds: ["m2"],
  tokenCount: 4,
};

function entry(id: string, data?: unknown, kind: SessionEntry["kind"] = "custom", message?: SessionEntry["message"]): SessionEntry {
  return { id, sessionId: "s1", timestamp: "2026-06-20T00:00:00.000Z", kind, data, message };
}

describe("observational memory coverage helpers", () => {
  it("eligible_sources_include_only_user_assistant_tool_messages", () => {
    const entries = [
      entry("m1", undefined, "message", { role: "user", content: [{ type: "text", text: "hi" }] }),
      entry("m2", undefined, "message", { role: "assistant", content: [{ type: "text", text: "ok" }] }),
      entry("m3", undefined, "message", { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read", result: "x" }] }),
      entry("m4", undefined, "message", { role: "system", content: [{ type: "text", text: "ignore" }] }),
      entry("c1", { type: OBSERVATIONS_RECORDED, observations: [obs], coversUpToId: "m1" }),
      entry("s1", undefined, "summary"),
      entry("e1", undefined, "event"),
    ];
    const pending = unscannedEntries(entries);
    const eligible = eligibleObservationSources(pending);
    assert.deepEqual(
      eligible.map((item) => item.id),
      ["m1", "m2", "m3"],
    );
    assert.equal(isEligibleObservationSourceEntry(eligible[0]!), true);
    assert.equal(isEligibleObservationSourceEntry(entry("x", undefined, "custom")), false);
    assert.ok(eligibleObservationTokenCount(eligible) > 0);
  });

  it("unscanned_entries_start_after_latest_observation_coverage_id", () => {
    const entries = [
      entry("m1", undefined, "message", { role: "user", content: [{ type: "text", text: "one" }] }),
      entry("o1", { type: OBSERVATIONS_RECORDED, observations: [], coversUpToId: "m1" }),
      entry("m2", undefined, "message", { role: "user", content: [{ type: "text", text: "two" }] }),
    ];
    assert.deepEqual(
      unscannedEntries(entries, "m1").map((item) => item.id),
      ["o1", "m2"],
    );
    assert.deepEqual(
      unscannedEntries(entries, "o1").map((item) => item.id),
      ["m2"],
    );
  });

  it("reflection_coverage_returns_only_observations_after_last_reflection", () => {
    const entries = [
      entry("m1", undefined, "message", { role: "user", content: [{ type: "text", text: "one" }] }),
      entry("o1", { type: OBSERVATIONS_RECORDED, observations: [obs], coversUpToId: "m1" }),
      entry("r1", { type: REFLECTIONS_RECORDED, reflections: [], coversUpToId: "m1" }),
      entry("m2", undefined, "message", { role: "user", content: [{ type: "text", text: "two" }] }),
      entry("o2", { type: OBSERVATIONS_RECORDED, observations: [obs2], coversUpToId: "m2" }),
    ];
    const ledger = foldObservationalMemoryLedger(entries);
    assert.deepEqual(
      observationsUncoveredByReflection(entries, ledger).map((item) => item.id),
      [obs2.id],
    );
    assert.deepEqual(
      observationsUncoveredByReflection(entries, ledger, true).map((item) => item.id),
      [obs.id, obs2.id],
    );
  });
});
