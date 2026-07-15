import type {
  CommandDefinition,
  CommandResult,
  JsonObject,
  OwnershipScope,
} from "@arnilo/prism";
import { WorkflowAbortError, WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { resumeWorkflow, runWorkflow } from "./run.js";
import { cancelWorkflowRun, getWorkflowRun, listWorkflowRuns } from "./status.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowRunStatus,
} from "./types.js";
import { errorCode, errorMessage, isAbortError } from "./util.js";

export interface CreateWorkflowCommandsInput {
  readonly workflows:
    | Readonly<Record<string, WorkflowDefinition>>
    | ((id: string) => WorkflowDefinition | undefined);
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "signal">;
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
    description: "Resume a workflow run from its durable checkpoint.",
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

  return [start, status, list, cancel, resume];
}
