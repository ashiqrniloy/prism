import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent, type AIProvider, type ProviderEvent } from "@arnilo/prism";
import { createObservationalMemoryRuntime, OBSERVATIONS_DROPPED } from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function sequenceProvider(batches: readonly (readonly ProviderEvent[])[]): AIProvider {
  let index = 0;
  return { id: "memory", async *generate() { yield* (batches[index++] ?? [providerDone()]); } };
}

describe("observational memory runtime dropper", () => {
  it("runtime_can_drop_after_same_run_reflection_and_pool_pressure", async () => {
    const store = createMemorySessionStore();
    const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
    const session = agent.createSession({ id: "s1" });
    await session.run("hello world");
    const sourceId = (await session.entries())[0]!.id;
    const workerProvider = sequenceProvider([
      [providerToolCall(toolCallContent("o", "record_observation", { content: "Long observation with many useful words", relevance: "high", sourceEntryIds: [sourceId] })), providerDone()],
      [providerToolCall(toolCallContent("r", "record_reflection", { content: "Reflect", supportingObservationIds: [] })), providerDone()],
      [providerToolCall(toolCallContent("d", "drop_observations", { observationIds: [] })), providerDone()],
    ]);
    const runtime = createObservationalMemoryRuntime({ session, store, workerProvider, workerModel, overrides: { observeAfterTokens: 1, reflectAfterTokens: 1, observationsPoolTargetTokens: 1, agentMaxTurns: 1 } });
    await runtime.flush();
    assert.equal((await session.entries()).some((entry) => entry.kind === "custom" && (entry.data as any).type === OBSERVATIONS_DROPPED), false);
  });
});
