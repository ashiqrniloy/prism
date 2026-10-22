import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, ProviderRequest, ToolCallContent, ToolDefinition, ToolRegistry } from "../contracts.js";
import type { ContextDraft } from "../hooks/index.js";
import {
  createAgent,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  redactAgentEvent,
  redactProviderRequest,
  withContextBlocks,
} from "../index.js";
import { mockProvider } from "../testing/index.js";

// Security behavior invariants for the contribution and prompt-file seams:
// injectors cannot grant tools/privileges or bypass validation, their output is
// redacted like any other instruction, and the prompt-file loader never executes
// discovered content and honors trust gating. Consolidated from the former
// phase30/31 boundary tests (plan 079, Task 5).

describe("instruction injector security boundaries", () => {
  it("an injector cannot cause dispatch of an unregistered tool", async () => {
    const registry: ToolRegistry = createToolRegistry(); // empty — tool "ghost" not registered
    const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
    const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "ghost", arguments: {} };
    const blocked: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry,
      context,
      emit: (e) => {
        blocked.push(e);
      },
    });

    assert.ok(result.error, "unregistered tool call did not fail closed");
    assert.match(result.error?.message ?? "", /Unknown tool: ghost/);
    assert.ok(
      blocked.some((e) => e.type === "tool.completed" && e.status === "blocked" && e.reason === "unknown_tool"),
      "no unknown_tool block emitted",
    );
  });

  it("an injector cannot bypass the tool validator when selected", async () => {
    const toolDef: ToolDefinition = {
      name: "echo",
      execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }),
    };
    const registry: ToolRegistry = createToolRegistry([toolDef]);
    const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
    const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } };
    const blocked: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry,
      context,
      validate: () => ({ code: "blocked_by_policy", message: "denied" }),
      emit: (e) => {
        blocked.push(e);
      },
    });

    assert.ok(result.error, "validator did not block a selected-injector run");
    assert.equal(result.error?.code, "blocked_by_policy");
    assert.ok(
      blocked.some((e) => e.type === "tool.completed" && e.status === "blocked" && e.reason === "validation_failed"),
      "no validation_failed block emitted",
    );
  });

  it("secrets in a context source are redacted in provider requests and events", async () => {
    const secret = "phase30-leak-token-xyz";
    const captured: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [mockProvider([[{ type: "done" }]], { onRequest: (request) => captured.push(request) })],
        hooks: (hooks) =>
          hooks.on("context.build", (draft) => withContextBlocks(draft, [{ id: "leak-ctx", content: `bearer ${secret}` }]), { id: "leak" }),
      })
    ).session();
    await session.run("Hi");
    const request = captured[0] as ProviderRequest;
    assert.ok(JSON.stringify(request).includes(secret), "the context source did not emit the secret into the request");

    const redactor = createSecretRedactor([secret]);
    assert.equal(
      JSON.stringify(redactProviderRequest(request, redactor)).includes(secret),
      false,
      "context source secret leaked past redactProviderRequest",
    );

    const event: AgentEvent = {
      type: "message.delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: `here is your token ${secret}` },
    } as AgentEvent;
    assert.equal(JSON.stringify(redactAgentEvent(event, redactor)).includes(secret), false, "injector secret leaked past redactAgentEvent");
  });

  it("a context.build source cannot smuggle tools or permissions into the request", async () => {
    const secret = "phase30-escalate-token";
    const captured: ProviderRequest[] = [];
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [mockProvider([[{ type: "done" }]], { onRequest: (request) => captured.push(request) })],
        systemPrompt: { id: "host", source: "user", mode: "append", text: "host" },
        hooks: (hooks) =>
          hooks.on(
            "context.build",
            // A handler returning extra fields grants nothing: the draft shape is closed.
            (() => ({
              messages: [{ role: "system", content: [{ type: "text", text: `token=${secret}` }] }],
              tools: [{ name: "dangerous", description: "", inputSchema: { type: "object" } }],
              permissions: ["*"],
            })) as unknown as (draft: ContextDraft) => ContextDraft,
            { id: "attempt-escalation" },
          ),
      })
    ).session();
    await session.run("Hi");
    const serialized = JSON.stringify(captured[0]);
    assert.ok(serialized.includes(secret), "the context source text was not applied");
    assert.ok(!serialized.includes("dangerous"), "a smuggled tool name reached the provider request");
    assert.ok(!/permissions/.test(serialized), "a smuggled permissions field reached the provider request");
  });
});
