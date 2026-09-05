import { spawn } from "node:child_process";
import type { ChildEnvOptions } from "./types.js";
import type { ResolvedGraftCli } from "./upstream.js";
import { redactPaths } from "./upstream.js";

/** Fixed overhead subtracted from caller budgets when deriving child timeouts (graft hook rule). */
export const HOOK_OVERHEAD_MS = 2000;
export const MIN_CHILD_TIMEOUT_MS = 4000;
export const DEFAULT_RETRIEVAL_BUDGET_MS = 8000;
export const DEFAULT_MAX_RESULT_BYTES = 524_288;
export const DEFAULT_STDERR_TAIL_CHARS = 2000;

/**
 * Fixed-base environment for graft children: no inherited secrets. Only
 * well-known `GRAFT_*` keys from host-supplied `providerEnv` pass through,
 * plus `DO_NOT_TRACK=1` unless telemetry is explicitly allowed.
 */
export function childEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH?.split(":").filter(Boolean).join(":") || "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    LANG: "C.UTF-8",
  };
  if (!options.allowUpstreamTelemetry) env.DO_NOT_TRACK = "1";
  for (const [key, value] of Object.entries(options.providerEnv ?? {})) {
    if (/^GRAFT_[A-Z0-9_]+$/.test(key)) env[key] = value;
  }
  return env;
}

/** Derive a child timeout from a caller budget: budget − 2s overhead, floored at 4s. */
export function childTimeoutMs(budgetMs: number | undefined, fallback = DEFAULT_RETRIEVAL_BUDGET_MS): number {
  const budget = typeof budgetMs === "number" && Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : fallback;
  return Math.max(MIN_CHILD_TIMEOUT_MS, budget - HOOK_OVERHEAD_MS);
}

export type RunGraftFailureReason = "timeout" | "overflow" | "spawn-error" | "parse-error" | "aborted";

export interface RunGraftResult<T = unknown> {
  /** False when the child exited non-zero (graft `check` exits 1 while stale yet prints valid JSON — still recoverable). */
  readonly ok: boolean;
  /** Parsed stdout JSON, or `null` when the call failed outright (caller skips silently). */
  readonly value: T | null;
  readonly reason?: RunGraftFailureReason;
  /** Redacted, bounded failure detail (stderr tail) for structured error mapping. */
  readonly detail?: string;
}

export interface RunGraftJsonOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

function logFailure(reason: RunGraftFailureReason, detail: string): void {
  console.error(`[prism-graft] graft cli ${reason}: ${redactPaths(detail).slice(0, 400)}`);
}

/**
 * Spawn the resolved graft CLI with array argv (never a shell), collect stdout up to
 * `maxResultBytes` (kill-and-discard beyond), parse as JSON, and recover JSON from
 * non-zero exits. Never throws; resolves `{ ok, value }` with `value: null` on failure.
 */
export function runGraftJson<T = unknown>(
  cli: ResolvedGraftCli,
  args: readonly string[],
  options: RunGraftJsonOptions = {},
): Promise<RunGraftResult<T>> {
  const maxBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  return new Promise((resolvePromise) => {
    let settled = false;
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    const chunks: Buffer[] = [];
    let stderrTail = "";

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cli.command, [...cli.args, ...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      logFailure("spawn-error", error instanceof Error ? error.message : String(error));
      resolvePromise({ ok: false, value: null, reason: "spawn-error" });
      return;
    }

    const finish = (result: RunGraftResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };

    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGKILL");
      },
      Math.max(1, options.timeoutMs ?? DEFAULT_RETRIEVAL_BUDGET_MS),
    );

    const onAbort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (overflow || settled) return;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        overflow = true;
        chunks.length = 0;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-DEFAULT_STDERR_TAIL_CHARS);
    });

    child.on("error", (error) => {
      logFailure("spawn-error", error.message);
      finish({ ok: false, value: null, reason: "spawn-error" });
    });

    child.on("close", () => {
      if (timedOut && !settled) {
        logFailure("timeout", `exceeded ${options.timeoutMs}ms`);
        finish({ ok: false, value: null, reason: "timeout" });
        return;
      }
      if (overflow) {
        logFailure("overflow", `stdout exceeded ${maxBytes} bytes; killed and discarded`);
        finish({ ok: false, value: null, reason: "overflow" });
        return;
      }
      if (options.signal?.aborted && !settled) {
        finish({ ok: false, value: null, reason: "aborted" });
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        finish({ ok: child.exitCode === 0, value: JSON.parse(raw) as T });
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid json";
        logFailure("parse-error", `${message} :: ${stderrTail}`);
        finish({ ok: false, value: null, reason: "parse-error", detail: redactPaths(stderrTail) });
      }
    });
  });
}
