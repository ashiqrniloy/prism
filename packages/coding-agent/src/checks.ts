/**
 * Named check tool: host declares fixed executable+args; model selects only a name.
 */
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { enforceExecutionPolicy } from "./execution-policy.js";
import {
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_MAX_CHECK_CONCURRENCY,
  DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES,
  DEFAULT_MAX_CHECK_NAMES,
  DEFAULT_MAX_CHECK_OUTPUT_BYTES,
  HARD_CHECK_TIMEOUT_MS,
  HARD_MAX_BYTES,
  HARD_MAX_CHECK_CONCURRENCY,
  HARD_MAX_CHECK_DIAGNOSTIC_LINES,
  HARD_MAX_CHECK_NAMES,
  HARD_MAX_CHECK_OUTPUT_BYTES,
  validateCodingLimit,
} from "./limits.js";
import { OutputAccumulator } from "./output-accumulator.js";

export interface NamedCheckDefinition {
  /** Absolute executable path, or a basename resolved only via host-supplied env PATH. */
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Exact env allow-list (never inherits process.env unless host copies values in). */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface CodingCheckToolOptions {
  readonly executionPolicy?: ExecutionPolicy;
  readonly checks: Readonly<Record<string, NamedCheckDefinition>>;
  readonly maxConcurrency?: number;
  readonly maxDiagnosticLines?: number;
  readonly maxOutputBytes?: number;
  readonly defaultTimeoutMs?: number;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "coding_check",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function validateCheckMap(
  checks: Readonly<Record<string, NamedCheckDefinition>>,
): ReadonlyMap<string, NamedCheckDefinition> {
  const names = Object.keys(checks);
  if (names.length < 1) throw new Error("checks must declare at least one named command");
  validateCodingLimit("checkNames", names.length, HARD_MAX_CHECK_NAMES);
  const map = new Map<string, NamedCheckDefinition>();
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(`invalid check name: ${name}`);
    }
    const def = checks[name]!;
    if (!def || typeof def.file !== "string" || def.file.length === 0) {
      throw new Error(`check ${name} requires a non-empty file`);
    }
    if (!Array.isArray(def.args) || def.args.some((a) => typeof a !== "string" || a.includes("\0"))) {
      throw new Error(`check ${name} args must be strings without NUL`);
    }
    map.set(name, def);
  }
  void DEFAULT_MAX_CHECK_NAMES;
  return map;
}

async function runNamedCheck(
  def: NamedCheckDefinition,
  cwd: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    maxLines: number;
    maxBytes: number;
  },
): Promise<{ exitCode: number | null; output: string; timedOut: boolean; aborted: boolean }> {
  if (options.signal?.aborted) {
    return { exitCode: null, output: "", timedOut: false, aborted: true };
  }

  const displayBytes = Math.min(50 * 1024, HARD_MAX_BYTES, options.maxBytes);
  const accumulator = new OutputAccumulator({
    maxLines: options.maxLines,
    maxBytes: displayBytes,
    maxTotalOutputBytes: options.maxBytes,
    tempFilePrefix: "prism-check",
  });

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let child: ChildProcessByStdio<null, Readable, Readable>;
    let timer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      accumulator.finish();
      const snap = accumulator.snapshot({ persistIfTruncated: false });
      if (snap.fullOutputPath) {
        void rm(snap.fullOutputPath, { force: true }).catch(() => undefined);
      }
      resolve({
        exitCode,
        output: snap.content,
        timedOut,
        aborted,
      });
    };

    const onAbort = () => {
      aborted = true;
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

    try {
      const env = { PATH: "/usr/bin:/bin", LANG: "C", ...(def.env ?? {}) };
      child = spawn(def.file, [...def.args], {
        cwd: def.cwd ?? cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => accumulator.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => accumulator.append(chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => finish(code));

    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Create the `coding_check` tool. Model may only select a declared name — never
 * executable path or arguments.
 */
export function createCodingCheckTool(cwd: string, options: CodingCheckToolOptions): ToolDefinition {
  const checks = validateCheckMap(options.checks);
  const maxConcurrency = validateCodingLimit(
    "maxConcurrency",
    options.maxConcurrency ?? DEFAULT_MAX_CHECK_CONCURRENCY,
    HARD_MAX_CHECK_CONCURRENCY,
  );
  const maxDiagnosticLines = validateCodingLimit(
    "maxDiagnosticLines",
    options.maxDiagnosticLines ?? DEFAULT_MAX_CHECK_DIAGNOSTIC_LINES,
    HARD_MAX_CHECK_DIAGNOSTIC_LINES,
  );
  const maxOutputBytes = validateCodingLimit(
    "maxOutputBytes",
    options.maxOutputBytes ?? DEFAULT_MAX_CHECK_OUTPUT_BYTES,
    HARD_MAX_CHECK_OUTPUT_BYTES,
  );
  const defaultTimeoutMs = validateCodingLimit(
    "defaultTimeoutMs",
    options.defaultTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    HARD_CHECK_TIMEOUT_MS,
  );
  const semaphore = new Semaphore(maxConcurrency);
  const names = [...checks.keys()].sort();

  return {
    name: "coding_check",
    description: `Run a host-declared named check. Allowed names: ${names.join(", ")}. The model cannot choose executables or arguments.`,
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Declared check name",
          enum: names,
        },
      },
      required: ["name"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
      const name = typeof args.name === "string" ? args.name : "";
      const def = checks.get(name);
      if (!def) return errorResult(toolCallId, `unknown check name: ${name}`);

      if (!isAbsolute(def.file) && !(def.env && typeof def.env.PATH === "string")) {
        return errorResult(
          toolCallId,
          `check ${name} file must be absolute unless env.PATH is explicitly provided`,
        );
      }

      const timeoutMs = validateCodingLimit(
        "timeoutMs",
        def.timeoutMs ?? defaultTimeoutMs,
        HARD_CHECK_TIMEOUT_MS,
      );

      const policyCheck = await enforceExecutionPolicy(
        options.executionPolicy,
        {
          kind: "check",
          operation: name,
          paths: [def.cwd ?? cwd],
          risk: "medium",
          metadata: {
            checkName: name,
            file: def.file,
            args: def.args,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        },
        toolCallId,
        "coding_check",
      );
      if (!policyCheck.allowed) return policyCheck.result;

      await semaphore.acquire();
      try {
        const result = await runNamedCheck(def, cwd, {
          signal: context.signal,
          timeoutMs,
          maxLines: maxDiagnosticLines,
          maxBytes: maxOutputBytes,
        });
        if (result.aborted) return errorResult(toolCallId, "Operation aborted");
        if (result.timedOut) {
          return {
            toolCallId,
            name: "coding_check",
            content: [{ type: "text", text: `${result.output}\n[check timed out]`.trim() }],
            error: { message: `check ${name} timed out` },
            metadata: { name, exitCode: result.exitCode, timedOut: true },
          };
        }
        const footer = result.exitCode === 0 ? "" : `\n[check exited with code ${result.exitCode}]`;
        return {
          toolCallId,
          name: "coding_check",
          content: [
            {
              type: "text",
              text: `${result.output}${footer}`.trim() || `(check ${name} produced no output)`,
            },
          ],
          metadata: {
            name,
            exitCode: result.exitCode,
            summary: result.exitCode === 0 ? "passed" : `failed (${result.exitCode})`,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      } finally {
        semaphore.release();
      }
    },
  };
}
