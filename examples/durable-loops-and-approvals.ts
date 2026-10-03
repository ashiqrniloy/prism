import {
  askEveryTool,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  type JsonValue,
  type LoopStrategy,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";

/**
 * Network-free Phase 8 demo: durable custom loop snapshot + parallel batch approvals.
 * Run: npm run build:core && node examples/durable-loops-and-approvals.ts
 */
export async function demo(): Promise<Record<string, unknown>> {
  const checkpoints = createMemoryCheckpointStore();
  const loopState = { turns: 0, restored: false };
  const loop: LoopStrategy = {
    name: "demo-loop",
    revision: "1",
    snapshot: () => ({ turns: loopState.turns }) as JsonValue,
    restore: (snapshot) => {
      loopState.turns = (snapshot as { turns: number }).turns;
      loopState.restored = true;
    },
    async run(run) {
      loopState.turns += 1;
      const turn = await run.turn();
      // Round-gate collects all gated calls into one suspension (Task 2).
      if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
    },
  };

  let turn = 0;
  const executed: string[] = [];
  const agent = await createAgent({
    id: "durable-loops-approvals",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore(), loop },
    hooks: askEveryTool(),
    provider: {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("a", "write", { n: 1 }) };
          yield { type: "tool_call" as const, call: toolCallContent("b", "write", { n: 2 }) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    },
    tools: {
      add: [
        {
          name: "write",
          parameters: { type: "object" },
          execute: (_args, context) => {
            executed.push(context.toolCallId);
            return { toolCallId: context.toolCallId, name: "write", value: "ok" };
          },
        },
      ],
    },
  });

  const durable = { checkpoints, definitionRevision: "1" };
  const suspended = await (await agent.session({ id: "phase8-demo", create: true })).run("go", { runState: durable });
  if (suspended.status !== "suspended") throw new Error(`expected suspended, got ${suspended.status}`);
  const pending = suspended.pending ?? [];
  if (pending.length !== 2 || executed.length !== 0) throw new Error("expected two gated approvals before side effects");

  const done = await resumeAgentRun(
    agent,
    { runId: suspended.runId, sessionId: suspended.sessionId },
    {
      expectedVersion: suspended.runState!.version!,
      decisions: pending.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })),
    },
    { checkpoints, definitionRevision: "1" },
  );

  return {
    status: done.status,
    executed,
    loopRestored: loopState.restored,
    loopTurns: loopState.turns,
    pendingCount: pending.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
