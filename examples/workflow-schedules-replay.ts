import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import {
  createWorkflowCheckpoints,
  createWorkflowCoordinator,
  createWorkflowSchedules,
  defineWorkflow,
  functionNode,
  replayWorkflow,
  workflowNode,
} from "@arnilo/prism-workflows";

const ownership = { tenantId: "demo", userId: "operator" } as const;
const store = createMemoryCheckpointStore();
const leases = createMemoryLeaseStore();
const checkpoints = createWorkflowCheckpoints({ store });

const child = defineWorkflow({
  revision: "1",
  id: "enrich",
  nodes: {
    enrich: functionNode({
      execute: (ctx) => ctx.updateState({ enriched: true }),
    }),
  },
});

const workflow = defineWorkflow({
  revision: "1",
  id: "scheduled-report",
  state: { initial: { attempts: 0 }, schema: { type: "object" } },
  nodes: {
    prepare: functionNode({
      execute: async (ctx) => ctx.updateState({ attempts: Number(ctx.state.attempts ?? 0) + 1 }),
    }),
    enrich: workflowNode({ workflow: child }),
    publish: functionNode({ execute: (ctx) => ({ input: ctx.workflowInput, state: ctx.state }) }),
  },
  edges: [["prepare", "enrich"], ["enrich", "publish"]],
});

const schedules = createWorkflowSchedules({
  store,
  leases,
  checkpoints,
  workflows: { [workflow.id]: workflow },
  ownership,
  ownerId: "demo-scheduler",
});
await schedules.create({
  id: "report-once",
  workflowId: workflow.id,
  nextRunAt: "2026-01-01T00:00:00.000Z",
  input: { report: "weekly" },
});
await schedules.pollOnce({ now: new Date("2026-01-02T00:00:00.000Z") });

const coordinator = createWorkflowCoordinator({
  coordinatorId: "demo-worker",
  workflows: { [workflow.id]: workflow },
  checkpoints,
  leases,
  ownership,
  runOptions: { validateState: () => undefined },
});
await coordinator.pollOnce();
while (coordinator.activeRuns > 0) await new Promise((resolve) => setTimeout(resolve, 1));

const fired = await schedules.get("report-once");
if (!fired?.lastRunId) throw new Error("schedule did not enqueue a run");
const replay = await replayWorkflow(workflow, {
  sourceRunId: fired.lastRunId,
  fromNodeId: "publish",
}, {
  checkpoints,
  ownership,
  validateState: () => undefined,
});

console.log(JSON.stringify({ scheduledRunId: fired.lastRunId, replayRunId: replay.runId, lineage: replay.lineage, state: replay.state }));
