import { type ChildProcess, spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ObscuraError } from "./errors.js";
import { type ObscuraProcessLimits, resolveObscuraProcessLimits } from "./limits.js";
import type { ObscuraCloseOptions, ObscuraExit, ObscuraProcessOptions, OwnedObscuraProcess } from "./types.js";

const INSECURE_FLAGS = new Set(["--allow-private-network", "--allow-file-access"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Fail-closed config validation: no NUL bytes, bounded sizes, no implicit insecure flags. */
export function validateObscuraCommand(options: ObscuraProcessOptions, limits: ObscuraProcessLimits): void {
  if (!options.command || options.command.includes("\0") || !isAbsolute(options.command) || options.command.length > 4096) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "Absolute, NUL-free command path required");
  }
  const args = options.args ?? [];
  if (args.length > limits.maxArgvEntries) {
    throw new ObscuraError("ERR_OBSCURA_LIMIT", `argv exceeds ${limits.maxArgvEntries} entries`);
  }
  let argvBytes = 0;
  for (const arg of args) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new ObscuraError("ERR_OBSCURA_INPUT", "argv entries must be NUL-free strings");
    }
    argvBytes += byteLength(arg);
  }
  if (argvBytes > limits.maxArgvBytes) {
    throw new ObscuraError("ERR_OBSCURA_LIMIT", "argv exceeds byte cap");
  }
  if (!options.allowInsecureFlags) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (INSECURE_FLAGS.has(arg)) {
        throw new ObscuraError("ERR_OBSCURA_INSECURE_FLAG", `${arg} requires explicit allowInsecureFlags`);
      }
      // `--host VALUE` or `--host=VALUE`; non-loopback bind needs explicit opt-in.
      const host = arg === "--host" ? args[i + 1] : arg.startsWith("--host=") ? arg.slice("--host=".length) : undefined;
      if (host !== undefined && !LOOPBACK_HOSTS.has(host.toLowerCase())) {
        throw new ObscuraError(
          "ERR_OBSCURA_INSECURE_FLAG",
          `non-loopback --host ${JSON.stringify(host)} requires explicit allowInsecureFlags`,
        );
      }
    }
  }
  const env = options.env ?? {};
  const entries = Object.entries(env);
  if (entries.length > limits.maxEnvEntries) {
    throw new ObscuraError("ERR_OBSCURA_LIMIT", `env exceeds ${limits.maxEnvEntries} entries`);
  }
  for (const [key, value] of entries) {
    if (!ENV_KEY_PATTERN.test(key) || key.includes("\0") || value.includes("\0") || byteLength(value) > limits.maxEnvValueBytes) {
      throw new ObscuraError("ERR_OBSCURA_INPUT", `invalid environment entry ${JSON.stringify(key)}`);
    }
  }
  if (options.cwd !== undefined && (!isAbsolute(options.cwd) || options.cwd.includes("\0"))) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "cwd must be an absolute NUL-free path");
  }
  if (options.stderr !== undefined && options.stderr !== "pipe" && options.stderr !== "ignore") {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "stderr must be 'pipe' or 'ignore'");
  }
}

/** Minimal environment: never inherit the full host environment implicitly. */
function baseEnv(explicit: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of ["PATH", "HOME"] as const) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  return { ...base, ...(explicit ? { ...explicit } : {}) };
}

function killTree(child: ChildProcess, sig: NodeJS.Signals, groupKill: boolean): void {
  // obscura serve spawns worker children; on POSIX kill the whole process group.
  if (child.pid !== undefined && groupKill) {
    try {
      process.kill(-child.pid, sig);
      return;
    } catch {
      // group already gone; fall through to direct kill
    }
  }
  try {
    child.kill(sig);
  } catch {
    // already exited
  }
}

class OwnedProcess implements OwnedObscuraProcess {
  readonly child: ChildProcess;
  private readonly groupKill = process.platform !== "win32";
  private stderr = Buffer.alloc(0);
  private stderrTruncated = false;
  private closePromise: Promise<void> | undefined;
  private readonly exitPromise: Promise<ObscuraExit>;

  constructor(
    options: ObscuraProcessOptions,
    readonly limits: ObscuraProcessLimits,
  ) {
    validateObscuraCommand(options, limits);
    const wantStderr = (options.stderr ?? "pipe") === "pipe";
    this.child = spawn(options.command, [...(options.args ?? [])], {
      env: baseEnv(options.env),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["ignore", "ignore", wantStderr ? "pipe" : "ignore"],
      // Own process group on POSIX so a tree kill reaches obscura workers.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    if (wantStderr) {
      let retained = 0;
      this.child.stderr?.on("data", (chunk: Buffer) => {
        const room = this.limits.maxStderrBytes - retained;
        if (room <= 0) return;
        const take = chunk.subarray(0, room);
        retained += take.byteLength;
        this.stderr = Buffer.concat([this.stderr, take], retained);
        if (take.byteLength < chunk.byteLength) this.stderrTruncated = true;
      });
    }
    this.exitPromise = new Promise<ObscuraExit>((resolve, reject) => {
      this.child.once("error", (error) => reject(new ObscuraError("ERR_OBSCURA_SPAWN", `spawn failed: ${error.message}`)));
      this.child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get exited(): Promise<ObscuraExit> {
    return this.exitPromise;
  }

  stderrText(): string {
    const text = this.stderr.toString("utf8");
    return this.stderrTruncated ? `${text}\n[truncated]` : text;
  }

  async waitReady(probe: () => boolean | Promise<boolean>, options?: { signal?: AbortSignal }): Promise<void> {
    const signal = options?.signal;
    if (signal?.aborted) throw new ObscuraError("ERR_OBSCURA_ABORTED", "startup aborted");
    let exitSeen: ObscuraExit | undefined;
    const onExit = (exit: ObscuraExit) => {
      exitSeen = exit;
    };
    void this.exitPromise.then(onExit, () => {});
    const deadline = Date.now() + this.limits.startupTimeoutMs;
    try {
      while (exitSeen === undefined) {
        if (await probe()) return;
        if (signal?.aborted) throw new ObscuraError("ERR_OBSCURA_ABORTED", "startup aborted");
        if (Date.now() >= deadline) {
          throw new ObscuraError("ERR_OBSCURA_START_TIMEOUT", `readiness probe timed out after ${this.limits.startupTimeoutMs}ms`);
        }
        await delay(25);
      }
      throw new ObscuraError(
        "ERR_OBSCURA_EXITED",
        `process exited before readiness (code=${exitSeen.code}, signal=${exitSeen.signal ?? "none"})`,
      );
    } catch (error) {
      await this.close({ signal });
      throw error;
    }
  }

  async close(options?: ObscuraCloseOptions): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.doClose(options);
    await this.closePromise;
  }

  private async doClose(options?: ObscuraCloseOptions): Promise<void> {
    const signal = options?.signal;
    const grace = options?.shutdownTimeoutMs ?? this.limits.shutdownTimeoutMs;
    const abort = () => killTree(this.child, "SIGKILL", this.groupKill);
    signal?.addEventListener("abort", abort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    try {
      killTree(this.child, "SIGTERM", this.groupKill);
      if (grace > 0) {
        timer = setTimeout(() => killTree(this.child, "SIGKILL", this.groupKill), grace);
        timer.unref?.();
      }
      await this.exitPromise;
    } catch {
      // spawn already failed; nothing to terminate
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

/** Spawn a shell-free, bounded, ownership-tracked Obscura (or equivalent) process. */
export function spawnObscuraProcess(options: ObscuraProcessOptions): OwnedObscuraProcess {
  return new OwnedProcess(options, resolveObscuraProcessLimits(options.limits));
}
