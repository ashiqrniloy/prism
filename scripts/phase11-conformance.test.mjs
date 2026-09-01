/**
 * Phase 11 network-free conformance (plan 011 Task 6).
 * Cross-cuts the Task 0 freeze matrices through the real adapters: OIDC/JWKS
 * identity verification (@arnilo/prism-credentials-node/oidc), OPA policy
 * evaluation with the durable decision ledger (@arnilo/prism-policy/opa),
 * MCP OAuth client/server wiring (@arnilo/prism-mcp), OpenAPI tools
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
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import {
  ArtifactBodyStoreError,
  createMemoryCheckpointStore,
  createMemoryToolEffectStore,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  IdentityError,
} from "@arnilo/prism";
import { createOidcIdentityVerifier } from "@arnilo/prism-core/credentials/node/oidc";
import {
  createMemoryPolicyDecisionStore,
  createOpaPolicyEvaluator,
  createPolicyEvaluator,
  evaluateAndAppend,
} from "@arnilo/prism-core/governance/policy";
import { createArtifactService, createS3ArtifactBodyStore } from "@arnilo/prism-core/runtime/server";
import { createMcpOAuthTransport, createPrismMcpServer, createPrismMcpWebHandler } from "@arnilo/prism-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createOpenApiTools } from "../packages/prism-coding-tools/dist/openapi/index.js";

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

async function makeRsaKeys() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function signToken(key, claims) {
  const header = { alg: "RS256", typ: "JWT", kid: "key-1" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://issuer.example", aud: "prism", iat: now - 10, exp: now + 3600, ...claims };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function jwksFetch(publicKey) {
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

const echoTool = {
  name: "echo",
  description: "Echoes text back",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  effect: { kind: "none", idempotency: "none" },
  async execute(args, context) {
    const text = args.text;
    return {
      toolCallId: context.toolCallId,
      name: "echo",
      content: [{ type: "text", text: `echo:${String(text)}` }],
      metadata: { trust: "untrusted_external" },
    };
  },
};

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
  handler = await createPrismMcpWebHandler(
    () =>
      createPrismMcpServer({
        name: "prism-conformance",
        version: "1.0.0",
        tools: [echoTool],
        authorize: () => ({ allowed: true }),
      }),
    {
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
    },
  );
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

function apiFetch(requests) {
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

async function startObjectStore() {
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

const ownership = { tenantId: "tenant-1", accountId: "account-1", userId: "user-1" };
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

describe("Phase 11 conformance — composed enterprise journey (Task 6)", () => {
  it("OIDC identity → OPA ledger → MCP OAuth tool → OpenAPI side effect → artifact body + signed delivery", async () => {
    // 1. OIDC: verify a real RS256 token against an in-process JWKS.
    const keys = await makeRsaKeys();
    const verifier = createOidcIdentityVerifier({
      issuer: "https://issuer.example",
      audience: "prism",
      jwksUrl: "https://issuer.example/jwks",
      mapClaims: (claims) => ({
        tenantId: String(claims.tenant_id),
        principal: { kind: "user", id: String(claims.sub) },
        scopes: ["artifacts:write", "tools:execute"],
        userId: String(claims.sub),
      }),
      fetch: jwksFetch(keys.publicKey),
    });
    const token = await signToken(keys.privateKey, { sub: "user-1", tenant_id: "tenant-1" });
    const verified = await verifier.verify(token);
    assert.equal(verified.tenantId, "tenant-1");
    assert.equal(verified.userId, "user-1");
    assert.ok(verified.scopes.includes("artifacts:write"));

    // 2. OPA: allow decision through the adapter, appended to the durable ledger.
    const ledger = createMemoryPolicyDecisionStore();
    const opa = createOpaPolicyEvaluator({
      url: "https://opa.example/v1/data/prism/allow",
      policyId: "prism/allow",
      policyVersion: "2026-08-08",
      redactor,
      fetch: opaFetch({ allow: true }),
    });
    const evaluator = createPolicyEvaluator({ policyId: "prism/allow", policyVersion: "2026-08-08", evaluate: opa.evaluate });
    const record = await evaluateAndAppend(
      { action: "artifacts:attach", resource: { kind: "artifact", id: "art-1" }, identity },
      { store: ledger, evaluator, id: "decision-1" },
    );
    assert.equal(record.outcome, "allow");
    assert.equal(record.policyId, "prism/allow");
    const page = await ledger.query({ ...ownership, limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, "decision-1");

    // 3. MCP OAuth: interactive PKCE against the fake AS, then a bridge tool call.
    const as = await startAuthServer();
    const mcp = await startPrismMcp(as);
    let authorizationUrl;
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
        onRedirectRequired: (url) => {
          authorizationUrl = url;
        },
      },
    });
    const client = new Client({ name: "prism-conformance", version: "1.0.0" });
    await assert.rejects(() => client.connect(transport));
    assert.ok(authorizationUrl, "interactive authorization required");
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("resource"), `${mcp.origin}/mcp`, "RFC 8707 resource on the authorize URL");
    await auth.finishAuth("conformance-code");
    assert.equal(as.tokenRequests.length, 1);
    assert.equal(as.tokenRequests[0].grantType, "authorization_code");
    assert.equal(as.tokenRequests[0].resource, `${mcp.origin}/mcp`, "RFC 8707 resource on the token request");
    // The transport cannot restart after the interrupted connect; a fresh
    // transport over the same persisted state completes the flow.
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
    const tools = await client2.listTools();
    assert.equal(tools.tools.length, 1);
    assert.equal(tools.tools[0].name, "echo");
    const called = await client2.callTool({ name: "echo", arguments: { text: "hello" } });
    assert.ok(JSON.stringify(called).includes("echo:hello"));
    await client2.close();
    await client.close();
    await mcp.close();
    await as.close();
    // 4. OpenAPI: side-effect tool with core-managed idempotency + redaction.
    const apiRequests = [];
    const [createCustomer] = createOpenApiTools({
      document: OPENAPI_DOC,
      operations: ["createCustomer"],
      server: "https://api.example.com",
      fetch: apiFetch(apiRequests),
      redactor,
      idempotencyKeyHeader: true,
    });
    assert.equal(createCustomer.effect.kind, "external_mutation");
    assert.equal(createCustomer.effect.idempotency, "required");
    const effectStore = createMemoryToolEffectStore();
    const registry = createToolRegistry([createCustomer]);
    const result = await dispatchToolCall({
      call: { id: "call-1", name: "createCustomer", arguments: { body: { name: "Acme" } } },
      registry,
      context: { sessionId: "s-1", runId: "r-1", toolCallId: "call-1", signal: new AbortController().signal, metadata: {} },
      effectStore,
      identity,
      redactor,
    });
    assert.equal(apiRequests.length, 1);
    assert.equal(apiRequests[0].url, "https://api.example.com/customers");
    assert.ok(apiRequests[0].headers.get("idempotency-key"), "core idempotency key forwarded as a header");
    assert.ok(JSON.stringify(result).includes("UNTRUSTED EXTERNAL API CONTENT"));
    assert.ok(!JSON.stringify(result).includes(SECRET));

    // 5. Artifact: body stored in the fake object store, delivered via presigned URL.
    const store = await startObjectStore();
    const bodies = createS3ArtifactBodyStore({
      endpoint: store.origin,
      bucket: "prism-bucket",
      credentials: () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" }),
    });
    const body = new TextEncoder().encode("artifact body content");
    const hash = createHash("sha256").update(body).digest("hex");
    const service = createArtifactService(createMemoryCheckpointStore(), {
      linkSecret: "delivery-link-key-material",
      redactor,
      bodies,
    });
    const artifact = await service.attach({
      ownership,
      identity,
      id: "art-1",
      threadId: "thread-1",
      uri: "https://blob.example/art-1",
      mime: "text/plain",
      hash: `sha256:${hash}`,
      size: body.byteLength,
    });
    await bodies.put(
      { ...ownership, artifactId: artifact.id, threadId: "thread-1", version: 1, mime: "text/plain", size: body.byteLength, hash },
      body,
    );
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: artifact.id, version: 1 });
    const { link, token: deliveryToken, url } = await service.deliveryLink({ ownership, threadId: "thread-1", artifactId: artifact.id });
    assert.ok(link, "signed delivery link present");
    assert.equal(deliveryToken.version, 1);
    assert.ok(url, "presigned body URL present when a body store is wired");
    assert.ok(url.startsWith(store.origin), "presigned URL points at the object store");
    const downloaded = await bodies.get(
      { ...ownership, artifactId: artifact.id, threadId: "thread-1", version: 1, mime: "text/plain", size: body.byteLength, hash },
      { signal: new AbortController().signal },
    );
    const reader = downloaded.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    assert.equal(Buffer.concat(chunks).toString(), "artifact body content");
    assert.equal(store.objects.size, 1, "exactly one object stored");
    assert.ok(!JSON.stringify(artifact).includes("prism-bucket"), "bucket internals never enter artifact records");
    await store.close();
  });
});

describe("Phase 11 conformance — adapter-absent baseline (Task 6)", () => {
  it("core behavior is unchanged when no Phase 11 adapter is wired", async () => {
    // Artifact service without bodies: delivery link carries no url.
    const service = createArtifactService(createMemoryCheckpointStore(), { linkSecret: "delivery-link-key-material", redactor });
    const record = await service.attach({
      ownership,
      identity,
      threadId: "thread-1",
      uri: "https://blob.example/x",
      mime: "text/plain",
      hash: "sha256:aaa",
    });
    const { link, url } = await service.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.ok(link);
    assert.equal(url, undefined, "no presigned url without a body store");

    // MCP web handler without protectedResource: no WWW-Authenticate challenge.
    const as = await startAuthServer();
    const mcp = await startPrismMcp(as, { protectedResource: false });
    const response = await fetch(`${mcp.origin}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), null, "no OAuth challenge without protectedResource");
    await mcp.close();
    await as.close();

    // Policy evaluator absent: no ledger records are created.
    const ledger = createMemoryPolicyDecisionStore();
    const page = await ledger.query({ ...ownership, limit: 10 });
    assert.equal(page.items.length, 0);
  });
});

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

  it("rejects tokens, decisions, documents, and bodies above the frozen caps", async () => {
    // OIDC: claims beyond maxClaims fail closed.
    const keys = await makeRsaKeys();
    const verifier = createOidcIdentityVerifier({
      issuer: "https://issuer.example",
      audience: "prism",
      jwksUrl: "https://issuer.example/jwks",
      mapClaims: (claims) => ({ tenantId: String(claims.tenant_id), principal: { kind: "user", id: String(claims.sub) }, scopes: [] }),
      fetch: jwksFetch(keys.publicKey),
      limits: { maxClaims: 4 },
    });
    const claims = { sub: "user-1", tenant_id: "tenant-1", a: 1, b: 2, c: 3 };
    const token = await signToken(keys.privateKey, claims);
    await assert.rejects(
      () => verifier.verify(token),
      (error) => error instanceof IdentityError && error.reason === "ERR_PRISM_OIDC_CLAIMS_BOUNDS",
    );

    // OPA: response beyond maxResponseBytes fails closed to deny.
    const opa = createOpaPolicyEvaluator({
      url: "https://opa.example/v1/data/prism/allow",
      policyId: "prism/allow",
      policyVersion: "v1",
      maxResponseBytes: 64,
      fetch: opaFetch({ allow: true, padding: "x".repeat(1024) }),
    });
    const result = await opa.evaluate({ action: "read", resource: { kind: "doc", id: "d-1" }, identity });
    assert.equal(result.outcome, "deny", "oversize OPA response fails closed to deny");

    // OpenAPI: document beyond maxDocumentBytes fails closed at setup.
    assert.throws(
      () =>
        createOpenApiTools({
          document: JSON.stringify(OPENAPI_DOC),
          operations: ["createCustomer"],
          server: "https://api.example.com",
          limits: { maxDocumentBytes: 64 },
        }),
      (error) => error.code === "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS",
    );

    // Artifact: body beyond maxBodyBytes fails closed before any upload.
    const store = await startObjectStore();
    const bodies = createS3ArtifactBodyStore({
      endpoint: store.origin,
      bucket: "prism-bucket",
      credentials: () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" }),
      limits: { maxBodyBytes: 8 },
    });
    const big = new TextEncoder().encode("0123456789");
    const ref = {
      ...ownership,
      artifactId: "art-1",
      threadId: "thread-1",
      version: 1,
      mime: "text/plain",
      size: big.byteLength,
      hash: createHash("sha256").update(big).digest("hex"),
    };
    await assert.rejects(
      () => bodies.put(ref, big),
      (error) => error instanceof ArtifactBodyStoreError && error.reason === "STORE",
    );
    assert.equal(store.objects.size, 0, "no upload reached the store");
    await store.close();
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
