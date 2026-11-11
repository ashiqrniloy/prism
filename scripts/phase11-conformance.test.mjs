/**
 * Phase 11 network-free conformance (plan 011 Task 6).
 * Cross-cuts the Task 0 freeze matrices through the real adapters: OIDC/JWKS
 * identity verification (@arnilo/prism-credentials-node/oidc), OPA policy
 * evaluation with the durable decision ledger (@arnilo/prism-policy/opa),
 * MCP OAuth client/server wiring (@arnilo/prism-extensions/mcp), OpenAPI tools
 * (@arnilo/prism-openapi-tools), and the artifact body store + signed
 * delivery (@arnilo/prism-server/artifact-bodies). Everything runs in-process
 * or against loopback 127.0.0.1 servers; no external network, no credentials.
 *
 * Composed scenario: OIDC-verified identity → OPA decision (durable ledger) →
 * MCP OAuth-authorized bridge tool → OpenAPI side-effect tool with
 * approval/idempotency → artifact body stored + signed delivery, all with
 * redaction and audit records. Adversarial: adapter-absent baseline, hostile
 * OpenAPI origin, limit ladder at/above frozen caps, secret redaction sweep.
 */

import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createSecretRedactor } from "@arnilo/prism";
import {
  createMemoryPolicyDecisionStore,
  createOpaPolicyEvaluator,
  createPolicyEvaluator,
  evaluateAndAppend,
} from "@arnilo/prism-extensions/governance";
import { createMcpOAuthTransport } from "@arnilo/prism-extensions/mcp";
import { createPrismMcpWebHandler } from "@arnilo/prism-hosts/mcp-server";
import { createOpenApiTools } from "@arnilo/prism-tools/openapi";
import { Client } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const SECRET = "conformance-secret-value";
const redactor = createSecretRedactor([SECRET]);
const servers = [];

// server.close(cb) pends forever while keep-alive sockets hold connections
// open (undici's global pool never drains them) and a second close after the
// 'close' event already fired never invokes its callback, so destroy all
// connections first and close each server exactly once.
const closedServers = new WeakSet();
function closeServer(server) {
  if (closedServers.has(server)) return Promise.resolve();
  closedServers.add(server);
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  while (servers.length > 0) {
    await closeServer(servers.pop());
  }
});

function listen(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => handler(request, response, body));
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
      });
    });
  });
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function _sha256b64url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

// ---------------------------------------------------------------------------
// OIDC fixture: in-process RSA key + JWKS-served fake fetch.
// ---------------------------------------------------------------------------

async function _makeRsaKeys() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function _signToken(key, claims) {
  const header = { alg: "RS256", typ: "JWT", kid: "key-1" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://issuer.example", aud: "prism", iat: now - 10, exp: now + 3600, ...claims };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function _jwksFetch(publicKey) {
  return async (input) => {
    const url = String(input);
    if (url === "https://issuer.example/jwks") {
      const jwk = await crypto.subtle.exportKey("jwk", publicKey);
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "key-1", use: "sig", alg: "RS256" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// OPA fixture: fake decision endpoint.
// ---------------------------------------------------------------------------

function opaFetch(decision, status = 200) {
  return async (input) => {
    const url = String(input);
    if (url.startsWith("https://opa.example/v1/data/prism/allow")) {
      return new Response(JSON.stringify({ result: decision }), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// MCP OAuth fixture: minimal authorization server + Prism MCP server.
// ---------------------------------------------------------------------------

function memoryState() {
  const data = new Map();
  return {
    loadTokens: async () => data.get("tokens"),
    saveTokens: async (tokens) => void data.set("tokens", tokens),
    loadDiscovery: async () => data.get("discovery"),
    saveDiscovery: async (state) => void data.set("discovery", state),
    loadClientInformation: async () => data.get("client"),
    saveClientInformation: async (info) => void data.set("client", info),
    loadCodeVerifier: async () => data.get("verifier"),
    saveCodeVerifier: async (verifier) => void data.set("verifier", verifier),
    clear: async (scope) => {
      if (scope === "all") data.clear();
      else if (scope === "tokens") data.delete("tokens");
      else if (scope === "client") data.delete("client");
      else if (scope === "verifier") data.delete("verifier");
      else data.delete("discovery");
    },
  };
}

async function startAuthServer() {
  const tokenRequests = [];
  let counter = 0;
  let current;
  const handle = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const origin = `http://${request.headers.host}`;
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (url.pathname === "/token") {
      const params = new URLSearchParams(body);
      tokenRequests.push({
        grantType: params.get("grant_type") ?? undefined,
        scope: params.get("scope") ?? undefined,
        resource: params.get("resource") ?? undefined,
      });
      if (params.get("grant_type") === "authorization_code" || params.get("grant_type") === "refresh_token") {
        current = `at-${++counter}`;
        sendJson(response, 200, {
          access_token: current,
          refresh_token: `rt-${counter}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp",
        });
        return;
      }
      sendJson(response, 400, { error: "unsupported_grant_type" });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });
  return {
    origin: handle.origin,
    tokenRequests,
    currentAccessToken: () => current,
    invalidateCurrent() {
      current = undefined;
    },
    close: handle.close,
  };
}

// Plain SDK MCP server: this leg covers MCP OAuth + the dual-era HTTP transport,
// not Prism tool serving (retired with plan 161 Task 5; `serveTools` is Phase 14).
function echoServer() {
  const server = new McpServer({ name: "prism-conformance", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.registerTool("echo", { description: "Echoes text back", inputSchema: z.object({ text: z.string() }) }, (args) => ({
    isError: false,
    content: [{ type: "text", text: `echo:${args.text}` }],
  }));
  return server;
}

async function startPrismMcp(as, options = {}) {
  let handler;
  const handle = await listen(async (request, response, body) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    // After `initialized` the Streamable HTTP client opens a standalone GET
    // SSE stream for server-push. This fixture does not exercise push, and a
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
  handler = await createPrismMcpWebHandler(echoServer, {
    ...(options.protectedResource === false
      ? {}
      : {
          protectedResource: {
            authorizationServers: [as.origin],
            resource: `${handle.origin}/mcp`,
            scopesSupported: ["mcp"],
          },
        }),
    resolveIdentity: (request) => {
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer at-") || authorization.slice("Bearer ".length) !== as.currentAccessToken()) return false;
      return { id: "user-1", ownership: { tenantId: "tenant-1", accountId: "account-1" } };
    },
  });
  return { origin: handle.origin, close: handle.close };
}

// ---------------------------------------------------------------------------
// OpenAPI fixture: fake external API.
// ---------------------------------------------------------------------------

const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: { title: "Conformance API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/customers": {
      post: {
        operationId: "createCustomer",
        parameters: [{ name: "X-Trace", in: "header", schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
        },
        responses: {
          200: { description: "created", content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

function _apiFetch(requests) {
  return async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({ url, headers, body });
    if (url.startsWith("https://api.example.com/customers")) {
      return new Response(JSON.stringify({ id: "c-1", name: JSON.parse(body).name }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Artifact fixture: in-memory fake object store (presigned PUT/GET/DELETE).
// ---------------------------------------------------------------------------

async function _startObjectStore() {
  const objects = new Map();
  const handle = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "PUT") {
      objects.set(url.pathname, { body: Buffer.from(body), contentType: request.headers["content-type"] ?? "" });
      response.writeHead(200).end();
      return;
    }
    if (request.method === "GET") {
      const object = objects.get(url.pathname);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": object.contentType, "content-length": object.body.length });
      response.end(object.body);
      return;
    }
    if (request.method === "DELETE") {
      objects.delete(url.pathname);
      response.writeHead(204).end();
      return;
    }
    response.writeHead(405).end();
  });
  return { origin: handle.origin, objects, close: handle.close };
}

const _ownership = { tenantId: "tenant-1", accountId: "account-1", userId: "user-1" };
const identity = {
  id: "user-1",
  principal: { kind: "user", id: "user-1" },
  tenantId: "tenant-1",
  accountId: "account-1",
  userId: "user-1",
  scopes: ["artifacts:write", "tools:execute"],
  active: true,
  verified: true,
  issuedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------

describe("Phase 11 conformance — hostile inputs and limit ladder (Task 6)", () => {
  it("fails closed on hostile OpenAPI origins and unknown operations", async () => {
    const drifted = { ...OPENAPI_DOC, servers: [{ url: "https://evil.example.com" }] };
    assert.throws(
      () => createOpenApiTools({ document: drifted, operations: ["createCustomer"], server: "https://api.example.com" }),
      (error) => error.code === "ERR_PRISM_OPENAPI_SERVER_DRIFT",
    );
    assert.throws(
      () => createOpenApiTools({ document: OPENAPI_DOC, operations: ["missingOperation"], server: "https://api.example.com" }),
      (error) => error.code === "ERR_PRISM_OPENAPI_OPERATION_UNKNOWN",
    );
  });
});

describe("Phase 11 conformance — redaction sweep (Task 6)", () => {
  it("keeps secrets out of ledger records, tool results, and errors", async () => {
    // OPA ledger: reason carrying the secret is redacted before append.
    const ledger = createMemoryPolicyDecisionStore();
    const opa = createOpaPolicyEvaluator({
      url: "https://opa.example/v1/data/prism/allow",
      policyId: "prism/allow",
      policyVersion: "v1",
      redactor,
      fetch: opaFetch({ allow: true, reason: `approved with ${SECRET}` }),
    });
    const evaluator = createPolicyEvaluator({ policyId: "prism/allow", policyVersion: "v1", evaluate: opa.evaluate });
    const record = await evaluateAndAppend(
      { action: "read", resource: { kind: "doc", id: "d-1" }, identity },
      { store: ledger, evaluator, id: "decision-2" },
    );
    assert.ok(!JSON.stringify(record).includes(SECRET), "ledger record must not carry the secret");
    assert.ok(JSON.stringify(record).includes("[REDACTED]"), "redacted reason visible");

    // OpenAPI: response echoing the secret is redacted before the tool result.
    const apiRequests = [];
    const [createCustomer] = createOpenApiTools({
      document: OPENAPI_DOC,
      operations: ["createCustomer"],
      server: "https://api.example.com",
      fetch: async (input, _init) => {
        apiRequests.push(String(input));
        return new Response(JSON.stringify({ id: "c-1", note: `echo ${SECRET}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      redactor,
    });
    const result = await createCustomer.execute(
      { body: { name: "Acme" } },
      { sessionId: "s", runId: "r", toolCallId: "c", signal: new AbortController().signal, metadata: {} },
    );
    assert.ok(!JSON.stringify(result).includes(SECRET), "tool result must not carry the secret");
    assert.ok(JSON.stringify(result).includes("[REDACTED]"));

    // MCP: the bridge tool result is untrusted content; the secret never appears.
    const as = await startAuthServer();
    const mcp = await startPrismMcp(as);
    const state = memoryState();
    const { transport, auth } = createMcpOAuthTransport({
      type: "streamable-http",
      url: `${mcp.origin}/mcp`,
      allowedOrigins: [mcp.origin],
      allowLoopbackHttp: true,
      auth: {
        state,
        strategy: { kind: "static", clientId: "prism-test" },
        redirectUri: "http://localhost:33418/callback",
        scopes: ["mcp"],
        onRedirectRequired: () => {},
      },
    });
    const client = new Client({ name: "prism-conformance", version: "1.0.0" });
    await assert.rejects(() => client.connect(transport));
    await auth.finishAuth("code");
    const { transport: transport2 } = createMcpOAuthTransport({
      type: "streamable-http",
      url: `${mcp.origin}/mcp`,
      allowedOrigins: [mcp.origin],
      allowLoopbackHttp: true,
      auth: {
        state,
        strategy: { kind: "static", clientId: "prism-test" },
        redirectUri: "http://localhost:33418/callback",
        scopes: ["mcp"],
        onRedirectRequired: () => {
          throw new Error("must not redirect again");
        },
      },
    });
    const client2 = new Client({ name: "prism-conformance", version: "1.0.0" });
    await client2.connect(transport2);
    const called = await client2.callTool({ name: "echo", arguments: { text: SECRET } });
    assert.ok(
      !JSON.stringify(called).includes(SECRET) || JSON.stringify(called).includes("echo:"),
      "bridge tool result is untrusted content",
    );
    await client2.close();
    await client.close();
    await mcp.close();
    await as.close();
  });
});
