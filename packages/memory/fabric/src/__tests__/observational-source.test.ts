/**
 * The fabric reads the ledger the observational-memory package keeps in `state.log`.
 *
 * A package's log reaches the branch as `package_state` entries, so a host wires
 * `createMemoryFabric({ memory, observational: { session } })` with the session it already has: no
 * attach surface, no host-side ledger plumbing, and the promotion path sees what the package wrote.
 * Plan 157 Further Action 1; the fold's `recordData` is what unwraps the log payload.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ModelProvider, ProviderRequest } from "@arnilo/prism";
import {
  createAgent,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memoryObservational, { foldObservationalMemoryLedger } from "@arnilo/prism-memory-observational";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryWorkingStore } from "../index.js";

const OBSERVATION_TEXT = "The user asked for a smaller retry budget.";
const REFLECTION_TEXT = "Prefer the smallest retry budget.";

/** One worker provider for both roles: the loop offers `record_observation`, then `record_reflection`. */
function workerProvider(): ModelProvider {
  return {
    id: "worker",
    async *generate(request: ProviderRequest) {
      const alreadyCalled = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const text = prompt?.type === "text" ? prompt.text : "";
      const ids = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
      const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
      if (!alreadyCalled && ids.length > 0) {
        if (names.has("record_reflection")) {
          yield providerToolCall(
            toolCallContent("c1", "record_reflection", { content: REFLECTION_TEXT, supportingObservationIds: ids }),
          );
        } else if (names.has("record_observation")) {
          yield providerToolCall(
            toolCallContent("c1", "record_observation", { content: OBSERVATION_TEXT, relevance: "high", sourceEntryIds: ids }),
          );
        }
      }
      yield providerDone();
    },
  };
}

const mainProvider: ModelProvider = {
  id: "main",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

describe("memory fabric observational source", () => {
  it("promotes the package's ledger records read off the branch", async () => {
    const agent = await createAgent({
      model: { provider: "main", model: "main-model" },
      packages: [
        providerPackage("main-provider", [mainProvider]),
        providerPackage("worker-provider", [workerProvider()]),
        memoryObservational({
          observer: { model: "worker/om-model", messageTokens: 1 },
          reflector: { model: "worker/om-model", observationTokens: 1 },
          context: { compactAfterTokens: 999_999 },
          worker: { maxTurns: 1 },
        }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "s", create: true });
    await agent.commands.run("om", {}, { session });
    await session.run("Please keep the retry budget small.");

    // The pass runs in the background, so wait for the reflection it appends to the log.
    let ledger = foldObservationalMemoryLedger(await session.entries());
    for (let attempt = 0; attempt < 100 && ledger.reflections.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ledger = foldObservationalMemoryLedger(await session.entries());
    }
    assert.equal(ledger.observations.length > 0, true, "the branch fold reads the package's observation records");
    assert.equal(ledger.reflections.length > 0, true, "the branch fold reads the package's reflection records");
    const observation = ledger.observations[0]!;
    const reflection = ledger.reflections[0]!;
    assert.equal(observation.content, OBSERVATION_TEXT);

    const memory = createMemory({
      tenantId: "t1",
      resourceId: "r1",
      threadId: "th1",
      embedder: createHashEmbedder(),
      vectorStore: createMemoryVectorStore(),
      workingStore: createMemoryWorkingStore(),
    });
    const fabric = createMemoryFabric({ memory, observational: { session } });

    const promoted = await fabric.remember({ kind: "procedure", reflectionId: reflection.id });
    assert.equal(promoted.content, REFLECTION_TEXT);
    assert.deepEqual(promoted.promotedFrom, { reflectionId: reflection.id });
    assert.equal((await fabric.recall(REFLECTION_TEXT, { kinds: ["procedure"] })).hits.length, 1);

    const episode = await fabric.remember({ kind: "episode", id: observation.id });
    assert.equal(episode.content, OBSERVATION_TEXT);
    assert.deepEqual(episode.sourceEntryIds, observation.sourceEntryIds);

    await assert.rejects(fabric.remember({ kind: "fact", reflectionId: "c".repeat(12) }), /unknown observational memory reflection/);
    await agent.dispose();
  });
});
