import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "@arnilo/prism";

/** The wall-clock limit of one check when the host sets none, in milliseconds. */
export const DEFAULT_CHECK_TIMEOUT_MS = 30_000;
/** The most a host may raise the limit to. */
export const MAX_CHECK_TIMEOUT_MS = 120_000;
/** The most bytes of the child's result, and of each of its output streams, that the runner keeps. */
export const MAX_CHECK_OUTPUT_BYTES = 1024 * 1024;

const CHILD = join(import.meta.dirname, "child.ts");
/** The only variables of the server's own environment a check child inherits, besides `--pass-env` names. */
const INHERITED_ENV = ["PATH", "HOME", "TMPDIR", "PRISM_HOME"] as const;
/** A value shorter than this is not treated as a secret to mask: it would shred unrelated text. */
const MIN_SECRET_LENGTH = 6;

export type CheckKind = "inspect" | "manifest" | "conformance";

export interface CheckFailure {
  /** A stable `ERR_PRISM_*` code when the failure has one. */
  readonly code?: string;
  readonly message: string;
}

/** What a check returns. Nothing else is added: the typed `result` is the check's own. */
export interface CheckOutcome<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: CheckFailure;
  /** The child was killed at the time limit. */
  readonly timedOut: boolean;
  /** The result or an output stream was cut at {@linkcode MAX_CHECK_OUTPUT_BYTES}. */
  readonly truncated: boolean;
}

export interface RunCheckOptions {
  readonly kind: CheckKind;
  /** The host project: the child's working directory, and where it resolves `@arnilo/prism` from. */
  readonly root: string;
  /** Absolute path of the file to import (`inspect`, `conformance`). */
  readonly file?: string;
  /** Name of the export to use (`inspect`, `conformance`). */
  readonly exportName?: string;
  /** `manifest` only: let project-scope packages be imported. */
  readonly trustProject?: boolean;
  readonly timeoutMs?: number;
  /** Extra variables the child may see, by name. Their values are also masked in the result. */
  readonly passEnv?: readonly string[];
  /** The environment to filter. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

/** The child's environment: the four inherited names that are set, the `--pass-env` names, and the check marker. */
export function childEnv(passEnv: readonly string[] = [], source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...INHERITED_ENV, ...passEnv]) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  env.PRISM_HOST_BUILDER_CHECK = "1";
  return env;
}

function capped(chunks: Buffer[], size: { bytes: number }, chunk: Buffer, state: { truncated: boolean }): void {
  const room = MAX_CHECK_OUTPUT_BYTES - size.bytes;
  if (room <= 0) {
    state.truncated = true;
    return;
  }
  const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
  if (kept.byteLength < chunk.byteLength) state.truncated = true;
  chunks.push(kept);
  size.bytes += kept.byteLength;
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    // A negative pid is the process group: the child leads one (`detached`), so its own children go with it.
    process.kill(-pid, "SIGKILL");
  } catch {
    // ESRCH: already gone.
  }
}

function tail(text: string, secrets: readonly string[]): string {
  const cut = text.length > 2000 ? `…${text.slice(-2000)}` : text;
  return redactSecrets(cut, secrets).trim();
}

/**
 * Runs one check in a child `bun` process and returns its outcome. The child gets the allowlisted environment
 * of {@linkcode childEnv} and the host project as its working directory; it is killed with its whole process
 * group at the time limit and again after it exits, so nothing it started outlives the call. The result comes
 * back through a file, so host code that prints to stdout cannot corrupt it. Every string in the outcome is
 * masked with the values of the `--pass-env` variables.
 */
export async function runCheck<T>(options: RunCheckOptions): Promise<CheckOutcome<T>> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS, MAX_CHECK_TIMEOUT_MS);
  const env = childEnv(options.passEnv, options.env);
  const secrets = (options.passEnv ?? [])
    .map((name) => (options.env ?? process.env)[name])
    .filter((value): value is string => value !== undefined && value.length >= MIN_SECRET_LENGTH);
  const work = mkdtempSync(join(tmpdir(), "host-builder-check-"));
  const resultFile = join(work, "result.json");
  const args = [CHILD, options.kind, resultFile];
  if (options.file !== undefined) args.push(options.file, options.exportName ?? "default");
  if (options.trustProject === true) args.push("--trust-project");

  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const outSize = { bytes: 0 };
  const errSize = { bytes: 0 };
  const state = { truncated: false };
  let timedOut = false;
  try {
    const child = spawn(process.execPath, args, { cwd: options.root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => capped(out, outSize, chunk, state));
    child.stderr.on("data", (chunk: Buffer) => capped(err, errSize, chunk, state));
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);
    const code = await new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", (exit) => resolve(exit));
    });
    clearTimeout(timer);
    killGroup(child.pid);

    if (timedOut)
      return {
        ok: false,
        error: { message: `The check did not finish within ${timeoutMs / 1000}s and was killed.` },
        timedOut: true,
        truncated: state.truncated,
      };

    let raw: string | undefined;
    try {
      if (statSync(resultFile).size > MAX_CHECK_OUTPUT_BYTES) {
        return {
          ok: false,
          error: { message: `The check result is larger than ${MAX_CHECK_OUTPUT_BYTES} bytes and was dropped.` },
          timedOut: false,
          truncated: true,
        };
      }
      raw = readFileSync(resultFile, "utf8");
    } catch {
      raw = undefined;
    }
    if (raw === undefined) {
      const detail = tail(Buffer.concat(err).toString("utf8") || Buffer.concat(out).toString("utf8"), secrets);
      return {
        ok: false,
        error: {
          message: `The check exited with ${code === null ? "an error" : `code ${code}`} before it reported a result.${detail ? ` ${detail}` : ""}`,
        },
        timedOut: false,
        truncated: state.truncated,
      };
    }
    const parsed = JSON.parse(raw) as { ok: boolean; value?: T; code?: string; message?: string };
    const outcome: CheckOutcome<T> = parsed.ok
      ? { ok: true, result: parsed.value as T, timedOut: false, truncated: state.truncated }
      : {
          ok: false,
          error: { ...(parsed.code === undefined ? {} : { code: parsed.code }), message: parsed.message ?? "The check failed." },
          ...(parsed.value === undefined ? {} : { result: parsed.value }),
          timedOut: false,
          truncated: state.truncated,
        };
    return redactSecrets(outcome, secrets);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
