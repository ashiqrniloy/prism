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
  defineWorkflow,
  functionNode,
  createMemoryWorkflowCheckpoints,
  cancelWorkflowRun,
  getWorkflowRun,
  resumeWorkflow,
  runWorkflow,
} from "@arnilo/prism-workflows";

// Programmatic cancel and resume (RPC/command surface). A host starts a
// workflow, cancels it mid-flight via cancelWorkflowRun() after first node
// checkpoints, then resumes from that checkpoint. The same pattern maps
// 1:1 to createWorkflowCommands() → runRpcServer({ commands }). Uses
// mock providers — no network.

const provider = createMockProvider([
  providerTextDelta("Long-running analysis in progress..."),
  providerUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  providerDone(),
]);

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
});

// Fast first node checkpoints, then slow second node gets cancelled.
const fastStep = functionNode({
  execute: async (ctx) => ({ step1: ctx.workflowInput }),
});

const slowStep = functionNode({
  execute: async (ctx) => {
    // Takes 500ms — the host will cancel before this finishes.
    await new Promise((r) => setTimeout(r, 500));
    return { step2: "should-not-reach" };
  },
});

const finalStep = agentNode({
  agent: "demo",
  input: (ctx) => ctx.upstream.slow ?? { step2: "default" },
});

const workflow = defineWorkflow({
  id: "cancel-resume-demo",
  nodes: { fast: fastStep, slow: slowStep, final: finalStep },
  edges: [
    ["fast", "slow"],
    ["slow", "final"],
  ],
  limits: { maxConcurrency: 1, maxNodes: 32 },
});

export async function demo() {
  const redactor = createSecretRedactor([]);
  const checkpoints = createMemoryWorkflowCheckpoints({ redactor });

  // 1. Start, let fast node complete and checkpoint, then cancel during slow
  const controller = new AbortController();
  const runPromise = runWorkflow(workflow, { step: "cancel-test" }, {
    agentFactory: () => createAgentSession({ agent }),
    checkpoints,
    redactor,
    runId: "cancel-test-run",
    ownership: { tenantId: "demo" },
    signal: controller.signal,
  });

  // Wait for fast node to finish and checkpoint to land
  await new Promise((r) => setTimeout(r, 100));

  const cancelResult = await cancelWorkflowRun({
    workflowId: workflow.id,
    checkpoints,
    ownership: { tenantId: "demo" },
    runId: "cancel-test-run",
  });

  await runPromise.catch(() => undefined);
  const abortedCheckpoint = await getWorkflowRun(checkpoints, {
    workflowId: workflow.id,
    runId: "cancel-test-run",
    ownership: { tenantId: "demo" },
  });

  // 2. Resume after cancel — slow node re-executes (same adapter simulates "restart")
  const resumeResult = await resumeWorkflow(workflow, { runId: "cancel-test-run" }, {
    agentFactory: () => createAgentSession({ agent }),
    checkpoints,
    redactor,
    ownership: { tenantId: "demo" },
    signal: AbortSignal.timeout(30_000),
  });

  return {
    cancelled: cancelResult.aborted,
    runAborted: abortedCheckpoint?.value.status === "aborted",
    resumeSucceeded: resumeResult.status === "succeeded",
    sameRunId: resumeResult.runId === "cancel-test-run",
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
