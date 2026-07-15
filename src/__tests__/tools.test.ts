import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createContributionRegistries, createExtensionKernel, createMiddlewareRegistry, createToolParameterValidator, createToolRegistry, dispatchToolCall, filterTools } from "../index.js";
import type { AgentEvent, ToolArgumentValidator, ToolCallContent, ToolDefinition, ToolRegistry, ToolResult } from "../index.js";

function tool(name: string, parameters?: ToolDefinition["parameters"]): ToolDefinition {
  return {
    name,
    parameters,
    execute(args, context) {
      return { toolCallId: context.toolCallId, name, value: args };
    },
  };
}

describe("tool registry", () => {
  it("registers gets resolves and lists tools", () => {
    const echo = tool("echo");
    const registry: ToolRegistry = createToolRegistry();

    registry.register(echo);

    assert.equal(registry.get("echo"), echo);
    assert.equal(registry.resolve("echo"), echo);
    assert.deepEqual(registry.list(), [echo]);
    assert.throws(() => registry.resolve("missing"), /Unknown tool: missing/);
  });

  it("replaces same-name tools deterministically", () => {
    const first = tool("echo");
    const second = tool("echo");
    const other = tool("other");
    const registry = createToolRegistry([first, other]);

    registry.register(second);

    assert.equal(registry.get("echo"), second);
    assert.deepEqual(registry.list(), [second, other]);
  });

  it("strict mode rejects duplicate tool names", () => {
    const echo = tool("echo");

    assert.throws(() => createToolRegistry([echo, echo], { duplicate: "error" }), /Duplicate tool: echo/);
    const registry = createToolRegistry([echo], { duplicate: "error" });

    assert.throws(() => registry.register(echo), /Duplicate tool: echo/);
  });

  it("passes parameters through unchanged", () => {
    const parameters = { type: "object", properties: { text: { type: "string" } } } as const;
    const echo = tool("echo", parameters);
    const registry = createToolRegistry([echo]);

    assert.equal(registry.resolve("echo").parameters, parameters);
  });
});

describe("tool filters", () => {
  it("denies unknown and denied tools", () => {
    const tools = [tool("math.add"), tool("blocked.exec")];

    assert.deepEqual(filterTools(tools, { allow: ["math.add", "missing"], deny: ["blocked.exec"] }).map((item) => item.name), ["math.add"]);
  });

  it("allows exact names only", () => {
    const tools = [tool("math"), tool("math.add"), tool("math.add.fast")];

    assert.deepEqual(filterTools(tools, { allow: ["math.add"] }).map((item) => item.name), ["math.add"]);
  });

  it("composes scoped filters with deny taking precedence", () => {
    const tools = [tool("a"), tool("b"), tool("c")];

    assert.deepEqual(filterTools(tools, [{ allow: ["a", "b"] }, { allow: ["b", "c"], deny: ["c"] }]).map((item) => item.name), ["b"]);
  });
});

const context = { sessionId: "s1", runId: "r1", toolCallId: "call_1" };
const call: ToolCallContent = { type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } };

describe("tool contribution integration", () => {
  it("extension registered tool is not executed without host dispatch", async () => {
    let called = false;
    const contributed = { ...tool("echo"), execute: () => { called = true; return { toolCallId: "call_1", name: "echo" }; } };
    const kernel = createExtensionKernel();

    await kernel.load([{ name: "tools", setup: (api) => { api.registerTool(contributed); } }]);
    const result = await dispatchToolCall({ call, registry: createToolRegistry(), context });

    assert.equal(kernel.registries.tools.resolve("echo"), contributed);
    assert.equal(result.error?.message, "Unknown tool: echo");
    assert.equal(called, false);
  });

  it("contributed tool can be registered into host tool registry", async () => {
    const registries = createContributionRegistries();
    registries.tools.register("echo", tool("echo"));
    const registry = createToolRegistry([registries.tools.resolve("echo")]);

    const result = await dispatchToolCall({ call, registry, context, filter: { allow: ["echo"] } });

    assert.equal(result.name, "echo");
    assert.deepEqual(result.value, { text: "hi" });
  });

  it("extension middleware cannot bypass host tool filter", async () => {
    let called = false;
    const kernel = createExtensionKernel();
    await kernel.load([{ name: "mw", setup: (api) => { api.use<ToolCallContent>("tool_call", (value) => ({ ...value, name: "denied" })); } }]);
    const registry = createToolRegistry([
      tool("echo"),
      { ...tool("denied"), execute: () => { called = true; return { toolCallId: "call_1", name: "denied" }; } },
    ]);

    const result = await dispatchToolCall({ call, registry, context, filter: { deny: ["denied"] }, middleware: kernel.middleware });

    assert.equal(result.error?.message, "Tool denied: denied");
    assert.equal(called, false);
  });
});

describe("tool dispatch", () => {
  it("fails closed for unknown tools without execute", async () => {
    const events: AgentEvent[] = [];
    const result = await dispatchToolCall({ call, registry: createToolRegistry(), context, emit: (event) => { events.push(event); } });

    assert.equal(result.error?.message, "Unknown tool: echo");
    assert.equal(events[0]?.type, "tool_execution_blocked");
  });

  it("checks denied tools after middleware", async () => {
    let called = false;
    const middleware = createMiddlewareRegistry();
    middleware.use<ToolCallContent>("tool_call", (value) => ({ ...value, name: "denied" }));
    const registry = createToolRegistry([
      tool("echo"),
      { ...tool("denied"), execute: () => { called = true; return { toolCallId: "call_1", name: "denied" }; } },
    ]);

    const result = await dispatchToolCall({ call, registry, context, filter: { deny: ["denied"] }, middleware });

    assert.equal(result.error?.message, "Tool denied: denied");
    assert.equal(called, false);
  });

  it("rejects non-object args before validation or execute", async () => {
    let validated = false;
    let called = false;
    const registry = createToolRegistry([{ ...tool("echo"), execute: () => { called = true; return { toolCallId: "call_1", name: "echo" }; } }]);

    for (const args of [null, [], "x", 1, true]) {
      const result = await dispatchToolCall({
        call: { ...call, arguments: args } as unknown as ToolCallContent,
        registry,
        context,
        validate: () => { validated = true; },
      });
      assert.equal(result.error?.message, "Tool arguments must be a JSON object");
    }

    assert.equal(validated, false);
    assert.equal(called, false);
  });

  it("runs validator before execute", async () => {
    let called = false;
    const registry = createToolRegistry([{ ...tool("echo"), execute: () => { called = true; return { toolCallId: "call_1", name: "echo" }; } }]);

    const result = await dispatchToolCall({ call, registry, context, validate: () => "text is required" });

    assert.equal(result.error?.message, "text is required");
    assert.equal(called, false);
  });

  it("createToolParameterValidator maps adapter failures to validation_failed", async () => {
    let called = false;
    const adapter: ToolArgumentValidator = {
      validate: () => ({ ok: false, errors: [{ path: "/text", message: "required" }] }),
    };
    const registry = createToolRegistry([
      {
        ...tool("echo", { type: "object", properties: { text: { type: "string" } } }),
        execute: () => {
          called = true;
          return { toolCallId: "call_1", name: "echo" };
        },
      },
    ]);
    const events: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry,
      context,
      validate: createToolParameterValidator(adapter),
      emit: (event) => { events.push(event); },
    });

    assert.match(result.error?.message ?? "", /\/text: required/);
    assert.equal(called, false);
    assert.equal(events[0]?.type, "tool_execution_blocked");
    if (events[0]?.type === "tool_execution_blocked") assert.equal(events[0].reason, "validation_failed");
  });

  it("runs tool call and result middleware in order", async () => {
    const steps: string[] = [];
    const middleware = createMiddlewareRegistry();
    middleware.use<ToolCallContent>("tool_call", async (value, next) => {
      steps.push("call:1");
      return next({ ...value, arguments: { text: "changed" } });
    });
    middleware.use<ToolResult>("tool_result", (value) => {
      steps.push("result:1");
      return { ...value, metadata: { ok: true } };
    });
    const registry = createToolRegistry([{ ...tool("echo"), execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) }]);

    const result = await dispatchToolCall({ call, registry, context, middleware });

    assert.deepEqual(steps, ["call:1", "result:1"]);
    assert.deepEqual(result.value, { text: "changed" });
    assert.deepEqual(result.metadata, { ok: true });
  });

  it("emits started progress finished error and blocked events", async () => {
    const events: AgentEvent[] = [];
    const registry = createToolRegistry([
      { ...tool("echo"), execute: async (_args, ctx) => { await ctx.progress?.({ step: 1 }); return { toolCallId: ctx.toolCallId, name: "echo" }; } },
      { ...tool("boom"), execute: () => { throw new Error("bad secret-token"); } },
    ]);

    await dispatchToolCall({ call, registry, context, emit: (event) => { events.push(event); } });
    await dispatchToolCall({ call: { ...call, name: "boom" }, registry, context, emit: (event) => { events.push(event); }, secrets: ["secret-token"] });
    await dispatchToolCall({ call: { ...call, name: "missing" }, registry, context, emit: (event) => { events.push(event); } });

    assert.deepEqual(events.map((event) => event.type), [
      "tool_execution_started",
      "tool_execution_progress",
      "tool_execution_finished",
      "tool_execution_started",
      "tool_execution_error",
      "tool_execution_blocked",
    ]);
    assert.equal(events[4]?.type === "tool_execution_error" ? events[4].error.message : "", "bad [REDACTED]");
  });
});
