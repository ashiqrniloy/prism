import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, Message, ProviderEvent, ProviderRequest, SessionEntry } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { runDropper, runObserver, runReflector, type MemoryObservation } from "../index.js";

const model = { provider: "mock", model: "memory" };
const source: SessionEntry = { id: "m1", sessionId: "s1", timestamp: "2026-06-20T00:00:00.000Z", kind: "message", message: { role: "user", content: [{ type: "text", text: "Keep it package-only." }] } };

function provider(events: readonly ProviderEvent[]): AIProvider {
  return { id: "mock", async *generate() { yield* events; } };
}

describe("observational memory workers", () => {
  it("observer_records_source_backed_observations_with_allowed_source_ids_only", async () => {
    const observations = await runObserver({ entries: [source], provider: provider([providerToolCall(toolCallContent("c1", "record_observation", { content: "User wants package-only memory.", relevance: "high", sourceEntryIds: ["m1", "invented"] })), providerDone()]), model, maxTurns: 1 });
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0]?.sourceEntryIds, ["m1"]);
  });

  it("reflector_records_reflections_with_valid_support_ids_and_coverage_context", async () => {
    const observation: MemoryObservation = { id: "aaaaaaaaaaaa", content: "Package-only", timestamp: source.timestamp, relevance: "high", sourceEntryIds: ["m1"], tokenCount: 3 };
    const reflections = await runReflector({ observations: [observation], provider: provider([providerToolCall(toolCallContent("c1", "record_reflection", { content: "Keep it optional.", supportingObservationIds: [observation.id, "bbbbbbbbbbbb"] })), providerDone()]), model, maxTurns: 1 });
    assert.equal(reflections.length, 1);
    assert.deepEqual(reflections[0]?.supportingObservationIds, [observation.id]);
  });

  it("dropper_records_safe_drops_after_pool_pressure", async () => {
    const observation: MemoryObservation = { id: "aaaaaaaaaaaa", content: "Drop me", timestamp: source.timestamp, relevance: "low", sourceEntryIds: ["m1"], tokenCount: 10 };
    const dropped = await runDropper({ observations: [observation], targetTokens: 1, provider: provider([providerToolCall(toolCallContent("c1", "drop_observations", { observationIds: [observation.id, "bad"] })), providerDone()]), model, maxTurns: 1 });
    assert.deepEqual(dropped, [observation.id]);
  });

  it("worker_transcript_replays_assistant_tool_call_before_tool_result", async () => {
    const requests: ProviderRequest[] = [];
    let turn = 0;
    const memoryProvider: AIProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (turn++ === 0) yield providerToolCall(toolCallContent("c1", "record_observation", { content: "Package-only memory.", relevance: "high", sourceEntryIds: ["m1"] }));
        yield providerDone();
      },
    };

    const observations = await runObserver({ entries: [source], provider: memoryProvider, model, maxTurns: 2 });

    assert.equal(observations.length, 1);
    const replay = requests[1]?.messages.slice(-2) as Message[] | undefined;
    assert.equal(replay?.[0]?.role, "assistant");
    assert.equal(replay?.[0]?.content[0]?.type, "tool_call");
    assert.equal(replay?.[1]?.role, "tool");
    assert.equal(replay?.[1]?.content[0]?.type, "tool_result");
    assert.equal((replay?.[1]?.content[0] as any).toolCallId, "c1");
  });
});
