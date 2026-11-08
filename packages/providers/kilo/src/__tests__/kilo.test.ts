import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import {
  createKiloProvider,
  KILO_MODE_HEADER,
  KILO_ORGANIZATION_HEADER,
  KILO_TASK_ID_HEADER,
  type KiloRoute,
  kiloHttpError,
  kiloModels,
  mapKiloChatUsage,
  mapKiloMessagesUsage,
  mapKiloResponsesUsage,
  routeForKiloModel,
} from "../index.js";

const [chatModel, responsesModel, messagesModel] = kiloModels as [
  (typeof kiloModels)[number],
  (typeof kiloModels)[number],
  (typeof kiloModels)[number],
];
const secret = "sk-kilo-canary-never-expose";

function request(model = chatModel, extra: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model,
    messages: [
      { role: "system", content: [{ type: "text", text: "instructions" }] },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ],
    options: { sessionId: "session-1" },
    ...extra,
  };
}

async function capture(req: ProviderRequest, options: Parameters<typeof createKiloProvider>[0] = {}) {
  let headers = new Headers();
  let body: JsonObject = {};
  const provider = createKiloProvider({
    ...options,
    apiKey: async () => secret,
    fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  await collectProviderEvents(provider, req);
  return { body, headers };
}

function errorEvent(events: readonly ProviderEvent[]) {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  if (terminal?.type !== "error") throw new Error("missing error");
  return terminal.error as Error & { code?: unknown; failureClass?: string };
}

async function classify(status: number, bodyText: string) {
  const provider = createKiloProvider({
    apiKey: async () => secret,
    fetch: (async () => new Response(bodyText, { status, headers: { "content-type": "application/json" } })) as typeof fetch,
  });
  return errorEvent(await collectProviderEvents(provider, request()));
}

describe("Kilo routes", () => {
  it("kilo_route_rule", () => {
    assert.equal(routeForKiloModel({ compat: { aiSdkProvider: "anthropic" } }), "messages");
    assert.equal(routeForKiloModel({ compat: { aiSdkProvider: "openai" } }), "responses");
    assert.equal(routeForKiloModel({ compat: { aiSdkProvider: "openrouter" } }), "chat");
    assert.equal(routeForKiloModel({ compat: {} }), "chat");
    assert.equal(routeForKiloModel({ compat: { aiSdkProvider: "anthropic", route: "chat" } }), "chat", "an explicit route wins");
    assert.equal(chatModel.compat?.route, "chat");
    assert.equal(responsesModel.compat?.route, "responses");
    assert.equal(messagesModel.compat?.route, "messages");
  });

  it("kilo_task_id_header_owned", async () => {
    for (const model of [chatModel, responsesModel, messagesModel]) {
      const { headers } = await capture(
        request(model, { options: { sessionId: "s/1 with spaces", headers: { "X-KILOCODE-TASKID": "caller" } } }),
      );
      assert.equal(headers.get(KILO_TASK_ID_HEADER), "s-1-with-spaces");
      assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    }
  });

  it("kilo_org_and_mode_headers", async () => {
    const off = await capture(request());
    assert.equal(off.headers.has(KILO_ORGANIZATION_HEADER), false);
    assert.equal(off.headers.has(KILO_MODE_HEADER), false);
    const on = await capture(request({ ...chatModel, model: "kilo-auto/frontier" }), { organizationId: "org_1", mode: "build" });
    assert.equal(on.headers.get(KILO_ORGANIZATION_HEADER), "org_1");
    assert.equal(on.headers.get(KILO_MODE_HEADER), "build", "mode is sent on kilo-auto/*");
    const other = await capture(request(), { organizationId: "org_1", mode: "build" });
    assert.equal(other.headers.get(KILO_MODE_HEADER), null, "mode is not sent elsewhere");
  });

  it("kilo_data_collection_body", async () => {
    const off = await capture(request());
    assert.equal(off.body.provider, undefined);
    const on = await capture(request(), { dataCollection: "deny" });
    assert.deepEqual(on.body.provider, { data_collection: "deny" });
  });

  it("kilo_messages_cache_breakpoints_match_cli", async () => {
    const long = "x".repeat(2000);
    const req = request(messagesModel, {
      messages: [
        { role: "system", content: [{ type: "text", text: "one" }] },
        { role: "system", content: [{ type: "text", text: "two" }] },
        { role: "user", content: [{ type: "text", text: long }] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "last" }] },
      ],
      options: { sessionId: "s", cacheRetention: "short" },
    });
    const { body } = await capture(req);
    const blocks = (body.messages as JsonObject[]).map((message) => (message.content as JsonObject[]).at(-1)?.cache_control);
    assert.deepEqual(blocks.slice(-2), [{ type: "ephemeral" }, { type: "ephemeral" }], "last two messages are marked");
    assert.equal(blocks.filter((block) => block !== undefined).length, 2, "exactly the last two message markers");
    assert.deepEqual(
      (body.system as JsonObject[]).map((block) => block.cache_control),
      [{ type: "ephemeral" }, { type: "ephemeral" }],
    );
    assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
    assert.equal(body.messages && "cache_control" in (body.messages as JsonObject[])[0]!, false);
  });

  it("kilo_usage_mapping_per_wire", () => {
    const chat = mapKiloChatUsage(
      { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 40 }, cost: 0.0012 },
      { model: "google/gemma-4-26b-a4b-it", provider: "Google" },
    );
    assert.equal(chat?.inputTokens, 100);
    assert.equal(chat?.cacheReadTokens, 40);
    assert.equal(chat?.cost, 0.0012);
    assert.equal(chat?.currency, "USD");
    assert.equal((chat?.metadata?.kilo as JsonObject)?.provider, "Google");
    const responses = mapKiloResponsesUsage({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 5,
      total_tokens: 105,
      cost: 0,
    });
    assert.equal(responses?.inputTokens, 100);
    assert.equal(responses?.cacheReadTokens, 40);
    assert.equal(responses?.cost, 0);
    const messages = mapKiloMessagesUsage({
      input_tokens: 60,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: null,
      output_tokens: 5,
      cost: 0,
    });
    assert.equal(messages?.inputTokens, 100, "Messages input is inclusive");
    assert.equal(messages?.cacheReadTokens, 40);
    assert.equal(messages?.cacheWriteTokens, undefined, "a null write is not fabricated");
    assert.equal(mapKiloResponsesUsage({ output_tokens: 1 } as JsonObject)?.cost, undefined);
  });

  it("kilo_error_mapping", async () => {
    const unauthorized = await classify(401, '{"error":{"code":"INVALID_TOKEN","message":"bad"},"error_type":"authentication_required"}');
    assert.equal(unauthorized.failureClass, "auth");
    assert.match(unauthorized.message, /keyring:kilo/);
    const credits = await classify(
      402,
      '{"error":{"title":"Low Credit Warning!","message":"Add credits"},"error_type":"usage_limit_exceeded"}',
    );
    assert.equal(credits.failureClass, "permanent");
    assert.match(credits.message, /Add Kilo credits/);
    const external = await classify(402, '{"error":{"message":"Add credits","buyCreditsUrl":"https://evil.example/pay"}}');
    assert.equal(external.message.includes("evil.example"), false, "only kilo.ai billing links are shown");
    const local = await classify(402, '{"error":{"message":"Add credits","buyCreditsUrl":"https://app.kilo.ai/profile"}}');
    assert.equal(local.message.includes("https://app.kilo.ai/profile"), true);
    assert.equal((await classify(403, "forbidden")).failureClass, "auth");
    assert.equal((await classify(413, "too large")).failureClass, "permanent");
    assert.equal((await classify(429, "slow down")).failureClass, "rate_limited");
    assert.equal((await classify(502, "bad gateway")).failureClass, "transient");
    assert.equal((await classify(503, "unavailable")).failureClass, "transient");
    const overflow = await classify(
      400,
      '{"error":{"message":"This endpoint\'s maximum context length is 65536 tokens. However, you requested about 88052 tokens ...","code":400},"error_type":"context_length_exceeded"}',
    );
    assert.equal(overflow.failureClass, "context_overflow");
  });

  it("kilo_mid_stream_error_surfaces", async () => {
    const frames: readonly [KiloRoute, string][] = [
      ["chat", 'data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\ndata: [DONE]\n\n'],
      [
        "responses",
        'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"message":"upstream failed","code":"server_error"}}}\n\n',
      ],
      ["messages", 'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"upstream failed"}}\n\n'],
    ];
    const models = { chat: chatModel, responses: responsesModel, messages: messagesModel };
    for (const [route, sse] of frames) {
      const provider = createKiloProvider({
        apiKey: async () => secret,
        fetch: (async () => new Response(sse, { headers: { "content-type": "text/event-stream" } })) as typeof fetch,
      });
      const events = await collectProviderEvents(provider, request(models[route]));
      assert.equal(events.at(-1)?.type, "error", `${route} must surface the error frame`);
    }
  });

  it("kilo_secret_never_leaks", async () => {
    const error = kiloHttpError(new Response("", { status: 401 }), `bad ${secret}`, [secret]);
    assert.equal(error.message.includes(secret), false);
  });
});
