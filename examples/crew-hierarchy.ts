import {
  type AgentDefinition,
  type AgentEvent,
  type AIProvider,
  type ArtifactParser,
  type ArtifactRepairer,
  type ArtifactValidator,
  createAgent,
  createAgentSession,
  createSecretRedactor,
  createToolRegistry,
  type JsonObject,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveAgentDefinition,
  type ToolDefinition,
  type ToolResult,
  toolCallContent,
} from "@arnilo/prism";
import {
  agentNode,
  conditionalNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  fanOutNode,
  functionNode,
  joinNode,
  runWorkflow,
} from "@arnilo/prism-core/runtime/workflows";

// Hierarchical "Crew" workflow pattern on existing Prism primitives.
//
// Demonstrates CrewAI-style hierarchical orchestration using only standard Prism primitives:
//   1. Manager agent decomposes a high-level goal into typed tasks using structured output
//      (ArtifactParser / ArtifactValidator / generateValidateReviseLoop).
//   2. fan_out executes role specialists (researcher, writer) concurrently under bounded maxFanOut.
//   3. join with host reduce aggregates outputs and constructs per-role attribution.
//   4. conditional node validates the aggregate deliverable and routes to either completion or revision.
//   5. Narrowed permissions enforce fail-closed tool access: specialists cannot invoke manager-only
//      tools, and managers cannot invoke specialist tools directly.
//
// Network-free; offline mock providers.

export type SpecialistRole = "researcher" | "writer";

export interface TaskItem {
  readonly role: SpecialistRole;
  readonly instruction: string;
}

export interface TaskPlan {
  readonly tasks: readonly TaskItem[];
}

export interface SpecialistResult {
  readonly role: SpecialistRole;
  readonly instruction: string;
  readonly result: string;
  readonly attribution: {
    readonly agent: string;
    readonly model: string;
  };
}

export interface AggregatedDeliverable {
  readonly taskCount: number;
  readonly deliverables: readonly SpecialistResult[];
  readonly summary: string;
  readonly qualityScore: number;
  readonly validationPassed: boolean;
}

export interface FinalDeliverable {
  readonly status: "completed" | "revised";
  readonly summary: string;
  readonly taskAttribution: readonly { readonly role: SpecialistRole; readonly agent: string }[];
  readonly validationVerdict: string;
}

export interface CrewHierarchyDemoResult {
  readonly status: string;
  readonly planTaskCount: number;
  readonly rolesExecuted: readonly SpecialistRole[];
  readonly deliverableStatus: "completed" | "revised";
  readonly validationPassed: boolean;
  readonly attributions: readonly { readonly role: SpecialistRole; readonly agent: string }[];
  readonly specialistBlockedReason: string;
  readonly managerBlockedReason: string;
  readonly revisionBranchTested: boolean;
}

/** Schema parser helper for manager task plan. */
export function parseTaskPlan(text: string): { ok: true; value: TaskPlan } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as TaskPlan;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid json" };
  }
}

/** Schema parser for the artifact loop. */
export const planParser: ArtifactParser<unknown> = (text) => parseTaskPlan(text);

/** Schema validator enforcing role names and non-empty instructions. */
export const planValidator: ArtifactValidator<unknown> = (value) => {
  const plan = value as TaskPlan | undefined;
  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: [{ path: "root", message: "plan must be an object" }] };
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    return { ok: false, errors: [{ path: "tasks", message: "plan must contain at least one task" }] };
  }
  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    if (!t || typeof t !== "object") {
      return { ok: false, errors: [{ path: `tasks[${i}]`, message: "task must be an object" }] };
    }
    if (t.role !== "researcher" && t.role !== "writer") {
      return { ok: false, errors: [{ path: `tasks[${i}].role`, message: `invalid role: ${String(t.role)}` }] };
    }
    if (typeof t.instruction !== "string" || !t.instruction.trim()) {
      return { ok: false, errors: [{ path: `tasks[${i}].instruction`, message: "instruction is required" }] };
    }
  }
  return { ok: true };
};

/** Artifact repairer prompting model to correct validation errors. */
export const planRepairer: ArtifactRepairer<unknown> = (_value, failure) => ({
  role: "user",
  content: [
    {
      type: "text",
      text: `Fix task plan issues: ${failure.errors?.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ")}`,
    },
  ],
});

export const managerReviewTool: ToolDefinition = {
  name: "manager/review_plan",
  description: "Manager reviews high-level project goals and constraints.",
  parameters: {
    type: "object",
    properties: { goal: { type: "string" } },
    required: ["goal"],
  },
  execute(args, ctx): ToolResult {
    return {
      toolCallId: ctx.toolCallId,
      name: "manager/review_plan",
      value: { reviewed: true, goal: args.goal },
    };
  },
};

export const researcherSearchTool: ToolDefinition = {
  name: "research/search",
  description: "Researcher queries customer records and knowledge bases.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute(args, ctx): ToolResult {
    return {
      toolCallId: ctx.toolCallId,
      name: "research/search",
      value: { found: `Findings for query: ${String(args.query)}` },
    };
  },
};

export const writerFormatTool: ToolDefinition = {
  name: "writer/format",
  description: "Writer formats briefings and executive deliverables.",
  parameters: {
    type: "object",
    properties: { draft: { type: "string" } },
    required: ["draft"],
  },
  execute(_args, ctx): ToolResult {
    return {
      toolCallId: ctx.toolCallId,
      name: "writer/format",
      value: { formatted: true },
    };
  },
};

const allTools = [managerReviewTool, researcherSearchTool, writerFormatTool];
const sharedToolRegistry = createToolRegistry(allTools);

export const agentDefinitions: Readonly<Record<string, AgentDefinition>> = {
  manager: {
    name: "manager",
    model: { provider: "mock", model: "manager-demo" },
    tools: ["manager/review_plan"], // Explicitly narrowed: manager cannot invoke specialist tools directly
    instructions: "You are the manager agent. Decompose the user goal into specialist tasks for researcher and writer.",
  },
  researcher: {
    name: "researcher",
    model: { provider: "mock", model: "researcher-demo" },
    tools: ["research/search"], // Explicitly narrowed: researcher cannot invoke manager or writer tools
    instructions: "You are a research specialist. Investigate customer facts, tickets, and logs.",
  },
  writer: {
    name: "writer",
    model: { provider: "mock", model: "writer-demo" },
    tools: ["writer/format"], // Explicitly narrowed: writer cannot invoke manager or researcher tools
    instructions: "You are a technical writer. Synthesize findings into clear executive briefings.",
  },
};

async function drain(session: ReturnType<typeof createAgentSession>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.subscribe() as AsyncIterable<AgentEvent>) {
    events.push(event);
  }
  return events;
}

export async function verifyNarrowing(): Promise<{
  specialistBlocked: string;
  managerBlocked: string;
}> {
  const blocked: string[] = [];
  const trackBlocked = (session: ReturnType<typeof createAgentSession>): Promise<AgentEvent[]> =>
    drain(session).then((events) => {
      for (const event of events) {
        if (event.type === "tool_execution_blocked") {
          blocked.push(`${event.name}:${event.reason}`);
        }
      }
      return events;
    });

  // 1. Specialist (researcher) attempts to invoke manager-only tool -> must be blocked
  const specialistIllegalToolProvider: AIProvider = {
    id: "mock",
    async *generate() {
      yield providerToolCall(toolCallContent("tc_illegal_spec", "manager/review_plan", { goal: "test" }));
      yield providerTextDelta("Specialist completed turn.");
      yield providerDone();
    },
  };
  const researcherAgent = await resolveAgentDefinition(agentDefinitions.researcher!, {
    tools: sharedToolRegistry,
    overrides: { provider: specialistIllegalToolProvider },
  });
  const researcherSession = createAgentSession({ agent: researcherAgent });
  await Promise.all([trackBlocked(researcherSession), researcherSession.run("Attempt illegal tool call")]);

  // 2. Manager attempts to invoke specialist tool (research/search) directly -> must be blocked
  const managerIllegalToolProvider: AIProvider = {
    id: "mock",
    async *generate() {
      yield providerToolCall(toolCallContent("tc_illegal_mgr", "research/search", { query: "test" }));
      yield providerTextDelta("Manager completed turn.");
      yield providerDone();
    },
  };
  const managerAgent = await resolveAgentDefinition(agentDefinitions.manager!, {
    tools: sharedToolRegistry,
    overrides: { provider: managerIllegalToolProvider },
  });
  const managerSession = createAgentSession({ agent: managerAgent });
  await Promise.all([trackBlocked(managerSession), managerSession.run("Attempt illegal specialist tool call")]);

  return {
    specialistBlocked: blocked.includes("manager/review_plan:unknown_tool") ? "unknown_tool" : "not blocked",
    managerBlocked: blocked.includes("research/search:unknown_tool") ? "unknown_tool" : "not blocked",
  };
}

const managerNodeDef = agentNode({
  agent: "manager",
  input: (ctx) => ({ goal: (ctx.workflowInput as { goal: string }).goal }),
  output: async (ctx) => {
    const entries = await ctx.session.entries();
    const lastAssistant = [...entries].reverse().find((e) => e.message?.role === "assistant");
    const text = lastAssistant?.message?.content.map((b) => (b.type === "text" ? b.text : "")).join("") ?? "";
    const parsed = parseTaskPlan(text);
    if (!parsed.ok) {
      throw new Error(`Manager failed to produce valid task plan: ${parsed.error}`);
    }
    // Untrusted model output is validated against the schema before updating workflow state or fanning out
    await ctx.updateState({ plan: parsed.value as unknown as JsonObject });
    return parsed.value;
  },
});

const fanOutNodeDef = fanOutNode({
  items: (ctx) => {
    const plan = (ctx.state.plan as unknown as TaskPlan | undefined) ?? (ctx.upstream.manager as TaskPlan | undefined);
    if (!plan?.tasks || plan.tasks.length === 0) {
      throw new Error("No tasks available for fan_out");
    }
    return plan.tasks;
  },
  map: async (item, _index, _ctx) => {
    const task = item as TaskItem;
    const specialistProvider: AIProvider = {
      id: "mock",
      async *generate() {
        if (task.role === "researcher") {
          yield providerToolCall(toolCallContent("tc_r", "research/search", { query: task.instruction }));
          yield providerTextDelta("Findings: Customer ACME has 2 pending refund tickets under Enterprise SLA.");
        } else {
          yield providerToolCall(toolCallContent("tc_w", "writer/format", { draft: task.instruction }));
          yield providerTextDelta("Executive Summary: ACME account status is active with 2 refunds processed per SLA.");
        }
        yield providerDone();
      },
    };

    const agentDef = agentDefinitions[task.role];
    if (!agentDef) throw new Error(`Unknown role in task plan: ${task.role}`);
    const agent = await resolveAgentDefinition(agentDef, {
      tools: sharedToolRegistry,
      overrides: { provider: specialistProvider },
    });
    const session = createAgentSession({ agent });
    const runResult = await session.run(task.instruction);
    const resultText = runResult.text || "Task executed";

    const result: SpecialistResult = {
      role: task.role,
      instruction: task.instruction,
      result: resultText,
      attribution: {
        agent: `${task.role}-specialist`,
        model: "demo",
      },
    };
    return result;
  },
  maxFanOut: 8,
});

const aggregateNodeDef = joinNode({
  from: "fan",
  reduce: async (items: readonly unknown[], ctx) => {
    const deliverables = items as readonly SpecialistResult[];
    const isValidationFailure = Boolean((ctx.workflowInput as { forceValidationFailure?: boolean })?.forceValidationFailure);
    const aggregated: AggregatedDeliverable = {
      taskCount: deliverables.length,
      deliverables,
      summary: deliverables.map((d) => `[${d.role.toUpperCase()}]: ${d.result}`).join("\n\n"),
      qualityScore: isValidationFailure ? 45 : 92,
      validationPassed: !isValidationFailure,
    };
    await ctx.updateState({ aggregate: aggregated as unknown as JsonObject });
    return aggregated;
  },
});

const validateNodeDef = conditionalNode({
  when: async (ctx) => {
    const aggregate = (ctx.upstream.aggregate ?? ctx.state.aggregate) as AggregatedDeliverable;
    return Boolean(aggregate?.validationPassed && aggregate.qualityScore >= 80);
  },
  then: ["complete"],
  else: ["revise"],
});

const completeNodeDef = functionNode({
  execute: async (ctx) => {
    const aggregate = (ctx.upstream.aggregate ?? ctx.state.aggregate) as AggregatedDeliverable;
    const finalOutput: FinalDeliverable = {
      status: "completed",
      summary: aggregate.summary,
      taskAttribution: aggregate.deliverables.map((d) => ({ role: d.role, agent: d.attribution.agent })),
      validationVerdict: `Approved: Quality score ${aggregate.qualityScore}/100 meets production criteria.`,
    };
    return finalOutput;
  },
});

const reviseNodeDef = functionNode({
  execute: async (ctx) => {
    const aggregate = (ctx.upstream.aggregate ?? ctx.state.aggregate) as AggregatedDeliverable;
    const finalOutput: FinalDeliverable = {
      status: "revised",
      summary: `Revision needed: Quality score ${aggregate.qualityScore}/100 below 80 threshold.`,
      taskAttribution: aggregate.deliverables.map((d) => ({ role: d.role, agent: d.attribution.agent })),
      validationVerdict: "Routed to revision branch for manager re-planning.",
    };
    return finalOutput;
  },
});

export const crewWorkflow = defineWorkflow({
  revision: "crew-demo-1",
  id: "hierarchical-crew",
  nodes: {
    manager: managerNodeDef,
    fan: fanOutNodeDef,
    aggregate: aggregateNodeDef,
    validate: validateNodeDef,
    complete: completeNodeDef,
    revise: reviseNodeDef,
  },
  edges: [
    ["manager", "fan"],
    ["fan", "aggregate"],
    ["aggregate", "validate"],
    ["validate", "complete"],
    ["validate", "revise"],
  ],
  limits: { maxFanOut: 8, maxConcurrency: 4, maxNodes: 32 },
});

export async function demo(): Promise<CrewHierarchyDemoResult> {
  const redactor = createSecretRedactor([]);
  const checkpoints = createMemoryWorkflowCheckpoints({ redactor });

  // 1. Happy path run
  const managerProvider: AIProvider = {
    id: "mock",
    async *generate(request) {
      const isRevision = request.messages.some((m) => m.content.some((b) => b.type === "text" && b.text.includes("Fix task plan issues")));
      if (!isRevision && request.messages.length === 1) {
        yield providerTextDelta(
          JSON.stringify({
            tasks: [
              { role: "researcher", instruction: "Investigate ACME refund history and SLA tier." },
              { role: "writer", instruction: "Draft executive briefing on ACME account status." },
            ],
          }),
        );
      } else {
        yield providerTextDelta(
          JSON.stringify({
            tasks: [
              { role: "researcher", instruction: "Investigate ACME refund history and SLA tier." },
              { role: "writer", instruction: "Draft executive briefing on ACME account status." },
            ],
          }),
        );
      }
      yield providerDone();
    },
  };

  const managerAgent = createAgent({
    model: { provider: "mock", model: "manager-demo" },
    provider: managerProvider,
    tools: createToolRegistry([managerReviewTool]),
    instructions: "Decompose the goal into structured specialist tasks.",
    loop: {
      strategy: "generate-validate-revise",
      parser: planParser,
      validator: planValidator,
      repairer: planRepairer,
      maxRevisions: 3,
    },
  });

  const happyResult = await runWorkflow(
    crewWorkflow,
    { goal: "Prepare executive briefing on customer ACME refund request." },
    {
      agentFactory: (agentName) => {
        if (agentName === "manager") return createAgentSession({ agent: managerAgent });
        throw new Error(`Unexpected agent name: ${agentName}`);
      },
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
    },
  );

  // 2. Validation failure revision run
  const failureResult = await runWorkflow(
    crewWorkflow,
    { goal: "Prepare executive briefing on customer ACME refund request.", forceValidationFailure: true },
    {
      agentFactory: (agentName) => {
        if (agentName === "manager") return createAgentSession({ agent: managerAgent });
        throw new Error(`Unexpected agent name: ${agentName}`);
      },
      checkpoints,
      redactor,
      ownership: { tenantId: "demo" },
      signal: AbortSignal.timeout(30_000),
    },
  );

  // 3. Security narrowing verification
  const narrowing = await verifyNarrowing();

  const plan = happyResult.outputs.manager as TaskPlan;
  const aggregate = happyResult.outputs.aggregate as AggregatedDeliverable;
  const complete = happyResult.outputs.complete as FinalDeliverable;

  return {
    status: happyResult.status,
    planTaskCount: plan.tasks.length,
    rolesExecuted: aggregate.deliverables.map((d) => d.role),
    deliverableStatus: complete.status,
    validationPassed: aggregate.validationPassed,
    attributions: complete.taskAttribution,
    specialistBlockedReason: narrowing.specialistBlocked,
    managerBlockedReason: narrowing.managerBlocked,
    revisionBranchTested: failureResult.outputs.revise !== undefined && failureResult.outputs.complete === undefined,
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
