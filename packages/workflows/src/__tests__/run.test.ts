import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type ExecutionAction,
  type ToolDefinition,
} from "@arnilo/prism";
import {
  agentNode,
  conditionalNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  fanOutNode,
  functionNode,
  getWorkflowRun,
  joinNode,
  listWorkflowRuns,
  resumeWorkflow,
  runWorkflow,
  toolNode,
  WorkflowAbortError,
  WorkflowRuntimeError,
  type WorkflowEvent,
} from "../index.js";

describe("runWorkflow", () => {
  it("executes a diamond join with deterministic event order", async () => {
    const events: WorkflowEvent[] = [];
    const left = functionNode({ execute: async () => "L" });
    const right = functionNode({ execute: async () => "R" });
    const join = functionNode({
      execute: async (ctx) => `${ctx.upstream.left}:${ctx.upstream.right}`,
    });
    const workflow = defineWorkflow({
      id: "diamond",
      nodes: { left, right, join },
      edges: [["left", "join"], ["right", "join"]],
      limits: { maxConcurrency: 2 },
    });
    const result = await runWorkflow(workflow, null, {
      concurrency: 2,
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.join, "L:R");
    const sequences = events.map((event) => event.sequence);
    assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
    assert.ok(events.some((event) => event.type === "workflow_started"));
    assert.ok(events.some((event) => event.type === "workflow_finished"));
  });

  it("skips conditional else-path when predicate is false", async () => {
    const gate = conditionalNode({
      when: async () => false,
      else: ["fallback"],
    });
    const expensive = functionNode({ execute: async () => "nope" });
    const fallback = functionNode({ execute: async () => "ok" });
    const workflow = defineWorkflow({
      id: "cond",
      nodes: { gate, expensive, fallback },
      edges: [["gate", "expensive"], ["gate", "fallback"]],
    });
    const result = await runWorkflow(workflow, null);
    assert.equal(result.status, "succeeded");
    assert.equal(result.outputs.fallback, "ok");
    assert.equal(result.outputs.expensive, undefined);
  });

  it("enforces fan-out bounds", async () => {
    const expand = fanOutNode({
      items: async () => [1, 2, 3, 4],
      map: async (item) => item,
      maxFanOut: 2,
    });
    const workflow = defineWorkflow({
      id: "fan",
      nodes: { expand },
    });
    await assert.rejects(
      () => runWorkflow(workflow, null),
      (error: unknown) => error instanceof WorkflowRuntimeError && /maxFanOut/i.test(error.message),
    );
  });

  it("maps fan-out and join", async () => {
    const expand = fanOutNode({
      items: async (ctx) => ctx.workflowInput as number[],
      map: async (item) => Number(item) * 2,
    });
    const reduce = joinNode({
      from: "expand",
      reduce: async (items) => (items as number[]).reduce((sum, n) => sum + n, 0),
    });
    const workflow = defineWorkflow({
      id: "mapjoin",
      nodes: { expand, reduce },
      edges: [["expand", "reduce"]],
      limits: { maxFanOut: 8 },
    });
    const result = await runWorkflow(workflow, [1, 2, 3]);
    assert.equal(result.outputs.reduce, 12);
  });

  it("executes a bounded 1,000-node DAG without rescanning failures", async () => {
    const nodes: Record<string, ReturnType<typeof functionNode>> = {};
    const edges: [string, string][] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const id = `n${index}`;
      nodes[id] = functionNode({ execute: async () => index });
      if (index > 0) edges.push([`n${index - 1}`, id]);
    }
    const workflow = defineWorkflow({
      id: "thousand-node-chain",
      nodes,
      edges,
      limits: { maxNodes: 1_000, maxConcurrency: 8 },
    });
    const result = await runWorkflow(workflow, null, { concurrency: 8 });
    assert.equal(result.status, "succeeded");
    assert.equal(Object.keys(result.outputs).length, 1_000);
    assert.equal(result.outputs.n999, 999);
  });

  it("retries then succeeds", async () => {
    let attempts = 0;
    const flaky = functionNode({
      retries: 2,
      execute: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
    });
    const workflow = defineWorkflow({ id: "retry", nodes: { flaky } });
    const result = await runWorkflow(workflow, null);
    assert.equal(result.outputs.flaky, "ok");
    assert.equal(attempts, 3);
  });

  it("times out a hung node", async () => {
    const hung = functionNode({
      timeoutMs: 20,
      execute: async (ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
        return "late";
      },
    });
    const workflow = defineWorkflow({ id: "timeout", nodes: { hung } });
    await assert.rejects(() => runWorkflow(workflow, null), /Abort|timeout|failed|Workflow/i);
  });

  it("aborts mid-node via signal", async () => {
    const ac = new AbortController();
    const slow = functionNode({
      execute: async (ctx) => {
        ac.abort();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
        return "done";
      },
    });
    const workflow = defineWorkflow({ id: "abort", nodes: { slow } });
    await assert.rejects(
      () => runWorkflow(workflow, null, { signal: ac.signal }),
      (error: unknown) => error instanceof WorkflowAbortError || isAbortLike(error),
    );
  });

  it("runs agent nodes through AgentSession.run", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("hello-agent"), providerDone()]),
    });
    const research = agentNode({
      agent: "researcher",
      input: (ctx) => String(ctx.workflowInput),
    });
    const workflow = defineWorkflow({ id: "agentic", nodes: { research } });
    const result = await runWorkflow(workflow, "topic", {
      agentFactory: async () => agent.createSession({ id: "s-research" }),
    });
    assert.equal(result.outputs.research, "hello-agent");
  });

  it("propagates workflow/node metadata through ExecutionPolicy for tool nodes", async () => {
    const seen: ExecutionAction[] = [];
    const echo: ToolDefinition = {
      name: "echo",
      async execute(args) {
        return { toolCallId: "t1", name: "echo", value: args.text };
      },
    };
    const node = toolNode({
      tool: echo,
      args: async (ctx) => ({ text: String(ctx.workflowInput) }),
    });
    const workflow = defineWorkflow({ id: "tools", nodes: { node } });
    const result = await runWorkflow(workflow, "hi", {
      executionPolicy: {
        check(action) {
          seen.push(action);
          return { allowed: true };
        },
      },
    });
    assert.equal(result.outputs.node, "hi");
    assert.equal(seen[0]?.metadata?.workflowId, "tools");
    assert.equal(seen[0]?.metadata?.nodeId, "node");
  });

  it("checkpoints and resumes within process after failure", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let shouldFail = true;
    const first = functionNode({ execute: async () => "one" });
    const second = functionNode({
      execute: async () => {
        if (shouldFail) throw new Error("boom");
        return "two";
      },
    });
    const workflow = defineWorkflow({
      id: "resume",
      nodes: { first, second },
      edges: [["first", "second"]],
    });
    await assert.rejects(
      () => runWorkflow(workflow, null, { checkpoints, runId: "run-resume" }),
      /boom/,
    );
    const saved = await getWorkflowRun(checkpoints, { workflowId: "resume", runId: "run-resume" });
    assert.equal(saved?.value.nodes.first?.status, "succeeded");
    assert.equal(saved?.value.nodes.second?.status, "failed");

    shouldFail = false;
    const resumed = await resumeWorkflow(workflow, { runId: "run-resume" }, { checkpoints });
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.outputs.first, "one");
    assert.equal(resumed.outputs.second, "two");

    const listed = await listWorkflowRuns(checkpoints, { workflowId: "resume" });
    assert.equal(listed.items.length, 1);
  });

  it("redacts node outputs before checkpoint persistence", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ secrets: ["sekrit"] });
    const node = functionNode({ execute: async () => "carry-sekrit-please" });
    const workflow = defineWorkflow({ id: "redact", nodes: { node } });
    await runWorkflow(workflow, null, {
      checkpoints,
      runId: "r-redact",
      redactor: createSecretRedactor(["sekrit"]),
    });
    const saved = await getWorkflowRun(checkpoints, { workflowId: "redact", runId: "r-redact" });
    assert.match(String(saved?.value.nodes.node?.output), /\[REDACTED\]/);
  });

  it("rejects resume across tenants", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const node = functionNode({ execute: async () => 1 });
    const workflow = defineWorkflow({ id: "tenant", nodes: { node } });
    await runWorkflow(workflow, null, {
      checkpoints,
      runId: "r-tenant",
      ownership: { tenantId: "t1" },
    });
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: "r-tenant" }, {
        checkpoints,
        ownership: { tenantId: "t2" },
      }),
      /ownership|tenant/i,
    );
  });
});

function isAbortLike(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");
}
