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
  cancelWorkflowRun,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  fanOutNode,
  functionNode,
  getWorkflowRun,
  joinNode,
  listWorkflowRuns,
  resumeWorkflow,
  runWorkflow,
  suspend,
  toolNode,
  WorkflowAbortError,
  WorkflowCheckpointError,
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
      revision: "1",
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
      revision: "1",
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
      revision: "1",
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
      revision: "1",
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
      revision: "1",
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
    const workflow = defineWorkflow({ revision: "1", id: "retry", nodes: { flaky } });
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
    const workflow = defineWorkflow({ revision: "1", id: "timeout", nodes: { hung } });
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
    const workflow = defineWorkflow({ revision: "1", id: "abort", nodes: { slow } });
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
    const workflow = defineWorkflow({ revision: "1", id: "agentic", nodes: { research } });
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
    const workflow = defineWorkflow({ revision: "1", id: "tools", nodes: { node } });
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

  it("routes workflow tools through core guardrails before side effects", async () => {
    let executed = false;
    const tool: ToolDefinition = {
      name: "blocked",
      execute: () => {
        executed = true;
        return { toolCallId: "x", name: "blocked" };
      },
    };
    const workflow = defineWorkflow({
      revision: "1",
      id: "guarded-tool",
      nodes: { node: toolNode({ tool, args: async () => ({}) }) },
    });
    await assert.rejects(
      () => runWorkflow(workflow, null, {
        guardrails: { toolInput: [{ name: "deny", stage: "tool_input", evaluate: () => ({ action: "block" }) }] },
      }),
      /Tool call blocked by guardrail/,
    );
    assert.equal(executed, false);
  });

  it("durably approves a tool before side effects and rechecks execution policy", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let executions = 0;
    let policyChecks = 0;
    const publish: ToolDefinition = {
      name: "publish",
      async execute() {
        executions += 1;
        return { toolCallId: "publish-1", name: "publish", value: "published" };
      },
    };
    const workflow = defineWorkflow({
      revision: "1",
      id: "approve-tool",
      nodes: {
        publish: toolNode({
          tool: publish,
          args: async () => ({ artifactId: "a1" }),
          approval: { reason: "publish release", data: async (_ctx, args) => args },
        }),
      },
    });
    const suspended = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "tool-approval-1",
      executionPolicy: { check: () => { policyChecks += 1; return { allowed: true }; } },
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(executions, 0);
    assert.equal(policyChecks, 0);

    const resumed = await resumeWorkflow(workflow, { runId: suspended.runId }, {
      checkpoints,
      resume: { decision: "approve", expectedVersion: suspended.version },
      executionPolicy: { check: () => { policyChecks += 1; return { allowed: true }; } },
    });
    assert.equal(resumed.status, "succeeded");
    assert.equal(executions, 1);
    assert.equal(policyChecks, 1);

    const deniedPolicyStart = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "tool-policy-deny",
    });
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: deniedPolicyStart.runId }, {
        checkpoints,
        resume: { decision: "approve", expectedVersion: deniedPolicyStart.version },
        executionPolicy: { check: () => ({ allowed: false, reason: "policy changed" }) },
      }),
      /policy changed/,
    );
    assert.equal(executions, 1);
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
      revision: "1",
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

  it("durably suspends and resumes exactly once after restart", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let sideEffects = 0;
    const publish = functionNode({
      execute: async (ctx) => {
        if (!ctx.resume) {
          return suspend<{ reviewer: string }>({
            reason: "publish",
            data: { artifactId: "a1" },
            resumeSchema: {
              type: "object",
              properties: { reviewer: { type: "string" } },
              required: ["reviewer"],
            },
          });
        }
        sideEffects += 1;
        return { approvedBy: (ctx.resume.input as { reviewer: string }).reviewer };
      },
    });
    const workflow = defineWorkflow({ revision: "1", id: "human-publish", nodes: { publish } });
    const suspended = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "suspend-1",
      ownership: { tenantId: "t1" },
    });
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.suspension?.reason, "publish");
    assert.equal(sideEffects, 0);

    const options = {
      checkpoints,
      ownership: { tenantId: "t1" },
      resume: {
        decision: "approve" as const,
        input: { reviewer: "Ada" },
        expectedVersion: suspended.version,
      },
      validateResume: ({ value }: { value: unknown }) => {
        assert.equal(typeof (value as { reviewer?: unknown }).reviewer, "string");
      },
    };
    const [first, second] = await Promise.allSettled([
      resumeWorkflow(workflow, { runId: suspended.runId }, options),
      resumeWorkflow(workflow, { runId: suspended.runId }, options),
    ]);
    assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
    assert.equal([first, second].filter((result) => result.status === "rejected").length, 1);
    const fulfilled = [first, second].find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof resumeWorkflow>>> => result.status === "fulfilled",
    );
    assert.equal(fulfilled?.value.status, "succeeded");
    assert.deepEqual(fulfilled?.value.outputs.publish, { approvedBy: "Ada" });
    assert.equal(sideEffects, 1);
  });

  it("serializes concurrent suspension requests without losing a node", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const reviewed = new Set<string>();
    const reviewNode = (id: string) => functionNode({
      execute: async (ctx) => {
        if (!ctx.resume) return suspend({ reason: `review-${id}` });
        reviewed.add(id);
        return id;
      },
    });
    const workflow = defineWorkflow({
      revision: "1",
      id: "two-reviews",
      nodes: { a: reviewNode("a"), b: reviewNode("b") },
      edges: [],
      limits: { maxConcurrency: 2 },
    });
    let result = await runWorkflow(workflow, null, { checkpoints, runId: "two-reviews-1" });
    assert.equal(result.status, "suspended");
    result = await resumeWorkflow(workflow, { runId: result.runId }, {
      checkpoints,
      resume: { decision: "approve", expectedVersion: result.version },
    });
    assert.equal(result.status, "suspended");
    result = await resumeWorkflow(workflow, { runId: result.runId }, {
      checkpoints,
      resume: { decision: "approve", expectedVersion: result.version },
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual([...reviewed].sort(), ["a", "b"]);
  });

  it("denies and cancels suspended runs as terminal attributable outcomes", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let invoked = 0;
    const node = functionNode({
      execute: async (ctx) => {
        if (!ctx.resume) return suspend({ reason: "review" });
        invoked += 1;
        return "done";
      },
    });
    const workflow = defineWorkflow({ revision: "1", id: "human-deny", nodes: { node } });
    const deniedStart = await runWorkflow(workflow, null, { checkpoints, runId: "deny-1" });
    const denied = await resumeWorkflow(workflow, { runId: deniedStart.runId }, {
      checkpoints,
      resume: { decision: "deny", input: { reason: "unsafe" }, expectedVersion: deniedStart.version },
    });
    assert.equal(denied.status, "denied");
    assert.equal(denied.resume?.decision, "deny");
    assert.equal(invoked, 0);
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: deniedStart.runId }, {
        checkpoints,
        resume: { decision: "approve", expectedVersion: denied.version },
      }),
      /already denied/i,
    );

    const cancelStart = await runWorkflow(workflow, null, { checkpoints, runId: "cancel-suspended" });
    const cancelled = await cancelWorkflowRun({
      workflowId: workflow.id,
      runId: cancelStart.runId,
      workflow,
      checkpoints,
    });
    assert.equal(cancelled.status, "aborted");
  });

  it("resumes and cancels suspended checkpoints left by a fenced coordinator", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
      id: "fenced-human",
      nodes: { node: functionNode({ execute: async (ctx) => ctx.resume ? "ok" : suspend({ reason: "review" }) }) },
    });
    const resumable = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "fenced-resume",
      fencingToken: 3,
    });
    const resumed = await resumeWorkflow(workflow, { runId: resumable.runId }, {
      checkpoints,
      resume: { decision: "approve", expectedVersion: resumable.version },
    });
    assert.equal(resumed.status, "succeeded");

    const cancellable = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "fenced-cancel",
      fencingToken: 4,
    });
    const cancelled = await cancelWorkflowRun({
      workflowId: workflow.id,
      runId: cancellable.runId,
      workflow,
      checkpoints,
    });
    assert.equal(cancelled.status, "aborted");
  });

  it("validates suspended resume input and rejects wrong ownership or stale versions", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const workflow = defineWorkflow({
      revision: "1",
      id: "validate-resume",
      nodes: { node: functionNode({ execute: async (ctx) => ctx.resume ? "ok" : suspend({ reason: "review", resumeSchema: { type: "object" } }) }) },
    });
    const result = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "validate-1",
      ownership: { tenantId: "t1" },
    });
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: result.runId }, {
        checkpoints,
        ownership: { tenantId: "t1" },
        resume: { decision: "approve", expectedVersion: result.version },
      }),
      /validateResume/,
    );
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: result.runId }, {
        checkpoints,
        ownership: { tenantId: "t2" },
        resume: { decision: "approve", expectedVersion: result.version },
        validateResume: () => undefined,
      }),
      /ownership|tenant/i,
    );
    await assert.rejects(
      () => resumeWorkflow(workflow, { runId: result.runId }, {
        checkpoints,
        ownership: { tenantId: "t1" },
        resume: { decision: "approve", expectedVersion: result.version - 1 },
        validateResume: () => undefined,
      }),
      (error: unknown) => error instanceof WorkflowCheckpointError && /Stale resume version/.test(error.message),
    );
  });

  it("redacts suspension and resume payloads in durable checkpoints", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ secrets: ["sekrit"] });
    const workflow = defineWorkflow({
      revision: "1",
      id: "redact-suspend",
      nodes: { node: functionNode({ execute: async (ctx) => ctx.resume ? "ok" : suspend({ reason: "review", data: { token: "sekrit" } }) }) },
    });
    const suspended = await runWorkflow(workflow, null, {
      checkpoints,
      runId: "redact-suspend-1",
      redactor: createSecretRedactor(["sekrit"]),
    });
    const resumed = await resumeWorkflow(workflow, { runId: suspended.runId }, {
      checkpoints,
      redactor: createSecretRedactor(["sekrit"]),
      resume: { decision: "approve", input: { token: "sekrit" }, expectedVersion: suspended.version },
    });
    const saved = await getWorkflowRun(checkpoints, { workflowId: workflow.id, runId: resumed.runId });
    assert.doesNotMatch(JSON.stringify(suspended), /sekrit/);
    assert.doesNotMatch(JSON.stringify(resumed), /sekrit/);
    assert.doesNotMatch(JSON.stringify(saved), /sekrit/);
  });

  it("redacts node outputs before checkpoint persistence", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints({ secrets: ["sekrit"] });
    const node = functionNode({ execute: async () => "carry-sekrit-please" });
    const workflow = defineWorkflow({ revision: "1", id: "redact", nodes: { node } });
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
    const workflow = defineWorkflow({ revision: "1", id: "tenant", nodes: { node } });
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
