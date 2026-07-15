import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerUsage,
  type ExecutionAction,
  type ExecutionPolicy,
} from "@arnilo/prism";
import { mapMcpToolsToDefinitions } from "@arnilo/prism-mcp";
import {
  agentNode,
  defineWorkflow,
  toolNode,
  createMemoryWorkflowCheckpoints,
  runWorkflow,
  type WorkflowEvent,
} from "@arnilo/prism-workflows";

// Agent → MCP-backed tool-node chain with ExecutionPolicy approval. Public
// mapMcpToolsToDefinitions() maps an offline fake remote tool to ToolDefinition;
// the workflow policy verifies workflowId/nodeId metadata before execution.
// Uses mock providers and no transport — no network or subprocess.

const provider = createMockProvider([
  providerTextDelta("I'll scan the repo for you."),
  providerUsage({ inputTokens: 10, outputTokens: 6, totalTokens: 16 }),
  providerDone(),
]);

const echoContent = "file content here";
const scanTool = mapMcpToolsToDefinitions(
  [{
    name: "scan",
    description: "Read a file from the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  }],
  {
    serverId: "offline-demo",
    namePrefix: "mcp:offline-demo:",
    callTimeoutMs: 1_000,
    maxResultBytes: 4_096,
    isClosed: () => false,
    callRemoteTool: async (_name, args, ctx) => ({
      toolCallId: ctx.toolCallId,
      name: "mcp:offline-demo:scan",
      value: { path: args.path, content: echoContent },
    }),
  },
)[0]!;

const researchAgent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  instructions: "Research the repo.",
});

const policy: ExecutionPolicy = {
  async check(action: ExecutionAction) {
    const meta = action.metadata as Record<string, unknown> | undefined;
    const hasWorkflowId = typeof meta?.workflowId === "string";
    const hasNodeId = typeof meta?.nodeId === "string";
    if (!hasWorkflowId || !hasNodeId) {
      return { allowed: false, reason: "missing workflow/node metadata" };
    }
    if (action.kind === "shell" && action.operation === "run") {
      return { allowed: false, reason: "shell denied" };
    }
    return { allowed: true };
  },
};

const researchNode = agentNode({
  agent: "researcher",
  input: (ctx) => ({ repo: ctx.workflowInput }),
});

const scanNode = toolNode({
  tool: scanTool,
  args: (ctx) => ({ path: "src/index.ts" }),
  action: (ctx, args) => ({
    kind: "file",
    operation: "read",
    paths: [args.path as string],
    risk: "low",
    metadata: {
      workflowId: ctx.workflowId,
      nodeId: ctx.nodeId,
      step: "scan",
    },
  }),
});

const workflow = defineWorkflow({
  id: "research-and-scan",
  nodes: { research: researchNode, scan: scanNode },
  edges: [["research", "scan"]],
  limits: { maxNodes: 32, maxConcurrency: 1 },
});

export async function demo() {
  const redactor = createSecretRedactor([]);
  const checkpoints = createMemoryWorkflowCheckpoints({ redactor });

  const events: WorkflowEvent[] = [];
  const result = await runWorkflow(
    workflow,
    { repo: "my-project" },
    {
      agentFactory: () =>
        createAgentSession({ agent: researchAgent }),
      checkpoints,
      redactor,
      executionPolicy: policy,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      onEvent: (e) => events.push(e),
    },
  );

  const failEvents = events.filter((e) => e.type === "node_failed");
  const toolOutput = result.outputs.scan as { content?: string } | undefined;
  return {
    status: result.status,
    scanContent: toolOutput?.content === echoContent,
    noFailures: failEvents.length === 0,
    outputs: Object.keys(result.outputs),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
