import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionEntry } from "@arnilo/prism";
import {
  createRecallMemoryTool,
  type MemoryObservation,
  type MemoryReflection,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "../index.js";

const now = "2026-06-20T00:00:00.000Z";
const source = createSessionEntry({
  id: "m1",
  sessionId: "s1",
  timestamp: now,
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "secret-value source" }] },
});
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "Remember secret-value",
  timestamp: now,
  relevance: "high",
  sourceEntryIds: ["m1", "missing"],
  tokenCount: 4,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Secret should redact",
  supportingObservationIds: [observation.id],
  tokenCount: 4,
};
const entries = [
  source,
  createSessionEntry({
    id: "om1",
    sessionId: "s1",
    parentId: "m1",
    timestamp: now,
    kind: "custom",
    data: { type: OBSERVATIONS_RECORDED, observations: [observation], coversUpToId: "m1" },
  }),
  createSessionEntry({
    id: "om2",
    sessionId: "s1",
    parentId: "om1",
    timestamp: now,
    kind: "custom",
    data: { type: REFLECTIONS_RECORDED, reflections: [reflection], coversUpToId: "om1" },
  }),
  createSessionEntry({
    id: "om3",
    sessionId: "s1",
    parentId: "om2",
    timestamp: now,
    kind: "custom",
    data: { type: OBSERVATIONS_DROPPED, observationIds: [observation.id], coversUpToId: "om2" },
  }),
];

const context = { sessionId: "s1", runId: "r1", toolCallId: "t1" };

describe("observational memory recall tool", () => {
  it("recall_tool_rejects_invalid_id_without_entry_lookup", async () => {
    let lookedUp = false;
    const tool = createRecallMemoryTool({
      getEntries: () => {
        lookedUp = true;
        return entries;
      },
    });
    const result = await tool.execute({ id: "bad" }, context);
    assert.equal(lookedUp, false);
    assert.equal((result.value as any).reason, "invalid_id");
  });

  it("recall_tool_returns_observation_sources_from_current_branch", async () => {
    const tool = createRecallMemoryTool({ getEntries: () => entries, secrets: ["secret-value"] });
    const result = await tool.execute({ id: observation.id }, context);
    assert.equal((result.value as any).found, true);
    assert.equal((result.value as any).kind, "observation");
    assert.match(result.content?.[0]?.type === "text" ? result.content[0].text : "", /\[REDACTED\]/);
    assert.equal(JSON.stringify(result).includes("secret-value"), false);
  });

  it("recall_tool_returns_reflection_supporting_observations_and_sources", async () => {
    const tool = createRecallMemoryTool({ getEntries: () => entries });
    const result = await tool.execute({ id: reflection.id }, context);
    assert.equal((result.value as any).kind, "reflection");
    assert.equal((result.value as any).supportingObservations.length, 1);
    assert.deepEqual((result.value as any).droppedSupportingObservationIds, [observation.id]);
  });

  it("recall_tool_reports_missing_non_source_and_dropped_evidence", async () => {
    const tool = createRecallMemoryTool({ getEntries: () => entries });
    const result = await tool.execute({ id: observation.id }, context);
    assert.equal((result.value as any).dropped, true);
    assert.deepEqual((result.value as any).missingSourceEntryIds, ["missing"]);
  });

  it("recall_tool_pages_current_branch_messages", async () => {
    const tool = createRecallMemoryTool({ getEntries: () => entries });
    const result = await tool.execute({ cursor: "m1", limit: 1, direction: "backward" }, context);
    assert.equal((result.value as any).found, true);
    assert.deepEqual(
      (result.value as any).entries.map((entry: { id: string }) => entry.id),
      ["m1"],
    );
  });

  it("recall_tool_rejects_wrong_session_and_ambiguous_requests", async () => {
    const tool = createRecallMemoryTool({ getEntries: () => entries });
    const wrongSession = await tool.execute({ id: observation.id, sessionId: "other" }, context);
    assert.equal((wrongSession.value as any).reason, "wrong_session");

    const ambiguous = await tool.execute({}, context);
    assert.equal((ambiguous.value as any).reason, "invalid_request");
  });
});
