import { SupervisorValidationError } from "./errors.js";

export const DEFAULT_MAX_DELEGATION_DEPTH = 4;
export const HARD_MAX_DELEGATION_DEPTH = 16;
export const DEFAULT_MAX_ACTIVE_CHILDREN = 4;
export const HARD_MAX_ACTIVE_CHILDREN = 32;
export const DEFAULT_MAX_DELEGATION_BYTES = 64 * 1024;
export const HARD_MAX_DELEGATION_BYTES = 1024 * 1024;
export const DEFAULT_MAX_DELEGATION_STEPS = 8;
export const HARD_MAX_DELEGATION_STEPS = 64;
export const DEFAULT_MAX_DELEGATION_TOOL_CALLS = 32;
export const HARD_MAX_DELEGATION_TOOL_CALLS = 256;
export const DEFAULT_MAX_DELEGATION_TOKENS = 20_000;
export const HARD_MAX_DELEGATION_TOKENS = 1_000_000;
export const DEFAULT_DELEGATION_TIMEOUT_MS = 60_000;
export const HARD_DELEGATION_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_MAX_SUPERVISOR_QUEUED_EVENTS = 128;
export const HARD_MAX_SUPERVISOR_QUEUED_EVENTS = 4096;

export interface SupervisorLimits {
  readonly maxDepth?: number;
  readonly maxActiveChildren?: number;
  readonly maxMessageBytes?: number;
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxQueuedEvents?: number;
}

export interface ResolvedSupervisorLimits {
  readonly maxDepth: number;
  readonly maxActiveChildren: number;
  readonly maxMessageBytes: number;
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxQueuedEvents: number;
}

const SPECS = {
  maxDepth: [DEFAULT_MAX_DELEGATION_DEPTH, HARD_MAX_DELEGATION_DEPTH],
  maxActiveChildren: [DEFAULT_MAX_ACTIVE_CHILDREN, HARD_MAX_ACTIVE_CHILDREN],
  maxMessageBytes: [DEFAULT_MAX_DELEGATION_BYTES, HARD_MAX_DELEGATION_BYTES],
  maxSteps: [DEFAULT_MAX_DELEGATION_STEPS, HARD_MAX_DELEGATION_STEPS],
  maxToolCalls: [DEFAULT_MAX_DELEGATION_TOOL_CALLS, HARD_MAX_DELEGATION_TOOL_CALLS],
  maxTokens: [DEFAULT_MAX_DELEGATION_TOKENS, HARD_MAX_DELEGATION_TOKENS],
  timeoutMs: [DEFAULT_DELEGATION_TIMEOUT_MS, HARD_DELEGATION_TIMEOUT_MS],
  maxQueuedEvents: [DEFAULT_MAX_SUPERVISOR_QUEUED_EVENTS, HARD_MAX_SUPERVISOR_QUEUED_EVENTS],
} as const;

export function resolveSupervisorLimits(input: SupervisorLimits = {}): ResolvedSupervisorLimits {
  return Object.fromEntries(Object.entries(SPECS).map(([key, [fallback, hard]]) => {
    const value = input[key as keyof SupervisorLimits] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > hard) throw new SupervisorValidationError(`${key} must be a positive integer at most ${hard}`);
    return [key, value];
  })) as unknown as ResolvedSupervisorLimits;
}

export function narrowSupervisorLimits(parent: ResolvedSupervisorLimits, input?: SupervisorLimits): ResolvedSupervisorLimits {
  if (!input) return parent;
  const requested = resolveSupervisorLimits({ ...parent, ...input });
  return Object.fromEntries(Object.keys(SPECS).map((key) => [key, Math.min(parent[key as keyof ResolvedSupervisorLimits], requested[key as keyof ResolvedSupervisorLimits])])) as unknown as ResolvedSupervisorLimits;
}
