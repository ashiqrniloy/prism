import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type JsonValue,
  type LoopStrategy,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

/**
 * Network-free Phase 8 demo: a durable custom loop with per-run state + parallel batch approvals.
 * The loop declares `state: "run"`, records its state with `run.checkpoint`, and reads it back from
 * `run.restored` on resume, so one strategy object can serve any number of concurrent runs.
 * Run: npm run build:core && node examples/durable-loops-and-approvals.ts
 */
export async function demo(): Promise<Record<string, unknown>> {
  const observed: { restored?: JsonValue; turns: number } = { turns: 0 };
  const loop: LoopStrategy = {
    name: "demo-loop",
    revision: "1",
    state: "run",
    async run(run) {
      if (run.restored !== undefined) observed.restored = run.restored;
      const turns = ((run.restored as { turns?: number } | undefined)?.turns ?? 0) + 1;
      run.checkpoint({ turns });
      observed.turns = turns;
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
    packages: [
      providerPackage("test-provider", [
        {
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
      ]),
    ],
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

  const session = await agent.session({ id: "phase8-demo", create: true });
  const suspended = await session.run("go");
  if (suspended.status !== "suspended") throw new Error(`expected suspended, got ${suspended.status}`);
  const pending = suspended.pending ?? [];
  if (pending.length !== 2 || executed.length !== 0) throw new Error("expected two gated approvals before side effects");

  let last: string | undefined;
  for await (const event of session.resume(pending.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })))) {
    last = event.type;
  }

  return {
    status: last === "run.completed" ? "completed" : last,
    executed,
    loopRestored: observed.restored !== undefined,
    loopTurns: observed.turns,
    pendingCount: pending.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
