import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMockProvider, createSecretRedactor, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  A2AError,
  canonicalizeA2AAgentCard,
  createA2AAgentCard,
  createA2AClient,
  createA2AHandler,
  deliverA2APushEvent,
  signA2AAgentCard,
  verifyA2AAgentCard,
  type A2AAgentCard,
  type A2ALimits,
  type A2APushConfig,
  type A2ATask,
  type A2ATaskLifecycle,
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
const streamEvent = (state: string, text?: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { task: { id: "t1", contextId: "c1", status: { state }, artifacts: text === undefined ? [] : [{ artifactId: "a1", parts: [{ text }] }] } } });

function streamClient(chunks: readonly Uint8Array[], limits?: A2ALimits) {
  return createA2AClient({
    endpoint,
    allowedOrigins: ["https://agent.example"],
    limits,
    fetch: async (input) => new URL(String(input)).pathname.includes("well-known")
      ? Response.json(baseCard())
      : new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }),
  });
}

async function collectStream(client: ReturnType<typeof createA2AClient>): Promise<string[]> {
  const output: string[] = [];
  for await (const chunk of client.stream("question")) output.push(chunk);
  return output;
}

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
    assert.throws(() => createA2AHandler({ card: { ...baseCard(), capabilities: { streaming: true, pushNotifications: true } }, exposure: { sessionFactory: () => session() }, authorize: () => ({ ownership }) }), /push capability/);
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

  it("supports durable rich tasks, owner-hidden lookup, replay subscriptions, and host-owned push configs", async () => {
    const tasks = new Map<string, A2ATask>();
    let replayCursor: string | undefined;
    const lifecycle: A2ATaskLifecycle = {
      async start({ message, authorization }) { const task: A2ATask = { id: "durable-1", contextId: message.contextId ?? "ctx-1", status: { state: "TASK_STATE_INPUT_REQUIRED", timestamp: new Date().toISOString() }, artifacts: [{ artifactId: "rich", parts: message.parts }] }; tasks.set(`${authorization.ownership.userId}:${task.id}`, task); return task; },
      async get({ id, authorization }) { return tasks.get(`${authorization.ownership.userId}:${id}`); },
      async list({ authorization }) { return { tasks: [...tasks.entries()].filter(([key]) => key.startsWith(`${authorization.ownership.userId}:`)).map(([, task]) => task) }; },
      async cancel({ id, authorization }) { const task = tasks.get(`${authorization.ownership.userId}:${id}`); return task && { ...task, status: { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() } }; },
      async *subscribe({ id, afterEventId, authorization }) { replayCursor = afterEventId; const task = tasks.get(`${authorization.ownership.userId}:${id}`); if (task) yield { eventId: "event-2", task }; },
    };
    const configs = new Map<string, A2APushConfig>();
    const push = {
      async create({ config }: any) { configs.set(config.id, config); return config; },
      async get({ id }: any) { return configs.get(id); },
      async list() { return { configs: [...configs.values()] }; },
      async delete({ id }: any) { return configs.delete(id); },
    };
    const handler = createA2AHandler({ card: { ...baseCard(), capabilities: { streaming: true, pushNotifications: true } }, exposure: { sessionFactory: () => session() }, authorize: ({ request }) => ({ ownership: { tenantId: "tenant", userId: request.headers.get("x-user") ?? "user" } }), tasks: lifecycle, push, parts: { allowRaw: true, allowData: true, allowUrl: true, validateUrl: (url) => { if (url.hostname !== "files.example") throw new Error("blocked URL"); } } });
    const call = async (method: string, params: object, user = "user") => handler(new Request(endpoint, { method: "POST", headers: { "content-type": "application/a2a+json", "x-user": user }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) }));
    const created = await (await call("SendMessage", { message: { role: "ROLE_USER", messageId: "m-rich", parts: [{ raw: "aGk=", mediaType: "text/plain" }, { data: { safe: true } }, { url: "https://files.example/report.pdf" }] } })).json();
    assert.equal(created.result.task.status.state, "TASK_STATE_INPUT_REQUIRED");
    const malformedRaw = await call("SendMessage", { message: { role: "ROLE_USER", messageId: "bad-raw", parts: [{ raw: "%%%" }] } }); assert.equal(malformedRaw.status, 400);
    let nested: any = null; for (let i = 0; i < 70; i++) nested = { nested }; const deepData = await call("SendMessage", { message: { role: "ROLE_USER", messageId: "deep", parts: [{ data: nested }] } }); assert.equal(deepData.status, 400);
    assert.equal((await (await call("GetTask", { id: "durable-1" }, "other")).json()).error.code, -32001);
    assert.equal((await (await call("ListTasks", { pageSize: 10 })).json()).result.tasks.length, 1);
    const subscribed = await call("SubscribeToTask", { id: "durable-1", afterEventId: "event-1" });
    assert.match(await subscribed.text(), /event-2/); assert.equal(replayCursor, "event-1");
    const pushed = await (await call("CreateTaskPushNotificationConfig", { taskId: "durable-1", config: { id: "push-1", url: "https://files.example/hook", token: "secret", authentication: { scheme: "Bearer", credentials: "secret" } } })).json();
    assert.equal(pushed.result.id, "push-1"); assert.equal(pushed.result.token, undefined); assert.equal(pushed.result.authentication.credentials, undefined);
    const deliveries: string[] = []; const delivery = await deliverA2APushEvent({ async deliver(input) { deliveries.push(`${input.idempotencyKey}:${input.attempt}`); if (input.attempt === 1) throw new Error("retry"); } }, configs.get("push-1")!, { eventId: "event-push", task: tasks.get("user:durable-1")! }, { maxAttempts: 2 });
    assert.equal(delivery.attempts, 2); assert.deepEqual(deliveries, ["event-push:1", "event-push:2"]);
    const client = createA2AClient({ endpoint, allowedOrigins: ["https://agent.example"], fetch: (input, init) => handler(new Request(input, init)), authorize: () => ({ "x-user": "user" }) });
    assert.equal((await client.sendMessage({ role: "ROLE_USER", messageId: "client-rich", parts: [{ data: { from: "client" } }] })).status.state, "TASK_STATE_INPUT_REQUIRED");
    assert.equal((await client.getTask("durable-1")).id, "durable-1");
    assert.equal((await client.listTasks()).tasks.length, 1);
    const replay: string[] = []; for await (const event of client.subscribeToTask("durable-1", { afterEventId: "event-1" })) replay.push(event.eventId);
    assert.deepEqual(replay, ["event-2"]); assert.equal((await client.cancelTask("durable-1")).status.state, "TASK_STATE_CANCELED");
    assert.equal((await client.getPushConfig("durable-1", "push-1")).id, "push-1"); assert.equal((await client.listPushConfigs("durable-1")).configs.length, 1); await client.deletePushConfig("durable-1", "push-1");
    assert.equal((await handler(new Request(endpoint, { method: "POST", headers: { "content-type": "application/a2a+json", "a2a-version": "2.0" }, body: JSON.stringify(rpc()) }))).headers.get("a2a-version"), "1.0");
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

  it("parses split UTF-8, CRLF, mixed separators, and multiline data incrementally", async () => {
    const encoder = new TextEncoder();
    const frame = `data: ${streamEvent("TASK_STATE_COMPLETED", "hé😀")}\r\n\r\n`;
    const bytes = encoder.encode(frame);
    for (let split = 1; split < bytes.length; split += 1) {
      assert.deepEqual(await collectStream(streamClient([bytes.slice(0, split), bytes.slice(split)])), ["hé😀"]);
    }
    assert.deepEqual(await collectStream(streamClient([...bytes].map((_byte, index) => bytes.slice(index, index + 1)))), ["hé😀"]);

    const multiline = JSON.stringify(JSON.parse(streamEvent("TASK_STATE_COMPLETED", "multiline")), null, 2)
      .split("\n")
      .map((line) => `data: ${line}`)
      .join("\r\n") + "\r\n\n";
    assert.deepEqual(await collectStream(streamClient([encoder.encode(multiline)])), ["multiline"]);
  });

  it("rejects malformed UTF-8, truncated frames, post-terminal events, and existing stream limits", async () => {
    const encoder = new TextEncoder();
    await assert.rejects(collectStream(streamClient([Uint8Array.from([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xc3])])), /Malformed A2A UTF-8 stream/);
    await assert.rejects(collectStream(streamClient([encoder.encode(`data: ${streamEvent("TASK_STATE_COMPLETED")}`)])), /Truncated A2A stream/);
    await assert.rejects(collectStream(streamClient([encoder.encode(`data: ${streamEvent("TASK_STATE_COMPLETED")}\n\ndata: ${streamEvent("TASK_STATE_WORKING")}\n\n`)])), /continued after terminal/);
    await assert.rejects(collectStream(streamClient([encoder.encode(`data: ${"x".repeat(64)}\n\n`)], { maxEventBytes: 32 })), /event exceeds max bytes/);
    await assert.rejects(collectStream(streamClient([encoder.encode(`data: ${streamEvent("TASK_STATE_COMPLETED")}\n\n`)], { maxStreamBytes: 32 })), /stream exceeds max bytes/);
    await assert.rejects(collectStream(streamClient([encoder.encode(`:\n\ndata: ${streamEvent("TASK_STATE_COMPLETED")}\n\n`)], { maxStreamEvents: 1 })), /stream exceeds max events/);
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
