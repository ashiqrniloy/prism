import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, AgentSession, ProviderEvent, RunLimits } from "../index.js";
import {
  createAgent,
  createMemorySessionStore,
  mapProviderStopReason,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible.js";

/** Every native reason the first-party adapters can surface, mapped by the one shared table. */
const NATIVE_CASES: readonly (readonly [string, string])[] = [
  // OpenAI Chat Completions (`finish_reason`) — also OpenRouter/DeepSeek/xAI/Z.AI/Ollama/…
  ["stop", "end_turn"],
  ["length", "max_output_tokens"],
  ["tool_calls", "tool_calls"],
  ["function_call", "tool_calls"],
  ["content_filter", "content_filter"],
  // Anthropic Messages / Kimi (`stop_reason`)
  ["end_turn", "end_turn"],
  ["stop_sequence", "end_turn"],
  ["pause_turn", "end_turn"],
  ["tool_use", "tool_calls"],
  ["max_tokens", "max_output_tokens"],
  ["refusal", "content_filter"],
  // Google generateContent (`finishReason`)
  ["STOP", "end_turn"],
  ["MAX_TOKENS", "max_output_tokens"],
  ["SAFETY", "content_filter"],
  ["PROHIBITED_CONTENT", "content_filter"],
  ["MALFORMED_FUNCTION_CALL", "provider_error"],
  ["OTHER", "unknown"],
  // Bedrock Converse (`stopReason`)
  ["guardrail_intervened", "content_filter"],
  ["malformed_tool_use", "provider_error"],
  // OpenAI Responses (status / incomplete_details.reason)
  ["completed", "end_turn"],
  ["failed", "provider_error"],
  ["cancelled", "abort"],
  // AI SDK unified finish reasons
  ["content-filter", "content_filter"],
  ["tool-calls", "tool_calls"],
  ["error", "provider_error"],
  ["other", "unknown"],
];

const TAXONOMY = new Set(["end_turn", "tool_calls", "max_output_tokens", "content_filter", "abort", "provider_error", "unknown"]);

function sse(lines: readonly string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      controller.close();
    },
  });
}

function okFetch(lines: readonly string[]): typeof fetch {
  return async () => new Response(sse(lines), { status: 200 });
}

async function collect(provider: ReturnType<typeof createOpenAICompatibleProvider>): Promise<readonly ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate({
    model: { provider: provider.id, model: "demo" },
    messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })) {
    events.push(event);
  }
  return events;
}

/** Run a session and collect every event, so `provider_turn_finished` metadata can be asserted. */
async function collectRun(session: AgentSession, input: string, limits?: RunLimits) {
  const events: AgentEvent[] = [];
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  const outcome = await session.run(input, limits ? { limits } : {}).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  await pump;
  return { events, ...outcome };
}

describe("provider stop-reason taxonomy (plan 087 T1)", () => {
  it("maps every protocol's native reason through the shared table", () => {
    for (const [native, expected] of NATIVE_CASES) {
      const mapped = mapProviderStopReason(native);
      assert.equal(mapped, expected, `${native} must map to ${expected}`);
      assert.ok(TAXONOMY.has(mapped), `${mapped} must be a taxonomy member`);
    }
  });

  it("returns unknown for missing, unmapped, or non-string native reasons", () => {
    assert.equal(mapProviderStopReason("totally-new-wire-value"), "unknown");
    assert.equal(mapProviderStopReason(undefined), "unknown");
    assert.equal(mapProviderStopReason(null), "unknown");
    assert.equal(mapProviderStopReason(42 as unknown as string), "unknown");
  });

  it("providerDone carries the mapped reason only when one is known", () => {
    assert.deepEqual(providerDone(), { type: "done", usage: undefined });
    assert.deepEqual(providerDone(undefined, "max_output_tokens"), { type: "done", usage: undefined, stopReason: "max_output_tokens" });
  });

  it("openai-compatible finish_reason length reaches done as max_output_tokens", async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      fetch: okFetch([JSON.stringify({ choices: [{ delta: { content: "truncated" }, finish_reason: "length" }] }), "[DONE]"]),
    });
    const done = (await collect(provider)).at(-1);
    assert.equal(done?.type, "done");
    assert.equal(done?.type === "done" ? done.stopReason : undefined, "max_output_tokens");
  });

  it("provider_turn_finished carries stopReason and the effective budget snapshot", async () => {
    const agent = createAgent({
      id: "stop-reason-budget",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo", limits: { contextWindow: 100_000 } },
      provider: {
        id: "mock",
        async *generate() {
          yield { type: "usage" as const, usage: { inputTokens: 500, outputTokens: 7, totalTokens: 507 } };
          yield providerTextDelta("done");
          yield providerDone(undefined, "end_turn");
        },
      },
    });
    const session = agent.createSession({ id: "stop-reason-session" });
    const { events, error } = await collectRun(session, "hi", { maxTurns: 5, maxInputTokens: 1000 });
    assert.equal(error, undefined, String(error));

    const finished = events.filter((event) => event.type === "provider_turn_finished");
    assert.equal(finished.length, 1);
    const metadata = finished[0].type === "provider_turn_finished" ? finished[0].metadata : undefined;
    assert.equal(metadata?.stopReason, "end_turn");
    assert.deepEqual(metadata?.budgets, {
      inputTokens: 500,
      inputCap: 98_976,
      runInputBudget: 1000,
      runInputUsed: 500,
      turns: 1,
      maxTurns: 5,
    });
  });

  it("a completed turn that produced tool calls is attributed to tool_calls", async () => {
    let turn = 0;
    const agent = createAgent({
      id: "stop-reason-tools",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call" as const, call: toolCallContent("call-1", "digest", {}) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [{ name: "digest", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "digest", value: "ok" }) }],
    });
    const session = agent.createSession({ id: "stop-reason-tools-session" });
    const { events, error } = await collectRun(session, "investigate");
    assert.equal(error, undefined, String(error));
    const reasons = events
      .filter((event) => event.type === "provider_turn_finished")
      .map((event) => (event.type === "provider_turn_finished" ? event.metadata.stopReason : undefined));
    assert.deepEqual(reasons, ["tool_calls", "end_turn"]);
  });

  it("a provider error attributes the turn to provider_error", async () => {
    const agent = createAgent({
      id: "stop-reason-error",
      store: createMemorySessionStore(),
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          yield { type: "error" as const, error: { message: "boom" } };
        },
      },
    });
    const session = agent.createSession({ id: "stop-reason-error-session" });
    const { events } = await collectRun(session, "hi");
    const finished = events.find((event) => event.type === "provider_turn_finished");
    assert.equal(finished?.type === "provider_turn_finished" ? finished.metadata.stopReason : undefined, "provider_error");
  });
});
