import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import {
  buildObservationalMemoryProjection,
  createObservationalMemory,
  recallObservationalMemory,
  recallObservationalMemoryBranchPage,
  renderObservationalMemory,
} from "@arnilo/prism-compaction-observational-memory";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function memoryWorkerProvider(store: SessionStore, sessionId: string): AIProvider {
  return {
    id: "memory",
    async *generate() {
      const entries = (await store.list(sessionId)).filter((entry) => entry.kind === "message" && entry.message?.role === "user");
      const sourceEntryIds = entries.map((entry) => entry.id);
      yield providerToolCall(
        toolCallContent("c1", "record_observation", {
          content: "User asked to remember the release target.",
          relevance: "high",
          sourceEntryIds,
        }),
      );
      yield providerDone();
    },
  };
}

// Four-layer observational memory: attach → turn → projection/recall → branch page.
export async function demo() {
  const store = createMemorySessionStore();
  const agent = createAgent({
    model,
    provider: createMockProvider([providerTextDelta("ack"), providerDone()]),
    store,
  });
  const baseSession = agent.createSession({ id: "s1" });
  const om = createObservationalMemory({
    observation: { provider: memoryWorkerProvider(store, "s1"), model: workerModel },
    context: { recentMessages: 4, compactAfterTokens: 999_999 },
    overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
  });
  const attached = om.attach(baseSession, {
    appendEntry: (entry, options) => store.append(entry, options),
    sessionModel: model,
  });

  await attached.session.run("remember release 0.0.19");

  const entries = await attached.session.entries();
  const projection = buildObservationalMemoryProjection(entries);
  const summary = renderObservationalMemory(projection.reflections, projection.observations);
  const observationId = projection.observations[0]?.id;
  const recall = observationId ? recallObservationalMemory(entries, observationId) : { found: false as const };
  const userMessage = entries.find((entry) => entry.kind === "message" && entry.message?.role === "user");
  const page = userMessage
    ? recallObservationalMemoryBranchPage(entries, { cursor: userMessage.id, limit: 5, direction: "forward" })
    : { found: false as const, entries: [] as const };

  return {
    observationCount: projection.observations.length,
    summaryIncludesMemory: summary.includes("Observational Memory"),
    recallFound: recall.found,
    pageFound: page.found,
    pageEntryCount: page.entries.length,
  };
}

export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
