import type { JsonObject, JsonSchema, PackageAPI, PackageCommand } from "@arnilo/prism";
import { WorkflowDefinitionError } from "./errors.js";
import type { WorkflowRun } from "./parent-session.js";
import { startWorkflow } from "./parent-session.js";
import type { WorkflowDefinition } from "./types.js";

export interface WorkflowCommandOptions {
  /** Validated by the kernel before `run`; the validated arguments are the workflow input. */
  readonly args?: JsonSchema;
  readonly description?: string;
  /**
   * Called with the live `WorkflowRun` right after it starts and before the command awaits its result, so a
   * host can render `run.stream()`, `steer`, or `abort` from the command it already registered. The command
   * still resolves with `{ workflowRunId, status }` once the run ends. A throw aborts the run and fails the command.
   */
  readonly onRun?: (run: WorkflowRun) => void | Promise<void>;
}

/** What `workflowCommand` returns to the caller. */
export interface WorkflowCommandResult {
  readonly workflowRunId: string;
  readonly status: string;
}

/**
 * A command that starts `definition` as a run on the caller's session (roadmap §2.11). Register it with
 * `prism.commands.register(workflowCommand(prism, "build", () => build))`. A `() => definition` thunk is
 * resolved on the first run, so the definition may reference agents created after `setup`. The command's
 * arguments are the workflow input. `checkpoints`, `leases`, `workspace`, and `host` resolve through
 * `prism`, at run time.
 */
export function workflowCommand(
  prism: PackageAPI,
  name: string,
  definition: WorkflowDefinition | (() => WorkflowDefinition),
  options: WorkflowCommandOptions = {},
): PackageCommand {
  if (!name?.trim()) throw new WorkflowDefinitionError("workflowCommand requires a name");
  let resolved: WorkflowDefinition | undefined = typeof definition === "function" ? undefined : definition;
  const command: PackageCommand = {
    name,
    description: options.description ?? `Run the "${name}" workflow`,
    ...(options.args ? { args: options.args } : {}),
    async run(args: JsonObject, ctx): Promise<WorkflowCommandResult> {
      if (!ctx.session) {
        // No bound parent: open one and re-enter, so the run is bound to a session context.
        const parent = await ctx.agent.session();
        try {
          return (await ctx.agent.commands.run(name, args, { session: parent })) as WorkflowCommandResult;
        } finally {
          await parent.close();
        }
      }
      resolved ??= (definition as () => WorkflowDefinition)();
      const run = startWorkflow(resolved, args, { prism, session: ctx.session });
      if (options.onRun) {
        try {
          await options.onRun(run);
        } catch (error) {
          run.abort(error);
          await run.result().catch(() => undefined);
          throw error;
        }
      }
      const result = await run.result();
      return { workflowRunId: run.id, status: result.status };
    },
  };
  return command;
}
