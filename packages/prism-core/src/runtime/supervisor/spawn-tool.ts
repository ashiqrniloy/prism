import type { AgentRunResult, JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";
import { SupervisorError } from "./errors.js";
import { HARD_MILESTONE_EVERY_TURNS } from "./limits.js";
import type { ChildReportPolicy, DelegationWaitResult, Supervisor } from "./types.js";

export interface CreateSpawnAgentToolOptions {
  readonly supervisor: Supervisor;
  readonly name?: string;
  readonly description?: string;
}

export interface CreateDelegationControlToolOptions {
  readonly supervisor: Supervisor;
  readonly name?: string;
  readonly description?: string;
}

/** Creates a non-exclusive, model-facing wrapper around one host-owned supervisor. */
export function createSpawnAgentTool(options: CreateSpawnAgentToolOptions): ToolDefinition {
  const name = options.name ?? "spawn_agent";
  const childIds = Object.freeze([...options.supervisor.childIds]);
  return {
    name,
    exclusive: false,
    description: options.description ?? `Run an allow-listed child agent. Allowed childId values: ${childIds.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        childId: { type: "string", enum: childIds },
        input: { type: "string" },
        threadId: { type: "string" },
        mode: { type: "string", enum: ["sync", "async"] },
        lifetime: { type: "string", enum: ["task", "session"] },
        report: { type: "string", enum: ["on-complete", "milestones", "stream"] },
        milestone: {
          type: "object",
          properties: { everyTurns: { type: "integer", minimum: 1, maximum: HARD_MILESTONE_EVERY_TURNS } },
          additionalProperties: false,
        },
        budgetShare: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      },
      required: ["childId", "input"],
      additionalProperties: false,
    } as unknown as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const childId = args.childId;
      const input = args.input;
      const threadId = args.threadId;
      const mode = args.mode ?? "sync";
      const lifetime = args.lifetime ?? "task";
      const report = args.report;
      const milestone = args.milestone;
      const budgetShare = args.budgetShare;
      if (
        typeof childId !== "string" ||
        typeof input !== "string" ||
        (threadId !== undefined && typeof threadId !== "string") ||
        (mode !== "sync" && mode !== "async")
      ) {
        return toolError(name, context.toolCallId, "childId and input must be strings; mode must be sync or async");
      }
      if (lifetime !== "task" && lifetime !== "session") return toolError(name, context.toolCallId, "lifetime must be task or session");
      if (report !== undefined && report !== "on-complete" && report !== "milestones" && report !== "stream") {
        return toolError(name, context.toolCallId, "report must be on-complete, milestones, or stream");
      }
      const everyTurns = milestone === undefined || typeof milestone !== "object" || milestone === null ? undefined : (milestone as JsonObject).everyTurns;
      if (
        everyTurns !== undefined &&
        (!Number.isSafeInteger(everyTurns) || (everyTurns as number) < 1 || (everyTurns as number) > HARD_MILESTONE_EVERY_TURNS)
      ) {
        return toolError(
          name,
          context.toolCallId,
          `milestone.everyTurns must be a positive integer at most ${HARD_MILESTONE_EVERY_TURNS}`,
        );
      }
      if (budgetShare !== undefined && (typeof budgetShare !== "number" || !Number.isFinite(budgetShare) || budgetShare <= 0 || budgetShare > 1)) {
        return toolError(name, context.toolCallId, "budgetShare must be a number greater than 0 and at most 1");
      }
      if (!childIds.includes(childId)) return toolError(name, context.toolCallId, "Unknown child id");

      try {
        const request = {
          childId,
          input,
          ...(threadId !== undefined ? { threadId } : {}),
          ...(lifetime === "session" ? { lifetime: "session" as const } : {}),
          ...(report !== undefined ? { report: report as ChildReportPolicy } : {}),
          ...(everyTurns !== undefined ? { milestone: { everyTurns: everyTurns as number } } : {}),
          ...(budgetShare !== undefined ? { budgetShare } : {}),
          signal: context.signal,
        };
        // Session-lifetime children are background by construction: never block the parent turn.
        if (mode === "async" || lifetime === "session") {
          const handle = await options.supervisor.delegateAsync(request);
          return { toolCallId: context.toolCallId, name, content: [], value: { childId, ...handle } };
        }
        return resultToolCall(name, context.toolCallId, childId, await options.supervisor.delegate(request), options.supervisor);
      } catch (error) {
        return toolError(
          name,
          context.toolCallId,
          options.supervisor.redact(error instanceof SupervisorError ? error.message : "Spawn failed"),
        );
      }
    },
  };
}

/** Joins one host-owned async delegation. Call once per handle for wait-all. */
export function createWaitAgentTool(options: CreateDelegationControlToolOptions): ToolDefinition {
  const name = options.name ?? "wait_agent";
  return {
    name,
    exclusive: false,
    description: options.description ?? "Wait for one async child delegation by its handle.",
    parameters: delegationIdSchema(),
    async execute(args, context): Promise<ToolResult> {
      const delegationId = args.delegationId;
      if (typeof delegationId !== "string") return toolError(name, context.toolCallId, "delegationId must be a string");
      try {
        const result = await options.supervisor.wait(delegationId, { signal: context.signal });
        return waitToolResult(name, context.toolCallId, delegationId, result, options.supervisor);
      } catch (error) {
        return toolError(
          name,
          context.toolCallId,
          options.supervisor.redact(error instanceof SupervisorError ? error.message : "Wait failed"),
        );
      }
    },
  };
}

/** Aborts one host-owned running async delegation. */
export function createCancelAgentTool(options: CreateDelegationControlToolOptions): ToolDefinition {
  const name = options.name ?? "cancel_agent";
  return {
    name,
    exclusive: false,
    description: options.description ?? "Cancel one async child delegation by its handle.",
    parameters: delegationIdSchema(),
    async execute(args, context): Promise<ToolResult> {
      const delegationId = args.delegationId;
      if (typeof delegationId !== "string") return toolError(name, context.toolCallId, "delegationId must be a string");
      try {
        return {
          toolCallId: context.toolCallId,
          name,
          content: [],
          value: { delegationId, status: options.supervisor.cancel(delegationId) ? "cancelling" : "terminal" },
        };
      } catch (error) {
        return toolError(
          name,
          context.toolCallId,
          options.supervisor.redact(error instanceof SupervisorError ? error.message : "Cancel failed"),
        );
      }
    },
  };
}

function delegationIdSchema(): JsonObject {
  return {
    type: "object",
    properties: { delegationId: { type: "string" } },
    required: ["delegationId"],
    additionalProperties: false,
  } as unknown as JsonObject;
}

function resultToolCall(name: string, toolCallId: string, childId: string, result: AgentRunResult, supervisor: Supervisor): ToolResult {
  const text = supervisor.redact(result.text);
  return {
    toolCallId,
    name,
    content: text ? [{ type: "text", text }] : [],
    value: { childId, status: result.status, usage: result.usage, text },
  };
}

function waitToolResult(
  name: string,
  toolCallId: string,
  delegationId: string,
  result: DelegationWaitResult,
  supervisor: Supervisor,
): ToolResult {
  if (result.status === "cancelled") return { toolCallId, name, content: [], value: { delegationId, status: result.status } };
  const text = supervisor.redact(result.text);
  return {
    toolCallId,
    name,
    content: text ? [{ type: "text", text }] : [],
    value: { delegationId, status: result.status, usage: result.usage, text },
  };
}

function toolError(name: string, toolCallId: string, message: string): ToolResult {
  return { toolCallId, name, error: { message } };
}
