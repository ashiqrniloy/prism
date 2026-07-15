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
  conditionalNode,
  defineWorkflow,
  functionNode,
  createWorkflowEventBus,
  runWorkflow,
  type WorkflowEvent,
} from "@arnilo/prism-workflows";

// Observability / event sink: a workflow with a conditional path produces
// events that the host collects and inspects. Demonstrates:
// - `onEvent` callback for inline logging
// - `WorkflowEventBus` for decoupled subscribers
// - event-type classification post-run
// - conditional node skip reports
// Uses mock providers — no network.

const provider = createMockProvider([
  providerTextDelta("Analysis result."),
  providerUsage({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }),
  providerDone(),
]);

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
});

const research = agentNode({
  agent: "demo",
  input: (ctx) => ctx.workflowInput,
});

const shouldFlag = conditionalNode({
  when: (_ctx) => true, // always true for demo
  then: ["flag"],
  else: [],
});

const flag = functionNode({
  execute: async (ctx) => ({ flagged: true, upstream: ctx.upstream }),
});

const done = functionNode({
  execute: async (ctx) => ({ summary: "complete", upstream: ctx.upstream }),
});

const workflow = defineWorkflow({
  id: "event-sink-demo",
  nodes: { research, shouldFlag, flag, done },
  edges: [
    ["research", "shouldFlag"],
    ["shouldFlag", "flag"],
    ["shouldFlag", "done"],
    ["flag", "done"],
  ],
  limits: { maxConcurrency: 1, maxNodes: 32 },
});

export async function demo() {
  const redactor = createSecretRedactor([]);
  const bus = createWorkflowEventBus({
    workflowId: workflow.id,
    runId: "event-sink-run",
    maxQueuedEvents: 256,
  });

  const inlineEvents: WorkflowEvent[] = [];
  const busEvents: WorkflowEvent[] = [];

  const drain = (async () => {
    for await (const event of bus.subscribe()) {
      busEvents.push(event);
    }
  })();

  const result = await runWorkflow(workflow, { query: "status" }, {
    agentFactory: () => createAgentSession({ agent }),
    redactor,
    ownership: { tenantId: "demo" },
    signal: AbortSignal.timeout(30_000),
    eventBus: bus,
    runId: "event-sink-run",
    onEvent: (e) => inlineEvents.push(e),
  });

  bus.close();
  try { await drain; } catch { /* iterator closed */ }

  // Classify events
  const byType = (events: WorkflowEvent[]) => {
    const map = new Map<string, number>();
    for (const e of events) map.set(e.type, (map.get(e.type) ?? 0) + 1);
    return Object.fromEntries(map);
  };

  return {
    status: result.status,
    inlineEventCount: inlineEvents.length,
    busEventCount: busEvents.length,
    inlineByType: byType(inlineEvents),
    busByType: byType(busEvents),
    matched: inlineEvents.length > 0 && busEvents.length > 0,
    hasAgentEvents: busEvents.some((e) => e.type === "agent_event"),
    hasSkipped: inlineEvents.some((e) => e.type === "node_skipped"),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
