/**
 * Shell tool: execute a command in the host shell.
 *
 * Behavioral port of pi's core/tools/bash for @arnilo/prism-coding-agent, adapted to
 * Prism's `ToolDefinition` contract. Drops pi's TUI (live `onUpdate` streaming,
 * `renderCall`/`renderResult`) and process-shutdown child tracking; re-ports spawn/
 * kill/waitForChildProcess directly over stdlib so the package stays self-contained.
 *
 * Deviations from pi (documented):
 *  - Tool named `"shell"` (pi: `"bash"`).
 *  - `timeout` param is in **seconds** (matches pi).
 *  - Shell resolution honors `process.env.SHELL` → `/bin/bash` → `sh` (pi forces `/bin/bash`);
 *    overridable via `options.shellPath`. Rationale: a host integrating the tool usually wants its
 *    login shell respected; `shellPath` still lets a host force bash for fully predictable POSIX.
 *  - Non-zero exit is **not** a tool error: returned as a normal `ToolResult` with `exitCode` in
 *    `metadata` and a status footer in `content` (pi throws). timeout/abort *are* error results
 *    (the command did not complete). Rationale: `ToolResult.error` should mean the tool call failed,
 *    not that the command returned non-zero.
 *  - Drops detached-child PID tracking (`killTrackedDetachedChildren`): the host owns process
 *    lifecycle; the tool kills the tree only on timeout/abort. Drops the stdin command transport
 *    (argv `-c` only). Default spawn env is `process.env` (no pi CLI binDir PATH injection).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { OutputAccumulator, type OutputSnapshot } from "./output-accumulator.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.js";

const EXIT_STDIO_GRACE_MS = 100;

export interface ShellConfig {
  shell: string;
  args: string[];
}

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

export interface BashExecOptions {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BashOperations {
  /** Execute a command and stream combined output. Resolves to the exit code (null if killed). */
  exec: (
    command: string,
    cwd: string,
    options: BashExecOptions,
  ) => Promise<{ exitCode: number | null }>;
}

export interface ShellToolOptions {
  /** Structured pre-execution policy checked before spawn. */
  executionPolicy?: ExecutionPolicy;
  /** Custom operations backend (default: local shell). Override to delegate to remote shells. */
  operations?: BashOperations;
  /** Command prefix prepended to every command (e.g. shell setup commands). */
  commandPrefix?: string;
  /** Explicit shell binary path; overrides SHELL/defaults. */
  shellPath?: string;
  /** Hook to adjust command, cwd, or env before execution. */
  spawnHook?: BashSpawnHook;
  /** Max lines kept in the tail snapshot (default 2000). */
  maxLines?: number;
  /** Max bytes kept in the tail snapshot (default 50KB). */
  maxBytes?: number;
  /** Temp-file prefix for spilled full output (default "prism-shell"). */
  tempFilePrefix?: string;
}

// --- spawn internals (re-ported from pi utils/shell.js + utils/child-process.js) ---

/** Resolve the shell binary + args. shellPath → SHELL env → /bin/bash → sh. */
export function getShellConfig(customShellPath?: string): ShellConfig {
  if (customShellPath) {
    if (existsSync(customShellPath)) return { shell: customShellPath, args: ["-c"] };
    throw new Error(`Custom shell path not found: ${customShellPath}`);
  }
  const shellEnv = process.env.SHELL;
  if (shellEnv && existsSync(shellEnv)) return { shell: shellEnv, args: ["-c"] };
  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] };
  return { shell: "sh", args: ["-c"] };
}

/** Kill a process and all its descendants (cross-platform). */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
    } catch {
      // ignore — best effort
    }
    return;
  }
  try {
    // child is spawned detached, so it is its own process-group leader: -pid targets the group.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

/**
 * Wait for a child to terminate without hanging on inherited stdio handles held by detached descendants.
 *
 * A short-lived child can `exit` while a detached descendant keeps its stdout/stderr pipe open. After
 * `exit` we wait for the pipes to fall idle: the grace timer is re-armed on every chunk, so an actively
 * writing descendant keeps us reading, while a quiet inherited handle releases us after the grace elapses.
 */
export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: NodeJS.Timeout | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    const cleanup = () => {
      if (postExitTimer) {
        clearTimeout(postExitTimer);
        postExitTimer = undefined;
      }
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };
    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(code);
    };
    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;
      if (stdoutEnded && stderrEnded) finalize(exitCode);
    };
    const armIdleTimer = () => {
      if (postExitTimer) clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };
    const onData = () => {
      if (exited && !settled) armIdleTimer();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled) armIdleTimer();
    };
    const onClose = (code: number | null) => {
      finalize(code);
    };
    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

/** Default local-shell operations: spawn the command in a shell, stream combined stdout+stderr. */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const shellConfig = getShellConfig(options?.shellPath);
      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute shell commands.`);
      }
      if (signal?.aborted) {
        throw new Error("aborted");
      }
      const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
        cwd,
        detached: process.platform !== "win32",
        env: env ?? { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (child.pid) killProcessTree(child.pid);
      };
      try {
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
        const exitCode = await waitForChildProcess(child);
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        return { exitCode };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

// --- result formatting (adapted from pi, minus TUI) ---

function formatOutput(
  snapshot: OutputSnapshot,
  lastLineBytes: number,
  emptyText = "(no output)",
): { text: string; truncation: TruncationResult; fullOutputPath?: string } {
  const truncation = snapshot.truncation;
  let text = snapshot.content || emptyText;
  if (truncation.truncated) {
    const startLine = truncation.totalLines - truncation.outputLines + 1;
    const endLine = truncation.totalLines;
    if (truncation.lastLinePartial) {
      const lastLineSize = formatSize(lastLineBytes);
      text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
    } else if (truncation.truncatedBy === "lines") {
      text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
    } else {
      text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.maxBytes)} limit). Full output: ${snapshot.fullOutputPath}]`;
    }
  }
  return { text, truncation, fullOutputPath: snapshot.fullOutputPath };
}

function appendStatus(text: string, status: string): string {
  return text ? `${text}\n\n${status}` : status;
}

// --- tool factory ---

export function createShellTool(cwd: string, options?: ShellToolOptions): ToolDefinition {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const commandPrefix = options?.commandPrefix;
  const spawnHook = options?.spawnHook;
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const tempFilePrefix = options?.tempFilePrefix ?? "prism-shell";

  return {
    name: "shell",
    exclusive: true,
    description: `Execute a shell command in the current working directory. Returns combined stdout and stderr. Output is truncated to the last ${maxLines} lines or ${maxBytes / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
      },
      required: ["command"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const command = typeof args.command === "string" ? args.command : "";
      const timeout = typeof args.timeout === "number" ? args.timeout : undefined;

      if (command.length === 0) {
        return {
          toolCallId,
          name: "shell",
          content: [{ type: "text", text: "Error: command is required and must be a non-empty string." }],
          error: { message: "command is required and must be a non-empty string." },
        };
      }

      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
      let spawnContext = spawnHook
        ? spawnHook({ command: resolvedCommand, cwd, env: { ...process.env } })
        : { command: resolvedCommand, cwd, env: { ...process.env } };

      const policyCheck = await enforceExecutionPolicy(
        options?.executionPolicy,
        {
          kind: "shell",
          operation: "execute",
          command: spawnContext.command,
          paths: [spawnContext.cwd],
          risk: "high",
          metadata: { timeout, sessionId: context.sessionId, runId: context.runId, signal: context.signal },
        },
        toolCallId,
        "shell",
      );
      if (!policyCheck.allowed) return policyCheck.result;
      if (policyCheck.action.command) {
        spawnContext = { ...spawnContext, command: policyCheck.action.command };
      }

      const output = new OutputAccumulator({ maxLines, maxBytes, tempFilePrefix });
      let acceptingOutput = true;
      const handleData = (data: Buffer) => {
        if (!acceptingOutput) return;
        output.append(data);
      };
      const finishOutput = async (): Promise<OutputSnapshot> => {
        acceptingOutput = false;
        output.finish();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        await output.closeTempFile();
        return snapshot;
      };

      // Safety net: never leak an unhandled throw to the host runtime.
      try {
        let exitCode: number | null;
        try {
          const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
            onData: handleData,
            signal: context.signal,
            timeout,
            env: spawnContext.env,
          });
          exitCode = result.exitCode;
        } catch (err) {
          const snapshot = await finishOutput();
          const { text } = formatOutput(snapshot, output.getLastLineBytes(), "");
          const message = err instanceof Error ? err.message : String(err);
          const meta = {
            exitCode: null,
            truncation: snapshot.truncation,
            fullOutputPath: snapshot.fullOutputPath,
          };
          if (message === "aborted") {
            return {
              toolCallId,
              name: "shell",
              content: [{ type: "text", text: appendStatus(text, "[Command aborted]") }],
              error: { message: "Command aborted" },
              metadata: meta,
            };
          }
          if (message.startsWith("timeout:")) {
            const timeoutSecs = message.split(":")[1];
            const status = `Command timed out after ${timeoutSecs} seconds`;
            return {
              toolCallId,
              name: "shell",
              content: [{ type: "text", text: appendStatus(text, `[${status}]`) }],
              error: { message: status },
              metadata: meta,
            };
          }
          // Spawn error (missing cwd, shell ENOENT, …): message is already host-friendly.
          return {
            toolCallId,
            name: "shell",
            content: [{ type: "text", text: appendStatus(text, message) }],
            error: { message },
            metadata: meta,
          };
        }
        const snapshot = await finishOutput();
        const formatted = formatOutput(snapshot, output.getLastLineBytes());
        let text = formatted.text;
        // Non-zero exit is not a tool error: surface exit code in a footer + metadata.
        if (exitCode !== 0 && exitCode !== null) {
          text = appendStatus(text, `[Command exited with code ${exitCode}]`);
        }
        return {
          toolCallId,
          name: "shell",
          content: [{ type: "text", text }],
          metadata: {
            exitCode,
            truncation: snapshot.truncation,
            fullOutputPath: snapshot.fullOutputPath,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          toolCallId,
          name: "shell",
          content: [{ type: "text", text: message }],
          error: { message },
        };
      }
    },
  };
}
