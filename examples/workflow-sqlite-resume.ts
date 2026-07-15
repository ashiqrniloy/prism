import { unlinkSync } from "node:fs";
import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerUsage,
} from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import {
  agentNode,
  createWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  runWorkflow,
  resumeWorkflow,
  type WorkflowEvent,
  type WorkflowRunResult,
} from "@arnilo/prism-workflows";

// SQLite durable checkpoint, abort, and resume. A two-node workflow writes
// to a temp SQLite database; checkpoint survives the function node then
// resumes from the checkpoint after a "crash". Uses mock providers — no network.

const DB_PATH = ".workflow-resume-demo.db";

const provider = createMockProvider([
  providerTextDelta("Hello from agent."),
  providerUsage({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }),
  providerDone(),
]);

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
});

const echoNode = functionNode({
  execute: async (ctx) => {
    // Simulate work that takes long enough for a checkpoint to land.
    await new Promise((r) => setTimeout(r, 20));
    return { echoed: ctx.workflowInput };
  },
});

const agentNodeDef = agentNode({
  agent: "demo",
  input: (ctx) => ctx.upstream.echo,
});

const workflow = defineWorkflow({
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

  const result = await runWorkflow(workflow, { input: "hello" }, {
    agentFactory: () => createAgentSession({ agent }),
    checkpoints,
    redactor,
    ownership: { tenantId: "demo" },
    signal: AbortSignal.timeout(30_000),
    onEvent: (e) => events.push(e),
  });

  persistence.close();
  return result;
}

async function resumeRun(runId: string): Promise<WorkflowRunResult> {
  const persistence = createSqlitePersistence({ filename: DB_PATH });
  const redactor = createSecretRedactor([]);
  const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints, redactor });
  const events: WorkflowEvent[] = [];

  const result = await resumeWorkflow(workflow, { runId }, {
    agentFactory: () => createAgentSession({ agent }),
    checkpoints,
    redactor,
    ownership: { tenantId: "demo" },
    signal: AbortSignal.timeout(30_000),
    onEvent: (e) => events.push(e),
  });

  persistence.close();
  return result;
}

export async function demo() {
  // Clean up from previous runs
  try { unlinkSync(DB_PATH); } catch { /* ok */ }
  try { unlinkSync(DB_PATH + "-wal"); } catch { /* ok */ }
  try { unlinkSync(DB_PATH + "-shm"); } catch { /* ok */ }

  // 1. Fresh run — should succeed
  const fresh = await runFresh();

  // 2. Resume the same runId — already succeeded, should return immediately
  const resumed = await resumeRun(fresh.runId);

  // Cleanup
  try { unlinkSync(DB_PATH); } catch { /* ok */ }
  try { unlinkSync(DB_PATH + "-wal"); } catch { /* ok */ }
  try { unlinkSync(DB_PATH + "-shm"); } catch { /* ok */ }

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
