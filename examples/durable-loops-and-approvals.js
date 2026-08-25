import { createAgent, createMemoryCheckpointStore, createMemorySessionStore, providerDone, providerTextDelta, resumeAgentRun, toolCallContent, } from "@arnilo/prism";
/**
 * Network-free Phase 8 demo: durable custom loop snapshot + parallel batch approvals.
 * Run: npm run build:core && node examples/durable-loops-and-approvals.ts
 */
export async function demo() {
    const checkpoints = createMemoryCheckpointStore();
    const loopState = { turns: 0, restored: false };
    const loop = {
        name: "demo-loop",
        revision: "1",
        snapshot: () => ({ turns: loopState.turns }),
        restore: (snapshot) => {
            loopState.turns = snapshot.turns;
            loopState.restored = true;
        },
        async run(ctx) {
            loopState.turns += 1;
            const { calls } = await ctx.generate(await ctx.assemble([]));
            // Round-gate collects all gated calls into one suspension (Task 2).
            await ctx.chargeToolRound?.(calls);
            for (const call of calls)
                await ctx.dispatchToolCall(call);
            return undefined;
        },
    };
    let turn = 0;
    const executed = [];
    const agent = createAgent({
        id: "durable-loops-approvals",
        model: { provider: "mock", model: "demo" },
        store: createMemorySessionStore(),
        provider: {
            id: "mock",
            async *generate() {
                turn += 1;
                if (turn === 1) {
                    yield { type: "tool_call", call: toolCallContent("a", "write", { n: 1 }) };
                    yield { type: "tool_call", call: toolCallContent("b", "write", { n: 2 }) };
                    yield providerDone();
                    return;
                }
                yield providerTextDelta("done");
                yield providerDone();
            },
        },
        loop,
        tools: [
            {
                name: "write",
                parameters: { type: "object" },
                execute: (_args, context) => {
                    executed.push(context.toolCallId);
                    return { toolCallId: context.toolCallId, name: "write", value: "ok" };
                },
            },
        ],
    });
    const durable = { checkpoints, definitionRevision: "1", interruptBeforeTool: true };
    const suspended = await agent.createSession({ id: "phase8-demo" }).run("go", { runState: durable });
    if (suspended.status !== "suspended")
        throw new Error(`expected suspended, got ${suspended.status}`);
    const pending = suspended.interruption?.pendingDecisions ?? [];
    if (pending.length !== 2 || executed.length !== 0)
        throw new Error("expected two gated approvals before side effects");
    const done = await resumeAgentRun(agent, { runId: suspended.runId, sessionId: suspended.sessionId }, {
        expectedVersion: suspended.runState.version,
        decisions: pending.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" })),
    }, { checkpoints, definitionRevision: "1" });
    return {
        status: done.status,
        executed,
        loopRestored: loopState.restored,
        loopTurns: loopState.turns,
        pendingCount: pending.length,
    };
}
if (import.meta.main)
    console.log(JSON.stringify(await demo()));
