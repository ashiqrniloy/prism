/**
 * The `command` handler: spawn a process, hand it the event payload as JSON on
 * stdin, read a decision from stdout/stderr.
 *
 * Exit-code contract (Claude/Codex, re-verified 2026-09-20 — there is no code 64):
 *   0 → success; JSON stdout is parsed for a decision
 *   2 → block; stderr is the reason fed back to the model
 *   other → non-blocking error, reported as a warning
 *
 * No shell: the command string is tokenized here (quotes/escapes only, no
 * expansion, no pipes, no substitution) and spawned as an argv array.
 */
import { spawn } from "node:child_process";

import type { CommandHookHandler } from "../schema.js";

/** Event-scoped payload handed to a handler, in the shape both references send. */
export interface HookHandlerInput {
  readonly event: string;
  readonly sessionId?: string;
  readonly runId?: string;
  /** Event-specific keys (`prompt`, `tool_name`, `tool_input`, `tool_response`, `stop_hook_active`, `source`). */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Normalized handler result; the compiler decides what a decision means per event. */
export interface HookOutcome {
  readonly blocked: boolean;
  /** Common-field `continue: false`: the handler asked to stop rather than continue. */
  readonly stopped: boolean;
  readonly reason: string;
  /** `additionalContext` (or `systemMessage`) text to inject, `""` when none. */
  readonly context: string;
  readonly updatedInput?: Readonly<Record<string, unknown>>;
  readonly timedOut: boolean;
  /** Non-blocking failure: spawn error, unexpected exit code, malformed decision. */
  readonly failed: boolean;
  readonly exitCode: number | null;
}

export interface CommandHandlerOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Default timeout in seconds when a handler omits `timeout` (Claude/Codex: 600). */
export const DEFAULT_HANDLER_TIMEOUT_SECONDS = 600;

/** Captured output cap per stream — a chatty handler must not become an OOM. */
const STREAM_CAP = 1024 * 1024;

function emptyOutcome(overrides: Partial<HookOutcome> = {}): HookOutcome {
  return { blocked: false, stopped: false, reason: "", context: "", timedOut: false, failed: false, exitCode: null, ...overrides };
}

/**
 * Tokenize a command string without a shell: whitespace splits, single/double
 * quotes group, backslash escapes the next character. No expansion of any kind.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && index + 1 < command.length) current += command.charAt((index += 1));
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char as '"' | "'";
      started = true;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      current += command.charAt((index += 1));
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current !== "") tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new Error(`unterminated quote in command: ${command}`);
  if (started || current !== "") tokens.push(current);
  return tokens;
}

/** The JSON payload written to a handler's stdin (Claude/Codex-compatible keys). */
export function hookStdinPayload(input: HookHandlerInput, cwd: string): Record<string, unknown> {
  return {
    ...input.payload,
    hook_event_name: input.event,
    ...(input.sessionId === undefined ? {} : { session_id: input.sessionId }),
    ...(input.runId === undefined ? {} : { run_id: input.runId }),
    cwd,
    permission_mode: "default",
  };
}

/** Parse a handler's JSON stdout into a decision. Missing/unknown keys mean "no opinion". */
export function parseHookDecision(stdout: string, exitCode: number | null, stderr: string): HookOutcome {
  const trimmed = stdout.trim();
  let parsed: unknown;
  if (trimmed !== "") {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return emptyOutcome({
        exitCode,
        // Exit 2 blocks with stderr; a non-JSON stdout on exit 0 is simply not a decision.
        blocked: exitCode === 2,
        reason: exitCode === 2 ? stderr.trim() : "",
        failed: exitCode !== 0 && exitCode !== 2,
      });
    }
  }
  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const specific =
    typeof record.hookSpecificOutput === "object" && record.hookSpecificOutput !== null
      ? (record.hookSpecificOutput as Record<string, unknown>)
      : {};

  const permission = specific.permissionDecision ?? record.permissionDecision;
  const decision = specific.decision ?? record.decision;
  // `continue: false` is the common-field stop signal (Claude stops processing, Codex marks the turn
  // stopped and lets it win over continuation decisions). It reads as a refusal on a tool/input event,
  // so `blocked` keeps its per-event meaning while `stopped` carries the explicit stop.
  const stopped = record.continue === false;
  const blocked = exitCode === 2 || decision === "block" || decision === "deny" || permission === "deny" || stopped;
  const reason = firstString(
    specific.reason ?? specific.permissionDecisionReason ?? record.reason ?? record.stopReason ?? record.permissionDecisionReason,
  );
  const context = firstString(specific.additionalContext ?? record.additionalContext ?? record.systemMessage);
  const updatedInput = specific.updatedInput ?? record.updatedInput;

  return emptyOutcome({
    exitCode,
    blocked,
    stopped,
    reason: reason !== "" ? reason : exitCode === 2 ? stderr.trim() : "",
    context,
    ...(updatedInput !== undefined && typeof updatedInput === "object" && updatedInput !== null && !Array.isArray(updatedInput)
      ? { updatedInput: updatedInput as Readonly<Record<string, unknown>> }
      : {}),
    failed: exitCode !== 0 && exitCode !== 2,
  });
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

/** Run one command handler to completion (or to its timeout). Never rejects. */
export async function runCommandHandler(
  handler: CommandHookHandler,
  input: HookHandlerInput,
  options: CommandHandlerOptions = {},
): Promise<HookOutcome> {
  const cwd = options.cwd ?? process.cwd();
  let argv: string[];
  try {
    argv = tokenizeCommand(handler.command).concat(handler.args ?? []);
  } catch (error) {
    return emptyOutcome({ failed: true, reason: (error as Error).message });
  }
  const [file, ...args] = argv;
  if (file === undefined) return emptyOutcome({ failed: true, reason: "empty command" });

  return new Promise<HookOutcome>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const finish = (outcome: HookOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timeoutMs = (handler.timeout ?? DEFAULT_HANDLER_TIMEOUT_SECONDS) * 1000;
    const child = spawn(file, args, {
      cwd,
      // ponytail: SIGKILL on expiry — a hook that ignores SIGTERM must not hang a turn.
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STREAM_CAP) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STREAM_CAP) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(emptyOutcome({ failed: true, reason: `spawn failed: ${error.message}` })));
    child.on("close", (code) => {
      if (timedOut) {
        finish(
          emptyOutcome({
            timedOut: true,
            exitCode: code,
            reason: `timed out after ${handler.timeout ?? DEFAULT_HANDLER_TIMEOUT_SECONDS}s`,
          }),
        );
        return;
      }
      const outcome = parseHookDecision(stdout, code, stderr);
      if (outcome.failed) {
        finish({ ...outcome, reason: outcome.reason !== "" ? outcome.reason : stderr.trim() || `exited with code ${String(code)}` });
        return;
      }
      finish(outcome);
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(`${JSON.stringify(hookStdinPayload(input, cwd))}\n`);
  });
}
