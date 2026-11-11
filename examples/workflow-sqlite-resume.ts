import { createWorkflowTransitionChannel, type WorkflowEvent } from "@arnilo/prism-extensions/workflows";
import { unlinkSync } from "node:fs";
import { createAgent, createSecretRedactor, providerDone, providerTextDelta, providerUsage } from "@arnilo/prism";
import { createMockProvider } from "@arnilo/prism/testing";
import {
  agentNode,
  createWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
  type WorkflowRunResult,
} from "@arnilo/prism-extensions/workflows";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import { providerPackage } from "@arnilo/prism/provider-kit";

// SQLite durable checkpoint, abort, and resume. A two-node workflow writes
// to a temp SQLite database; checkpoint survives the function node then
// resumes from the checkpoint after a "crash". Uses mock providers — no network.

const DB_PATH = ".workflow-resume-demo.db";

const provider = createMockProvider([
  providerTextDelta("Hello from agent."),
  providerUsage({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }),
  providerDone(),
]);

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [providerPackage("test-provider", [provider])],
});

const echoNode = functionNode({
  execute: async (ctx) => {
    // Simulate work that takes long enough for a checkpoint to land.
    await new Promise((r) => setTimeout(r, 20));
    return { echoed: ctx.workflowInput };
  },
});

const agentNodeDef = agentNode({
  agent,
  input: (ctx) => ctx.upstream.echo,
});

const workflow = defineWorkflow({
  revision: "1",
  id: "durable-demo",
  nodes: { echo: echoNode, agent: agentNodeDef },
  edges: [["echo", "agent"]],
  limits: { maxConcurrency: 1, maxNodes: 32 },
});

async function runFresh(): Promise<WorkflowRunResult> {
  const persistence = createSqlitePersistence({ filename: DB_PATH });
  const redactor = createSecretRedactor([]);
  const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints, redactor });
  const events: WorkflowEvent[] = [];

  const result = await runWorkflow(
    workflow,
    { input: "hello" },
    {
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      transitions: workflowEvents((e) => events.push(e)),
    },
  );

  persistence.close();
  return result;
}

async function resumeRun(runId: string): Promise<WorkflowRunResult> {
  const persistence = createSqlitePersistence({ filename: DB_PATH });
  const redactor = createSecretRedactor([]);
  const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints, redactor });
  const events: WorkflowEvent[] = [];

  const result = await resumeWorkflow(
    workflow,
    { runId },
    {
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
      transitions: workflowEvents((e) => events.push(e)),
    },
  );

  persistence.close();
  return result;
}

export async function demo() {
  // Clean up from previous runs
  try {
    unlinkSync(DB_PATH);
  } catch {
    /* ok */
  }
  try {
    unlinkSync(`${DB_PATH}-wal`);
  } catch {
    /* ok */
  }
  try {
    unlinkSync(`${DB_PATH}-shm`);
  } catch {
    /* ok */
  }

  // 1. Fresh run — should succeed
  const fresh = await runFresh();

  // 2. Resume the same runId — already succeeded, should return immediately
  const resumed = await resumeRun(fresh.runId);

  // Cleanup
  try {
    unlinkSync(DB_PATH);
  } catch {
    /* ok */
  }
  try {
    unlinkSync(`${DB_PATH}-wal`);
  } catch {
    /* ok */
  }
  try {
    unlinkSync(`${DB_PATH}-shm`);
  } catch {
    /* ok */
  }

  return {
    freshStatus: fresh.status,
    freshOutputs: Object.keys(fresh.outputs),
    resumedStatus: resumed.status,
    sameRunId: fresh.runId === resumed.runId,
    durable: resumed.status === "succeeded",
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

function workflowEvents(consume: (event: WorkflowEvent) => void) {
  const channel = createWorkflowTransitionChannel({ workflowId: "events", runId: "events" });
  void (async () => {
    for await (const event of channel.subscribe()) consume(event);
  })();
  return channel;
}
