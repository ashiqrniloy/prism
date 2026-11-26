import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentRunInterruption,
  askEveryTool,
  createAgent,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
  suspend,
  type WorkflowCheckpointAdapter,
  type WorkflowCheckpointValue,
  workflowNode,
} from "../index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A node that suspends until resumed, then returns the input it was resumed with. */
const asking = (reason: string) =>
  functionNode({ execute: (ctx) => (ctx.resume ? { answer: ctx.resume.input } : suspend({ reason, data: { q: reason } })) });

/** Copies the newest checkpoint into a fresh adapter: what a process restarted after SIGKILL would load. */
async function restart(
  from: WorkflowCheckpointAdapter,
  workflowId: string,
  runId: string,
  edit?: (value: WorkflowCheckpointValue) => WorkflowCheckpointValue,
): Promise<WorkflowCheckpointAdapter> {
  const record = await from.load({ workflowId, runId });
  assert.ok(record);
  const to = createMemoryWorkflowCheckpoints();
  for (let version = 1; version <= record.version; version += 1) {
    await to.save({
      workflowId,
      runId,
      version,
      expectedVersion: version - 1,
      value: version === record.version ? (edit ? edit(record.value) : record.value) : record.value,
    });
  }
  return to;
}

describe("per-node suspensions", () => {
  it("two_suspensions_are_both_pending_while_independent_branches_finish", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({
      id: "two-suspends",
      revision: "1",
      nodes: {
        a: asking("ask_a"),
        b: asking("ask_b"),
        c: functionNode({
          execute: async () => {
            await sleep(30);
            return "c";
          },
        }),
        d: functionNode({ execute: () => "d" }),
      },
      edges: [["c", "d"]],
    });
    let result = await runWorkflow(wf, {}, { checkpoints, runId: "r1" });
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}).sort(), ["a", "b"]);
    assert.equal(result.suspensions?.a?.reason, "ask_a");
    assert.equal(result.suspensions?.b?.reason, "ask_b");
    assert.equal(result.outputs.c, "c");
    assert.equal(result.outputs.d, "d");
    // The deprecated single field is the first pending suspension.
    assert.equal(result.suspension?.nodeId, Object.keys(result.suspensions ?? {})[0]);

    result = await resumeWorkflow(
      wf,
      { runId: result.runId },
      { checkpoints, resume: { nodeId: "a", decision: "approve", input: "answer-for-a", expectedVersion: result.version } },
    );
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}), ["b"]);
    assert.deepEqual(result.outputs.a, { answer: "answer-for-a" });
    assert.equal(result.outputs.b, undefined);

    result = await resumeWorkflow(
      wf,
      { runId: result.runId },
      {
        checkpoints,
        resume: { nodeId: "b", decision: "approve", input: "answer-for-b", expectedVersion: result.version },
      },
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.suspensions, undefined);
    assert.deepEqual(result.outputs.b, { answer: "answer-for-b" });
    assert.deepEqual(result.outputs.a, { answer: "answer-for-a" });
  });

  it("a_suspended_node_blocks_only_its_own_successors", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const started: string[] = [];
    const track = (id: string) =>
      functionNode({
        execute: async () => {
          started.push(id);
          await sleep(5);
          return id;
        },
      });
    const wf = defineWorkflow({
      id: "branch-local",
      revision: "1",
      nodes: { a: asking("ask_a"), after_a: track("after_a"), c1: track("c1"), c2: track("c2"), c3: track("c3") },
      edges: [
        ["a", "after_a"],
        ["c1", "c2"],
        ["c2", "c3"],
      ],
      limits: { maxConcurrency: 1 },
    });
    const result = await runWorkflow(wf, {}, { checkpoints, runId: "r1" });
    assert.equal(result.status, "suspended");
    assert.deepEqual(started, ["c1", "c2", "c3"]);
    assert.equal(result.outputs.after_a, undefined);
  });

  it("a_resume_names_an_unknown_suspension_fails_closed", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({ id: "one", revision: "1", nodes: { a: asking("ask_a") } });
    const result = await runWorkflow(wf, {}, { checkpoints, runId: "r1" });
    await assert.rejects(
      resumeWorkflow(wf, { runId: "r1" }, { checkpoints, resume: { nodeId: "zz", decision: "approve", expectedVersion: result.version } }),
      /No pending suspension for node "zz"/,
    );
  });

  it("a_suspended_agent_node_and_a_suspended_function_node_each_resume_with_their_own_input", async () => {
    let turn = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield { type: "tool_call" as const, call: toolCallContent("c1", "write", {}) };
          yield providerDone();
          return;
        }
        yield providerTextDelta("written");
        yield providerDone();
      },
    };
    let interruption: AgentRunInterruption | undefined;
    const worker = await createAgent({
      id: "gated",
      model: { provider: "mock", model: "m" },
      hooks(hooks) {
        askEveryTool()(hooks);
        hooks.on("run.suspended", (event: { interruption?: AgentRunInterruption }) => {
          interruption = event.interruption;
        });
      },
      packages: [providerPackage("gated-provider", [provider])],
      tools: {
        add: [
          {
            name: "write",
            parameters: {},
            execute: (_a: unknown, c: { toolCallId: string }) => ({ toolCallId: c.toolCallId, name: "write", value: "done" }),
          },
        ],
      },
    });
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({
      id: "agent-and-function",
      revision: "1",
      nodes: { build: agentNode({ agent: worker, input: () => "write it" }), review: asking("ask_review") },
    });
    let result = await runWorkflow(wf, {}, { checkpoints, runId: "r1" });
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}).sort(), ["build", "review"]);
    assert.equal(result.suspensions?.build?.reason, "child_session_suspended");
    const approvalId = interruption?.pendingDecisions?.[0]?.approvalId;
    assert.ok(approvalId);

    result = await resumeWorkflow(
      wf,
      { runId: "r1" },
      { checkpoints, resume: { nodeId: "review", decision: "approve", input: "looks good", expectedVersion: result.version } },
    );
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}), ["build"]);
    assert.deepEqual(result.outputs.review, { answer: "looks good" });

    result = await resumeWorkflow(
      wf,
      { runId: "r1" },
      {
        checkpoints,
        resume: { nodeId: "build", decision: "approve", input: [{ approvalId, outcome: "allow_once" }], expectedVersion: result.version },
      },
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.build, "written");
  });

  it("a_nested_run_surfaces_every_suspension_under_child_qualified_ids", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const child = defineWorkflow({ id: "child", revision: "1", nodes: { x: asking("ask_x"), y: asking("ask_y") } });
    const parent = defineWorkflow({
      id: "parent",
      revision: "1",
      nodes: { t3: workflowNode({ workflow: child }), side: functionNode({ execute: () => "side" }) },
    });
    let result = await runWorkflow(parent, {}, { checkpoints, runId: "p1" });
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}).sort(), ["t3/x", "t3/y"]);
    assert.equal(result.suspensions?.["t3/x"]?.reason, "ask_x");
    assert.equal(result.outputs.side, "side");

    result = await resumeWorkflow(
      parent,
      { runId: "p1" },
      { checkpoints, resume: { nodeId: "t3/y", decision: "approve", input: "Y", expectedVersion: result.version } },
    );
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}), ["t3/x"]);

    result = await resumeWorkflow(
      parent,
      { runId: "p1" },
      { checkpoints, resume: { nodeId: "t3/x", decision: "approve", input: "X", expectedVersion: result.version } },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.t3, { x: { answer: "X" }, y: { answer: "Y" } });
  });

  it("emits_workflow_suspended_once_per_node", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({ id: "events", revision: "1", nodes: { a: asking("ask_a"), b: asking("ask_b") } });
    const { createWorkflowTransitionChannel } = await import("../events.js");
    const channel = createWorkflowTransitionChannel({ workflowId: "events", runId: "r1" });
    const seen: string[] = [];
    const reading = (async () => {
      for await (const event of channel.subscribe()) if (event.type === "workflow_suspended") seen.push(event.suspension.nodeId);
    })();
    await runWorkflow(wf, {}, { checkpoints, runId: "r1", transitions: channel });
    channel.close();
    await reading;
    assert.deepEqual(seen.sort(), ["a", "b"]);
  });

  it("a_restart_after_sigkill_keeps_every_pending_suspension", async () => {
    const before = createMemoryWorkflowCheckpoints();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstRun = true;
    const wf = defineWorkflow({
      id: "killed",
      revision: "1",
      nodes: {
        a: asking("ask_a"),
        b: asking("ask_b"),
        slow: functionNode({
          execute: async () => {
            if (firstRun) await blocked;
            return "slow";
          },
        }),
      },
    });
    const controller = new AbortController();
    const running = runWorkflow(wf, {}, { checkpoints: before, runId: "k1", signal: controller.signal }).catch(() => undefined);
    // Wait until both suspensions are durable while `slow` is still running, then "kill" the process.
    for (let i = 0; i < 100; i += 1) {
      const record = await before.load({ workflowId: "killed", runId: "k1" });
      if (Object.keys(record?.value.suspensions ?? {}).length === 2) break;
      await sleep(5);
    }
    const after = await restart(before, "killed", "k1");
    controller.abort();
    release();
    await running;
    firstRun = false;

    const recovered = await after.load({ workflowId: "killed", runId: "k1" });
    assert.equal(recovered?.value.status, "running");
    let result = await resumeWorkflow(wf, { runId: "k1" }, { checkpoints: after });
    assert.equal(result.status, "suspended");
    assert.deepEqual(Object.keys(result.suspensions ?? {}).sort(), ["a", "b"]);
    assert.equal(result.outputs.slow, "slow");
    result = await resumeWorkflow(
      wf,
      { runId: "k1" },
      { checkpoints: after, resume: { nodeId: "b", decision: "approve", input: 2, expectedVersion: result.version } },
    );
    result = await resumeWorkflow(
      wf,
      { runId: "k1" },
      { checkpoints: after, resume: { decision: "approve", input: 1, expectedVersion: result.version } },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.a, { answer: 1 });
    assert.deepEqual(result.outputs.b, { answer: 2 });
  });

  it("a_checkpoint_with_only_the_single_descriptor_still_resumes", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({ id: "legacy", revision: "1", nodes: { a: asking("ask_a") } });
    await runWorkflow(wf, {}, { checkpoints, runId: "l1" });
    // What the single-descriptor version wrote: `suspension` and no `suspensions`.
    const legacy = await restart(checkpoints, "legacy", "l1", ({ suspensions: _dropped, ...value }) => value);
    const stored = await legacy.load({ workflowId: "legacy", runId: "l1" });
    assert.equal(stored?.value.suspensions, undefined);
    assert.equal(stored?.value.suspension?.nodeId, "a");
    const result = await resumeWorkflow(
      wf,
      { runId: "l1" },
      { checkpoints: legacy, resume: { decision: "approve", input: "ok", expectedVersion: stored?.version ?? 0 } },
    );
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.outputs.a, { answer: "ok" });
  });
});

describe("agent-node profile pacing", () => {
  /** A one-run-at-a-time profile: a second concurrent run is refused with the driver kit's `profile_busy`. */
  const busyProfile = (code = "profile_busy") => {
    let active = 0;
    const order: string[] = [];
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        if (active > 0) throw Object.assign(new Error(`${code}: profile at its cap`), { code });
        active += 1;
        try {
          const text = JSON.stringify(request.messages.at(-1)?.content ?? "");
          order.push(text.includes("first") ? "first" : "second");
          await sleep(30);
          yield providerTextDelta("done");
          yield providerDone();
        } finally {
          active -= 1;
        }
      },
    };
    return { provider, order };
  };

  it("two_parallel_agent_nodes_on_one_busy_profile_both_succeed", async () => {
    const { provider, order } = busyProfile();
    const worker = await createAgent({
      id: "cli",
      model: { provider: "mock", model: "m" },
      packages: [providerPackage("busy-provider", [provider])],
    });
    const wf = defineWorkflow({
      id: "paced",
      revision: "1",
      nodes: {
        one: agentNode({ agent: worker, input: () => "first", maxProfileBackoffMs: 50 }),
        two: agentNode({ agent: worker, input: () => "second", maxProfileBackoffMs: 50 }),
      },
    });
    const result = await runWorkflow(wf, {}, {});
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.one, "done");
    assert.equal(result.outputs.two, "done");
    assert.equal(order.length, 2);
  });

  it("another_driver_error_still_fails_the_node", async () => {
    const { provider } = busyProfile("profile_principal_mismatch");
    const worker = await createAgent({
      id: "cli",
      model: { provider: "mock", model: "m" },
      packages: [providerPackage("mismatch-provider", [provider])],
    });
    const wf = defineWorkflow({
      id: "mismatch",
      revision: "1",
      nodes: { one: agentNode({ agent: worker, input: () => "first" }), two: agentNode({ agent: worker, input: () => "second" }) },
    });
    await assert.rejects(runWorkflow(wf, {}, {}), (error: { code?: string }) => error.code === "profile_principal_mismatch");
  });

  it("profile_pacing_false_fails_fast", async () => {
    const { provider } = busyProfile();
    const worker = await createAgent({
      id: "cli",
      model: { provider: "mock", model: "m" },
      packages: [providerPackage("busy-fast-provider", [provider])],
    });
    const wf = defineWorkflow({
      id: "fast",
      revision: "1",
      nodes: {
        one: agentNode({ agent: worker, input: () => "first", profilePacing: false }),
        two: agentNode({ agent: worker, input: () => "second", profilePacing: false }),
      },
    });
    await assert.rejects(runWorkflow(wf, {}, {}), (error: { code?: string }) => error.code === "profile_busy");
  });
});
