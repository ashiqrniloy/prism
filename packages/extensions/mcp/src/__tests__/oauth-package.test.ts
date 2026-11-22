import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type Agent,
  type AgentEvent,
  type CredentialResolver,
  createAgent,
  definePackage,
  type HostUiRequest,
  PackageLoadError,
  providerDone,
  providerTextDelta,
  type Secret,
  toolCallContent,
} from "@arnilo/prism";
import { createScriptedHostUi, mockProvider } from "@arnilo/prism/testing";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type McpPackageConfig, mcp } from "../index.js";

const TOKENS_REF = "keyring:mcp-tracker";
const ACCESS_PREFIX = "oauth-access-canary-";
const REFRESH_PREFIX = "oauth-refresh-canary-";
const testModel = { provider: "mock", model: "test" };

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function listen(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void | Promise<void>): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => void handler(request, response, body));
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)),
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

/** A fake authorization server (discovery, DCR, PKCE-checked code exchange, refresh) plus an MCP server behind it. */
async function startOAuthFixture() {
  const tokenRequests: Array<{ grantType?: string; redirectUri?: string }> = [];
  const registrations: Array<{ redirect_uris?: string[] }> = [];
  let challenge: string | undefined;
  let counter = 0;
  let current: string | undefined;
  let refuseRefresh = false;
  let dropNext = false;

  const asOrigin = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const origin = `http://${request.headers.host}`;
      sendJson(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
      });
      return;
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const metadata = JSON.parse(body) as { redirect_uris?: string[] };
      registrations.push(metadata);
      sendJson(response, 201, { ...metadata, client_id: `dcr-${registrations.length}`, token_endpoint_auth_method: "none" });
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const params = new URLSearchParams(body);
      const grantType = params.get("grant_type") ?? undefined;
      tokenRequests.push({ grantType, redirectUri: params.get("redirect_uri") ?? undefined });
      if (grantType === "authorization_code") {
        const verifier = params.get("code_verifier") ?? "";
        if (params.get("code") !== "test-code" || createHash("sha256").update(verifier).digest("base64url") !== challenge) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
      } else if (refuseRefresh || grantType !== "refresh_token" || !params.get("refresh_token")?.startsWith(REFRESH_PREFIX)) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      counter += 1;
      current = `${ACCESS_PREFIX}${counter}`;
      sendJson(response, 200, {
        access_token: current,
        refresh_token: `${REFRESH_PREFIX}${counter}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });

  const mcpOrigin = await listen(async (request, response, body) => {
    const method = request.method ?? "GET";
    const path = request.url ?? "/";
    if (path.startsWith("/.well-known/")) {
      sendJson(response, 200, { authorization_servers: [asOrigin], resource: `${mcpOrigin}/mcp` });
      return;
    }
    if (method === "GET") {
      response.writeHead(405, { allow: "POST, DELETE" }).end();
      return;
    }
    if (dropNext && method === "POST") {
      // The server forgot the session: the client must treat the connection as gone.
      dropNext = false;
      sendJson(response, 404, { error: "session not found" });
      return;
    }
    if (current === undefined || request.headers.authorization !== `Bearer ${current}`) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${mcpOrigin}/.well-known/oauth-protected-resource"`,
      });
      response.end(JSON.stringify({ error: { message: "Unauthorized" } }));
      return;
    }
    const server = new McpServer({ name: "oauth-fixture", version: "1.0.0" });
    server.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, async (args) => ({
      content: [{ type: "text", text: String(args.text) }],
    }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    const result = await transport.handleRequest(
      new Request(`${mcpOrigin}${path}`, { method, headers, body: method === "POST" ? body : undefined }),
    );
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(await result.text());
  });

  return {
    mcpOrigin,
    tokenRequests,
    registrations,
    expect(authorizationUrl: URL) {
      challenge = authorizationUrl.searchParams.get("code_challenge") ?? undefined;
    },
    invalidateAccessToken() {
      current = `revoked-${counter}`;
    },
    /** The refresh token stops working, so only a new sign-in can fix a 401. */
    refuseRefresh() {
      refuseRefresh = true;
    },
    /** The next MCP request answers 404, as a server that dropped the session does. */
    dropNextRequest() {
      dropNext = true;
    },
  };
}

function memorySlot() {
  const values = new Map<string, Secret>();
  const resolver: CredentialResolver = {
    resolve: (ref: string) => values.get(ref),
    store: (ref: string, secret: Secret) => void values.set(ref, secret),
    delete: (ref: string) => void values.delete(ref),
  };
  return { resolver, values };
}

/** The browser's part: what the authorization server would redirect to after the person signs in. */
function callbackUrl(authorizationUrl: string, state?: string): URL {
  const url = new URL(authorizationUrl);
  const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
  redirect.searchParams.set("code", "test-code");
  redirect.searchParams.set("state", state ?? url.searchParams.get("state") ?? "");
  return redirect;
}

type Fixture = Awaited<ReturnType<typeof startOAuthFixture>>;

/** A host UI whose browser signs in: `listen` follows the redirect, `paste` answers the input with the URL. */
function signingInUi(fixture: Fixture, options: { readonly state?: string; readonly callbacks?: Response[] } = {}) {
  let lastUrl: string | undefined;
  return createScriptedHostUi((request: HostUiRequest) => {
    if (request.kind === "open-url") {
      lastUrl = request.url;
      fixture.expect(new URL(request.url));
      const target = callbackUrl(request.url, options.state);
      setTimeout(() => void fetch(target).then((response) => options.callbacks?.push(response)), 0);
      return { status: "answered", value: undefined };
    }
    if (request.kind === "input" && lastUrl) return callbackUrl(lastUrl, options.state).href;
    return { status: "unavailable" };
  });
}

function oauthConfig(fixture: Fixture, auth: Record<string, unknown> = {}): McpPackageConfig {
  return {
    servers: [
      {
        id: "tracker",
        transport: "http",
        url: `${fixture.mcpOrigin}/mcp`,
        allow: fixture.mcpOrigin,
        connectTimeoutMs: 5000,
        auth: { kind: "oauth", tokens: TOKENS_REF, ...auth },
      } as McpPackageConfig["servers"] extends readonly (infer S)[] | undefined ? S : never,
    ],
  };
}

async function startAgent(config: McpPackageConfig, slot: CredentialResolver, ui?: ReturnType<typeof createScriptedHostUi>) {
  const events: AgentEvent[] = [];
  const collector = definePackage({
    name: "oauth-event-collector",
    version: "1.0.0",
    requires: { api: 2 },
    setup(prism) {
      prism.hooks.on("package.event", (event) => void events.push(event));
    },
  });
  const agent = await createAgent({
    model: testModel,
    packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), collector, mcp(config)],
    slots: { credentials: slot },
    ...(ui ? { host: { ui: ui.ui } } : {}),
  });
  const status = () => serverStatus(agent);
  // Setup reports `auth_required` and signs in in the background (plan 234 Task 4): wait for that to settle.
  await settled(agent);
  return { agent, events, status };
}

type ServerStatus = { id: string; state: string; reason?: string; toolCount: number; error?: string; signingIn?: boolean };

async function serverStatus(agent: Agent): Promise<ServerStatus> {
  return ((await agent.commands.run("mcp:status")) as { servers: ServerStatus[] }).servers[0] as ServerStatus;
}

async function settled(agent: Agent): Promise<ServerStatus> {
  for (let i = 0; i < 500; i += 1) {
    const current = await serverStatus(agent);
    if (!current.signingIn) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("background sign-in did not settle");
}

describe("@arnilo/prism-extensions/mcp OAuth sign-in (plan 234 Task 3)", () => {
  it("oauth_server_signs_in_through_host_ui_and_connects", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const ui = signingInUi(fixture);
    const { agent, status } = await startAgent(oauthConfig(fixture), slot.resolver, ui);

    const server = await status();
    assert.equal(server.state, "connected", JSON.stringify(server));
    assert.equal(server.toolCount, 1);
    assert.ok(agent.tools.some((tool) => tool.name === "mcp:tracker:echo"));
    const opened = ui.requestsOf("open-url");
    assert.equal(opened.length, 1);
    const authorizationUrl = new URL(opened[0].url);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    // Dynamic registration carried the loopback redirect URI the listener used.
    const redirectUri = authorizationUrl.searchParams.get("redirect_uri") ?? "";
    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.deepEqual(fixture.registrations[0].redirect_uris, [redirectUri]);
    assert.deepEqual(
      fixture.tokenRequests.map((request) => request.grantType),
      ["authorization_code"],
    );
    // One ref holds the whole record; the access token is the secret value.
    const stored = slot.values.get(TOKENS_REF);
    assert.equal(stored?.type, "bearer");
    assert.equal(stored?.value, `${ACCESS_PREFIX}1`);
    assert.ok(stored);
    const record = (stored.metadata as { mcpOAuth: Record<string, unknown> }).mcpOAuth;
    assert.equal(record.v, 1);
    assert.equal(record.redirectUri, redirectUri);
    assert.ok(record.client && record.discovery && record.verifier && record.authorizationState);
    await agent.dispose();
  });

  it("tokens_are_stored_as_refs_and_never_emitted", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const { agent, events, status } = await startAgent(oauthConfig(fixture), slot.resolver, signingInUi(fixture));
    assert.equal((await status()).state, "connected");
    fixture.invalidateAccessToken();
    // A refused call surfaces as an error; it must not carry the token either.
    const reconnect = await agent.commands.run("mcp:reconnect", { id: "tracker" });
    const dump = JSON.stringify({ events, inspect: agent.inspect(), status: await status(), reconnect });
    assert.equal(dump.includes(ACCESS_PREFIX), false, "an access token leaked");
    assert.equal(dump.includes(REFRESH_PREFIX), false, "a refresh token leaked");
    await agent.dispose();
  });

  it("expired_token_is_refreshed_without_a_prompt", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const first = await startAgent(oauthConfig(fixture), slot.resolver, signingInUi(fixture));
    assert.equal((await first.status()).state, "connected");
    await first.agent.dispose();

    fixture.invalidateAccessToken();
    const ui = createScriptedHostUi(() => ({ status: "unavailable" }));
    const second = await startAgent(oauthConfig(fixture), slot.resolver, ui);
    assert.equal((await second.status()).state, "connected");
    assert.equal(ui.requestsOf("open-url").length, 0, "a refresh must not prompt");
    assert.deepEqual(
      fixture.tokenRequests.map((request) => request.grantType),
      ["authorization_code", "refresh_token"],
    );
    assert.equal(slot.values.get(TOKENS_REF)?.value, `${ACCESS_PREFIX}2`, "the refreshed token is written back");
    await second.agent.dispose();
  });

  it("no_ui_reports_auth_required_and_opens_nothing", async () => {
    const fixture = await startOAuthFixture();
    for (const ui of [
      undefined,
      createScriptedHostUi(() => ({ status: "unavailable" })),
      createScriptedHostUi(() => ({ status: "dismissed" })),
    ]) {
      const slot = memorySlot();
      const { agent, status } = await startAgent(oauthConfig(fixture), slot.resolver, ui);
      const server = await status();
      assert.equal(server.state, "failed");
      assert.equal(server.reason, "auth_required");
      assert.equal(
        agent.tools.some((tool) => tool.name.startsWith("mcp:tracker:")),
        false,
      );
      if (ui)
        assert.ok(
          ui.requests.every((request) => request.kind === "open-url"),
          "only the open-url request was made",
        );
      await agent.dispose();
    }
    assert.equal(fixture.tokenRequests.length, 0, "no code was exchanged");
  });

  it("paste_callback_completes_sign_in", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    let lastUrl: string | undefined;
    const ui = createScriptedHostUi((request) => {
      if (request.kind === "open-url") {
        lastUrl = request.url;
        fixture.expect(new URL(request.url));
        return { status: "answered", value: undefined };
      }
      if (request.kind === "input" && lastUrl) return callbackUrl(lastUrl).href;
      return { status: "unavailable" };
    });
    const { agent, status } = await startAgent(oauthConfig(fixture, { callback: "paste", clientId: "static-client" }), slot.resolver, ui);
    assert.equal((await status()).state, "connected");
    assert.equal(ui.requestsOf("input").length, 1);
    assert.equal(fixture.registrations.length, 0, "a static client does not register");
    await agent.dispose();
  });

  it("paste_refuses_a_bare_code", async () => {
    const fixture = await startOAuthFixture();
    const ui = createScriptedHostUi((request) => {
      if (request.kind === "open-url") return { status: "answered", value: undefined };
      if (request.kind === "input") return "test-code";
      return { status: "unavailable" };
    });
    const { agent, status } = await startAgent(oauthConfig(fixture, { callback: "paste" }), memorySlot().resolver, ui);
    const server = await status();
    assert.equal(server.state, "failed");
    assert.match(server.error ?? "", /full callback URL/);
    assert.equal(fixture.tokenRequests.length, 0);
    await agent.dispose();
  });

  it("callback_rejects_a_wrong_state", async () => {
    const fixture = await startOAuthFixture();
    const callbacks: Response[] = [];
    const { agent, status } = await startAgent(
      oauthConfig(fixture),
      memorySlot().resolver,
      signingInUi(fixture, { state: "forged", callbacks }),
    );
    const server = await status();
    assert.equal(server.state, "failed");
    assert.match(server.error ?? "", /state/);
    // The browser's response settles after the listener has already refused the callback.
    for (let i = 0; i < 100 && callbacks.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(callbacks[0]?.status, 400);
    assert.equal(fixture.tokenRequests.length, 0, "a forged callback never reaches the token endpoint");
    await agent.dispose();
  });

  it("literal_or_env_token_ref_fails_the_load", async () => {
    const fixture = await startOAuthFixture();
    for (const tokens of ["env:MCP_TOKENS", "a-literal-token"]) {
      await assert.rejects(
        () => startAgent(oauthConfig(fixture, { tokens }), memorySlot().resolver),
        (error: unknown) => error instanceof PackageLoadError && error.code === "config_invalid",
      );
    }
  });

  it("auth_on_a_stdio_server_fails_the_load", async () => {
    await assert.rejects(
      () =>
        startAgent(
          {
            servers: [
              { id: "fs", transport: "stdio", command: "mcp-fs", allow: "stdio", auth: { kind: "oauth", tokens: TOKENS_REF } } as never,
            ],
          },
          memorySlot().resolver,
        ),
      (error: unknown) => error instanceof PackageLoadError && error.code === "config_invalid",
    );
  });

  it("logout_deletes_tokens_and_closes_the_bridge", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const { agent, status } = await startAgent(oauthConfig(fixture), slot.resolver, signingInUi(fixture));
    assert.equal((await status()).state, "connected");
    const result = (await agent.commands.run("mcp:logout", { id: "tracker" })) as { state: string; reason?: string };
    assert.equal(result.state, "closed");
    assert.equal(result.reason, "signed_out");
    assert.equal(slot.values.has(TOKENS_REF), false);
    await agent.dispose();
  });

  it("login_signs_in_again_through_host_ui", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const ui = signingInUi(fixture);
    const { agent } = await startAgent(oauthConfig(fixture), slot.resolver, ui);
    const result = (await agent.commands.run("mcp:login", { id: "tracker" })) as { state: string };
    assert.equal(result.state, "connected");
    assert.equal(ui.requestsOf("open-url").length, 2);
    assert.equal(fixture.registrations.length, 1, "the saved client and redirect URI are reused");
    await agent.dispose();
  });

  it("busy_callback_port_registers_the_client_again", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const { agent } = await startAgent(oauthConfig(fixture), slot.resolver, signingInUi(fixture));
    const saved = (slot.values.get(TOKENS_REF)?.metadata as { mcpOAuth: { redirectUri: string } } | undefined)?.mcpOAuth.redirectUri;
    assert.ok(saved);
    // Something else now holds the saved port.
    const blocker = createServer();
    servers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(Number(new URL(saved).port), "127.0.0.1", () => resolve()));

    const result = (await agent.commands.run("mcp:login", { id: "tracker" })) as { state: string };
    assert.equal(result.state, "connected");
    assert.equal(fixture.registrations.length, 2);
    const next = fixture.registrations[1].redirect_uris?.[0];
    assert.notEqual(next, saved);
    assert.equal((slot.values.get(TOKENS_REF)?.metadata as { mcpOAuth: { redirectUri: string } } | undefined)?.mcpOAuth.redirectUri, next);
    await agent.dispose();
  });
  it("setup_does_not_wait_for_sign_in", async () => {
    const fixture = await startOAuthFixture();
    let opened = 0;
    // A browser the person never finishes: open-url never answers.
    const ui = {
      request: () => {
        opened++;
        return new Promise<never>(() => undefined);
      },
    } as unknown as NonNullable<Parameters<typeof createAgent>[0]["host"]>["ui"];
    const started = Date.now();
    const agent = await createAgent({
      model: testModel,
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), mcp(oauthConfig(fixture))],
      slots: { credentials: memorySlot().resolver },
      host: { ui },
    });
    assert.ok(Date.now() - started < 4000, "createAgent returned without waiting for the person");
    const server = await serverStatus(agent);
    assert.equal(server.state, "failed");
    assert.equal(server.reason, "auth_required");
    assert.equal(server.signingIn, true);
    for (let i = 0; i < 100 && opened === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(opened, 1);
    assert.equal(
      agent.tools.some((tool) => tool.name.startsWith("mcp:tracker:")),
      false,
    );
    // Dispose cancels the pending sign-in instead of waiting 5 minutes.
    const disposing = Date.now();
    await agent.dispose();
    assert.ok(Date.now() - disposing < 4000);
  });

  it("mcp_tools_appear_after_login_next_run", async () => {
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    let allowSignIn = false;
    let lastUrl: string | undefined;
    const ui = createScriptedHostUi((request: HostUiRequest) => {
      if (request.kind !== "open-url" || !allowSignIn) return { status: "unavailable" };
      lastUrl = request.url;
      fixture.expect(new URL(request.url));
      const target = callbackUrl(request.url);
      setTimeout(() => void fetch(target), 0);
      return { status: "answered", value: undefined };
    });
    const offered: string[][] = [];
    const agent = await createAgent({
      model: testModel,
      packages: [
        mockProvider(
          [
            [providerTextDelta("before"), providerDone()],
            [{ type: "tool_call", call: toolCallContent("call-1", "mcp:tracker:echo", { text: "hi" }) }, providerDone()],
            [providerTextDelta("after"), providerDone()],
          ],
          { onRequest: (request) => offered.push((request.tools ?? []).map((tool) => tool.name)) },
        ),
        mcp(oauthConfig(fixture)),
      ],
      slots: { credentials: slot.resolver },
      host: { ui: ui.ui },
    });
    assert.equal((await settled(agent)).reason, "auth_required");
    const session = await agent.session();
    await session.run("before sign-in");
    assert.equal(offered[0]?.includes("mcp:tracker:echo"), false);

    allowSignIn = true;
    const login = (await agent.commands.run("mcp:login", { id: "tracker" })) as { state: string };
    assert.equal(login.state, "connected");
    assert.ok(lastUrl);
    const result = await session.run("after sign-in");
    assert.equal(result.status, "completed");
    assert.ok(offered[1]?.includes("mcp:tracker:echo"), "the signed-in server's tools reach the next run");
    const echoed = (await session.entries()).flatMap((entry) =>
      entry.kind === "message" && entry.message ? entry.message.content.filter((block) => block.type === "tool_result") : [],
    );
    assert.equal(echoed.length, 1);
    assert.equal((echoed[0] as { error?: unknown }).error, undefined);
    await agent.dispose();
  });

  it("reconnect_never_prompts_for_oauth_sign_in", async () => {
    // Plan 234 Task 5: an HTTP drop (a 404 session expiry) starts the automatic reconnect; a 401 that refresh
    // cannot fix ends it with `auth_required`, and nothing is opened.
    const fixture = await startOAuthFixture();
    const slot = memorySlot();
    const ui = signingInUi(fixture);
    const config = { ...oauthConfig(fixture), reconnect: { attempts: 3, baseDelayMs: 5, maxDelayMs: 10 } };
    const agent = await createAgent({
      model: testModel,
      packages: [
        mockProvider([
          [{ type: "tool_call", call: toolCallContent("call-1", "mcp:tracker:echo", { text: "hi" }) }, providerDone()],
          [providerTextDelta("after"), providerDone()],
        ]),
        mcp(config),
      ],
      slots: { credentials: slot.resolver },
      host: { ui: ui.ui },
    });
    assert.equal((await settled(agent)).state, "connected");
    assert.equal(ui.requestsOf("open-url").length, 1);

    fixture.invalidateAccessToken();
    fixture.refuseRefresh();
    fixture.dropNextRequest();
    await (await agent.session()).run("call");
    let server = await serverStatus(agent);
    for (let i = 0; i < 300 && server.state !== "failed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      server = await serverStatus(agent);
    }
    assert.equal(server.state, "failed", JSON.stringify(server));
    assert.equal(server.reason, "auth_required");
    assert.equal(ui.requestsOf("open-url").length, 1, "an automatic reconnect never opens a sign-in");
    await agent.dispose();
  });
});
