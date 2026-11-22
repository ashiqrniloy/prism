/** Finite defaults for the disposable Docker sandbox reference. The host sets each; its value is the cap (plan 239 Task 5). */

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_WALL_TIME_MS = 20 * 60_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

export const DEFAULT_CPUS = 2;
export const DEFAULT_MEMORY_BYTES = 2 * 1024 ** 3;
export const DEFAULT_MAX_PIDS = 256;
export const DEFAULT_MAX_FDS = 1_024;

export const DEFAULT_WORKSPACE_BYTES = 1024 ** 3;
export const DEFAULT_TMP_BYTES = 256 * 1024 ** 2;
export const DEFAULT_DOWNLOAD_BYTES = 64 * 1024 ** 2;

export const DEFAULT_MAX_COMMANDS = 100;
export const DEFAULT_MAX_CONCURRENT_EXECS = 1;

export const DEFAULT_MAX_ENV_NAMES = 64;
export const DEFAULT_MAX_ENV_BYTES = 64 * 1024;

export const DEFAULT_MAX_EXPORT_ENTRIES = 50_000;
export const DEFAULT_MAX_EXPORT_BYTES = 256 * 1024 ** 2;
export const DEFAULT_MAX_RETAINED_ARTIFACTS = 16;

export const DEFAULT_STOP_GRACE_MS = 5_000;
export const DEFAULT_CLEANUP_DEADLINE_MS = 30_000;

export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface DockerSandboxLimitOptions {
  readonly startupTimeoutMs?: number;
  readonly wallTimeMs?: number;
  readonly idleTimeoutMs?: number;
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly maxPids?: number;
  readonly maxFds?: number;
  readonly workspaceBytes?: number;
  readonly tmpBytes?: number;
  readonly downloadBytes?: number;
  readonly maxCommands?: number;
  readonly maxConcurrentExecs?: number;
  readonly maxEnvNames?: number;
  readonly maxEnvBytes?: number;
  readonly maxExportEntries?: number;
  readonly maxExportBytes?: number;
  readonly maxRetainedArtifacts?: number;
  readonly stopGraceMs?: number;
  readonly cleanupDeadlineMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ResolvedDockerSandboxLimits {
  readonly startupTimeoutMs: number;
  readonly wallTimeMs: number;
  readonly idleTimeoutMs: number;
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly maxPids: number;
  readonly maxFds: number;
  readonly workspaceBytes: number;
  readonly tmpBytes: number;
  readonly downloadBytes: number;
  readonly maxCommands: number;
  readonly maxConcurrentExecs: number;
  readonly maxEnvNames: number;
  readonly maxEnvBytes: number;
  readonly maxExportEntries: number;
  readonly maxExportBytes: number;
  readonly maxRetainedArtifacts: number;
  readonly stopGraceMs: number;
  readonly cleanupDeadlineMs: number;
  readonly maxOutputBytes: number;
}

const SPECS = {
  startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
  wallTimeMs: DEFAULT_WALL_TIME_MS,
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  memoryBytes: DEFAULT_MEMORY_BYTES,
  maxPids: DEFAULT_MAX_PIDS,
  maxFds: DEFAULT_MAX_FDS,
  workspaceBytes: DEFAULT_WORKSPACE_BYTES,
  tmpBytes: DEFAULT_TMP_BYTES,
  downloadBytes: DEFAULT_DOWNLOAD_BYTES,
  maxCommands: DEFAULT_MAX_COMMANDS,
  maxConcurrentExecs: DEFAULT_MAX_CONCURRENT_EXECS,
  maxEnvNames: DEFAULT_MAX_ENV_NAMES,
  maxEnvBytes: DEFAULT_MAX_ENV_BYTES,
  maxExportEntries: DEFAULT_MAX_EXPORT_ENTRIES,
  maxExportBytes: DEFAULT_MAX_EXPORT_BYTES,
  maxRetainedArtifacts: DEFAULT_MAX_RETAINED_ARTIFACTS,
  stopGraceMs: DEFAULT_STOP_GRACE_MS,
  cleanupDeadlineMs: DEFAULT_CLEANUP_DEADLINE_MS,
  maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
} as const;

export function validateSandboxLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function validateCpus(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("cpus must be a finite number greater than 0");
  }
  return value;
}

export function resolveDockerSandboxLimits(input: DockerSandboxLimitOptions = {}): ResolvedDockerSandboxLimits {
  const resolved = Object.fromEntries(
    Object.entries(SPECS).map(([name, fallback]) => {
      const value = input[name as keyof DockerSandboxLimitOptions] ?? fallback;
      return [name, validateSandboxLimit(name, value as number)];
    }),
  ) as Omit<ResolvedDockerSandboxLimits, "cpus">;

  return {
    ...resolved,
    cpus: validateCpus(input.cpus ?? DEFAULT_CPUS),
  };
}
