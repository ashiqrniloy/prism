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
const existingObservation = {
  id: "aaaaaaaaaaaa",
  content: "Existing secret-value observation",
  timestamp: source.timestamp,
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 50,
} satisfies MemoryObservation;

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
    assert.match(requests[0]!, /assertions as facts, not questions/i);
    assert.match(requests[0]!, /user assertions are authoritative/i);
    assert.match(requests[0]!, /superseding facts when source-backed state changes/i);
    assert.match(requests[0]!, /completed: only for real completion/i);
    assert.match(requests[0]!, /identifiers, paths, and errors/i);
    assert.match(requests[0]!, /Do not repeat existing observations/i);
    assert.match(requests[0]!, /single-line prose/i);
    assert.match(requests[0]!, /Prefer finance-domain wording/);
    assert.equal(DEFAULT_OBSERVER_INSTRUCTION.includes("coding"), false);
  });

  it("observer_prompt_lists_existing_active_observations", async () => {
    const prompts: string[] = [];
    const observerProvider: AIProvider = {
      id: "observer",
      async *generate(request) {
        const prompt = request.messages.find((message) => message.role === "user")?.content[0];
        prompts.push(prompt?.type === "text" ? prompt.text : "");
        yield providerDone();
      },
    };
    const source2 = {
      ...source,
      id: "m2",
      message: { role: "user" as const, content: [{ type: "text" as const, text: "New assertion." }] },
    };
    const storeEntries = [
      source,
      {
        id: "om1",
        sessionId: "s1",
        timestamp: source.timestamp,
        kind: "custom" as const,
        data: { type: "om.observations.recorded", observations: [existingObservation], coversUpToId: "m1" },
      },
      source2,
    ];
    const session = { id: "s1", leafId: "m2", entries: async () => storeEntries };
    const runtime = createObservationalMemoryRuntime({
      session: session as any,
      appendEntry: async (entry) => {
        storeEntries.push(entry);
        session.leafId = entry.id;
      },
      observation: { provider: observerProvider, model },
      overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
      secrets: ["secret-value"],
    });

    await runtime.flush();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Existing active observations:/);
    assert.match(prompts[0]!, /\[aaaaaaaaaaaa\]/);
    assert.doesNotMatch(prompts[0]!, /secret-value/);
  });

  it("observer_does_not_expose_record_current_task", async () => {
    const tools: string[] = [];
    await runObserver({
      entries: [source],
      provider: {
        id: "mock",
        async *generate(request) {
          tools.push(...(request.tools?.map((tool) => tool.name) ?? []));
          yield providerDone();
        },
      },
      model,
      maxTurns: 1,
    });
    assert.doesNotMatch(DEFAULT_OBSERVER_INSTRUCTION, /record_current_task/);
    assert.deepEqual(tools, ["record_observation"]);
  });

  it("abstention_observer_does_not_record_unmentioned_ids", async () => {
    const observations = await runObserver({
      entries: [source],
      provider: provider([
        providerToolCall(
          toolCallContent("o", "record_observation", {
            content: "Guess",
            relevance: "high",
            sourceEntryIds: ["unmentioned"],
          }),
        ),
        providerDone(),
      ]),
      model,
      maxTurns: 1,
    });
    assert.deepEqual(observations, []);
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

  it("create_observational_memory_rejects_legacy_worker_aliases", () => {
    assert.throws(
      () =>
        createObservationalMemory({
          // @ts-expect-error removed in 0.1.5; use observation.provider / reflection.provider / dropper.provider
          workerProvider: provider([providerDone()]),
        }),
      /"workerProvider" was removed in 0.1.5/,
    );
    assert.throws(
      () =>
        createObservationalMemory({
          // @ts-expect-error removed in 0.1.5; use observation.model / reflection.model / dropper.model
          workerModel: model,
        }),
      /"workerModel" was removed in 0.1.5/,
    );
  });

  it("create_observational_memory_runtime_rejects_legacy_worker_aliases", () => {
    assert.throws(
      () =>
        createObservationalMemoryRuntime({
          session: {} as never,
          appendEntry: async () => {},
          // @ts-expect-error removed in 0.1.5; use observation.provider / reflection.provider / dropper.provider
          workerProvider: provider([providerDone()]),
        }),
      /"workerProvider" was removed in 0.1.5/,
    );
    assert.throws(
      () =>
        createObservationalMemoryRuntime({
          session: {} as never,
          appendEntry: async () => {},
          // @ts-expect-error removed in 0.1.5; use observation.model / reflection.model / dropper.model
          workerModel: model,
        }),
      /"workerModel" was removed in 0.1.5/,
    );
  });
});
