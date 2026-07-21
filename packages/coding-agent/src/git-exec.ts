/**
 * Typed Git executable runner.
 *
 * Always uses argument arrays (never a shell), a noninteractive pager-safe
 * environment, and finite stdout/stderr retention. Hosts may inject a custom
 * runner (for example a sandbox `execFile` adapter) without changing tool code.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute } from "node:path";
import {
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_MAX_GIT_OUTPUT_BYTES,
  HARD_GIT_TIMEOUT_MS,
  HARD_MAX_GIT_OUTPUT_BYTES,
  validateCodingLimit,
} from "./limits.js";

export class GitError extends Error {
  readonly code = "ERR_PRISM_GIT";
  readonly exitCode: number | null;
  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.name = "GitError";
    this.exitCode = exitCode;
  }
}

export interface GitExecRequest {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: Buffer | string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface GitExecResult {
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly outputBytes: number;
}

export type GitRunner = (request: GitExecRequest & { gitPath: string }) => Promise<GitExecResult>;

/** Noninteractive, pager-safe, credential-prompt-free baseline for Git child processes. */
export const SAFE_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GCM_INTERACTIVE: "never",
  GIT_CONFIG_NOSYSTEM: "1",
});

/** Config flags prepended to every git invocation to disable hooks/external helpers. */
export const SAFE_GIT_CONFIG_ARGS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.pager=cat",
  "-c",
  "sequence.editor=true",
  "-c",
  "credential.helper=",
  "-c",
  "advice.detachedHead=false",
] as const);

export async function assertAbsoluteGit(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new GitError("gitPath must be an absolute executable path");
  }
  try {
    await access(path, fsConstants.X_OK);
  } catch {
    throw new GitError(`git executable is missing or not executable: ${path}`);
  }
  return path;
}

function mergeEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
  return { ...SAFE_GIT_ENV, ...(extra ?? {}) };
}

/** Local spawn-based Git runner. Never invokes a shell. */
export async function runGitCli(
  request: GitExecRequest & { gitPath: string },
): Promise<GitExecResult> {
  if (request.signal?.aborted) {
    throw new GitError("Git operation aborted before start");
  }
  for (const arg of request.args) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new GitError("Git args must be strings without NUL");
    }
  }

  const maxOutputBytes = validateCodingLimit(
    "maxOutputBytes",
    request.maxOutputBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES,
    HARD_MAX_GIT_OUTPUT_BYTES,
  );
  const timeoutMs = validateCodingLimit(
    "timeoutMs",
    request.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    HARD_GIT_TIMEOUT_MS,
  );

  return await new Promise<GitExecResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let outputBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let child: ChildProcessWithoutNullStreams;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    };

    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    };

    const finalize = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
        aborted,
        outputBytes,
      });
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      aborted = true;
      killTree();
    };

    try {
      child = spawn(request.gitPath, [...SAFE_GIT_CONFIG_ARGS, ...request.args], {
        cwd: request.cwd,
        env: mergeEnv(request.env),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new GitError(message));
      return;
    }

    const track = (chunk: Buffer, target: Buffer[]) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        killTree();
        fail(new GitError(`Git output exceeded ${maxOutputBytes} byte limit`));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => track(chunk, stdoutChunks));
    child.stderr.on("data", (chunk: Buffer) => track(chunk, stderrChunks));
    child.on("error", (error) => fail(new GitError(error.message)));
    child.on("close", (code) => finalize(code));

    if (request.stdin !== undefined) {
      const payload = typeof request.stdin === "string" ? Buffer.from(request.stdin) : request.stdin;
      child.stdin.end(payload);
    } else {
      child.stdin.end();
    }

    timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    request.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface CreateGitRunnerOptions {
  readonly gitPath?: string;
  readonly runner?: GitRunner;
  /** Optional sandbox-style execFile adapter. Collects streamed onData into stdout. */
  readonly execFile?: (request: {
    file: string;
    args: readonly string[];
    cwd?: string;
    env?: Readonly<Record<string, string>>;
    onData?: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
  }) => Promise<{ exitCode: number | null }>;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export interface BoundGitRunner {
  readonly gitPath: string;
  exec(request: GitExecRequest): Promise<GitExecResult>;
}

/**
 * Resolve a bound Git runner from an absolute git path, custom runner, or sandbox execFile.
 */
export async function createBoundGitRunner(options?: CreateGitRunnerOptions): Promise<BoundGitRunner> {
  const gitPath = await assertAbsoluteGit(options?.gitPath ?? "/usr/bin/git");
  const maxOutputBytes = options?.maxOutputBytes;
  const timeoutMs = options?.timeoutMs;

  if (options?.runner) {
    const custom = options.runner;
    return {
      gitPath,
      exec: (request) =>
        custom({
          ...request,
          gitPath,
          maxOutputBytes: request.maxOutputBytes ?? maxOutputBytes,
          timeoutMs: request.timeoutMs ?? timeoutMs,
        }),
    };
  }

  if (options?.execFile) {
    const execFile = options.execFile;
    return {
      gitPath,
      exec: async (request) => {
        if (request.signal?.aborted) throw new GitError("Git operation aborted before start");
        const chunks: Buffer[] = [];
        let outputBytes = 0;
        const limit = validateCodingLimit(
          "maxOutputBytes",
          request.maxOutputBytes ?? maxOutputBytes ?? DEFAULT_MAX_GIT_OUTPUT_BYTES,
          HARD_MAX_GIT_OUTPUT_BYTES,
        );
        const args = [...SAFE_GIT_CONFIG_ARGS, ...request.args];
        try {
          const { exitCode } = await execFile({
            file: gitPath,
            args,
            cwd: request.cwd,
            env: mergeEnv(request.env),
            signal: request.signal,
            timeout: request.timeoutMs ?? timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
            onData: (data) => {
              outputBytes += data.length;
              if (outputBytes > limit) {
                throw new GitError(`Git output exceeded ${limit} byte limit`);
              }
              chunks.push(data);
            },
          });
          return {
            exitCode,
            stdout: Buffer.concat(chunks),
            stderr: Buffer.alloc(0),
            timedOut: false,
            aborted: false,
            outputBytes,
          };
        } catch (error) {
          if (error instanceof GitError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          throw new GitError(message);
        }
      },
    };
  }

  return {
    gitPath,
    exec: (request) =>
      runGitCli({
        ...request,
        gitPath,
        maxOutputBytes: request.maxOutputBytes ?? maxOutputBytes,
        timeoutMs: request.timeoutMs ?? timeoutMs,
      }),
  };
}

export function gitText(result: GitExecResult, stream: "stdout" | "stderr" = "stdout"): string {
  return (stream === "stdout" ? result.stdout : result.stderr).toString("utf8");
}

export async function gitRequireOk(
  runner: BoundGitRunner,
  request: GitExecRequest,
  label: string,
): Promise<GitExecResult> {
  const result = await runner.exec(request);
  if (result.timedOut) throw new GitError(`${label} timed out`, result.exitCode);
  if (result.aborted) throw new GitError(`${label} aborted`, result.exitCode);
  if (result.exitCode !== 0) {
    const err = gitText(result, "stderr").trim() || gitText(result).trim() || `exit ${result.exitCode}`;
    throw new GitError(`${label} failed: ${err}`, result.exitCode);
  }
  return result;
}
