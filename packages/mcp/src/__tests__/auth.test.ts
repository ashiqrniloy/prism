import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, it } from "node:test";
import type { ToolDefinition } from "@arnilo/prism";
import type { OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";
import { Client, InsufficientScopeError, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/client";
import { createMcpClientAuth, type McpClientAuthState, McpOAuthError } from "../auth.js";
import { createPrismMcpServer, createPrismMcpWebHandler } from "../server.js";
import { createMcpOAuthFetch, createMcpOAuthTransport } from "../transport.js";
import type { McpStreamableHttpTransport } from "../types.js";

const servers: Server[] = [];
// server.close(cb) pends forever while keep-alive sockets hold connections
// open (undici's global pool never drains them) and a second close after the
// 'close' event already fired never invokes its callback, so destroy all
// connections first and close each server exactly once.
const closedServers = new WeakSet<Server>();
function closeServer(server: Server): Promise<void> {
  if (closedServers.has(server)) return Promise.resolve();
  closedServers.add(server);
  server.closeAllConnections?.();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  while (servers.length > 0) {
    await closeServer(servers.pop()!);
  }
});

function listen(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => handler(request, response, body));
  });
  servers.push(server);
  return new Promise<{ readonly origin: string; readonly close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
      });
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function sha256b64url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function memoryState(): McpClientAuthState {
  const data = new Map<string, unknown>();
  return {
    // Credential methods take the optional issuer key (plan 063 task 5): hosts
    // may partition by issuer; this store keeps a "most-recent" slot so
    // ctx-less reads keep working, and records carry the SDK issuer stamp.
    loadTokens: async (issuer) => data.get(issuer ? `tokens@${issuer}` : "tokens") as StoredOAuthTokens | undefined,
    saveTokens: async (tokens, issuer) => {
      const key = issuer ?? tokens.issuer;
      data.set("tokens", tokens);
      if (key) data.set(`tokens@${key}`, tokens);
    },
    loadDiscovery: async () => data.get("discovery") as OAuthDiscoveryState | undefined,
    saveDiscovery: async (state) => void data.set("discovery", state),
    loadClientInformation: async (issuer) => data.get(issuer ? `client@${issuer}` : "client") as StoredOAuthClientInformation | undefined,
    saveClientInformation: async (info, issuer) => {
      const key = issuer ?? info.issuer;
      data.set("client", info);
      if (key) data.set(`client@${key}`, info);
    },
    loadCodeVerifier: async () => data.get("verifier") as string | undefined,
    saveCodeVerifier: async (verifier) => void data.set("verifier", verifier),
    loadAuthorizationState: async () => data.get("authorizationState") as { state: string; authorizationServerUrl?: string } | undefined,
    saveAuthorizationState: async (record) => void data.set("authorizationState", record),
    clear: async (scope) => {
      if (scope === "all") data.clear();
      else if (scope === "tokens") data.delete("tokens");
      else if (scope === "client") data.delete("client");
      else if (scope === "verifier") data.delete("verifier");
      else if (scope === "authorizationState") data.delete("authorizationState");
      else data.delete("discovery");
    },
  };
}

interface AuthServerState {
  readonly origin: string;
  readonly discoveryRequests: string[];
  readonly tokenRequests: Array<{
    grantType?: string;
    scope?: string;
    resource?: string;
    clientId?: string;
    authHeader?: string;
    verifier?: string;
  }>;
  readonly registrations: unknown[];
  readonly revocations: Array<{ token?: string; hint?: string; authHeader?: string }>;
  readonly tokenScopes: Map<string, string>;
  readonly currentAccessToken: () => string | undefined;
  invalidateCurrent(): void;
  close(): Promise<void>;
  setExpectedAuth(authorizationUrl: URL): void;
  rejectRefresh(token: string): void;
  failRegistration(status: number): void;
  setMetadata(overrides: Record<string, unknown>): void;
}

async function startAuthServer(initialOverrides: Record<string, unknown> = {}): Promise<AuthServerState> {
  const discoveryRequests: string[] = [];
  const tokenRequests: AuthServerState["tokenRequests"] = [];
  const registrations: unknown[] = [];
  const revocations: AuthServerState["revocations"] = [];
  const tokenScopes = new Map<string, string>();
  const refreshScopes = new Map<string, string>();
  const rejectedRefresh = new Set<string>();
  let expectedAuth: { challenge?: string; scope?: string } | undefined;
  let registrationStatus = 200;
  let counter = 0;
  let currentAccessToken: string | undefined;
  let metadataOverrides = initialOverrides;

  const handle = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const origin = `http://${request.headers.host}`;
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      discoveryRequests.push(url.pathname);
      sendJson(
        response,
        200,
        {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          revocation_endpoint: `${origin}/revoke`,
          code_challenge_methods_supported: ["S256"],
          response_types_supported: ["code"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
          scopes_supported: ["mcp", "extended"],
          ...metadataOverrides,
        },
        { "cache-control": "no-store" },
      );
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const params = new URLSearchParams(body);
      const record = {
        grantType: params.get("grant_type") ?? undefined,
        scope: params.get("scope") ?? undefined,
        resource: params.get("resource") ?? undefined,
        clientId: params.get("client_id") ?? undefined,
        authHeader: request.headers.authorization,
        verifier: params.get("code_verifier") ?? undefined,
      };
      tokenRequests.push(record);
      if (record.grantType === "authorization_code") {
        const verifier = record.verifier;
        if (
          params.get("code") !== "test-code" ||
          !verifier ||
          !expectedAuth?.challenge ||
          sha256b64url(verifier) !== expectedAuth.challenge
        ) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
      } else if (record.grantType === "refresh_token") {
        const refresh = params.get("refresh_token");
        if (!refresh?.startsWith("rt-") || rejectedRefresh.has(refresh)) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
        const previousScope = refreshScopes.get(refresh) ?? "mcp";
        counter += 1;
        const accessToken = `at-${counter}`;
        const refreshToken = `rt-${counter}`;
        const scope = record.scope ?? previousScope;
        tokenScopes.set(accessToken, scope);
        refreshScopes.set(refreshToken, scope);
        currentAccessToken = accessToken;
        sendJson(response, 200, { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 3600, scope });
        return;
      } else {
        sendJson(response, 400, { error: "unsupported_grant_type" });
        return;
      }
      counter += 1;
      const accessToken = `at-${counter}`;
      const refreshToken = `rt-${counter}`;
      const scope = expectedAuth?.scope ?? "mcp";
      tokenScopes.set(accessToken, scope);
      refreshScopes.set(refreshToken, scope);
      currentAccessToken = accessToken;
      sendJson(response, 200, { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 3600, scope });
      return;
    }
    if (url.pathname === "/register" && request.method === "POST") {
      registrations.push(JSON.parse(body));
      if (registrationStatus !== 200) {
        sendJson(response, registrationStatus, { error: "invalid_client_metadata", error_description: "denied" });
        return;
      }
      sendJson(response, 201, {
        client_id: "dcr-1",
        client_secret: "dcr-secret",
        client_name: "prism-mcp",
        token_endpoint_auth_method: "client_secret_basic",
        redirect_uris: ["http://localhost:33418/callback"],
      });
      return;
    }
    if (url.pathname === "/revoke" && request.method === "POST") {
      const params = new URLSearchParams(body);
      revocations.push({
        token: params.get("token") ?? undefined,
        hint: params.get("token_type_hint") ?? undefined,
        authHeader: request.headers.authorization,
      });
      sendJson(response, 200, {});
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });

  return {
    origin: handle.origin,
    discoveryRequests,
    tokenRequests,
    registrations,
    revocations,
    tokenScopes,
    currentAccessToken: () => currentAccessToken,
    invalidateCurrent: () => {
      currentAccessToken = undefined;
    },
    close: handle.close,
    setExpectedAuth: (authorizationUrl) => {
      expectedAuth = {
        challenge: authorizationUrl.searchParams.get("code_challenge") ?? undefined,
        scope: authorizationUrl.searchParams.get("scope") ?? undefined,
      };
    },
    rejectRefresh: (token) => {
      rejectedRefresh.add(token);
    },
    failRegistration: (status) => {
      registrationStatus = status;
    },
    setMetadata: (overrides) => {
      metadataOverrides = { ...metadataOverrides, ...overrides };
    },
  };
}

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo a string",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async ({ text }) => ({ toolCallId: "echo", name: "echo", content: [{ type: "text", text: String(text) }] }),
};

async function startPrismServer(as: AuthServerState): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  let handler: ReturnType<typeof createPrismMcpWebHandler> extends Promise<infer T> ? T : never;
  const handle = await listen(async (request, response, body) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    // After `initialized` the Streamable HTTP client opens a standalone GET
    // SSE stream for server-push. These fixtures do not exercise push, and a
    // long-lived stream would outlive the test, so decline it; the SDK treats
    // 405 on GET as "no SSE stream", which is expected and harmless.
    if (method === "GET" && !url.startsWith("/.well-known/")) {
      response.writeHead(405, { allow: "POST, DELETE" });
      response.end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const result = await handler(
      new Request(`http://${request.headers.host ?? "127.0.0.1"}${url}`, {
        method,
        headers,
        body: method === "POST" ? body : undefined,
      }),
    );
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(await result.text());
  });
  handler = await createPrismMcpWebHandler(
    () =>
      createPrismMcpServer({
        name: "prism-test",
        version: "1.0.0",
        tools: [echoTool],
        authorize: () => ({ allowed: true }),
      }),
    {
      protectedResource: {
        authorizationServers: [as.origin],
        resource: `${handle.origin}/mcp`,
        scopesSupported: ["mcp"],
      },
      resolveIdentity: (request) => {
        const authorization = request.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer at-") || authorization.slice("Bearer ".length) !== as.currentAccessToken()) return false;
        return { id: "user-1", ownership: { tenantId: "tenant-1", accountId: "account-1" } };
      },
    },
  );
  return { origin: handle.origin, close: handle.close };
}

function oauthTransportConfig(origin: string, overrides: Partial<McpStreamableHttpTransport> = {}): McpStreamableHttpTransport {
  return {
    type: "streamable-http",
    url: `${origin}/mcp`,
    allowedOrigins: [origin],
    allowLoopbackHttp: true,
    ...overrides,
  };
}

function baseAuthOptions(state: McpClientAuthState, redirect: (url: URL) => void) {
  return {
    state,
    strategy: { kind: "static", clientId: "prism-test", clientSecret: "s3cret" } as const,
    redirectUri: "http://localhost:33418/callback",
    onRedirectRequired: redirect,
    scopes: ["mcp"],
  };
}

async function connectWithOAuth(config: McpStreamableHttpTransport) {
  const { transport, auth } = createMcpOAuthTransport(config);
  const client = new Client({ name: "prism-oauth-test", version: "1.0.0" });
  return { client, auth, transport, connect: () => client.connect(transport) };
}

describe("@arnilo/prism-mcp OAuth client (RFC 9728 + PKCE + refresh)", () => {
  it("discovers, runs PKCE/state round trip, and completes the interactive flow", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const { client, auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    assert.ok(authorizationUrl, "redirect required");
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(authorizationUrl.searchParams.get("client_id"), "prism-test");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorizationUrl.searchParams.get("code_challenge"), "PKCE challenge present");
    assert.ok(authorizationUrl.searchParams.get("state"), "OAuth state present");
    assert.equal(authorizationUrl.searchParams.get("scope"), "mcp");
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "http://localhost:33418/callback");
    assert.equal(authorizationUrl.searchParams.get("resource"), `${mcp.origin}/mcp`);
    as.setExpectedAuth(authorizationUrl);
    await auth.finishAuth("test-code");
    assert.equal(as.tokenRequests.length, 1);
    assert.equal(as.tokenRequests[0].grantType, "authorization_code");
    assert.ok(as.tokenRequests[0].verifier, "code verifier round-tripped through state");
    assert.equal(as.tokenRequests[0].resource, `${mcp.origin}/mcp`);
    assert.ok(as.tokenRequests[0].authHeader?.startsWith("Basic "), "static client secret via Basic auth");
    assert.equal((await state.loadTokens())?.access_token, "at-1");

    // Second connect: the access token is stale, so the client refreshes.
    as.invalidateCurrent();
    // Second connect refreshes instead of re-authorizing.
    const {
      client: client2,
      auth: auth2,
      connect: connect2,
    } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, () => {
          throw new Error("must not redirect again");
        }),
      }),
    );
    await connect2();
    assert.equal(as.tokenRequests.length, 2);
    assert.equal(as.tokenRequests[1].grantType, "refresh_token");
    const basicAuth = Buffer.from(as.tokenRequests[1].authHeader!.slice("Basic ".length), "base64").toString();
    assert.equal(basicAuth, "prism-test:s3cret", "static client secret via Basic auth on refresh");
    assert.equal(as.tokenRequests[1].resource, `${mcp.origin}/mcp`, "RFC 8707 resource on refresh");
    const tools = await client2.listTools();
    assert.equal(tools.tools.length, 1);
    assert.equal(tools.tools[0].name, "echo");
    await client2.close();
    await auth2.revoke();
    await client.close();
    await mcp.close();
    await as.close();
  });

  it("registers via RFC 7591 DCR exactly once and reuses persisted client information", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const authOptions = {
      ...baseAuthOptions(state, (url) => {
        authorizationUrl = url;
      }),
      strategy: { kind: "dcr" as const, clientMetadata: { client_name: "prism-mcp", redirect_uris: ["http://localhost:33418/callback"] } },
    };
    const { auth, connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await assert.rejects(() => connect());
    assert.equal(as.registrations.length, 1);
    assert.deepEqual((as.registrations[0] as { redirect_uris: string[] }).redirect_uris, ["http://localhost:33418/callback"]);
    as.setExpectedAuth(authorizationUrl!);
    await auth.finishAuth("test-code");
    assert.equal((await state.loadClientInformation())?.client_id, "dcr-1");
    const dcrBasic = Buffer.from(as.tokenRequests[0].authHeader!.slice("Basic ".length), "base64").toString();
    assert.equal(dcrBasic, "dcr-1:dcr-secret", "DCR client secret used");
    as.invalidateCurrent();
    const { connect: connect2 } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await connect2();
    assert.equal(as.registrations.length, 1, "no second registration");
    assert.equal(as.tokenRequests[1].grantType, "refresh_token");
    await mcp.close();
    await as.close();
  });

  it("rejects dynamic registration failures", async () => {
    const as = await startAuthServer();
    as.failRegistration(403);
    const mcp = await startPrismServer(as);
    const state = memoryState();
    const authOptions = {
      ...baseAuthOptions(state, () => {}),
      strategy: { kind: "dcr" as const, clientMetadata: { client_name: "prism-mcp", redirect_uris: ["http://localhost:33418/callback"] } },
    };
    const { connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await assert.rejects(() => connect());
    await mcp.close();
    await as.close();
  });

  it("re-authorizes with the challenged scope when refresh is rejected (insufficient_scope)", async () => {
    const as = await startAuthServer();
    const mcp = await listen((request, response, body) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, {
          authorization_servers: [as.origin],
          resource: `${mcp.origin}/mcp`,
          scopes_supported: ["mcp", "extended"],
        });
        return;
      }
      if (request.method === "GET") {
        response.writeHead(405);
        response.end();
        return;
      }
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer at-")) {
        response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource"` });
        response.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }
      const scope = as.tokenScopes.get(authorization.slice("Bearer ".length)) ?? "";
      if (!scope.includes("extended")) {
        response.writeHead(403, {
          "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource", scope="extended", error="insufficient_scope"`,
        });
        response.end(JSON.stringify({ error: { message: "Insufficient scope" } }));
        return;
      }
      const upscopeMessage = JSON.parse(body) as { id?: unknown; method: string };
      if (upscopeMessage.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      if (upscopeMessage.method === "initialize") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: upscopeMessage.id,
          result: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "scope-fake", version: "1.0.0" },
          },
        });
        return;
      }
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: upscopeMessage.id,
        result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] },
      });
    });
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const authOptions = baseAuthOptions(state, (url) => {
      authorizationUrl = url;
    });
    // Pre-seed a stale token that lacks the challenged scope. The 403 challenge
    // scope is a strict superset of it, so the v2 SDK step-up force-reauthorizes
    // (RFC 6749 §6: refresh cannot widen scope) instead of attempting a refresh.
    await state.saveTokens({ access_token: "at-old", refresh_token: "rt-rejected", token_type: "Bearer" });
    as.rejectRefresh("rt-rejected");
    const { auth, connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await assert.rejects(() => connect());
    assert.ok(authorizationUrl, "interactive re-authorization required");
    assert.equal(authorizationUrl.searchParams.get("scope"), "extended", "challenged scope carried into re-authorization");
    as.setExpectedAuth(authorizationUrl);
    await auth.finishAuth("test-code");
    assert.equal(
      as.tokenRequests.filter((request) => request.grantType === "refresh_token").length,
      0,
      "superset step-up never refreshes (a refresh could silently drop the widened scope)",
    );
    assert.equal(as.tokenScopes.get("at-1"), "extended", "AS issued the upscoped token");

    const { client, connect: connect2 } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await connect2();
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 1);
    await client.close();
    await mcp.close();
    await as.close();
  });

  it("fails closed after one bounded step-up retry when the server keeps 403ing", async () => {
    const as = await startAuthServer();
    const mcp = await listen((request, response, body) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, { authorization_servers: [as.origin], resource: `${mcp.origin}/mcp` });
        return;
      }
      if (request.method === "GET") {
        response.writeHead(405);
        response.end();
        return;
      }
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer at-") || authorization.slice("Bearer ".length) !== as.currentAccessToken()) {
        response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource"` });
        response.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }
      if (body.includes("tools/list")) {
        // Same-scope re-challenge: not a strict superset, so the v2 SDK steps up
        // through a bounded refresh loop rather than a fresh authorization.
        response.writeHead(403, {
          "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource", scope="mcp", error="insufficient_scope"`,
        });
        response.end(JSON.stringify({ error: { message: "Insufficient scope" } }));
        return;
      }
      const breakerMessage = JSON.parse(body) as { id?: unknown; method: string };
      if (breakerMessage.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: breakerMessage.id,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "breaker", version: "1.0.0" },
        },
      });
    });
    const state = memoryState();
    const authOptions = baseAuthOptions(state, () => {
      throw new Error("must not redirect");
    });
    // Valid refresh token, but the server never stops 403ing the same scope.
    // 2026-07-28 issuer binding: seeded records must carry the SDK issuer stamp
    // (un-stamped legacy records are refused, not guessed).
    await state.saveTokens({ access_token: "at-0", refresh_token: "rt-0", token_type: "Bearer", issuer: as.origin });
    const { client, connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await connect();
    await assert.rejects(() => client.listTools(), /403|step-up/i);
    assert.equal(as.tokenRequests.length, 2, "one refresh + one step-up refresh, then circuit breaker");
    await client.close();
    await mcp.close();
    await as.close();
  });

  it("caches discovery bounded by TTL and re-discovers after expiry", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let now = 1_000_000;
    const state = memoryState();
    const auth = createMcpClientAuth(
      {
        ...baseAuthOptions(state, () => {}),
        now: () => now,
        limits: { discoveryCacheTtlMs: 60_000 },
      },
      { serverUrl: `${mcp.origin}/mcp`, fetch: createMcpOAuthFetch(oauthTransportConfig(mcp.origin)) },
    );
    assert.equal(await auth.ensureAuthorized(), "REDIRECT");
    assert.equal(as.discoveryRequests.length, 1, "AS metadata discovery (PRM is served by the MCP server)");
    await state.saveTokens({ access_token: "at-0", refresh_token: "rt-0", token_type: "Bearer", issuer: as.origin });
    assert.equal(await auth.ensureAuthorized(), "AUTHORIZED");
    assert.equal(as.discoveryRequests.length, 1, "discovery cached within TTL");
    now += 60_001;
    assert.equal(await auth.ensureAuthorized(), "AUTHORIZED");
    assert.equal(as.discoveryRequests.length, 2, "re-discovery after TTL expiry");
    await mcp.close();
    await as.close();
  });

  it("fails closed on SSRF discovery targets (private IP)", async () => {
    const mcp = await startPrismServer({ origin: "https://169.254.169.254/" } as AuthServerState);
    const state = memoryState();
    const { connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, () => {}),
      }),
    );
    await assert.rejects(
      () => connect(),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_SSRF",
    );
    await mcp.close();
  });

  it("never follows discovery redirects", async () => {
    const as = await listen((request, response) => {
      if (request.url?.startsWith("/.well-known/oauth-authorization-server")) {
        response.writeHead(302, { location: "https://evil.example/metadata" });
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const mcp = await listen((request, response) => {
      if (request.url?.startsWith("/.well-known/oauth-protected-resource")) {
        sendJson(response, 200, { authorization_servers: [as.origin], resource: `http://${request.headers.host}/mcp` });
        return;
      }
      response.writeHead(405);
      response.end();
    });
    const state = memoryState();
    const config = oauthTransportConfig(mcp.origin, { auth: baseAuthOptions(state, () => {}) });
    const auth = createMcpClientAuth(config.auth!, { serverUrl: `${mcp.origin}/mcp`, fetch: createMcpOAuthFetch(config) });
    await assert.rejects(
      () => auth.ensureAuthorized(),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_DISCOVERY",
    );
    await mcp.close();
    await as.close();
  });

  it("fails closed when the discovered issuer origin drifts from the AS URL", async () => {
    const as = await startAuthServer({ issuer: "https://other.example/issuer" });
    const mcp = await startPrismServer(as);
    const state = memoryState();
    const config = oauthTransportConfig(mcp.origin, { auth: baseAuthOptions(state, () => {}) });
    const auth = createMcpClientAuth(config.auth!, { serverUrl: `${mcp.origin}/mcp`, fetch: createMcpOAuthFetch(config) });
    await assert.rejects(
      () => auth.ensureAuthorized(),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_ORIGIN",
    );
    await mcp.close();
    await as.close();
  });

  it("denies a protected resource on a foreign origin (confused-deputy)", async () => {
    const as = await startAuthServer();
    const mcp = await listen((request, response) => {
      if (request.url?.startsWith("/.well-known/oauth-protected-resource")) {
        sendJson(response, 200, { authorization_servers: [as.origin], resource: "https://evil.example/mcp" });
        return;
      }
      response.writeHead(405);
      response.end();
    });
    const state = memoryState();
    const config = oauthTransportConfig(mcp.origin, { auth: baseAuthOptions(state, () => {}) });
    const auth = createMcpClientAuth(config.auth!, { serverUrl: `${mcp.origin}/mcp`, fetch: createMcpOAuthFetch(config) });
    await assert.rejects(
      () => auth.ensureAuthorized(),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_AUDIENCE",
    );
    await mcp.close();
    await as.close();
  });

  it("bounds token records (tokenRecordBytes) and revokes tokens (RFC 7009)", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const authOptions = baseAuthOptions(state, (url) => {
      authorizationUrl = url;
    });
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: { ...authOptions, limits: { tokenRecordBytes: 32 } },
      }),
    );
    await assert.rejects(() => connect());
    as.setExpectedAuth(authorizationUrl!);
    await assert.rejects(
      () => auth.finishAuth("test-code"),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_TOKEN_STORE",
    );

    const state2 = memoryState();
    const auth2 = createMcpClientAuth(
      baseAuthOptions(state2, () => {}),
      {
        serverUrl: `${mcp.origin}/mcp`,
        fetch: createMcpOAuthFetch(oauthTransportConfig(mcp.origin)),
      },
    );
    await auth2.ensureAuthorized();
    await state2.saveTokens({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer" });
    await auth2.revoke();
    assert.equal(as.revocations.length, 1);
    assert.equal(as.revocations[0].token, "rt-1");
    assert.equal(as.revocations[0].hint, "refresh_token");
    assert.ok(as.revocations[0].authHeader?.startsWith("Basic "));
    assert.equal(await state2.loadTokens(), undefined, "local tokens cleared");
    await mcp.close();
    await as.close();
  });

  it("refuses out-of-bounds caps at construction", () => {
    assert.throws(
      () =>
        createMcpClientAuth(
          { ...baseAuthOptions(memoryState(), () => {}), limits: { discoveryCacheTtlMs: 10_000_000 } },
          { serverUrl: "https://x", fetch },
        ),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_STATE",
    );
  });
});

/**
 * 2026-07-28 OAuth conformance (plan 063 task 5): callback state/iss validation,
 * issuer-keyed credential isolation, CIMD, DCR deprecation defaults, and the
 * explicit insufficient-scope policy.
 */
describe("2026-07-28 OAuth conformance (plan 063 task 5)", () => {
  it("completes a full callback URLSearchParams round trip with validated state and iss", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    as.setExpectedAuth(authorizationUrl!);
    const callback = new URLSearchParams({
      state: authorizationUrl!.searchParams.get("state")!,
      code: "test-code",
      iss: as.origin,
    });
    await auth.finishAuth(callback);
    assert.equal(as.tokenRequests.length, 1, "exactly one code exchange");
    assert.equal(as.tokenRequests[0].grantType, "authorization_code");
    const tokens = await state.loadTokens();
    assert.equal(tokens?.access_token, "at-1");
    assert.equal(tokens?.issuer, as.origin, "SDK issuer-stamps persisted tokens");
    await auth.revoke();
    await mcp.close();
    await as.close();
  });

  it("fails closed on a state mismatch before touching the token endpoint", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let _authorizationUrl: URL | undefined;
    const state = memoryState();
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          _authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    await assert.rejects(
      () => auth.finishAuth(new URLSearchParams({ state: "forged", code: "test-code" })),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_STATE",
    );
    assert.equal(as.tokenRequests.length, 0, "no token exchange without a validated state");
    await mcp.close();
    await as.close();
  });

  it("never surfaces callback error fields after an issuer mismatch", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    const validState = authorizationUrl!.searchParams.get("state")!;
    const hostile = new URLSearchParams({
      state: validState,
      iss: "https://evil.example",
      error: "access_denied",
      error_description: "SECRET-SERVER-DETAIL",
    });
    await assert.rejects(
      () => auth.finishAuth(hostile),
      (error: unknown) => {
        assert.ok(error instanceof McpOAuthError);
        assert.equal(error.code, "ERR_PRISM_MCP_OAUTH_ORIGIN");
        assert.ok(!error.message.includes("SECRET-SERVER-DETAIL"), "error_description stays undisclosed");
        assert.ok(!error.message.includes("access_denied"), "callback error code stays undisclosed after issuer mismatch");
        return true;
      },
    );
    assert.equal(as.tokenRequests.length, 0);
    await mcp.close();
    await as.close();
  });

  it("fails closed when the AS requires iss but the callback omits it", async () => {
    const as = await startAuthServer({ authorization_response_iss_parameter_supported: true });
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    as.setExpectedAuth(authorizationUrl!);
    await assert.rejects(
      () => auth.finishAuth(new URLSearchParams({ state: authorizationUrl!.searchParams.get("state")!, code: "test-code" })),
      (error: unknown) => error instanceof McpOAuthError && error.code === "ERR_PRISM_MCP_OAUTH_ORIGIN",
    );
    await mcp.close();
    await as.close();
  });

  it("never serves credentials across issuers and refuses ambiguous legacy records", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const { auth, connect } = await connectWithOAuth(
      oauthTransportConfig(mcp.origin, {
        auth: baseAuthOptions(state, (url) => {
          authorizationUrl = url;
        }),
      }),
    );
    await assert.rejects(() => connect());
    as.setExpectedAuth(authorizationUrl!);
    await auth.finishAuth(new URLSearchParams({ state: authorizationUrl!.searchParams.get("state")!, code: "test-code" }));

    const foreign = await auth.provider.tokens({ issuer: "https://other-as.example" });
    assert.equal(foreign, undefined, "tokens stamped for one issuer are never served to another");
    const own = await auth.provider.tokens({ issuer: as.origin });
    assert.equal(own?.access_token, "at-1");

    // Pre-upgrade storage shape: a single-slot store returns the same record
    // for any issuer key; an un-stamped record is ambiguous, refuse it rather
    // than guessing an issuer.
    let flatRecord: StoredOAuthTokens | undefined = { access_token: "legacy", token_type: "Bearer" };
    const flatState: McpClientAuthState = {
      ...memoryState(),
      loadTokens: async () => flatRecord,
      saveTokens: async (tokens) => {
        flatRecord = tokens;
      },
    };
    const authFlat = createMcpClientAuth(
      baseAuthOptions(flatState, () => {}),
      {
        serverUrl: `${mcp.origin}/mcp`,
        fetch: createMcpOAuthFetch(oauthTransportConfig(mcp.origin)),
      },
    );
    const refused = await authFlat.provider.tokens({ issuer: as.origin });
    assert.equal(refused, undefined, "un-stamped legacy record is refused on an issuer-keyed read");
    // ctx-less bearer reads still return the most-recent set (SDK contract).
    assert.equal((await authFlat.getTokens())?.access_token, "legacy");
    await mcp.close();
    await as.close();
  });

  it("uses CIMD url-based client ids without DCR and validates the metadata URL", async () => {
    const as = await startAuthServer({ client_id_metadata_document_supported: true });
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const cimdUrl = "https://client.example/oauth/metadata.json";
    const authOptions = {
      ...baseAuthOptions(state, (url) => {
        authorizationUrl = url;
      }),
      strategy: { kind: "cimd" as const, clientMetadataUrl: cimdUrl },
    };
    const { auth, connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await assert.rejects(() => connect());
    assert.equal(as.registrations.length, 0, "CIMD performs no dynamic registration");
    assert.equal(authorizationUrl!.searchParams.get("client_id"), cimdUrl);
    as.setExpectedAuth(authorizationUrl!);
    await auth.finishAuth(new URLSearchParams({ state: authorizationUrl!.searchParams.get("state")!, code: "test-code" }));
    assert.equal(as.tokenRequests[0].clientId, cimdUrl, "url-based client id on the token request");

    const invalid = [
      "http://client.example/oauth/metadata.json", // not https
      "https://client.example/", // root pathname
    ];
    for (const clientMetadataUrl of invalid) {
      assert.throws(
        () =>
          createMcpClientAuth(
            { ...baseAuthOptions(memoryState(), () => {}), strategy: { kind: "cimd", clientMetadataUrl } },
            { serverUrl: `${mcp.origin}/mcp`, fetch: createMcpOAuthFetch(oauthTransportConfig(mcp.origin)) },
          ),
        /clientMetadataUrl/,
      );
    }
    await mcp.close();
    await as.close();
  });

  it("defaults DCR application_type to native", async () => {
    const as = await startAuthServer();
    const mcp = await startPrismServer(as);
    let authorizationUrl: URL | undefined;
    const state = memoryState();
    const authOptions = {
      ...baseAuthOptions(state, (url) => {
        authorizationUrl = url;
      }),
      strategy: {
        kind: "dcr" as const,
        clientMetadata: { client_name: "prism-mcp", redirect_uris: ["http://localhost:33418/callback"] },
      },
    };
    const { auth, connect } = await connectWithOAuth(oauthTransportConfig(mcp.origin, { auth: authOptions }));
    await assert.rejects(() => connect());
    assert.equal((as.registrations[0] as { application_type?: string }).application_type, "native");
    as.setExpectedAuth(authorizationUrl!);
    await auth.finishAuth(new URLSearchParams({ state: authorizationUrl!.searchParams.get("state")!, code: "test-code" }));
    await mcp.close();
    await as.close();
  });

  it("surfaces typed InsufficientScopeError under the explicit throw policy", async () => {
    const as = await startAuthServer();
    const mcp = await listen((request, response, body) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, {
          authorization_servers: [as.origin],
          resource: `${mcp.origin}/mcp`,
          scopes_supported: ["mcp", "extended"],
        });
        return;
      }
      if (request.method === "GET") {
        response.writeHead(405);
        response.end();
        return;
      }
      const authorization = request.headers.authorization ?? "";
      let parsedMethod: string | undefined;
      try {
        parsedMethod = JSON.parse(body).method;
      } catch {}
      if (parsedMethod?.startsWith("notifications/")) {
        response.writeHead(202);
        response.end();
        return;
      }
      const scope = as.tokenScopes.get(authorization.slice("Bearer ".length)) ?? "";
      if (parsedMethod === "initialize") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: JSON.parse(body).id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        });
        return;
      }
      if (!scope.includes("extended")) {
        response.writeHead(403, {
          "www-authenticate": `Bearer resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource", scope="extended", error="insufficient_scope"`,
        });
        response.end(JSON.stringify({ error: { message: "Forbidden" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, result: { tools: [] } }));
    });
    const state = memoryState();
    const authOptions = {
      ...baseAuthOptions(state, () => {}),
      onInsufficientScope: "throw" as const,
    };
    const config = oauthTransportConfig(mcp.origin, { auth: authOptions });
    const { transport, auth } = createMcpOAuthTransport(config);
    const client = new Client({ name: "prism-oauth-test", version: "1.0.0" });
    // Seed a stamped, scoped, refresh-less token so connect succeeds and the
    // first tools/list reaches the 403.
    await state.saveTokens({ access_token: "at-0", token_type: "Bearer", scope: "mcp", issuer: as.origin });
    as.tokenScopes.set("at-0", "mcp");
    await auth.ensureAuthorized({ scope: "mcp" });
    await client.connect(transport);
    await assert.rejects(
      () => client.listTools(),
      (error: unknown) => {
        assert.ok(error instanceof InsufficientScopeError, "typed SDK InsufficientScopeError, not a redirect");
        assert.equal(error.requiredScope, "extended");
        return true;
      },
    );
    assert.equal(
      as.tokenRequests.filter((request) => request.grantType === "refresh_token").length,
      0,
      "throw policy never re-authorizes silently",
    );
    await client.close();
    await mcp.close();
    await as.close();
  });
});

describe("@arnilo/prism-mcp OAuth server (RFC 9728 protected resource)", () => {
  it("serves protected-resource metadata and challenges unauthenticated requests", async () => {
    const handler = await createPrismMcpWebHandler(
      () => createPrismMcpServer({ name: "srv", version: "1.0.0", tools: [], authorize: () => ({ allowed: true }) }),
      {
        protectedResource: {
          authorizationServers: ["https://as.example.com/oauth"],
          resource: "https://mcp.example.com/mcp",
          scopesSupported: ["mcp"],
        },
        resolveIdentity: () => false,
      },
    );
    const wellKnown = await handler(new Request("https://mcp.example.com/.well-known/oauth-protected-resource"));
    assert.equal(wellKnown.status, 200);
    assert.deepEqual(await wellKnown.json(), {
      authorization_servers: ["https://as.example.com/oauth"],
      resource: "https://mcp.example.com/mcp",
      scopes_supported: ["mcp"],
    });
    const denied = await handler(new Request("https://mcp.example.com/mcp", { method: "POST", body: "{}" }));
    assert.equal(denied.status, 401);
    assert.equal(
      denied.headers.get("www-authenticate"),
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="mcp"',
    );
    const wrongMethod = await handler(
      new Request("https://mcp.example.com/.well-known/oauth-protected-resource", { method: "POST", body: "{}" }),
    );
    assert.equal(wrongMethod.status, 405);
  });

  it("without protectedResource there is no metadata route and no challenge header", async () => {
    const handler = await createPrismMcpWebHandler(
      () => createPrismMcpServer({ name: "srv", version: "1.0.0", tools: [], authorize: () => ({ allowed: true }) }),
      { resolveIdentity: () => false },
    );
    const wellKnown = await handler(new Request("https://mcp.example.com/.well-known/oauth-protected-resource"));
    assert.notEqual(wellKnown.status, 200);
    const denied = await handler(new Request("https://mcp.example.com/mcp", { method: "POST", body: "{}" }));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("www-authenticate"), null);
  });

  it("rejects invalid protected resource configuration and stateless instances", async () => {
    const factory = () => createPrismMcpServer({ name: "srv", version: "1.0.0", tools: [], authorize: () => ({ allowed: true }) });
    await assert.rejects(
      () =>
        createPrismMcpWebHandler(factory, {
          protectedResource: { authorizationServers: ["http://mcp.example.com/oauth"], resource: "https://mcp.example.com/mcp" },
        }),
      /https|loopback/,
    );
    await assert.rejects(
      () => createPrismMcpWebHandler(factory, { protectedResource: { authorizationServers: [], resource: "https://mcp.example.com/mcp" } }),
      /1\.\.8/,
    );
    await assert.rejects(
      () =>
        createPrismMcpWebHandler(factory, {
          protectedResource: {
            authorizationServers: ["https://as.example.com"],
            resource: "https://mcp.example.com/mcp",
            scopesSupported: [],
          },
        }),
      /1\.\.64/,
    );
    await assert.rejects(
      () => createPrismMcpWebHandler(factory(), {}),
      /server factory/,
      "stateless handlers require a factory (SDK stateless transports cannot be reused)",
    );
  });
});
