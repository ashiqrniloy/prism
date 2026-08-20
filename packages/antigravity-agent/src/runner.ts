import { createProcessSessions, type ProcessSessions } from "@arnilo/prism-coding-agent";
import { diagnoseCliError, redactDiagnosticText } from "./auth-errors.js";
import { validateConversationId } from "./conversation.js";
import { formatDurationForAgy, resolveRunnerLimits } from "./limits.js";
import { NdjsonParser, NdjsonStreamValidator } from "./ndjson.js";
import {
  AntigravityRunnerError,
  type AntigravityRunnerOptions,
  type AntigravityRunResult,
  type AntigravityStreamRecord,
  DEFAULT_AGY_COMMAND,
} from "./types.js";
import { assertValidWorkspacePath } from "./workspace-config.js";

const SAFE_ENV_KEYS: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "SHELL",
  "PRISM_PROBE_WORKSPACE",
  "PRISM_PROBE_CALL_COUNT",
  "PRISM_PROBE_AUTH_COUNT",
];

export function buildSafeEnvironment(userEnv?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]!;
    }
  }

  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  return env;
}

export function validateCommand(command?: string): string {
  const cmd = (command ?? DEFAULT_AGY_COMMAND).trim();
  if (!cmd) {
    throw new AntigravityRunnerError("Antigravity command must be a non-empty string");
  }
  if (/[\0\r\n]/.test(cmd)) {
    throw new AntigravityRunnerError("Antigravity command contains forbidden control characters");
  }
  return cmd;
}

export function buildCliArgs(options: AntigravityRunnerOptions, lifetimeMs: number): string[] {
  if (typeof options.prompt !== "string" || !options.prompt.trim()) {
    throw new AntigravityRunnerError("Prompt must be a non-empty string");
  }

  const args: string[] = ["-p", options.prompt, "--output-format", "stream-json", "--print-timeout", formatDurationForAgy(lifetimeMs)];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.agent) {
    args.push("--agent", options.agent);
  }

  if (options.conversationId) {
    const validConvId = validateConversationId(options.conversationId);
    args.push("--conversation", validConvId);
  }

  if (options.addDir && options.addDir.length > 0) {
    for (const dir of options.addDir) {
      if (typeof dir === "string" && dir.trim()) {
        args.push("--add-dir", dir.trim());
      }
    }
  }

  return args;
}

export async function runAntigravityCli(options: AntigravityRunnerOptions): Promise<AntigravityRunResult> {
  const command = validateCommand(options.command);
  const realCwd = assertValidWorkspacePath(options.cwd);
  const limits = resolveRunnerLimits(options.limits);
  const args = buildCliArgs(options, limits.maxLifetimeMs);
  const env = buildSafeEnvironment(options.env);

  let ownsProcessSessions = false;
  let sessions: ProcessSessions;

  if (options.processSessions) {
    sessions = options.processSessions;
  } else {
    sessions = createProcessSessions({
      cwd: realCwd,
      limits: {
        maxLifetimeMs: limits.maxLifetimeMs,
        maxOutputChunkBytes: limits.maxOutputChunkBytes,
        maxTotalOutputBytes: limits.maxOutputBytes,
      },
    });
    ownsProcessSessions = true;
  }

  const parser = new NdjsonParser({
    maxLineBytes: limits.maxLineBytes,
    maxTotalBytes: limits.maxOutputBytes,
  });
  const validator = new NdjsonStreamValidator(limits);

  let session: Awaited<ReturnType<ProcessSessions["start"]>>;
  try {
    session = await sessions.start({
      command,
      args,
      cwd: realCwd,
      env,
      signal: options.signal,
      lifetimeMs: limits.maxLifetimeMs,
    });
  } catch (error) {
    if (ownsProcessSessions) {
      await sessions.dispose().catch(() => {});
    }
    const err = diagnoseCliError({
      exitCode: null,
      stderr: error instanceof Error ? error.message : String(error),
      redactor: options.redactor,
    });
    throw err;
  }

  let cursor = 0;
  let totalOutputBytes = 0;
  const stderrBuffer = "";

  const processRecords = async (records: AntigravityStreamRecord[]) => {
    for (const record of records) {
      validator.processRecord(record);
      if (options.onRecord) {
        await options.onRecord(record);
      }
    }
  };

  const pollOutput = async (): Promise<boolean> => {
    const chunk = await session.output({
      cursor,
      maxBytes: limits.maxOutputChunkBytes,
    });
    cursor = chunk.cursor;
    if (chunk.data) {
      totalOutputBytes += Buffer.byteLength(chunk.data, "utf8");
      if (totalOutputBytes > limits.maxOutputBytes) {
        await session.kill().catch(() => {});
        throw new AntigravityRunnerError(`Antigravity CLI stream exceeded maximum output limit of ${limits.maxOutputBytes} bytes`);
      }
      const records = parser.push(chunk.data);
      await processRecords(records);
    }
    return chunk.eof;
  };

  try {
    // Wait for process exit while polling output
    let exited = false;
    let exitResult: { exitCode: number | null; state: string } | undefined;
    let waitError: unknown;

    session
      .wait({
        timeoutMs: limits.maxLifetimeMs,
        signal: options.signal,
      })
      .then(
        (res) => {
          exited = true;
          exitResult = res;
        },
        (err) => {
          exited = true;
          waitError = err;
        },
      );

    while (!exited) {
      if (options.signal?.aborted) {
        break;
      }
      const eof = await pollOutput();
      if (eof) break;
      // Small pause between output polls to yield to event loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (options.signal?.aborted) {
      await session.kill().catch(() => {});
      throw new AntigravityRunnerError("Antigravity CLI execution was aborted", {
        code: "ERR_PRISM_ANTIGRAVITY_ABORTED",
      });
    }

    if (waitError) {
      throw waitError;
    }

    if (!exitResult) {
      exitResult = await session.wait({
        timeoutMs: limits.maxLifetimeMs,
        signal: options.signal,
      });
    }

    // Drain any remaining output chunks
    while (true) {
      const eof = await pollOutput();
      if (eof) break;
    }

    // Flush any pending trailing record
    const flushed = parser.flush();
    await processRecords(flushed);

    const diagnostics = parser.getDiagnostics();
    const combinedStderr = `${stderrBuffer}\n${diagnostics}`.trim();
    const redactedStderr = redactDiagnosticText(combinedStderr, options.redactor);

    // If CLI process exited with non-zero code, diagnose error immediately
    if (exitResult.exitCode !== 0) {
      throw diagnoseCliError({
        exitCode: exitResult.exitCode,
        stderr: redactedStderr,
        redactor: options.redactor,
      });
    }

    const completed = validator.assertCompleted();

    if (completed.result.status !== "SUCCESS") {
      throw diagnoseCliError({
        exitCode: exitResult.exitCode,
        stderr: redactedStderr,
        stdout: completed.result.response,
        resultError: completed.result.error,
        redactor: options.redactor,
      });
    }

    return {
      conversationId: completed.result.conversation_id,
      response: completed.result.response ?? "",
      status: completed.result.status,
      events: completed.events,
      init: completed.init,
      steps: completed.steps,
      result: completed.result,
      usage: completed.result.usage ?? completed.steps.at(-1)?.usage,
      durationMs: completed.result.duration_ms,
      stderr: redactedStderr,
    };
  } catch (error) {
    await session.kill().catch(() => {});
    if (
      error instanceof Error &&
      (error.name === "AntigravityAuthenticationError" ||
        error.name === "AntigravityQuotaExhaustedError" ||
        error.name === "AntigravityRunnerError" ||
        error.name === "AntigravityStreamError" ||
        error.name === "AntigravityConversationError")
    ) {
      throw error;
    }
    throw diagnoseCliError({
      exitCode: null,
      stderr: error instanceof Error ? error.message : String(error),
      redactor: options.redactor,
    });
  } finally {
    if (ownsProcessSessions) {
      await sessions.dispose().catch(() => {});
    }
  }
}
