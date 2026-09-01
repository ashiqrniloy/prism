/**
 * Bounded, shell-free Obscura CLI runner for one-shot `fetch`/`scrape` operations.
 * Child processes are killed on timeout/abort, output is capped and collected
 * linearly, and diagnostics never echo the configured argv.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { assertSsrfAllowedUrl } from "@arnilo/prism";
import { ObscuraError } from "./errors.js";
import type { ObscuraProcessLimits } from "./limits.js";
import { resolveObscuraProcessLimits } from "./limits.js";
import { validateObscuraCommand } from "./process.js";

export interface ObscuraCliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly exitCode: number | null;
}

export interface ObscuraCliRunOptions {
  readonly command: string;
  /** Subcommand and its arguments, e.g. `["fetch", "https://example.com", "--dump", "markdown"]`. */
  readonly args?: readonly string[];
  /**
   * Fixed argv placed before the subcommand — e.g. a script path for wrapped
   * executables or `["run", "--rm", "-i", "image"]` for Docker. Never host-controlled.
   */
  readonly argsBefore?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly limits?: Partial<ObscuraProcessLimits>;
  readonly signal?: AbortSignal;
  /** Wall-clock kill deadline for the child; bounded by the resolved web timeout. */
  readonly timeoutMs?: number;
  /** Cap on retained stdout (2 MiB default, 8 MiB hard ceiling enforced by callers). */
  readonly maxOutputBytes?: number;
}

function collect(child: ChildProcess, stream: "stdout" | "stderr", maxBytes: number): { text: () => string; truncated: () => boolean } {
  let size = 0;
  let truncated = false;
  const chunks: Buffer[] = [];
  child[stream]!.on("data", (chunk: Buffer) => {
    if (size >= maxBytes) {
      truncated = true;
      return;
    }
    const take = chunk.subarray(0, maxBytes - size);
    if (take.byteLength < chunk.byteLength) truncated = true;
    size += take.byteLength;
    chunks.push(take);
  });
  return { text: () => Buffer.concat(chunks, size).toString("utf8"), truncated: () => truncated };
}

function kill(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

/** Run one bounded Obscura CLI operation; rejects with redacted diagnostics on any failure. */
export async function runObscuraCli(options: ObscuraCliRunOptions): Promise<ObscuraCliRunResult> {
  const limits = resolveObscuraProcessLimits(options.limits);
  const args = [...(options.argsBefore ?? []), ...(options.args ?? [])];
  validateObscuraCommand({ command: options.command, args }, limits);
  if (options.signal?.aborted) throw new ObscuraError("ERR_OBSCURA_ABORTED", "obscura cli aborted before start");

  const child = spawn(options.command, args, {
    env: { PATH: process.env.PATH ?? "", ...(options.env ?? {}) },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const maxOutput = options.maxOutputBytes ?? 2 * 1024 * 1024;
  if (!Number.isFinite(maxOutput) || maxOutput <= 0 || maxOutput > 8 * 1024 * 1024) {
    throw new ObscuraError("ERR_OBSCURA_LIMIT", "maxOutputBytes out of range");
  }
  const stdout = collect(child, "stdout", maxOutput);
  const stderr = collect(child, "stderr", 64 * 1024);

  return await new Promise<ObscuraCliRunResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      settled = true;
      kill(child);
      reject(new ObscuraError("ERR_OBSCURA_ABORTED", "obscura cli aborted"));
    };
    const deadline = options.timeoutMs ?? 30_000;
    timer = setTimeout(() => {
      settled = true;
      kill(child);
      reject(new ObscuraError("ERR_OBSCURA_TIMEOUT", `obscura cli timed out after ${deadline}ms`));
    }, deadline);
    timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ObscuraError("ERR_OBSCURA_SPAWN", `obscura cli spawn failed: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const stderrText = stderr.text();
      if (code !== 0) {
        reject(
          new ObscuraError("ERR_OBSCURA_CLI", `obscura cli exited with code ${code}${stderrText ? `: ${stderrText.slice(0, 512)}` : ""}`),
        );
        return;
      }
      resolve({ stdout: stdout.text(), stderr: stderrText, truncated: stdout.truncated() || stderr.truncated(), exitCode: code });
    });
  });
}

/** Public HTTP(S) URL validation for anything handed to the Obscura CLI. */
export function validateObscuraWebUrl(input: string, allowedHostnames?: readonly string[]): string {
  try {
    assertSsrfAllowedUrl(input, allowedHostnames === undefined ? {} : { allowedHostnames });
  } catch {
    throw new ObscuraError("ERR_OBSCURA_SSRF", "URL is not a public HTTP(S) target: private, credentialed, or non-HTTP URLs are denied");
  }
  return input;
}
