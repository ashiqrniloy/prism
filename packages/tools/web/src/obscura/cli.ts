/**
 * Bounded, shell-free Obscura CLI runner for one-shot `fetch`/`scrape` operations.
 * Child processes are killed on timeout/abort, output is capped and collected
 * linearly, and diagnostics never echo the configured argv.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { isIP } from "node:net";
import {
  assertSsrfAllowedUrl,
  defaultResolver,
  type MediaHostAddress,
  type MediaHostnameResolver,
  normalizeHostname,
} from "@arnilo/prism";
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

/** First Obscura release whose HTTP client re-validates every redirect hop and resolves through `SsrfGuardResolver`. */
export const OBSCURA_GUARDED_VERSION = "0.1.8";

/**
 * Leading semver of an `obscura --version` line, or `undefined` when it is missing or a source build
 * (`0.1.0-dev+<sha>`), which cannot be assumed to carry the per-hop guard.
 */
export function parseObscuraVersion(output: string): string | undefined {
  const line = output
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find((part) => /\b\d+\.\d+\.\d+\b/u.test(part));
  if (line === undefined || /-dev(?![\w])/iu.test(line)) return undefined;
  const match = line.match(/\b(\d+)\.(\d+)\.(\d+)\b/u);
  return match === null ? undefined : `${match[1]}.${match[2]}.${match[3]}`;
}

/** True when `version` is at least {@link OBSCURA_GUARDED_VERSION}. */
export function obscuraVersionIsGuarded(version: string | undefined): boolean {
  if (version === undefined) return false;
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major > 0 || minor > 1 || (minor === 1 && patch >= 8);
}

export interface ObscuraVersionProbeOptions {
  readonly command: string;
  readonly argsBefore?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ObscuraVersionProbe {
  readonly version?: string;
  /** False when the probe failed, the output was unparseable, or the version predates the guard. */
  readonly guarded: boolean;
}

/** One bounded `obscura --version` run per package setup; any failure is a "not guarded" result. */
export async function probeObscuraVersion(options: ObscuraVersionProbeOptions): Promise<ObscuraVersionProbe> {
  try {
    const run = await runObscuraCli({
      command: options.command,
      ...(options.argsBefore === undefined ? {} : { argsBefore: options.argsBefore }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      args: ["--version"],
      timeoutMs: options.timeoutMs ?? 5_000,
      maxOutputBytes: 64 * 1024,
    });
    const version = parseObscuraVersion(run.stdout.trim() === "" ? run.stderr : run.stdout);
    return { ...(version === undefined ? {} : { version }), guarded: obscuraVersionIsGuarded(version) };
  } catch {
    return { guarded: false };
  }
}

export interface ValidateObscuraUrlOptions {
  readonly allowedHostnames?: readonly string[];
  readonly resolver?: MediaHostnameResolver;
  readonly signal?: AbortSignal;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

/** Public HTTP(S) URL validation and DNS pre-resolution for anything handed to the Obscura CLI. */
export async function validateObscuraWebUrl(
  input: string,
  options?: readonly string[] | ValidateObscuraUrlOptions,
): Promise<string> {
  const opts: ValidateObscuraUrlOptions =
    options === undefined || isStringArray(options)
      ? { allowedHostnames: options }
      : options;
  const allowedHostnames = opts.allowedHostnames;
  const resolver = opts.resolver ?? defaultResolver;
  const signal = opts.signal;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ObscuraError("ERR_OBSCURA_SSRF", "URL is not a public HTTP(S) target: private, credentialed, or non-HTTP URLs are denied");
  }

  try {
    assertSsrfAllowedUrl(input, allowedHostnames === undefined ? {} : { allowedHostnames });
  } catch {
    throw new ObscuraError("ERR_OBSCURA_SSRF", "URL is not a public HTTP(S) target: private, credentialed, or non-HTTP URLs are denied");
  }

  const hostname = normalizeHostname(parsed.hostname);
  const family = isIP(hostname);
  if (family !== 0) {
    // Literal IP address was already validated by assertSsrfAllowedUrl.
    return input;
  }

  if (signal?.aborted) throw new ObscuraError("ERR_OBSCURA_ABORTED", "obscura dns resolution aborted");

  let addresses: readonly MediaHostAddress[];
  try {
    addresses = await resolver(hostname, signal ?? new AbortController().signal);
  } catch (error) {
    if (signal?.aborted) throw new ObscuraError("ERR_OBSCURA_ABORTED", "obscura dns resolution aborted");
    throw new ObscuraError("ERR_OBSCURA_SSRF", `Failed to resolve hostname for Obscura target: ${hostname}`, { cause: error });
  }

  if (!addresses || addresses.length === 0) {
    throw new ObscuraError("ERR_OBSCURA_SSRF", `Obscura target ${hostname} returned no addresses`);
  }

  for (const candidate of addresses) {
    const candidateNormalized = normalizeHostname(candidate.address);
    if (isIP(candidateNormalized) !== candidate.family) {
      throw new ObscuraError("ERR_OBSCURA_SSRF", "obscura hostname resolver returned an invalid address");
    }
    const literal = candidate.family === 6 ? `[${candidateNormalized}]` : candidateNormalized;
    try {
      assertSsrfAllowedUrl(`${parsed.protocol}//${literal}`);
    } catch {
      throw new ObscuraError(
        "ERR_OBSCURA_SSRF",
        `Obscura target ${hostname} resolved to a private or denied address (${candidateNormalized})`,
      );
    }
  }

  return input;
}
