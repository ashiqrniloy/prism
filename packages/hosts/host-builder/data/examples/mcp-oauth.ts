import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AgentEvent, type CredentialResolver, createAgent, definePackage, type Secret } from "@arnilo/prism";
import { createScriptedHostUi, mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { mcp } from "@arnilo/prism-extensions/mcp";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

/**
 * Demonstrates (network-free, everything on 127.0.0.1):
 * 1. An MCP server that answers 401 is signed in to through `host.ui`: the package opens the authorization
 *    URL with `open-url`, a loopback listener takes the callback, and the code is redeemed with PKCE. The
 *    sign-in runs in the background, so `createAgent` does not wait for the person; `mcp:status` reports
 *    `signingIn: true` until it settles, and the server's tools reach the next run once it connects.
 * 2. The whole sign-in record lands in one `keyring:` ref through the credentials slot.
 * 3. No token appears in events, `inspect()`, status notes, or command results.
 * 4. `mcp:logout` deletes the record and closes the server.
 */

const TOKEN_PREFIX = "demo-oauth-access-";

function listen(handler: (request: IncomingMessage, response: ServerResponse, body: Buffer) => void | Promise<void>) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    await handler(request, response, Buffer.concat(chunks));
  });
  return new Promise<{ origin: string; server: Server }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server })),
  );
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/** A fake authorization server and the MCP server it protects. */
async function startFixture() {
  let challenge: string | undefined;
  let accessToken: string | undefined;
  const as = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", as.origin);
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(response, 200, {
        issuer: as.origin,
        authorization_endpoint: `${as.origin}/authorize`,
        token_endpoint: `${as.origin}/token`,
        registration_endpoint: `${as.origin}/register`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register") return json(response, 201, { ...JSON.parse(body.toString()), client_id: "demo-client" });
    if (url.pathname === "/token") {
      const params = new URLSearchParams(body.toString());
      const verifier = params.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== challenge) return json(response, 400, { error: "invalid_grant" });
      accessToken = `${TOKEN_PREFIX}1`;
      return json(response, 200, {
        access_token: accessToken,
        refresh_token: "demo-oauth-refresh-1",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    json(response, 404, { error: "not_found" });
  });

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "tracker", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.registerTool("list_issues", { inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "[]" }] }));
    return server;
  }, {});
  const mcpServer = await listen(async (request, response, body) => {
    if (request.url?.startsWith("/.well-known/"))
      return json(response, 200, { authorization_servers: [as.origin], resource: `${mcpServer.origin}/mcp` });
    if (accessToken === undefined || request.headers.authorization !== `Bearer ${accessToken}`) {
      response.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${mcpServer.origin}/.well-known/oauth-protected-resource"`,
      });
      return void response.end();
    }
    const webResponse = await handler.fetch(
      new Request(new URL(request.url ?? "/", mcpServer.origin), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: request.method === "GET" || request.method === "DELETE" ? undefined : new Uint8Array(body),
      }),
    );
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    for await (const chunk of webResponse.body ?? new Uint8Array()) response.write(chunk);
    response.end();
  });

  return {
    origin: mcpServer.origin,
    expect(url: URL) {
      challenge = url.searchParams.get("code_challenge") ?? undefined;
    },
    async close() {
      await handler.close();
      for (const { server } of [as, mcpServer]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

export async function demo(): Promise<Record<string, unknown>> {
  const fixture = await startFixture();
  // The credentials slot a keyring would provide.
  const store = new Map<string, Secret>();
  const credentials: CredentialResolver = {
    resolve: (ref) => store.get(ref),
    store: (ref, secret) => void store.set(ref, secret),
    delete: (ref) => void store.delete(ref),
  };
  // The host's browser: it "signs in" and follows the redirect to the package's loopback listener.
  const ui = createScriptedHostUi((request) => {
    if (request.kind !== "open-url") return { status: "unavailable" };
    const authorize = new URL(request.url);
    fixture.expect(authorize);
    const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("code", "demo-code");
    callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    setTimeout(() => void fetch(callback), 0);
    return { status: "answered", value: undefined };
  });
  const events: AgentEvent[] = [];
  const collector = definePackage({
    name: "mcp-oauth-event-collector",
    version: "1.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("package.event", (event) => void events.push(event));
    },
  });

  try {
    const agent = await createAgent({
      model: { provider: "mock", model: "test" },
      packages: [
        mockProvider([[providerTextDelta("ok"), providerDone()]]),
        collector,
        mcp({
          servers: [
            {
              id: "tracker",
              transport: "http",
              url: `${fixture.origin}/mcp`,
              allow: fixture.origin,
              auth: { kind: "oauth", tokens: "keyring:mcp-tracker" },
            },
          ],
        }),
      ],
      slots: { credentials },
      host: { ui: ui.ui },
    });

    type Status = { servers: Array<{ state: string; toolCount: number; signingIn?: boolean }> };
    let status = (await agent.commands.run("mcp:status")) as Status;
    for (let i = 0; i < 500 && status.servers[0].signingIn; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = (await agent.commands.run("mcp:status")) as Status;
    }
    const stored = store.get("keyring:mcp-tracker");
    const dump = JSON.stringify({ events, status, inspect: agent.inspect() });
    const tokenLeaked = dump.includes(TOKEN_PREFIX) || dump.includes("demo-oauth-refresh");
    assert.equal(status.servers[0].state, "connected");
    assert.equal(tokenLeaked, false, "a token leaked into events, status, or inspect()");

    const logout = (await agent.commands.run("mcp:logout", { id: "tracker" })) as { state: string };
    await agent.dispose();
    return {
      state: status.servers[0].state,
      toolCount: status.servers[0].toolCount,
      opened: ui.requestsOf("open-url").length,
      storedAs: stored?.type,
      tokenLeaked,
      afterLogout: logout.state,
      recordDeleted: !store.has("keyring:mcp-tracker"),
    };
  } finally {
    await fixture.close();
  }
}

export async function main() {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
