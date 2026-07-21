import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute } from "node:path";

export class DockerCliError extends Error {
  readonly code = "ERR_PRISM_DOCKER_CLI";
  readonly exitCode: number | null;
  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.name = "DockerCliError";
    this.exitCode = exitCode;
  }
}

export interface DockerCliRequest {
  readonly docker: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: NodeJS.ReadableStream | Buffer | string;
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  /** Combined ordered stream callback (stdout then stderr chunks as received). */
  readonly onData?: (chunk: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly collectStdout?: boolean;
  readonly collectStderr?: boolean;
  readonly redact?: (text: string) => string;
}

export interface DockerCliResult {
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly outputBytes: number;
}

export type DockerRunner = (request: DockerCliRequest) => Promise<DockerCliResult>;

function redactText(text: string, redact?: (text: string) => string): string {
  return redact ? redact(text) : text;
}

export async function assertAbsoluteExecutable(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new DockerCliError(`${label} must be an absolute executable path`);
  }
  try {
    await access(path, fsConstants.X_OK);
  } catch {
    throw new DockerCliError(`${label} is missing or not executable: ${path}`);
  }
  return path;
}

export function createSecretRedactor(secrets: readonly string[] = []): (text: string) => string {
  const needles = secrets.filter((s) => s.length > 0);
  if (needles.length === 0) return (text) => text;
  return (text: string): string => {
    let out = text;
    for (const secret of needles) {
      if (!secret) continue;
      out = out.split(secret).join("[REDACTED]");
    }
    return out;
  };
}

/** Spawn the host Docker CLI with an argument array. Never uses a shell. */
export async function runDockerCli(request: DockerCliRequest): Promise<DockerCliResult> {
  if (request.signal?.aborted) {
    throw new DockerCliError("Docker CLI aborted before start");
  }
  const maxOutputBytes = request.maxOutputBytes ?? 16 * 1024 * 1024;
  const redact = request.redact;

  return await new Promise<DockerCliResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let outputBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(request.docker, [...request.args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: request.env ? { ...request.env } : { PATH: "/usr/bin:/bin", LANG: "C" },
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new DockerCliError(redactText(message, redact)));
      return;
    }

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
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(error);
    };

    const noteBytes = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        fail(new DockerCliError(`Docker CLI output exceeded ${maxOutputBytes} bytes`, null));
      }
    };

    const onAbort = () => {
      aborted = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    };

    let timer: NodeJS.Timeout | undefined;
    if (request.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, request.timeoutMs);
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
    };

    request.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      noteBytes(chunk);
      if (request.collectStdout !== false) stdoutChunks.push(chunk);
      request.onStdout?.(chunk);
      request.onData?.(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      noteBytes(chunk);
      if (request.collectStderr !== false) stderrChunks.push(chunk);
      request.onStderr?.(chunk);
      request.onData?.(chunk);
    });
    child.on("error", (error) => {
      fail(new DockerCliError(redactText(error.message, redact)));
    });
    child.on("close", (code) => {
      if (aborted) {
        fail(new DockerCliError("Docker CLI aborted", code));
        return;
      }
      if (timedOut) {
        fail(new DockerCliError(`Docker CLI timed out after ${request.timeoutMs}ms`, code));
        return;
      }
      finalize(code);
    });

    if (request.stdin !== undefined) {
      if (typeof request.stdin === "string" || Buffer.isBuffer(request.stdin)) {
        child.stdin.end(request.stdin);
      } else {
        request.stdin.pipe(child.stdin);
        request.stdin.on("error", (error) => {
          fail(new DockerCliError(redactText(error.message, redact)));
        });
      }
    } else {
      child.stdin.end();
    }
  });
}

export async function dockerOutputText(
  runner: DockerRunner,
  request: Omit<DockerCliRequest, "collectStdout">,
): Promise<string> {
  const result = await runner({ ...request, collectStdout: true });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || `exit ${result.exitCode}`;
    throw new DockerCliError(redactText(detail, request.redact), result.exitCode);
  }
  return result.stdout.toString("utf8");
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
