import { createAgent, createMockProvider, createToolRegistry, providerDone, providerTextDelta, providerUsage } from "@arnilo/prism";
import { createTimelineFolder, projectWorkflowTimeline, summarizeTimeline } from "@arnilo/prism-core/governance/observability";
import {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  projectWorkflowGraphRun,
  runWorkflow,
  serializeWorkflowGraph,
  type WorkflowEvent,
  workflowGraphToMermaid,
} from "@arnilo/prism-core/runtime/workflows";

// ============================================================================
// 1. Setup a 2-node workflow (extract → analyze) using mock providers
// ============================================================================

const provider = createMockProvider([
  providerTextDelta("Entity extraction: found PRISM-072 and telemetry-seam."),
  providerUsage({ inputTokens: 40, outputTokens: 20, totalTokens: 60 }),
  providerDone(),
]);

const extractorAgent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  tools: createToolRegistry(),
  instructions: "You extract technical entity names from input documents.",
});

// Node 1: Agent node that extracts entities from raw input
const extractNode = agentNode({
  agent: "extractor",
  input: (ctx) => ({ text: ctx.workflowInput }),
});

// Node 2: Function node that synthesizes downstream output
const analyzeNode = functionNode({
  execute: async (ctx) => {
    const extracted = (ctx.upstream.extract as { text?: string } | undefined)?.text ?? "";
    return {
      analysis: `Analyzed entities from previous step: ${extracted.slice(0, 30)}...`,
      confidence: 0.95,
    };
  },
});

const workflow = defineWorkflow({
  id: "extract-and-analyze",
  revision: "1.0.0",
  nodes: {
    extract: extractNode,
    analyze: analyzeNode,
  },
  edges: [["extract", "analyze"]],
});

// ============================================================================
// 2. Run workflow, collect events and checkpoints
// ============================================================================

const events: WorkflowEvent[] = [];
const checkpoints = createMemoryWorkflowCheckpoints();
const ownership = { tenantId: "tenant-demo" };

const runResult = await runWorkflow(workflow, "Prism execution timeline provides host cockpit waterfalls and trajectory evals.", {
  agentFactory: (_name) => extractorAgent.createSession(),
  checkpoints,
  ownership,
  onEvent: (event) => {
    events.push(event);
  },
});

// ============================================================================
// 3. Project ExecutionTimeline & summarize for host dashboard / cockpit
// ============================================================================

const checkpointRecord = await checkpoints.load({
  workflowId: workflow.id,
  runId: runResult.runId,
  ownership,
});
const checkpoint = checkpointRecord?.value;

// By default, content: "metadata" retains no raw prompt or output strings.
// To opt into redacted step I/O:
//   content: "redacted_io",
//   redactor: createSecretRedactor({ patterns: [/(?:sk-[A-Za-z0-9_-]{10,})/g] }),
const timeline = projectWorkflowTimeline(events, {
  content: "metadata",
  checkpoint,
});

const summary = summarizeTimeline(timeline);

// ============================================================================
// 4. Serialize workflow graph and export Mermaid visualization
// ============================================================================

const graph = serializeWorkflowGraph(workflow);
const mermaid = workflowGraphToMermaid(graph);
const graphOverlay = projectWorkflowGraphRun(graph, timeline);

// ============================================================================
// 5. Demonstrate live incremental folding from agent session
// ============================================================================

const liveAgent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([
    providerTextDelta("Streaming timeline fold example."),
    providerUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    providerDone(),
  ]),
});

const session = liveAgent.createSession();
const folder = createTimelineFolder({ content: "metadata" });

const [agentResult] = await Promise.all([
  session.run("Stream events"),
  (async () => {
    for await (const event of session.subscribe()) {
      folder.push(event);
    }
  })(),
]);

const liveTimeline = folder.snapshot();
const liveSummary = summarizeTimeline(liveTimeline);

// ============================================================================
// Print outputs
// ============================================================================

console.log(
  JSON.stringify({
    workflowRunId: runResult.runId,
    workflowStatus: runResult.status,
    timelineStepCount: timeline.steps.length,
    timelineSummary: {
      durationMs: summary.durationMs,
      providerAttempts: summary.providerAttempts,
      totalTokens: summary.usage?.totalTokens,
      status: summary.status,
    },
    graphNodes: graph.nodes.map((n) => n.id),
    graphOverlayNodeStatuses: Object.fromEntries(graphOverlay.nodes.map((n) => [n.id, n.run?.status])),
    liveAgentRunId: agentResult.runId,
    liveAgentStepCount: liveTimeline.steps.length,
    liveAgentTokens: liveSummary.usage?.totalTokens,
  }),
);

console.log("\n--- Workflow Mermaid Diagram ---");
console.log(mermaid);
