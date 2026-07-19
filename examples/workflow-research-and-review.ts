import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createSecretRedactor,
  createToolRegistry,
  providerDone,
  providerTextDelta,
  providerUsage,
  type AgentEvent,
} from "@arnilo/prism";
import {
  agentNode,
  defineWorkflow,
  createMemoryWorkflowCheckpoints,
  runWorkflow,
  type WorkflowEvent,
} from "@arnilo/prism-workflows";

// Sequential research → draft → review pipeline with in-memory checkpoints.
// Three agent nodes chained: researcher gathers facts, writer produces draft,
// reviewer checks quality. Uses mock providers — no network, no credentials.

const provider = createMockProvider([
  providerTextDelta("Key facts: hooks simplify state management in React."),
  providerUsage({ inputTokens: 12, outputTokens: 8, totalTokens: 20 }),
  providerDone(),
]);
const tools = createToolRegistry();

function makeAgent(name: string, system: string) {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    tools,
    instructions: system,
  });
}

const researchAgent = makeAgent("researcher", "You research a topic and return key facts.");
const writerAgent = makeAgent("writer", "You write a draft based on provided facts.");
const reviewerAgent = makeAgent("reviewer", "You review a draft for quality. Return approved/fix-needed.");

const researchNode = agentNode({
  agent: "researcher",
  input: (ctx) => ({ topic: ctx.workflowInput }),
});

const draftNode = agentNode({
  agent: "writer",
  input: (ctx) => ({ facts: ctx.upstream.research }),
});

const reviewNode = agentNode({
  agent: "reviewer",
  input: (ctx) => ({ draft: ctx.upstream.draft }),
});

const workflow = defineWorkflow({
  revision: "1",
  id: "research-draft-review",
  nodes: { research: researchNode, draft: draftNode, review: reviewNode },
  edges: [
    ["research", "draft"],
    ["draft", "review"],
  ],
  limits: { maxConcurrency: 1 },
});

export async function demo() {
  const redactor = createSecretRedactor([]);
  const checkpoints = createMemoryWorkflowCheckpoints({ redactor });

  const events: WorkflowEvent[] = [];
  const result = await runWorkflow(
    workflow,
    { topic: "React hooks" },
    {
      agentFactory: (name) =>
        createAgentSession({
          agent:
            name === "researcher" ? researchAgent
            : name === "writer" ? writerAgent
            : reviewerAgent,
        }),
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      onEvent: (e) => events.push(e),
    },
  );

  const eventTypes = events.map((e) => e.type);
  const allSucceeded = Object.values(result.outputs).every((v) => v !== undefined);
  return {
    status: result.status,
    outputs: Object.keys(result.outputs),
    eventTypes,
    allSucceeded,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
