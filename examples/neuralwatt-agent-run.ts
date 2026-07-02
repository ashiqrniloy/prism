import {
  createAgent,
  createAgentSession,
  createExtensionKernel,
  type AgentEvent,
  type JsonObject,
  type ToolDefinition,
} from "@arnilo/prism";
import {
  createNeuralWattProviderPackage,
  defineNeuralWattModel,
  neuralWattEventsWithTelemetry,
  type NeuralWattCostTelemetry,
  type NeuralWattEnergyTelemetry,
} from "@arnilo/prism-provider-neuralwatt";

const requestBodies: JsonObject[] = [];

const model = defineNeuralWattModel({
  model: "glm-5.2",
  cache: { kind: "implicit" },
  cost: { input: 1, output: 3, cacheRead: 0.25, currency: "USD", unit: "1m_tokens" },
});

const lookup: ToolDefinition = {
  name: "lookup",
  description: "Look up a project fact",
  parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "lookup", value: { answer: `fact:${args.q}` } };
  },
};

function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  return (async () => {
    const events: AgentEvent[] = [];
    for await (const event of iterable) events.push(event);
    return events;
  })();
}

function sse(lines: readonly string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function data(value: unknown) {
  return `data: ${JSON.stringify(value)}`;
}

async function mockFetch(_url: string | URL | Request, init?: RequestInit) {
  requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as JsonObject);
  const firstTurn = requestBodies.length === 1;
  const body = firstTurn
    ? sse([
      data({ choices: [{ delta: { reasoning_content: "Need a lookup." } }] }),
      data({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_lookup", function: { name: "lookup" } }] } }] }),
      data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }] } }] }),
      data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"cache\"}" } }] } }] }),
    ])
    : sse([
      ": energy {\"energy_kwh\":0.00042,\"duration_seconds\":0.3}",
      ": cost {\"request_cost_usd\":0.0009,\"cache_savings_usd\":0.0012}",
      data({ choices: [{ delta: { content: "Tool result processed." } }] }),
      data({ usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230, prompt_tokens_details: { cached_tokens: 900 } } }),
    ]);
  return new Response(body, { status: 200 });
}

async function telemetry() {
  let energy: NeuralWattEnergyTelemetry | undefined;
  let cost: NeuralWattCostTelemetry | undefined;
  for await (const event of neuralWattEventsWithTelemetry(sse([
    ": energy {\"energy_kwh\":0.00042,\"duration_seconds\":0.3}",
    ": cost {\"request_cost_usd\":0.0009,\"cache_savings_usd\":0.0012}",
  ]))) {
    if (event.type === "neuralwatt:telemetry") {
      energy = event.energy ?? energy;
      cost = event.cost ?? cost;
    }
  }
  return { energy, cost };
}

export async function demo() {
  requestBodies.length = 0;
  const kernel = createExtensionKernel();
  await kernel.load([createNeuralWattProviderPackage({ apiKey: () => "fake-neuralwatt-key", fetch: mockFetch, models: [model] })]);

  const agent = createAgent({
    model: kernel.registries.models.resolve("neuralwatt", model.model),
    provider: kernel.registries.providers.resolve("neuralwatt"),
    tools: [lookup],
    providerOptions: {
      compat: {
        reasoning_effort: "medium",
        thinking_token_budget: 1024,
        chat_template_kwargs: { enable_thinking: true },
        preserve_thinking: true,
        clear_thinking: false,
        tool_choice: "auto",
      },
    },
  });

  const session = createAgentSession({ agent, id: "neuralwatt-demo" });
  const eventsPromise = collect(session.subscribe());
  await session.run("Use a tool, then answer with cache-aware usage.", { inputLayout: "cache_aware", maxToolRounds: 1 });
  const events = await eventsPromise;
  const finished = [...events].reverse().find((event) => event.type === "agent_finished");
  const { energy, cost } = await telemetry();

  return {
    eventTypes: events.map((event) => event.type),
    toolCalls: events.filter((event) => event.type === "tool_execution_started").length,
    toolResults: events.filter((event) => event.type === "tool_execution_finished").length,
    reasoningEffort: requestBodies[0]?.reasoning_effort,
    thinkingTokenBudget: requestBodies[0]?.thinking_token_budget,
    enableThinking: (requestBodies[0]?.chat_template_kwargs as JsonObject | undefined)?.enable_thinking,
    preserveThinking: requestBodies[0]?.preserve_thinking,
    clearThinking: requestBodies[0]?.clear_thinking,
    cacheReadTokens: finished?.type === "agent_finished" ? finished.usage?.cacheReadTokens : undefined,
    energyKwh: energy?.energy_kwh,
    costUsd: cost?.request_cost_usd,
    cacheSavingsUsd: cost?.cache_savings_usd,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
