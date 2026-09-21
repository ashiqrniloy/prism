/**
 * Plan 104 Task 4: what a blocked call tells the model.
 *
 * A compiled pack rule is named by its bounded identity (`pack:<pack>/<rule>`) plus its reason, so
 * the model stops retrying the call; a hand-written guardrail keeps the neutral stage line instead
 * of a synthesized identity. The text is the same object on the result and on the
 * `tool_execution_blocked` event, stays under the 200-byte cap, and never carries arguments.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  type ToolDefinition,
} from "../index.js";

type ToolBlockedEvent = Extract<AgentEvent, { type: "tool_execution_blocked" }>;

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
function writeAgent(
  path: string,
  content: string,
  tools: readonly ToolDefinition[],
  options: {
    readonly reason?: string;
    readonly action?: "deny" | "tripwire";
    readonly redactor?: ReturnType<typeof createSecretRedactor>;
  } = {},
) {
  const requests: unknown[] = [];
  const events: AgentEvent[] = [];
  const agent = createAgent({
    id: "refusal-text",
    store: createMemorySessionStore(),
    model: { provider: "mock", model: "demo" },
    ...(options.redactor ? { redactor: options.redactor } : {}),
    provider: {
      id: "mock",
      async *generate() {
        requests.push(1);
        const turn: readonly ProviderEvent[] =
          requests.length === 1
            ? [providerToolCall(toolCallContent("call-1", "write", { path, content })), providerDone()]
            : [providerTextDelta("nothing to do"), providerDone()];
        for (const event of turn) yield event;
      },
    },
    tools: [...tools],
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
    const { agent, events } = writeAgent("/repo/src/app.test.ts", "secret-content", [writeTool(executions)]);
    const session = agent.createSession({ id: "refusal-pack", guardrailPacks: [PACK], store });
    const subscription = session.subscribe();
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const result = await session.run("rewrite the test file");
    await pump;

    assert.equal(result.status, "succeeded", "a blocked call does not fail the run");
    assert.deepEqual(executions, [], "the blocked call never reaches the tool");
    const expected = `Blocked by guardrail rule ${RULE}: Test files are host-owned`;

    const refusal = await toolResultOf(store, "refusal-pack");
    assert.equal(refusal?.name, "write");
    assert.equal(refusal?.error?.message, expected);
    const blocked = events.find((event): event is ToolBlockedEvent => event.type === "tool_execution_blocked");
    assert.equal(blocked?.reason, "guardrail_blocked", "the machine code is unchanged");
    assert.equal(blocked?.error?.message, expected, "the event carries the same text as the result");
    assert.ok(new TextEncoder().encode(expected).length <= MAX_MESSAGE_BYTES);
    assert.equal(JSON.stringify([refusal, blocked]).includes("secret-content"), false, "arguments never enter the refusal");
  });

  it("drops the synthesized reason but keeps the identity when a rule sets none", async () => {
    const store = createMemorySessionStore();
    const { agent } = writeAgent("/repo/src/app.test.ts", "x", [writeTool([])]);
    const session = agent.createSession({
      id: "refusal-no-reason",
      guardrailPacks: [
        { id: "coding-standard", rules: [{ id: "no-test-rewrites", tool: "write", argPath: "path", pattern: "\\.test\\.ts$" }] },
      ],
      store,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "succeeded");
    const refusal = await toolResultOf(store, "refusal-no-reason");
    assert.equal(refusal?.error?.message, `Blocked by guardrail rule ${RULE}`, "no doubled default reason");
  });

  it("bounds a long pack reason to the cap", async () => {
    const store = createMemorySessionStore();
    const { agent } = writeAgent("/repo/src/app.test.ts", "x", [writeTool([])]);
    const session = agent.createSession({
      id: "refusal-long",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, reason: "r".repeat(400) }] }],
      store,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "succeeded");
    const message = (await toolResultOf(store, "refusal-long"))?.error?.message ?? "";
    assert.equal(new TextEncoder().encode(message).length, MAX_MESSAGE_BYTES, "truncated at the cap, never unbounded");
    assert.ok(message.startsWith(`Blocked by guardrail rule ${RULE}`), "the identity survives truncation");
  });

  it("redacts a secret-shaped pack reason before it reaches the model", async () => {
    const store = createMemorySessionStore();
    const { agent } = writeAgent("/repo/src/app.test.ts", "x", [writeTool([])], {
      redactor: createSecretRedactor(["token-123"]),
    });
    const session = agent.createSession({
      id: "refusal-redacted",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, reason: "test token-123 rewrite" }] }],
      store,
    });
    const result = await session.run("rewrite the test file");
    assert.equal(result.status, "succeeded");
    const message = (await toolResultOf(store, "refusal-redacted"))?.error?.message ?? "";
    assert.ok(message.includes("[REDACTED]"), message);
    assert.equal(message.includes("token-123"), false, "the secret never reaches the model");
  });

  it("keeps the neutral line for a hand-written guardrail at both stages", async () => {
    const tool: ToolDefinition = {
      name: "echo",
      description: "Echoes.",
      parameters: { type: "object", properties: {} },
      execute: () => ({ toolCallId: "c1", name: "echo", value: "raw secret" }),
    };
    const call = { type: "tool_call" as const, id: "c1", name: "echo", arguments: { text: "hi" } };
    const events: AgentEvent[] = [];
    const atInput = await dispatchToolCall({
      call,
      registry: createToolRegistry([tool]),
      context: { sessionId: "s1", runId: "r1", metadata: {}, toolCallId: "c1" },
      guardrails: { toolInput: [{ name: "host-policy", stage: "tool_input", evaluate: () => ({ action: "block", reason: "nope" }) }] },
      emit: (event) => {
        events.push(event);
      },
    });
    assert.equal(atInput.error?.message, "Tool call blocked by guardrail");
    const atOutput = await dispatchToolCall({
      call,
      registry: createToolRegistry([tool]),
      context: { sessionId: "s1", runId: "r1", metadata: {}, toolCallId: "c1" },
      guardrails: {
        toolOutput: [{ name: "host-output-policy", stage: "tool_output", evaluate: () => ({ action: "block", reason: "nope" }) }],
      },
      emit: (event) => {
        events.push(event);
      },
    });
    assert.equal(atOutput.error?.message, "Tool result blocked by guardrail");
    const blocked = events.filter((event): event is ToolBlockedEvent => event.type === "tool_execution_blocked");
    assert.equal(blocked.length, 2);
    assert.deepEqual(
      blocked.map((event) => event.error?.message),
      ["Tool call blocked by guardrail", "Tool result blocked by guardrail"],
    );
    assert.equal(JSON.stringify(blocked).includes("pack:"), false, "no identity is invented for a host guardrail");
  });

  it("still fails the run on a pack tripwire, with the tool unexecuted", async () => {
    const executions: string[] = [];
    const { agent } = writeAgent("/repo/src/app.test.ts", "x", [writeTool(executions)]);
    const session = agent.createSession({
      id: "refusal-tripwire",
      guardrailPacks: [{ id: "coding-standard", rules: [{ ...RULE_DEFINITION, action: "tripwire" }] }],
    });
    const error = await session.run("rewrite the test file").then(
      () => undefined,
      (rejection: unknown) => rejection,
    );
    const cause = (error as { cause?: unknown } | undefined)?.cause;
    assert.ok(cause instanceof GuardrailError, "a tripwire rejects the run instead of returning a blocked result");
    assert.equal(cause.code, "ERR_PRISM_GUARDRAIL_BLOCKED");
    assert.equal(cause.record.action, "tripwire");
    assert.equal(cause.record.guardrail, RULE);
    assert.equal(cause.record.reason, "Test files are host-owned", "the record, not the message, carries the reason");
    const failed = (error as { result?: { status?: string; error?: { code?: string } } }).result;
    assert.equal(failed?.status, "failed", "the run fails, it does not return a blocked result");
    assert.equal(failed?.error?.code, "ERR_PRISM_GUARDRAIL_BLOCKED", "the run error keeps the code, not the free text");
    assert.deepEqual(executions, [], "the tool never executed");
  });
});
