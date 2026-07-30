import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, ProviderEvent, SessionEntry } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import {
  createObservationalMemory,
  createObservationalMemoryRuntime,
  DEFAULT_OBSERVER_INSTRUCTION,
  type MemoryObservation,
  runObserver,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Route workers separately." }] },
};

function provider(events: readonly ProviderEvent[]): AIProvider {
  return {
    id: "mock",
    async *generate() {
      yield* events;
    },
  };
}

describe("observational memory worker split", () => {
  it("observer_default_prompt_is_domain_neutral_and_appends_custom_instruction", async () => {
    const requests: string[] = [];
    const memoryProvider: AIProvider = {
      id: "mock",
      async *generate(request) {
        const system = request.messages.find((message) => message.role === "system")?.content[0];
        requests.push(system?.type === "text" ? system.text : "");
        yield providerDone();
      },
    };
    await runObserver({
      entries: [source],
      provider: memoryProvider,
      model,
      maxTurns: 1,
      instruction: "Prefer finance-domain wording.",
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!, /supplied messages/i);
    assert.doesNotMatch(requests[0]!, /coding session/i);
    assert.match(requests[0]!, /Prefer finance-domain wording/);
    assert.equal(DEFAULT_OBSERVER_INSTRUCTION.includes("coding"), false);
  });

  it("runtime_routes_separate_observer_and_reflector_models", async () => {
    const seen: string[] = [];
    const observerProvider: AIProvider = {
      id: "observer",
      async *generate(request) {
        seen.push(`observer:${request.model.model}`);
        yield providerDone();
      },
    };
    const reflectorProvider: AIProvider = {
      id: "reflector",
      async *generate(request) {
        seen.push(`reflector:${request.model.model}`);
        yield providerToolCall(
          toolCallContent("r", "record_reflection", {
            content: "Separate reflector",
            supportingObservationIds: ["aaaaaaaaaaaa"],
          }),
        );
        yield providerDone();
      },
    };
    const storeEntries = [
      source,
      {
        id: "om1",
        sessionId: "s1",
        timestamp: source.timestamp,
        kind: "custom" as const,
        data: {
          type: "om.observations.recorded",
          observations: [
            {
              id: "aaaaaaaaaaaa",
              content: "Existing observation",
              timestamp: source.timestamp,
              relevance: "high",
              sourceEntryIds: ["m1"],
              tokenCount: 50,
            } satisfies MemoryObservation,
          ],
          coversUpToId: "m1",
        },
      },
    ];
    const session = {
      id: "s1",
      leafId: "om1",
      entries: async () => storeEntries,
      checkout: async (leafId: string) => {
        session.leafId = leafId;
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session: session as any,
      appendEntry: async (entry) => {
        storeEntries.push(entry);
        session.leafId = entry.id;
      },
      observation: { provider: observerProvider, model: { provider: "mock", model: "observer-model" } },
      reflection: { provider: reflectorProvider, model: { provider: "mock", model: "reflector-model" } },
      overrides: { observation: { messageTokens: 999_999 }, reflection: { observationTokens: 1 }, agentMaxTurns: 1 },
    });
    const result = await runtime.flush();
    assert.equal(result.skipped, undefined);
    assert.deepEqual(seen, ["reflector:reflector-model"]);
  });

  it("create_observational_memory_rejects_worker_model_with_nested_models", () => {
    assert.throws(
      () =>
        createObservationalMemory({
          workerProvider: provider([providerDone()]),
          workerModel: model,
          observation: { provider: provider([providerDone()]), model: { provider: "mock", model: "x" } },
        }),
      /workerModel cannot be combined with nested worker models/,
    );
  });
});
