import {
  createMemoryAgentEventSource,
  createMemoryToolEffectStore,
  createToolRegistry,
  dispatchToolCall,
  type AgentIdentity,
  type OwnershipScope,
  type ToolDefinition,
  type ToolResult,
} from "@arnilo/prism";

/**
 * Network-free Phase 7 demo:
 * - durable event page resume across two consumers sharing one AgentEventSource
 * - required tool effect executes once and replays the completed result
 * - post-dispatch failure becomes unknown and needs explicit resolveUnknown
 *
 * Run: npm run build:core && node examples/distributed-events-and-tool-effects.ts
 */
export async function demo(): Promise<Record<string, unknown>> {
  const ownership: OwnershipScope = { tenantId: "tenant-a", accountId: "account-1", userId: "user-1" };
  const identity: AgentIdentity = {
    tenantId: "tenant-a",
    accountId: "account-1",
    userId: "user-1",
    principal: { kind: "agent", id: "agent-1" },
    scopes: ["tool:write"],
    verified: true,
    issuedAt: "2026-08-04T00:00:00.000Z",
  };
  const sessionId = "session-1";
  const runId = "run-1";

  const events = createMemoryAgentEventSource();
  await events.append({
    id: "evt-1",
    sessionId,
    runId,
    type: "agent_started",
    timestamp: "2026-08-04T00:00:00.000Z",
    event: { type: "agent_started", sessionId, runId },
    redacted: true,
    ...ownership,
  });
  await events.append({
    id: "evt-2",
    sessionId,
    runId,
    type: "message_delta",
    timestamp: "2026-08-04T00:00:01.000Z",
    event: { type: "message_delta", sessionId, runId, content: { type: "text", text: "hello" } },
    redacted: true,
    ...ownership,
  });

  const firstPage = await events.page({ ownership, sessionId, runId, limit: 1 });
  const resumed = await events.page({
    ownership,
    sessionId,
    runId,
    after: firstPage.items[0]!.cursor,
    limit: 10,
  });

  let executions = 0;
  const tool: ToolDefinition = {
    name: "mail.send",
    description: "Send mail",
    parameters: { type: "object", properties: {} },
    effect: { kind: "external_mutation", idempotency: "required" },
    async execute(_args, context) {
      executions += 1;
      return { toolCallId: context.toolCallId, name: "mail.send", isError: false, value: { messageId: "msg-1" } };
    },
  };
  const effectStore = createMemoryToolEffectStore();
  const call = { type: "tool_call" as const, id: "call-1", name: "mail.send", arguments: {} };
  const base = {
    call,
    registry: createToolRegistry([tool]),
    context: { sessionId, runId, toolCallId: "call-1" },
    identity,
    ownership,
    effectStore,
  };

  const first = await dispatchToolCall(base);
  const duplicate = await dispatchToolCall(base);

  // Ambiguous path: execute throws after dispatch mark → unknown, never silent replay.
  const failing: ToolDefinition = {
    ...tool,
    name: "mail.send",
    async execute() {
      executions += 1;
      throw Object.assign(new Error("transport lost"), { code: "TRANSPORT_LOST" });
    },
  };
  const unknownCall = {
    call: { type: "tool_call" as const, id: "call-2", name: "mail.send", arguments: {} },
    registry: createToolRegistry([failing]),
    context: { sessionId, runId, toolCallId: "call-2" },
    identity,
    ownership,
    effectStore,
  };
  const unknownResult = await dispatchToolCall(unknownCall);
  const unknownReplay = await dispatchToolCall(unknownCall);

  // Operator reconciliation: locate the unknown record through a fresh begin on a third call id is not needed —
  // resolve via store using the key embedded in the first unknown error path is host-owned. For the demo,
  // force an explicit unknown+resolve cycle on a third key through the store API surface hosts already use.
  const key = {
    ownership,
    identity,
    key: "prism:tool-effect:v1:00000000000000000000000000000000000000000000000000000000000000aa",
    sessionId,
    runId,
    toolCallId: "call-3",
    toolName: "mail.send",
    argumentsHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const pending = await effectStore.begin(key);
  const dispatched = await effectStore.markDispatched({
    ...key,
    claimToken: pending.record.claimToken!,
    expectedVersion: pending.record.version,
  });
  const unknown = await effectStore.markUnknown({
    ...key,
    claimToken: dispatched.claimToken!,
    expectedVersion: dispatched.version,
    failure: { code: "TRANSPORT_LOST" },
  });
  const resolved = await effectStore.resolveUnknown({
    ...key,
    expectedVersion: unknown.version,
    status: "failed_terminal",
    failure: { code: "OPERATOR_CONFIRMED" },
  });

  return {
    resumedEventIds: resumed.items.map((item) => item.record.id),
    executions,
    firstMessageId: messageId(first),
    duplicateMessageId: messageId(duplicate),
    unknownIsError: unknownResult.isError === true,
    unknownReplayIsError: unknownReplay.isError === true,
    unknownStatus: unknown.status,
    resolvedStatus: resolved.status,
    notExactlyOnce: true,
  };
}

function messageId(result: ToolResult): string | null {
  return result.value && typeof result.value === "object" && result.value !== null && "messageId" in result.value
    ? String((result.value as { messageId: string }).messageId)
    : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
