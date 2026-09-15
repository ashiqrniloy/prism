import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ProcessRecoveryBackend } from "../agent/process/recovery.js";
import type { ProcessSandboxHandle } from "../agent/process/types.js";
import { createSecretRedactor } from "./docker-cli.js";
import { computeCommandFingerprint } from "./docker-sandbox.js";
import type {
  DisposableSandbox,
  SandboxCapabilities,
  SandboxCloseOptions,
  SandboxExecFileRequest,
  SandboxExecRequest,
  SandboxExportMetadata,
  SandboxPauseResult,
  SandboxProcessHandle,
  SandboxSnapshotKind,
  SandboxStatus,
  SandboxStatusState,
} from "./sandbox.js";
import { type DockerSandboxLimitOptions, type ResolvedDockerSandboxLimits, resolveDockerSandboxLimits } from "./sandbox-limits.js";
import { Semaphore } from "./semaphore.js";

/** Verified `e2b` peer (MIT, Node >=20.18.1 <21 || >=22). */
export const E2B_PEER_VERSION = "2.49.1";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_WORKDIR = "/workspace";
const DEFAULT_TEMPLATE = "base";

export class E2BSandboxError extends Error {
  readonly code = "ERR_PRISM_E2B_SANDBOX";
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "E2BSandboxError";
    this.statusCode = statusCode;
  }
}

export interface E2BCommandResult {
  readonly exitCode: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface E2BCommandHandle {
  readonly pid?: number;
  wait(opts?: { signal?: AbortSignal }): Promise<E2BCommandResult>;
  kill?(): Promise<boolean | undefined>;
  sendStdin?(data: string | Uint8Array): Promise<void>;
}

export interface E2BCommandStartOpts {
  readonly background?: boolean;
  readonly cwd?: string;
  readonly envs?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly stdin?: boolean;
  readonly signal?: AbortSignal;
  readonly onStdout?: (data: string) => void | Promise<void>;
  readonly onStderr?: (data: string) => void | Promise<void>;
}

export interface E2BSandboxInstance {
  readonly sandboxId: string;
  readonly commands: {
    run(cmd: string, opts?: E2BCommandStartOpts): Promise<E2BCommandResult | E2BCommandHandle>;
    connect?(pid: number, opts?: { signal?: AbortSignal }): Promise<E2BCommandHandle>;
    kill?(pid: number, opts?: { signal?: AbortSignal }): Promise<boolean>;
    sendStdin?(pid: number, data: string | Uint8Array, opts?: { signal?: AbortSignal }): Promise<void>;
    list?(opts?: {
      signal?: AbortSignal;
    }): Promise<readonly { readonly pid: number; readonly cmd?: string; readonly args?: readonly string[] }[]>;
  };
  pause?(opts?: { keepMemory?: boolean; signal?: AbortSignal }): Promise<boolean | undefined>;
  kill?(opts?: { signal?: AbortSignal }): Promise<boolean | undefined>;
  getInfo?(opts?: { signal?: AbortSignal }): Promise<E2BSandboxInfo>;
  isRunning?(opts?: { signal?: AbortSignal }): Promise<boolean>;
}

export interface E2BSandboxInfo {
  readonly sandboxId?: string;
  readonly templateId?: string;
  readonly state?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly startedAt?: Date | string;
  readonly endAt?: Date | string;
}

export interface E2BSandboxStatic {
  create(templateOrOpts?: string | E2BCreateOpts, opts?: E2BCreateOpts): Promise<E2BSandboxInstance>;
  connect(sandboxId: string, opts?: E2BConnectOpts): Promise<E2BSandboxInstance>;
  getInfo?(sandboxId: string, opts?: E2BConnectOpts): Promise<E2BSandboxInfo>;
  pause?(sandboxId: string, opts?: { keepMemory?: boolean; signal?: AbortSignal } & E2BConnectOpts): Promise<boolean | undefined>;
  kill?(sandboxId: string, opts?: E2BConnectOpts): Promise<boolean | undefined>;
}

export interface E2BCreateOpts {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly envs?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly lifecycle?: {
    readonly onTimeout?: "kill" | "pause" | { readonly action: "pause"; readonly keepMemory?: boolean };
    readonly autoResume?: boolean;
  };
  readonly signal?: AbortSignal;
}

export interface E2BConnectOpts {
  readonly apiKey?: string;
  readonly signal?: AbortSignal;
}

export interface E2BClient {
  readonly Sandbox: E2BSandboxStatic;
}

export interface CreateE2BSandboxOptions {
  readonly apiKey?: string;
  readonly client?: E2BClient;
  readonly template?: string;
  readonly workdir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly limits?: DockerSandboxLimitOptions;
  readonly timeoutMs?: number;
  readonly onTimeout?: "kill" | "pause";
  readonly capabilities?: Readonly<Partial<SandboxCapabilities>>;
}

export interface ConnectE2BSandboxOptions {
  readonly sandboxId: string;
  readonly apiKey?: string;
  readonly client?: E2BClient;
  readonly workdir?: string;
  readonly expectedLabels?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly limits?: DockerSandboxLimitOptions;
  readonly timeoutMs?: number;
  /** When true, `Sandbox.connect` may resume a paused sandbox. Default false. */
  readonly resume?: boolean;
  readonly capabilities?: Readonly<Partial<SandboxCapabilities>>;
  readonly template?: string;
}

export interface E2BProcessRefData {
  readonly version: 1;
  readonly sandboxId: string;
  readonly pid: number;
  readonly commandFingerprint: string;
  readonly workspace: string;
}

export interface E2BProcessRecoveryBackendOptions {
  readonly expectedSandboxId?: string;
  readonly expectedWorkspace?: string;
  readonly expectedLabels?: Readonly<Record<string, string>>;
}

const E2B_CAPABILITIES: SandboxCapabilities = Object.freeze({
  workspaceCoherent: true,
  filesystemIsolated: true,
  networkIsolated: false,
  processIsolated: true,
  privilegeIsolated: false,
  egressRestricted: false,
});

export function resolveE2BCapabilities(override?: Readonly<Partial<SandboxCapabilities>>): SandboxCapabilities {
  if (!override) return E2B_CAPABILITIES;
  return Object.freeze({
    workspaceCoherent: override.workspaceCoherent === true,
    filesystemIsolated: override.filesystemIsolated === true,
    networkIsolated: override.networkIsolated === true,
    processIsolated: override.processIsolated === true,
    privilegeIsolated: override.privilegeIsolated === true,
    egressRestricted: override.egressRestricted === true,
  });
}

export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function argvCommand(file: string, args: readonly string[] = []): string {
  return [file, ...args].map(posixQuote).join(" ");
}

export function encodeE2BProcessRef(data: E2BProcessRefData): string {
  const json = JSON.stringify({
    v: 1,
    sid: data.sandboxId,
    pid: data.pid,
    fp: data.commandFingerprint,
    ws: data.workspace,
  });
  return `prism-e2b-proc:${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeE2BProcessRef(ref: string): E2BProcessRefData | null {
  if (!ref.startsWith("prism-e2b-proc:")) return null;
  try {
    const parsed = JSON.parse(Buffer.from(ref.slice("prism-e2b-proc:".length), "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      parsed.v !== 1 ||
      typeof parsed.sid !== "string" ||
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid < 1 ||
      typeof parsed.fp !== "string" ||
      typeof parsed.ws !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      sandboxId: parsed.sid,
      pid: parsed.pid,
      commandFingerprint: parsed.fp,
      workspace: parsed.ws,
    };
  } catch {
    return null;
  }
}

function httpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number") {
    return (error as { statusCode: number }).statusCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /^(?:Error:\s*)?(\d{3}):/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function isBusyPause(error: unknown): boolean {
  if (httpStatus(error) === 503) return true;
  const name = error instanceof Error ? error.name : "";
  return name === "ServiceBusyError" || name === "ServiceBusyException";
}

function isHandle(value: unknown): value is E2BCommandHandle {
  return !!value && typeof value === "object" && typeof (value as E2BCommandHandle).wait === "function";
}

function validateEnv(env: Readonly<Record<string, string>> | undefined, limits: ResolvedDockerSandboxLimits): Record<string, string> {
  const entries = Object.entries(env ?? {});
  if (entries.length > limits.maxEnvNames) throw new E2BSandboxError(`env exceeds maxEnvNames (${limits.maxEnvNames})`);
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!ENV_NAME_RE.test(name)) throw new E2BSandboxError(`invalid env name: ${name}`);
    if (typeof value !== "string") throw new E2BSandboxError(`env value for ${name} must be a string`);
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > limits.maxEnvBytes) throw new E2BSandboxError(`env exceeds maxEnvBytes (${limits.maxEnvBytes})`);
    out[name] = value;
  }
  return out;
}

function validateLabels(labels: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (!key || /[\s=]/.test(key) || key.includes("\0") || value.includes("\n") || value.includes("\0")) {
      throw new E2BSandboxError("invalid sandbox label");
    }
    out[key] = value;
  }
  return out;
}

function validateWorkdir(workdir: string | undefined): string {
  const path = workdir ?? DEFAULT_WORKDIR;
  if (!path.startsWith("/") || path.includes("\0")) throw new E2BSandboxError("workdir must be an absolute sandbox path");
  return path;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new E2BSandboxError("sandbox operation aborted");
}

async function loadSandboxApi(client: E2BClient | undefined): Promise<E2BSandboxStatic> {
  if (client?.Sandbox) return client.Sandbox;
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("e2b");
    const mod = (await import(pathToFileURL(resolved).href)) as {
      Sandbox?: E2BSandboxStatic;
      default?: { Sandbox?: E2BSandboxStatic };
    };
    const Sandbox = mod.Sandbox ?? mod.default?.Sandbox;
    if (typeof Sandbox?.create !== "function" || typeof Sandbox.connect !== "function") {
      throw new E2BSandboxError("installed e2b does not export Sandbox.create/connect");
    }
    return Sandbox;
  } catch (error) {
    if (error instanceof E2BSandboxError) throw error;
    throw new E2BSandboxError(`optional peer e2b@${E2B_PEER_VERSION} is not installed; install it or pass createE2BSandbox({ client })`);
  }
}

function edgeOpts(apiKey: string | undefined): { apiKey?: string } {
  return apiKey ? { apiKey } : {};
}

class E2BProcessHandle implements SandboxProcessHandle {
  private _exited = false;
  private _exitCode: number | null = null;
  private _released = false;
  private readonly waiters: Array<() => void> = [];
  readonly ref: string;
  readonly pid: number;

  constructor(
    readonly sandboxId: string,
    pid: number,
    readonly commandFingerprint: string,
    readonly workspace: string,
    private readonly commands: E2BSandboxInstance["commands"],
    private readonly redact: (text: string) => string,
    waitPromise?: Promise<E2BCommandResult>,
  ) {
    this.pid = pid;
    this.ref = encodeE2BProcessRef({ version: 1, sandboxId, pid, commandFingerprint, workspace });
    waitPromise?.then(
      (result) => this.markExited(result.exitCode),
      () => this.markExited(null),
    );
  }

  markExited(exitCode: number | null): void {
    if (this._exited) return;
    this._exited = true;
    this._exitCode = exitCode;
    for (const waiter of this.waiters) waiter();
    this.waiters.length = 0;
  }

  get isExited(): boolean {
    return this._exited;
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (this._exited || this._released) throw new E2BSandboxError("process is not running");
    if (typeof this.commands.sendStdin !== "function") throw new E2BSandboxError("sandbox commands.sendStdin is unsupported");
    try {
      await this.commands.sendStdin(this.pid, data);
    } catch (error) {
      throw new E2BSandboxError(this.redact(error instanceof Error ? error.message : String(error)));
    }
  }

  async signal(name: string): Promise<void> {
    if (this._exited) throw new E2BSandboxError("process is not running");
    if (name === "SIGKILL" || name === "KILL" || name === "9") {
      await this.kill();
      return;
    }
    throw new E2BSandboxError(`E2B process signal ${name} is unsupported; only SIGKILL`);
  }

  async kill(): Promise<void> {
    if (this._exited) return;
    try {
      await this.commands.kill?.(this.pid);
    } catch {
      // best effort
    }
    this.markExited(null);
  }

  async release(): Promise<void> {
    if (this._exited) return;
    this._released = true;
  }

  async wait(waitOptions?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null }> {
    if (this._exited) return { exitCode: this._exitCode };
    return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
      const onExit = () => {
        cleanup();
        resolve({ exitCode: this._exitCode });
      };
      const onAbort = () => {
        cleanup();
        reject(new E2BSandboxError("wait aborted"));
      };
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        waitOptions?.signal?.removeEventListener("abort", onAbort);
        const idx = this.waiters.indexOf(onExit);
        if (idx >= 0) this.waiters.splice(idx, 1);
      };
      this.waiters.push(onExit);
      if (waitOptions?.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          reject(new E2BSandboxError(`wait timed out after ${waitOptions.timeoutMs}ms`));
        }, waitOptions.timeoutMs);
      }
      if (waitOptions?.signal) {
        if (waitOptions.signal.aborted) onAbort();
        else waitOptions.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

class E2BSandboxSession implements DisposableSandbox {
  readonly id: string;
  readonly capabilities: SandboxCapabilities;
  readonly labels?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  private state: SandboxStatusState = "running";
  private snapshotKind: SandboxSnapshotKind | undefined;
  private commandCount = 0;
  private readonly startedAt = Date.now();
  private lastActivityAt = Date.now();
  private readonly execLock: Semaphore;
  private readonly activeProcesses = new Map<number, E2BProcessHandle>();
  private readonly redact: (text: string) => string;

  constructor(
    private instance: E2BSandboxInstance | undefined,
    private readonly api: E2BSandboxStatic,
    private readonly opts: {
      readonly sandboxId: string;
      readonly template: string;
      readonly workdir: string;
      readonly apiKey?: string;
      readonly limits: ResolvedDockerSandboxLimits;
      readonly timeoutMs: number;
      readonly labels?: Readonly<Record<string, string>>;
      readonly capabilities: SandboxCapabilities;
      readonly secrets: readonly string[];
    },
  ) {
    this.id = opts.sandboxId;
    this.capabilities = opts.capabilities;
    this.labels = opts.labels;
    this.timeoutMs = opts.timeoutMs;
    this.execLock = new Semaphore(opts.limits.maxConcurrentExecs, E2BSandboxError);
    this.redact = createSecretRedactor([opts.apiKey ?? "", ...opts.secrets]);
  }

  markPaused(kind: SandboxSnapshotKind): void {
    this.state = "stopped";
    this.snapshotKind = kind;
    this.instance = undefined;
    if (kind === "filesystem") {
      for (const handle of this.activeProcesses.values()) handle.markExited(null);
      this.activeProcesses.clear();
    }
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private remainingWallMs(): number {
    return Math.max(1, this.opts.timeoutMs - (Date.now() - this.startedAt));
  }

  private assertRunning(): E2BSandboxInstance {
    if (this.state === "removed" || this.state === "failed") throw new E2BSandboxError("sandbox is not available");
    if (this.state === "stopped" || !this.instance) {
      throw new E2BSandboxError("sandbox is paused; call resume() (exec does not auto-resume)");
    }
    return this.instance;
  }

  async status(): Promise<SandboxStatus> {
    return {
      id: this.id,
      state: this.state,
      image: this.opts.template,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      commandCount: this.commandCount,
      ...(this.snapshotKind && this.state === "stopped" ? { snapshot: { kind: this.snapshotKind } } : {}),
    };
  }

  async exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }> {
    return this.execFile({
      file: "/bin/sh",
      args: ["-c", request.command],
      cwd: request.cwd,
      env: request.env as Record<string, string> | undefined,
      onData: request.onData,
      signal: request.signal,
      timeout: request.timeout,
    });
  }

  async execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }> {
    const instance = this.assertRunning();
    if (!request.file || request.file.includes("\0")) throw new E2BSandboxError("execFile requires a non-empty file path");
    if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== "string" || a.includes("\0"))) {
      throw new E2BSandboxError("execFile args must be a string array without NUL");
    }
    if (this.commandCount >= this.opts.limits.maxCommands) {
      throw new E2BSandboxError(`sandbox exceeded maxCommands (${this.opts.limits.maxCommands})`);
    }
    const cwd = request.cwd ?? this.opts.workdir;
    if (!cwd.startsWith("/") || cwd.includes("\0")) throw new E2BSandboxError("cwd must be an absolute sandbox path");
    const extraEnv = validateEnv(request.env, this.opts.limits);
    const release = await this.execLock.acquire(request.signal);
    this.commandCount += 1;
    this.touch();
    try {
      const timeoutMs = request.timeout !== undefined ? Math.min(request.timeout, this.remainingWallMs()) : this.remainingWallMs();
      let outputBytes = 0;
      const onChunk = (data: string) => {
        const buf = Buffer.from(data);
        outputBytes += buf.byteLength;
        if (outputBytes > this.opts.limits.maxOutputBytes) {
          throw new E2BSandboxError(`command output exceeded maxOutputBytes (${this.opts.limits.maxOutputBytes})`);
        }
        request.onData?.(buf);
      };
      const result = await instance.commands.run(argvCommand(request.file, request.args), {
        cwd,
        envs: extraEnv,
        timeoutMs,
        signal: request.signal,
        onStdout: onChunk,
        onStderr: onChunk,
      });
      this.touch();
      if (isHandle(result)) {
        const waited = await result.wait({ signal: request.signal });
        return { exitCode: waited.exitCode };
      }
      return { exitCode: result.exitCode };
    } catch (error) {
      throw new E2BSandboxError(this.redact(error instanceof Error ? error.message : String(error)), httpStatus(error));
    } finally {
      release();
    }
  }

  async startProcess(request: SandboxExecFileRequest): Promise<SandboxProcessHandle> {
    const instance = this.assertRunning();
    if (!request.file || request.file.includes("\0")) throw new E2BSandboxError("startProcess requires a non-empty file path");
    const args = request.args ?? [];
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) {
      throw new E2BSandboxError("startProcess args must be a string array without NUL");
    }
    if (this.commandCount >= this.opts.limits.maxCommands) {
      throw new E2BSandboxError(`sandbox exceeded maxCommands (${this.opts.limits.maxCommands})`);
    }
    const cwd = request.cwd ?? this.opts.workdir;
    if (!cwd.startsWith("/") || cwd.includes("\0")) throw new E2BSandboxError("cwd must be an absolute sandbox path");
    const extraEnv = validateEnv(request.env, this.opts.limits);
    const release = await this.execLock.acquire(request.signal);
    this.commandCount += 1;
    this.touch();
    try {
      const timeoutMs = request.timeout !== undefined ? Math.min(request.timeout, this.remainingWallMs()) : this.remainingWallMs();
      let outputBytes = 0;
      const onChunk = (data: string) => {
        const buf = Buffer.from(data);
        outputBytes += buf.byteLength;
        if (outputBytes > this.opts.limits.maxOutputBytes) {
          throw new E2BSandboxError(`command output exceeded maxOutputBytes (${this.opts.limits.maxOutputBytes})`);
        }
        request.onData?.(buf);
      };
      const started = await instance.commands.run(argvCommand(request.file, args), {
        background: true,
        stdin: true,
        cwd,
        envs: extraEnv,
        timeoutMs,
        signal: request.signal,
        onStdout: onChunk,
        onStderr: onChunk,
      });
      if (!isHandle(started) || typeof started.pid !== "number" || !Number.isInteger(started.pid) || started.pid < 1) {
        throw new E2BSandboxError("sandbox startProcess did not return a pid");
      }
      const fingerprint = computeCommandFingerprint(request.file, args);
      const waitPromise = started.wait();
      const handle = new E2BProcessHandle(
        this.id,
        started.pid,
        fingerprint,
        this.opts.workdir,
        instance.commands,
        this.redact,
        waitPromise,
      );
      this.activeProcesses.set(started.pid, handle);
      waitPromise.then(
        () => {
          this.activeProcesses.delete(started.pid!);
          this.touch();
        },
        () => {
          this.activeProcesses.delete(started.pid!);
          this.touch();
        },
      );
      return handle;
    } catch (error) {
      throw new E2BSandboxError(this.redact(error instanceof Error ? error.message : String(error)), httpStatus(error));
    } finally {
      release();
    }
  }

  async attachProcess(ref: string): Promise<SandboxProcessHandle | null> {
    if (this.state !== "running" || !this.instance) return null;
    if (this.snapshotKind === "filesystem") return null;
    const decoded = decodeE2BProcessRef(ref);
    if (!decoded) return null;
    if (decoded.sandboxId !== this.id) return null;
    if (decoded.workspace !== this.opts.workdir) return null;
    const live = this.activeProcesses.get(decoded.pid);
    if (live && !live.isExited) {
      if (live.commandFingerprint !== decoded.commandFingerprint) return null;
      return live;
    }
    if (typeof this.instance.commands.connect !== "function") return null;
    try {
      const listed = this.instance.commands.list ? await this.instance.commands.list() : undefined;
      if (listed) {
        const info = listed.find((entry) => entry.pid === decoded.pid);
        if (!info) return null;
        if (info.cmd && info.args) {
          const fp = computeCommandFingerprint(info.cmd, info.args);
          if (fp !== decoded.commandFingerprint) return null;
        }
      }
      const connected = await this.instance.commands.connect(decoded.pid);
      if (!isHandle(connected)) return null;
      const handle = new E2BProcessHandle(
        this.id,
        decoded.pid,
        decoded.commandFingerprint,
        this.opts.workdir,
        this.instance.commands,
        this.redact,
        connected.wait(),
      );
      this.activeProcesses.set(decoded.pid, handle);
      return handle;
    } catch {
      return null;
    }
  }

  async pause(options?: { keepMemory?: boolean; signal?: AbortSignal }): Promise<SandboxPauseResult> {
    assertNotAborted(options?.signal);
    if (this.state === "removed" || this.state === "failed") throw new E2BSandboxError("sandbox is not available");
    const keepMemory = options?.keepMemory !== false;
    const kind: SandboxSnapshotKind = keepMemory ? "memory" : "filesystem";
    if (this.state === "stopped") return { kind: this.snapshotKind ?? kind, state: "paused" };
    const instance = this.instance;
    try {
      if (instance?.pause) await instance.pause({ keepMemory, signal: options?.signal });
      else if (this.api.pause) await this.api.pause(this.id, { keepMemory, signal: options?.signal, ...edgeOpts(this.opts.apiKey) });
      else throw new E2BSandboxError("sandbox pause is unsupported");
    } catch (error) {
      if (isBusyPause(error)) {
        throw new E2BSandboxError("pause refused (503); sandbox still running", 503);
      }
      throw new E2BSandboxError(this.redact(error instanceof Error ? error.message : String(error)), httpStatus(error));
    }
    this.markPaused(kind);
    this.touch();
    return { kind, state: "paused" };
  }

  async resume(options?: { signal?: AbortSignal }): Promise<void> {
    assertNotAborted(options?.signal);
    if (this.state === "running" && this.instance) return;
    if (this.state === "removed" || this.state === "failed") throw new E2BSandboxError("sandbox is not available");
    try {
      this.instance = await this.api.connect(this.id, { ...edgeOpts(this.opts.apiKey), signal: options?.signal });
    } catch (error) {
      const status = httpStatus(error);
      if (status === 404) {
        this.state = "removed";
        throw new E2BSandboxError("sandbox not found", 404);
      }
      throw new E2BSandboxError(this.redact(error instanceof Error ? error.message : String(error)), status);
    }
    this.state = "running";
    if (this.snapshotKind === "filesystem") this.activeProcesses.clear();
    this.snapshotKind = undefined;
    this.touch();
  }

  async stop(options?: { graceMs?: number; signal?: AbortSignal }): Promise<void> {
    void options?.graceMs;
    await this.pause({ keepMemory: true, signal: options?.signal });
  }

  async kill(options?: { signal?: AbortSignal }): Promise<void> {
    assertNotAborted(options?.signal);
    try {
      if (this.instance?.kill) await this.instance.kill({ signal: options?.signal });
      else if (this.api.kill) await this.api.kill(this.id, { ...edgeOpts(this.opts.apiKey), signal: options?.signal });
    } catch {
      // best effort
    }
    for (const handle of this.activeProcesses.values()) handle.markExited(null);
    this.activeProcesses.clear();
    this.instance = undefined;
    this.state = "removed";
    this.snapshotKind = undefined;
  }

  async close(options?: SandboxCloseOptions): Promise<SandboxExportMetadata | undefined> {
    if (options?.export) throw new E2BSandboxError("E2B close({ export }) is unsupported; pause() is the snapshot");
    await this.kill({ signal: options?.signal });
    return undefined;
  }
}

async function mkdirWorkspace(instance: E2BSandboxInstance, workdir: string, signal?: AbortSignal): Promise<void> {
  await instance.commands.run(`mkdir -p ${posixQuote(workdir)}`, { timeoutMs: 15_000, signal });
}

export async function createE2BSandbox(options: CreateE2BSandboxOptions): Promise<DisposableSandbox> {
  if (!options.client && !options.apiKey) {
    throw new E2BSandboxError("createE2BSandbox requires apiKey or client");
  }
  const limits = resolveDockerSandboxLimits(options.limits);
  const workdir = validateWorkdir(options.workdir);
  const env = validateEnv(options.env, limits);
  const labels = validateLabels(options.labels);
  const template = options.template ?? DEFAULT_TEMPLATE;
  if (!template || template.includes("\0") || /\s/.test(template)) throw new E2BSandboxError("invalid template");
  const timeoutMs = options.timeoutMs ?? limits.wallTimeMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new E2BSandboxError("timeoutMs must be a positive integer");
  const onTimeout = options.onTimeout ?? "kill";
  const api = await loadSandboxApi(options.client);
  const metadata = { "prism.sandbox": "1", ...labels };
  const createOpts: E2BCreateOpts = {
    ...edgeOpts(options.apiKey),
    timeoutMs,
    ...(Object.keys(env).length ? { envs: env } : {}),
    metadata,
    lifecycle: { onTimeout, autoResume: false },
  };
  let instance: E2BSandboxInstance;
  try {
    instance = template === DEFAULT_TEMPLATE ? await api.create(createOpts) : await api.create(template, createOpts);
  } catch (error) {
    throw new E2BSandboxError(
      createSecretRedactor([options.apiKey ?? "", ...(options.secrets ?? [])])(error instanceof Error ? error.message : String(error)),
      httpStatus(error),
    );
  }
  if (!instance?.sandboxId) throw new E2BSandboxError("e2b create returned no sandboxId");
  try {
    await mkdirWorkspace(instance, workdir);
  } catch (error) {
    try {
      await instance.kill?.();
    } catch {
      // ignore
    }
    throw new E2BSandboxError(
      createSecretRedactor([options.apiKey ?? "", ...(options.secrets ?? [])])(error instanceof Error ? error.message : String(error)),
      httpStatus(error),
    );
  }
  return new E2BSandboxSession(instance, api, {
    sandboxId: instance.sandboxId,
    template,
    workdir,
    apiKey: options.apiKey,
    limits,
    timeoutMs,
    labels,
    capabilities: resolveE2BCapabilities(options.capabilities),
    secrets: options.secrets ?? [],
  });
}

export async function connectE2BSandbox(options: ConnectE2BSandboxOptions): Promise<DisposableSandbox> {
  if (!options.sandboxId || options.sandboxId.includes("\0")) throw new E2BSandboxError("sandboxId required");
  if (!options.client && !options.apiKey) throw new E2BSandboxError("connectE2BSandbox requires apiKey or client");
  const limits = resolveDockerSandboxLimits(options.limits);
  const workdir = validateWorkdir(options.workdir);
  const expected = validateLabels(options.expectedLabels);
  const api = await loadSandboxApi(options.client);
  if (typeof api.getInfo !== "function") throw new E2BSandboxError("e2b Sandbox.getInfo is required to reconnect without auto-resume");
  let info: E2BSandboxInfo;
  try {
    info = await api.getInfo(options.sandboxId, edgeOpts(options.apiKey));
  } catch (error) {
    const status = httpStatus(error);
    throw new E2BSandboxError(status === 404 ? "sandbox not found" : error instanceof Error ? error.message : String(error), status);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (info.metadata?.[key] !== value) throw new E2BSandboxError("sandbox label mismatch");
  }
  const state = (info.state ?? "").toLowerCase();
  if (state === "killed") throw new E2BSandboxError("sandbox not found", 404);
  if (!state) throw new E2BSandboxError("sandbox state unknown; pass resume: true only for an explicit resume");
  const session = new E2BSandboxSession(undefined, api, {
    sandboxId: options.sandboxId,
    template: options.template ?? info.templateId ?? DEFAULT_TEMPLATE,
    workdir,
    apiKey: options.apiKey,
    limits,
    timeoutMs: options.timeoutMs ?? limits.wallTimeMs,
    labels: info.metadata ? { ...info.metadata } : expected,
    capabilities: resolveE2BCapabilities(options.capabilities),
    secrets: options.secrets ?? [],
  });
  if (state === "paused") {
    if (options.resume) await session.resume();
    else session.markPaused("memory");
    return session;
  }
  if (options.resume === false && state !== "running") {
    session.markPaused("memory");
    return session;
  }
  await session.resume();
  return session;
}

export function createE2BProcessRecoveryBackend(
  sandbox: DisposableSandbox,
  options?: E2BProcessRecoveryBackendOptions,
): ProcessRecoveryBackend {
  return {
    async attach(ref: string): Promise<ProcessSandboxHandle | null> {
      if (typeof sandbox.attachProcess !== "function") return null;
      const decoded = decodeE2BProcessRef(ref);
      if (!decoded) return null;
      if (options?.expectedSandboxId && decoded.sandboxId !== options.expectedSandboxId) return null;
      if (options?.expectedWorkspace && decoded.workspace !== options.expectedWorkspace) return null;
      if (options?.expectedLabels && sandbox.labels) {
        for (const [key, value] of Object.entries(options.expectedLabels)) {
          if (sandbox.labels[key] !== value) return null;
        }
      }
      const handle = await sandbox.attachProcess(ref);
      return (handle as unknown as ProcessSandboxHandle) ?? null;
    },
  };
}
