#!/usr/bin/env node
/**
 * Release 0.0.28 network-free benchmark (plan 011 Task 6).
 * Ceilings from the Task 0 freeze (p95Targets): OIDC verify cache hit ≤ 5 ms,
 * OIDC verify cache miss ≤ 100 ms, OPA policy decision ≤ 100 ms, MCP OAuth
 * discovery round trip ≤ 250 ms, MCP OAuth handshake ≤ 2000 ms, OpenAPI tool
 * call ≤ 1000 ms, artifact 1 MiB put ≤ 2000 ms, artifact presign ≤ 100 ms.
 * Everything runs against in-process fakes and loopback fixture servers;
 * nothing leaves the machine.
 *
 * Usage: node scripts/benchmark.mjs --scenario phase11-auth
 */
import { createHash, subtle } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { createOidcIdentityVerifier } from "@arnilo/prism-core/credentials/node/oidc";
import { createOpaPolicyEvaluator } from "@arnilo/prism-core/governance/policy";
import { createMcpOAuthTransport, createPrismMcpServer, createPrismMcpWebHandler } from "@arnilo/prism-mcp";
import { createOpenApiTools } from "@arnilo/prism-openapi-tools";
import { createS3ArtifactBodyStore } from "@arnilo/prism-server/artifact-bodies";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 20);
const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);

const ceilingsMs = {
  oidcVerifyCacheHitMs: 5,
  oidcVerifyCacheMissMs: 100,
  policyDecisionMs: 100,
  mcpDiscoveryRoundTripMs: 250,
  mcpAuthHandshakeMs: 2000,
  openapiToolCallMs: 1000,
  artifactPut1MiBMs: 2000,
  artifactPresignMs: 100,
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(name, samples) {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    operations: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    throughputPerSecond: Number((samples.length / (totalMs / 1000)).toFixed(1)),
  };
}

const servers = [];
function listen(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => handler(request, response, body));
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function timed(samples, fn) {
  const start = performance.now();
  await fn();
  samples.push(performance.now() - start);
}

// ---------------------------------------------------------------------------
// OIDC fixture: in-process RSA key served through a fake JWKS fetch.
// ---------------------------------------------------------------------------

async function makeRsaKeys() {
  return subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function signToken(key, claims, nowSeconds) {
  const header = { alg: "RS256", typ: "JWT", kid: "bench-key" };
  const payload = { iss: "https://issuer.example", aud: "prism", iat: nowSeconds - 10, exp: nowSeconds + 3600, ...claims };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = await subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function jwksFetch(jwk) {
  return async (input) => {
    if (String(input) === "https://issuer.example/jwks") {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "bench-key", use: "sig", alg: "RS256" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

const mapClaims = (claims) => ({
  tenantId: String(claims.tenant_id),
  principal: { kind: "user", id: String(claims.sub) },
  scopes: ["bench:execute"],
  userId: String(claims.sub),
});

// ---------------------------------------------------------------------------
// MCP OAuth fixtures: fake authorization server + Prism MCP server.
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
    clear: async () => data.clear(),
  };
}

async function startAuthServer() {
  let counter = 0;
  let current;
  const handle = await listen((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const origin = `http://${request.headers.host}`;
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      });
      return;
    }
    if (url.pathname === "/token") {
      current = `at-${++counter}`;
      sendJson(response, 200, {
        access_token: current,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `rt-${counter}`,
        scope: "mcp",
      });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });
  return { origin: handle.origin, currentAccessToken: () => current, close: handle.close };
}

const echoTool = {
  name: "echo",
  description: "Echoes text back",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  effect: { kind: "none", idempotency: "none" },
  async execute(args, context) {
    return {
      toolCallId: context.toolCallId,
      name: "echo",
      content: [{ type: "text", text: `echo:${String(args.text)}` }],
      metadata: { trust: "untrusted_external" },
    };
  },
};

async function startPrismMcp(as) {
  let handler;
  const handle = await listen(async (request, response, body) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    // Decline the standalone GET SSE stream (see phase11 conformance fixture).
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
        name: "prism-benchmark",
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
        if (authorization.slice("Bearer ".length) !== as.currentAccessToken()) return false;
        return { id: "bench-user", ownership: { tenantId: "tenant-1" } };
      },
    },
  );
  return { origin: handle.origin, close: handle.close };
}

function oauthTransportConfig(mcpOrigin, state) {
  return {
    type: "streamable-http",
    url: `${mcpOrigin}/mcp`,
    allowedOrigins: [mcpOrigin],
    allowLoopbackHttp: true,
    auth: {
      state,
      strategy: { kind: "static", clientId: "prism-bench" },
      redirectUri: "http://localhost:33418/callback",
      scopes: ["mcp"],
      onRedirectRequired: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAPI fixture: fake external API.
// ---------------------------------------------------------------------------

const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: { title: "Benchmark API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/customers/{id}": {
      get: {
        operationId: "getCustomer",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
  },
};

function apiFetch() {
  return async (input) => {
    if (String(input).startsWith("https://api.example.com/customers/")) {
      return new Response(JSON.stringify({ id: "c-1", name: "Bench" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Object-store fixture: in-memory S3-compatible server (signatures unchecked).
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
  return { origin: handle.origin, close: handle.close };
}

// ---------------------------------------------------------------------------
// Seams.
// ---------------------------------------------------------------------------

const oidcHitLatencies = [];
const oidcMissLatencies = [];
const policyLatencies = [];
const discoveryLatencies = [];
const handshakeLatencies = [];
const openapiLatencies = [];
const putLatencies = [];
const presignLatencies = [];

const policyIdentity = {
  tenantId: "tenant-1",
  principal: { kind: "user", id: "bench-user" },
  verified: true,
  issuedAt: new Date().toISOString(),
  scopes: ["bench:execute"],
};

// OIDC: one verifier with a warm JWKS cache (hits), one whose clock advances
// past the TTL on every verify (misses force a bounded refetch).
const keys = await makeRsaKeys();
const jwk = await subtle.exportKey("jwk", keys.publicKey);
const token = await signToken(keys.privateKey, { sub: "bench-user", tenant_id: "tenant-1" }, Math.floor(Date.now() / 1000));
const hitVerifier = createOidcIdentityVerifier({
  issuer: "https://issuer.example",
  audience: "prism",
  jwksUrl: "https://issuer.example/jwks",
  mapClaims,
  fetch: jwksFetch(jwk),
});
let missClock = Date.now();
const missVerifier = createOidcIdentityVerifier({
  issuer: "https://issuer.example",
  audience: "prism",
  jwksUrl: "https://issuer.example/jwks",
  mapClaims,
  fetch: jwksFetch(jwk),
  limits: { jwksCacheTtlMs: 1 },
  now: () => (missClock += 1000),
});
await hitVerifier.verify(token);
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => hitVerifier.verify(token);
  if (i < WARMUPS) await run();
  else await timed(oidcHitLatencies, run);
}
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => missVerifier.verify(token);
  if (i < WARMUPS) await run();
  else await timed(oidcMissLatencies, run);
}

// OPA: fake evaluator endpoint answering allow.
const opa = createOpaPolicyEvaluator({
  url: "https://opa.example/v1/data/prism/allow",
  policyId: "prism/allow",
  policyVersion: "2026-08-08",
  fetch: async () =>
    new Response(JSON.stringify({ result: { allow: true } }), { status: 200, headers: { "content-type": "application/json" } }),
});
const policyRequest = { action: "bench:execute", resource: { kind: "tool", id: "echo" }, identity: policyIdentity };
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => opa.evaluate(policyRequest);
  if (i < WARMUPS) await run();
  else await timed(policyLatencies, run);
}

// MCP OAuth: discovery round trip (ensureAuthorized up to redirect) and the
// full interactive handshake against loopback fixture servers.
const as = await startAuthServer();
const mcp = await startPrismMcp(as);
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = async () => {
    const { auth } = createMcpOAuthTransport(oauthTransportConfig(mcp.origin, memoryState()));
    await auth.ensureAuthorized();
  };
  if (i < WARMUPS) await run();
  else await timed(discoveryLatencies, run);
}
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = async () => {
    const state = memoryState();
    const { transport, auth } = createMcpOAuthTransport(oauthTransportConfig(mcp.origin, state));
    const client = new Client({ name: "prism-benchmark", version: "1.0.0" });
    await client.connect(transport).catch(() => {});
    await auth.finishAuth("bench-code");
    const { transport: authorized } = createMcpOAuthTransport(oauthTransportConfig(mcp.origin, state));
    const session = new Client({ name: "prism-benchmark", version: "1.0.0" });
    await session.connect(authorized);
    await session.close();
    await client.close();
  };
  if (i < WARMUPS) await run();
  else await timed(handshakeLatencies, run);
}

// OpenAPI: one compiled GET tool, executed against the fake API.
const [getCustomer] = createOpenApiTools({
  document: OPENAPI_DOC,
  operations: ["getCustomer"],
  server: "https://api.example.com",
  fetch: apiFetch(),
});
const toolContext = { sessionId: "bench", runId: "run", toolCallId: "call", signal: new AbortController().signal, metadata: {} };
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => getCustomer.execute({ id: "c-1" }, toolContext);
  if (i < WARMUPS) await run();
  else await timed(openapiLatencies, run);
}

// Artifacts: 1 MiB body into the fake object store + presign round trip.
const store = await startObjectStore();
const bodies = createS3ArtifactBodyStore({
  endpoint: store.origin,
  bucket: "bench-bucket",
  credentials: () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "bench-secret" }),
});
const body = new Uint8Array(1024 * 1024).fill(7);
const bodyRef = {
  tenantId: "tenant-1",
  threadId: "thread-bench",
  artifactId: "artifact-bench",
  version: 1,
  mime: "application/octet-stream",
  size: body.byteLength,
  hash: sha256Hex(body),
};
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => bodies.put({ ...bodyRef, version: i + 1 }, body);
  if (i < WARMUPS) await run();
  else await timed(putLatencies, run);
}
for (let i = 0; i < WARMUPS + ITERATIONS; i += 1) {
  const run = () => bodies.presign(bodyRef, { ttlMs: 600_000 });
  if (i < WARMUPS) await run();
  else await timed(presignLatencies, run);
}

await Promise.all([store.close(), mcp.close(), as.close()]);

const results = [
  summarize("oidcVerifyCacheHitMs", oidcHitLatencies),
  summarize("oidcVerifyCacheMissMs", oidcMissLatencies),
  summarize("policyDecisionMs", policyLatencies),
  summarize("mcpDiscoveryRoundTripMs", discoveryLatencies),
  summarize("mcpAuthHandshakeMs", handshakeLatencies),
  summarize("openapiToolCallMs", openapiLatencies),
  summarize("artifactPut1MiBMs", putLatencies),
  summarize("artifactPresignMs", presignLatencies),
];

const failures = results.filter((result) => result.p95Ms > ceilingsMs[result.name]);
if (failures.length) {
  throw new Error(`benchmark ceiling exceeded:\n${failures.map((f) => `  - ${f.name} p95 ${f.p95Ms} > ${ceilingsMs[f.name]}`).join("\n")}`);
}

const report = JSON.stringify(
  {
    version: "0.0.28",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: process.env.PRISM_BENCH_CPU ?? "local",
      memoryBytes: Number(process.env.PRISM_BENCH_MEMORY_BYTES ?? 0) || undefined,
      network: false,
    },
    fixture: { warmups: WARMUPS, measuredOperations: ITERATIONS },
    ceilingsMs,
    results,
  },
  null,
  2,
);
process.stdout.write(`${report}\n`, () => process.exit(0));
