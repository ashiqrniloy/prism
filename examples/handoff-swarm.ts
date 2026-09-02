import {
  type Agent,
  type AgentDefinition,
  type AgentEvent,
  createAgentSession,
  createMemorySessionStore,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveAgentDefinition,
  type SessionEntry,
  type ToolDefinition,
  type ToolResult,
  toolCallContent,
} from "@arnilo/prism";

// In-session handoff (swarm) pattern, end-to-end with the mock provider.
//
// Agent A transfers control of an ongoing conversation to agent B with full
// context, over existing Prism seams only — no handoff primitive:
//   1. A generated `handoff` tool whose args name the target agent
//      (`createHandoffTool`). The allow-list comes from the targets map, so an
//      untrusted target name fails closed as a plain tool error.
//   2. Definition swap: the host resolves the target `AgentDefinition` with
//      `resolveAgentDefinition` and opens the SPECIALIST against the SAME
//      session (same store + sessionId) — the transcript continues in one
//      chain, so carried context is the transcript itself, not a copy.
//   3. Narrowed permissions on transfer: specialists activate only their own
//      `tools`; `handoff` is not in their registry, so a re-handoff attempt is
//      blocked with the standard "unknown_tool" fail-closed reason.
//
// Deliberately NOT used here: `createDelegatedAgentStep` — that event factory
// serves adapter-driven delegation timelines; a
// host doing an in-process definition swap has no session seam to emit it.
// Supervisor delegation (bounded child sessions) is the other recipe in
// docs/multi-agent-patterns.md.
// Network-free; no credentials.

/** Host-authorized allow-list in tool form: only names in `targets` transfer;
 *  anything else fails closed as a standard tool error result. */
function createHandoffTool(targets: Readonly<Record<string, AgentDefinition>>): ToolDefinition {
  return {
    name: "handoff",
    description: "Transfer this conversation to a named specialist agent.",
    parameters: {
      type: "object",
      properties: { target: { type: "string", description: "Target agent name from the host allow-list" } },
      required: ["target"],
    },
    execute(args, ctx): ToolResult {
      const target = args.target;
      if (typeof target !== "string" || !(target in targets)) {
        return {
          toolCallId: ctx.toolCallId,
          name: "handoff",
          error: { message: `Unknown handoff target: ${String(args.target)}` },
        };
      }
      return { toolCallId: ctx.toolCallId, name: "handoff", value: { transferredTo: target } };
    },
  };
}

/** Scripted multi-round mock provider: one event list per provider turn
 *  (a turn = one tool-loop round); turns beyond the script repeat the last
 *  one, so a script that always terminates with `done` without tool calls ends. */
function scriptedProvider(rounds: readonly (readonly ProviderEvent[])[]): {
  aiProvider: { id: string; generate(request: ProviderRequest): AsyncIterable<ProviderEvent> };
  requests: ProviderRequest[];
} {
  let turn = 0;
  const requests: ProviderRequest[] = [];
  return {
    aiProvider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        yield* rounds[Math.min(turn++, rounds.length - 1)]!;
      },
    },
    requests,
  };
}

/** The refund tool only billing may activate — the proof of narrowed permissions. */
const refundTool: ToolDefinition = {
  name: "billing/refund",
  description: "Issue a refund for the referenced invoice.",
  parameters: { type: "object" },
  execute(_args, ctx): ToolResult {
    return { toolCallId: ctx.toolCallId, name: "billing/refund", value: { refunded: true } };
  },
};

const definitions: Readonly<Record<string, AgentDefinition>> = {
  triage: {
    name: "triage",
    model: { provider: "mock", model: "demo" },
    tools: ["handoff"],
    instructions: "Triage: diagnose, then handoff to billing or support.",
  },
  billing: {
    name: "billing",
    model: { provider: "mock", model: "demo" },
    tools: ["billing/refund"],
    instructions: "Billing support. Refund duplicate charges.",
  },
  support: {
    name: "support",
    model: { provider: "mock", model: "demo" },
    tools: [],
    instructions: "General support.",
  },
};

/** Read the transfer target the model's handoff call produced, from the run's
 *  event stream. Returns undefined when the run did not hand off. */
function handoffTarget(events: readonly AgentEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== "tool_execution_finished" || event.result.name !== "handoff") continue;
    const value: unknown = event.result.error === undefined ? event.result.value : undefined;
    if (value && typeof value === "object" && "transferredTo" in value) return String(value.transferredTo);
  }
  return undefined;
}

/** Handoff tool error text from a run's event stream, when the tool failed closed. */
function handoffError(events: readonly AgentEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "tool_execution_finished" && event.result.name === "handoff" && event.result.error) {
      return event.result.error.message;
    }
  }
  return undefined;
}

/** Conversation transcript as display lines from the shared session store. */
function transcript(entries: readonly SessionEntry[]): string[] {
  return entries
    .filter((entry) => entry.message !== undefined)
    .map((entry) => {
      const message = entry.message!;
      const parts = message.content.map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_call") return `${block.name}()`;
        if (block.type === "tool_result") return `→ ${block.name}`;
        return "<block>";
      });
      return `${message.role}: ${parts.join(" ")}`;
    });
}

async function drain(session: ReturnType<typeof createAgentSession>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.subscribe() as AsyncIterable<AgentEvent>) {
    events.push(event);
  }
  return events;
}

export async function demo(): Promise<{
  unknownTargetError: string | undefined;
  handoffTarget: string | undefined;
  specialistBlockedReason: string;
  contextCarried: boolean;
  swapProviderCalls: number;
  swapMs: number;
  transcript: readonly string[];
}> {
  const store = createMemorySessionStore();
  const blocked: string[] = [];
  const trackBlocked = (session: ReturnType<typeof createAgentSession>): Promise<AgentEvent[]> =>
    drain(session).then((events) => {
      for (const event of events) {
        if (event.type === "tool_execution_blocked") blocked.push(`${event.name}:${event.reason}`);
      }
      return events;
    });

  // Fail-closed first: the model invents a target that is not on the allow-list.
  const unknownRound = scriptedProvider([
    [
      providerTextDelta("This is a billing issue."),
      providerToolCall(toolCallContent("h0", "handoff", { target: "payroll" })),
      providerDone(),
    ],
    [providerTextDelta("Sorry, I can only transfer to billing or support."), providerDone()],
  ]);
  const triageA = await resolveAgentDefinition(definitions.triage, {
    tools: [createHandoffTool(definitions)],
    overrides: { provider: unknownRound.aiProvider },
  });
  const sessionA = createAgentSession({ agent: triageA, store, id: "handoff-demo" });
  const [eventsA, _runA] = await Promise.all([trackBlocked(sessionA), sessionA.run("My last invoice was charged twice.")]);
  const unknownTargetError = handoffError(eventsA);

  // Happy path: triage hands off to billing; billing continues the same transcript.
  const triageRounds = scriptedProvider([
    [
      providerTextDelta("This is a billing issue."),
      providerToolCall(toolCallContent("h1", "handoff", { target: "billing" })),
      providerDone(),
    ],
    [providerTextDelta("Transferring you to billing."), providerDone()],
  ]);
  const billingRounds = scriptedProvider([
    // The specialist grabs for the handoff tool it does not have — must be blocked.
    [providerToolCall(toolCallContent("h2", "handoff", { target: "support" })), providerDone()],
    [providerTextDelta("Refund issued for the duplicate charge."), providerDone()],
  ]);
  const triage = await resolveAgentDefinition(definitions.triage, {
    tools: [createHandoffTool(definitions)],
    overrides: { provider: triageRounds.aiProvider },
  });
  const triageSession = createAgentSession({ agent: triage, store, id: "handoff-demo" });
  const [triageEvents, triageRun] = await Promise.all([
    trackBlocked(triageSession),
    triageSession.run("My last invoice was charged twice."),
  ]);
  const target = handoffTarget(triageEvents);
  if (target === undefined || target !== "billing") throw new Error(`expected handoff to billing, got ${String(target)}`);

  // Definition swap: resolve the target definition and continue the SAME session
  // (same store + sessionId; leafId carries the transcript pointer) with the specialist.
  const swapStart = performance.now();
  const billing: Agent = await resolveAgentDefinition(definitions.billing, {
    tools: [refundTool],
    overrides: { provider: billingRounds.aiProvider },
  });
  const billingSession = createAgentSession({ agent: billing, store, id: "handoff-demo", leafId: triageRun.leafId });
  const swapMs = performance.now() - swapStart;
  const swapProviderCalls = billingRounds.requests.length;
  await Promise.all([trackBlocked(billingSession), billingSession.run([])]);

  // Context carried: the specialist's first prompt already contains the original
  // complaint (one transcript chain), with no new session and no re-send by the host.
  const contextCarried = billingRounds.requests.some((request) =>
    request.messages.some((message) => JSON.stringify(message.content).includes("charged twice")),
  );

  return {
    unknownTargetError,
    handoffTarget: target,
    specialistBlockedReason: blocked.includes("handoff:unknown_tool") ? "unknown_tool" : "not blocked",
    contextCarried,
    swapProviderCalls,
    swapMs,
    transcript: transcript(await billingSession.entries()),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
