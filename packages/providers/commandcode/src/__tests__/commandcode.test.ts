import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { applyThinkingLevelForModel, collectProviderEvents, replayFetch } from "@arnilo/prism/provider-kit";
import {
  COMMAND_CODE_ZDR_HEADER,
  commandCodeModels,
  commandCodeThinking,
  commandcode,
  createCommandCodeProvider,
  mapCommandCodeModel,
  routeForCommandCodeModel,
} from "../index.js";
import { commandCodeOverflowSession } from "./overflow-session.js";

const [chatModel, responsesModel, messagesModel] = commandCodeModels as [
  (typeof commandCodeModels)[number],
  (typeof commandCodeModels)[number],
  (typeof commandCodeModels)[number],
];
const secret = "sk-cc-levers-canary";

const tool = {
  name: "get_weather",
  description: "Get the current weather for a location.",
  parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
  execute: () => ({ toolCallId: "call_1", name: "get_weather", value: { temp: "18C" } }),
};

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

const cacheRequest = (model = messagesModel): ProviderRequest =>
  request(model, {
    tools: [tool],
    options: {
      sessionId: "session-1",
      cacheKey: "cache-key-1",
      cacheRetention: "short",
      cache: { breakpoints: [{ location: "system_prompt" }, { location: "last_message" }] },
    },
  });

async function capture(req: ProviderRequest, config: Parameters<typeof createCommandCodeProvider>[0] = {}) {
  let headers = new Headers();
  let body: JsonObject = {};
  const provider = createCommandCodeProvider({
    ...config,
    apiKey: async () => secret,
    fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      // The body and headers are the evidence here; the reply never needs to parse.
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
  const provider = createCommandCodeProvider({
    apiKey: async () => secret,
    fetch: (async () => new Response(bodyText, { status, headers: { "content-type": "application/json" } })) as typeof fetch,
  });
  return errorEvent(await collectProviderEvents(provider, request()));
}

describe("Command Code routes", () => {
  it("commandcode_route_rule", () => {
    assert.equal(routeForCommandCodeModel("claude-haiku-5-5", ["/messages"]), "anthropic");
    assert.equal(routeForCommandCodeModel("claude-sonnet-5-5"), "anthropic");
    assert.equal(routeForCommandCodeModel("gpt-5.6-luna", ["/chat/completions", "/responses"]), "responses");
    assert.equal(routeForCommandCodeModel("minimax/minimax-m3.1-flash", ["/chat/completions"]), "openai");
    assert.equal(routeForCommandCodeModel("vendor/unknown"), "openai", "a catalog without endpoints keeps Chat Completions");
    assert.equal(
      mapCommandCodeModel({ id: "gpt-5.6-luna", supported_endpoints: ["/responses", "/chat/completions"] }).compat?.route,
      "responses",
    );
    // An explicit route wins over the catalog: `createRoutedProvider` reads compat.route first.
    const pinned = mapCommandCodeModel({ id: "gpt-5.6-luna", supported_endpoints: ["/responses"] });
    assert.deepEqual(pinned.compat?.route, "responses");
    const explicit = { ...pinned, compat: { ...pinned.compat, route: "openai" as const } };
    assert.equal(explicit.compat.route, "openai");
  });

  it("commandcode_discovered_models_declare_image_only_for_vision_upstreams", () => {
    // `GET /models` has no modality field, so the mapping restores vision from the reference catalog;
    // without it the kernel codecs refuse an image before the request reaches the gateway.
    const vision = mapCommandCodeModel({ id: "minimax/minimax-m3.1-flash", supported_endpoints: ["/chat/completions"] });
    assert.deepEqual(vision.capabilities?.input, ["text", "image"]);
    const textOnly = mapCommandCodeModel({ id: "vendor/text-only", supported_endpoints: ["/chat/completions"] });
    assert.deepEqual(textOnly.capabilities?.input, ["text"]);
  });

  it("commandcode_chat_sends_no_cache_fields", async () => {
    const { body, headers } = await capture(cacheRequest(chatModel));
    assert.equal(body.model, "minimax/minimax-m3.1-flash");
    assert.equal(body.max_tokens, undefined, "no invented ceiling without parameters");
    assert.equal(body.prompt_cache_key, undefined);
    assert.equal(JSON.stringify(body).includes("cache_control"), false, "the Chat wire carries no cache markers");
    assert.equal(headers.has("x-client-request-id"), false, "Chat has no affinity header");
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
  });

  it("commandcode_responses_levers", async () => {
    const { body, headers } = await capture(request(responsesModel, { options: { sessionId: "session-1", cacheKey: "k".repeat(100) } }));
    assert.equal(body.store, false);
    assert.ok((body.include as string[]).includes("reasoning.encrypted_content"), "store:false keeps the include, which the wire ignores");
    assert.equal(body.prompt_cache_key, "k".repeat(64), "prompt_cache_key is clamped to 64");
    assert.equal(headers.get("x-client-request-id"), "k".repeat(100), "the affinity header is not clamped to 64");
    assert.equal("session_id" in body, false);
  });

  it("commandcode_messages_cache_breakpoints_exclude_tools", async () => {
    const { body, headers } = await capture(cacheRequest());
    const system = body.system as JsonObject[];
    assert.deepEqual(system[0]?.cache_control, { type: "ephemeral" });
    const lastMessage = (body.messages as JsonObject[]).at(-1) as { content: JsonObject[] };
    assert.deepEqual(lastMessage.content.at(-1)?.cache_control, { type: "ephemeral" });
    assert.equal((body.tools as JsonObject[])[0]?.cache_control, undefined, "tools are excluded from the default breakpoints");
    assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
    assert.equal(headers.get("x-api-key"), secret);
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
  });

  it("commandcode_messages_send_no_markers_without_breakpoints", async () => {
    const { body } = await capture(request(messagesModel));
    assert.equal(JSON.stringify(body).includes("cache_control"), false);
  });

  it("commandcode_messages_thinking_is_adaptive_and_carries_effort", async () => {
    const { body } = await capture(request(messagesModel, { options: { sessionId: "s", compat: { reasoning_effort: "low" } } }));
    assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.equal(body.max_tokens, 128_000, "the measured max output is declared");
    // A host thinking level patches compat; the route hook keeps the model on adaptive.
    const model = applyThinkingLevelForModel(undefined, "high", messagesModel);
    const patched = await capture(request(messagesModel, { options: { sessionId: "s", compat: model.compat } }));
    assert.deepEqual(patched.body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(patched.body.output_config, { effort: "high" });
    assert.deepEqual(commandCodeThinking(request(messagesModel, { options: { compat: { thinking: { type: "enabled" } } } })), {
      type: "adaptive",
      display: "summarized",
    });
  });

  it("commandcode_zdr_header_owned", async () => {
    const off = await capture(request(), { zdr: false });
    assert.equal(off.headers.has(COMMAND_CODE_ZDR_HEADER), false);
    const on = await capture(
      request(chatModel, { options: { sessionId: "s", headers: { [COMMAND_CODE_ZDR_HEADER]: "0", "x-trace": "1" } } }),
      { zdr: true },
    );
    assert.equal(on.headers.get(COMMAND_CODE_ZDR_HEADER), "1", "a caller cannot override the provider-owned header");
    assert.equal(on.headers.get("x-trace"), "1", "non-owned caller headers survive");
  });

  it("commandcode_error_mapping", async () => {
    const unauthorized = await classify(
      401,
      '{"success":false,"error":{"code":"UNAUTHORIZED","status":401,"message":"Invalid \'Authorization\' header or token."}}',
    );
    assert.equal(unauthorized.failureClass, "auth");
    assert.match(unauthorized.message, /COMMAND_CODE_API_KEY/);

    const upgrade = await classify(
      403,
      '{"error":{"code":"upgrade_required","message":"Provider API access is not included in this plan."}}',
    );
    assert.equal(upgrade.failureClass, "auth");
    assert.match(upgrade.message, /no Provider API access/);

    const zdr = await classify(
      422,
      '{"error":{"message":"This model has no zero-data-retention upstream. Remove the x-cmd-zdr header or choose a different model.","type":"invalid_request_error","code":"cmd_zdr_no_providers"}}',
    );
    assert.equal(zdr.failureClass, "permanent");
    assert.match(zdr.message, /set zdr: false/);
    assert.match(zdr.message, /zero-data-retention/);

    const wrongWire = await classify(
      400,
      '{"error":{"message":"Model \\"claude-haiku-5-5\\" must be called via /provider/v1/messages (Anthropic Messages shape).","type":"invalid_request_error","param":"model","code":"unsupported_model"}}',
    );
    assert.equal(wrongWire.failureClass, "permanent");
    assert.match(wrongWire.message, /different route/);
    assert.match(wrongWire.message, /claude-haiku-5-5/);

    const limited = await classify(429, '{"error":{"message":"Rate limit reached for requests","type":"rate_limit_error"}}');
    assert.equal(limited.failureClass, "rate_limited");

    const quota = await classify(429, '{"error":{"message":"insufficient quota for this key"}}');
    assert.equal(quota.failureClass, "quota");

    const transient = await classify(500, '{"error":{"message":"internal"}}');
    assert.equal(transient.failureClass, "transient");
  });

  it("commandcode_overflow_classified_per_supported_route", async () => {
    const chatOverflow =
      '{"error":{"message":"{\\"error\\":{\\"message\\":\\"This model\'s maximum context length is 1048576 tokens. However, your messages resulted in 1068047 tokens. Please reduce the length of the messages.\\",\\"type\\":\\"AI_APICallError\\"}}","type":"invalid_request_error"}}';
    const responsesOverflow =
      '{"error":{"message":"{\\"error\\":{\\"message\\":\\"This model\'s maximum context length is 1048576 tokens. However, your messages resulted in 1100047 tokens.\\"}}","type":"invalid_request_error"}}';
    for (const body of [chatOverflow, responsesOverflow]) {
      assert.equal((await classify(400, body)).failureClass, "context_overflow");
    }
    // A stealth model withholds the upstream text, so there is nothing to classify as overflow.
    const stealth = await classify(
      400,
      '{"error":{"message":"The stealth model could not complete the request.","type":"invalid_request_error"}}',
    );
    assert.equal(stealth.failureClass, "permanent");

    await commandCodeOverflowSession({
      path: "/provider/v1/chat/completions",
      status: 400,
      responseBody: chatOverflow.replace(/\\"/g, '"'),
    });
  });

  it("commandcode_reasoning_replays_recorded_details_on_chat", async () => {
    const chunk = (delta: JsonObject, finish: string | null = null) => ({
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    const sse = [
      `data: ${JSON.stringify(chunk({ reasoning: "thinking", reasoning_details: [{ type: "reasoning.text", text: "thinking", index: 0 }] }))}`,
      `data: ${JSON.stringify(chunk({ content: "hello" }, "stop"))}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const provider = createCommandCodeProvider({
      apiKey: async () => secret,
      fetch: (async () => new Response(sse, { headers: { "content-type": "text/event-stream" } })) as typeof fetch,
    });
    const events = await collectProviderEvents(provider, request());
    assert.equal(
      events.some((event) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "thinking"),
      true,
      "chat reasoning deltas are surfaced",
    );
    assert.equal(events.at(-1)?.type, "done");
  });

  it("commandcode_discovery_model_without_window_stays_undefined", () => {
    const model = mapCommandCodeModel({ id: "vendor/no-window", supported_endpoints: ["/chat/completions"] });
    assert.equal(model.limits?.contextWindow, undefined);
    assert.equal(model.capabilities?.reasoning, false);
    assert.deepEqual(model.capabilities?.input, ["text"]);
    assert.equal(model.cache?.kind, "implicit");
    assert.equal(commandCodeModels[0]?.cache?.kind, "implicit");
    assert.equal(messagesModel.cache?.kind, "cache_control");
  });

  it("commandcode_replays_each_wire_offline", async () => {
    // A single exchange per route, replayed with no network: proves the three codecs parse the
    // recorded frames and end in `done` without a live key.
    for (const [dir, model] of [
      ["chat", chatModel],
      ["responses", responsesModel],
      ["messages", messagesModel],
    ] as const) {
      const fixture = (await import(`./wire/${dir}/text.json`)) as { default: { path: string; responseBody: string } };
      const provider = createCommandCodeProvider({
        apiKey: async () => secret,
        fetch: replayFetch([{ ...fixture.default, status: 200, contentType: "text/event-stream" }]) as unknown as typeof fetch,
      });
      const events = await collectProviderEvents(provider, request(model));
      assert.equal(events.at(-1)?.type, "done", `${dir} fixture must end in done`);
    }
  });

  it("commandcode_package_config_accepts_zdr", async () => {
    assert.equal(typeof commandcode({ zdr: true }), "object");
  });
});

it("beam_tool_followup_replays_required_reasoning_content_on_chat", async () => {
  const beam = mapCommandCodeModel({ id: "reflection/beam:free", supported_endpoints: ["/chat/completions", "/responses"] });
  assert.equal(beam.compat?.route, "openai");
  const { body } = await capture(
    request(beam, {
      messages: [
        { role: "user", content: [{ type: "text", text: "use the tool" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "use the available tool" },
            { type: "tool_call", id: "call_1", name: "get_weather", arguments: { location: "Paris" } },
          ],
        },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "get_weather", result: "18C" }] },
      ],
    }),
  );
  assert.equal((body.messages as JsonObject[])[1]?.reasoning_content, "use the available tool");
});
