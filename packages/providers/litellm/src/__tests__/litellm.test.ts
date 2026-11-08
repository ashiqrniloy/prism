import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject, ModelConfig, ModelProvider, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { collectProviderEvents, replayFetch } from "@arnilo/prism/provider-kit";
import { readFileSync } from "node:fs";
import {
  createLiteLLMProvider,
  groupLiteLLMModelInfo,
  LITELLM_CALL_ID_HEADER,
  type LiteLLMModelInfoEntry,
  litellmHttpError,
  mapLiteLLMUsage,
  readLiteLLMHeaders,
} from "../index.js";

const secret = "sk-litellm-canary-never-expose";
const fixture = (name: string): JsonObject => JSON.parse(readFileSync(new URL(`./wire/chat/${name}.json`, import.meta.url), "utf8"));
const modelInfo = JSON.parse(readFileSync(new URL("./wire/model-info.json", import.meta.url), "utf8")) as {
  data: LiteLLMModelInfoEntry[];
};

const models: readonly ModelConfig[] = groupLiteLLMModelInfo(modelInfo.data, { provider: "litellm" });
const chatModel = models.find((model) => model.model === "prism-free/chat")!;

function request(model: ModelConfig = chatModel, extra: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model,
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    ...extra,
  };
}

function headersOf(exchange: JsonObject): Headers {
  return new Headers(exchange.headers as Record<string, string>);
}

/** A fetch that records what Prism sent and replays one recorded exchange. */
function capture(exchange: JsonObject = fixture("text")) {
  const seen: { headers: Headers; body: JsonObject }[] = [];
  const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    seen.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(String(exchange.responseBody), {
      status: Number(exchange.status ?? 200),
      headers: headersOf(exchange),
    });
  }) as typeof fetch;
  return { seen, fetch: fetchImpl };
}

function errorEvent(events: readonly ProviderEvent[]): Error & { failureClass?: string; code?: unknown } {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  if (terminal?.type !== "error") throw new Error("missing error");
  return terminal.error as Error & { failureClass?: string; code?: unknown };
}

async function classify(status: number, bodyText: string) {
  const provider = createLiteLLMProvider({
    apiKey: async () => secret,
    fetch: (async () => new Response(bodyText, { status, headers: { "content-type": "application/json" } })) as typeof fetch,
  });
  return errorEvent(await collectProviderEvents(provider, request()));
}

describe("LiteLLM Chat route", () => {
  it("litellm_call_id_owned_and_minted", async () => {
    const { seen, fetch } = capture();
    const provider = createLiteLLMProvider({ apiKey: async () => secret, fetch });
    await collectProviderEvents(provider, request(chatModel, { options: { headers: { "X-LiteLLM-Call-Id": "caller-value" } } }));
    const id = seen[0]?.headers.get(LITELLM_CALL_ID_HEADER);
    assert.match(String(id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(id, "caller-value", "a caller cannot choose the call id");

    const second = capture();
    const again = createLiteLLMProvider({ apiKey: async () => secret, fetch: second.fetch });
    await collectProviderEvents(again, request());
    await collectProviderEvents(again, request());
    assert.notEqual(second.seen[0]?.headers.get(LITELLM_CALL_ID_HEADER), second.seen[1]?.headers.get(LITELLM_CALL_ID_HEADER), "fresh per call");
  });

  it("litellm_headers_into_usage_metadata", async () => {
    const exchange = fixture("text");
    const { fetch } = capture(exchange);
    const provider = createLiteLLMProvider({ apiKey: async () => secret, fetch });
    const events = await collectProviderEvents(provider, request());
    const usage = events.find((event) => event.type === "usage");
    const done = events.find((event) => event.type === "done");
    const expected = readLiteLLMHeaders(headersOf(exchange), "any");
    for (const event of [usage, done]) {
      if (!event || (event.type !== "usage" && event.type !== "done") || !event.usage) throw new Error("missing usage");
      const litellm = event.usage.metadata?.litellm as JsonObject;
      assert.equal(typeof litellm?.callId, "string");
      assert.equal(litellm?.modelId, expected.modelId);
      assert.equal(litellm?.modelGroup, expected.modelGroup);
      assert.equal(litellm?.version, expected.version);
      assert.equal(litellm?.apiBase, undefined, "the capture carries no api base header");
    }
  });

  it("litellm_api_base_reduced_to_origin_and_long_values_dropped", () => {
    const headers = new Headers({
      "x-litellm-call-id": "id-1",
      "x-litellm-model-api-base": "https://user:pass@internal.example:8443/v1/proxy?key=leak",
      "x-litellm-model-id": "x".repeat(300),
      "x-litellm-model-group": "prism-free/chat",
    });
    const telemetry = readLiteLLMHeaders(headers, "id-1");
    assert.equal(telemetry.apiBase, "https://internal.example:8443", "path, query and credentials never surface");
    assert.equal(telemetry.modelId, undefined, "an oversized value is dropped, not truncated");
    assert.equal(telemetry.modelGroup, "prism-free/chat");
  });

  it("litellm_concurrent_calls_keep_metadata_apart", async () => {
    // Two interleaved streams: each response names its own deployment, and each usage carries its own id.
    const deployments = ["chat-scout", "chat-nemotron"];
    let call = 0;
    const fetchImpl = (async () => {
      const id = deployments[call++ % deployments.length]!;
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: id }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { headers: { "content-type": "text/event-stream", "x-litellm-model-id": id } });
    }) as typeof fetch;
    const provider = createLiteLLMProvider({ apiKey: async () => secret, fetch: fetchImpl });
    const [first, second] = await Promise.all([
      collectProviderEvents(provider, request()),
      collectProviderEvents(provider, request()),
    ]);
    const idOf = (events: readonly ProviderEvent[]) => {
      const usage = events.find((event) => event.type === "usage");
      return usage?.type === "usage" ? (usage.usage.metadata?.litellm as JsonObject) : undefined;
    };
    assert.notEqual(idOf(first)?.callId, idOf(second)?.callId);
    assert.equal(idOf(first)?.modelId, "chat-scout");
    assert.equal(idOf(second)?.modelId, "chat-nemotron");
  });

  it("litellm_cost_from_header_or_catalog", async () => {
    const withCost = async (value: string | undefined) => {
      const base = fixture("text");
      const headers = { ...(base.headers as Record<string, string>) };
      if (value === undefined) delete headers["x-litellm-response-cost"];
      else headers["x-litellm-response-cost"] = value;
      const { fetch } = capture({ ...base, headers });
      const events = await collectProviderEvents(createLiteLLMProvider({ apiKey: async () => secret, fetch }), request());
      const usage = events.find((event) => event.type === "usage");
      return usage?.type === "usage" ? usage.usage : undefined;
    };
    assert.equal((await withCost("0.0000285"))?.cost, 0.0000285);
    assert.equal((await withCost("0"))?.cost, 0);
    assert.equal((await withCost(undefined))?.cost, undefined, "the kernel prices from the catalog instead");
    assert.equal((await withCost("-1"))?.cost, undefined);
    assert.equal((await withCost("NaN"))?.cost, undefined);
  });

  it("litellm_no_markers_by_default_and_prefix_stable", async () => {
    const exchanges = fixture("cache") as unknown as JsonObject[];
    const bodies: JsonObject[] = [];
    const replay = replayFetch(exchanges as never);
    const provider = createLiteLLMProvider({
      apiKey: async () => secret,
      fetch: (async (input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return replay(input, init);
      }) as typeof fetch,
    });
    for (let turn = 0; turn < 3; turn++) await collectProviderEvents(provider, request());
    assert.equal(bodies.length, 3);
    for (const body of bodies) assert.equal(JSON.stringify(body).includes("cache_control"), false, "no markers by default");
    const prefix = (body: JsonObject) => JSON.stringify(body.messages);
    assert.equal(prefix(bodies[0]!), prefix(bodies[2]!), "the warm prefix is byte-identical across turns");
  });

  it("litellm_cache_blocks_opt_in", async () => {
    const { seen, fetch } = capture();
    const provider = createLiteLLMProvider({ apiKey: async () => secret, fetch });
    const blocks: ModelConfig = { ...chatModel, compat: { ...chatModel.compat, cacheControl: "anthropic-blocks" } };
    await collectProviderEvents(provider, request(blocks, { options: { cacheRetention: "short" } }));
    assert.equal(JSON.stringify(seen[0]?.body).includes('"cache_control"'), true, "the opt-in route marks the prefix");
    const plain = capture();
    await collectProviderEvents(createLiteLLMProvider({ apiKey: async () => secret, fetch: plain.fetch }), request());
    assert.equal(JSON.stringify(plain.seen[0]?.body).includes("cache_control"), false);
  });

  it("litellm_strips_unsupported_cache_params", async () => {
    const { seen, fetch } = capture();
    const provider = createLiteLLMProvider({ apiKey: async () => secret, fetch });
    await collectProviderEvents(provider, request(chatModel, { options: { cacheKey: "session-abc", cacheRetention: "long" } }));
    const body = seen[0]?.body ?? {};
    // The proxy accepts both fields (Task 1b) but backends behind it mostly drop them, and Prism's
    // marker-free policy keeps the body minimal; proxy-side injection is the operator's lever.
    assert.equal("prompt_cache_key" in body, false);
    assert.equal("prompt_cache_retention" in body, false);
  });

  it("litellm_usage_cache_fields", () => {
    const mapped = mapLiteLLMUsage({
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 40, cache_creation_input_tokens: 10 },
    });
    assert.equal(mapped?.inputTokens, 100);
    assert.equal(mapped?.cacheReadTokens, 40);
    assert.equal(mapped?.cacheWriteTokens, 10);
    const anthropic = mapLiteLLMUsage({ prompt_tokens: 100, completion_tokens: 5, cache_read_input_tokens: 30 });
    assert.equal(anthropic?.cacheReadTokens, 30, "a Messages backend leaks the Anthropic fields");
    assert.equal(anthropic?.cacheWriteTokens, undefined, "an absent field stays undefined, never 0");
    const reasoning = mapLiteLLMUsage({ prompt_tokens: 10, completion_tokens: 4 }, { completion_tokens_details: { reasoning_tokens: 3 } });
    assert.equal((reasoning?.metadata?.litellm as JsonObject)?.reasoningTokens, 3);
  });

  it("litellm_error_mapping", async () => {
    const unauthorized = await classify(401, String(fixture("error-unauthorized").responseBody));
    assert.equal(unauthorized.failureClass, "auth");
    assert.match(unauthorized.message, /LITELLM_API_KEY/);
    assert.equal(unauthorized.message.includes("f31ad3f5"), false, "the key hash in the body is redacted");
    assert.equal(unauthorized.message.includes("sk-..."), false, "the key fingerprint is redacted");

    const unknown = await classify(400, String(fixture("error-unknown-model").responseBody));
    assert.equal(unknown.failureClass, "permanent");
    assert.match(unknown.message, /\/model\/info/);

    const budget = await classify(422, String(fixture("error-budget").responseBody));
    assert.equal(budget.failureClass, "permanent", "a spent budget is not worth retrying");
    assert.match(budget.message, /budget is spent/);

    const throttled = await classify(429, String(fixture("error-rate-limit").responseBody));
    assert.equal(throttled.failureClass, "rate_limited");

    const cooldown = await classify(429, String(fixture("error-cooldown").responseBody));
    assert.equal(cooldown.failureClass, "rate_limited");

    const overflow = await classify(413, String(fixture("error-overflow").responseBody));
    assert.equal(overflow.failureClass, "context_overflow", "the Workers AI phrase is normalized for the shared classifier");

    assert.equal((await classify(502, "bad gateway")).failureClass, "transient");
    assert.equal(litellmHttpError(new Response("", { status: 401 }), `bad ${secret}`, [secret]).message.includes(secret), false);
  });

  it("litellm_error_names_the_call_id", async () => {
    const provider = createLiteLLMProvider({
      apiKey: async () => secret,
      fetch: (async () =>
        new Response(String(fixture("error-unauthorized").responseBody), {
          status: 401,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    const error = errorEvent(await collectProviderEvents(provider, request()));
    assert.match(error.message, /\(litellm call id [0-9a-f-]{36}\)$/);
  });

  it("litellm_mid_stream_error_surfaces", async () => {
    const frames = [
      'data: {"error":{"message":"upstream failed","type":"provider_error"}}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\ndata: [DONE]\n\n',
    ];
    for (const sse of frames) {
      const provider = createLiteLLMProvider({
        apiKey: async () => secret,
        fetch: (async () => new Response(sse, { headers: { "content-type": "text/event-stream" } })) as typeof fetch,
      });
      const events = await collectProviderEvents(provider, request());
      assert.equal(events.at(-1)?.type, "error", "a mid-stream failure is never a silent end_turn");
    }
  });

  it("litellm_overflow_classified_and_recovered", async () => {
    const { litellmOverflowSession } = await import("./overflow-session.js");
    await litellmOverflowSession(fixture("error-overflow") as never);
  });
});

describe("LiteLLM catalog", () => {
  it("group_litellm_model_info_conservative", () => {
    const grouped = groupLiteLLMModelInfo([
      {
        model_name: "grp",
        model_info: {
          mode: "chat",
          max_input_tokens: 200_000,
          max_output_tokens: 8_000,
          input_cost_per_token: 1e-6,
          output_cost_per_token: 2e-6,
          supports_function_calling: true,
          supports_vision: true,
          supports_reasoning: true,
          litellm_provider: "openai",
        },
      },
      {
        model_name: "grp",
        model_info: {
          mode: "chat",
          max_input_tokens: 100_000,
          max_output_tokens: 4_000,
          input_cost_per_token: 3e-6,
          output_cost_per_token: 1e-6,
          supports_function_calling: true,
          supports_vision: null,
          supports_reasoning: false,
          litellm_provider: "azure",
        },
      },
      { model_name: "*", model_info: { mode: "chat", max_input_tokens: 1, supports_function_calling: true } },
      { model_name: "embed", model_info: { mode: "embedding", max_input_tokens: 8_000 } },
    ]);
    assert.equal(grouped.length, 1, "wildcard and non-chat groups are skipped");
    const [group] = grouped;
    assert.equal(group?.model, "grp");
    assert.equal(group?.limits?.contextWindow, 100_000, "the smallest window across deployments");
    assert.equal(group?.limits?.maxOutputTokens, 4_000);
    assert.equal(group?.capabilities?.tools, true, "both deployments support tools");
    assert.equal(group?.capabilities?.reasoning, false, "one deployment says no");
    assert.deepEqual(group?.capabilities?.input, ["text"], "a null vision flag is not a claim");
    assert.equal(group?.capabilities?.structuredOutput, false);
    assert.equal(group?.cost?.input, 3, "the maximum per-token cost, per million");
    assert.equal(group?.cost?.output, 2);
    assert.equal(group?.compat?.deployments, 2);
    assert.deepEqual(group?.compat?.litellmProviders, ["azure", "openai"]);

    const unknown = groupLiteLLMModelInfo([{ model_name: "free", model_info: { mode: "chat" } }]);
    assert.equal(unknown[0]?.cost, undefined, "unknown cost stays undefined, never zero");
    assert.equal(unknown[0]?.limits?.contextWindow, undefined);
  });

  it("list_litellm_models_reads_model_info", async () => {
    const urls: string[] = [];
    const discovered = await (
      await import("../models.js")
    ).listLiteLLMModels({
      apiKey: async () => secret,
      fetch: (async (input, init) => {
        urls.push(String(input));
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
        return Response.json({ data: modelInfo.data });
      }) as typeof fetch,
    });
    assert.deepEqual(urls, ["http://127.0.0.1:4000/model/info"]);
    assert.equal(discovered.length, 2);
    const chat = discovered.find((model) => model.model === "prism-free/chat");
    assert.equal(chat?.limits?.contextWindow, 131_000, "the smaller of scout (131k) and nemotron (256k)");
    assert.equal(chat?.capabilities?.tools, true);
    assert.ok(Math.abs((chat?.cost?.input ?? 0) - 0.5) < 1e-9, "the more expensive deployment prices the group");
  });

  it("list_litellm_models_falls_back_to_ids_only", async () => {
    const urls: string[] = [];
    const discovered = await (
      await import("../models.js")
    ).listLiteLLMModels({
      fetch: (async (input) => {
        urls.push(String(input));
        if (String(input).endsWith("/model/info")) return Response.json({ error: "forbidden" }, { status: 403 });
        return Response.json({ data: [{ id: "prism-free/chat" }, { id: "*" }] });
      }) as typeof fetch,
    });
    assert.deepEqual(urls, ["http://127.0.0.1:4000/model/info", "http://127.0.0.1:4000/v1/models"]);
    assert.equal(discovered.length, 1, "the wildcard id is not a model");
    assert.equal(discovered[0]?.capabilities?.tools, undefined, "no capability is claimed from ids alone");
  });

  it("litellm_missing_key_sends_no_authorization", async () => {
    const { seen, fetch } = capture();
    const provider = createLiteLLMProvider({ fetch });
    await collectProviderEvents(provider, request());
    assert.equal(seen[0]?.headers.has("authorization"), false);

    // A synchronous generator yields nothing before the first await, so an async provider holds.
    const asyncProvider: ModelProvider = provider;
    assert.equal(typeof asyncProvider.generate, "function");
  });
});
