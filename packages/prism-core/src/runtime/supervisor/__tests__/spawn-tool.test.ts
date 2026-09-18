import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Agent,
  createAgent,
  createMockProvider,
  createSecretRedactor,
  type JsonObject,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type ToolDefinition,
} from "@arnilo/prism";
import { createCancelAgentTool, createSpawnAgentTool, createSupervisor, createWaitAgentTool } from "../index.js";

const ownership = { tenantId: "tenant", userId: "user" };
const invocation = { sessionId: "parent-session", runId: "parent-run", toolCallId: "spawn-1" };
const doneAgent = (text = "child", tokens = 2): Agent =>
  createAgent({
    model: { provider: "mock", model: "test" },
    provider: createMockProvider([providerTextDelta(text), providerUsage({ totalTokens: tokens }), providerDone()]),
  });

async function execute(tool: ToolDefinition, args: JsonObject) {
  return tool.execute(args, invocation);
}

describe("createSpawnAgentTool", () => {
  it("fails closed for unknown children without creating one", async () => {
    let created = 0;
    const supervisor = createSupervisor({
      ownership,
      children: {
        research: {
          createAgent: () => {
            created += 1;
            return doneAgent();
          },
        },
      },
    });
    const result = await execute(createSpawnAgentTool({ supervisor }), { childId: "missing", input: "x" });
    assert.equal(result.error?.message, "Unknown child id");
    assert.equal(created, 0);
    assert.equal(supervisor.activeChildren, 0);
  });

  it("returns redacted child text, usage, and delegation events", async () => {
    const supervisor = createSupervisor({
      ownership,
      redactor: createSecretRedactor(["canary"]),
      children: { research: { createAgent: () => doneAgent("canary", 3) } },
    });
    const events = supervisor.subscribe()[Symbol.asyncIterator]();
    const result = await execute(createSpawnAgentTool({ supervisor }), { childId: "research", input: "canary" });
    const value = result.value as { readonly status: string; readonly text: string; readonly usage?: { readonly totalTokens?: number } };
    assert.equal(result.error, undefined);
    assert.equal(value.status, "succeeded");
    assert.equal(value.usage?.totalTokens, 3);
    assert.doesNotMatch(value.text, /canary/);
    assert.equal((await events.next()).value.type, "delegation_started");
    assert.equal((await events.next()).value.type, "delegation_finished");
  });

  it("starts async children, waits for them, and cancels only local handles", async () => {
    const supervisor = createSupervisor({ ownership, children: { research: { createAgent: () => doneAgent("async") } } });
    const spawn = createSpawnAgentTool({ supervisor });
    const wait = createWaitAgentTool({ supervisor });
    const launched = await execute(spawn, { childId: "research", input: "x", mode: "async" });
    const handle = launched.value as { readonly delegationId: string; readonly status: string };
    assert.equal(handle.status, "running");
    const joined = await execute(wait, { delegationId: handle.delegationId });
    const joinedValue = joined.value as { readonly status: string; readonly text: string };
    assert.equal(joinedValue.status, "succeeded");
    assert.equal(joinedValue.text, "async");
    const repeated = await execute(wait, { delegationId: handle.delegationId });
    assert.equal((repeated.value as { readonly status: string }).status, "succeeded");

    let aborted = false;
    const cancellable = createSupervisor({
      ownership,
      limits: { maxActiveChildren: 1 },
      children: {
        research: {
          createAgent: ({ signal }) =>
            new Promise<Agent>((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(signal.reason);
                },
                { once: true },
              ),
            ),
        },
      },
    });
    const cancelSpawn = createSpawnAgentTool({ supervisor: cancellable });
    const cancel = createCancelAgentTool({ supervisor: cancellable });
    const cancelWait = createWaitAgentTool({ supervisor: cancellable });
    const pending = await execute(cancelSpawn, { childId: "research", input: "x", mode: "async" });
    const pendingId = (pending.value as { readonly delegationId: string }).delegationId;
    assert.equal(
      (await execute(cancelSpawn, { childId: "research", input: "y", mode: "async" })).error?.message,
      "Active child limit exceeded",
    );
    assert.equal((await execute(cancel, { delegationId: pendingId })).error, undefined);
    assert.equal(aborted, true);
    const cancelled = await execute(cancelWait, { delegationId: pendingId });
    assert.equal(cancelled.error, undefined);
    assert.equal((cancelled.value as { readonly status: string }).status, "cancelled");
    const foreignWait = await execute(cancelWait, { delegationId: "foreign" });
    const foreignCancel = await execute(cancel, { delegationId: "foreign" });
    assert.equal(foreignWait.error?.message, "Unknown async delegation");
    assert.equal(foreignCancel.error?.message, "Unknown async delegation");
  });

  it("cancels async children when the parent run aborts", async () => {
    let aborted = false;
    const supervisor = createSupervisor({
      ownership,
      children: {
        research: {
          createAgent: ({ signal }) =>
            new Promise<Agent>((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(signal.reason);
                },
                { once: true },
              ),
            ),
        },
      },
    });
    const parent = new AbortController();
    const launched = await createSpawnAgentTool({ supervisor }).execute(
      { childId: "research", input: "x", mode: "async" },
      { ...invocation, signal: parent.signal },
    );
    const handle = launched.value as { readonly delegationId: string };
    parent.abort(new Error("parent stopped"));
    const waited = await execute(createWaitAgentTool({ supervisor }), { delegationId: handle.delegationId });
    assert.equal(aborted, true);
    assert.ok(waited.error);
    assert.equal(supervisor.activeChildren, 0);
  });

  it("advertises only host-controlled arguments and ignores injected ones", async () => {
    const tool = createSpawnAgentTool({
      supervisor: createSupervisor({ ownership, children: { research: { createAgent: () => doneAgent() } } }),
    });
    const schema = tool.parameters as { readonly additionalProperties?: boolean; readonly properties?: Readonly<Record<string, unknown>> };
    assert.equal(tool.exclusive, false);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties?.tools, undefined);
    assert.equal(schema.properties?.scopes, undefined);
    assert.ok(schema.properties?.mode);
    const result = await execute(tool, {
      childId: "research",
      input: "x",
      tools: ["write"],
      scopes: ["admin"],
      maxActiveChildren: 99,
    });
    assert.equal(result.error, undefined);
  });

  it("rejects catalog scope widening before the child factory runs", async () => {
    let created = 0;
    const supervisor = createSupervisor({
      ownership,
      identity: {
        tenantId: "tenant",
        userId: "user",
        principal: { kind: "user", id: "user" },
        scopes: ["read"],
        issuedAt: "2026-08-01T00:00:00.000Z",
        verified: true,
      },
      children: {
        research: {
          scopes: ["write"],
          createAgent: () => {
            created += 1;
            return doneAgent();
          },
        },
      },
    });
    const result = await execute(createSpawnAgentTool({ supervisor }), { childId: "research", input: "x" });
    assert.ok(result.error);
    assert.equal(created, 0);
    assert.equal(supervisor.activeChildren, 0);
  });

  it("returns hook denials as tool errors and releases the child slot", async () => {
    const supervisor = createSupervisor({
      ownership,
      children: { research: { createAgent: () => doneAgent() } },
      hooks: { before: () => ({ allowed: false, reason: "review denied" }) },
    });
    const events = supervisor.subscribe()[Symbol.asyncIterator]();
    const result = await execute(createSpawnAgentTool({ supervisor }), { childId: "research", input: "x" });
    assert.equal(result.error?.message, "review denied");
    assert.equal((await events.next()).value.type, "delegation_rejected");
    assert.equal(supervisor.activeChildren, 0);
  });

  it("caps concurrent spawn tool calls at the supervisor reservation", async () => {
    let created = 0;
    const supervisor = createSupervisor({
      ownership,
      limits: { maxActiveChildren: 2 },
      children: {
        research: {
          createAgent: () => {
            created += 1;
            return doneAgent();
          },
        },
      },
    });
    const rawSpawn = createSpawnAgentTool({ supervisor });
    const errors: string[] = [];
    const spawn: ToolDefinition = {
      ...rawSpawn,
      async execute(args, context) {
        const result = await rawSpawn.execute(args, context);
        if (result.error) errors.push(result.error.message);
        return result;
      },
    };
    let turn = 0;
    const parent = createAgent({
      model: { provider: "mock", model: "test" },
      loop: { strategy: "single-shot", toolConcurrency: 3 },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            for (const id of ["a", "b", "c"]) {
              yield providerToolCall({ type: "tool_call", id, name: "spawn_agent", arguments: { childId: "research", input: id } });
            }
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [spawn],
    });
    const result = await parent.createSession().run("spawn");
    assert.equal(result.status, "succeeded");
    assert.equal(created, 2);
    assert.deepEqual(errors, ["Active child limit exceeded"]);
    assert.equal(supervisor.activeChildren, 0);
  });

  it("keeps spawn calls sequential when their turn contains an exclusive tool", async () => {
    let created = 0;
    let writes = 0;
    const supervisor = createSupervisor({
      ownership,
      limits: { maxActiveChildren: 1 },
      children: {
        research: {
          createAgent: () => {
            created += 1;
            return doneAgent();
          },
        },
      },
    });
    let turn = 0;
    const parent = createAgent({
      model: { provider: "mock", model: "test" },
      loop: { strategy: "single-shot", toolConcurrency: 3 },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield providerToolCall({ type: "tool_call", id: "a", name: "spawn_agent", arguments: { childId: "research", input: "a" } });
            yield providerToolCall({ type: "tool_call", id: "write", name: "write", arguments: {} });
            yield providerToolCall({ type: "tool_call", id: "b", name: "spawn_agent", arguments: { childId: "research", input: "b" } });
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [
        createSpawnAgentTool({ supervisor }),
        {
          name: "write",
          exclusive: true,
          execute: (_args, context) => {
            writes += 1;
            return { toolCallId: context.toolCallId, name: "write", content: [] };
          },
        },
      ],
    });
    const result = await parent.createSession().run("spawn");
    assert.equal(result.status, "succeeded");
    assert.equal(created, 2);
    assert.equal(writes, 1);
    assert.equal(supervisor.activeChildren, 0);
  });

  it("keeps nested spawn under the supervisor depth cap", async () => {
    let innerCreated = 0;
    const supervisor = createSupervisor({
      ownership,
      limits: { maxDepth: 1 },
      children: {
        outer: {
          createAgent: async (context) => {
            await context.delegate({ childId: "inner", input: "x" });
            return doneAgent();
          },
        },
        inner: {
          createAgent: () => {
            innerCreated += 1;
            return doneAgent();
          },
        },
      },
    });
    const result = await execute(createSpawnAgentTool({ supervisor }), { childId: "outer", input: "x" });
    assert.match(result.error?.message ?? "", /depth exceeded/);
    assert.equal(innerCreated, 0);
    assert.equal(supervisor.activeChildren, 0);
  });
});
