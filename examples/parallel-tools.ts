import { createAgent, type ToolDefinition } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

/**
 * Parallel tool rounds (plan 226 Task 4). Four tool calls of one model turn run at the same time,
 * bounded by `tools.concurrency` (default 4); results are appended in call order. A round that holds an
 * `exclusive` tool, a tool with no `effects`, or an unknown tool name stays serial, and
 * `tools.concurrency: 1` restores the 0.14.0 behavior. Imports only `@arnilo/prism` and
 * `@arnilo/prism/testing`. Network-free.
 * Run: npm run build:core && node examples/parallel-tools.ts
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function lookup(name: string, state: { active: number; maxActive: number }, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `Look up ${name}.`,
    effects: ["read"],
    async execute(_args, context) {
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      await sleep(40);
      state.active -= 1;
      return { toolCallId: context.toolCallId, name, value: `${name} done` };
    },
    ...extra,
  };
}

async function round(options: { readonly concurrency?: number; readonly exclusive?: boolean }) {
  const names = ["alpha", "beta", "gamma", "delta"];
  const state = { active: 0, maxActive: 0 };
  const agent = await createAgent({
    id: `parallel-tools-${options.concurrency ?? "default"}-${options.exclusive === true ? "exclusive" : "open"}`,
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider([
        [...names.map((name) => providerToolCall(toolCallContent(`call-${name}`, name, {}))), providerDone()],
        [providerTextDelta("all four answered"), providerDone()],
      ]),
    ],
    tools: {
      add: names.map((name) => lookup(name, state, options.exclusive === true && name === "gamma" ? { exclusive: true } : {})),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    },
  });
  const session = await agent.session();
  const started = performance.now();
  const result = await session.run("look everything up");
  const ms = performance.now() - started;
  const order = result.messages.flatMap((message) =>
    message.content.filter((block) => block.type === "tool_result").map((block) => block.toolCallId),
  );
  await agent.dispose();
  return { status: result.status, maxActive: state.maxActive, fast: ms < 150, resultOrder: order };
}

export async function demo(): Promise<Record<string, unknown>> {
  return {
    // Default: the four calls overlap.
    parallel: await round({}),
    // `concurrency: 1` restores serial dispatch.
    serial: await round({ concurrency: 1 }),
    // One `exclusive` tool keeps its whole round serial.
    exclusive: await round({ exclusive: true }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
