/**
 * Per-node suspensions. A run holds one descriptor per suspended node; a `workflowNode` whose child run is
 * suspended holds one per child suspension, under the child-qualified id `<node>/<child id>`.
 */
import { WorkflowCheckpointError } from "../errors.js";
import type { WorkflowDefinition, WorkflowSuspensionDescriptor } from "../types.js";

/** Separates a `workflowNode` id from the id of a suspension inside its child run. */
export const SUSPENSION_PATH_SEPARATOR = "/";

/**
 * The pending suspensions a checkpoint or result holds, in request order. A checkpoint written before
 * per-node suspensions has only `suspension`; it reads as one entry.
 */
export function readSuspensions(value: {
  readonly suspension?: WorkflowSuspensionDescriptor;
  readonly suspensions?: Readonly<Record<string, WorkflowSuspensionDescriptor>>;
}): Map<string, WorkflowSuspensionDescriptor> {
  if (value.suspensions) return new Map(Object.entries(value.suspensions));
  return value.suspension ? new Map([[value.suspension.nodeId, value.suspension]]) : new Map();
}

/** The record form a checkpoint and a result carry; `undefined` when nothing is pending. */
export function suspensionsRecord(
  suspensions: ReadonlyMap<string, WorkflowSuspensionDescriptor>,
): Readonly<Record<string, WorkflowSuspensionDescriptor>> | undefined {
  return suspensions.size === 0 ? undefined : Object.fromEntries(suspensions);
}

/** The first pending suspension: the deprecated single `suspension` field. */
export function firstSuspension(suspensions: ReadonlyMap<string, WorkflowSuspensionDescriptor>): WorkflowSuspensionDescriptor | undefined {
  return suspensions.values().next().value;
}

/**
 * The node of `workflow` that owns suspension `id`, and the id inside its child run for a nested one.
 * A node id wins over a nested path, so a node id that itself contains the separator still resolves.
 */
export function suspensionOwner(
  workflow: WorkflowDefinition,
  id: string,
): { readonly nodeId: string; readonly child?: string } | undefined {
  if (workflow.nodes[id] !== undefined) return { nodeId: id };
  let owner: string | undefined;
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.kind !== "workflow" || !id.startsWith(`${nodeId}${SUSPENSION_PATH_SEPARATOR}`)) continue;
    if (owner === undefined || nodeId.length > owner.length) owner = nodeId;
  }
  return owner === undefined ? undefined : { nodeId: owner, child: id.slice(owner.length + SUSPENSION_PATH_SEPARATOR.length) };
}

/** Drops every pending suspension `nodeId` owns: its own, and its child run's qualified ones. */
export function clearOwnedSuspensions(
  workflow: WorkflowDefinition,
  suspensions: Map<string, WorkflowSuspensionDescriptor>,
  nodeId: string,
): void {
  for (const id of [...suspensions.keys()]) if (suspensionOwner(workflow, id)?.nodeId === nodeId) suspensions.delete(id);
}

/** The suspension a resume releases: the named one, or the only one pending. */
export function selectResumeTarget(
  suspensions: ReadonlyMap<string, WorkflowSuspensionDescriptor>,
  nodeId: string | undefined,
): WorkflowSuspensionDescriptor {
  if (nodeId !== undefined) {
    const named = suspensions.get(nodeId);
    if (!named) {
      throw new WorkflowCheckpointError(
        `No pending suspension for node "${nodeId}"; pending: ${[...suspensions.keys()].join(", ") || "none"}`,
      );
    }
    return named;
  }
  if (suspensions.size !== 1) {
    throw new WorkflowCheckpointError(
      `${suspensions.size} suspensions are pending (${[...suspensions.keys()].join(", ")}); name one with resume.nodeId`,
    );
  }
  const only = firstSuspension(suspensions);
  if (only === undefined) throw new WorkflowCheckpointError("No suspension is pending");
  return only;
}
