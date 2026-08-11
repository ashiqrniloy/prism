import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { PassThrough } from "node:stream";
import { assertAbsoluteExecutable, createSecretRedactor } from "./docker-cli.js";
import { assertPathInsideRoots } from "./path-containment.js";
import type {
  DisposableSandbox,
  SandboxCloseOptions,
  SandboxExecFileRequest,
  SandboxExecRequest,
  SandboxExportMetadata,
  SandboxStatus,
  SandboxStatusState,
} from "./sandbox.js";
import {
  DEFAULT_CLEANUP_DEADLINE_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_COMMANDS,
  DEFAULT_MAX_CONCURRENT_EXECS,
  DEFAULT_MAX_ENV_BYTES,
  DEFAULT_MAX_ENV_NAMES,
  DEFAULT_MAX_EXPORT_BYTES,
  DEFAULT_MAX_EXPORT_ENTRIES,
  DEFAULT_MAX_FDS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_RETAINED_ARTIFACTS,
  DEFAULT_MEMORY_BYTES,
  DEFAULT_STOP_GRACE_MS,
  DEFAULT_WALL_TIME_MS,
  HARD_CLEANUP_DEADLINE_MS,
  HARD_IDLE_TIMEOUT_MS,
  HARD_MAX_COMMANDS,
  HARD_MAX_CONCURRENT_EXECS,
  HARD_MAX_ENV_BYTES,
  HARD_MAX_ENV_NAMES,
  HARD_MAX_EXPORT_BYTES,
  HARD_MAX_EXPORT_ENTRIES,
  HARD_MAX_FDS,
  HARD_MAX_OUTPUT_BYTES,
  HARD_MAX_RETAINED_ARTIFACTS,
  HARD_MEMORY_BYTES,
  HARD_STOP_GRACE_MS,
  HARD_WALL_TIME_MS,
  validateSandboxLimit,
} from "./sandbox-limits.js";
import { createImportTarStream, summarizeTarStream } from "./sandbox-tar.js";

/**
 * Network-free native sandbox backend (plan 018 Task 3).
 *
 * Linux-only, created via {@link createNativeSandbox}. Egress denial is a
 * fresh network namespace per command via the OS `unshare` binary; resource
 * limits are POSIX `ulimit` hard caps; path containment is cwd-in-root. No
 * container runtime, no shipped netns tooling, zero runtime dependencies.
 * Platforms/privileges that cannot create a netns fail closed at creation.
 */

export class NativeSandboxError extends Error {
  readonly code = "ERR_PRISM_NATIVE_SANDBOX";
  constructor(message: string) {
    super(message);
    this.name = "NativeSandboxError";
  }
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SH = "/bin/sh";
const WRAPPER_ARGV0 = "prism-native-sh";

export interface NativeSandboxLimitOptions {
  readonly wallTimeMs?: number;
  readonly idleTimeoutMs?: number;
  readonly memoryBytes?: number;
  readonly maxFds?: number;
  readonly maxCommands?: number;
  readonly maxConcurrentExecs?: number;
  readonly maxEnvNames?: number;
  readonly maxEnvBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxExportEntries?: number;
  readonly maxExportBytes?: number;
  readonly maxRetainedArtifacts?: number;
  readonly stopGraceMs?: number;
  readonly cleanupDeadlineMs?: number;
}

export interface ResolvedNativeSandboxLimits {
  readonly wallTimeMs: number;
  readonly idleTimeoutMs: number;
  readonly memoryBytes: number;
  readonly maxFds: number;
  readonly maxCommands: number;
  readonly maxConcurrentExecs: number;
  readonly maxEnvNames: number;
  readonly maxEnvBytes: number;
  readonly maxOutputBytes: number;
  readonly maxExportEntries: number;
  readonly maxExportBytes: number;
  readonly maxRetainedArtifacts: number;
  readonly stopGraceMs: number;
  readonly cleanupDeadlineMs: number;
}

const SPECS: Record<keyof NativeSandboxLimitOptions, [number, number]> = {
  wallTimeMs: [DEFAULT_WALL_TIME_MS, HARD_WALL_TIME_MS],
  idleTimeoutMs: [DEFAULT_IDLE_TIMEOUT_MS, HARD_IDLE_TIMEOUT_MS],
  memoryBytes: [DEFAULT_MEMORY_BYTES, HARD_MEMORY_BYTES],
  maxFds: [DEFAULT_MAX_FDS, HARD_MAX_FDS],
  maxCommands: [DEFAULT_MAX_COMMANDS, HARD_MAX_COMMANDS],
  maxConcurrentExecs: [DEFAULT_MAX_CONCURRENT_EXECS, HARD_MAX_CONCURRENT_EXECS],
  maxEnvNames: [DEFAULT_MAX_ENV_NAMES, HARD_MAX_ENV_NAMES],
  maxEnvBytes: [DEFAULT_MAX_ENV_BYTES, HARD_MAX_ENV_BYTES],
  maxOutputBytes: [DEFAULT_MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES],
  maxExportEntries: [DEFAULT_MAX_EXPORT_ENTRIES, HARD_MAX_EXPORT_ENTRIES],
  maxExportBytes: [DEFAULT_MAX_EXPORT_BYTES, HARD_MAX_EXPORT_BYTES],
  maxRetainedArtifacts: [DEFAULT_MAX_RETAINED_ARTIFACTS, HARD_MAX_RETAINED_ARTIFACTS],
  stopGraceMs: [DEFAULT_STOP_GRACE_MS, HARD_STOP_GRACE_MS],
  cleanupDeadlineMs: [DEFAULT_CLEANUP_DEADLINE_MS, HARD_CLEANUP_DEADLINE_MS],
};

export function resolveNativeSandboxLimits(input: NativeSandboxLimitOptions = {}): ResolvedNativeSandboxLimits {
  const resolved = {} as Record<keyof ResolvedNativeSandboxLimits, number>;
  for (const [name, [fallback, hardCap]] of Object.entries(SPECS)) {
    const value = input[name as keyof NativeSandboxLimitOptions] ?? fallback;
    resolved[name as keyof ResolvedNativeSandboxLimits] = validateSandboxLimit(name, value as number, hardCap);
  }
  return resolved as ResolvedNativeSandboxLimits;
}

export interface CreateNativeSandboxOptions {
  /** Absolute host directory that IS the sandbox workspace; cwd of every command defaults here. */
  readonly root: string;
  /** Absolute path to the `unshare` executable (default: resolved from PATH at creation). */
  readonly unshare?: string;
  readonly limits?: NativeSandboxLimitOptions;
  /** Exact environment allow-list for every command (host env is never inherited). */
  readonly env?: Readonly<Record<string, string>>;
  /** Secret canaries redacted from error text. */
  readonly secrets?: readonly string[];
}

/** Which `unshare` invocation granted the netns at creation (recorded once). */
export type NativeUnshareMode = "plain" | "maproot";

export interface NativeSpawnCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
}

/** Build the unshare + sh wrapper argv. @internal test helper (mirrors buildDockerCreateArgsForTest). */
export function buildNativeSpawnCommand(
  request: SandboxExecRequest | SandboxExecFileRequest,
  options: {
    readonly root: string;
    readonly unshare: string;
    readonly mode: NativeUnshareMode;
    readonly limits: ResolvedNativeSandboxLimits;
    readonly env: Readonly<Record<string, string>>;
  },
): NativeSpawnCommand {
  const modeFlags = options.mode === "plain" ? ["--net"] : ["--net", "--map-root-user"];
  // one ulimit per call: dash rejects multiple options in a single invocation
  const ulimit = [
    `ulimit -v ${Math.ceil(options.limits.memoryBytes / 1024)} || exit 126`,
    `ulimit -t ${Math.ceil(options.limits.wallTimeMs / 1000)} || exit 126`,
    `ulimit -n ${options.limits.maxFds} || exit 126`,
  ].join("; ");
  if ("command" in request) {
    return {
      file: options.unshare,
      args: [...modeFlags, SH, "-c", `${ulimit}; ${request.command}`, WRAPPER_ARGV0],
      env: { ...options.env },
      cwd: request.cwd,
    };
  }
  // execFile: file/args are argv to `exec "$@"` — never shell-interpolated.
  return {
    file: options.unshare,
    args: [...modeFlags, SH, "-c", `${ulimit}; exec "$@"`, WRAPPER_ARGV0, request.file, ...request.args],
    env: { ...options.env },
    cwd: request.cwd ?? options.root,
  };
}

function validateEnv(env: Readonly<Record<string, string>> | undefined, limits: ResolvedNativeSandboxLimits): Record<string, string> {
  const entries = Object.entries(env ?? {});
  if (entries.length > limits.maxEnvNames) {
    throw new NativeSandboxError(`env exceeds maxEnvNames (${limits.maxEnvNames})`);
  }
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!ENV_NAME_RE.test(name)) {
      throw new NativeSandboxError(`invalid env name: ${name}`);
    }
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > limits.maxEnvBytes) {
      throw new NativeSandboxError(`env exceeds maxEnvBytes (${limits.maxEnvBytes})`);
    }
    out[name] = value;
  }
  return out;
}

async function preflightUnshare(unshare: string): Promise<NativeUnshareMode> {
  for (const mode of ["plain", "maproot"] as const) {
    const args = mode === "plain" ? ["--net", "true"] : ["--net", "--map-root-user", "true"];
    try {
      const exitCode = await new Promise<number | null>((resolve) => {
        const child = spawn(unshare, args, { stdio: "ignore" });
        child.on("error", () => resolve(null));
        child.on("close", (code) => resolve(code));
      });
      if (exitCode === 0) return mode;
    } catch {
      // try next mode
    }
  }
  throw new NativeSandboxError(
    `network-free native sandbox unavailable: 'unshare' could not create a network namespace ` +
      `(need root/CAP_SYS_ADMIN or unprivileged user namespaces enabled). ` +
      `Refusing to create a network-enabled sandbox; use the Docker backend or grant netns privileges.`,
  );
}

interface NativeRunRequest {
  readonly command?: string;
  readonly file?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

class NativeSandboxSession implements DisposableSandbox {
  readonly id: string;
  private _lastExportIdentity: SandboxExportMetadata | undefined;
  private state: SandboxStatusState = "running";
  private commandCount = 0;
  private retainedArtifacts = 0;
  private readonly startedAt = Date.now();
  private lastActivityAt = Date.now();
  private readonly active = new Set<ChildProcess>();
  private readonly execLock: Semaphore;
  private readonly redact: (text: string) => string;
  private readonly closing: Promise<SandboxExportMetadata | undefined> | undefined;

  constructor(
    private readonly opts: {
      readonly root: string;
      readonly unshare: string;
      readonly mode: NativeUnshareMode;
      readonly limits: ResolvedNativeSandboxLimits;
      readonly env: Record<string, string>;
      readonly secrets: readonly string[];
    },
  ) {
    this.id = randomUUID();
    this.execLock = new Semaphore(opts.limits.maxConcurrentExecs);
    this.redact = createSecretRedactor(opts.secrets);
  }

  get lastExportIdentity(): SandboxExportMetadata | undefined {
    return this._lastExportIdentity;
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private remainingWallMs(): number {
    return Math.max(1, this.opts.limits.wallTimeMs - (Date.now() - this.startedAt));
  }

  private assertActive(): void {
    if (this.state !== "running") throw new NativeSandboxError(`sandbox is ${this.state}`);
    const now = Date.now();
    if (now - this.startedAt > this.opts.limits.wallTimeMs) {
      this.state = "failed";
      throw new NativeSandboxError("sandbox wall time exceeded");
    }
    if (now - this.lastActivityAt > this.opts.limits.idleTimeoutMs) {
      this.state = "failed";
      throw new NativeSandboxError("sandbox idle timeout exceeded");
    }
  }

  /** SIGKILL the whole process group (sh + command + grandchildren). */
  private groupKill(signal: NodeJS.Signals = "SIGKILL"): void {
    for (const child of this.active) {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        // already gone
      }
    }
  }

  private async waitActive(graceMs: number): Promise<void> {
    const deadline = Date.now() + graceMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (this.active.size > 0) this.groupKill("SIGKILL");
  }

  async status(): Promise<SandboxStatus> {
    return {
      id: this.id,
      state: this.state,
      image: "native:linux",
      startedAt: this.startedAt,
      commandCount: this.commandCount,
      lastActivityAt: this.lastActivityAt,
      ...(this._lastExportIdentity ? { lastExportIdentity: this._lastExportIdentity } : {}),
    };
  }

  async exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }> {
    return this.run({
      command: request.command,
      cwd: request.cwd,
      env: request.env,
      onData: request.onData,
      signal: request.signal,
      timeout: request.timeout,
    });
  }

  async execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }> {
    return this.run({
      file: request.file,
      args: request.args,
      cwd: request.cwd,
      env: request.env as NodeJS.ProcessEnv | undefined,
      onData: request.onData,
      signal: request.signal,
      timeout: request.timeout,
    });
  }

  private async run(request: NativeRunRequest): Promise<{ exitCode: number | null }> {
    this.assertActive();
    if (request.command !== undefined) {
      if (typeof request.command !== "string" || request.command.includes("\0")) {
        throw new NativeSandboxError("exec requires a command string without NUL");
      }
    } else {
      if (!request.file || request.file.includes("\0")) {
        throw new NativeSandboxError("execFile requires a non-empty file path without NUL");
      }
      if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== "string" || a.includes("\0"))) {
        throw new NativeSandboxError("execFile args must be a string array without NUL");
      }
    }
    if (this.commandCount >= this.opts.limits.maxCommands) {
      throw new NativeSandboxError(`sandbox exceeded maxCommands (${this.opts.limits.maxCommands})`);
    }
    const release = await this.execLock.acquire(request.signal);
    this.commandCount += 1;
    this.touch();
    try {
      this.assertActive();
      const cwd = request.cwd ?? this.opts.root;
      if (!isAbsolute(cwd) || !(await assertPathInsideRoots([this.opts.root], cwd))) {
        throw new NativeSandboxError("cwd must be an absolute path inside the sandbox root");
      }
      const extraEnv = validateEnv(request.env as Readonly<Record<string, string>> | undefined, this.opts.limits);
      const baseEnv = Object.keys(this.opts.env).length > 0 ? this.opts.env : { PATH: process.env.PATH ?? "/usr/bin:/bin" };
      const command = buildNativeSpawnCommand(
        request.command !== undefined ? { command: request.command, cwd } : { file: request.file!, args: request.args!, cwd },
        {
          root: this.opts.root,
          unshare: this.opts.unshare,
          mode: this.opts.mode,
          limits: this.opts.limits,
          env: { ...baseEnv, ...extraEnv },
        },
      );
      const timeoutMs = request.timeout !== undefined ? Math.min(request.timeout, this.remainingWallMs()) : this.remainingWallMs();
      const result = await this.spawnWithCaps(command, request, timeoutMs);
      this.touch();
      return { exitCode: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeSandboxError(this.redact(message));
    } finally {
      release();
    }
  }

  private spawnWithCaps(command: NativeSpawnCommand, request: NativeRunRequest, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let child: ChildProcess;
      try {
        // detached: true -> own process group; group kill covers sh + command + grandchildren
        child = spawn(command.file, [...command.args], {
          cwd: command.cwd,
          env: command.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
          windowsHide: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reject(new NativeSandboxError(message));
        return;
      }
      this.active.add(child);

      const finalize = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.active.delete(child);
        resolve(exitCode);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.active.delete(child);
        this.groupKill("SIGKILL");
        reject(error);
      };
      const noteBytes = (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > this.opts.limits.maxOutputBytes) {
          fail(new NativeSandboxError(`command output exceeded maxOutputBytes (${this.opts.limits.maxOutputBytes})`));
        }
      };
      const onAbort = () => {
        this.groupKill("SIGKILL");
      };
      const onTimeout = () => {
        this.groupKill("SIGTERM");
        setTimeout(() => this.groupKill("SIGKILL"), Math.min(this.opts.limits.stopGraceMs, 1000));
      };
      const timer = setTimeout(onTimeout, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners();
      };
      let outputBytes = 0;

      child.on("error", (error) => fail(error));
      child.on("close", (code) => finalize(code));
      request.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout?.on("data", (chunk: Buffer) => {
        noteBytes(chunk);
        request.onData?.(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        noteBytes(chunk);
        request.onData?.(chunk);
      });
    });
  }

  async stop(options?: { graceMs?: number; signal?: AbortSignal }): Promise<void> {
    if (this.state === "removed" || this.state === "stopped") return;
    const graceMs = Math.min(options?.graceMs ?? this.opts.limits.stopGraceMs, this.opts.limits.stopGraceMs);
    this.groupKill("SIGTERM");
    await this.waitActive(graceMs);
    if (this.active.size > 0) this.groupKill("SIGKILL");
    this.state = "stopped";
  }

  async kill(options?: { signal?: AbortSignal }): Promise<void> {
    if (this.state === "removed") return;
    this.groupKill("SIGKILL");
    this.state = "stopped";
  }

  private async exportWorkspace(write: NonNullable<SandboxCloseOptions["export"]>, signal?: AbortSignal): Promise<SandboxExportMetadata> {
    if (this.retainedArtifacts >= this.opts.limits.maxRetainedArtifacts) {
      throw new NativeSandboxError(`sandbox exceeded maxRetainedArtifacts (${this.opts.limits.maxRetainedArtifacts})`);
    }
    const bounds = {
      maxEntries: this.opts.limits.maxExportEntries,
      maxBytes: this.opts.limits.maxExportBytes,
    };
    const tee = new PassThrough();
    const summaryPromise = summarizeTarStream(tee, bounds);
    const hostStream = new PassThrough();
    tee.on("data", (chunk: Buffer) => hostStream.write(chunk));
    tee.on("end", () => hostStream.end());
    tee.on("error", (error) => hostStream.destroy(error));

    const run = (async () => {
      for await (const chunk of createImportTarStream(this.opts.root, bounds)) {
        if (signal?.aborted) throw new NativeSandboxError("sandbox export aborted");
        tee.write(chunk);
      }
      tee.end();
    })();
    try {
      const summary = await summaryPromise;
      await run;
      const metadata: SandboxExportMetadata = {
        sha256: summary.sha256,
        entryCount: summary.entryCount,
        byteCount: summary.byteCount,
        format: "tar",
      };
      await write(hostStream, metadata);
      this.retainedArtifacts += 1;
      this._lastExportIdentity = metadata;
      this.touch();
      return metadata;
    } catch (error) {
      hostStream.destroy(error instanceof Error ? error : new Error(String(error)));
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeSandboxError(this.redact(message));
    }
  }

  close(options?: SandboxCloseOptions): Promise<SandboxExportMetadata | undefined> {
    if (this.closing) return this.closing;
    return (async () => {
      let metadata: SandboxExportMetadata | undefined;
      try {
        if (options?.export && this.state === "running") {
          metadata = await this.exportWorkspace(options.export, options.signal);
        }
      } catch (error) {
        this.groupKill("SIGKILL");
        this.state = "removed";
        throw error;
      }
      this.groupKill("SIGTERM");
      await this.waitActive(this.opts.limits.stopGraceMs);
      if (this.active.size > 0) this.groupKill("SIGKILL");
      this.state = "removed";
      return metadata;
    })();
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new NativeSandboxError("sandbox operation aborted");
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new NativeSandboxError("sandbox operation aborted"));
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.active += 1;
    return () => this.release();
  }
  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

async function resolveUnsharePath(unshare: string | undefined): Promise<string> {
  if (unshare) {
    return await assertAbsoluteExecutable(unshare, "unshare");
  }
  const candidates = (process.env.PATH ?? "/usr/bin:/bin").split(":").filter(Boolean);
  for (const dir of candidates) {
    const candidate = `${dir}/unshare`;
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep probing
    }
  }
  throw new NativeSandboxError(
    "network-free native sandbox unavailable: 'unshare' executable not found on PATH. " +
      "Refusing to create a network-enabled sandbox; use the Docker backend or install util-linux.",
  );
}

export async function createNativeSandbox(options: CreateNativeSandboxOptions): Promise<DisposableSandbox> {
  if (process.platform !== "linux") {
    throw new NativeSandboxError(
      `network-free native sandbox is supported on linux only (this host: ${process.platform}). ` +
        `Egress denial cannot be enforced by construction on this platform; refusing to create a network-enabled sandbox. ` +
        `Use the Docker backend.`,
    );
  }
  if (!isAbsolute(options.root)) {
    throw new NativeSandboxError("root must be an absolute path");
  }
  try {
    await access(options.root, fsConstants.R_OK);
  } catch {
    throw new NativeSandboxError(`root is missing or unreadable: ${options.root}`);
  }
  const unshare = await resolveUnsharePath(options.unshare).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new NativeSandboxError(message);
  });
  const mode = await preflightUnshare(unshare);
  const limits = resolveNativeSandboxLimits(options.limits);
  const env = validateEnv(options.env, limits);
  return new NativeSandboxSession({
    root: options.root,
    unshare,
    mode,
    limits,
    env,
    secrets: options.secrets ?? [],
  });
}
