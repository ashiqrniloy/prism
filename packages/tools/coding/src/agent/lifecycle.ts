/**
 * Coding lifecycle limits and the consumer-gated emitter (Phase 10 Task 1 freeze).
 *
 * The event vocabulary itself is `./lifecycle-events.js`; this module owns the byte/count caps and
 * the emitter that enforces them, and re-exports the vocabulary so existing imports keep working.
 */
import type { CodingLifecycleEvent } from "./lifecycle-events.js";
import { validateCodingLimit } from "./limits.js";

export type {
  CodingLifecycleEvent,
  ConfigurationChangedEvent,
  FileChangedEvent,
  FileChangeOp,
  PermissionDeniedEvent,
  PlanChangedEvent,
  PlanRemovedEvent,
  SubagentFailure,
  SubagentRecovery,
  SubagentRecoveryOutcome,
  SubagentStartedEvent,
  SubagentStoppedEvent,
  WorktreeChangedEvent,
} from "./lifecycle-events.js";

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

/** Frozen shipped kinds: the six CodingProcessEvent kinds plus supported coding lifecycle kinds. */
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
  "subagent_started",
  "subagent_stopped",
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
      for (const listener of [...listeners]) {
        // A consumer that throws must not break the producer's success path (a worktree or file is
        // already changed by the time we get here); the rest of the listeners still receive it.
        try {
          listener(event);
        } catch {
          // swallowed on purpose: telemetry never fails the operation that produced it
        }
      }
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
