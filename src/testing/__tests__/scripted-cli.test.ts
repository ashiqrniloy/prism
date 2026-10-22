import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CallbackBroker, createCallbackBroker, type HookCodec, type McpEndpoint } from "../../driver-kit/index.js";
import type { RunController } from "../../index.js";
import {
  createScriptedCli,
  defineScriptedDialect,
  type ScriptedCli,
  type ScriptedDialect,
  type ScriptedDialectName,
  type ScriptedInput,
  type ScriptedOutput,
  type ScriptStep,
} from "../scripted-cli.js";
import { jsonRpcDialect } from "../scripted-dialects/json-rpc.js";
import { jsonlStreamDialect } from "../scripted-dialects/jsonl-stream.js";

/** A hook command that reads its payload and answers `{"seen":true}` with exit code 3. */
const HOOK = [
  process.execPath,
  "-e",
  "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write('{\"seen\":true}');process.exit(3)})",
];

interface Running {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: string[];
  readonly closed: Promise<number>;
}

/** Spawns the binary with its own arguments and collects stdout lines until it exits. */
function start(
  cli: ScriptedCli,
  args: readonly string[],
  onLine?: (line: string, running: Running) => void,
  env?: Record<string, string>,
): Running {
  const child = spawn(cli.command[0] ?? "", [...cli.command.slice(1), ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: env === undefined ? undefined : { ...process.env, ...env },
  }) as ChildProcessWithoutNullStreams;
  const lines: string[] = [];
  let buffer = "";
  const running: Running = {
    child,
    lines,
    closed: new Promise((resolve) => child.once("close", (code) => resolve(code ?? -1))),
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at !== -1; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      lines.push(line);
      onLine?.(line, running);
    }
  });
  return running;
}

function encode(input: ScriptedInput, dialect: typeof jsonlStreamDialect): string {
  return dialect.encodeInput(input);
}

/** The frame's name: its `type` for the end-of-turn marker, its `kind` for an activity. */
function labelOf(output: ScriptedOutput | undefined): string {
  if (output?.kind !== "frame") return "?";
  return "type" in output.frame ? output.frame.type : output.frame.kind;
}

/** A codec the broker never consults for MCP traffic; the broker still requires one. */
const noopCodec: HookCodec = {
  decode: () => ({ kind: "stop" }),
  encode: () => ({ exitCode: 0, stdout: "" }),
};

/** A run the broker can hold; the MCP route never calls into it. */
function fakeRun(): RunController {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    ask: async () => ({ allow: false, reason: "non_interactive" }),
    end: async () => ({ continue: false as const }),
    observe: async () => undefined,
    executeTools: async () => [],
  } as unknown as RunController;
}

interface McpHarness {
  readonly cli: ScriptedCli;
  readonly broker: CallbackBroker;
  readonly dir: string;
  readonly seen: readonly string[];
  close(): Promise<void>;
}

/** A broker with an MCP route that answers `tools/list` and `tools/call`, and a scripted binary to drive it. */
async function mcpHarness(script: readonly ScriptStep[], dialect: ScriptedDialectName = "jsonl-stream"): Promise<McpHarness> {
  const dir = mkdtempSync(join(tmpdir(), "scripted-mcp-"));
  const broker = await createCallbackBroker(fakeRun(), {
    runDir: dir,
    hookCodec: noopCodec,
    failClosed: { exitCode: 2, stdout: "" },
    timeoutMs: 5_000,
  });
  const seen: string[] = [];
  broker.route("mcp", async (request) => {
    const message = (await request.json()) as { id?: unknown; method: string };
    seen.push(message.method);
    if (message.id === undefined) return new Response("", { status: 202 });
    const result =
      message.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stub", version: "1" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "edit" }] }
          : { content: [{ type: "text", text: "ok" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const cli = createScriptedCli({ dialect, script });
  return {
    cli,
    broker,
    dir,
    seen,
    async close() {
      cli.dispose();
      await broker.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function mcpEntries(cli: ScriptedCli): { method: string; result?: unknown; error?: unknown }[] {
  return cli
    .record()
    .filter((entry) => entry.event === "mcp")
    .map((entry) => ("result" in entry ? { method: entry.method, result: entry.result } : { method: entry.method, error: entry.error }));
}

async function runToCompletion(
  cli: ScriptedCli,
  args: readonly string[],
  env?: Record<string, string>,
  dialect: ScriptedDialect = jsonlStreamDialect,
): Promise<void> {
  const running = start(cli, args, undefined, env);
  running.child.stdin.write(`${dialect.encodeInput({ kind: "user", text: "go" })}\n`);
  running.child.stdin.end();
  assert.equal(await running.closed, 0);
}

describe("createScriptedCli", () => {
  it("raw_step_writes_line_verbatim", async () => {
    const cli = createScriptedCli({ dialect: "jsonl-stream", script: [{ raw: '  {"unmapped":true}  ' }] });
    try {
      const running = start(cli, []);
      running.child.stdin.end(`${jsonlStreamDialect.encodeInput({ kind: "user", text: "go" })}\n`);
      assert.equal(await running.closed, 0);
      assert.equal(running.lines[0], '  {"unmapped":true}  ');
    } finally {
      cli.dispose();
    }
    assert.throws(() => createScriptedCli({ dialect: "jsonl-stream", script: [{ raw: 1 } as never] }), /raw/);
    assert.throws(() => createScriptedCli({ dialect: "jsonl-stream", script: [{ raw: "x", wait: 0 } as never] }), /exactly one/);
  });

  it("locate_finds_hook_command_in_settings_file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locate-"));
    const settings = join(dir, "settings.json");
    const broker = await createCallbackBroker(fakeRun(), {
      runDir: dir,
      hookCodec: noopCodec,
      failClosed: { exitCode: 2, stdout: "" },
      timeoutMs: 5000,
    });
    const cliPath = fileURLToPath(new URL("../../cli.ts", import.meta.url));
    writeFileSync(settings, JSON.stringify({ hookCommand: [process.execPath, cliPath, "relay", "hook", "--run", dir] }));
    const dialect = defineScriptedDialect({
      ...jsonlStreamDialect,
      locate: ({ argv, env, cwd, readFile }) => {
        if (!cwd || !env.HOME || readFile("/missing/scripted-file") !== undefined) throw new Error("bad locate context");
        const path = argv[argv.indexOf("--settings") + 1]!;
        return { ...JSON.parse(readFile(path)!), loaded: [path] };
      },
    });
    const cli = createScriptedCli({ dialect, home: dir, script: [{ hook: { tool: "edit", id: "located" } }] });
    try {
      await runToCompletion(cli, ["--settings", settings, "--hook-command", "invalid"], { ...cli.env });
      assert.deepEqual(
        cli.record().filter((e) => e.event === "loaded"),
        [{ event: "loaded", items: [settings] }],
      );
      assert.ok(cli.record().some((e) => e.event === "hook-result" && e.exitCode === 0));
      assert.equal(cli.env.HOME, dir);
      assert.throws(
        () =>
          defineScriptedDialect({
            ...dialect,
            locate() {
              return { loaded: [] };
            },
          }),
        /self-contained/,
      );
      assert.throws(() => defineScriptedDialect({ ...dialect, locate: 1 as never }), /locate/);
    } finally {
      cli.dispose();
      await broker.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scripted_cli_jsonl_stream_replays_and_calls_hook", async () => {
    const cli = createScriptedCli({
      dialect: "jsonl-stream",
      script: [{ out: { kind: "message.delta", content: { type: "text", text: "hi" } } }, { hook: { tool: "write_file", id: "w1" } }],
    });
    try {
      const running = start(cli, ["--hook-command", JSON.stringify(HOOK)]);
      running.child.stdin.write(`${encode({ kind: "user", text: "go" }, jsonlStreamDialect)}\n`);
      running.child.stdin.end();
      assert.equal(await running.closed, 0);

      const frames = running.lines.map((line) => jsonlStreamDialect.parseFrame(line));
      // A blocked call emits no tool.started, only its completion.
      assert.deepEqual(frames.map(labelOf), ["message.delta", "tool.completed", "turn.done"]);
      const completed = frames[1];
      assert.ok(
        completed?.kind === "frame" && "status" in completed.frame && completed.frame.status === "blocked",
        "a non-zero hook exit blocks the call",
      );

      const hook = cli.record().find((entry) => entry.event === "hook-result");
      assert.deepEqual(hook, { event: "hook-result", id: "w1", exitCode: 3, stdout: '{"seen":true}' });
    } finally {
      cli.dispose();
    }
  });

  it("scripted_cli_json_rpc_sends_approval_request", async () => {
    const cli = createScriptedCli({
      dialect: "json-rpc",
      script: [{ hook: { tool: "write_file", id: "a1" } }, { out: { kind: "notice", level: "info", code: "after", message: "ok" } }],
    });
    try {
      let asked: ScriptedOutput | undefined;
      const running = start(cli, [], (line, state) => {
        const output = jsonRpcDialect.parseFrame(line);
        if (output?.kind === "hook" && asked === undefined) {
          asked = output;
          state.child.stdin.write(`${jsonRpcDialect.encodeInput({ kind: "answer", id: output.call.id, allow: true })}\n`);
        }
        if (output?.kind === "frame" && "type" in output.frame && output.frame.type === "turn.done") state.child.stdin.end();
      });
      running.child.stdin.write(`${jsonRpcDialect.encodeInput({ kind: "user", text: "go" })}\n`);
      assert.equal(await running.closed, 0);

      assert.ok(asked?.kind === "hook", "the binary sent an approval request to the client");
      assert.equal(asked.call.id, "a1");
      assert.equal(asked.call.tool, "write_file");
      const allowed = cli.record().find((entry) => entry.event === "hook-result");
      assert.equal(allowed?.event === "hook-result" && allowed.exitCode, 0, "an allow answer lets the call run");
    } finally {
      cli.dispose();
    }
  });

  it("define_scripted_dialect_custom_frames", async () => {
    const prefixed = defineScriptedDialect({
      ...jsonlStreamDialect,
      name: "prefixed",
      frames: (frame) => `F ${JSON.stringify(frame)}`,
      parseFrame: (line) => jsonlStreamDialect.parseFrame(line.slice(2)),
    });
    const cli = createScriptedCli({
      dialect: prefixed,
      script: [{ out: { kind: "message.delta", content: { type: "text", text: "custom" } } }],
    });
    try {
      const running = start(cli, []);
      running.child.stdin.write(`${jsonlStreamDialect.encodeInput({ kind: "user", text: "go" })}\n`);
      running.child.stdin.end();
      assert.equal(await running.closed, 0);
      assert.equal(running.lines.length, 2);
      assert.ok(
        running.lines.every((line) => line.startsWith("F ")),
        "the custom frames reached stdout",
      );
      assert.equal(prefixed.parseFrame(running.lines[0] ?? "")?.kind, "frame");
    } finally {
      cli.dispose();
    }
  });

  it("define_scripted_dialect_rejects_method_shorthand", () => {
    assert.throws(
      () =>
        defineScriptedDialect({
          ...jsonlStreamDialect,
          name: "shorthand",
          frames(frame) {
            return JSON.stringify(frame);
          },
        }),
      /self-contained function expression/,
    );
  });

  it("create_scripted_cli_rejects_a_bad_step", () => {
    assert.throws(
      () => createScriptedCli({ dialect: "jsonl-stream", script: [{ out: { type: "turn.done" }, wait: 1 } as never] }),
      /exactly one of out, hook, mcp, wait/,
    );
  });

  it("scripted_cli_mcp_step_over_http", async () => {
    const h = await mcpHarness([
      { mcp: { method: "tools/list" } },
      { mcp: { method: "tools/call", params: { name: "edit", arguments: { path: "a.ts" } } } },
    ]);
    try {
      const endpoint: McpEndpoint = { transport: "http", url: `${h.broker.url}/mcp`, headerEnv: "PRISM_MCP_TOKEN" };
      await runToCompletion(h.cli, ["--mcp-endpoint", JSON.stringify(endpoint)], { PRISM_MCP_TOKEN: h.broker.token });
      assert.deepEqual(mcpEntries(h.cli), [
        { method: "initialize", result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stub", version: "1" } } },
        { method: "tools/list", result: { tools: [{ name: "edit" }] } },
        { method: "tools/call", result: { content: [{ type: "text", text: "ok" }] } },
      ]);
      // The broker only reaches the route after the bearer check, so a result proves the token was sent.
      assert.deepEqual(h.seen, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    } finally {
      await h.close();
    }
  });

  it("scripted_cli_mcp_step_over_stdio_relay", async () => {
    const h = await mcpHarness([
      { mcp: { method: "tools/list" } },
      { mcp: { method: "tools/call", params: { name: "edit", arguments: {} } } },
    ]);
    try {
      const cliPath = fileURLToPath(new URL("../../cli.ts", import.meta.url));
      const endpoint: McpEndpoint = { transport: "stdio", command: process.execPath, args: [cliPath, "relay", "mcp", "--run", h.dir] };
      await runToCompletion(h.cli, ["--mcp-endpoint", JSON.stringify(endpoint)]);
      assert.deepEqual(
        mcpEntries(h.cli).map((entry) => entry.method),
        ["initialize", "tools/list", "tools/call"],
      );
      assert.deepEqual(h.seen, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    } finally {
      await h.close();
    }
  });

  it("scripted_cli_mcp_step_with_json_rpc_dialect", async () => {
    const h = await mcpHarness([{ mcp: { method: "tools/list" } }], "json-rpc");
    try {
      const endpoint: McpEndpoint = { transport: "http", url: `${h.broker.url}/mcp`, headerEnv: "PRISM_MCP_TOKEN" };
      await runToCompletion(h.cli, ["--mcp-endpoint", JSON.stringify(endpoint)], { PRISM_MCP_TOKEN: h.broker.token }, jsonRpcDialect);
      assert.deepEqual(
        mcpEntries(h.cli).map((entry) => entry.method),
        ["initialize", "tools/list"],
      );
    } finally {
      await h.close();
    }
  });

  it("scripted_cli_mcp_step_without_endpoint_fails", async () => {
    const cli = createScriptedCli({ dialect: "jsonl-stream", script: [{ mcp: { method: "tools/list" } }] });
    try {
      const running = start(cli, []);
      running.child.stdin.write(`${jsonlStreamDialect.encodeInput({ kind: "user", text: "go" })}\n`);
      running.child.stdin.end();
      assert.notEqual(await running.closed, 0);
      assert.deepEqual(mcpEntries(cli), [{ method: "tools/list", error: "no endpoint" }]);
    } finally {
      cli.dispose();
    }
  });

  it("scripted_cli_mcp_http_without_token_is_rejected", async () => {
    const h = await mcpHarness([{ mcp: { method: "tools/list" } }]);
    try {
      const endpoint: McpEndpoint = { transport: "http", url: `${h.broker.url}/mcp`, headerEnv: "PRISM_MCP_TOKEN" };
      // No PRISM_MCP_TOKEN in the child environment, so no Authorization header is sent.
      await runToCompletion(h.cli, ["--mcp-endpoint", JSON.stringify(endpoint)], {});
      assert.deepEqual(
        mcpEntries(h.cli).map((entry) => entry.error),
        ["http 401", "http 401"],
      );
    } finally {
      await h.close();
    }
  });

  it("scripted_cli_record_never_holds_token", async () => {
    const h = await mcpHarness([{ mcp: { method: "tools/list" } }]);
    try {
      const endpoint: McpEndpoint = { transport: "http", url: `${h.broker.url}/mcp`, headerEnv: "PRISM_MCP_TOKEN" };
      await runToCompletion(h.cli, ["--mcp-endpoint", JSON.stringify(endpoint)], { PRISM_MCP_TOKEN: h.broker.token });
      assert.ok(!JSON.stringify(h.cli.record()).includes(h.broker.token), "the token never reaches the record");
    } finally {
      await h.close();
    }
  });
});

it("rejects_non_function_command_hook_response_parser", () => {
  assert.throws(
    () =>
      defineScriptedDialect({
        ...jsonlStreamDialect,
        hook: { ...jsonlStreamDialect.hook, via: "command", allowed: true },
      } as unknown as ScriptedDialect),
    /hook.allowed must be a function/,
  );
});
