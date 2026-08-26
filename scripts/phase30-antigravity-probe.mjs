#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDelegatedAgentStep } from "@arnilo/prism";
import { createPrismMcpServer } from "@arnilo/prism-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
const PROMPT = "Call prism_echo with value probe, then return done";
const MAX_STREAM_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const LIVE_TIMEOUT_MS = 5 * 60 * 1000;
const FIXTURE_TIMEOUT_MS = 15 * 1000;
const args = new Set(process.argv.slice(2));

if (args.has("--mcp-server")) {
  await runMcpServer();
} else if (args.has("--fake-agy")) {
  await runFakeAgy(args.has("--unauthenticated"));
} else {
  await runProbe(args.has("--live"));
}

async function runProbe(live) {
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "prism-antigravity-proof-"));
  const workspace = join(root, "workspace");
  const agents = join(workspace, ".agents");
  const countFile = join(root, "mcp-calls.log");
  const authorizationFile = join(root, "mcp-authorizations.log");
  mkdirSync(agents, { recursive: true });
  execFileSync("git", ["init", "--quiet", workspace], { stdio: "ignore" });
  symlinkSync(join(ROOT, "node_modules"), join(workspace, "node_modules"), "dir");
  const localMcpScript = join(agents, "prism-mcp-probe.mjs");
  writeFileSync(localMcpScript, readFileSync(SCRIPT));
  const globalConfig = snapshot(join(homedir(), ".gemini", "config", "mcp_config.json"));
  const config = {
    mcpServers: {
      prism: {
        command: process.execPath,
        args: [localMcpScript, "--mcp-server"],
        cwd: workspace,
        env: {
          PRISM_PROBE_CALL_COUNT: countFile,
          PRISM_PROBE_AUTH_COUNT: authorizationFile,
        },
      },
    },
  };
  writeFileSync(join(agents, "mcp_config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(agents, "settings.json"), `${JSON.stringify({ permissions: { allow: ["mcp(prism/prism_echo)"] } }, null, 2)}\n`);
  const agentDir = join(agents, "agents", "prism-probe");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "agent.md"),
    "---\nname: prism-probe\ndescription: bounded Prism MCP protocol probe\nmainAgent: true\ninheritMcp: true\n---\nCall prism_echo exactly once with value probe, then return done.\n",
  );

  try {
    const command = live ? process.env.PRISM_AGY_COMMAND || "agy" : process.execPath;
    const commandArgs = live
      ? ["-p", PROMPT, "--agent", "prism-probe", "--add-dir", workspace, "--output-format", "stream-json", "--print-timeout", "5m"]
      : [SCRIPT, "--fake-agy", ...(args.has("--unauthenticated") ? ["--unauthenticated"] : [])];
    const result = await runProcess(command, commandArgs, {
      cwd: workspace,
      env: probeEnv(workspace),
      timeoutMs: live ? LIVE_TIMEOUT_MS : FIXTURE_TIMEOUT_MS,
    });

    if (result.error?.code === "ENOENT") {
      console.log(JSON.stringify({ status: "setup_required", reason: "official agy is not installed", live: true }));
      process.exitCode = 2;
      return;
    }
    if (!live && args.has("--unauthenticated")) {
      assert(result.code !== 0, "unauthenticated fixture unexpectedly succeeded");
      assert(/authentication required/i.test(result.stderr), "unauthenticated fixture did not report setup guidance");
      assert(!/oauth|callback|token/i.test(result.stdout + result.stderr), "fixture attempted credential automation");
      console.log(JSON.stringify({ status: "setup_required", reason: "authentication required", live: false }));
      return;
    }
    if (result.timedOut || result.code !== 0) {
      console.log(
        JSON.stringify({
          status: "live_failed",
          exitCode: result.code,
          timedOut: result.timedOut,
          stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
          stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
          streamShapes: streamShapes(result.stdout),
          mcpCalls: countLines(countFile),
          authorizationCalls: countLines(authorizationFile),
          globalMcpConfigUnchanged: sameSnapshot(globalConfig, snapshot(join(homedir(), ".gemini", "config", "mcp_config.json"))),
        }),
      );
      process.exitCode = 2;
      return;
    }

    const records = parseNdjson(result.stdout);
    const init = records.filter((record) => record.type === "init");
    const updates = records.filter((record) => record.type === "step_update");
    const results = records.filter((record) => record.type === "result");
    assert(init.length === 1, `expected one init event, got ${init.length}`);
    assert(results.length === 1, `expected one result event, got ${results.length}`);
    assert(typeof init[0].cwd === "string", "init.cwd missing");
    assert(Array.isArray(init[0].tools), "init.tools missing");
    if (results[0].status !== "SUCCESS") {
      console.log(
        JSON.stringify({
          status: "live_failed",
          observedStatus: results[0].status,
          eventTypes: records.map((record) => record.type),
          initToolCount: Array.isArray(init[0]?.tools) ? init[0].tools.length : 0,
          initAdvertisedEcho: Array.isArray(init[0]?.tools) && init[0].tools.includes("prism_echo"),
          stepTypes: updates.map((record) => ({
            state: record.state,
            stepType: record.step_type,
            tool: record.tool_info?.name,
            toolInfoKeys: record.tool_info && typeof record.tool_info === "object" ? Object.keys(record.tool_info).sort() : [],
            parameterKeys:
              record.tool_info?.parameters && typeof record.tool_info.parameters === "object"
                ? Object.keys(record.tool_info.parameters).sort()
                : [],
            callTarget: safeCallTarget(record.tool_info?.parameters),
            errorKeys: record.error && typeof record.error === "object" ? Object.keys(record.error).sort() : [],
          })),
          resultKeys: Object.keys(results[0]).sort(),
          mcpCalls: countLines(countFile),
          authorizationCalls: countLines(authorizationFile),
          globalMcpConfigUnchanged: sameSnapshot(globalConfig, snapshot(join(homedir(), ".gemini", "config", "mcp_config.json"))),
        }),
      );
      process.exitCode = 2;
      return;
    }
    assert(typeof results[0].conversation_id === "string", "result conversation_id missing");
    assert(typeof results[0].response === "string", "result response missing");

    const steps = updates.map((record) => normalizeStep(record));
    const echoStep = steps.some((step) => step.kind === "tool" && step.toolName === "prism_echo");
    if (!echoStep) {
      console.log(
        JSON.stringify({
          status: "live_failed",
          reason: "Prism echo step missing",
          initToolCount: init[0].tools.length,
          initAdvertisedEcho: init[0].tools.includes("prism_echo"),
          stepTypes: updates.map((record) => ({
            state: record.state,
            stepType: record.step_type,
            tool: record.tool_info?.name,
            toolInfoKeys: record.tool_info && typeof record.tool_info === "object" ? Object.keys(record.tool_info).sort() : [],
            parameterKeys:
              record.tool_info?.parameters && typeof record.tool_info.parameters === "object"
                ? Object.keys(record.tool_info.parameters).sort()
                : [],
            callTarget: safeCallTarget(record.tool_info?.parameters),
            errorKeys: record.error && typeof record.error === "object" ? Object.keys(record.error).sort() : [],
          })),
          mcpCalls: countLines(countFile),
          authorizationCalls: countLines(authorizationFile),
          globalMcpConfigUnchanged: sameSnapshot(globalConfig, snapshot(join(homedir(), ".gemini", "config", "mcp_config.json"))),
        }),
      );
      process.exitCode = 2;
      return;
    }
    assert(countLines(countFile) === 1, "Prism echo did not execute exactly once");
    assert(countLines(authorizationFile) === 1, "Prism authorization did not run exactly once");
    assert(sameSnapshot(globalConfig, snapshot(join(homedir(), ".gemini", "config", "mcp_config.json"))), "global MCP config changed");

    const usage = safeUsage(results[0].usage);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          mode: live ? "live" : "fixture",
          protocol: "stream-json",
          eventCounts: { init: init.length, stepUpdate: updates.length, result: results.length },
          delegatedSteps: steps,
          conversationId: bounded(results[0].conversation_id, 512),
          usage,
          mcp: { server: "prism", tool: "prism_echo", calls: 1, authorized: true },
          globalMcpConfigUnchanged: true,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    assert(!existsSync(root), "probe workspace cleanup failed");
  }
}

async function runMcpServer() {
  const callFile = process.env.PRISM_PROBE_CALL_COUNT;
  const authorizationFile = process.env.PRISM_PROBE_AUTH_COUNT;
  if (!callFile || !authorizationFile) throw new Error("probe MCP server requires bounded counter paths");
  const server = createPrismMcpServer({
    name: "prism-antigravity-probe",
    version: "0.3.0-probe",
    tools: [
      {
        name: "prism_echo",
        description: "No-side-effect protocol probe",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        execute(args, context) {
          appendFileSync(callFile, `${context.toolCallId}\n`);
          return { toolCallId: context.toolCallId, name: "prism_echo", value: { echo: args.value } };
        },
      },
    ],
    authorize(input) {
      if (input.kind !== "tool" || input.name !== "prism_echo") return false;
      appendFileSync(authorizationFile, `${input.name}\n`);
      return { allowed: true, ownership: { tenantId: "probe" } };
    },
  });
  await server.connect(new StdioServerTransport());
}

async function runFakeAgy(unauthenticated) {
  if (unauthenticated) {
    process.stderr.write("authentication required\n");
    process.exitCode = 1;
    return;
  }
  const workspace = process.env.PRISM_PROBE_WORKSPACE;
  if (!workspace) throw new Error("probe CLI requires workspace");
  const config = JSON.parse(readFileSync(join(workspace, ".agents", "mcp_config.json"), "utf8"));
  const entry = config.mcpServers?.prism;
  if (!entry || typeof entry.command !== "string") throw new Error("workspace Prism MCP config missing");
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args ?? [],
    cwd: entry.cwd ?? workspace,
    env: { ...process.env, ...(entry.env ?? {}) },
  });
  const client = new Client({ name: "antigravity-fixture", version: "0.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    writeRecord({ type: "init", cwd: workspace, tools: listed.tools.map((tool) => tool.name), permission_mode: "ask" });
    const response = await client.callTool({ name: "prism_echo", arguments: { value: "probe" } });
    if (response.isError) throw new Error("Prism echo returned an MCP error");
    writeRecord({
      type: "step_update",
      conversation_id: "fixture-conversation-1",
      step_index: 0,
      state: "DONE",
      step_type: "tool",
      tool_info: { name: "prism_echo", output: response.content },
      usage: { input_tokens: 12, output_tokens: 4, thinking_tokens: 0, total_tokens: 16 },
    });
    writeRecord({
      type: "step_update",
      conversation_id: "fixture-conversation-1",
      step_index: 1,
      state: "DONE",
      step_type: "text",
      text_delta: "done",
    });
    writeRecord({
      type: "result",
      status: "SUCCESS",
      conversation_id: "fixture-conversation-1",
      response: "done",
      usage: { input_tokens: 12, output_tokens: 4, thinking_tokens: 0, total_tokens: 16 },
    });
  } finally {
    await client.close();
  }
}

function normalizeStep(record) {
  assert(record && record.type === "step_update", "invalid step_update");
  const conversationId = bounded(record.conversation_id, 512);
  const stepIndex = Number.isSafeInteger(record.step_index) && record.step_index >= 0 ? record.step_index : 0;
  const state = record.state === "ACTIVE" ? "active" : record.state === "DONE" ? "done" : "error";
  const kind =
    record.step_type === "tool"
      ? "tool"
      : record.step_type === "subagent"
        ? "subagent"
        : record.step_type === "checkpoint"
          ? "checkpoint"
          : record.step_type === "assistant" || record.step_type === "text" || record.step_type === "response"
            ? "assistant"
            : "unknown";
  const toolName = typeof record.tool_info?.name === "string" ? bounded(record.tool_info.name, 256) : undefined;
  const subagentType = typeof record.subagent_info?.type === "string" ? bounded(record.subagent_info.type, 256) : undefined;
  const durationValue =
    record.duration_ms ?? (typeof record.duration_seconds === "number" ? Math.round(record.duration_seconds * 1000) : undefined);
  const durationMs = safeInteger(durationValue, 24 * 60 * 60 * 1000);
  const usage = safeUsage(record.usage);
  return createDelegatedAgentStep({
    sessionId: "probe-session",
    runId: "probe-run",
    adapterId: "antigravity-cli",
    externalConversationId: conversationId,
    stepIndex,
    state,
    kind,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(usage === undefined ? {} : { usage }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(subagentType === undefined ? {} : { subagentType }),
  });
}

function parseNdjson(stdout) {
  const records = [];
  assert(Buffer.byteLength(stdout, "utf8") <= MAX_STREAM_BYTES, "CLI stream exceeds bounded stdout");
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    assert(Buffer.byteLength(line, "utf8") <= MAX_LINE_BYTES, "CLI event exceeds 64 KiB");
    const value = JSON.parse(line);
    assert(value && typeof value === "object" && !Array.isArray(value), "CLI emitted non-object JSON");
    const wrappedType =
      typeof value.event === "string" && value[value.event] && typeof value[value.event] === "object" ? value.event : undefined;
    const body = wrappedType ? value[wrappedType] : value;
    records.push({
      type: wrappedType ?? value.type,
      ...body,
      ...(value.conversation_id === undefined || body.conversation_id !== undefined ? {} : { conversation_id: value.conversation_id }),
    });
  }
  return records;
}

function safeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = {};
  for (const [target, source] of [
    ["inputTokens", "input_tokens"],
    ["outputTokens", "output_tokens"],
    ["thinkingTokens", "thinking_tokens"],
    ["cacheReadTokens", "cache_read_tokens"],
    ["cacheWriteTokens", "cache_write_tokens"],
    ["totalTokens", "total_tokens"],
  ]) {
    const amount = value[source] ?? value[target];
    const boundedAmount = safeInteger(amount, 1_000_000_000_000);
    if (boundedAmount !== undefined) output[target] = boundedAmount;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function safeInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

function bounded(value, maxBytes) {
  assert(typeof value === "string" && value.length > 0 && !/[\0\r\n]/.test(value), "bounded text missing");
  assert(Buffer.byteLength(value, "utf8") <= maxBytes, "bounded text exceeds cap");
  return value;
}

function safeCallTarget(parameters) {
  if (!parameters || typeof parameters !== "object") return undefined;
  const label = (value) => (typeof value === "string" && value.length <= 128 && !/[\0\r\n/\\]/.test(value) ? value : undefined);
  return { server: label(parameters.ServerName), tool: label(parameters.ToolName) };
}

function streamShapes(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      try {
        const value = JSON.parse(line);
        return {
          keys: value && typeof value === "object" ? Object.keys(value).sort() : [],
          event: value?.event,
          nestedKeys:
            value?.event && value[value.event] && typeof value[value.event] === "object" ? Object.keys(value[value.event]).sort() : [],
        };
      } catch {
        return { nonJsonBytes: Buffer.byteLength(line, "utf8") };
      }
    });
}

function probeEnv(workspace) {
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  env.PRISM_PROBE_WORKSPACE = workspace;
  return env;
}

function countLines(path) {
  if (!existsSync(path)) return 0;
  const value = readFileSync(path, "utf8").trim();
  return value ? value.split(/\r?\n/).length : 0;
}

function snapshot(path) {
  return existsSync(path) ? { exists: true, bytes: readFileSync(path) } : { exists: false, bytes: undefined };
}

function sameSnapshot(left, right) {
  return left.exists === right.exists && (!left.exists || left.bytes.equals(right.bytes));
}

function writeRecord(value) {
  const line = `${JSON.stringify(value)}\n`;
  assert(Buffer.byteLength(line, "utf8") <= MAX_LINE_BYTES, "fixture event exceeds 64 KiB");
  process.stdout.write(line);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runProcess(command, commandArgs, options) {
  return new Promise((resolveResult) => {
    const child = spawn(command, commandArgs, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let error;
    const append = (target, chunk, current, max) => {
      const next = current + chunk.byteLength;
      if (next <= max) target.push(chunk);
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes, MAX_STREAM_BYTES);
      if (stdoutBytes > MAX_STREAM_BYTES) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes = append(stderr, chunk, stderrBytes, MAX_STREAM_BYTES);
      if (stderrBytes > MAX_STREAM_BYTES) child.kill("SIGTERM");
    });
    child.once("error", (cause) => {
      error = cause;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        code,
        signal,
        timedOut,
        error,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
