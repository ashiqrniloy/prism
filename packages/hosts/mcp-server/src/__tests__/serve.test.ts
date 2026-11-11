import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  definePackage,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import manifest from "../../../package.json" with { type: "json" };
import { mcpHost, serveMcp } from "../index.js";
import { bindMcpSession, brandMcpHost, type ElicitRequest } from "../session-map.js";

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

const authorization = { allowed: true as const, ownership: { tenantId: "tenant-1" } };

/** A text agent whose provider records each request's session id and history depth. */
async function textAgent(seen: Array<{ sessionId?: string; messages: number }> = []): Promise<Agent> {
  return await createAgent({
    id: "mcp-text-agent",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      mockProvider([[providerTextDelta("hello from the agent"), providerDone()]], {
        onRequest: (request) => seen.push({ sessionId: request.options?.sessionId, messages: request.messages.length }),
      }),
    ],
  });
}

/** An approval-gated agent: first turn asks to call `publish_draft`, second turn finishes. */
async function approvalAgent(executed: string[] = []): Promise<Agent> {
  let turn = 0;
  return await createAgent({
    id: "mcp-approval-agent",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "publish_draft", { path: "a.txt" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("published");
            yield providerDone();
          },
        },
      ]),
    ],
    hooks: askEveryTool(),
    tools: {
      add: [
        {
          name: "publish_draft",
          parameters: { type: "object" },
          execute: (_args, context) => {
            executed.push(context.toolCallId);
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });
}

type ElicitHandler = (request: { params: { message: string } }) => unknown;

async function connect(agent: Agent, options: { elicitation?: ElicitHandler } = {}) {
  const capabilities = options.elicitation ? { elicitation: { form: {} } } : {};
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities });
  if (options.elicitation) client.setRequestHandler("elicitation/create", options.elicitation as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveMcp(agent, { transport: serverTransport, authorize: () => authorization });
  open.push(handle);
  open.push({ close: () => client.close() });
  await client.connect(clientTransport);
  return { client, call: (prompt: string) => client.callTool({ name: "prompt", arguments: { prompt } }) };
}

describe("serveMcp", () => {
  it("serve_mcp_prompt_tool_runs_session", async () => {
    const seen: Array<{ sessionId?: string; messages: number }> = [];
    const session = await connect(await textAgent(seen));
    assert.deepEqual(
      (await session.client.listTools()).tools.map((tool) => tool.name),
      ["prompt"],
    );
    const first = await session.call("hello");
    assert.notEqual(first.isError, true);
    assert.match(JSON.stringify(first.content), /hello from the agent/);
    const second = await session.call("again");
    assert.notEqual(second.isError, true);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.sessionId, seen[1]?.sessionId, "both calls share one Prism session");
    assert.ok((seen[1]?.messages ?? 0) > (seen[0]?.messages ?? 0), "the second call continues the same history");
  });

  it("serve_mcp_lists_commands_as_prompts", async () => {
    const command = definePackage({
      name: "test-commands",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.commands.register({
          name: "workflow.status",
          description: "Report a workflow's status",
          args: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
          run: (args) => ({ runId: args.runId, status: "suspended" }),
        });
      },
    });
    const agent = await createAgent({
      id: "mcp-commands-agent",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      packages: [command(), mockProvider([[providerDone()]])],
    });
    const session = await connect(agent);
    const listed = await session.client.listPrompts();
    assert.deepEqual(
      listed.prompts.map((prompt) => prompt.name),
      ["workflow.status"],
    );
    const prompt = await session.client.getPrompt({ name: "workflow.status", arguments: { runId: "r1" } });
    assert.match(JSON.stringify(prompt.messages), /suspended/);
  });

  it("serve_mcp_failed_run_is_error_result", async () => {
    const agent = await createAgent({
      id: "mcp-failing-agent",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              yield { type: "error" as const, error: { code: "provider_down", message: "provider exploded" } };
            },
          },
        ]),
      ],
    });
    const session = await connect(agent);
    const result = await session.call("hello");
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /ERR_PRISM_MCP_RUN/);
  });

  it("serve_mcp_approval_via_elicitation", async () => {
    for (const [outcome, expected] of [
      ["allow_once", 1],
      ["reject_once", 0],
    ] as const) {
      const executed: string[] = [];
      const session = await connect(await approvalAgent(executed), {
        elicitation: () => ({ action: "accept", content: { outcome } }),
      });
      const result = await session.call("publish it");
      assert.equal(executed.length, expected, `outcome ${outcome}`);
      assert.match(JSON.stringify(result.content), /published|denied|ERR_PRISM/i);
    }
  });

  it("serve_mcp_retry_without_pending_fails_closed", async () => {
    const executed: string[] = [];
    const session = await connect(await approvalAgent(executed));
    // A retry carrying inputResponses with no pending decision on this MCP session
    // (a fresh server instance on a stateless transport) must never re-run the prompt.
    const result = await session.client.request({
      method: "tools/call",
      params: {
        name: "prompt",
        arguments: { prompt: "publish it" },
        inputResponses: { "call-1": { action: "accept", content: { outcome: "allow_once" } } },
      },
    } as never);
    assert.equal((result as { isError?: boolean }).isError, true);
    assert.match(JSON.stringify(result), /ERR_PRISM_MCP_APPROVAL_REQUIRED/);
    assert.deepEqual(executed, []);
  });

  it("serve_mcp_no_elicitation_fails_closed", async () => {
    const executed: string[] = [];
    const session = await connect(await approvalAgent(executed));
    const result = await session.call("publish it");
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /ERR_PRISM_MCP_APPROVAL_REQUIRED/);
    assert.match(JSON.stringify(result.content), /publish_draft/);
    assert.deepEqual(executed, []);
  });

  it("serve_mcp_never_emits_secret", async () => {
    const secret = "mcp-server-canary";
    const agent = await createAgent({
      id: "mcp-secret-agent",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      packages: [mockProvider([[providerTextDelta(`leaked ${secret}`), providerDone()]])],
    });
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = serveMcp(agent, {
      transport: serverTransport,
      authorize: () => authorization,
      redactor: createSecretRedactor([secret]),
    });
    open.push(handle);
    open.push({ close: () => client.close() });
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "prompt", arguments: { prompt: "hello" } });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });

  it("serve_mcp_http_origin_and_auth_kept", async () => {
    const seenAuth: Array<string | undefined> = [];
    const agent = await textAgent();
    const handle = serveMcp(agent, {
      http: {
        allowedOrigins: ["https://example.test"],
        sessionIdGenerator: () => "session-1",
        resolveIdentity: () => ({ id: "principal-1" }),
        resolveAuthInfo: (request) => ({ token: request.headers.get("authorization") ?? "", clientId: "web", scopes: [] }),
      },
      authorize: (input) => {
        seenAuth.push(input.authInfo?.clientId);
        return authorization;
      },
    });
    open.push(handle);
    const handler = handle.handler;
    assert.ok(handler, "{ http } exposes a web-standard handler");

    const rejected = await handler(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    assert.equal(rejected.status, 403);

    const http = createHttpServer(async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const webRequest = new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: request.method === "GET" || request.method === "DELETE" ? undefined : Buffer.concat(chunks),
      });
      const webResponse = await handler(webRequest);
      response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
      for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
      response.end();
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    open.push({
      close: async () => {
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      },
    });
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const client = new Client({ name: "http-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: "Bearer t" } } }),
    );
    open.push({ close: () => client.close() });
    const result = await client.callTool({ name: "prompt", arguments: { prompt: "hello" } });
    assert.match(JSON.stringify(result.content), /hello from the agent/);
    assert.deepEqual(seenAuth, ["web"]);
  });

  it("serve_mcp_requires_exactly_one_transport", async () => {
    const agent = await textAgent();
    assert.throws(() => serveMcp(agent, {}), /exactly one/);
    assert.throws(() => serveMcp(agent, { stdio: true, transport: InMemoryTransport.createLinkedPair()[1] }), /exactly one/);
    assert.throws(() => serveMcp(agent, { stdio: true, http: {} }), /exactly one/);
  });

  it("mcp_host_routes_and_fails_closed", async () => {
    const port = mcpHost();
    const ui = port.ui;
    assert.ok(ui, "mcpHost must expose a ui");
    assert.deepEqual(await ui.request({ kind: "confirm", title: "kernel ask", detail: "d" }), { status: "unavailable" });
    assert.deepEqual(await ui.request({ kind: "secret", title: "token", ref: "env:X", package: "p" }), { status: "unavailable" });
    assert.deepEqual(await ui.request({ kind: "confirm", title: "package ask", package: "p", sessionId: "unbound" }), {
      status: "unavailable",
    });
    assert.deepEqual(await ui.request({ kind: "notify", level: "info", message: "hi", package: "p", sessionId: "unbound" }), {
      status: "unavailable",
    });

    assert.deepEqual(
      await ui.request({ kind: "terminal", title: "Sign in", command: ["x", "login"], package: "p", sessionId: "unbound" }),
      { status: "unavailable" },
    );

    // A bound 2025-era session routes confirm/select/input through elicitation.
    const seen: ElicitRequest[] = [];
    bindMcpSession(port, "session-1", {
      elicitation: true,
      elicit: async (request) => {
        seen.push(request);
        return request.kind === "confirm" ? { status: "answered", value: true } : { status: "answered", value: "chosen" };
      },
    });
    assert.deepEqual(await ui.request({ kind: "confirm", title: "package ask", detail: "d", package: "p", sessionId: "session-1" }), {
      status: "answered",
      value: true,
    });
    assert.deepEqual(
      await ui.request({ kind: "select", title: "pick", options: [{ value: "chosen" }], package: "p", sessionId: "session-1" }),
      { status: "answered", value: "chosen" },
    );
    assert.deepEqual(
      await ui.request({ kind: "terminal", title: "Sign in", command: ["x", "login"], package: "p", sessionId: "session-1" }),
      { status: "unavailable" },
    );
    assert.equal(seen.length, 2, "terminal never reaches elicitation");
    assert.equal(seen[0]?.kind, "confirm");
    assert.equal(seen[0]?.detail, "d");
    assert.deepEqual(seen[1]?.options, [{ value: "chosen" }]);

    // A 2026-era binding (elicitation false) answers unavailable.
    const modern = mcpHost();
    const modernUi = modern.ui;
    assert.ok(modernUi, "mcpHost must expose a ui");
    brandMcpHost(modern);
    bindMcpSession(modern, "session-2", { elicitation: false, elicit: async () => ({ status: "answered", value: true }) });
    assert.deepEqual(await modernUi.request({ kind: "confirm", title: "package ask", package: "p", sessionId: "session-2" }), {
      status: "unavailable",
    });
  });
});

describe("serveMcp server identity", () => {
  it("mcp_server_version_defaults_to_package", async () => {
    const { client } = await connect(await textAgent());
    const info = client.getServerVersion();
    assert.equal(info?.name, "prism-mcp-server");
    assert.equal(info?.version, manifest.version, "the default must be the package's own version, not a literal");
  });
});
