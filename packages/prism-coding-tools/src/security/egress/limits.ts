/** Frozen finite caps for the allow-list egress proxy. */

export const DEFAULT_MAX_EGRESS_CONCURRENT_CONNECTIONS = 32;
export const HARD_MAX_EGRESS_CONCURRENT_CONNECTIONS = 256;
export const DEFAULT_MAX_EGRESS_REQUEST_BYTES = 64 * 1024 ** 2;
export const HARD_MAX_EGRESS_REQUEST_BYTES = 1024 ** 3;
export const DEFAULT_MAX_EGRESS_RESPONSE_BYTES = 64 * 1024 ** 2;
export const HARD_MAX_EGRESS_RESPONSE_BYTES = 1024 ** 3;
export const DEFAULT_MAX_EGRESS_TRANSFER_TIME_MS = 600_000;
export const HARD_MAX_EGRESS_TRANSFER_TIME_MS = 3_600_000;
export const DEFAULT_MAX_EGRESS_RULES = 128;
export const HARD_MAX_EGRESS_RULES = 1_024;
export const DEFAULT_MAX_EGRESS_REDIRECT_HOPS = 5;
export const HARD_MAX_EGRESS_REDIRECT_HOPS = 10;

export interface EgressLimitOptions {
  readonly concurrentConnections?: number;
  readonly requestBytes?: number;
  readonly responseBytes?: number;
  readonly transferTimeMs?: number;
  readonly rulesPerPolicy?: number;
  readonly redirectHops?: number;
}

export interface ResolvedEgressLimits {
  readonly concurrentConnections: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly transferTimeMs: number;
  readonly rulesPerPolicy: number;
  readonly redirectHops: number;
}

const SPECS: Record<keyof ResolvedEgressLimits, readonly [number, number]> = {
  concurrentConnections: [DEFAULT_MAX_EGRESS_CONCURRENT_CONNECTIONS, HARD_MAX_EGRESS_CONCURRENT_CONNECTIONS],
  requestBytes: [DEFAULT_MAX_EGRESS_REQUEST_BYTES, HARD_MAX_EGRESS_REQUEST_BYTES],
  responseBytes: [DEFAULT_MAX_EGRESS_RESPONSE_BYTES, HARD_MAX_EGRESS_RESPONSE_BYTES],
  transferTimeMs: [DEFAULT_MAX_EGRESS_TRANSFER_TIME_MS, HARD_MAX_EGRESS_TRANSFER_TIME_MS],
  rulesPerPolicy: [DEFAULT_MAX_EGRESS_RULES, HARD_MAX_EGRESS_RULES],
  redirectHops: [DEFAULT_MAX_EGRESS_REDIRECT_HOPS, HARD_MAX_EGRESS_REDIRECT_HOPS],
};

function validateEgressLimit(name: keyof ResolvedEgressLimits, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new RangeError(`${name} must be a positive safe integer at most ${hardCap}`);
  }
  return value;
}

export function resolveEgressLimits(input: EgressLimitOptions = {}): ResolvedEgressLimits {
  return Object.fromEntries(
    Object.entries(SPECS).map(([name, [fallback, hardCap]]) => {
      const value = input[name as keyof EgressLimitOptions] ?? fallback;
      return [name, validateEgressLimit(name as keyof ResolvedEgressLimits, value as number, hardCap)];
    }),
  ) as unknown as ResolvedEgressLimits;
}
