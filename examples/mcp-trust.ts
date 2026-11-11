import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, createAgent, definePackage } from "@arnilo/prism";
import { bindManifestInstance, createScriptedHostUi, mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import mcpPackageDefinition, { type McpPackageConfig } from "@arnilo/prism-extensions/mcp";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

/**
 * Demonstrates:
 * 1. An untrusted project stdio server never spawns when host.ui confirmation is denied.
 * 2. A trusted URL server receives its `Authorization` header from an `env:` ref, while a
 *    second, unreachable trusted server proves the token is redacted from a connect error.
 * 3. The token appears in no event, inspect() output, status note, command result, or error.
 */

const node = process.execPath;
const SECRET_TOKEN = "secret-token-prism-mcp-demo-98765";

async function startFixture(): Promise<{ origin: string; received: string[]; close(): Promise<void> }> {
  const received: string[] = [];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "docs-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.registerTool("docs_lookup", { inputSchema: {} }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    return server;
  }, {});
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const authorization = request.headers.authorization;
    if (typeof authorization === "string") received.push(authorization);
    const webRequest = new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: request.method === "GET" || request.method === "DELETE" ? undefined : body,
    });
    const webResponse = await handler.fetch(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  return {
    origin,
    received,
    close: async () => {
      await handler.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export async function demo(): Promise<Record<string, unknown>> {
  process.env.DOCS_MCP_TOKEN = SECRET_TOKEN;

  const sentinel = join(tmpdir(), `prism-mcp-trust-example-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (existsSync(sentinel)) unlinkSync(sentinel);

  const fixture = await startFixture();
  const events: AgentEvent[] = [];
  const eventCollector = definePackage({
    name: "mcp-trust-event-collector",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("package.event", (event) => void events.push(event));
    },
  });

  // Approve the two URL servers, deny the stdio server.
  const scriptedUi = createScriptedHostUi((request) => {
    if (request.kind !== "confirm") return { status: "unavailable" };
    const title = request.title ?? "";
    return { status: "answered", value: title.includes("docs-url") || title.includes("broken-url") };
  }).ui;

  try {
    const projectMcpConfig: McpPackageConfig = {
      servers: [
        {
          id: "untrusted-stdio",
          transport: "stdio",
          command: node,
          args: ["-e", `require("fs").writeFileSync(${JSON.stringify(sentinel)}, "ran")`],
          allow: "stdio",
        },
        {
          id: "docs-url",
          transport: "http",
          url: `${fixture.origin}/mcp`,
          allow: fixture.origin,
          headers: { Authorization: { ref: "env:DOCS_MCP_TOKEN", prefix: "Bearer " } },
          connectTimeoutMs: 5000,
        },
        {
          id: "broken-url",
          transport: "http",
          url: "https://127.0.0.1:59996/mcp",
          allow: "https://127.0.0.1:59996",
          headers: { Authorization: { ref: "env:DOCS_MCP_TOKEN", prefix: "Bearer " } },
          connectTimeoutMs: 50,
        },
      ],
    };

    const projectMcpInstance = bindManifestInstance(mcpPackageDefinition, projectMcpConfig as unknown as Record<string, unknown>, {
      optional: false,
      source: { kind: "manifest", scope: "project", scopes: { servers: "project" } },
    });

    const agent = await createAgent({
      id: "mcp-trust-demo",
      model: { provider: "mock", model: "test" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), eventCollector, projectMcpInstance],
      host: { ui: scriptedUi },
    });

    const statusResult = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string; toolCount: number; error?: string; reason?: string }>;
    };
    const byId = (id: string) => statusResult.servers.find((server) => server.id === id);
    const inspectResult = agent.inspect();

    const sentinelCreated = existsSync(sentinel);
    assert.equal(sentinelCreated, false, "the untrusted stdio server spawned and created a sentinel file");
    assert.equal(byId("untrusted-stdio")?.state, "disabled", "the untrusted server is disabled");
    assert.equal(byId("untrusted-stdio")?.reason, "untrusted", "the untrusted server names the reason");
    assert.equal(byId("docs-url")?.state, "connected", `the trusted fixture server connected: ${byId("docs-url")?.error ?? ""}`);
    assert.ok(
      fixture.received.some((header) => header === `Bearer ${SECRET_TOKEN}`),
      "the fixture never received the Authorization header",
    );
    assert.equal(byId("broken-url")?.state, "failed", "the unreachable trusted server failed");

    const dump = JSON.stringify({ events, statusResult, inspectResult, notes: inspectResult.statusNotes });
    const secretLeaked = dump.includes(SECRET_TOKEN);
    assert.equal(secretLeaked, false, "the secret token leaked into events, status, inspect, or notes");

    await agent.dispose();

    return {
      sentinelCreated,
      headerReceived: fixture.received.some((header) => header === `Bearer ${SECRET_TOKEN}`),
      secretLeaked,
      untrustedState: byId("untrusted-stdio")?.state,
      untrustedReason: byId("untrusted-stdio")?.reason,
      docsState: byId("docs-url")?.state,
      brokenState: byId("broken-url")?.state,
    };
  } finally {
    await fixture.close();
    if (existsSync(sentinel)) unlinkSync(sentinel);
    delete process.env.DOCS_MCP_TOKEN;
  }
}

export async function main() {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
