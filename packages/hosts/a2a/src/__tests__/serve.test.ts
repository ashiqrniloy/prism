import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { canonicalJson } from "../codec.js";
import {
  A2A_CARD_PATH,
  type A2AAgentCard,
  type A2AAuthorization,
  A2AConfigError,
  A2ALiteralSecretError,
  PRISM_DECISIONS_EXTENSION,
  type ServeA2AOptions,
  serveA2A,
} from "../index.js";

const ENDPOINT = "https://agents.example.test/a2a";

const card: A2AAgentCard = {
  name: "Reviewer",
  description: "Reviews diffs.",
  version: "1.0.0",
  supportedInterfaces: [{ url: ENDPOINT, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [{ id: "review", name: "Review", description: "Reviews a diff.", tags: ["code"] }],
};

const alice: A2AAuthorization = { principal: { kind: "user", id: "alice" }, ownership: { userId: "alice" } };
const bob: A2AAuthorization = { principal: { kind: "user", id: "bob" }, ownership: { userId: "bob" } };

/** Authorizes by the `authorization: Bearer <user>` header. */
function byBearer({ request }: { request: Request }): A2AAuthorization | false {
  const user = request.headers.get("authorization")?.replace(/^Bearer /, "");
  return user === "alice" ? alice : user === "bob" ? bob : false;
}

let rpcSeq = 0;
function rpc(method: string, params: unknown, init: { user?: string; version?: string | null; body?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.version !== null) headers["a2a-version"] = init.version ?? "1.0";
  if (init.user !== undefined) headers.authorization = `Bearer ${init.user}`;
  return new Request(ENDPOINT, {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method, params }),
  });
}

function textMessage(text: string, extra: Record<string, unknown> = {}) {
  return { message: { messageId: `m-${++rpcSeq}`, role: "ROLE_USER", parts: [{ text }], ...extra } };
}

async function body(response: Response): Promise<{ result?: any; error?: { code: number; message: string } }> {
  return (await response.json()) as never;
}

async function frames(response: Response): Promise<any[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

function textAgent(options: { store?: SessionStore; input?: readonly string[]; delayMs?: number } = {}): Promise<Agent> {
  return createAgent({
    id: "a2a-text",
    model: { provider: "mock", model: "mock", ...(options.input ? { capabilities: { input: options.input } } : {}) },
    slots: { store: options.store ?? createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate(request) {
            yield providerTextDelta("hello ");
            if (options.delayMs) {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, options.delayMs);
                request.signal?.addEventListener("abort", () => {
                  clearTimeout(timer);
                  reject(new Error("aborted"));
                });
              });
            }
            yield providerTextDelta("from the agent");
            yield providerDone();
          },
        },
      ]),
    ],
  });
}

function approvalAgent(store: SessionStore = createMemorySessionStore(), executed: string[] = []): Promise<Agent> {
  let turn = 0;
  return createAgent({
    id: "a2a-approvals",
    model: { provider: "mock", model: "mock" },
    slots: { store },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate() {
            if (++turn % 2 === 1) {
              yield { type: "tool_call" as const, call: toolCallContent(`call-${turn}`, "publish_draft", { path: "a.txt" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("published");
            yield providerDone();
          },
        },
      ]),
    ],
    hooks: askEveryTool(),
    tools: {
      add: [
        {
          name: "publish_draft",
          parameters: { type: "object" },
          execute: (_args, context) => {
            executed.push(context.toolCallId);
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });
}

function serve(agent: Agent, extra: Partial<ServeA2AOptions> = {}) {
  return serveA2A(agent, { card, authorize: byBearer, ...extra });
}

describe("serveA2A", () => {
  it("agent_card_is_served_and_valid", async () => {
    const handle = serve(await textAgent());
    const response = await handle(new Request(`https://agents.example.test${A2A_CARD_PATH}`));
    assert.equal(response.status, 200);
    const served = (await response.json()) as A2AAgentCard;
    assert.equal(served.name, "Reviewer");
    assert.deepEqual(served.supportedInterfaces, card.supportedInterfaces);
    assert.equal(served.capabilities?.streaming, true);
    assert.equal(served.capabilities?.pushNotifications, false);
    assert.equal(served.capabilities?.extendedAgentCard, false);
    assert.ok(served.capabilities?.extensions?.some((entry) => entry.uri === PRISM_DECISIONS_EXTENSION));
    assert.equal(served.signatures, undefined);
    assert.throws(
      () => serveA2A({} as Agent, { card: { ...card, capabilities: { pushNotifications: true } }, authorize: byBearer }),
      A2AConfigError,
    );
    assert.throws(
      () =>
        serveA2A({} as Agent, {
          card: {
            ...card,
            supportedInterfaces: [{ url: "http://agents.example.test/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
          },
          authorize: byBearer,
        }),
      A2AConfigError,
    );
  });

  it("card_is_signed_from_a_key_ref", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    process.env.PRISM_A2A_TEST_CARD_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      const handle = serve(await textAgent(), { signing: { key: "env:PRISM_A2A_TEST_CARD_KEY", keyId: "k1" } });
      const served = (await (await handle(new Request(`https://agents.example.test${A2A_CARD_PATH}`))).json()) as A2AAgentCard;
      const signature = served.signatures?.[0];
      assert.ok(signature);
      const { signatures: _drop, ...unsigned } = served;
      const payload = Buffer.from(canonicalJson(unsigned)).toString("base64url");
      const ok = verify(
        "sha256",
        Buffer.from(`${signature.protected}.${payload}`),
        { key: createPublicKey(publicKey.export({ type: "spki", format: "pem" })), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature.signature, "base64url"),
      );
      assert.equal(ok, true);
      assert.ok(!JSON.stringify(served).includes("PRIVATE KEY"));
    } finally {
      delete process.env.PRISM_A2A_TEST_CARD_KEY;
    }
  });

  it("literal_signing_key_fails_at_construction", async () => {
    const agent = await textAgent();
    assert.throws(() => serve(agent, { signing: { key: "-----BEGIN PRIVATE KEY-----", keyId: "k1" } }), A2ALiteralSecretError);
  });

  it("message_send_runs_the_agent_and_returns_a_completed_task", async () => {
    const handle = serve(await textAgent());
    const reply = await body(await handle(rpc("SendMessage", textMessage("hi", { contextId: "ctx-1" }), { user: "alice" })));
    assert.equal(reply.error, undefined);
    const task = reply.result.task;
    assert.equal(task.contextId, "ctx-1");
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(task.artifacts[0].parts[0].text, "hello from the agent");
    const fetched = await body(await handle(rpc("GetTask", { id: task.id, historyLength: 10 }, { user: "alice" })));
    assert.equal(fetched.result.status.state, "TASK_STATE_COMPLETED");
    assert.deepEqual(
      fetched.result.history.map((message: any) => [message.role, message.parts[0].text]),
      [
        ["ROLE_USER", "hi"],
        ["ROLE_AGENT", "hello from the agent"],
      ],
    );
    await handle.close();
  });

  it("message_stream_forwards_events_as_sse", async () => {
    const handle = serve(await textAgent());
    const response = await handle(rpc("SendStreamingMessage", textMessage("hi"), { user: "alice" }));
    assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);
    const results = (await frames(response)).map((frame) => frame.result);
    assert.equal(results[0].task.status.state, "TASK_STATE_WORKING");
    const text = results
      .filter((result) => result.artifactUpdate)
      .map((result) => result.artifactUpdate.artifact.parts[0].text)
      .join("");
    assert.equal(text, "hello from the agent");
    assert.equal(results.filter((result) => result.artifactUpdate)[1].artifactUpdate.append, true);
    assert.equal(results.at(-1).statusUpdate.status.state, "TASK_STATE_COMPLETED");
    await handle.close();
  });

  it("no_authorize_refuses_every_call", async () => {
    const handle = serveA2A(await textAgent(), { card } as ServeA2AOptions);
    for (const method of ["SendMessage", "GetTask", "ListTasks"]) {
      const response = await handle(rpc(method, textMessage("hi"), { user: "alice" }));
      assert.equal(response.status, 401);
      assert.equal((await body(response)).error?.code, -32600);
    }
    const denied = serve(await textAgent());
    assert.equal((await denied(rpc("SendMessage", textMessage("hi"), { user: "mallory" }))).status, 401);
    assert.equal((await denied(rpc("SendMessage", textMessage("hi")))).status, 401);
  });

  it("suspended_run_reports_input_required_and_resumes_on_decisions", async () => {
    const executed: string[] = [];
    const handle = serve(await approvalAgent(undefined, executed));
    const first = await body(await handle(rpc("SendMessage", textMessage("publish"), { user: "alice" })));
    const task = first.result.task;
    assert.equal(task.status.state, "TASK_STATE_INPUT_REQUIRED");
    const pending = task.status.message.parts[0].data;
    assert.equal(pending.kind, "tool_approval");
    assert.equal(pending.toolName, "publish_draft");
    assert.equal(typeof pending.approvalId, "string");
    assert.deepEqual(executed, []);
    const resumed = await body(
      await handle(
        rpc(
          "SendMessage",
          {
            message: {
              messageId: "m-decide",
              role: "ROLE_USER",
              taskId: task.id,
              contextId: task.contextId,
              extensions: [PRISM_DECISIONS_EXTENSION],
              parts: [{ data: { decisions: [{ approvalId: pending.approvalId, outcome: "allow_once" }] } }],
            },
          },
          { user: "alice" },
        ),
      ),
    );
    assert.equal(resumed.error, undefined);
    assert.equal(resumed.result.task.id, task.id);
    assert.equal(resumed.result.task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(executed.length, 1);
    await handle.close();
  });

  it("follow_up_without_decisions_on_input_required_is_invalid_params", async () => {
    const handle = serve(await approvalAgent());
    const task = (await body(await handle(rpc("SendMessage", textMessage("publish"), { user: "alice" })))).result.task;
    const reply = await body(await handle(rpc("SendMessage", textMessage("please", { taskId: task.id }), { user: "alice" })));
    assert.equal(reply.error?.code, -32602);
    const after = await body(await handle(rpc("GetTask", { id: task.id }, { user: "alice" })));
    assert.equal(after.result.status.state, "TASK_STATE_INPUT_REQUIRED");
    // A new task on the same context is refused while it waits for decisions.
    const fresh = await body(await handle(rpc("SendMessage", textMessage("again", { contextId: task.contextId }), { user: "alice" })));
    assert.equal(fresh.error?.code, -32602);
    await handle.close();
  });

  it("cancel_aborts_the_run", async () => {
    const handle = serve(await textAgent({ delayMs: 5_000 }));
    const started = await body(
      await handle(rpc("SendMessage", { ...textMessage("hi"), configuration: { returnImmediately: true } }, { user: "alice" })),
    );
    const task = started.result.task;
    assert.equal(task.status.state, "TASK_STATE_WORKING");
    const canceled = await body(await handle(rpc("CancelTask", { id: task.id }, { user: "alice" })));
    assert.equal(canceled.result.status.state, "TASK_STATE_CANCELED");
    await handle.close();
  });

  it("cancel_of_terminal_or_input_required_task_is_not_cancelable", async () => {
    const handle = serve(await approvalAgent());
    const suspended = (await body(await handle(rpc("SendMessage", textMessage("publish"), { user: "alice" })))).result.task;
    assert.equal((await body(await handle(rpc("CancelTask", { id: suspended.id }, { user: "alice" })))).error?.code, -32002);
    const text = serve(await textAgent());
    const done = (await body(await text(rpc("SendMessage", textMessage("hi"), { user: "alice" })))).result.task;
    assert.equal((await body(await text(rpc("CancelTask", { id: done.id }, { user: "alice" })))).error?.code, -32002);
    assert.equal((await body(await text(rpc("SubscribeToTask", { id: done.id }, { user: "alice" })))).error?.code, -32004);
    await handle.close();
    await text.close();
  });

  it("subscribe_streams_a_working_task_until_it_ends", async () => {
    const handle = serve(await textAgent({ delayMs: 50 }));
    const task = (
      await body(await handle(rpc("SendMessage", { ...textMessage("hi"), configuration: { returnImmediately: true } }, { user: "alice" })))
    ).result.task;
    const results = (await frames(await handle(rpc("SubscribeToTask", { id: task.id }, { user: "alice" })))).map((frame) => frame.result);
    assert.equal(results[0].task.id, task.id);
    assert.equal(results.at(-1).statusUpdate.status.state, "TASK_STATE_COMPLETED");
    await handle.close();
  });

  it("task_outside_scope_is_not_found", async () => {
    const handle = serve(await approvalAgent());
    const task = (await body(await handle(rpc("SendMessage", textMessage("publish", { contextId: "ctx-a" }), { user: "alice" })))).result
      .task;
    for (const method of ["GetTask", "CancelTask", "SubscribeToTask"]) {
      assert.equal((await body(await handle(rpc(method, { id: task.id }, { user: "bob" })))).error?.code, -32001, method);
    }
    assert.equal(
      (await body(await handle(rpc("SendMessage", textMessage("hi", { contextId: "ctx-a" }), { user: "bob" })))).error?.code,
      -32001,
    );
    assert.equal((await body(await handle(rpc("GetTask", { id: "bm9wZQ.cnVu" }, { user: "alice" })))).error?.code, -32001);
    await handle.close();
  });

  it("suspended_task_is_recovered_from_the_session_after_restart", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const first = serve(await approvalAgent(store, executed));
    const task = (await body(await first(rpc("SendMessage", textMessage("publish", { contextId: "ctx-r" }), { user: "alice" })))).result
      .task;
    const approvalId = task.status.message.parts[0].data.approvalId;
    await first.close();

    const second = serve(await approvalAgent(store, executed));
    assert.equal((await body(await second(rpc("GetTask", { id: task.id }, { user: "bob" })))).error?.code, -32001);
    const recovered = await body(await second(rpc("GetTask", { id: task.id }, { user: "alice" })));
    assert.equal(recovered.result.status.state, "TASK_STATE_INPUT_REQUIRED");
    assert.equal(recovered.result.status.message.parts[0].data.approvalId, approvalId);
    const resumed = await body(
      await second(
        rpc(
          "SendMessage",
          {
            message: {
              messageId: "m-r",
              role: "ROLE_USER",
              taskId: task.id,
              extensions: [PRISM_DECISIONS_EXTENSION],
              parts: [{ data: { decisions: [{ approvalId, outcome: "reject_once" }] } }],
            },
          },
          { user: "alice" },
        ),
      ),
    );
    assert.equal(resumed.result.task.status.state, "TASK_STATE_COMPLETED");
    assert.deepEqual(executed, []);
    // A settled task is not in the new process's registry after another restart.
    const third = serve(await approvalAgent(store, executed));
    assert.equal((await body(await third(rpc("GetTask", { id: task.id }, { user: "alice" })))).error?.code, -32001);
    await second.close();
    await third.close();
  });

  it("unsupported_operation_returns_the_protocol_error", async () => {
    const handle = serve(await textAgent());
    const code = async (method: string, params: unknown = {}, version?: string | null) =>
      (await body(await handle(rpc(method, params, { user: "alice", version })))).error?.code;
    assert.equal(await code("ListTasks"), -32004);
    assert.equal(await code("CreateTaskPushNotificationConfig"), -32003);
    assert.equal(await code("GetTaskPushNotificationConfig"), -32003);
    assert.equal(
      await code("SendMessage", { ...textMessage("hi"), configuration: { taskPushNotificationConfig: { url: "https://x" } } }),
      -32003,
    );
    assert.equal(await code("GetExtendedAgentCard"), -32007);
    assert.equal(await code("NoSuchMethod"), -32601);
    assert.equal(await code("SendMessage", textMessage("hi"), "0.3"), -32009);
    assert.equal(await code("SendMessage", textMessage("hi"), null), -32009);
    assert.equal((await body(await handle(rpc("SendMessage", {}, { user: "alice", body: "{not json" })))).error?.code, -32700);
  });

  it("url_part_or_undeclared_kind_fails_with_content_type_error", async () => {
    const handle = serve(await textAgent());
    const send = async (part: Record<string, unknown>) =>
      (
        await body(
          await handle(
            rpc("SendMessage", { message: { messageId: `m-${++rpcSeq}`, role: "ROLE_USER", parts: [part] } }, { user: "alice" }),
          ),
        )
      ).error?.code;
    assert.equal(await send({ url: "https://example.test/a.png" }), -32005);
    assert.equal(await send({ raw: "aGVsbG8=", mediaType: "image/png" }), -32005);
    assert.equal(await send({ raw: "aGVsbG8=", mediaType: "application/zip" }), -32005);
    assert.equal(await send({ text: "a", data: { b: 1 } }), -32602);
    const images = serve(await textAgent({ input: ["text", "image"] }));
    const reply = await body(
      await images(
        rpc(
          "SendMessage",
          { message: { messageId: "m-img", role: "ROLE_USER", parts: [{ raw: "aGVsbG8=", mediaType: "image/png" }] } },
          { user: "alice" },
        ),
      ),
    );
    assert.equal(reply.result?.task.status.state, "TASK_STATE_COMPLETED");
    await images.close();
  });

  it("oversized_request_and_too_many_tasks_fail_closed", async () => {
    const handle = serve(await textAgent({ delayMs: 5_000 }), { limits: { maxRequestBytes: 1_024, maxConcurrentTasks: 1 } });
    const big = await handle(rpc("SendMessage", textMessage("x".repeat(2_000)), { user: "alice" }));
    assert.equal(big.status, 413);
    assert.equal((await body(big)).error?.code, -32600);
    const first = await body(
      await handle(rpc("SendMessage", { ...textMessage("one"), configuration: { returnImmediately: true } }, { user: "alice" })),
    );
    assert.equal(first.result.task.status.state, "TASK_STATE_WORKING");
    const second = await handle(
      rpc("SendMessage", { ...textMessage("two"), configuration: { returnImmediately: true } }, { user: "alice" }),
    );
    assert.equal(second.status, 429);
    assert.equal((await body(second)).error?.code, -32000);
    // Another principal has its own budget.
    const other = await body(
      await handle(rpc("SendMessage", { ...textMessage("three"), configuration: { returnImmediately: true } }, { user: "bob" })),
    );
    assert.equal(other.result.task.status.state, "TASK_STATE_WORKING");
    assert.throws(() => serve({} as Agent, { limits: { maxRequestBytes: 0 } }), A2AConfigError);
    await handle.close();
  });

  it("failed_run_reason_passes_the_redactor", async () => {
    const agent = await createAgent({
      id: "a2a-fail",
      model: { provider: "mock", model: "mock" },
      slots: { store: createMemorySessionStore() },
      retry: false,
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              throw new Error("upstream said sk-secret-123");
            },
          },
        ]),
      ],
    } as never);
    const handle = serve(agent, {
      redactor: {
        redact: <T>(value: T): T => (typeof value === "string" ? (value.replaceAll("sk-secret-123", "[redacted]") as T) : value),
      },
    });
    const reply = await body(await handle(rpc("SendMessage", textMessage("hi"), { user: "alice" })));
    assert.equal(reply.result.task.status.state, "TASK_STATE_FAILED");
    assert.ok(!JSON.stringify(reply).includes("sk-secret-123"));
    await handle.close();
  });
});
