import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolDefinition, ToolEffectDeclaration, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import type { ConnectMcpToolsOptions, McpToolBridge } from "@arnilo/prism-mcp";
import { isObscuraReadTool } from "../classify.js";
import { createObscuraMcpTools, type ObscuraMcpToolsOptions } from "../mcp.js";

/** The 37 tools Obscura advertises at pinned revision f449e6f (render-disabled build). */
const OBSCURA_TOOLS = [
  "browser_back",
  "browser_clear_cookies",
  "browser_click",
  "browser_close",
  "browser_console_messages",
  "browser_count",
  "browser_detect_forms",
  "browser_evaluate",
  "browser_extract",
  "browser_fill",
  "browser_fill_form",
  "browser_forward",
  "browser_get_attribute",
  "browser_get_cookies",
  "browser_interactive_elements",
  "browser_links",
  "browser_markdown",
  "browser_navigate",
  "browser_network_requests",
  "browser_press_key",
  "browser_reload",
  "browser_scroll",
  "browser_search",
  "browser_select_option",
  "browser_set_cookie",
  "browser_set_storage_state",
  "browser_snapshot",
  "browser_storage_state",
  "browser_tab_close",
  "browser_tab_list",
  "browser_tab_new",
  "browser_tab_switch",
  "browser_type",
  "browser_wait_for",
  "browser_wait_for_text",
];
const RENDER_TOOLS = ["browser_pdf", "browser_screenshot"];

function remoteTool(name: string, prefix: string): ToolDefinition {
  return {
    name: `${prefix}${name}`,
    parameters: { type: "object", properties: {} },
    effect: isObscuraReadTool(name) ? { kind: "none", idempotency: "none" } : { kind: "external_mutation", idempotency: "unsupported" },
    execute: async (_args, context: ToolExecutionContext): Promise<ToolResult> => ({ toolCallId: context.toolCallId, name, value: name }),
  };
}

function fakeBridge(
  names: readonly string[],
  prefix = "obscura_",
  onExecute?: (name: string, run: () => Promise<ToolResult>) => Promise<ToolResult>,
): McpToolBridge & { refreshCount: () => number } {
  let refreshes = 0;
  return {
    get tools() {
      return names.map((n) => {
        const tool = remoteTool(n, prefix);
        if (onExecute) {
          const inner = tool.execute.bind(tool);
          tool.execute = async (args, context) => onExecute(n, () => Promise.resolve(inner(args, context)));
        }
        return tool;
      });
    },
    refresh: async () => {
      refreshes += 1;
    },
    close: async () => {},
    refreshCount: () => refreshes,
  };
}

function connectWith(names: readonly string[], captured?: { options?: ConnectMcpToolsOptions }) {
  return async (options: ConnectMcpToolsOptions): Promise<McpToolBridge> => {
    if (captured) captured.options = options;
    return fakeBridge(names, options.namePrefix ?? "obscura_");
  };
}

function baseOptions(connect: ObscuraMcpToolsOptions["connect"]): ObscuraMcpToolsOptions {
  return { transport: { type: "stdio", command: "/usr/local/bin/obscura", args: ["mcp"] }, connect };
}

test("complete advertised surface bridges with the default obscura_ prefix", async () => {
  const obscura = await createObscuraMcpTools(baseOptions(connectWith([...OBSCURA_TOOLS, ...RENDER_TOOLS])));
  assert.equal(obscura.tools.length, 37);
  assert.ok(obscura.tools.every((t) => t.name.startsWith("obscura_")));
  assert.ok(obscura.tools.some((t) => t.name === "obscura_browser_screenshot"));
  await obscura.close();
});

test("render-disabled surface omits only screenshot/pdf; render-enabled includes both", async () => {
  const disabled = await createObscuraMcpTools(baseOptions(connectWith(OBSCURA_TOOLS)));
  assert.equal(disabled.tools.length, 35);
  assert.ok(!disabled.tools.some((t) => t.name === "obscura_browser_screenshot"));
  assert.ok(!disabled.tools.some((t) => t.name === "obscura_browser_pdf"));
  await disabled.close();
});

test("reads are effect-free and non-exclusive; mutations are exclusive and serialized", async () => {
  const obscura = await createObscuraMcpTools(baseOptions(connectWith(OBSCURA_TOOLS)));
  const read = obscura.tools.find((t) => t.name === "obscura_browser_snapshot")!;
  const mutate = obscura.tools.find((t) => t.name === "obscura_browser_click")!;
  assert.equal(read.effect && typeof read.effect !== "function" ? read.effect.kind : undefined, "none");
  assert.equal(read.exclusive, undefined);
  assert.equal(mutate.exclusive, true);

  await obscura.close();
  assert.equal(read.effect && typeof read.effect !== "function" ? read.effect.kind : undefined, "none");
});

test("mutating executes serialize: overlapping remote calls never interleave", async () => {
  let inside = false;
  let overlapped = false;
  const bridge = fakeBridge(OBSCURA_TOOLS, "obscura_", async (name, run) => {
    if (name !== "browser_click") return run();
    if (inside) overlapped = true;
    inside = true;
    await new Promise((r) => setTimeout(r, 10));
    inside = false;
    return run();
  });
  const obscura = await createObscuraMcpTools(baseOptions(async () => bridge));
  const click = obscura.tools.find((t) => t.name === "obscura_browser_click")!;
  const ctx: ToolExecutionContext = { sessionId: "s", runId: "r", toolCallId: "c" };
  await Promise.all([click.execute({}, ctx), click.execute({}, ctx)]);
  assert.equal(overlapped, false);
  await obscura.close();
});

test("unknown future browser_* tools stay exposed as exclusive external mutations", async () => {
  const future = [...OBSCURA_TOOLS, "browser_replay_session"];
  const obscura = await createObscuraMcpTools(baseOptions(connectWith(future)));
  const tool = obscura.tools.find((t) => t.name === "obscura_browser_replay_session");
  assert.ok(tool, "unknown future tool must be exposed, not filtered");
  const effect = tool.effect as ToolEffectDeclaration;
  assert.equal(effect.kind, "external_mutation");
  assert.equal(effect.idempotency, "unsupported");
  assert.equal(tool.exclusive, true);
  await obscura.close();
});

test("refresh re-lists upstream tools without duplicate names or leaked calls", async () => {
  const captured: { options?: ConnectMcpToolsOptions } = {};
  let advertised = [...OBSCURA_TOOLS];
  const bridge = fakeBridge(advertised);
  const obscura = await createObscuraMcpTools(baseOptions(async () => bridge));
  assert.equal(obscura.tools.length, 35);
  advertised = [...OBSCURA_TOOLS, ...RENDER_TOOLS];
  Object.defineProperty(bridge, "tools", { get: () => advertised.map((n) => remoteTool(n, "obscura_")) });
  await obscura.refresh();
  assert.equal(obscura.tools.length, 37);
  assert.ok(obscura.tools.some((t) => t.name === "obscura_browser_screenshot"));
  await obscura.close();
  void captured;
});

test("native-name mode preserves Obscura tool names", async () => {
  const obscura = await createObscuraMcpTools({
    ...baseOptions(connectWith(OBSCURA_TOOLS)),
    namePrefix: "",
  });
  assert.ok(obscura.tools.some((t) => t.name === "browser_snapshot"));
  assert.ok(obscura.tools.every((t) => !t.name.includes("obscura_")));
  await obscura.close();
});

test("duplicate prefixed names fail closed with a collision error", async () => {
  const connect = async (): Promise<McpToolBridge> => {
    throw new Error("MCP tool name collision: obscura_browser_click (remote browser_click)");
  };
  await assert.rejects(createObscuraMcpTools(baseOptions(connect)), /collision/);
});

test("stdio transport config is validated with the owned-process policy", async () => {
  await assert.rejects(
    createObscuraMcpTools({
      transport: { type: "stdio", command: "obscura", args: ["mcp"] },
      connect: connectWith(OBSCURA_TOOLS),
    }),
    /Absolute/,
  );
  await assert.rejects(
    createObscuraMcpTools({
      transport: { type: "stdio", command: "/usr/local/bin/obscura", args: ["mcp", "--allow-private-network"] },
      connect: connectWith(OBSCURA_TOOLS),
    }),
    /allowInsecureFlags/,
  );
});

test("non-loopback HTTP endpoints require explicit allowRemoteHttp", async () => {
  const connect = connectWith(OBSCURA_TOOLS);
  await assert.rejects(
    createObscuraMcpTools({
      transport: {
        type: "streamable-http",
        url: "https://mcp.example.com",
        allowedOrigins: ["https://app.example.com"],
      },
      connect,
    }),
    /allowRemoteHttp/,
  );
  const obscura = await createObscuraMcpTools({
    transport: {
      type: "streamable-http",
      url: "https://mcp.example.com",
      allowedOrigins: ["https://app.example.com"],
    },
    allowRemoteHttp: true,
    connect,
  });
  await obscura.close();
});

test("close forwards to the underlying bridge and repeated closes are safe", async () => {
  let closed = 0;
  const bridge = fakeBridge(OBSCURA_TOOLS);
  bridge.close = async () => {
    closed += 1;
  };
  const obscura = await createObscuraMcpTools(baseOptions(async () => bridge));
  await obscura.close();
  await obscura.close();
  assert.equal(closed, 2);
});

test("serverId and prefix defaults are used when omitted", async () => {
  const captured: { options?: ConnectMcpToolsOptions } = {};
  const obscura = await createObscuraMcpTools(
    baseOptions(async (options) => {
      captured.options = options;
      return fakeBridge(OBSCURA_TOOLS);
    }),
  );
  assert.equal(captured.options?.serverId, "obscura");
  assert.equal(captured.options?.namePrefix, "obscura_");
  await obscura.close();
});
