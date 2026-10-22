/**
 * `createScriptedCli`: a fake external agent binary for driver tests. It replays a script of output frames and
 * gate calls. Gate calls run the driver's own hook command (the relay) or go to the client, so the relay, the
 * broker, and the driver's answer path run for real. The binary is a Bun script written to a temp directory.
 *
 * Dialects describe the wire format only. Their functions are serialized into the binary, so each must be a
 * self-contained function expression (no closures over module state). {@link defineScriptedDialect} checks the
 * shape and that each function compiles on its own.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "../contracts.js";
import { RELAY_SOCKET_FILE } from "../driver-kit/relay-protocol.js";
import type { McpEndpoint } from "../driver-kit/index.js";
import type { ExternalActivity } from "../loop/types.js";
import { jsonRpcDialect } from "./scripted-dialects/json-rpc.js";
import { jsonlStreamDialect } from "./scripted-dialects/jsonl-stream.js";

/** An output frame: an external activity (by its `kind`), or the end-of-turn marker. */
export type ScriptFrame = { readonly type: "turn.done" } | ExternalActivity;

/** A gate call the binary makes for one tool. */
export interface ScriptHook {
  readonly tool: string;
  /** The call id the binary uses. Unique within a script. */
  readonly id: string;
  readonly args?: JsonValue;
  /** Removes the run's relay socket before the hook runs, so the relay fails closed. Command hooks only. */
  readonly breakBroker?: boolean;
}

/** One step of a turn: emit a frame, make a gate call, call MCP, or wait. */
export type ScriptStep =
  | { readonly out: ScriptFrame }
  | { readonly hook: ScriptHook }
  | { readonly mcp: ScriptMcpStep }
  | { readonly raw: string }
  | { readonly wait: number };

/** One MCP request the binary makes as a client. The binary performs the `initialize` exchange before the first. */
export interface ScriptMcpStep {
  readonly method: string;
  readonly params?: JsonValue;
}

/** What the driver writes to the binary's stdin. */
export type ScriptedInput =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "steer"; readonly text: string }
  | { readonly kind: "answer"; readonly id: string; readonly allow: boolean }
  | { readonly kind: "interrupt" };

/** A gate call as a dialect sees it. */
export interface HookCall {
  readonly id: string;
  readonly tool: string;
  readonly args: JsonValue;
}

/** What the driver reads from the binary's stdout. */
export type ScriptedOutput = { readonly kind: "frame"; readonly frame: ScriptFrame } | { readonly kind: "hook"; readonly call: HookCall };

/**
 * A wire format. `encodeInput` and `parseFrame` are the driver's side; `decodeInput`, `frames`, and `hook` run
 * inside the binary. `hook.via: "command"` runs the driver's hook command with the payload on stdin and honors
 * its exit code and stdout. `hook.via: "client"` writes a request to stdout and waits for the answer on stdin.
 */
export interface ScriptedDialect {
  readonly name: string;
  /** Serialized into the binary; report loaded file paths for isolation checks. */
  readonly locate?: (input: {
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly cwd: string;
    readonly readFile: (path: string) => string | undefined;
  }) => { readonly hookCommand?: readonly string[]; readonly endpoint?: McpEndpoint; readonly loaded: readonly string[] };
  encodeInput(input: ScriptedInput): string;
  decodeInput(line: string): ScriptedInput | undefined;
  frames(frame: ScriptFrame): string;
  parseFrame(line: string): ScriptedOutput | undefined;
  readonly hook:
    | {
        readonly via: "command";
        payload(call: HookCall): string;
        allowed?(answer: { readonly exitCode: number; readonly stdout: string }): boolean;
      }
    | { readonly via: "client"; request(call: HookCall): string };
}

export type ScriptedDialectName = "jsonl-stream" | "json-rpc";

/** One line the binary wrote about itself, for the test to inspect. Values are never secrets. */
export type ScriptedRecordEntry =
  | { readonly event: "loaded"; readonly items: readonly string[] }
  | { readonly event: "argv"; readonly argv: readonly string[] }
  | { readonly event: "path"; readonly path: string }
  | { readonly event: "env"; readonly names: readonly string[] }
  | { readonly event: "input"; readonly input: ScriptedInput }
  | { readonly event: "hook"; readonly id: string; readonly tool: string }
  | { readonly event: "hook-result"; readonly id: string; readonly exitCode: number; readonly stdout: string }
  | { readonly event: "mcp"; readonly method: string; readonly result: JsonValue }
  | { readonly event: "mcp"; readonly method: string; readonly error: JsonValue }
  | { readonly event: "signal"; readonly signal: string }
  | { readonly event: "exit" };

export interface ScriptedCliOptions {
  /** Caller-owned fake home. Pass cli.env to the driver; dispose removes only the generated binary. */
  readonly home?: string;
  readonly dialect: ScriptedDialectName | ScriptedDialect;
  readonly script: readonly ScriptStep[];
}

export interface ScriptedCli {
  /** The argv that starts the binary, for example `[bun, <script>.mjs]`. A driver appends its own flags. */
  readonly command: readonly string[];
  /** Extra environment the binary needs. Empty for the reference dialects. */
  readonly env: Readonly<Record<string, string>>;
  /** Every entry the binary has written so far. */
  record(): readonly ScriptedRecordEntry[];
  /** Removes the temp directory. Idempotent. */
  dispose(): void;
}

/**
 * Checks a dialect's shape. Each function must compile on its own, because it is serialized into the binary.
 * Method shorthand and closures fail here, not at run time.
 */
export function defineScriptedDialect(dialect: ScriptedDialect): ScriptedDialect {
  if (typeof dialect.name !== "string" || dialect.name === "") throw new TypeError("scripted dialect needs a non-empty name");
  for (const key of ["encodeInput", "decodeInput", "frames", "parseFrame"] as const) {
    if (typeof dialect[key] !== "function") throw new TypeError(`scripted dialect "${dialect.name}" needs ${key}`);
  }
  if (dialect.hook?.via === "command") {
    if (typeof dialect.hook.payload !== "function") throw new TypeError(`scripted dialect "${dialect.name}" needs hook.payload`);
    serialized(dialect.name, "hook.payload", dialect.hook.payload);
    if (dialect.hook.allowed !== undefined) {
      if (typeof dialect.hook.allowed !== "function") throw new TypeError("scripted dialect hook.allowed must be a function");
      serialized(dialect.name, "hook.allowed", dialect.hook.allowed);
    }
  } else if (dialect.hook?.via === "client") {
    if (typeof dialect.hook.request !== "function") throw new TypeError(`scripted dialect "${dialect.name}" needs hook.request`);
    serialized(dialect.name, "hook.request", dialect.hook.request);
  } else {
    throw new TypeError(`scripted dialect "${dialect.name}" needs hook.via "command" or "client"`);
  }
  if (dialect.locate !== undefined) {
    if (typeof dialect.locate !== "function") throw new TypeError("scripted dialect locate must be a function");
    serialized(dialect.name, "locate", dialect.locate);
  }
  serialized(dialect.name, "decodeInput", dialect.decodeInput);
  serialized(dialect.name, "frames", dialect.frames);
  return dialect;
}

function serialized(dialect: string, key: string, fn: (...args: never[]) => unknown): string {
  const source = fn.toString();
  try {
    new Function(`return (${source});`);
  } catch {
    throw new TypeError(`scripted dialect "${dialect}" ${key} must be a self-contained function expression`);
  }
  return source;
}

const REFERENCE_DIALECTS: Record<ScriptedDialectName, ScriptedDialect> = {
  "jsonl-stream": defineScriptedDialect(jsonlStreamDialect),
  "json-rpc": defineScriptedDialect(jsonRpcDialect),
};

function validateScript(script: readonly ScriptStep[]): void {
  script.forEach((step, index) => {
    const kinds = ["out", "hook", "mcp", "wait", "raw"].filter((key) => key in step);
    if (kinds.length !== 1) throw new TypeError(`script step ${index} must have exactly one of out, hook, mcp, wait, raw`);
    if ("hook" in step && (typeof step.hook.tool !== "string" || typeof step.hook.id !== "string")) {
      throw new TypeError(`script step ${index} hook needs a tool and an id`);
    }
    if ("mcp" in step && typeof step.mcp.method !== "string") throw new TypeError(`script step ${index} mcp needs a method`);
    if ("raw" in step && typeof step.raw !== "string") throw new TypeError(`script step ${index} raw must be a string`);
    if ("wait" in step && (!Number.isFinite(step.wait) || step.wait < 0)) throw new TypeError(`script step ${index} wait must be >= 0`);
  });
}

/** Starts nothing; writes the binary and returns its command. The binary runs only when a driver spawns it. */
export function createScriptedCli(options: ScriptedCliOptions): ScriptedCli {
  const dialect = typeof options.dialect === "string" ? REFERENCE_DIALECTS[options.dialect] : defineScriptedDialect(options.dialect);
  if (dialect === undefined) throw new TypeError(`unknown scripted dialect "${String(options.dialect)}"`);
  validateScript(options.script);
  const dir = mkdtempSync(join(tmpdir(), "scripted-cli-"));
  const recordPath = join(dir, "record.jsonl");
  const scriptPath = join(dir, "scripted-cli.mjs");
  writeFileSync(recordPath, "");
  writeFileSync(scriptPath, binarySource(dialect, options.script, recordPath));
  let disposed = false;
  return {
    command: [process.execPath, scriptPath],
    env: options.home === undefined ? {} : { HOME: options.home },
    record: () =>
      readFileSync(recordPath, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as ScriptedRecordEntry),
    dispose() {
      if (disposed) return;
      disposed = true;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The Bun script the driver spawns. Dialect functions are inlined from their source; everything else is data. */
function binarySource(dialect: ScriptedDialect, script: readonly ScriptStep[], recordPath: string): string {
  const hook =
    dialect.hook.via === "command"
      ? `{ via: "command", payload: (${dialect.hook.payload.toString()}), allowed: ${dialect.hook.allowed ? `(${dialect.hook.allowed.toString()})` : "undefined"} }`
      : `{ via: "client", request: (${dialect.hook.request.toString()}) }`;
  return `// Generated by createScriptedCli. Test fixture only; not shipped in any package.
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const RECORD = ${JSON.stringify(recordPath)};
const STEPS = ${JSON.stringify(script)};
const SOCKET_FILE = ${JSON.stringify(RELAY_SOCKET_FILE)};
const ANSWER_TIMEOUT_MS = 15000;
const DIALECT = {
  name: ${JSON.stringify(dialect.name)},
  decodeInput: (${dialect.decodeInput.toString()}),
  frames: (${dialect.frames.toString()}),
  hook: ${hook},
  locate: ${dialect.locate === undefined ? "undefined" : `(${dialect.locate.toString()})`},
};

const record = (entry) => appendFileSync(RECORD, JSON.stringify(entry) + "\\n");
const emit = (frame) => process.stdout.write(DIALECT.frames(frame) + "\\n");

// Handlers first: a signal that lands before them would kill the binary unrecorded.
process.on("exit", () => record({ event: "exit" }));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    record({ event: "signal", signal });
    process.exit(130);
  });
}

const argv = process.argv.slice(2);
record({ event: "argv", argv });
record({ event: "env", names: Object.keys(process.env).sort() });
for (const token of argv) if (token.startsWith("/") && existsSync(token)) record({ event: "path", path: token });
const located = DIALECT.locate?.({ argv, env: process.env, cwd: process.cwd(), readFile: (path) => {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
} });
if (DIALECT.locate && (!located || !Array.isArray(located.loaded) || located.loaded.some(item => typeof item !== "string"))) {
  throw new Error("scripted cli: locate must return loaded paths");
}
if (located) record({ event: "loaded", items: located.loaded });
const hookFlag = argv.indexOf("--hook-command");
const hookCommand = located ? located.hookCommand : hookFlag === -1 ? undefined : JSON.parse(argv[hookFlag + 1]);
const endpointFlag = argv.indexOf("--mcp-endpoint");
const ENDPOINT = located ? located.endpoint : endpointFlag === -1 ? undefined : JSON.parse(argv[endpointFlag + 1]);
let failed = false;
let mcpId = 0;
let mcpInitialized = false;
let mcpChild;
const mcpPending = new Map();

const answers = new Map();
const waitForAnswer = (id) =>
  new Promise((resolve) => {
    answers.set(id, resolve);
    setTimeout(() => {
      if (answers.delete(id)) resolve(false);
    }, ANSWER_TIMEOUT_MS).unref?.();
  });

function runCommand(command, input) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", () => resolve({ exitCode: 2, stdout: "" }));
    child.on("close", (code) => resolve({ exitCode: code ?? 2, stdout }));
    child.stdin.end(input);
  });
}

function removeSocket(command) {
  const at = command.indexOf("--run");
  if (at !== -1 && command[at + 1]) rmSync(join(command[at + 1], SOCKET_FILE), { force: true });
}

function mcpHeaders() {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const token = ENDPOINT.transport === "http" && ENDPOINT.headerEnv ? process.env[ENDPOINT.headerEnv] : undefined;
  if (token) headers.authorization = "Bearer " + token;
  return headers;
}

// A streamable-HTTP server may answer with SSE; the JSON-RPC message is the last data line.
function unwrapSse(text) {
  const lines = text.split("\\n").filter((line) => line.startsWith("data:"));
  const last = lines[lines.length - 1];
  return last === undefined ? text : last.slice(5).trim();
}

async function mcpHttp(message) {
  const response = await fetch(ENDPOINT.url, { method: "POST", headers: mcpHeaders(), body: JSON.stringify(message) });
  const text = await response.text();
  if (text === "") return { error: "http " + response.status };
  const body = (response.headers.get("content-type") ?? "").includes("text/event-stream") ? unwrapSse(text) : text;
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    return { error: "malformed response" };
  }
  if (reply && reply.error !== undefined) return { error: reply.error };
  return { result: reply === null || reply === undefined || reply.result === undefined ? null : reply.result };
}

function mcpStdioStart() {
  const child = spawn(ENDPOINT.command, ENDPOINT.args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return;
    }
    const resolve = mcpPending.get(reply.id);
    if (resolve === undefined) return;
    mcpPending.delete(reply.id);
    resolve(reply.error !== undefined ? { error: reply.error } : { result: reply.result === undefined ? null : reply.result });
  });
  child.on("exit", () => {
    for (const resolve of mcpPending.values()) resolve({ error: "stdio child exited" });
    mcpPending.clear();
  });
  return child;
}

function mcpStdio(message) {
  mcpChild ??= mcpStdioStart();
  return new Promise((resolve) => {
    mcpPending.set(message.id, resolve);
    setTimeout(() => {
      if (mcpPending.delete(message.id)) resolve({ error: "timeout" });
    }, ANSWER_TIMEOUT_MS).unref?.();
    mcpChild.stdin.write(JSON.stringify(message) + "\\n");
  });
}

function mcpSend(message) {
  return ENDPOINT.transport === "http" ? mcpHttp(message) : mcpStdio(message);
}

// A notification has no reply; write it and do not wait.
function mcpNotify(message) {
  if (ENDPOINT.transport === "stdio") {
    mcpChild ??= mcpStdioStart();
    mcpChild.stdin.write(JSON.stringify(message) + "\\n");
    return Promise.resolve();
  }
  return fetch(ENDPOINT.url, { method: "POST", headers: mcpHeaders(), body: JSON.stringify(message) }).then(
    () => undefined,
    () => undefined,
  );
}

async function mcpInitialize() {
  if (mcpInitialized) return;
  mcpInitialized = true;
  const outcome = await mcpSend({
    jsonrpc: "2.0",
    id: ++mcpId,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prism-scripted-cli", version: "1" } },
  });
  record("error" in outcome ? { event: "mcp", method: "initialize", error: outcome.error } : { event: "mcp", method: "initialize", result: outcome.result });
  if (!("error" in outcome)) await mcpNotify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
}

async function runMcp(step) {
  if (ENDPOINT === undefined) {
    record({ event: "mcp", method: step.method, error: "no endpoint" });
    failed = true;
    return;
  }
  await mcpInitialize();
  const outcome = await mcpSend({ jsonrpc: "2.0", id: ++mcpId, method: step.method, params: step.params ?? {} });
  record("error" in outcome ? { event: "mcp", method: step.method, error: outcome.error } : { event: "mcp", method: step.method, result: outcome.result });
}

async function runHook(hook) {
  const call = { id: hook.id, tool: hook.tool, args: hook.args ?? {} };
  record({ event: "hook", id: hook.id, tool: hook.tool });
  let allowed;
  let exitCode;
  let stdout = "";
  if (DIALECT.hook.via === "client") {
    process.stdout.write(DIALECT.hook.request(call) + "\\n");
    allowed = await waitForAnswer(hook.id);
    exitCode = allowed ? 0 : 2;
  } else {
    if (hookCommand === undefined) throw new Error("scripted cli: a command hook needs --hook-command");
    if (hook.breakBroker) removeSocket(hookCommand);
    const result = await runCommand(hookCommand, DIALECT.hook.payload(call));
    exitCode = result.exitCode;
    stdout = result.stdout;
    allowed = DIALECT.hook.allowed ? DIALECT.hook.allowed({ exitCode, stdout }) : exitCode === 0;
  }
  record({ event: "hook-result", id: hook.id, exitCode, stdout });
  if (allowed) emit({ kind: "tool.started", call: { id: hook.id, name: hook.tool, args: call.args } });
  emit(allowed ? { kind: "tool.completed", toolCallId: hook.id, status: "finished" } : { kind: "tool.completed", toolCallId: hook.id, status: "blocked", error: "blocked" });
}

async function runTurn() {
  for (const step of STEPS) {
    if ("out" in step) emit(step.out);
    else if ("raw" in step) process.stdout.write(step.raw + "\\n");
    else if ("hook" in step) await runHook(step.hook);
    else if ("mcp" in step) {
      await runMcp(step.mcp);
      if (failed) return;
    } else await new Promise((resolve) => setTimeout(resolve, step.wait));
  }
  emit({ type: "turn.done" });
}

let chain = Promise.resolve();
const enqueue = (work) => {
  chain = chain.then(work).catch((error) => process.stderr.write(String(error) + "\\n"));
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const input = DIALECT.decodeInput(line);
  if (input === undefined) return;
  record({ event: "input", input });
  if (input.kind === "user") enqueue(runTurn);
  else if (input.kind === "answer" && answers.has(input.id)) {
    const resolve = answers.get(input.id);
    answers.delete(input.id);
    resolve(input.allow === true);
  }
});
lines.on("close", () => {
  void chain.then(() => process.exit(failed ? 1 : 0));
});
`;
}
