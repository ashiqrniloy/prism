import { A2AConfigError } from "./errors.js";

/** Defaults. The host sets each (`limits`); its value is the cap (plan 239 Task 5). Starting point: 0.12's caps. */
export const A2A_LIMITS = {
  /** Bytes of one JSON-RPC request body. */
  maxRequestBytes: 64 * 1024,
  /** Bytes of one non-streaming JSON-RPC response body. */
  maxResponseBytes: 1024 * 1024,
  /** Bytes of one SSE response. */
  maxStreamBytes: 10 * 1024 * 1024,
  /** Frames on one SSE response. */
  maxStreamEvents: 10_000,
  /** Wall-clock length of one SSE response; the task keeps running and can be resubscribed. */
  maxStreamMs: 120_000,
  /** Wall-clock length of one task segment (a run or a resume); past it the run is aborted and the task fails. */
  taskTimeoutMs: 120_000,
  /** `TASK_STATE_WORKING` tasks one principal may hold at once. */
  maxConcurrentTasks: 16,
  /** Tasks the in-process registry keeps; the oldest settled one is evicted first. */
  maxTasks: 1_024,
  /** Contexts (open sessions) kept at once; the least recently used idle one is closed first. */
  maxContexts: 256,
  /** Parts in one inbound message. */
  maxParts: 32,
  /** Messages a `GetTask` `historyLength` may return. */
  maxHistory: 100,
} as const;

export type A2ALimitName = keyof typeof A2A_LIMITS;
export type A2ALimitOptions = { readonly [K in A2ALimitName]?: number };
export type ResolvedA2ALimits = { readonly [K in A2ALimitName]: number };

export function resolveA2ALimits(options: A2ALimitOptions = {}): ResolvedA2ALimits {
  const resolved = {} as Record<A2ALimitName, number>;
  for (const name of Object.keys(A2A_LIMITS) as A2ALimitName[]) {
    const value = options[name] ?? A2A_LIMITS[name];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new A2AConfigError(`limits.${name} must be a positive safe integer`);
    }
    resolved[name] = value;
  }
  return resolved;
}
