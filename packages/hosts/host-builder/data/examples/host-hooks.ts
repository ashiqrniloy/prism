import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

/**
 * Host hooks (roadmap §2.11): the host is an inline package, so `AgentConfig.hooks` registers on the same
 * bus as any package. Three of them: a `tool.call` deny on `network` effects, a `turn.before` budget stop,
 * and a `disable` of one tool. `agent.inspect().hooks` lists every registration in execution order.
 * Imports only `@arnilo/prism` and `@arnilo/prism/testing`. Network-free.
 * Run: npm run build:core && node examples/host-hooks.ts
 */

const allowNetwork = false;

export async function demo(): Promise<Record<string, unknown>> {
  const executed: string[] = [];
  const tool = (name: string, effects: readonly ("read" | "write" | "execute" | "network" | "external")[]) => ({
    name,
    description: `${name} tool`,
    parameters: {},
    effects,
    execute: (_args: unknown, context: { readonly toolCallId: string }) => {
      executed.push(name);
      return { toolCallId: context.toolCallId, name, value: "ran" };
    },
  });

  // Turn 1: the model calls the network tool and a local read. Turn 2 would answer, but the budget stops the run first.
  const agent = await createAgent({
    id: "host-hooks",
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([
      [
        providerToolCall(toolCallContent("net-1", "fetch_url", { url: "https://example.com" })),
        providerToolCall(toolCallContent("read-1", "read_file", { path: "README.md" })),
        providerDone(),
      ],
      [providerTextDelta("never reached"), providerDone()],
    ])],
    tools: { add: [tool("fetch_url", ["network"]), tool("read_file", ["read"]), tool("shell", ["execute"])] },
    // One tool switched off by id, whoever registered it.
    disable: { tools: ["shell"] },
    hooks: (hooks) => {
      hooks.on("tool.call", (call) => (call.effects.includes("network") && !allowNetwork ? { deny: "network disabled" } : undefined), {
        id: "no-network",
      });
      hooks.on("turn.before", (turn) => (turn.turn > 1 ? { stop: "turn budget spent" } : undefined), { id: "turn-budget" });
    },
  });

  const result = await (await agent.session()).run("fetch and read");
  // Every registration in execution order, per hook name (the host's and the kernel's own).
  const hooks = Object.fromEntries(Object.entries(agent.inspect().hooks).map(([name, list]) => [name, list.map((entry) => entry.id)]));
  const tools = agent.tools.map((entry) => entry.name);
  await agent.dispose();

  return {
    status: result.status,
    stopReason: result.stopReason,
    stopDetail: result.stopDetail,
    executed,
    denied: result.messages
      .flatMap((message) => message.content)
      .filter((block) => block.type === "tool_result" && block.error !== undefined).length,
    tools,
    hooks,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
