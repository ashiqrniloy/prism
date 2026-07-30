import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, SessionEntry } from "@arnilo/prism";
import { createMemorySessionStore } from "@arnilo/prism";
import { createOpenAIResponsesProvider, defineOpenAIModel } from "@arnilo/prism-provider-openai";
import { createObservationalMemoryRuntime, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "../index.js";

// Network-free by default. Protected operator gate:
//   PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1 OPENAI_API_KEY=sk-... \
//     npm test -w @arnilo/prism-compaction-observational-memory
//
// When the gate env is set, missing OPENAI_API_KEY fails closed (not skip).

const LIVE = process.env.PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS === "1";
const API_KEY = process.env.OPENAI_API_KEY;

const observerModel = defineOpenAIModel({
  model: "gpt-4.1-mini",
  displayName: "GPT-4.1 mini",
  capabilities: { input: ["text"], output: ["text"], tools: true, streaming: true },
  limits: { contextWindow: 128_000, maxOutputTokens: 4_096 },
  compat: { api: "openai-responses" },
});

const reflectorModel = defineOpenAIModel({
  model: "gpt-5.1",
  displayName: "GPT-5.1",
  capabilities: {
    input: ["text"],
    output: ["text"],
    reasoning: true,
    tools: true,
    streaming: true,
  },
  limits: { contextWindow: 400_000, maxOutputTokens: 4_096 },
  compat: { api: "openai-responses" },
});

function trackedProvider(label: string, inner: AIProvider, seen: string[]): AIProvider {
  return {
    id: label,
    async *generate(request) {
      seen.push(`${label}:${request.model.model}`);
      yield* inner.generate(request);
    },
  };
}

describe("observational memory live tests", { skip: !LIVE }, () => {
  it("live_observer_and_reflector_use_distinct_models_end_to_end", async () => {
    if (!API_KEY) {
      assert.fail("PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1 requires OPENAI_API_KEY for observer/reflector worker canary");
    }

    const seen: string[] = [];
    const apiKey = () => API_KEY;
    const observerInner = createOpenAIResponsesProvider({ apiKey });
    const reflectorInner = createOpenAIResponsesProvider({ apiKey });
    const observerProvider = trackedProvider("observer", observerInner, seen);
    const reflectorProvider = trackedProvider("reflector", reflectorInner, seen);

    const store = createMemorySessionStore();
    const sessionId = "live-om";
    const userEntry: SessionEntry = {
      id: "m-live",
      sessionId,
      timestamp: "2026-07-30T00:00:00.000Z",
      kind: "message",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Remember the observational memory canary token CANARY_OM_019 for release 0.0.19.",
          },
        ],
      },
    };
    await store.append(userEntry);

    const storeEntries = [userEntry];
    const session = {
      id: sessionId,
      leafId: userEntry.id,
      entries: async () => storeEntries,
      checkout: async (leafId: string) => {
        session.leafId = leafId;
      },
    };

    const runtime = createObservationalMemoryRuntime({
      session: session as never,
      appendEntry: async (entry, options) => {
        await store.append(entry, options);
        storeEntries.push(entry);
        session.leafId = entry.id;
      },
      observation: {
        provider: observerProvider,
        model: observerModel,
      },
      reflection: { provider: reflectorProvider, model: reflectorModel },
      credential: apiKey,
      overrides: {
        observeAfterTokens: 1,
        reflectAfterTokens: 1,
        agentMaxTurns: 2,
        observation: {
          instruction: "Record every durable fact; include the canary token when present.",
        },
      },
    });

    const result = await runtime.flush();
    assert.equal(result.skipped, undefined, `flush skipped: ${result.skipped ?? "ok"}`);
    assert.ok(
      seen.some((line) => line.startsWith("observer:") && line.includes(observerModel.model)),
      `observer model not called: ${seen.join(",")}`,
    );
    assert.ok(
      seen.some((line) => line.startsWith("reflector:") && line.includes(reflectorModel.model)),
      `reflector model not called: ${seen.join(",")}`,
    );

    const customTypes = storeEntries.filter((entry) => entry.kind === "custom").map((entry) => (entry.data as { type?: string }).type);
    assert.ok(customTypes.includes(OBSERVATIONS_RECORDED), "missing observation ledger entry");
    assert.ok(customTypes.includes(REFLECTIONS_RECORDED), "missing reflection ledger entry");
    assert.ok(!JSON.stringify(storeEntries).includes(API_KEY), "API key leaked into session entries");
  });
});
