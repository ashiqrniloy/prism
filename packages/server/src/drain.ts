import { DEFAULT_DRAIN_DEADLINE_MS, HARD_DRAIN_DEADLINE_MS, resolvePrismDeploymentLimits } from "./limits.js";
import { PrismServerError } from "./types.js";

export interface PrismDrainControllerOptions {
  /** Admit cutoff / host exit budget after `beginDrain`. Default 30s, hard 5 min. */
  readonly deadlineMs?: number;
}

export interface PrismDrainSnapshot {
  readonly status: "serving" | "draining";
  readonly draining: boolean;
  readonly startedAt?: string;
  readonly deadlineAt?: string;
  readonly deadlineMs: number;
}

export interface PrismDrainController {
  readonly isDraining: boolean;
  beginDrain(options?: { readonly deadlineMs?: number }): PrismDrainSnapshot;
  /** Rejects new admits while draining (503). Control-plane reads may skip this. */
  assertAdmit(): void;
  snapshot(): PrismDrainSnapshot;
}

export function createPrismDrainController(options: PrismDrainControllerOptions = {}): PrismDrainController {
  const defaults = resolvePrismDeploymentLimits({ drainDeadlineMs: options.deadlineMs });
  let draining = false;
  let startedAt: string | undefined;
  let deadlineAt: string | undefined;
  let deadlineMs = defaults.drainDeadlineMs;

  return {
    get isDraining() {
      return draining;
    },
    beginDrain(input) {
      if (!draining) {
        draining = true;
        startedAt = new Date().toISOString();
        deadlineMs = resolveDeadline(input?.deadlineMs ?? options.deadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS);
        deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
      }
      return this.snapshot();
    },
    assertAdmit() {
      if (draining) {
        throw new PrismServerError("Server is draining", 503, "ERR_PRISM_SERVER_DRAINING");
      }
    },
    snapshot() {
      return {
        status: draining ? "draining" : "serving",
        draining,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
        deadlineMs,
      };
    },
  };
}

function resolveDeadline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_DRAIN_DEADLINE_MS) {
    throw new RangeError(`drainDeadlineMs must be a positive safe integer <= ${HARD_DRAIN_DEADLINE_MS}`);
  }
  return value;
}

/** Operations that create or continue work; blocked during drain. Status/cancel/list remain open. */
export function isAdmitOperation(operation: string): boolean {
  return (
    operation === "agent.run" ||
    operation === "agent.stream" ||
    operation === "agent.resume" ||
    operation === "workflow.run" ||
    operation === "workflow.stream" ||
    operation === "workflow.enqueue" ||
    operation === "workflow.resume" ||
    operation === "workflow.replay" ||
    operation === "schedule.create" ||
    operation === "schedule.trigger"
  );
}
