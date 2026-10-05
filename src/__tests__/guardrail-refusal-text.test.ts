/**
 * Plan 104 Task 4: what a blocked call tells the model.
 *
 * A compiled pack rule is named by its bounded identity (`pack:<pack>/<rule>`) plus its reason, so
 * the model stops retrying the call; a hand-written guardrail keeps the neutral stage line instead
 * of a synthesized identity. The text is the same object on the result and on the
 * `tool_execution_blocked` event, stays under the 200-byte cap, and never carries arguments.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type ContentBlock,
  type ProviderEvent,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  GuardrailError,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
  type SessionStore,
  type ToolDefinition,
  type GuardrailRecord,
} from "../index.js";
import { kernelEvents } from "./kernel-event-helpers.js";
import { providerPackage } from "../provider-kit/index.js";

type ToolBlockedEvent = Extract<AgentEvent, { readonly type: "tool.completed" }>;

const MAX_MESSAGE_BYTES = 200;
const RULE_DEFINITION = {
  id: "no-test-rewrites",
  tool: "write",
  argPath: "path",
  pattern: "\\.test\\.ts$",
  reason: "Test files are host-owned",
};
const PACK = { id: "coding-standard", rules: [RULE_DEFINITION] };
const RULE = "pack:coding-standard/no-test-rewrites";

/** Scripted provider whose first turn calls `write` once; later turns just answer. */
async function writeAgent(
  path: string,
  content: string,
  tools: readonly ToolDefinition[],
  options: {
    readonly reason?: string;
    readonly action?: "deny" | "tripwire";
    readonly redactor?: ReturnType<typeof createSecretRedactor>;
    readonly store?: SessionStore;
  } = {},
) {
  const requests: unknown[] = [];
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    id: "refusal-text",
    slots: { store: options.store ?? createMemorySessionStore() },
    model: { provider: "mock", model: "demo" },
    ...(options.redactor ? { redactor: options.redactor } : {}),
    packages: [providerPackage("test-provider", [{
      id: "mock",
      async *generate() {
        requests.push(1);
        const turn: readonly ProviderEvent[] =
          requests.length === 1
            ? [providerToolCall(toolCallContent("call-1", "write", { path, content })), providerDone()]
            : [providerTextDelta("nothing to do"), providerDone()];
        for (const event of turn) yield event;
      },
    }])],
    tools: { add: [...tools] },
  });
  return { agent, events, requests };
}

function writeTool(executions: string[]): ToolDefinition {
  return {
    name: "write",
    description: "Write a file.",
    parameters: { type: "object", properties: {} },
    async execute(_args, context) {
      executions.push(context.toolCallId);
      return { toolCallId: context.toolCallId, name: "write", value: "written" };
    },
  };
}

/** The tool result the loop appended for a call (blocked results are not events). */
async function toolResultOf(store: ReturnType<typeof createMemorySessionStore>, sessionId: string) {
  for (const entry of [...(await store.list(sessionId))].reverse()) {
    const block = entry.message?.content.find(
      (part: ContentBlock): part is Extract<ContentBlock, { type: "tool_result" }> => part.type === "tool_result",
    );
    if (block) return block;
  }
  return undefined;
}

describe("guardrail refusal text (plan 104 Task 4)", () => {
  it("names the pack rule in the result and in the blocked event, without the arguments", async () => {
    const executions: string[] = [];
    const store = createMemorySessionStore();
    const { agent, events } = await writeAgent("/repo/src/app.test.ts", "secret-content", [writeTool(executions)], { store });
    const session = await agent.session({ guardrailPacks: [PACK], id: "refusal-pack", create: true });
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const result = await session.run("rewrite the test file");
    await pump;

    assert.equal(result.status, "completed", "a blocked call does not fail the run");
    assert.deepEqual(executions, [], "the blocked call never reaches the tool");
    const expected = `Blocked by guardrail rule ${RULE}: Test files are host-owned`;

    const refusal = await toolResultOf(store, "refusal-pack");
    assert.equal(refusal?.name, "write");
    assert.equal(refusal?.error?.message, expected);
    const decision = kernelEvents<{ record: GuardrailRecord }>(events, "guardrail.decision")[0];
    assert.equal(decision?.record.guardrail, RULE, "the audit event names the rule");
    assert.equal(decision?.record.action, "block");
    assert.ok(new TextEncoder().encode(expected).length <= MAX_MESSAGE_BYTES);
    assert.equal(JSON.stringify([refusal, decision]).includes("secret-content"), false, "arguments never enter the refusal");
  });

  it("drops the synthesized reason but keeps the identity when a rule sets none", async () => {
    const store = createMemorySessionStore();
    const { agent } = await writeAgent("/repo/src/app.test.ts", "x", [writeTool([])], { store });
    const session = await agent.session({
      id: "refusal-no-reason",
      guardrailPacks: [
        { id: "coding-standard", rules: [{ id: "no-test-rewrites", tool: "write", argPath: "path", pattern: "\\.test\\.ts$" }] },
      ],
      create: true,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "completed");
    const refusal = await toolResultOf(store, "refusal-no-reason");
    assert.equal(refusal?.error?.message, `Blocked by guardrail rule ${RULE}`, "no doubled default reason");
  });

  it("bounds a long pack reason to the cap", async () => {
    const store = createMemorySessionStore();
    const { agent } = await writeAgent("/repo/src/app.test.ts", "x", [writeTool([])], { store });
    const session = await agent.session({
      id: "refusal-long",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, reason: "r".repeat(400) }] }],
      create: true,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "completed");
    const message = (await (await toolResultOf(store, "refusal-long"))?.error?.message) ?? "";
    assert.equal(new TextEncoder().encode(message).length, MAX_MESSAGE_BYTES, "truncated at the cap, never unbounded");
    assert.ok(message.startsWith(`Blocked by guardrail rule ${RULE}`), "the identity survives truncation");
  });

  it("redacts a secret-shaped pack reason before it reaches the model", async () => {
    const store = createMemorySessionStore();
    const { agent } = await writeAgent("/repo/src/app.test.ts", "x", [writeTool([])], {
      redactor: createSecretRedactor(["token-123"]),
      store,
    });
    const session = await agent.session({
      id: "refusal-redacted",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, reason: "test token-123 rewrite" }] }],
      create: true,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "completed");
    const message = (await (await toolResultOf(store, "refusal-redacted"))?.error?.message) ?? "";
    assert.ok(message.includes("[REDACTED]"), message);
    assert.equal(message.includes("token-123"), false, "the secret never reaches the model");
  });

  it("denies a pack tripwire with the tool unexecuted", async () => {
    const executions: string[] = [];
    const store = createMemorySessionStore();
    const { agent } = await writeAgent("/repo/src/app.test.ts", "x", [writeTool(executions)], { store });
    const session = await agent.session({
      id: "refusal-tripwire",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, action: "tripwire" }] }],
      create: true,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "completed", "a tool tripwire is a denied call, not a run failure");
    const refusal = await toolResultOf(store, "refusal-tripwire");
    assert.equal(refusal?.error?.message, `Blocked by guardrail rule ${RULE}: Test files are host-owned`);
    assert.deepEqual(executions, [], "the tool never executed");
  });
});
