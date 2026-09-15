import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
  type ProviderEvent,
} from "@arnilo/prism";
import { createMemoryId } from "../ids.js";
import {
  createObservationalMemoryRuntime,
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  OBSERVATIONS_DROPPED,
  WORK_SCOPE_BOUND,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };
const observationContent = "Long observation with many useful words";

function sequenceProvider(batches: readonly (readonly ProviderEvent[])[]) {
  let calls = 0;
  const provider: AIProvider = {
    id: "memory",
    async *generate() {
      yield* batches[calls++] ?? [providerDone()];
    },
  };
  return { provider, calls: () => calls };
}

async function sessionWithMessage() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const session = agent.createSession({ id: "s1" });
  await session.run("hello world");
  return { store, session, sourceId: (await session.entries())[0]!.id };
}

function observerEvents(sourceId: string): readonly ProviderEvent[] {
  return [
    providerToolCall(
      toolCallContent("o", "record_observation", {
        content: observationContent,
        relevance: "high",
        sourceEntryIds: [sourceId],
      }),
    ),
    providerDone(),
  ];
}

function reflectorEvents(observationId: string): readonly ProviderEvent[] {
  return [
    providerToolCall(toolCallContent("r", "record_reflection", { content: "Reflect", supportingObservationIds: [observationId] })),
    providerDone(),
  ];
}

describe("observational memory runtime work scopes", () => {
  it("flush_binds_new_ids_to_leaf_only_and_skips_dropper_with_host_scope", async () => {
    const { store, session, sourceId } = await sessionWithMessage();
    const controller = createWorkScopeController({ session, appendEntry: (entry) => store.append(entry) });
    await controller.open({ id: "plan:1" });
    await controller.open({ id: "task:1", parentId: "plan:1" });
    await controller.enter("task:1");
    const observationId = createMemoryId(observationContent, [sourceId]);
    const worker = sequenceProvider([observerEvents(sourceId), reflectorEvents(observationId)]);
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: worker.provider, model: workerModel },
      reflection: { provider: worker.provider, model: workerModel },
      dropper: { provider: worker.provider, model: workerModel },
      overrides: {
        observation: { messageTokens: 1 },
        reflection: { observationTokens: 1 },
        context: { observationsPoolTargetTokens: 1 },
        agentMaxTurns: 1,
      },
    });

    const result = await runtime.flush();
    const entries = await session.entries();
    const ledger = foldObservationalMemoryLedger(entries);
    const scopes = foldWorkScopeMap(entries);
    const refs = new Set(scopes.binds.get("task:1"));

    assert.equal(result.dropped, 0);
    assert.equal(worker.calls(), 2);
    assert.equal(
      entries.filter((entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === WORK_SCOPE_BOUND).length,
      1,
    );
    assert.equal(scopes.binds.has("plan:1"), false);
    assert.deepEqual(
      refs,
      new Set([...ledger.observations.map((item) => `om:${item.id}`), ...ledger.reflections.map((item) => `reflection:${item.id}`)]),
    );
  });

  it("dropper_still_runs_when_only_implicit_session_and_preserves_drop_count", async () => {
    const { store, session, sourceId } = await sessionWithMessage();
    const observationId = createMemoryId(observationContent, [sourceId]);
    const worker = sequenceProvider([
      observerEvents(sourceId),
      reflectorEvents(observationId),
      [providerToolCall(toolCallContent("d", "drop_observations", { observationIds: [observationId] })), providerDone()],
    ]);
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: worker.provider, model: workerModel },
      reflection: { provider: worker.provider, model: workerModel },
      dropper: { provider: worker.provider, model: workerModel },
      overrides: {
        observation: { messageTokens: 1 },
        reflection: { observationTokens: 1 },
        context: { observationsPoolTargetTokens: 1 },
        agentMaxTurns: 1,
      },
    });

    const result = await runtime.flush();
    const entries = await session.entries();

    assert.equal(result.dropped, 1);
    assert.equal(worker.calls(), 3);
    assert.equal(foldWorkScopeMap(entries).binds.size, 0);
    assert.equal(
      entries.some((entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === OBSERVATIONS_DROPPED),
      true,
    );
  });
});
