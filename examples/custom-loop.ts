import { createAgent, createMemorySessionStore, type LoopStrategy, providerDone, providerTextDelta, toolCallContent } from "@arnilo/prism";

/**
 * Plan-then-act custom loop (roadmap §2.5): a host `LoopStrategy` supplied through `slots.loop` and a
 * host `tool.call` gate that denies a `network` tool. The loop can only reach tools through
 * `executeTools`, so the gate cannot be bypassed by replacing the loop. Network-free.
 * Run: npm run build:core && node examples/custom-loop.ts
 */

const planThenAct: LoopStrategy = {
  name: "plan-then-act",
  revision: "1",
  async run(run) {
    for (;;) {
      for (;;) {
        const turn = await run.turn();
        if (turn.stopped) return;
        if (turn.toolCalls.length === 0) {
          if (turn.steered) continue;
          break;
        }
        await run.executeTools(turn.toolCalls);
      }
      const end = await run.end();
      if (!end.continue) return;
    }
  },
};

export async function demo(): Promise<Record<string, unknown>> {
  const executed: string[] = [];
  let turn = 0;
  let sawDenial = false;
  const agent = await createAgent({
    id: "custom-loop",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore(), loop: planThenAct },
    provider: {
      id: "mock",
      async *generate(request) {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("n1", "fetch_url", { url: "https://example.com" }) };
          yield { type: "tool_call" as const, call: toolCallContent("r1", "read_file", { path: "README.md" }) };
          yield providerDone();
          return;
        }
        // The denied call reached the model as an ordinary tool result on the next turn.
        sawDenial = request.messages.some((message) =>
          message.content.some((block) => block.type === "tool_result" && block.error?.code === "hook_denied"),
        );
        yield providerTextDelta(sawDenial ? "network denied; used the local file" : "no denial seen");
        yield providerDone();
      },
    },
    hooks: (hooks) => {
      hooks.on("tool.call", (call) => (call.name === "fetch_url" ? { deny: "network access is disabled" } : "allow"));
    },
    tools: { add: [
      {
        name: "fetch_url",
        parameters: {},
        execute: () => {
          throw new Error("the network tool must never run");
        },
      },
      {
        name: "read_file",
        parameters: {},
        execute: (_args, context) => {
          executed.push("read_file");
          return { toolCallId: context.toolCallId, name: "read_file", value: "contents" };
        },
      },
    ] },
  });

  const result = await (await agent.session()).run("plan then act");
  return { status: result.status, executed, sawDenial, text: result.text };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
