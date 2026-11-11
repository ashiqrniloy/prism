import { createWorkflowTransitionChannel, type WorkflowEvent } from "@arnilo/prism-extensions/workflows";
import { createAgent, createSecretRedactor, providerDone, providerTextDelta, providerUsage } from "@arnilo/prism";
import { createMockProvider } from "@arnilo/prism/testing";
import { agentNode, conditionalNode, defineWorkflow, functionNode, runWorkflow } from "@arnilo/prism-extensions/workflows";
import { providerPackage } from "@arnilo/prism/provider-kit";

// Observability / event sink: a workflow with a conditional path produces
// events that the host collects and inspects. Demonstrates:
// - `WorkflowTransitionChannel` for bounded async subscribers
// - event-type classification post-run
// - conditional node skip reports
// Uses mock providers — no network.

const provider = createMockProvider([
  providerTextDelta("Analysis result."),
  providerUsage({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }),
  providerDone(),
]);

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [providerPackage("test-provider", [provider])],
});

const research = agentNode({
  agent,
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
  revision: "1",
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
  const bus = createWorkflowTransitionChannel({
    workflowId: workflow.id,
    runId: "event-sink-run",
    maxQueuedEvents: 256,
  });

  const busEvents: WorkflowEvent[] = [];

  const drain = (async () => {
    for await (const event of bus.subscribe()) {
      busEvents.push(event);
    }
  })();

  const result = await runWorkflow(
    workflow,
    { query: "status" },
    {
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      runId: "event-sink-run",
      transitions: bus,
    },
  );

  bus.close();
  try {
    await drain;
  } catch {
    /* iterator closed */
  }

  // Classify events
  const byType = (events: WorkflowEvent[]) => {
    const map = new Map<string, number>();
    for (const e of events) map.set(e.type, (map.get(e.type) ?? 0) + 1);
    return Object.fromEntries(map);
  };

  return {
    status: result.status,
    eventCount: busEvents.length,
    byType: byType(busEvents),
    hasAgentEvents: busEvents.some((e) => e.type === "agent_event"),
    hasSkipped: busEvents.some((e) => e.type === "node_skipped"),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
