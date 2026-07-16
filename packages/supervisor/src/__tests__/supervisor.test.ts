import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type AIProvider,
  type Agent,
  type ToolDefinition,
} from "@arnilo/prism";
import { createSupervisor, SupervisorDeniedError, SupervisorLimitError } from "../index.js";

const ownership = { tenantId: "tenant", userId: "user" };
const doneAgent = (text = "child", tokens = 2): Agent => createAgent({
  model: { provider: "mock", model: "test" },
  provider: createMockProvider([providerTextDelta(text), providerUsage({ totalTokens: tokens }), providerDone()]),
});

describe("createSupervisor", () => {
  it("delegates to an allow-listed child with isolated scope and completion events", async () => {
    const scopes: string[] = [];
    const completions: string[] = [];
    const supervisor = createSupervisor({
      id: "lead",
      ownership,
      children: { research: { createAgent: (context) => { scopes.push(context.resourceId, context.threadId); return doneAgent(); } } },
      hooks: { after: (value) => { completions.push(value.status); } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    const result = await supervisor.delegate({ childId: "research", input: "question", threadId: "thread" });
    assert.equal(result.text, "child");
    assert.match(scopes[0]!, /^lead\/lead-1\/research$/);
    assert.match(scopes[1]!, /\/thread$/);
    assert.deepEqual(completions, ["succeeded"]);
    assert.equal((await iterator.next()).value.type, "delegation_started");
    assert.equal((await iterator.next()).value.type, "delegation_finished");
    await assert.rejects(supervisor.delegate({ childId: "missing", input: "x" }), SupervisorDeniedError);
  });

  it("lets hooks reject or narrow/modify without widening parent permission", async () => {
    let executed = 0;
    let seenInput = "";
    const tool: ToolDefinition = { name: "write", execute: (_args, context) => { executed += 1; return { toolCallId: context.toolCallId, name: "write", content: [{ type: "text", text: "ok" }] }; } };
    const provider: AIProvider = { id: "mock", async *generate(request) {
      seenInput = JSON.stringify(request.messages);
      yield providerToolCall({ type: "tool_call", id: "c1", name: "write", arguments: {} });
      yield providerDone();
    } };
    const denied = createSupervisor({ ownership, children: { child: { createAgent: () => doneAgent() } }, hooks: { before: () => ({ allowed: false, reason: "review denied" }) } });
    await assert.rejects(denied.delegate({ childId: "child", input: "x" }), /review denied/);

    const narrowed = createSupervisor({
      ownership,
      permission: { check: () => ({ allowed: false, reason: "parent denied" }) },
      children: { child: { createAgent: () => createAgent({ model: { provider: "mock", model: "test" }, provider, tools: [tool] }) } },
      hooks: { before: () => ({ input: "modified", permission: { check: () => ({ allowed: true }) } }) },
    });
    await narrowed.delegate({ childId: "child", input: "original" });
    assert.match(seenInput, /modified/);
    assert.equal(executed, 0);
  });

  it("enforces nested cycle, depth, and active-child limits before execution", async () => {
    let supervisor: ReturnType<typeof createSupervisor>;
    supervisor = createSupervisor({
      ownership,
      limits: { maxDepth: 2, maxActiveChildren: 1 },
      children: {
        cycle: { createAgent: async (context) => { await context.delegate({ childId: "cycle", input: "again" }); return doneAgent(); } },
        slow: { createAgent: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return doneAgent(); } },
      },
    });
    await assert.rejects(supervisor.delegate({ childId: "cycle", input: "x" }), /cycle/i);
    const first = supervisor.delegate({ childId: "slow", input: "x" });
    await new Promise((resolve) => setTimeout(resolve, 1));
    await assert.rejects(supervisor.delegate({ childId: "slow", input: "x" }), /Active child/);
    await first;
  });

  it("enforces input, timeout, token, and tool-call budgets", async () => {
    const oversized = createSupervisor({ ownership, limits: { maxMessageBytes: 4 }, children: { child: { createAgent: () => doneAgent() } } });
    await assert.rejects(oversized.delegate({ childId: "child", input: "12345" }), SupervisorLimitError);

    const timeout = createSupervisor({ ownership, limits: { timeoutMs: 2 }, children: { child: { createAgent: async () => { await new Promise(() => undefined); return doneAgent(); } } } });
    await assert.rejects(timeout.delegate({ childId: "child", input: "x" }), /timeout/);

    const tokens = createSupervisor({ ownership, limits: { maxTokens: 1 }, children: { child: { createAgent: () => doneAgent("x", 2) } } });
    await assert.rejects(tokens.delegate({ childId: "child", input: "x" }), /token limit/);

    let calls = 0;
    const tools: ToolDefinition[] = ["one", "two"].map((name) => ({ name, execute: (_args, context) => { calls += 1; return { toolCallId: context.toolCallId, name, content: [] }; } }));
    const toolAgent = createAgent({ model: { provider: "mock", model: "test" }, provider: createMockProvider([
      providerToolCall({ type: "tool_call", id: "1", name: "one", arguments: {} }),
      providerToolCall({ type: "tool_call", id: "2", name: "two", arguments: {} }),
      providerDone(),
    ]), tools });
    const bounded = createSupervisor({ ownership, limits: { maxToolCalls: 1 }, children: { child: { createAgent: () => toolAgent } } });
    await bounded.delegate({ childId: "child", input: "x" });
    assert.equal(calls, 1);
  });

  it("propagates abort and redacts hook/event failures", async () => {
    const controller = new AbortController();
    let completion = "";
    const supervisor = createSupervisor({
      ownership,
      redactor: createSecretRedactor(["canary"]),
      children: { child: { createAgent: async ({ signal }) => { await new Promise<void>((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); return doneAgent(); } } },
      hooks: { after: (value) => { completion = JSON.stringify(value); } },
    });
    const pending = supervisor.delegate({ childId: "child", input: "canary", signal: controller.signal });
    controller.abort(new Error("canary abort"));
    await assert.rejects(pending);
    assert.doesNotMatch(completion, /canary/);
  });
});
