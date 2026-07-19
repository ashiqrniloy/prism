import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerUsage,
} from "@arnilo/prism";
import {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  fanOutNode,
  functionNode,
  joinNode,
  runWorkflow,
  type WorkflowEvent,
} from "@arnilo/prism-workflows";

// True parallel research DAG: fan-out normalizes bounded topics, join exposes
// the array, three independent research branches execute concurrently, then a
// combine node joins their outputs and an agent synthesizes the final summary.

const provider = createMockProvider([
  providerTextDelta("Synthesized summary of all research findings."),
  providerUsage({ inputTokens: 10, outputTokens: 6, totalTokens: 16 }),
  providerDone(),
]);
const summarizerAgent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  instructions: "Synthesize research findings into a one-paragraph summary.",
});

const fanOut = fanOutNode({
  items: (ctx) => (ctx.workflowInput as { topics: string[] }).topics,
  map: (item) => String(item),
  maxFanOut: 3,
});
const topics = joinNode({ from: "fanOut" });
const research = (index: number) => functionNode({
  execute: async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const list = ctx.upstream.topics as string[];
    return `Research result for "${list[index]}"`;
  },
});
const researchA = research(0);
const researchB = research(1);
const researchC = research(2);
const combine = functionNode({
  execute: async (ctx) => ({
    findings: [ctx.upstream.researchA, ctx.upstream.researchB, ctx.upstream.researchC],
  }),
});
const summarise = agentNode({
  agent: "summarizer",
  input: (ctx) => ctx.upstream.combine,
});

const workflow = defineWorkflow({
  revision: "1",
  id: "parallel-research",
  nodes: { fanOut, topics, researchA, researchB, researchC, combine, summarise },
  edges: [
    ["fanOut", "topics"],
    ["topics", "researchA"],
    ["topics", "researchB"],
    ["topics", "researchC"],
    ["researchA", "combine"],
    ["researchB", "combine"],
    ["researchC", "combine"],
    ["combine", "summarise"],
  ],
  limits: { maxConcurrency: 3, maxFanOut: 3, maxNodes: 64 },
});

export async function demo() {
  const redactor = createSecretRedactor([]);
  const checkpoints = createMemoryWorkflowCheckpoints({ redactor });
  const events: WorkflowEvent[] = [];
  const result = await runWorkflow(
    workflow,
    { topics: ["hooks", "signals", "suspense"] },
    {
      agentFactory: () => createAgentSession({ agent: summarizerAgent }),
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      onEvent: (event) => events.push(event),
    },
  );
  const findings = (result.outputs.combine as { findings?: unknown[] })?.findings;
  return {
    status: result.status,
    findingsCount: findings?.length ?? 0,
    nodeStarted: events.filter((event) => event.type === "node_started").length,
    nodeFinished: events.filter((event) => event.type === "node_finished").length,
    hasSummary: result.outputs.summarise !== undefined,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
