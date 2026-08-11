import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import {
  createMemoryId,
  createObservationalMemoryRuntime,
  foldObservationalMemoryLedger,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function sequenceProvider(batches: readonly (readonly ProviderEvent[])[]): AIProvider {
  let index = 0;
  return {
    id: "memory",
    async *generate() {
      yield* batches[index++] ?? [providerDone()];
    },
  };
}

async function sessionWithMessage(text = "hello") {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const session = agent.createSession({ id: "s1" });
  await session.run(text);
  return { session, store };
}

async function appendCustom(
  session: { entries: () => Promise<readonly SessionEntry[]>; id: string; checkout: (id: string) => Promise<void> },
  store: { append: (entry: SessionEntry) => Promise<void> },
  data: unknown,
) {
  const parentId = (await session.entries()).at(-1)?.id;
  const entry = createSessionEntry({ sessionId: session.id, parentId, kind: "custom", data });
  await store.append(entry);
  await session.checkout(entry.id);
  return entry;
}

describe("observational memory runtime coverage", () => {
  it("observer_receives_only_eligible_messages_and_skips_bookkeeping_in_prompt", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate() {
        calls++;
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
    });
    await runtime.flush();
    const coveredCount = (await session.entries()).length;
    await session.run("second turn");
    const beforeSecondFlush = await session.entries();
    const coveredIds = beforeSecondFlush.slice(0, coveredCount).map((entry) => entry.id);
    const newMessageIds = beforeSecondFlush
      .slice(coveredCount)
      .filter((entry) => entry.kind === "message")
      .map((entry) => entry.id);
    let seenPrompt = "";
    const observingProvider: AIProvider = {
      id: "memory",
      async *generate(request) {
        seenPrompt = JSON.stringify(request.messages);
        yield providerToolCall(
          toolCallContent("o", "record_observation", {
            content: "fact",
            relevance: "high",
            sourceEntryIds: [newMessageIds[0]!],
          }),
        );
        yield providerDone();
      },
    };
    const secondRuntime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: observingProvider, model: workerModel },
      overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
    });
    await secondRuntime.flush();
    for (const id of coveredIds) assert.doesNotMatch(seenPrompt, new RegExp(id));
    for (const id of newMessageIds) assert.match(seenPrompt, new RegExp(id));
    assert.doesNotMatch(seenPrompt, /om\.observations\.recorded/);
    assert.equal(calls, 1);
  });

  it("empty_observer_success_advances_coverage_and_second_flush_skips_worker", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate() {
        calls++;
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
    });
    await runtime.flush();
    assert.equal(calls, 1);
    const ledger = foldObservationalMemoryLedger(await session.entries());
    assert.ok(ledger.latestObservationCoverageId);
    const emptyCoverage = (await session.entries()).filter(
      (entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === OBSERVATIONS_RECORDED,
    );
    assert.equal(emptyCoverage.length, 1);
    const emptyData = emptyCoverage[0]!.data as { observations?: unknown[] };
    assert.deepEqual(emptyData.observations, []);

    await runtime.flush();
    assert.equal(calls, 1);
  });

  it("bookkeeping_only_unscanned_range_advances_coverage_without_observer_call", async () => {
    const { session, store } = await sessionWithMessage();
    let calls = 0;
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate() {
        calls++;
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
    });
    await runtime.flush();
    const bookkeeping = await appendCustom(session, store, { type: "other.bookkeeping", value: 1 });
    await runtime.flush();
    assert.equal(calls, 1);
    const ledger = foldObservationalMemoryLedger(await session.entries());
    assert.equal(ledger.latestObservationCoverageId, bookkeeping.id);
  });

  it("reflection_runs_only_for_uncovered_observations_and_skips_repeat_flush", async () => {
    const { session, store } = await sessionWithMessage("long enough message for reflection threshold");
    const sourceId = (await session.entries()).find((entry) => entry.kind === "message")!.id;
    const observationContent = "A durable fact with enough tokens for reflection threshold";
    const observationId = createMemoryId(observationContent, [sourceId]);
    const workerProvider = sequenceProvider([
      [
        providerToolCall(
          toolCallContent("o", "record_observation", {
            content: observationContent,
            relevance: "high",
            sourceEntryIds: [sourceId],
          }),
        ),
        providerDone(),
      ],
      [
        providerToolCall(
          toolCallContent("r", "record_reflection", {
            content: "Reflection one",
            supportingObservationIds: [observationId],
          }),
        ),
        providerDone(),
      ],
    ]);
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      reflection: { provider: workerProvider, model: workerModel },
      overrides: {
        observation: { messageTokens: 1 },
        reflection: { observationTokens: 1 },
        context: { observationsPoolTargetTokens: 999_999 },
        agentMaxTurns: 1,
      },
    });
    const first = await runtime.flush();
    assert.equal(first.observations, 1);
    assert.equal(first.reflections, 1);
    const second = await runtime.flush();
    assert.equal(second.reflections, 0);
    assert.equal(
      (await session.entries()).filter(
        (entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === REFLECTIONS_RECORDED,
      ).length,
      1,
    );
  });

  it("full_reflection_rebuild_reflects_entire_active_pool", async () => {
    const { session, store } = await sessionWithMessage();
    const sourceId = (await session.entries()).find((entry) => entry.kind === "message")!.id;
    const observationContent = "first fact";
    const observationId = createMemoryId(observationContent, [sourceId]);
    const phases: string[] = [];
    const workerProvider: AIProvider = {
      id: "memory",
      async *generate(request) {
        const observe = request.tools?.[0]?.name === "record_observation";
        phases.push(observe ? "observe" : "reflect");
        if (observe) {
          yield providerToolCall(
            toolCallContent("o", "record_observation", {
              content: observationContent,
              relevance: "high",
              sourceEntryIds: [sourceId],
            }),
          );
        } else {
          yield providerToolCall(
            toolCallContent(`r${phases.filter((phase) => phase === "reflect").length}`, "record_reflection", {
              content: phases.filter((phase) => phase === "reflect").length === 1 ? "r1" : "r2 rebuild",
              supportingObservationIds: [observationId],
            }),
          );
        }
        yield providerDone();
      },
    };
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      reflection: { provider: workerProvider, model: workerModel },
      overrides: {
        observation: { messageTokens: 1 },
        reflection: { observationTokens: 1 },
        context: { observationsPoolTargetTokens: 999_999 },
        agentMaxTurns: 1,
      },
    });
    await runtime.flush();
    await runtime.flush({ fullReflectionRebuild: true });
    assert.deepEqual(phases, ["observe", "reflect", "reflect"]);
    assert.equal(
      (await session.entries()).filter(
        (entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === REFLECTIONS_RECORDED,
      ).length,
      2,
    );
  });

  it("dropped_observations_remain_in_ledger_for_recall", async () => {
    const { session, store } = await sessionWithMessage();
    const sourceId = (await session.entries()).find((entry) => entry.kind === "message")!.id;
    const workerProvider = sequenceProvider([
      [
        providerToolCall(
          toolCallContent("o", "record_observation", {
            content: "drop candidate observation",
            relevance: "low",
            sourceEntryIds: [sourceId],
          }),
        ),
        providerDone(),
      ],
      [providerToolCall(toolCallContent("r", "record_reflection", { content: "reflect", supportingObservationIds: [] })), providerDone()],
      [providerToolCall(toolCallContent("d", "drop_observations", { observationIds: [] })), providerDone()],
    ]);
    const runtime = createObservationalMemoryRuntime({
      session,
      appendEntry: (entry) => store.append(entry),
      observation: { provider: workerProvider, model: workerModel },
      reflection: { provider: workerProvider, model: workerModel },
      dropper: { provider: workerProvider, model: workerModel },
      overrides: {
        observation: { messageTokens: 1 },
        reflection: { observationTokens: 1 },
        context: { observationsPoolTargetTokens: 1 },
        agentMaxTurns: 1,
      },
    });
    await runtime.flush();
    const ledger = foldObservationalMemoryLedger(await session.entries());
    assert.equal(ledger.observations.length, 1);
    assert.equal(ledger.droppedObservationIds.length, 0);
  });
});
