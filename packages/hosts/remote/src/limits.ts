import { RemoteError } from "./errors.js";

/** Defaults. The host sets each (`limits`); its value is the cap (plan 239 Task 5). */
export const REMOTE_LIMITS = {
  maxFrameBytes: 1024 * 1024,
  maxConnections: 64,
  keepAliveMs: 15_000,
  maxConcurrentRequests: 16,
  maxPendingRequests: 64,
  maxQueuedEvents: 1_000,
} as const;

export type RemoteLimitName = keyof typeof REMOTE_LIMITS;

export type RemoteLimitOptions = { readonly [K in RemoteLimitName]?: number };

export type ResolvedRemoteLimits = { readonly [K in RemoteLimitName]: number };

export function resolveRemoteLimits(options: RemoteLimitOptions = {}): ResolvedRemoteLimits {
  const resolved = {} as Record<RemoteLimitName, number>;
  for (const name of Object.keys(REMOTE_LIMITS) as RemoteLimitName[]) {
    resolved[name] = validate(name, options[name] ?? REMOTE_LIMITS[name]);
  }
  return resolved;
}

function validate(name: RemoteLimitName, value: number): number {
  const minimum = name === "maxFrameBytes" ? 1024 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RemoteError("limit", `${name} must be a safe integer of at least ${minimum}`);
  }
  return value;
}
