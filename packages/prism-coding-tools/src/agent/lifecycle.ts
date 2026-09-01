/**
 * Consumer-gated coding lifecycle events (Phase 10 Task 1 freeze).
 *
 * Ships only event kinds with a consumer in 0.0.27 (ACP mapper and/or host
 * `CodingLifecycleEmitter` callback). Deferred kinds — check_started/finished,
 * task_created/completed, compaction_started/finished, subagent_started/stopped —
 * MUST NOT be added here until a consumer exists
 * (scripts/phase10-freeze-manifest.json lifecycle.deferredEvents).
 */
import { validateCodingLimit } from "./limits.js";
import type { CodingProcessEvent } from "./process/types.js";

export type FileChangeOp = "write" | "edit" | "delete" | "move";

export interface FileChangedEvent {
  readonly type: "file_changed";
  /** Workspace-relative or policy-checked absolute path. Never a raw file body. */
  readonly path: string;
  readonly op: FileChangeOp;
  readonly toolCallId?: string;
}

export interface WorktreeChangedEvent {
  readonly type: "worktree_changed";
  readonly action: "add" | "remove";
  readonly path: string;
  readonly toolCallId?: string;
}

export interface PermissionDeniedEvent {
  readonly type: "permission_denied";
  /** Policy decision reason. Never includes raw tool arguments. */
  readonly reason: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly approvalId?: string;
}

export interface ConfigurationChangedEvent {
  readonly type: "configuration_changed";
  /** Changed config keys only; values never travel in the event. */
  readonly keys: readonly string[];
}

export interface PlanChangedEvent {
  readonly type: "plan_changed";
  /** Workspace-relative plan path; doubles as the plan id on the ACP wire. */
  readonly planPath: string;
  /** Complete todo list at this point (same shape as `CodingTodoItem`). */
  readonly todos: readonly { readonly id: string; readonly text: string; readonly done: boolean }[];
}

export interface PlanRemovedEvent {
  readonly type: "plan_removed";
  /** Workspace-relative plan path; doubles as the plan id on the ACP wire. */
  readonly planPath: string;
}

export type CodingLifecycleEvent =
  | CodingProcessEvent
  | FileChangedEvent
  | WorktreeChangedEvent
  | PermissionDeniedEvent
  | ConfigurationChangedEvent
  | PlanChangedEvent
  | PlanRemovedEvent;

export const DEFAULT_LIFECYCLE_MAX_EVENT_BYTES = 16_384;
export const HARD_LIFECYCLE_MAX_EVENT_BYTES = 65_536;
export const DEFAULT_LIFECYCLE_MAX_PATH_BYTES = 4_096;
export const HARD_LIFECYCLE_MAX_PATH_BYTES = 16_384;
export const DEFAULT_LIFECYCLE_MAX_REASON_BYTES = 1_024;
export const HARD_LIFECYCLE_MAX_REASON_BYTES = 16_384;
export const DEFAULT_LIFECYCLE_MAX_TOOL_NAME_BYTES = 256;
export const HARD_LIFECYCLE_MAX_TOOL_NAME_BYTES = 4_096;
export const DEFAULT_LIFECYCLE_MAX_CONFIG_KEYS = 64;
export const HARD_LIFECYCLE_MAX_CONFIG_KEYS = 256;

export interface CodingLifecycleLimits {
  readonly maxEventBytes?: number;
  readonly maxPathBytes?: number;
  readonly maxReasonBytes?: number;
  readonly maxToolNameBytes?: number;
  readonly maxConfigKeys?: number;
}

export interface ResolvedCodingLifecycleLimits {
  readonly maxEventBytes: number;
  readonly maxPathBytes: number;
  readonly maxReasonBytes: number;
  readonly maxToolNameBytes: number;
  readonly maxConfigKeys: number;
}

export class CodingLifecycleError extends Error {
  readonly code = "ERR_PRISM_LIFECYCLE_LIMIT";
  constructor(message: string) {
    super(message);
    this.name = "CodingLifecycleError";
  }
}

function validate(name: string, value: number, hard: number): number {
  try {
    return validateCodingLimit(name, value, hard);
  } catch (error) {
    throw new CodingLifecycleError(error instanceof Error ? error.message : String(error));
  }
}

export function resolveCodingLifecycleLimits(limits?: CodingLifecycleLimits): ResolvedCodingLifecycleLimits {
  return {
    maxEventBytes: validate("maxEventBytes", limits?.maxEventBytes ?? DEFAULT_LIFECYCLE_MAX_EVENT_BYTES, HARD_LIFECYCLE_MAX_EVENT_BYTES),
    maxPathBytes: validate("maxPathBytes", limits?.maxPathBytes ?? DEFAULT_LIFECYCLE_MAX_PATH_BYTES, HARD_LIFECYCLE_MAX_PATH_BYTES),
    maxReasonBytes: validate(
      "maxReasonBytes",
      limits?.maxReasonBytes ?? DEFAULT_LIFECYCLE_MAX_REASON_BYTES,
      HARD_LIFECYCLE_MAX_REASON_BYTES,
    ),
    maxToolNameBytes: validate(
      "maxToolNameBytes",
      limits?.maxToolNameBytes ?? DEFAULT_LIFECYCLE_MAX_TOOL_NAME_BYTES,
      HARD_LIFECYCLE_MAX_TOOL_NAME_BYTES,
    ),
    maxConfigKeys: validate("maxConfigKeys", limits?.maxConfigKeys ?? DEFAULT_LIFECYCLE_MAX_CONFIG_KEYS, HARD_LIFECYCLE_MAX_CONFIG_KEYS),
  };
}

/** Frozen shipped kinds: the six CodingProcessEvent kinds plus the four new kinds. */
const FROZEN_EVENT_TYPES = new Set<string>([
  "process_started",
  "process_exited",
  "process_killed",
  "process_released",
  "process_expired",
  "process_unknown",
  "file_changed",
  "worktree_changed",
  "permission_denied",
  "configuration_changed",
  "plan_changed",
  "plan_removed",
]);

export interface CodingLifecycleEmitter {
  /**
   * Delivers the event to every registered listener. Returns true when at least one
   * listener received it. Drops (returns false) without throwing for unknown kinds,
   * oversized events, or when no listener is registered, so producer success paths
   * never break on telemetry.
   */
  emit(event: CodingLifecycleEvent): boolean;
  /** Registers a listener; the returned function unregisters it. */
  on(listener: (event: CodingLifecycleEvent) => void): () => void;
}

export interface CreateCodingLifecycleEmitterOptions {
  readonly limits?: CodingLifecycleLimits;
  /** Convenience initial listener, equivalent to `on`. */
  readonly onEvent?: (event: CodingLifecycleEvent) => void;
}

export function createCodingLifecycleEmitter(options: CreateCodingLifecycleEmitterOptions = {}): CodingLifecycleEmitter {
  const limits = resolveCodingLifecycleLimits(options.limits);
  const listeners = new Set<(event: CodingLifecycleEvent) => void>();
  if (options.onEvent) listeners.add(options.onEvent);

  return {
    emit(event) {
      if (!event || typeof event !== "object" || !FROZEN_EVENT_TYPES.has(event.type)) return false;
      if (Buffer.byteLength(JSON.stringify(event), "utf8") > limits.maxEventBytes) return false;
      switch (event.type) {
        case "file_changed":
        case "worktree_changed":
          if (Buffer.byteLength(event.path, "utf8") > limits.maxPathBytes) return false;
          break;
        case "permission_denied":
          if (Buffer.byteLength(event.reason, "utf8") > limits.maxReasonBytes) return false;
          if (Buffer.byteLength(event.toolName, "utf8") > limits.maxToolNameBytes) return false;
          break;
        case "configuration_changed":
          if (event.keys.length > limits.maxConfigKeys) return false;
          break;
        default:
          break;
      }
      if (listeners.size === 0) return false;
      for (const listener of [...listeners]) listener(event);
      return true;
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
