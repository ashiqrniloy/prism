import type {
  CommandDefinition,
  CommandResult,
  JsonObject,
  OwnershipScope,
} from "@arnilo/prism";
import { WorkflowAbortError, WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { enqueueWorkflow } from "./coordinator.js";
import { replayWorkflow } from "./replay.js";
import { resumeWorkflow, runWorkflow } from "./run.js";
import { cancelWorkflowRun, getWorkflowRun, listWorkflowRuns } from "./status.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";
import type { WorkflowSchedules } from "./schedules.js";
import { errorCode, errorMessage, isAbortError } from "./util.js";

export interface CreateWorkflowCommandsInput {
  readonly workflows:
    | Readonly<Record<string, WorkflowDefinition>>
    | ((id: string) => WorkflowDefinition | undefined);
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "signal">;
  readonly schedules?: WorkflowSchedules;
}

function resolveWorkflow(
  workflows: CreateWorkflowCommandsInput["workflows"],
  workflowId: string,
): WorkflowDefinition {
  const workflow = typeof workflows === "function" ? workflows(workflowId) : workflows[workflowId];
  if (!workflow) {
    throw new WorkflowRuntimeError(
      `Unknown workflow: ${workflowId}`,
      "ERR_PRISM_WORKFLOW_NOT_FOUND",
    );
  }
  return workflow;
}

function readString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOwnership(args: JsonObject): OwnershipScope | undefined {
  const ownership = args.ownership;
  if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) {
    const tenantId = readString(args, "tenantId");
    const accountId = readString(args, "accountId");
    const userId = readString(args, "userId");
    if (tenantId === undefined && accountId === undefined && userId === undefined) return undefined;
    return {
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
      ...(userId !== undefined ? { userId } : {}),
    };
  }
  const record = ownership as Record<string, unknown>;
  const tenantId = typeof record.tenantId === "string" ? record.tenantId : undefined;
  const accountId = typeof record.accountId === "string" ? record.accountId : undefined;
  const userId = typeof record.userId === "string" ? record.userId : undefined;
  if (tenantId === undefined && accountId === undefined && userId === undefined) return undefined;
  return {
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
    ...(userId !== undefined ? { userId } : {}),
  };
}

function readStatusFilter(
  args: JsonObject,
): WorkflowRunStatus | readonly WorkflowRunStatus[] | undefined {
  const status = args.status;
  if (typeof status === "string") return status as WorkflowRunStatus;
  if (Array.isArray(status) && status.every((item) => typeof item === "string")) {
    return status as WorkflowRunStatus[];
  }
  return undefined;
}

function commandError(name: string, error: unknown): CommandResult {
  const message = errorMessage(error) || "Workflow command failed";
  const code = errorCode(error);
  return {
    name,
    error: {
      message,
      ...(code !== undefined ? { code } : {}),
    },
    content: [{ type: "text", text: message }],
  };
}

function requireWorkflowId(args: JsonObject): string {
  const workflowId = readString(args, "workflowId");
  if (!workflowId) {
    throw new WorkflowRuntimeError("workflowId is required", "ERR_PRISM_WORKFLOW_INVALID_ARGS");
  }
  return workflowId;
}

function requireRunId(args: JsonObject): string {
  const runId = readString(args, "runId");
  if (!runId) {
    throw new WorkflowRuntimeError("runId is required", "ERR_PRISM_WORKFLOW_INVALID_ARGS");
  }
  return runId;
}

function readResume(args: JsonObject): RunWorkflowOptions["resume"] {
  if (args.decision === undefined && args.input === undefined && args.expectedVersion === undefined) {
    return undefined;
  }
  if (args.decision !== "approve" && args.decision !== "deny") {
    throw new WorkflowRuntimeError(
      "decision must be approve or deny",
      "ERR_PRISM_WORKFLOW_INVALID_ARGS",
    );
  }
  if (!Number.isSafeInteger(args.expectedVersion) || (args.expectedVersion as number) < 1) {
    throw new WorkflowRuntimeError(
      "expectedVersion must be a positive safe integer",
      "ERR_PRISM_WORKFLOW_INVALID_ARGS",
    );
  }
  return {
    decision: args.decision,
    input: args.input,
    expectedVersion: args.expectedVersion as number,
  };
}

/**
 * Optional host binding — registers `CommandDefinition` entries for `runRpcServer`.
 * Command names: `workflow.start`, `workflow.status`, `workflow.list`, `workflow.cancel`, `workflow.resume`.
 */
export function createWorkflowCommands(input: CreateWorkflowCommandsInput): CommandDefinition[] {
  const { workflows, checkpoints, runOptions } = input;

  const start: CommandDefinition = {
    name: "workflow.start",
    description: "Start a registered workflow run and wait for completion.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        input: {},
        runId: { type: "string" },
        ownership: { type: "object" },
      },
      required: ["workflowId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflowId = requireWorkflowId(args);
        const workflow = resolveWorkflow(workflows, workflowId);
        const ownership = readOwnership(args) ?? runOptions?.ownership;
        const result = await runWorkflow(workflow, args.input, {
          ...runOptions,
          checkpoints,
          ownership,
          runId: readString(args, "runId"),
          signal: context.signal,
        });
        return {
          name: "workflow.start",
          value: result,
          content: [{
            type: "text",
            text: `Workflow ${result.workflowId} run ${result.runId} ${result.status}`,
          }],
        };
      } catch (error) {
        if (isAbortError(error) || error instanceof WorkflowAbortError) {
          return commandError("workflow.start", error);
        }
        return commandError("workflow.start", error);
      }
    },
  };

  const enqueue: CommandDefinition = {
    name: "workflow.enqueue",
    description: "Durably enqueue a registered workflow for background coordinator execution.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" }, input: {}, runId: { type: "string" }, ownership: { type: "object" },
      },
      required: ["workflowId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflow = resolveWorkflow(workflows, requireWorkflowId(args));
        const result = await enqueueWorkflow(workflow, args.input, {
          checkpoints,
          runId: readString(args, "runId"),
          ownership: readOwnership(args) ?? runOptions?.ownership,
          signal: context.signal,
        });
        return { name: "workflow.enqueue", value: result, content: [{ type: "text", text: `Queued workflow ${result.workflowId} run ${result.runId}` }] };
      } catch (error) {
        return commandError("workflow.enqueue", error);
      }
    },
  };

  const replay: CommandDefinition = {
    name: "workflow.replay",
    description: "Create a lineage-linked workflow replay from a succeeded node.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" }, sourceRunId: { type: "string" }, fromNodeId: { type: "string" }, runId: { type: "string" }, ownership: { type: "object" },
      },
      required: ["workflowId", "sourceRunId", "fromNodeId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflow = resolveWorkflow(workflows, requireWorkflowId(args));
        const sourceRunId = readString(args, "sourceRunId");
        const fromNodeId = readString(args, "fromNodeId");
        if (!sourceRunId || !fromNodeId) throw new WorkflowRuntimeError("sourceRunId and fromNodeId are required", "ERR_PRISM_WORKFLOW_INVALID_ARGS");
        const result = await replayWorkflow(workflow, { sourceRunId, fromNodeId, runId: readString(args, "runId") }, {
          ...runOptions,
          checkpoints,
          ownership: readOwnership(args) ?? runOptions?.ownership,
          signal: context.signal,
        });
        return { name: "workflow.replay", value: result, content: [{ type: "text", text: `Replayed workflow ${result.workflowId} run ${result.runId}: ${result.status}` }] };
      } catch (error) {
        return commandError("workflow.replay", error);
      }
    },
  };

  const status: CommandDefinition = {
    name: "workflow.status",
    description: "Load a workflow run checkpoint by workflowId/runId.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        runId: { type: "string" },
        ownership: { type: "object" },
      },
      required: ["workflowId", "runId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflowId = requireWorkflowId(args);
        const runId = requireRunId(args);
        const record = await getWorkflowRun(checkpoints, {
          workflowId,
          runId,
          ownership: readOwnership(args) ?? runOptions?.ownership,
          signal: context.signal,
        });
        if (!record) {
          return commandError(
            "workflow.status",
            new WorkflowCheckpointError(`No checkpoint for workflow ${workflowId} run ${runId}`),
          );
        }
        return {
          name: "workflow.status",
          value: record,
          content: [{
            type: "text",
            text: `Workflow ${record.workflowId} run ${record.runId}: ${record.value.status} (v${record.version})`,
          }],
        };
      } catch (error) {
        return commandError("workflow.status", error);
      }
    },
  };

  const list: CommandDefinition = {
    name: "workflow.list",
    description: "List workflow runs from the checkpoint adapter (paginated).",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        ownership: { type: "object" },
        status: {},
        cursor: { type: "string" },
        limit: { type: "number" },
      },
    } as JsonObject,
    async execute(args, context) {
      try {
        const page = await listWorkflowRuns(checkpoints, {
          workflowId: readString(args, "workflowId"),
          ownership: readOwnership(args) ?? runOptions?.ownership,
          status: readStatusFilter(args),
          cursor: readString(args, "cursor"),
          limit: typeof args.limit === "number" ? args.limit : undefined,
          signal: context.signal,
        });
        return {
          name: "workflow.list",
          value: page,
          content: [{
            type: "text",
            text: `Listed ${page.items.length} workflow run(s)${page.nextCursor ? " (more available)" : ""}`,
          }],
        };
      } catch (error) {
        return commandError("workflow.list", error);
      }
    },
  };

  const cancel: CommandDefinition = {
    name: "workflow.cancel",
    description: "Cancel an in-flight workflow run, or mark an orphaned running checkpoint aborted.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        runId: { type: "string" },
        ownership: { type: "object" },
      },
      required: ["workflowId", "runId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflowId = requireWorkflowId(args);
        const runId = requireRunId(args);
        const result = await cancelWorkflowRun({
          workflowId,
          runId,
          checkpoints,
          ownership: readOwnership(args) ?? runOptions?.ownership,
          signal: context.signal,
        });
        return {
          name: "workflow.cancel",
          value: result,
          content: [{
            type: "text",
            text: result.aborted
              ? `Cancelled workflow ${workflowId} run ${runId}`
              : `Workflow ${workflowId} run ${runId} was not running (${result.status ?? "unknown"})`,
          }],
        };
      } catch (error) {
        return commandError("workflow.cancel", error);
      }
    },
  };

  const resume: CommandDefinition = {
    name: "workflow.resume",
    description: "Resume a workflow run from its durable checkpoint, optionally approving or denying a suspension.",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        runId: { type: "string" },
        ownership: { type: "object" },
        decision: { type: "string", enum: ["approve", "deny"] },
        input: {},
        expectedVersion: { type: "integer", minimum: 1 },
      },
      required: ["workflowId", "runId"],
    } as JsonObject,
    async execute(args, context) {
      try {
        const workflowId = requireWorkflowId(args);
        const runId = requireRunId(args);
        const workflow = resolveWorkflow(workflows, workflowId);
        const ownership = readOwnership(args) ?? runOptions?.ownership;
        const result = await resumeWorkflow(
          workflow,
          { workflowId, runId },
          {
            ...runOptions,
            checkpoints,
            ownership,
            signal: context.signal,
            resume: readResume(args),
          },
        );
        return {
          name: "workflow.resume",
          value: result,
          content: [{
            type: "text",
            text: `Resumed workflow ${result.workflowId} run ${result.runId}: ${result.status}`,
          }],
        };
      } catch (error) {
        return commandError("workflow.resume", error);
      }
    },
  };

  const scheduleCommands = input.schedules ? createScheduleCommands(input.schedules) : [];
  return [start, enqueue, replay, status, list, cancel, resume, ...scheduleCommands];
}

function createScheduleCommands(schedules: WorkflowSchedules): CommandDefinition[] {
  const execute = (
    name: string,
    description: string,
    parameters: JsonObject,
    operation: (args: JsonObject, signal?: AbortSignal) => Promise<unknown>,
  ): CommandDefinition => ({
    name,
    description,
    parameters,
    async execute(args, context) {
      try {
        const value = await operation(args, context.signal);
        return { name, value, content: [{ type: "text", text: `${name} succeeded` }] };
      } catch (error) {
        return commandError(name, error);
      }
    },
  });
  const idSchema = {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  } as JsonObject;
  const id = (args: JsonObject) => {
    const value = readString(args, "id");
    if (!value) throw new WorkflowRuntimeError("id is required", "ERR_PRISM_WORKFLOW_INVALID_ARGS");
    return value;
  };
  return [
    execute("schedule.create", "Create a durable workflow schedule.", {
      type: "object",
      properties: {
        id: { type: "string" }, workflowId: { type: "string" }, nextRunAt: { type: "string" }, input: {},
        intervalMs: { type: "integer", minimum: 1 }, calculatorId: { type: "string" }, paused: { type: "boolean" }, metadata: { type: "object" },
      },
      required: ["id", "workflowId", "nextRunAt"],
    } as JsonObject, (args, signal) => schedules.create({
      id: id(args),
      workflowId: requireWorkflowId(args),
      nextRunAt: readString(args, "nextRunAt") ?? "",
      input: args.input,
      intervalMs: typeof args.intervalMs === "number" ? args.intervalMs : undefined,
      calculatorId: readString(args, "calculatorId"),
      paused: args.paused === true,
      metadata: args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
        ? args.metadata as JsonObject
        : undefined,
    }, signal)),
    execute("schedule.list", "List durable workflow schedules.", {
      type: "object",
      properties: { status: {}, cursor: { type: "string" }, limit: { type: "integer", minimum: 1 } },
    } as JsonObject, (args, signal) => schedules.list({
      status: readScheduleStatus(args.status),
      cursor: readString(args, "cursor"),
      limit: typeof args.limit === "number" ? args.limit : undefined,
      signal,
    })),
    execute("schedule.pause", "Pause a durable workflow schedule.", idSchema, (args, signal) => schedules.pause(id(args), signal)),
    execute("schedule.resume", "Resume a durable workflow schedule.", {
      type: "object", properties: { id: { type: "string" }, nextRunAt: { type: "string" } }, required: ["id"],
    } as JsonObject, (args, signal) => schedules.resume(id(args), readString(args, "nextRunAt"), signal)),
    execute("schedule.trigger", "Idempotently trigger a workflow schedule now.", {
      type: "object", properties: { id: { type: "string" }, idempotencyKey: { type: "string" } }, required: ["id", "idempotencyKey"],
    } as JsonObject, (args, signal) => schedules.trigger(id(args), { idempotencyKey: readString(args, "idempotencyKey") ?? "", signal })),
    execute("schedule.delete", "Delete a durable workflow schedule.", idSchema, (args, signal) => schedules.delete(id(args), signal)),
  ];
}

function readScheduleStatus(
  value: unknown,
): import("./schedules.js").WorkflowScheduleStatus | readonly import("./schedules.js").WorkflowScheduleStatus[] | undefined {
  if (value === undefined) return undefined;
  const valid = (item: unknown): item is import("./schedules.js").WorkflowScheduleStatus =>
    item === "active" || item === "paused" || item === "completed";
  if (valid(value)) return value;
  if (Array.isArray(value) && value.every(valid)) return value;
  throw new WorkflowRuntimeError("schedule status is invalid", "ERR_PRISM_WORKFLOW_INVALID_ARGS");
}
