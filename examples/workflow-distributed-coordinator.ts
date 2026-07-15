import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import {
  createWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  enqueueWorkflow,
  functionNode,
  getWorkflowRun,
} from "@arnilo/prism-workflows";

export async function demo(): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "prism-coordinator-"));
  const filename = join(dir, "workflow.db");
  const firstPersistence = createSqlitePersistence({ filename });
  const secondPersistence = createSqlitePersistence({ filename });
  try {
    let executions = 0;
    const workflow = defineWorkflow({
      id: "distributed-demo",
      nodes: {
        work: functionNode({ execute: async () => {
          executions += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return "completed";
        } }),
      },
      edges: [],
    });
    const firstCheckpoints = createWorkflowCheckpoints({ store: firstPersistence.checkpoints });
    const secondCheckpoints = createWorkflowCheckpoints({ store: secondPersistence.checkpoints });
    const queued = await enqueueWorkflow(workflow, null, { checkpoints: firstCheckpoints });
    const first = createWorkflowCoordinator({ coordinatorId: "process-a", workflows: { [workflow.id]: workflow }, checkpoints: firstCheckpoints, leases: firstPersistence.leases, leaseTtlMs: 1_000, renewalIntervalMs: 200 });
    const second = createWorkflowCoordinator({ coordinatorId: "process-b", workflows: { [workflow.id]: workflow }, checkpoints: secondCheckpoints, leases: secondPersistence.leases, leaseTtlMs: 1_000, renewalIntervalMs: 200 });
    const claims = await Promise.all([first.pollOnce(), second.pollOnce()]);
    let record = await getWorkflowRun(firstCheckpoints, queued);
    while (record?.value.status !== "succeeded") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      record = await getWorkflowRun(firstCheckpoints, queued);
    }
    return { claims, executions, status: record.value.status, fencingToken: record.fencingToken };
  } finally {
    firstPersistence.close();
    secondPersistence.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
