/**
 * Phase 12 packed-install enterprise journey (plan 012 Task 3).
 * Runs INSIDE a fresh consumer that installed @arnilo tarballs (npm pack),
 * so every import below resolves from the consumer's node_modules — this
 * file itself must never import workspace paths.
 *
 * Composed journey using only public exports:
 *   OIDC identity → OPA policy decision (durable ledger) → agent run with
 *   durable events (memory event source, or PostgreSQL when
 *   PRISM_TEST_POSTGRES_URL is set) → batched approval → OpenAPI side effect
 *   with idempotency → artifact upload + signed delivery.
 * Failure injections: policy deny and artifact hash mismatch fail closed.
 *
 * Run: node fixtures/e2e-enterprise-journey.mjs (inside the packed consumer)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  createAgent,
  createMemoryAgentEventSource,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createSecretRedactor,
  createToolRegistry,
  dispatchToolCall,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";
import { createOidcIdentityVerifier } from "@arnilo/prism-credentials-node/oidc";
import { createOpenApiTools } from "@arnilo/prism-openapi-tools";
import { createMemoryPolicyDecisionStore, createOpaPolicyEvaluator, createPolicyEvaluator, evaluateAndAppend } from "@arnilo/prism-policy";
import { createArtifactService } from "@arnilo/prism-server";
import { createS3ArtifactBodyStore } from "@arnilo/prism-server/artifact-bodies";

const SECRET = "packed-journey-secret";
const redactor = createSecretRedactor([SECRET]);

// --- in-process fixtures (no external network) -----------------------------

function listen(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => handler(request, response, body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function _sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function makeRsaKeys() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

async function signToken(key, claims) {
  const header = { alg: "RS256", typ: "JWT", kid: "key-1" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://issuer.example",
    aud: "prism",
    iat: now - 10,
    exp: now + 3600,
    ...claims,
  };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function jwksFetch(publicKey) {
  return async (input) => {
    if (String(input) === "https://issuer.example/jwks") {
      const jwk = await crypto.subtle.exportKey("jwk", publicKey);
      return new Response(
        JSON.stringify({
          keys: [{ ...jwk, kid: "key-1", use: "sig", alg: "RS256" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

function opaFetch(decision) {
  return async (input) => {
    if (String(input).startsWith("https://opa.example/v1/data/prism/allow")) {
      return new Response(JSON.stringify({ result: decision }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: { title: "Journey API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/customers": {
      post: {
        operationId: "createCustomer",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "created",
            content: { "application/json": { schema: { type: "object" } } },
          },
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

async function startObjectStore() {
  const objects = new Map();
  const handle = await listen((request, response, body) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "PUT") {
      objects.set(url.pathname, {
        body: Buffer.from(body),
        contentType: request.headers["content-type"] ?? "application/octet-stream",
      });
      response.writeHead(200).end();
      return;
    }
    if (request.method === "GET") {
      const object = objects.get(url.pathname);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": object.contentType,
        "content-length": object.body.length,
      });
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

const ownership = {
  tenantId: "tenant-journey",
  accountId: "account-1",
  userId: "user-1",
};

// --- journey ---------------------------------------------------------------

const started = Date.now();

// 1. OIDC identity: verify a real RS256 token against an in-process JWKS.
const keys = await makeRsaKeys();
const verifier = createOidcIdentityVerifier({
  issuer: "https://issuer.example",
  audience: "prism",
  jwksUrl: "https://issuer.example/jwks",
  mapClaims: (claims) => ({
    tenantId: String(claims.tenant_id),
    accountId: String(claims.account_id),
    principal: { kind: "user", id: String(claims.sub) },
    scopes: ["artifacts:write", "tools:execute"],
    userId: String(claims.sub),
  }),
  fetch: jwksFetch(keys.publicKey),
});
const token = await signToken(keys.privateKey, {
  sub: "user-1",
  tenant_id: "tenant-journey",
  account_id: "account-1",
});
const verified = await verifier.verify(token);
assert.equal(verified.tenantId, "tenant-journey");
assert.equal(verified.userId, "user-1");
assert.ok(verified.scopes.includes("artifacts:write"));

// 2. OPA policy decision appended to the durable ledger; deny fails closed.
const ledger = createMemoryPolicyDecisionStore();
const opa = createOpaPolicyEvaluator({
  url: "https://opa.example/v1/data/prism/allow",
  policyId: "prism/allow",
  policyVersion: "2026-08-09",
  redactor,
  fetch: opaFetch({ allow: true }),
});
const evaluator = createPolicyEvaluator({
  policyId: "prism/allow",
  policyVersion: "2026-08-09",
  evaluate: opa.evaluate,
});
const record = await evaluateAndAppend(
  {
    action: "artifacts:attach",
    resource: { kind: "artifact", id: "art-1" },
    identity: verified,
  },
  { store: ledger, evaluator, id: "decision-1" },
);
assert.equal(record.outcome, "allow");
const denyOpa = createOpaPolicyEvaluator({
  url: "https://opa.example/v1/data/prism/allow",
  policyId: "prism/allow",
  policyVersion: "2026-08-09",
  redactor,
  fetch: opaFetch({ allow: false }),
});
const denyRecord = await evaluateAndAppend(
  {
    action: "artifacts:attach",
    resource: { kind: "artifact", id: "art-deny" },
    identity: verified,
  },
  {
    store: ledger,
    evaluator: createPolicyEvaluator({
      policyId: "prism/allow",
      policyVersion: "2026-08-09",
      evaluate: denyOpa.evaluate,
    }),
    id: "decision-deny",
  },
);
assert.equal(denyRecord.outcome, "deny");
assert.ok(!String(JSON.stringify(record)).includes(SECRET), "policy records redact secrets");

// 3. Agent run with durable events + 4. batched approval.
const eventSource = await (async () => {
  if (process.env.PRISM_TEST_POSTGRES_URL !== undefined) {
    // createPostgresPersistence applies the migration contract then exposes
    // the durable event source; the protected leg runs against real pg16.
    const { Pool } = await import("pg");
    const { createPostgresPersistence } = await import("@arnilo/prism-session-store-postgres");
    const pool = new Pool({
      connectionString: process.env.PRISM_TEST_POSTGRES_URL,
    });
    const persistence = await createPostgresPersistence({
      pool,
      schema: `journey_${Date.now().toString(36)}`,
      eventCursorSecret: "packed-journey-cursor-secret",
    });
    return {
      source: persistence.events,
      close: () => persistence.close().finally(() => pool.end()),
    };
  }
  return { source: createMemoryAgentEventSource(), close: async () => {} };
})();
const checkpoints = createMemoryCheckpointStore();
const executed = [];
let turn = 0;
const agent = createAgent({
  id: "packed-enterprise",
  model: { provider: "mock", model: "demo" },
  store: createMemorySessionStore(),
  provider: {
    id: "mock",
    // Durable loop runs the provider once per resume; turn 1 proposes the
    // batched tool calls (interrupted for approval), turn 2 completes the run.
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: toolCallContent("c1", "write", { i: 1 }),
        };
        yield {
          type: "tool_call",
          call: toolCallContent("c2", "write", { i: 2 }),
        };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  },
  loop: {
    name: "journey",
    revision: "1",
    snapshot: () => ({ n: executed.length }),
    restore: () => {},
    async run(ctx) {
      const { calls } = await ctx.generate(await ctx.assemble([]));
      await ctx.chargeToolRound?.(calls);
      for (const call of calls) await ctx.dispatchToolCall(call);
      for (const call of calls) {
        // Deterministic timestamp: the durable loop runs twice (interrupt + resume)
        // and re-appends the same event ids; identical records dedupe, differing
        // timestamps would be rejected as a foreign/duplicate input.
        await eventSource.source.append({
          id: `evt-${call.id}`,
          sessionId: ctx.sessionId,
          runId: ctx.runId,
          type: "tool_execution_started",
          timestamp: "2026-08-09T00:00:00.000Z",
          event: {
            type: "tool_execution_started",
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            call,
          },
          redacted: true,
          ...ownership,
        });
      }
    },
  },
  tools: [
    {
      name: "write",
      parameters: {},
      execute: (args, context) => {
        executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
        return { toolCallId: context.toolCallId, name: "write", value: "ok" };
      },
    },
  ],
});
const first = await agent.createSession({ id: "journey-s" }).run("go", {
  runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
});
assert.equal(first.status, "suspended");
assert.equal(first.interruption.pendingDecisions.length, 2);
const done = await resumeAgentRun(
  agent,
  { runId: first.runId, sessionId: first.sessionId },
  {
    expectedVersion: first.runState.version,
    decisions: first.interruption.pendingDecisions.map((d) => ({
      approvalId: d.approvalId,
      outcome: "allow_once",
    })),
  },
  { checkpoints, definitionRevision: "1" },
);
assert.equal(done.status, "succeeded");
assert.equal(executed.length, 2, "both batched approvals executed");
const page = await eventSource.source.page({
  ownership,
  sessionId: "journey-s",
  runId: first.runId,
  limit: 10,
});
assert.equal(page.items.length, 2, "durable events readable back");
assert.deepEqual(
  page.items.map((item) => item.record.id),
  ["evt-c1", "evt-c2"],
  "event ordering preserved",
);
const otherTenantPage = await eventSource.source.page({
  ownership: { tenantId: "tenant-other" },
  sessionId: "journey-s",
  runId: first.runId,
  limit: 10,
});
assert.equal(otherTenantPage.items.length, 0, "tenant isolation enforced on durable reads");
await eventSource.close();

// 5. OpenAPI side effect with idempotency: replay never re-POSTs.
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
await dispatchToolCall({
  call: {
    id: "call-1",
    name: "createCustomer",
    arguments: { body: { name: "Acme" } },
  },
  registry,
  context: {
    sessionId: "s-1",
    runId: "r-1",
    toolCallId: "call-1",
    signal: new AbortController().signal,
    metadata: {},
  },
  effectStore,
  identity: verified,
  redactor,
});
assert.equal(apiRequests.length, 1);
assert.ok(apiRequests[0].headers.get("idempotency-key"), "core idempotency key forwarded as a header");
const replayed = await dispatchToolCall({
  call: {
    id: "call-1",
    name: "createCustomer",
    arguments: { body: { name: "Acme" } },
  },
  registry,
  context: {
    sessionId: "s-1",
    runId: "r-1",
    toolCallId: "call-1",
    signal: new AbortController().signal,
    metadata: {},
  },
  effectStore,
  identity: verified,
  redactor,
});
assert.equal(apiRequests.length, 1, "replay must not re-POST the side effect");
assert.ok(JSON.stringify(replayed).includes("UNTRUSTED EXTERNAL API CONTENT"));

// 6. Artifact upload + signed delivery; hash mismatch fails closed.
const store = await startObjectStore();
const bodies = createS3ArtifactBodyStore({
  endpoint: store.origin,
  bucket: "prism-bucket",
  credentials: () => ({
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  }),
});
const body = new TextEncoder().encode("packed artifact body");
const hash = createHash("sha256").update(body).digest("hex");
const service = createArtifactService(createMemoryCheckpointStore(), {
  linkSecret: "delivery-link-key-material",
  redactor,
  bodies,
});
const artifact = await service.attach({
  ownership,
  identity: verified,
  id: "art-1",
  threadId: "thread-1",
  uri: "https://blob.example/art-1",
  mime: "text/plain",
  hash: `sha256:${hash}`,
  size: body.byteLength,
});
await bodies.put(
  {
    ...ownership,
    artifactId: artifact.id,
    threadId: "thread-1",
    version: 1,
    mime: "text/plain",
    size: body.byteLength,
    hash,
  },
  body,
);
await service.approve({
  ownership,
  identity: verified,
  threadId: "thread-1",
  artifactId: artifact.id,
  version: 1,
});
const { link, url } = await service.deliveryLink({
  ownership,
  threadId: "thread-1",
  artifactId: artifact.id,
});
assert.ok(link, "signed delivery link present");
assert.ok(url.startsWith(store.origin), "presigned URL points at the object store");
await assert.rejects(
  bodies.put(
    {
      ...ownership,
      artifactId: "art-bad",
      threadId: "thread-1",
      version: 1,
      mime: "text/plain",
      size: body.byteLength,
      hash: "0".repeat(64),
    },
    body,
  ),
  (error) => error instanceof Error,
  "hash mismatch fails closed",
);
const downloaded = await bodies.get(
  {
    ...ownership,
    artifactId: artifact.id,
    threadId: "thread-1",
    version: 1,
    mime: "text/plain",
    size: body.byteLength,
    hash,
  },
  { signal: new AbortController().signal },
);
const reader = downloaded.getReader();
const chunks = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
assert.equal(Buffer.concat(chunks).toString(), "packed artifact body");
assert.equal(store.objects.size, 1, "exactly one object stored");
await store.close();

console.log(`ENTERPRISE JOURNEY OK in ${Date.now() - started}ms`);
