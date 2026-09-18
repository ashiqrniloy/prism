import {
  type CheckpointStore,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  loadAgentRunState,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";

/**
 * Long single-run investigation under an external orchestrator (plan 084 Task 1).
 *
 * A host process is not trusted to survive a multi-turn investigation: run with
 * `checkpointPolicy: "every-turn"`, and the durable store holds a running-state checkpoint at
 * each provider-turn boundary. If the worker dies, a new process resumes the *same* run with
 * `decision: "continue"` — no tool re-dispatch, no re-run from turn zero, and the ambiguity
 * window is at most the one provider turn that was in flight.
 *
 * Network-free: mock provider, memory session store, and a checkpoint store whose writes are
 * gated off at the simulated crash instant (a real crash simply writes nothing afterwards).
 */
export async function demo() {
  const memory = createMemoryCheckpointStore();
  const gate = { open: true };
  const requests: ProviderRequest[] = [];
  const checkpoints: CheckpointStore = {
    ...memory,
    async saveCheckpoint(input) {
      if (!gate.open) throw new Error("checkpoint store unavailable (simulated process death)");
      return memory.saveCheckpoint(input);
    },
  };

  let turn = 0;
  let executed = 0;
  const agent = createAgent({
    id: "durable-investigation",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        turn += 1;
        if (turn === 1) {
          // Turn 1: the agent opens the investigation by running one research tool.
          yield { type: "tool_call" as const, call: toolCallContent("gather-1", "gather", { query: "revenue by region" }) };
          yield providerDone();
          return;
        }
        if (turn === 2) {
          // The worker dies right after the turn-boundary checkpoint and before the provider
          // call lands. Everything the host would have written from here on is lost.
          gate.open = false;
          throw new Error("worker killed mid-investigation");
        }
        yield providerTextDelta("North America leads revenue at 4,320.50 (gather-1).");
        yield providerDone();
      },
    },
    tools: [
      {
        name: "gather",
        parameters: { type: "object" },
        execute: () => {
          executed += 1;
          return { toolCallId: "gather-1", name: "gather", value: { total: 4320.5, region: "North America" } };
        },
      },
    ],
  });

  // Worker 1: crashes; the durable store keeps the last turn-boundary checkpoint (status running).
  const session = agent.createSession({ id: "investigation-session" });
  let runId: string | undefined;
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) {
      if (event.type === "agent_started") runId = event.runId;
    }
  })();
  const crashed = await session
    .run("Investigate revenue by region", {
      runState: { checkpoints, definitionRevision: "2026-09-20.1", checkpointPolicy: "every-turn" },
    })
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  await pump;
  if (!crashed || !runId) throw new Error("expected the first worker to die after a turn-boundary checkpoint");

  // The orchestrator reads the last running checkpoint; the host stores `runId` itself in real use.
  const checkpoint = await loadAgentRunState(checkpoints, { runId, sessionId: session.id });
  if (checkpoint.state.status !== "running") throw new Error("expected a running checkpoint to resume from");

  // Worker 2: a new process attaches to the same stores and continues the same run.
  gate.open = true;
  const resumed = await resumeAgentRun(
    agent,
    { runId, sessionId: session.id },
    { decision: "continue", expectedVersion: checkpoint.record.version },
    { checkpoints, definitionRevision: "2026-09-20.1" },
  );
  return {
    status: resumed.status,
    text: resumed.text,
    toolExecutions: executed,
    resumedFromVersion: checkpoint.record.version,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
