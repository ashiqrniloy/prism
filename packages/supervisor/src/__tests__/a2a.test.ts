import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMockProvider, createSecretRedactor, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  A2AError,
  canonicalizeA2AAgentCard,
  createA2AAgentCard,
  createA2AClient,
  createA2AHandler,
  signA2AAgentCard,
  verifyA2AAgentCard,
  type A2AAgentCard,
} from "../index.js";

const endpoint = "https://agent.example/a2a/v1";
const baseCard = (): A2AAgentCard => ({
  name: "Research Agent",
  description: "Finds bounded answers",
  supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  version: "1.0.0",
  capabilities: { streaming: true },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [{ id: "research", name: "Research", description: "Researches a topic", tags: ["research"] }],
});
const ownership = { tenantId: "tenant", userId: "user" };
const session = () => createAgent({ model: { provider: "mock", model: "test" }, provider: createMockProvider([providerTextDelta("answer"), providerDone()]) }).createSession();
const rpc = (method = "SendMessage", input = "question") => ({ jsonrpc: "2.0", id: 1, method, params: { message: { role: "user", messageId: "m1", parts: [{ text: input }] } } });

describe("A2A agent cards", () => {
  it("canonicalizes, signs, verifies, and rejects tamper/expiry", async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const card = createA2AAgentCard(baseCard());
    assert.equal(canonicalizeA2AAgentCard(card), canonicalizeA2AAgentCard({ ...card }));
    const signed = await signA2AAgentCard(card, { privateKey: keys.privateKey, keyId: "key-1", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" });
    await verifyA2AAgentCard(signed, { publicKey: keys.publicKey, keyId: "key-1", now: new Date("2026-06-01T00:00:00Z") });
    await assert.rejects(verifyA2AAgentCard({ ...signed, description: "tampered" }, { publicKey: keys.publicKey, now: new Date("2026-06-01T00:00:00Z") }), /invalid or expired/);
    await assert.rejects(verifyA2AAgentCard(signed, { publicKey: keys.publicKey, now: new Date("2028-01-01T00:00:00Z") }), /invalid or expired/);
  });
});

describe("createA2AHandler", () => {
  it("serves discovery and authorized SendMessage", async () => {
    const handler = createA2AHandler({ card: baseCard(), exposure: { sessionFactory: () => session() }, authorize: () => ({ ownership }) });
    const cardResponse = await handler(new Request("https://agent.example/.well-known/agent-card.json"));
    assert.equal(cardResponse.status, 200);
    assert.equal((await cardResponse.json()).name, "Research Agent");
    const response = await handler(new Request(endpoint, { method: "POST", headers: { "content-type": "application/a2a+json" }, body: JSON.stringify(rpc()) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(body.result.task.artifacts[0].parts[0].text, "answer");
  });

  it("fails closed on auth, unsupported parts/methods, and request limits", async () => {
    const denied = createA2AHandler({ card: baseCard(), exposure: { sessionFactory: () => session() }, authorize: () => false, limits: { maxRequestBytes: 256 } });
    const unauthorized = await denied(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rpc()) }));
    assert.equal(unauthorized.status, 403);
    const allowed = createA2AHandler({ card: baseCard(), exposure: { sessionFactory: () => session() }, authorize: () => ({ ownership }), limits: { maxRequestBytes: 256 } });
    const bad = rpc();
    bad.params.message.parts = [{ text: "x", file: "no" }] as unknown as [{ text: string }];
    assert.equal((await allowed(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad) }))).status, 400);
    const unknown = await allowed(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rpc("Unknown")) }));
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).error.code, -32601);
    assert.equal((await allowed(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rpc("SendMessage", "x".repeat(300))) }))).status, 413);
  });

  it("streams bounded working and completed task events with redaction", async () => {
    const handler = createA2AHandler({ card: baseCard(), exposure: { sessionFactory: () => session() }, authorize: () => ({ ownership }), redactor: createSecretRedactor(["answer"]) });
    const response = await handler(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rpc("SendStreamingMessage")) }));
    assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);
    const text = await response.text();
    assert.match(text, /TASK_STATE_WORKING/);
    assert.match(text, /TASK_STATE_COMPLETED/);
    assert.doesNotMatch(text, /answer/);
  });
});

describe("createA2AClient", () => {
  it("discovers, verifies, authenticates after serialization, and maps remote results", async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const card = await signA2AAgentCard(baseCard(), { privateKey: keys.privateKey, keyId: "key-1", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const handler = createA2AHandler({ card, exposure: { sessionFactory: () => session() }, authorize: ({ request }) => request.headers.get("authorization") === "Bearer token" ? { ownership } : false });
    let authCalls = 0;
    const client = createA2AClient({
      endpoint,
      allowedOrigins: ["https://agent.example"],
      fetch: (input, init) => handler(new Request(input, init)),
      authorize: () => { authCalls += 1; return { authorization: "Bearer token" }; },
      verifyCard: (value) => verifyA2AAgentCard(value, { publicKey: keys.publicKey, keyId: "key-1" }),
    });
    const result = await client.send("question");
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, "answer");
    assert.equal(authCalls, 1);
    const chunks: string[] = [];
    for await (const chunk of client.stream("question")) chunks.push(chunk);
    assert.deepEqual(chunks, ["answer"]);
  });

  it("rejects origins before fetch and malformed/oversized/aborted remote data", async () => {
    let calls = 0;
    assert.throws(() => createA2AClient({ endpoint: "http://internal/a2a", allowedOrigins: ["http://internal"], fetch: async () => { calls += 1; return new Response(); } }), A2AError);
    assert.equal(calls, 0);
    const malformed = createA2AClient({ endpoint, allowedOrigins: ["https://agent.example"], fetch: async (input) => new URL(String(input)).pathname.includes("well-known") ? Response.json(baseCard()) : Response.json({ bad: true }) });
    await assert.rejects(malformed.send("x"), /Malformed A2A JSON-RPC/);
    const oversized = createA2AClient({ endpoint, allowedOrigins: ["https://agent.example"], limits: { maxResponseBytes: 16 }, fetch: async (input) => new URL(String(input)).pathname.includes("well-known") ? Response.json(baseCard()) : Response.json({ value: "x".repeat(100) }) });
    await assert.rejects(oversized.send("x"), /exceeds max bytes/);
    const controller = new AbortController();
    const aborted = createA2AClient({ endpoint, allowedOrigins: ["https://agent.example"], fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })) });
    const pending = aborted.getCard({ signal: controller.signal });
    controller.abort(new Error("stop"));
    await assert.rejects(pending, /stop/);
  });
});
