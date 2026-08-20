import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecretRedactor, createToolRegistry, type ToolDefinition } from "@arnilo/prism";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAntigravityMcpExposure, createAntigravityMcpHttpServer } from "../index.js";

function createEchoTool(): ToolDefinition {
  return {
    name: "prism_echo",
    description: "Echo test tool",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute(args, context) {
      return {
        toolCallId: context.toolCallId,
        name: "prism_echo",
        value: {
          echo: args.text,
          sessionId: context.metadata?.sessionId ?? context.sessionId,
          runId: context.metadata?.runId ?? context.runId,
          identity: context.identity,
        },
      };
    },
  };
}

function createMutateTool(): ToolDefinition {
  return {
    name: "prism_mutate",
    description: "Mutate test tool",
    parameters: {
      type: "object",
      properties: { action: { type: "string" } },
      required: ["action"],
      additionalProperties: false,
    },
    execute(args, context) {
      return {
        toolCallId: context.toolCallId,
        name: "prism_mutate",
        value: { action: args.action },
      };
    },
  };
}

test("createAntigravityMcpExposure: empty selection exposes zero tools", async () => {
  const tools = [createEchoTool(), createMutateTool()];

  // Undefined tools
  const exp0 = createAntigravityMcpExposure({
    runContext: { sessionId: "s1", runId: "r1" },
  });
  assert.equal(exp0.exposedTools.length, 0);
  await exp0.close();

  // Empty array
  const exp1 = createAntigravityMcpExposure({
    tools: [],
    runContext: { sessionId: "s1", runId: "r1" },
  });
  assert.equal(exp1.exposedTools.length, 0);
  await exp1.close();

  // Empty selection array
  const exp2 = createAntigravityMcpExposure({
    tools,
    toolSelection: [],
    runContext: { sessionId: "s1", runId: "r1" },
  });
  assert.equal(exp2.exposedTools.length, 0);
  await exp2.close();
});

test("createAntigravityMcpExposure: filters tools by name or predicate", async () => {
  const tools = [createEchoTool(), createMutateTool()];

  // Explicit tool selection by name array
  const exp1 = createAntigravityMcpExposure({
    tools,
    toolSelection: ["prism_echo"],
    runContext: { sessionId: "s1", runId: "r1" },
  });
  assert.equal(exp1.exposedTools.length, 1);
  assert.equal(exp1.exposedTools[0].name, "prism_echo");
  await exp1.close();

  // ToolRegistry input
  const registry = createToolRegistry(tools);
  const exp2 = createAntigravityMcpExposure({
    tools: registry,
    toolSelection: (name) => name.endsWith("_mutate"),
    runContext: { sessionId: "s1", runId: "r1" },
  });
  assert.equal(exp2.exposedTools.length, 1);
  assert.equal(exp2.exposedTools[0].name, "prism_mutate");
  await exp2.close();
});

test("createAntigravityMcpExposure: round-trips tool call with run-bound context over in-memory transport", async () => {
  const echoTool = createEchoTool();
  const identity = {
    tenantId: "tenant-1",
    userId: "user-1",
    principal: { kind: "user" as const, id: "user-1" },
    scopes: ["coding"],
    issuedAt: "2026-08-20T00:00:00.000Z",
    verified: true as const,
  };
  const ownership = { tenantId: "tenant-1", userId: "user-1" };

  const exposure = createAntigravityMcpExposure({
    tools: [echoTool],
    runContext: {
      sessionId: "session-42",
      runId: "run-99",
      identity,
      ownership,
    },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 1);
    assert.equal(listed.tools[0].name, "prism_echo");

    const result = await client.callTool({
      name: "prism_echo",
      arguments: { text: "hello antigravity" },
    });

    assert.equal(result.isError, false);
    const content = JSON.parse((result.content as Array<{ type: "text"; text: string }>)[0].text);
    assert.equal(content.echo, "hello antigravity");
    assert.equal(content.sessionId, "session-42");
    assert.equal(content.runId, "run-99");
    assert.equal(content.identity.userId, "user-1");
  } finally {
    await client.close();
    await exposure.close();
  }
});

test("createAntigravityMcpExposure: authorizer and identity checks fail closed", async () => {
  const tool = createEchoTool();
  let customAuthRan = false;

  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    runContext: { sessionId: "s1", runId: "r1" },
    authorize: (input) => {
      customAuthRan = true;
      if (input.name === "prism_echo") {
        return false; // Deny
      }
      return { allowed: true };
    },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({
      name: "prism_echo",
      arguments: { text: "blocked" },
    });

    assert.equal(result.isError, true);
    assert.equal(customAuthRan, true);
    assert.match(JSON.stringify(result.content), /Forbidden|ERR_PRISM_MCP_FORBIDDEN/);
  } finally {
    await client.close();
    await exposure.close();
  }
});

test("createAntigravityMcpHttpServer: enforces Bearer token authentication and loopback binding", async () => {
  const tool = createEchoTool();
  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    runContext: { sessionId: "s1", runId: "r1" },
  });

  // Non-loopback hostname throws
  await assert.rejects(
    async () => {
      await createAntigravityMcpHttpServer(exposure, { hostname: "8.8.8.8" });
    },
    {
      name: "AntigravityMcpError",
      message: /must bind to loopback address/,
    },
  );

  const httpHandle = await createAntigravityMcpHttpServer(exposure);

  try {
    assert.ok(httpHandle.port > 0);
    assert.match(httpHandle.serverUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.ok(httpHandle.headers.authorization.startsWith("Bearer "));

    // 1. Request without Authorization header -> 401 Unauthorized
    const unauthRes = await fetch(httpHandle.serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Request with invalid Bearer token -> 401 Unauthorized
    const badTokenRes = await fetch(httpHandle.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-token-12345",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } }),
    });
    assert.equal(badTokenRes.status, 401);

    // 3. Request with correct Bearer token -> 200 OK
    const validRes = await fetch(httpHandle.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...httpHandle.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    });
    assert.equal(validRes.status, 200);
    const body = await validRes.json();
    assert.equal(body.result.serverInfo.name, "prism");
  } finally {
    await httpHandle.close();
  }
});

test("createAntigravityMcpExposure: applies redactor to tool output", async () => {
  const secret = "SUPER_SECRET_KEY_12345";
  const tool: ToolDefinition = {
    name: "secret_tool",
    execute: () => ({
      toolCallId: "call-1",
      name: "secret_tool",
      value: { leak: secret },
    }),
  };

  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    redactor: createSecretRedactor([secret]),
    runContext: { sessionId: "s1", runId: "r1" },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name: "secret_tool", arguments: {} });
    assert.equal(result.isError, false);
    assert.doesNotMatch(JSON.stringify(result.content), new RegExp(secret));
    assert.match(JSON.stringify(result.content), /\[REDACTED\]/);
  } finally {
    await client.close();
    await exposure.close();
  }
});

test("createAntigravityMcpExposure: abort signal cancels server and rejects calls", async () => {
  const controller = new AbortController();
  const tool = createEchoTool();

  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    runContext: { sessionId: "s1", runId: "r1", signal: controller.signal },
  });

  controller.abort();

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name: "prism_echo", arguments: { text: "after abort" } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Forbidden|ERR_PRISM_MCP_FORBIDDEN/);
  } finally {
    await client.close();
    await exposure.close();
  }
});

test("createAntigravityMcpExposure: bounds concurrent calls and enforces timeout", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const tool: ToolDefinition = {
    name: "slow_tool",
    execute: async (_args, context) => {
      await Promise.race([
        gate,
        new Promise<void>((resolve) => context.signal?.addEventListener("abort", () => resolve(), { once: true })),
      ]);
      return { toolCallId: context.toolCallId, name: "slow_tool", value: "done" };
    },
  };

  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    runContext: { sessionId: "s1", runId: "r1" },
    maxConcurrentCalls: 1,
    callTimeoutMs: 50,
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const firstCall = client.callTool({ name: "slow_tool", arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Second call exceeds concurrency of 1 -> busy error
    const busyCall = await client.callTool({ name: "slow_tool", arguments: {} });
    assert.equal(busyCall.isError, true);
    assert.match(JSON.stringify(busyCall.content), /CONCURRENCY|busy/i);

    // First call eventually times out
    const timedOut = await firstCall;
    assert.equal(timedOut.isError, true);
    assert.match(JSON.stringify(timedOut.content), /timed out/i);
  } finally {
    release?.();
    await client.close();
    await exposure.close();
  }
});

test("createAntigravityMcpExposure: rejects invalid identity widening across MCP boundary", async () => {
  const tool = createEchoTool();
  const validOwnership = { tenantId: "tenant-1", userId: "user-1" };
  const forgedIdentity = {
    tenantId: "tenant-2", // Mismatched tenant!
    userId: "user-999",
    principal: { kind: "user" as const, id: "user-999" },
    scopes: ["admin"],
    issuedAt: "2026-08-20T00:00:00.000Z",
    verified: true as const,
  };

  const exposure = createAntigravityMcpExposure({
    tools: [tool],
    runContext: {
      sessionId: "s1",
      runId: "r1",
      ownership: validOwnership,
    },
    authorize: () => ({
      allowed: true,
      ownership: validOwnership,
      identity: forgedIdentity,
    }),
  });

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await exposure.server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name: "prism_echo", arguments: { text: "try forge" } });
    // Must fail closed because identity tenant-2 does not match ownership tenant-1
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Forbidden|ERR_PRISM_MCP_FORBIDDEN/);
  } finally {
    await client.close();
    await exposure.close();
  }
});
