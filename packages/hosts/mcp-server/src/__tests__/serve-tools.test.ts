import { describe, it, afterEach } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type EventOrigin,
  type HostPort,
  type HostUi,
  type HostUiRequest,
  type HostUiResponse,
  type PackageInstance,
  type RunController,
  type Session,
  type ToolCallHookPayload,
  type ToolDefinition,
} from "@arnilo/prism";
import { type CallbackBroker, createCallbackBroker, effectsTable, type HookCodec, type McpEndpoint } from "@arnilo/prism/driver-kit";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import approval from "@arnilo/prism-approval";
import toolsCoding, { createEditTool } from "@arnilo/prism-tools-coding";
import { ServeToolsError, serveTools } from "../index.js";
import type {
  PermissionCodec,
  ServeToolsHandle,
  ServeToolsLimits,
  ServeToolsPermissionTool,
  ServeToolsResource,
  ServeToolsTransport,
} from "../types.js";

const CLI = fileURLToPath(new URL("../../../../../src/cli.ts", import.meta.url));
const ORIGIN: EventOrigin = {
  kind: "external",
  agent: "serve-tools-agent",
  agentId: "serve-tools-agent",
  vendor: "example",
  depth: 0,
};
const FAIL = { exitCode: 2, stdout: '{"fail":true}' };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temp directory removed after the test, so a failed run leaves no litter. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
const codec: HookCodec = {
  decode: () => ({ kind: "stop" }),
  encode: () => FAIL,
};

interface ServedContext {
  readonly run: RunController;
  readonly broker: CallbackBroker;
  readonly served: ServeToolsHandle;
  readonly client: Client;
  readonly calls: ToolCallHookPayload[];
  readonly events: AgentEvent[];
  readonly session: Session;
  readonly agent: Agent;
  readonly runDir: string;
}

interface ServeSetup {
  readonly allow: readonly string[];
  readonly tools: readonly ToolDefinition[];
  /** Definitions the agent registers as host tools (when they are not supplied by a package). */
  readonly hostTools?: readonly ToolDefinition[];
  readonly transport: ServeToolsTransport;
  readonly prefix?: string;
  readonly resources?: readonly ServeToolsResource[];
  readonly limits?: ServeToolsLimits;
  readonly packages?: readonly PackageInstance[];
  readonly host?: HostPort;
  readonly principal?: boolean;
  readonly headerEnv?: string;
  readonly origin?: EventOrigin;
  readonly permissionTool?: ServeToolsPermissionTool;
  readonly durable?: boolean;
}

/** Runs `body` inside a real session run and surfaces an assertion failure from inside the loop. */
async function withRun(
  setup: {
    readonly tools?: readonly ToolDefinition[];
    readonly packages?: readonly PackageInstance[];
    readonly host?: HostPort;
    readonly principal?: boolean;
    /** A `snapshot`/`restore` pair makes the loop durable, so `run.ask` can stage a suspension. */
    readonly durable?: boolean;
  },
  body: (ctx: { run: RunController; events: AgentEvent[]; session: Session; agent: Agent }) => Promise<void>,
): Promise<{ events: AgentEvent[]; agent: Agent }> {
  const events: AgentEvent[] = [];
  let failure: unknown;
  const loopName = `test-loop-${crypto.randomUUID().slice(0, 8)}`;
  const loop = definePackage({
    name: loopName,
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["slot:loop"],
    setup(prism) {
      prism.slots.loop.provide({
        name: loopName,
        usesModel: false,
        ...(setup.durable ? { snapshot: () => null, restore: () => undefined } : {}),
        async run(run) {
          try {
            await body({ run, events, session: run.session, agent });
          } catch (error) {
            failure = error;
            throw error;
          }
        },
      });
    },
  });
  const agent = await createAgent({
    id: `serve-tools-${crypto.randomUUID().slice(0, 8)}`,
    slots: { store: createMemorySessionStore() },
    packages: [loop(), ...(setup.packages ?? [])],
    ownership: { tenantId: "test-tenant" },
    ...(setup.principal === false ? {} : { principal: { kind: "user", id: "test-principal" } }),
    ...(setup.tools && setup.tools.length > 0 ? { tools: { add: setup.tools } } : {}),
    ...(setup.host === undefined ? {} : { host: setup.host }),
  });
  const session = await agent.session({ id: "s", create: true });
  const pump = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  try {
    await session.run("go");
  } catch (error) {
    if (failure === undefined) failure = error;
  }
  await session.close().catch(() => undefined);
  await pump.catch(() => undefined);
  if (failure !== undefined) throw failure;
  return { events, agent };
}

/** Serves tools inside a run, connects an MCP client, and tears everything down afterwards. */
async function withServed(setup: ServeSetup, body: (ctx: ServedContext) => Promise<void>): Promise<void> {
  const runDir = tempDir("serve-tools-");
  const calls: ToolCallHookPayload[] = [];
  const collector = definePackage({
    name: "test-collector",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("tool.call", (payload) => {
        calls.push(payload);
      });
    },
  });
  await withRun(
    {
      tools: setup.hostTools ?? setup.tools,
      packages: [...(setup.packages ?? []), collector()],
      host: setup.host,
      principal: setup.principal,
      durable: setup.durable,
    },
    async ({ run, events, session, agent }) => {
      const broker = await createCallbackBroker(run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 10_000 });
      const served = await serveTools(run, {
        broker,
        tools: setup.tools,
        allow: setup.allow,
        transport: setup.transport,
        origin: setup.origin ?? ORIGIN,
        ...(setup.prefix === undefined ? {} : { prefix: setup.prefix }),
        ...(setup.resources === undefined ? {} : { resources: setup.resources }),
        ...(setup.limits === undefined ? {} : { limits: setup.limits }),
        ...(setup.headerEnv === undefined ? {} : { headerEnv: setup.headerEnv }),
        ...(setup.permissionTool === undefined ? {} : { permissionTool: setup.permissionTool }),
        ...(setup.transport === "stdio-relay" ? { relay: { command: [process.execPath, CLI] } } : {}),
      });
      const client = await connectClient(served);
      try {
        await body({ run, broker, served, client, calls, events, session, agent, runDir });
      } finally {
        await client.close().catch(() => undefined);
        await served.close();
        await broker.close();
      }
    },
  );
}

async function connectClient(served: ServeToolsHandle): Promise<Client> {
  const client = new Client({ name: "serve-tools-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transportFor(served.endpoint, served.env));
  return client;
}

function transportFor(endpoint: McpEndpoint, env: Readonly<Record<string, string>>) {
  if (endpoint.transport === "http")
    return new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: `Bearer ${env[endpoint.headerEnv]}` } },
    });
  return new StdioClientTransport({ command: endpoint.command, args: [...endpoint.args] });
}

function scriptedHost(answers: readonly HostUiResponse[]): HostPort {
  let index = 0;
  return {
    ui: {
      request: (async (_request: HostUiRequest): Promise<HostUiResponse> => {
        const answer = answers[Math.min(index, answers.length - 1)];
        index += 1;
        return answer ?? { status: "unavailable" };
      }) as HostUi["request"],
    },
  };
}

function text(result: { content?: unknown }): string {
  return JSON.stringify(result.content ?? "");
}

/** The text of a result's first block, for reading a neutral permission decision. */
function textOf(result: { content?: unknown }): string {
  const blocks = (result.content ?? []) as readonly { readonly type: string; readonly text?: string }[];
  return blocks.map((block) => block.text ?? "").join("");
}

function permissionTool(overrides: Partial<ServeToolsPermissionTool> = {}): ServeToolsPermissionTool {
  return { name: "permission", ...overrides };
}

/** A `tool.call` gate driven by the permission tool's own input, so one test covers several mappings. */
function scriptedGate(): PackageInstance {
  return definePackage({
    name: "test-permission-gate",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("tool.call", (payload) => {
        const mode = (payload.args as { readonly mode?: unknown }).mode;
        if (mode === "rewrite") return { rewrite: { text: "rewritten" } };
        if (mode === "deny") return { deny: "policy" };
        if (mode === "respond") return { respond: { toolCallId: payload.callId, name: payload.name, content: [] } };
        return undefined;
      });
    },
  })();
}

/** A host that counts how many times it was asked to confirm. */
function countingHost(): { readonly host: HostPort; readonly asked: () => number } {
  let asked = 0;
  return {
    host: {
      ui: {
        // `confirm` then `select` (once/always), as `@arnilo/prism-approval` prompts.
        request: (async (): Promise<HostUiResponse> => {
          asked += 1;
          return { status: "answered", value: asked % 2 === 1 ? true : "once" };
        }) as HostUi["request"],
      },
    },
    asked: () => asked,
  };
}

function echoTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "echo",
    description: "Echo the input back",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    effects: ["read"],
    execute: (args, context) => ({
      toolCallId: context.toolCallId,
      name: "echo",
      content: [{ type: "text", text: String(args.text ?? "") }],
    }),
    ...overrides,
  };
}

describe("serveTools", () => {
  it("served_tool_under_approval_ask_prompts_and_deny_reaches_client", async () => {
    for (const transport of ["loopback-http", "stdio-relay"] as const) {
      const root = tempDir("serve-tools-root-");
      const file = join(root, "a.txt");
      writeFileSync(file, "hello");
      await withServed(
        {
          allow: ["edit"],
          tools: [createEditTool(root)],
          hostTools: [],
          transport,
          packages: [toolsCoding({ root }), approval({ mode: "ask" })],
          host: scriptedHost([
            { status: "answered", value: true },
            { status: "answered", value: "once" },
            { status: "answered", value: false },
          ]),
        },
        async ({ client }) => {
          const first = await client.callTool({
            name: "edit",
            arguments: { path: file, edits: [{ oldText: "hello", newText: "world" }] },
          });
          assert.notEqual(first.isError, true, `${transport}: the confirmed call runs`);
          assert.match(text(first), /Edited .*: 1 block\(s\)\./);
          assert.equal(readFileSync(file, "utf8"), "world");

          const second = await client.callTool({
            name: "edit",
            arguments: { path: file, edits: [{ oldText: "world", newText: "again" }] },
          });
          assert.equal(second.isError, true, `${transport}: the declined call is an error result`);
          assert.match(text(second), /denied/);
          assert.equal(readFileSync(file, "utf8"), "world", `${transport}: the declined call changed nothing`);
        },
      );
    }
  });

  it("tools_outside_allow_list_are_invisible", async () => {
    await withServed(
      { allow: ["echo"], tools: [echoTool(), echoTool({ name: "hidden" })], transport: "loopback-http" },
      async ({ client, calls }) => {
        const listed = await client.listTools();
        assert.deepEqual(
          listed.tools.map((tool) => tool.name),
          ["echo"],
        );
        await assert.rejects(client.callTool({ name: "hidden", arguments: {} }), /hidden/);
        assert.deepEqual(
          calls.filter((call) => call.name === "hidden"),
          [],
          "an unlisted call never reaches tool.call",
        );
      },
    );
  });

  it("unknown_allow_list_name_fails_before_serving", async () => {
    const runDir = tempDir("serve-tools-");
    let caught: unknown;
    await withRun({ tools: [echoTool()] }, async ({ run }) => {
      const broker = await createCallbackBroker(run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        await serveTools(run, { broker, tools: [echoTool()], allow: ["missing"], transport: "loopback-http", origin: ORIGIN });
      } catch (error) {
        caught = error;
      }
      await broker.close();
    });
    assert.equal((caught as { code?: string }).code, "unknown_tool");

    // An empty allow list fails with its own error before the bridge is built.
    await withRun({ tools: [echoTool()] }, async ({ run }) => {
      const broker = await createCallbackBroker(run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        await serveTools(run, { broker, tools: [echoTool()], allow: [], transport: "loopback-http", origin: ORIGIN });
      } catch (error) {
        caught = error;
      }
      await broker.close();
    });
    assert.ok(caught instanceof ServeToolsError);
    assert.equal(caught.code, "serve_tools_empty");

    // A bad transport fails before the route is registered: the broker still has no MCP route.
    await withRun({ tools: [echoTool()] }, async ({ run }) => {
      const broker = await createCallbackBroker(run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        await serveTools(run, { broker, tools: [echoTool()], allow: ["echo"], transport: "stdio-relay", origin: ORIGIN });
      } catch (error) {
        caught = error;
      }
      const refused = await fetch(`${broker.url}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${broker.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.match(await refused.text(), /no MCP route is registered/);
      await broker.close();
    });
    assert.equal((caught as { code?: string }).code, "serve_tools_transport");
  });

  it("wrong_token_and_origin_are_rejected", async () => {
    await withServed({ allow: ["echo"], tools: [echoTool()], transport: "loopback-http" }, async ({ broker }) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      const headers = { "content-type": "application/json" };
      const missing = await fetch(`${broker.url}/mcp`, { method: "POST", headers, body });
      assert.equal(missing.status, 401);
      const wrong = await fetch(`${broker.url}/mcp`, { method: "POST", headers: { ...headers, authorization: "Bearer nope" }, body });
      assert.equal(wrong.status, 401);
      const origin = await fetch(`${broker.url}/mcp`, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${broker.token}`, origin: "https://evil.test" },
        body,
      });
      assert.equal(origin.status, 403);
    });
  });

  it("late_call_after_close_abort_and_suspension_is_rejected", async () => {
    // close(): the route is unregistered, so the broker answers with no MCP route.
    await withServed({ allow: ["echo"], tools: [echoTool()], transport: "loopback-http" }, async ({ client, served }) => {
      await served.close();
      await assert.rejects(client.callTool({ name: "echo", arguments: {} }));
    });

    // abort: `serveTools` closes on the run signal, and the broker stops listening.
    await withServed({ allow: ["echo"], tools: [echoTool()], transport: "loopback-http" }, async ({ client, session }) => {
      session.abort("test abort");
      await assert.rejects(client.callTool({ name: "echo", arguments: {} }));
    });

    // approval_pending: the gated call answers isError and closes the server.
    const gate = definePackage({
      name: "test-ask",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("tool.call", (payload) => (payload.name === "gated" ? { ask: "confirm gated" } : undefined));
      },
    });
    await withServed(
      { allow: ["gated"], tools: [echoTool({ name: "gated", effects: ["write"] })], transport: "loopback-http", packages: [gate()] },
      async ({ client }) => {
        const pending = await client.callTool({ name: "gated", arguments: {} });
        assert.equal(pending.isError, true);
        assert.match(text(pending), /approval is pending/);
        await assert.rejects(client.callTool({ name: "gated", arguments: {} }));
      },
    );
  });

  it("served_calls_are_persisted_and_attributed", async () => {
    await withServed({ allow: ["echo"], tools: [echoTool()], transport: "loopback-http" }, async ({ client, calls, session }) => {
      const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
      assert.notEqual(result.isError, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.name, "echo");
      assert.deepEqual(calls[0]?.origin, ORIGIN);
      const messages = await session.messages();
      assert.ok(
        messages.some((message) => message.content.some((block) => block.type === "tool_result")),
        "the tool result is persisted on the session",
      );
    });
  });

  it("no_token_in_events_inspect_errors_or_relay_descriptor", async () => {
    await withServed(
      { allow: ["echo"], tools: [echoTool()], transport: "loopback-http" },
      async ({ client, broker, events, run, runDir, agent, served }) => {
        const listed = await client.listTools();
        await client.callTool({ name: "echo", arguments: { text: "hi" } });
        const token = broker.token;
        assert.ok(token.length > 0);
        for (const event of events) assert.doesNotMatch(JSON.stringify(event), new RegExp(token));
        assert.doesNotMatch(JSON.stringify(await run.session.messages()), new RegExp(token));
        assert.doesNotMatch(JSON.stringify(agent.inspect()), new RegExp(token));
        assert.doesNotMatch(JSON.stringify(listed), new RegExp(token));
        assert.doesNotMatch(JSON.stringify(served.endpoint), new RegExp(token));
        const descriptor = readFileSync(join(runDir, "relay.json"), "utf8");
        assert.doesNotMatch(descriptor, new RegExp(token));
        const rejected = await fetch(`${broker.url}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer wrong" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        });
        assert.doesNotMatch(await rejected.text(), new RegExp(token));
      },
    );
  });

  it("result_bytes_and_concurrency_bounds", async () => {
    const long = "x".repeat(4096);
    await withServed(
      {
        allow: ["echo"],
        tools: [
          echoTool({
            execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", content: [{ type: "text", text: long }] }),
          }),
        ],
        transport: "loopback-http",
        limits: { resultBytes: 64 },
      },
      async ({ client }) => {
        const result = await client.callTool({ name: "echo", arguments: {} });
        const returned = JSON.parse(text(result)) as { type: string; text: string }[];
        assert.equal(Buffer.byteLength(returned[0]?.text ?? "", "utf8"), 64);
      },
    );

    let started: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await withServed(
      {
        allow: ["slow"],
        tools: [
          echoTool({
            name: "slow",
            execute: async (_args, context) => {
              started();
              await gate;
              return { toolCallId: context.toolCallId, name: "slow", content: [{ type: "text", text: "done" }] };
            },
          }),
        ],
        transport: "loopback-http",
        limits: { maxConcurrentCalls: 1 },
      },
      async ({ client }) => {
        const first = client.callTool({ name: "slow", arguments: {} });
        await entered;
        await assert.rejects(client.callTool({ name: "slow", arguments: {} }), /concurrent/);
        release();
        assert.notEqual((await first).isError, true);
      },
    );
  });

  it("resources_are_listed_and_read", async () => {
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        resources: [{ uri: "prism://notes/a", name: "a", mimeType: "text/plain", text: "hello resource" }],
      },
      async ({ client }) => {
        const listed = await client.listResources();
        assert.deepEqual(
          listed.resources.map((resource) => resource.uri),
          ["prism://notes/a"],
        );
        const read = await client.readResource({ uri: "prism://notes/a" });
        assert.equal((read.contents[0] as { text?: string }).text, "hello resource");
      },
    );

    const runDir = tempDir("serve-tools-");
    let caught: unknown;
    await withRun({ tools: [echoTool()] }, async ({ run }) => {
      const broker = await createCallbackBroker(run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        await serveTools(run, {
          broker,
          tools: [echoTool()],
          allow: ["echo"],
          transport: "loopback-http",
          origin: ORIGIN,
          resources: [{ uri: "prism://notes/big", name: "big", text: "x".repeat(256 * 1024 + 1) }],
        });
      } catch (error) {
        caught = error;
      }
      await broker.close();
    });
    assert.equal((caught as { code?: string }).code, "serve_tools_resource_bytes");
  });

  it("name_prefix_maps_back_to_the_tool", async () => {
    await withServed(
      { allow: ["echo"], tools: [echoTool()], transport: "loopback-http", prefix: "tool_" },
      async ({ client, calls, served }) => {
        assert.deepEqual(served.tools, ["tool_echo"]);
        const listed = await client.listTools();
        assert.deepEqual(
          listed.tools.map((tool) => tool.name),
          ["tool_echo"],
        );
        const result = await client.callTool({ name: "tool_echo", arguments: { text: "prefixed" } });
        assert.match(text(result), /prefixed/);
        assert.equal(calls[0]?.name, "echo", "the bridge invokes the real tool name");
      },
    );
  });

  it("stdio_relay_endpoint_spawns_the_relay_once", async () => {
    await withServed({ allow: ["echo"], tools: [echoTool()], transport: "stdio-relay" }, async ({ served, client, runDir }) => {
      assert.equal(served.endpoint.transport, "stdio");
      if (served.endpoint.transport !== "stdio") return;
      assert.deepEqual(served.endpoint.args.slice(-3), ["mcp", "--run", dirname(join(runDir, "x"))]);
      assert.deepEqual(served.env, {});
      const result = await client.callTool({ name: "echo", arguments: { text: "relayed" } });
      assert.match(text(result), /relayed/);
    });
  });

  it("permission_tool_maps_allow_deny_and_updated_input", async () => {
    const ask = async (client: Client, input: Record<string, unknown>) =>
      JSON.parse(textOf(await client.callTool({ name: "permission", arguments: { toolName: "echo", input } })));
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool({ rewrite: true }),
        packages: [scriptedGate()],
      },
      async ({ client, served, calls }) => {
        assert.deepEqual(served.tools, ["echo", "permission"]);
        assert.deepEqual(await ask(client, {}), { behavior: "allow" });
        assert.deepEqual(await ask(client, { mode: "rewrite" }), { behavior: "allow", updatedInput: { text: "rewritten" } });
        assert.deepEqual(await ask(client, { mode: "deny" }), { behavior: "deny", message: "denied: policy" });
        assert.deepEqual(await ask(client, { mode: "respond" }), {
          behavior: "deny",
          // The tool never passes `respond` support, so the kernel refuses before `ask` can return one.
          message: "denied: respond_unsupported",
        });
        assert.deepEqual(
          calls.map((call) => call.name),
          ["echo", "echo", "echo", "echo", "echo"],
          // The rewrite case is re-gated (plan 177 Task 2: round 1 rewrites, round 2 gates the final args); none executes.
        );
      },
    );
    // Without `rewrite`, the kernel refuses a rewrite and the tool reports that denial.
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool(),
        packages: [scriptedGate()],
      },
      async ({ client }) => {
        assert.deepEqual(await ask(client, { mode: "rewrite" }), { behavior: "deny", message: "denied: rewrite_unsupported" });
      },
    );
  });

  it("permission_tool_custom_codec_round_trip", async () => {
    const codec: PermissionCodec = {
      decode: (args) => {
        const vendor = args as { readonly tool_name: string; readonly arguments: Record<string, unknown> };
        return { toolName: vendor.tool_name, input: vendor.arguments as never };
      },
      encode: (decision) => ({ content: [{ type: "text", text: `decision:${decision.behavior}` }] }),
    };
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool({ codec }),
        packages: [scriptedGate()],
      },
      async ({ client, calls }) => {
        const result = await client.callTool({ name: "permission", arguments: { tool_name: "echo", arguments: { text: "hi" } } });
        assert.equal(textOf(result), "decision:allow");
        assert.equal(calls[0]?.name, "echo", "the codec maps the vendor name to the neutral one");
        assert.deepEqual(calls[0]?.args, { text: "hi" });
      },
    );
  });

  it("permission_tool_without_ui_denies", async () => {
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool(),
        packages: [approval({ mode: "ask" })],
      },
      async ({ client }) => {
        const result = await client.callTool({ name: "permission", arguments: { toolName: "echo", input: {} } });
        assert.notEqual(result.isError, true, "a denial is a decision, not a tool error");
        assert.deepEqual(JSON.parse(textOf(result)), {
          behavior: "deny",
          message: "no one can approve this call, so it is denied",
        });
      },
    );
  });

  it("permission_tool_approval_pending_denies_with_message_and_closes", async () => {
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool(),
        packages: [approval({ mode: "ask" })],
        durable: true,
      },
      async ({ client }) => {
        const result = await client.callTool({ name: "permission", arguments: { toolName: "echo", input: {} } });
        assert.deepEqual(JSON.parse(textOf(result)), {
          behavior: "deny",
          message: "the run is suspended until an approval decision is recorded, so do not retry this call",
        });
        await assert.rejects(async () => await client.callTool({ name: "echo", arguments: { text: "hi" } }), /no MCP route is registered/i);
      },
    );
  });

  it("permission_tool_codec_throw_fails_closed", async () => {
    const decodeThrows: PermissionCodec = {
      decode: () => {
        throw new Error("bad vendor shape");
      },
      encode: () => ({ content: [] }),
    };
    const encodeThrows: PermissionCodec = {
      decode: () => ({ toolName: "echo", input: {} }),
      encode: () => {
        throw new Error("bad vendor shape");
      },
    };
    for (const codec of [decodeThrows, encodeThrows]) {
      await withServed(
        {
          allow: ["echo"],
          tools: [echoTool()],
          transport: "loopback-http",
          permissionTool: permissionTool({ codec }),
          packages: [scriptedGate()],
        },
        async ({ client }) => {
          const decision = JSON.parse(textOf(await client.callTool({ name: "permission", arguments: { toolName: "echo", input: {} } })));
          assert.equal(decision.behavior, "deny", "a codec throw never allows");
          assert.match(decision.message, /permission (request rejected|codec failed): bad vendor shape/);
        },
      );
    }
  });

  it("permission_tool_unknown_name_gets_every_effect", async () => {
    const counter = countingHost();
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool({ effects: effectsTable({ Read: ["read"] }) }),
        packages: [approval({ mode: "edits" })],
        host: counter.host,
      },
      async ({ client }) => {
        const known = await client.callTool({ name: "permission", arguments: { toolName: "Read", input: {} } });
        assert.deepEqual(JSON.parse(textOf(known)), { behavior: "allow" });
        assert.equal(counter.asked(), 0, "a read-only name is allowed without a prompt");
        const unknown = await client.callTool({ name: "permission", arguments: { toolName: "Unknown", input: {} } });
        assert.deepEqual(JSON.parse(textOf(unknown)), { behavior: "allow" });
        assert.equal(counter.asked(), 2, "an unknown name gets every effect, so `edits` still prompts (confirm + once)");
      },
    );
  });

  it("permission_decisions_are_persisted_without_input", async () => {
    await withServed(
      {
        allow: ["echo"],
        tools: [echoTool()],
        transport: "loopback-http",
        permissionTool: permissionTool(),
        packages: [scriptedGate()],
      },
      async ({ client, run }) => {
        await client.callTool({ name: "permission", arguments: { toolName: "echo", input: { mode: "deny", text: "secret-value" } } });
        await client.callTool({
          name: "permission",
          arguments: { toolName: "echo", input: { text: "secret-value" }, toolCallId: "fixed-id" },
        });
        const entries = (await run.state("prism.permissions").load()) as readonly Record<string, unknown>[];
        assert.equal(entries.length, 2, "one bounded entry per decision");
        assert.deepEqual(Object.keys(entries[0] ?? {}).sort(), ["behavior", "reason", "toolCallId", "toolName"]);
        assert.equal(entries[0]?.toolName, "echo");
        assert.equal(entries[0]?.behavior, "deny");
        assert.equal(entries[0]?.reason, "denied: policy");
        assert.match(String(entries[0]?.toolCallId), /^[0-9a-f-]{36}$/, "a random id when none is given");
        assert.deepEqual(entries[1], { toolName: "echo", toolCallId: "fixed-id", behavior: "allow" });
        assert.doesNotMatch(JSON.stringify(entries), /secret-value/, "the input is never recorded");
      },
    );
  });
});
