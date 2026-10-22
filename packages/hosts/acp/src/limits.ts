import { AcpError } from "./errors.js";

/** Defaults copied from `packages/ag-ui/src/limits.ts`. A host may narrow them, never raise them. */
export const ACP_LIMITS = {
  maxEventBytes: 64 * 1024,
  maxTextBytes: 64 * 1024,
  maxReplayEvents: 100,
  maxStreamEvents: 10_000,
  maxStreamBytes: 10 * 1024 * 1024,
  acpDiffBytes: 64 * 1024,
  acpLocationsPerUpdate: 32,
  acpImageBytes: 256 * 1024,
  acpCommandsPerUpdate: 32,
} as const;

const HARD = {
  maxEventBytes: 1024 * 1024,
  maxTextBytes: 1024 * 1024,
  maxReplayEvents: 500,
  maxStreamEvents: 100_000,
  maxStreamBytes: 64 * 1024 * 1024,
  acpDiffBytes: 1024 * 1024,
  acpLocationsPerUpdate: 128,
  acpImageBytes: 1024 * 1024,
  acpCommandsPerUpdate: 128,
} as const;

export type AcpLimitName = keyof typeof ACP_LIMITS;

export type AcpLimitOptions = { readonly [K in AcpLimitName]?: number };

export type ResolvedAcpLimits = { readonly [K in AcpLimitName]: number };

export function resolveAcpLimits(options: AcpLimitOptions = {}): ResolvedAcpLimits {
  const resolved = {} as Record<AcpLimitName, number>;
  for (const name of Object.keys(ACP_LIMITS) as AcpLimitName[]) {
    resolved[name] = validate(name, options[name] ?? ACP_LIMITS[name]);
  }
  return resolved;
}

function validate(name: AcpLimitName, value: number): number {
  const hard = HARD[name];
  const minimum = name.endsWith("Bytes") ? (name === "maxTextBytes" ? 16 : 1024) : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > hard) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `${name} must be a safe integer from ${minimum} through ${hard}`);
  }
  return value;
}
