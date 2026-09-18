import { spawn } from "node:child_process";
import * as path from "node:path";
import { WorkToolError } from "./errors.js";
import { resolveWorkLimits } from "./limits.js";
import type { ResolvedWorkLimits, WorkCliExecResult, WorkCliRunner, WorkLimits } from "./types.js";

const FORBIDDEN_TOKENS = new Set([
  "login",
  "logout",
  "setup",
  "doctor",
  "status",
  "request",
  "util",
  "cli",
  "auth",
  "schema", // gws interactive auth + Discovery free-form introspection
  "--debug",
  "--verbose",
  "-debug",
  "-verbose",
]);

export function assertSafeArgv(argv: readonly string[]): void {
  if (argv.length === 0) throw new WorkToolError("ERR_PRISM_WORK_ARGV", "CLI argv empty");
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.includes("\0")) throw new WorkToolError("ERR_PRISM_WORK_ARGV", "CLI argv invalid");
    const lower = arg.toLowerCase();
    if (FORBIDDEN_TOKENS.has(lower)) throw new WorkToolError("ERR_PRISM_WORK_FORBIDDEN", `Forbidden CLI token: ${arg}`);
    if (lower.startsWith("--debug") || lower.startsWith("--verbose")) {
      throw new WorkToolError("ERR_PRISM_WORK_FORBIDDEN", `Forbidden CLI flag: ${arg}`);
    }
  }
}

// --- Plan 020 Task 3: isolated subprocess environment ------------------------

/**
 * Fixed platform base allow-list (canonical casing). The child inherits ONLY these
 * locale/system keys from the host — never ambient variables, so unrelated secrets
 * (e.g. `PRISM_PROOF_SECRET`) cannot reach the subprocess. Future additions are
 * deliberate one-line changes reviewed like any allow-list edit.
 */
const BASE_ENV_KEYS: readonly string[] = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "SYSTEMROOT", // Windows system root; SystemRoot below covers hosts exposing the alternate casing
  "SystemRoot",
  "TEMP",
  "TMP",
  "PATHEXT",
  "COMSPEC",
];

/** Fixed controls forced last so neither explicit host env nor per-identity token env can override isolation fields. */
const RESERVED_ENV = new Set(["home", "climicrosoft365_disabletelemetry"]);

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Fixed env caps mirroring docker-sandbox defaults (plan 020 Task 0; promotion to WorkLimits is demand-gated). */
const MAX_ENV_NAMES = 64;
const MAX_ENV_BYTES = 64 * 1024;
const IS_WIN32 = process.platform === "win32";

/** Fixed platform base: allow-listed host keys only. */
function baseEnv(host: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  if (IS_WIN32) {
    // Windows env keys are case-insensitive and child_process picks the first
    // lexicographic duplicate; canonicalize to the allow-list casing so a
    // case-variant duplicate in the host can never be selected.
    const seen = new Set<string>();
    for (const key of BASE_ENV_KEYS) {
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      const value = host[key];
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  for (const key of BASE_ENV_KEYS) {
    const value = host[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** One bounded env layer: rejects NUL, invalid names, non-strings, and reserved/case-variant duplicates. */
function validateEnvLayer(env: Readonly<Record<string, string>>, layer: string): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (name.includes("\0") || value.includes("\0")) throw new WorkToolError("ERR_PRISM_WORK_ENV", `${layer} env contains NUL`);
    if (!ENV_NAME_RE.test(name)) throw new WorkToolError("ERR_PRISM_WORK_ENV", `${layer} env name invalid: ${name}`);
    const folded = name.toLowerCase();
    if (RESERVED_ENV.has(folded)) throw new WorkToolError("ERR_PRISM_WORK_ENV", `${layer} env may not override reserved key: ${name}`);
    if (seen.has(folded)) throw new WorkToolError("ERR_PRISM_WORK_ENV", `${layer} env duplicate key: ${name}`);
    seen.add(folded);
    out[name] = value;
  }
  return out;
}

function enforceEnvCaps(env: Record<string, string>): void {
  const names = Object.keys(env).length;
  if (names > MAX_ENV_NAMES) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", `CLI env exceeds ${MAX_ENV_NAMES} names`);
  let bytes = 0;
  for (const [name, value] of Object.entries(env)) {
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > MAX_ENV_BYTES) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", `CLI env exceeds ${MAX_ENV_BYTES} bytes`);
  }
}

function mergeEnv(base: Record<string, string>, layer: Record<string, string>): Record<string, string> {
  const out = { ...base, ...layer };
  enforceEnvCaps(out);
  return out;
}

/**
 * Construction-time environment: fixed platform base, then explicit host allow-list,
 * then forced reserved controls. Bounded (≤64 names / 64 KiB) and validated before spawn.
 */
function buildCliEnvironment(
  host: NodeJS.ProcessEnv,
  explicit: Readonly<Record<string, string>> | undefined,
  configDir: string,
): Record<string, string> {
  const out = mergeEnv(baseEnv(host), validateEnvLayer(explicit ?? {}, "host"));
  out.HOME = configDir;
  out.CLIMICROSOFT365_DISABLETELEMETRY = "1";
  enforceEnvCaps(out);
  return out;
}

/** Per-call late-bound layer: per-identity token env merges over the base; reserved keys are rejected. */
function mergeTokenEnv(
  base: Readonly<Record<string, string>>,
  token: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (token === undefined || Object.keys(token).length === 0) return { ...base };
  return mergeEnv({ ...base }, validateEnvLayer(token, "token"));
}

// --- Plan 020 Task 3: linear output capture ----------------------------------

/**
 * Chunk-array output collector: one final `Buffer.concat(chunks, retained)` instead of
 * repeated concat (worst-case O(n²)); retained bytes never exceed the cap because the
 * overflow handler fires before the offending chunk is retained.
 */
function collectOutput(limit: number, onOverflow: () => void): { push(chunk: Buffer): void; toString(): string } {
  const chunks: Buffer[] = [];
  let retained = 0;
  return {
    push(chunk) {
      const next = retained + chunk.byteLength;
      if (next > limit) {
        onOverflow();
        return;
      }
      retained = next;
      chunks.push(chunk);
    },
    toString() {
      return Buffer.concat(chunks, retained).toString("utf8");
    },
  };
}

export function createCliRunner(options: {
  readonly binary: string;
  readonly configDir: string;
  readonly limits?: WorkLimits;
  readonly env?: Readonly<Record<string, string>>;
  /** Test seam: replace process spawn. */
  readonly exec?: (
    argv: readonly string[],
    opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal; limits: ResolvedWorkLimits },
  ) => Promise<WorkCliExecResult>;
}): WorkCliRunner & { readonly limits: ResolvedWorkLimits } {
  const limits = resolveWorkLimits(options.limits);
  if (!options.binary || options.binary.includes("\0") || !path.isAbsolute(options.binary)) {
    throw new WorkToolError("ERR_PRISM_WORK_BINARY", "Host-pinned absolute binary required");
  }
  if (!options.configDir || options.configDir.includes("\0") || !path.isAbsolute(options.configDir)) {
    throw new WorkToolError("ERR_PRISM_WORK_CONFIG", "Isolated absolute configDir required");
  }
  let active = 0;

  const defaultExec = (
    argv: readonly string[],
    opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal; limits: ResolvedWorkLimits },
  ): Promise<WorkCliExecResult> =>
    new Promise((resolve, reject) => {
      assertSafeArgv(argv);
      const child = spawn(options.binary, [...argv], {
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let settled = false;
      const finish = (err?: Error, result?: WorkCliExecResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(result!);
      };
      const onAbort = () => {
        child.kill("SIGKILL");
        finish(new WorkToolError("ERR_PRISM_WORK_ABORTED", "CLI process aborted or timed out"));
      };
      const timeout = setTimeout(onAbort, opts.limits.timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      // Kill and reject before retaining bytes beyond the stdout/stderr caps.
      const stdout = collectOutput(opts.limits.maxStdoutBytes, () => {
        child.kill("SIGKILL");
        finish(new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI stdout exceeds byte limit"));
      });
      const stderr = collectOutput(opts.limits.maxStderrBytes, () => {
        child.kill("SIGKILL");
        finish(new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI stderr exceeds byte limit"));
      });
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => finish(new WorkToolError("ERR_PRISM_WORK_SPAWN", error.message)));
      child.on("close", (code) => {
        finish(undefined, {
          exitCode: code,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      });
    });

  const execImpl = options.exec ?? defaultExec;
  const env = buildCliEnvironment(process.env, options.env, options.configDir);

  return {
    limits,
    async exec(argv, runOpts) {
      assertSafeArgv(argv);
      if (active >= limits.maxConcurrency) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI concurrency exhausted");
      active++;
      try {
        const timeout = AbortSignal.timeout(limits.timeoutMs);
        const signal = runOpts?.signal ? AbortSignal.any([runOpts.signal, timeout]) : timeout;
        // Late-bound per-identity token env merges over the base env; never touches argv.
        const execEnv = mergeTokenEnv(env, runOpts?.env);
        return await execImpl(argv, { env: execEnv, signal, limits });
      } finally {
        active--;
      }
    },
  };
}

export function parseCliJson(stdout: string, limits: ResolvedWorkLimits): unknown {
  const text = stdout.trim();
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkToolError("ERR_PRISM_WORK_JSON", "CLI returned invalid JSON");
  }
  assertBoundedJson(value, limits.maxJsonDepth, limits.maxJsonProperties, limits.maxResponseBytes);
  return value;
}

/**
 * Strict NDJSON parse for `gws --page-all` streams.
 * Caps lines by maxPaginationPages; each line must be a single JSON value.
 */
export function parseCliNdjson(stdout: string, limits: ResolvedWorkLimits): unknown[] {
  const text = stdout.replace(/\r\n/g, "\n").trimEnd();
  if (!text.trim()) return [];
  const lines = text.split("\n");
  if (lines.length > limits.maxPaginationPages) {
    throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "NDJSON page stream exceeds pagination page limit");
  }
  const out: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new WorkToolError("ERR_PRISM_WORK_JSON", "CLI returned invalid NDJSON line");
    }
    assertBoundedJson(value, limits.maxJsonDepth, limits.maxJsonProperties, limits.maxResponseBytes);
    out.push(value);
    if (out.length > limits.maxAggregateItems) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "NDJSON aggregate exceeds item limit");
    }
  }
  return out;
}

export function assertBoundedJson(value: unknown, maxDepth: number, maxProperties: number, maxBytes: number): void {
  let properties = 0;
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch {
    throw new WorkToolError("ERR_PRISM_WORK_JSON", "JSON value is cyclic or unserializable");
  }
  if (bytes > maxBytes) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "JSON value exceeds byte limit");
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length) {
    const [entry, depth] = stack.pop()!;
    if (depth > maxDepth) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "JSON value exceeds depth limit");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new WorkToolError("ERR_PRISM_WORK_JSON", "JSON number must be finite");
      continue;
    }
    if (typeof entry !== "object") throw new WorkToolError("ERR_PRISM_WORK_JSON", "Value is not JSON");
    const values = Array.isArray(entry) ? entry : Object.values(entry);
    if (!Array.isArray(entry)) {
      for (const key of Object.keys(entry as object)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
          throw new WorkToolError("ERR_PRISM_WORK_JSON", "JSON contains forbidden key");
        }
      }
      properties += values.length;
      if (properties > maxProperties) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "JSON value exceeds property limit");
    }
    for (const child of values) stack.push([child, depth + 1]);
  }
}
