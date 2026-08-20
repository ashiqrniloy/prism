import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  DevicePolicyError,
  ExecutionDeniedError,
  type JsonObject,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import type { McpToolBridge } from "@arnilo/prism-mcp";
import { type ComputerUseLinuxToolsOptions, createComputerUseLinuxTools } from "../create.js";

const baseDevice = {
  kind: "desktop-control" as const,
  enabled: true,
  requireApproval: true,
  sandbox: "test-desktop",
};

function context(toolCallId = "call-1"): ToolExecutionContext {
  return { sessionId: "session-1", runId: "run-1", toolCallId };
}

function remoteTool(name: string, run: (args: JsonObject, ctx: ToolExecutionContext) => unknown | Promise<unknown>): ToolDefinition {
  return {
    name,
    parameters: { type: "object", additionalProperties: true },
    async execute(args, ctx): Promise<ToolResult> {
      return { toolCallId: ctx.toolCallId, name, value: await run(args, ctx) };
    },
  };
}

function bridge(tools: readonly ToolDefinition[], onClose?: () => void): McpToolBridge {
  return {
    tools,
    refresh: async () => {},
    close: async () => onClose?.(),
  };
}

function options(tools: readonly ToolDefinition[], overrides: Partial<ComputerUseLinuxToolsOptions> = {}): ComputerUseLinuxToolsOptions {
  return {
    platform: "linux",
    device: baseDevice,
    runLimits: { maxTurns: 8, maxToolCalls: 20 },
    connect: async () => bridge(tools),
    ...overrides,
  };
}

function find(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}

function execute(tool: ToolDefinition, args: JsonObject, ctx: ToolExecutionContext): Promise<ToolResult> {
  return Promise.resolve(tool.execute(args, ctx));
}

test("factory rejects non-Linux and invalid admission before connect", async () => {
  let connects = 0;
  const connect = async () => {
    connects += 1;
    return bridge([]);
  };
  await assert.rejects(createComputerUseLinuxTools(options([], { platform: "darwin", connect })), /Linux/);
  await assert.rejects(createComputerUseLinuxTools(options([], { device: { ...baseDevice, kind: "voice" }, connect })), /desktop-control/);
  await assert.rejects(createComputerUseLinuxTools(options([], { device: { ...baseDevice, enabled: false }, connect })), DevicePolicyError);
  await assert.rejects(createComputerUseLinuxTools(options([], { device: { ...baseDevice, sandbox: undefined }, connect })), /sandbox/);
  await assert.rejects(
    createComputerUseLinuxTools({ ...options([], { connect }), runLimits: undefined } as unknown as ComputerUseLinuxToolsOptions),
    /RunLimits/,
  );
  assert.equal(connects, 0, "invalid factories must not connect or spawn");
});

test("factory uses unprefixed known tools, omits setup by default, and filters unknown tools", async () => {
  let received: unknown;
  const desktop = await createComputerUseLinuxTools(
    options(
      [
        remoteTool("doctor", () => ({ ready: true })),
        remoteTool("click", () => ({ clicked: true })),
        remoteTool("setup_accessibility", () => ({ setup: true })),
        remoteTool("future_tool", () => ({ nope: true })),
      ],
      {
        connect: async (input) => {
          received = input;
          return bridge([
            remoteTool("doctor", () => ({ ready: true })),
            remoteTool("click", () => ({ clicked: true })),
            remoteTool("setup_accessibility", () => ({ setup: true })),
            remoteTool("future_tool", () => ({ nope: true })),
          ]);
        },
      },
    ),
  );
  assert.deepEqual(
    desktop.tools.map((tool) => tool.name),
    ["doctor", "click"],
  );
  assert.equal((received as { namePrefix: string }).namePrefix, "");
  assert.deepEqual((received as { transport: { args?: readonly string[] } }).transport.args, ["mcp"]);
  await assert.doesNotReject(execute(find(desktop.tools, "doctor"), {}, context()));
});

test("includeSetupTools opt-in exposes both upstream setup tools", async () => {
  const desktop = await createComputerUseLinuxTools(
    options([remoteTool("setup_accessibility", () => true), remoteTool("setup_window_targeting", () => true)], {
      includeSetupTools: true,
      approved: true,
    }),
  );
  assert.deepEqual(
    desktop.tools.map((tool) => tool.name),
    ["setup_accessibility", "setup_window_targeting"],
  );
});

test("mutating tools require device approval and do not call MCP when denied", async () => {
  let calls = 0;
  const desktop = await createComputerUseLinuxTools(options([remoteTool("click", () => ++calls)], { approved: false }));
  await assert.rejects(execute(find(desktop.tools, "click"), {}, context()), DevicePolicyError);
  assert.equal(calls, 0);
});

test("mutating tools run ExecutionPolicy before MCP", async () => {
  let calls = 0;
  const desktop = await createComputerUseLinuxTools(
    options([remoteTool("click", () => ++calls)], {
      approved: true,
      executionPolicy: { check: () => ({ allowed: false, reason: "operator denied" }) },
    }),
  );
  await assert.rejects(execute(find(desktop.tools, "click"), {}, context()), ExecutionDeniedError);
  assert.equal(calls, 0);
});

test("read tools bypass per-call approval but remain device-admitted", async () => {
  let calls = 0;
  const desktop = await createComputerUseLinuxTools(options([remoteTool("doctor", () => ++calls)], { approved: false }));
  const result = await execute(find(desktop.tools, "doctor"), {}, context());
  assert.equal(result.value, 1);
  assert.equal(calls, 1);
});

test("screenshot and app-state oversize results are dropped with the device marker", async () => {
  const desktop = await createComputerUseLinuxTools(
    options(
      [remoteTool("screenshot", () => ({ content: "x".repeat(200) })), remoteTool("get_app_state", () => ({ state: "x".repeat(200) }))],
      { device: { ...baseDevice, limits: { maxChunkBytes: 32 } } },
    ),
  );
  for (const name of ["screenshot", "get_app_state"]) {
    const result = await execute(find(desktop.tools, name), {}, context(name));
    assert.equal((result.value as { marker: string }).marker, "dropped_oversize");
    const firstContent = result.content?.[0];
    assert.ok(firstContent?.type === "text");
    assert.equal(firstContent.text, "dropped_oversize");
    assert.equal(result.metadata?.trust, "untrusted_external");
  }
});

test("mutating calls share one serial mutex", async () => {
  const events: string[] = [];
  let active = 0;
  let maximum = 0;
  const run = async (_args: JsonObject, ctx: ToolExecutionContext) => {
    events.push(`${ctx.toolCallId}:start`);
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(10);
    active -= 1;
    events.push(`${ctx.toolCallId}:end`);
    return true;
  };
  const desktop = await createComputerUseLinuxTools(options([remoteTool("click", run), remoteTool("type_text", run)], { approved: true }));
  await Promise.all([
    execute(find(desktop.tools, "click"), {}, context("click-1")),
    execute(find(desktop.tools, "type_text"), {}, context("type-1")),
  ]);
  assert.equal(maximum, 1);
  assert.equal(events.filter((event) => event.endsWith(":start")).length, 2);
  assert.equal(events.filter((event) => event.endsWith(":end")).length, 2);
  assert.ok(
    events.indexOf("click-1:end") < events.indexOf("type-1:start") || events.indexOf("type-1:end") < events.indexOf("click-1:start"),
  );
});

test("returned external results are redacted and close delegates to the bridge", async () => {
  let closed = false;
  const desktop = await createComputerUseLinuxTools(
    options([remoteTool("doctor", () => ({ token: "SECRET" }))], {
      redactor: { redact: (value) => JSON.parse(JSON.stringify(value).replaceAll("SECRET", "[REDACTED]")) },
      connect: async () =>
        bridge([remoteTool("doctor", () => ({ token: "SECRET" }))], () => {
          closed = true;
        }),
    }),
  );
  const result = await execute(find(desktop.tools, "doctor"), {}, context());
  assert.deepEqual(result.value, { token: "[REDACTED]" });
  assert.equal(result.metadata?.trust, "untrusted_external");
  await desktop.close();
  assert.equal(closed, true);
});

test("import is inert", async () => {
  const module = await import("../index.js");
  assert.equal(typeof module.createComputerUseLinuxTools, "function");
});
