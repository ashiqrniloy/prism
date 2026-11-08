import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ModelConfig, ProviderEvent, ProviderRequest } from "../contracts.js";
import { DecisionsError } from "../contracts.js";
import { createSystemOneDecisionProvider } from "../provider-kit/systemone-provider.js";

interface FakeCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function fakeFetch(handler: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TEXT_MODEL: ModelConfig = {
  provider: "typesafe",
  model: "jev-latest",
  capabilities: { input: ["text"], structuredOutput: "json_schema", decisions: true },
};
const IMAGE_MODEL: ModelConfig = {
  provider: "typesafe",
  model: "jev-vision",
  capabilities: { input: ["image"], structuredOutput: "json_schema", decisions: true },
};

const QUESTIONS = {
  urgent: { type: "noul", instructions: "Is the customer blocked?" },
  team: { type: "choice", instructions: "Which team owns this?", criteria: { billing: null, shipping: null } },
  severity: { type: "score", instructions: "How severe?", criteria: ["low", "high"] },
} as const;

const DECIDE_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    urgent: { type: "noul", noul: 0.93 },
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.7, shipping: 0.3 }, confidence: 0.7 },
    severity: { type: "score", score: 1.4, legend: { "1": "low", "2": "high" }, confidence: 0.6 },
  },
  usage: { input_tokens: 64, output_tokens: 0 },
};

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function provider(fetchImpl: typeof fetch, overrides: { path?: string; models?: readonly ModelConfig[] } = {}) {
  return createSystemOneDecisionProvider({
    id: "typesafe",
    label: "TypeSafe Jev",
    baseUrl: "https://api.typesafe.ai",
    apiKey: async () => "sk-secret",
    fetch: fetchImpl,
    maxRetries: 0,
    models: overrides.models ?? [TEXT_MODEL, IMAGE_MODEL],
    path: overrides.path,
  });
}

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function generateRequest(model: ModelConfig, messages: ProviderRequest["messages"]): ProviderRequest {
  return {
    model,
    messages,
    options: {
      structuredOutput: {
        name: "decision",
        schema: { type: "object", properties: { risky: { type: "boolean", description: "Is it risky?" } } },
      },
    },
  };
}

describe("@arnilo/prism/provider-kit (systemone decide)", () => {
  it("systemone_decide_returns_raw_answers_with_probabilities", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(DECIDE_RESPONSE));
    const result = await provider(impl).decisions!().decide({ model: "jev-latest", state: "ticket", questions: QUESTIONS });
    assert.deepEqual(result.answers, DECIDE_RESPONSE.answers);
    assert.equal(result.model, "jev-1.13.0");
    assert.deepEqual(result.usage, { inputTokens: 64, outputTokens: 0, totalTokens: 64 });
    assert.ok(typeof result.timingMs === "number");
    assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), {
      model: "jev-latest",
      state: "ticket",
      questions: QUESTIONS,
    });
  });

  it("systemone_text_only_body_is_unchanged_and_unknown_pins_are_allowed", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(DECIDE_RESPONSE));
    await provider(impl).decisions!().decide({ model: "jev-1.13.0", state: "ticket", questions: QUESTIONS });
    const body = JSON.parse(calls[0]!.init?.body as string);
    assert.equal("images" in body, false, "an empty image list is omitted");
    assert.equal(body.model, "jev-1.13.0", "a versioned pin outside the catalog is trusted to the caller");
  });

  it("systemone_compile_state_moves_image_parts_to_images_on_generate", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ model: "jev-vision", answers: { risky: { type: "noul", noul: 0.2 } } }));
    const events = await collect(
      provider(impl).generate(
        generateRequest(IMAGE_MODEL, [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this?" },
              { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
            ],
          },
        ]),
      ),
    );
    assert.equal(events.at(-1)?.type, "done");
    const body = JSON.parse(calls[0]!.init?.body as string);
    assert.equal(body.state, "what is this?");
    assert.deepEqual(body.images, [PNG]);
  });

  it("systemone_rejects_image_for_text_only_model_before_fetch", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ model: "jev-latest", answers: { risky: { type: "noul", noul: 0.2 } } }));
    const events = await collect(
      provider(impl).generate(
        generateRequest(TEXT_MODEL, [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this?" },
              { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
            ],
          },
        ]),
      ),
    );
    const terminal = events.at(-1);
    assert.equal(terminal?.type, "error");
    assert.match(terminal?.type === "error" ? terminal.error.message : "", /does not support image/);
    assert.equal(calls.length, 0, "the capability gate runs before fetch");

    let rejected: unknown;
    try {
      await provider(impl).decisions!().decide({ model: "jev-latest", state: "ticket", questions: QUESTIONS, images: [PNG] });
    } catch (error) {
      rejected = error;
    }
    assert.ok(rejected instanceof DecisionsError);
    assert.equal(rejected.code, "invalid_request");
    assert.equal(calls.length, 0, "the decide image gate runs before fetch");
  });

  it("systemone_custom_path_is_used_and_must_start_with_slash", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(DECIDE_RESPONSE));
    await provider(impl, { path: "/providers/microsoft/v1/systemone" }).decisions!().decide({
      model: "jev-latest",
      state: "ticket",
      questions: QUESTIONS,
    });
    assert.equal(calls[0]!.url, "https://api.typesafe.ai/providers/microsoft/v1/systemone");
    assert.throws(() => provider(impl, { path: "v1/systemone" }), /must start with/);
  });
});
