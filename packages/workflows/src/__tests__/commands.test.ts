import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelWorkflowRun,
  createMemoryWorkflowCheckpoints,
  createWorkflowCommands,
  defineWorkflow,
  functionNode,
  getWorkflowRun,
  listWorkflowRuns,
  runWorkflow,
  suspend,
  WorkflowAbortError,
} from "../index.js";

function buildWorkflow() {
  const step = functionNode({
    execute: async (ctx) => ({ echo: ctx.workflowInput }),
  });
  return defineWorkflow({
    revision: "1",
    id: "demo",
    nodes: { step },
    edges: [],
  });
}

describe("createWorkflowCommands", () => {
  it("registers start/enqueue/replay/status/list/cancel/resume command names", () => {
    const commands = createWorkflowCommands({
      workflows: { demo: buildWorkflow() },
      checkpoints: createMemoryWorkflowCheckpoints(),
    });
    assert.deepEqual(
      commands.map((command) => command.name),
      ["workflow.start", "workflow.enqueue", "workflow.replay", "workflow.status", "workflow.list", "workflow.cancel", "workflow.resume"],
    );
  });

  it("starts, lists, and statuses a workflow via commands", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = buildWorkflow();
    const commands = createWorkflowCommands({
      workflows: { [workflow.id]: workflow },
      checkpoints,
      runOptions: { ownership: { tenantId: "t1" } },
    });
    const byName = Object.fromEntries(commands.map((command) => [command.name, command]));

    const started = await byName["workflow.start"]!.execute(
      { workflowId: "demo", input: { hello: "world" } },
      {},
    );
    assert.equal(started.error, undefined);
    const value = started.value as { runId: string; status: string; outputs: Record<string, unknown> };
    assert.equal(value.status, "succeeded");
    assert.deepEqual(value.outputs.step, { echo: { hello: "world" } });

    const status = await byName["workflow.status"]!.execute(
      { workflowId: "demo", runId: value.runId },
      {},
    );
    assert.equal(status.error, undefined);
    assert.equal((status.value as { value: { status: string } }).value.status, "succeeded");

    const listed = await byName["workflow.list"]!.execute({ workflowId: "demo" }, {});
    assert.equal(listed.error, undefined);
    assert.equal((listed.value as { items: unknown[] }).items.length, 1);
  });

  it("enqueues background runs and replays completed runs", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = buildWorkflow();
    const commands = createWorkflowCommands({ workflows: { demo: workflow }, checkpoints });
    const byName = Object.fromEntries(commands.map((command) => [command.name, command]));
    const queued = await byName["workflow.enqueue"]!.execute({ workflowId: "demo", input: "later", runId: "background-1" }, {});
    assert.equal((queued.value as { status: string }).status, "queued");

    const source = await runWorkflow(workflow, "source", { checkpoints, runId: "source-1" });
    const replayed = await byName["workflow.replay"]!.execute({
      workflowId: "demo",
      sourceRunId: source.runId,
      fromNodeId: "step",
      runId: "replay-1",
    }, {});
    assert.equal(replayed.error, undefined);
    assert.equal((replayed.value as { status: string }).status, "succeeded");
  });

  it("cancels an in-flight run started via runWorkflow", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const slow = functionNode({
      execute: async (ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new WorkflowAbortError());
          }, { once: true });
        });
        return "done";
      },
    });
    const workflow = defineWorkflow({ revision: "1", id: "cancel-me", nodes: { slow }, edges: [] });
    const runPromise = runWorkflow(workflow, null, {
      checkpoints,
      ownership: { tenantId: "t1" },
      runId: "wfr_cancel_1",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const cancelled = await cancelWorkflowRun({
      workflowId: "cancel-me",
      runId: "wfr_cancel_1",
      workflow,
      checkpoints,
      ownership: { tenantId: "t1" },
    });
    assert.equal(cancelled.aborted, true);
    assert.equal(cancelled.wasActive, true);

    await assert.rejects(() => runPromise, WorkflowAbortError);

    const record = await getWorkflowRun(checkpoints, {
      workflowId: "cancel-me",
      runId: "wfr_cancel_1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(record?.value.status, "aborted");
  });

  it("marks orphaned running checkpoints aborted", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = buildWorkflow();
    await runWorkflow(workflow, null, {
      checkpoints,
      runId: "orphan",
      ownership: { tenantId: "t1" },
    });
    const completed = await checkpoints.load({
      workflowId: "demo",
      runId: "orphan",
      ownership: { tenantId: "t1" },
    });
    assert.ok(completed);
    await checkpoints.save({
      ...completed,
      version: completed.version + 1,
      expectedVersion: completed.version,
      value: { ...completed.value, status: "running" },
    });

    const result = await cancelWorkflowRun({
      workflowId: "demo",
      runId: "orphan",
      workflow,
      checkpoints,
      ownership: { tenantId: "t1" },
    });
    assert.equal(result.aborted, true);
    assert.equal(result.wasActive, false);

    const record = await getWorkflowRun(checkpoints, {
      workflowId: "demo",
      runId: "orphan",
      ownership: { tenantId: "t1" },
    });
    assert.equal(record?.value.status, "aborted");
    assert.equal(record?.version, completed.version + 2);
  });

  it("resumes via workflow.resume command after cancel", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
      id: "resume-demo",
      nodes: {
        first: functionNode({ execute: async () => "one" }),
        second: functionNode({
          execute: async (ctx) => `${ctx.upstream.first}-two`,
        }),
      },
      edges: [["first", "second"]],
    });

    const gated = defineWorkflow({
      revision: "1",
      id: "resume-demo",
      nodes: {
        first: functionNode({ execute: async () => "one" }),
        second: functionNode({
          execute: async (ctx) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 5_000);
              ctx.signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new WorkflowAbortError());
              }, { once: true });
            });
            return `${ctx.upstream.first}-two`;
          },
        }),
      },
      edges: [["first", "second"]],
    });

    const runPromise = runWorkflow(gated, null, {
      checkpoints,
      ownership: { tenantId: "t1" },
      runId: "wfr_resume_1",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await cancelWorkflowRun({
      workflowId: "resume-demo",
      runId: "wfr_resume_1",
      workflow: gated,
      checkpoints,
      ownership: { tenantId: "t1" },
    });
    await assert.rejects(() => runPromise, WorkflowAbortError);

    const commands = createWorkflowCommands({
      workflows: { "resume-demo": workflow },
      checkpoints,
      runOptions: { ownership: { tenantId: "t1" } },
    });
    const resumeCmd = commands.find((command) => command.name === "workflow.resume")!;
    const resumed = await resumeCmd.execute(
      { workflowId: "resume-demo", runId: "wfr_resume_1" },
      {},
    );
    assert.equal(resumed.error, undefined, String(resumed.error?.message));
    const value = resumed.value as { status: string; outputs: Record<string, unknown> };
    assert.equal(value.status, "succeeded");
    assert.equal(value.outputs.second, "one-two");
  });

  it("passes durable approval payload and expected version through workflow.resume", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
      id: "command-suspend",
      nodes: {
        review: functionNode({
          execute: async (ctx) => ctx.resume
            ? { reviewer: (ctx.resume.input as { reviewer: string }).reviewer }
            : suspend({ reason: "review" }),
        }),
      },
    });
    const commands = createWorkflowCommands({ workflows: { [workflow.id]: workflow }, checkpoints });
    const byName = Object.fromEntries(commands.map((command) => [command.name, command]));
    const started = await byName["workflow.start"]!.execute({ workflowId: workflow.id }, {});
    const startValue = started.value as { runId: string; status: string; version: number };
    assert.equal(startValue.status, "suspended");

    const resumed = await byName["workflow.resume"]!.execute({
      workflowId: workflow.id,
      runId: startValue.runId,
      decision: "approve",
      input: { reviewer: "Ada" },
      expectedVersion: startValue.version,
    }, {});
    assert.equal(resumed.error, undefined);
    assert.deepEqual(
      (resumed.value as { outputs: Record<string, unknown> }).outputs.review,
      { reviewer: "Ada" },
    );
  });

  it("listWorkflowRuns helper paginates", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    for (let i = 0; i < 3; i += 1) {
      await runWorkflow(buildWorkflow(), i, {
        checkpoints,
        ownership: { tenantId: "t1" },
        runId: `wfr_list_${i}`,
      });
    }
    const page = await listWorkflowRuns(checkpoints, {
      workflowId: "demo",
      ownership: { tenantId: "t1" },
      limit: 2,
    });
    assert.equal(page.items.length, 2);
    assert.ok(page.nextCursor);
  });
});
