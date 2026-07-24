import { spawn } from "node:child_process";
import { resolveWorkLimits } from "./limits.js";
import { WorkToolError } from "./errors.js";
import type { ResolvedWorkLimits, WorkCliExecResult, WorkCliRunner, WorkLimits } from "./types.js";

const FORBIDDEN_TOKENS = new Set([
  "login", "logout", "setup", "doctor", "status", "request", "util", "cli",
  "auth", "schema", // gws interactive auth + Discovery free-form introspection
  "--debug", "--verbose", "-debug", "-verbose",
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

export function createCliRunner(options: {
  readonly binary: string;
  readonly configDir: string;
  readonly limits?: WorkLimits;
  readonly env?: Readonly<Record<string, string>>;
  /** Test seam: replace process spawn. */
  readonly exec?: (argv: readonly string[], opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal; limits: ResolvedWorkLimits }) => Promise<WorkCliExecResult>;
}): WorkCliRunner & { readonly limits: ResolvedWorkLimits } {
  const limits = resolveWorkLimits(options.limits);
  if (!options.binary || options.binary.includes("\0")) throw new WorkToolError("ERR_PRISM_WORK_BINARY", "Host-pinned binary required");
  if (!options.configDir) throw new WorkToolError("ERR_PRISM_WORK_CONFIG", "Isolated configDir required");
  let active = 0;

  const defaultExec = (argv: readonly string[], opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal; limits: ResolvedWorkLimits }): Promise<WorkCliExecResult> =>
    new Promise((resolve, reject) => {
      assertSafeArgv(argv);
      const child = spawn(options.binary, [...argv], {
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
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
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = Buffer.concat([stdout, chunk]);
        if (stdout.byteLength > opts.limits.maxStdoutBytes) {
          child.kill("SIGKILL");
          finish(new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI stdout exceeds byte limit"));
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk]);
        if (stderr.byteLength > opts.limits.maxStderrBytes) {
          child.kill("SIGKILL");
          finish(new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI stderr exceeds byte limit"));
        }
      });
      child.on("error", (error) => finish(new WorkToolError("ERR_PRISM_WORK_SPAWN", error.message)));
      child.on("close", (code) => {
        finish(undefined, {
          exitCode: code,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      });
    });

  const execImpl = options.exec ?? defaultExec;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    HOME: options.configDir,
    // Keep CLI from inheriting interactive telemetry prompts; never pass secrets here.
    CLIMICROSOFT365_DISABLETELEMETRY: "1",
  };

  return {
    limits,
    async exec(argv, runOpts) {
      assertSafeArgv(argv);
      if (active >= limits.maxConcurrency) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI concurrency exhausted");
      active++;
      try {
        const timeout = AbortSignal.timeout(limits.timeoutMs);
        const signal = runOpts?.signal ? AbortSignal.any([runOpts.signal, timeout]) : timeout;
        return await execImpl(argv, { env, signal, limits });
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
