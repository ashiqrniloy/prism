import type { JsonObject } from "@arnilo/prism";
import type { RunResultStatus } from "@arnilo/prism";
import { HeadlessError } from "../errors.js";
import type { SchedulerFiring, SchedulerTarget } from "./state.js";

/** Statuses a command may report; anything else is a completed call, and a defect is a failure. */
const COMMAND_STATUSES: readonly string[] = ["completed", "stopped", "suspended", "failed", "aborted", "succeeded", "denied"];

/**
 * A command reports its own outcome in the result: a `status` from the run vocabulary or `ok: false`.
 * The result itself is never persisted (it can hold note ids or text), only the status.
 */
function commandStatus(result: unknown): SchedulerFiring["status"] {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return "completed";
  const value = (result as { status?: unknown; ok?: unknown }).status;
  if (typeof value === "string" && COMMAND_STATUSES.includes(value)) return value as RunResultStatus;
  return (result as { ok?: unknown }).ok === false ? "failed" : "completed";
}

export async function runFiring(
  target: SchedulerTarget,
  input: string | JsonObject,
  parentId: string,
  firingId: string,
): Promise<SchedulerFiring> {
  const base = { firingId };
  const session = await target.agent.session(
    target.kind === "agent" ? { parent: { sessionId: parentId, agentId: target.agent.id } } : { id: parentId },
  );
  try {
    if (target.kind === "agent") {
      const result = await session.run(input as string, target.runOptions);
      return { ...base, sessionId: session.id, status: result.status };
    }
    if (target.kind === "command") {
      // No model call: the command runs on the schedule session, which is already durable.
      const result = await target.agent.commands.run(target.command, input as JsonObject, { session });
      return { ...base, sessionId: session.id, status: commandStatus(result) };
    }
    const result = (await target.agent.commands.run(target.command, input as JsonObject, { session })) as {
      workflowRunId?: unknown;
      status?: unknown;
    };
    if (
      !result ||
      typeof result.workflowRunId !== "string" ||
      !result.workflowRunId ||
      !["succeeded", "failed", "aborted", "suspended", "denied"].includes(result.status as string)
    )
      throw new HeadlessError("invalid_workflow_result");
    return { ...base, workflowRunId: result.workflowRunId, status: result.status as SchedulerFiring["status"] };
  } catch {
    // Persist status only; arbitrary target errors can contain secrets or input values.
    return { ...base, ...(target.kind === "agent" || target.kind === "command" ? { sessionId: session.id } : {}), status: "failed" };
  } finally {
    await session.close();
  }
}
