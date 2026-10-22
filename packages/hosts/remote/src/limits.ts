import { RemoteError } from "./errors.js";

/** Defaults. A host may narrow them, never raise them past the hard maxima. */
export const REMOTE_LIMITS = {
  maxFrameBytes: 1024 * 1024,
  maxConnections: 64,
  keepAliveMs: 15_000,
  maxConcurrentRequests: 16,
  maxPendingRequests: 64,
  maxQueuedEvents: 1_000,
} as const;

const HARD = {
  maxFrameBytes: 16 * 1024 * 1024,
  maxConnections: 1_024,
  keepAliveMs: 60_000,
  maxConcurrentRequests: 256,
  maxPendingRequests: 1_024,
  maxQueuedEvents: 100_000,
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
  const hard = HARD[name];
  const minimum = name === "maxFrameBytes" ? 1024 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > hard) {
    throw new RemoteError("limit", `${name} must be a safe integer from ${minimum} through ${hard}`);
  }
  return value;
}
