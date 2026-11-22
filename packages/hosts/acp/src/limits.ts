import { AcpError } from "./errors.js";

/** Defaults copied from `packages/ag-ui/src/limits.ts`. The host sets each (`serveAcp({ limits })`); its value is the cap. */
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
  const minimum = name.endsWith("Bytes") ? (name === "maxTextBytes" ? 16 : 1024) : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `${name} must be a safe integer of at least ${minimum}`);
  }
  return value;
}
