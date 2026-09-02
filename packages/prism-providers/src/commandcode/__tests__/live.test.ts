import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderStreamConforms,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import { commandCodeModels, createCommandCodeProvider } from "../index.js";

// Env-gated live probes for @arnilo/prism-providers/commandcode.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `COMMAND_CODE_API_KEY` are set. The default
// `npm test` and CI release verification never set these. To run locally:
//
//   PRISM_LIVE_PROVIDER_TESTS=1 COMMAND_CODE_API_KEY=cmd_... \
//     npm run test --workspace=@arnilo/prism-providers/commandcode
//
// Security: the key is read from the env and used only for auth; it is never
// logged. `assertNoSecretLeak` verifies the key value does not appear in any
// streamed event. Prompts are non-sensitive. Probes are bounded to a few
// cheap requests (Qwen/Qwen3.8-Flash $0.16/$0.47 per M tokens; a ~1.3 KiB
// prefix ≈ $0.0001 per turn; claude-haiku-4-5-20251001 $1/$5 with a ~600-token
// prefix ≈ $0.0006 per turn; gpt-5.6-luna $0.2/$1.2). Total burn < $0.01.
//
// The cache/effort probes are the documented-unknown resolvers (plan Task 5):
// their assertions encode what the docs claim (aggregator passes through
// upstream behavior), so a probe failure IS the finding — record it in
// docs/providers/commandcode.md and adjust the mapping. The GPT-5.6 probe
// decides whether Task 9 (explicit `prompt_cache_key` support) proceeds or
// closes with a recorded negative.

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.COMMAND_CODE_API_KEY;
const skip: string | false =
  !LIVE || !API_KEY ? "set PRISM_LIVE_PROVIDER_TESTS=1 and COMMAND_CODE_API_KEY to run live Command Code smoke probes" : false;

// Cheap probe models (per plan Task 5 cost budget):
// chat route → Qwen/Qwen3.8-Flash ($0.16/$0.47); messages route →
// claude-haiku-4-5-20251001 ($1/$5); GPT-5.6 explicit-cache probe →
// gpt-5.6-luna ($0.2/$1.2).
const chatModel = commandCodeModels.find((m) => m.model === "Qwen/Qwen3.8-Flash")!;
const messagesModel = commandCodeModels.find((m) => m.model === "claude-haiku-4-5-20251001")!;
const gpt56Model = commandCodeModels.find((m) => m.model === "gpt-5.6-luna")!;

const apiKey = (): string | undefined => process.env.COMMAND_CODE_API_KEY;

function provider() {
  return createCommandCodeProvider({ apiKey });
}

// Reusable non-sensitive prefix so two-turn probes exercise the exact-prefix cache.
const cachePrefix =
  "Memory is the residue of thought. We remember what we think about, not what we merely see. " +
  "This is why active recall outperforms passive rereading: retrieval re-weaves the trace. " +
  "Spacing practice widens the window in which a trace survives. Interleaving forces discrimination. " +
  "Elaboration binds new traces to old. Each of these effects is small alone and large together. ".repeat(8);

function usageOf(events: readonly ProviderEvent[]): Usage | undefined {
  return events.find((e) => e.type === "usage")?.usage;
}

describe("@arnilo/prism-providers/commandcode live probes", () => {
  it("live_chat_route_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live chat-route text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_messages_route_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: {
        model: messagesModel,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
      },
    });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live messages-route text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const getWeatherTool: ToolDefinition = {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
    };
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: {
        model: chatModel,
        messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
        tools: [getWeatherTool],
      },
    });
    const toolCalls = events.filter((e: ProviderEvent) => e.type === "tool_call");
    assert.ok(toolCalls.length > 0, "live tool prompt produced no tool calls");
    for (const call of toolCalls) if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({
      provider: provider(),
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events = await collectProviderEvents(provider(), { model: chatModel, messages: [] });
    const terminal = events.at(-1);
    assert.ok(terminal, "live error request produced no events");
    assert.equal(terminal?.type, "error", "invalid request unexpectedly succeeded");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_chat_route_reports_cached_tokens_on_warm_prefix_replay", { skip }, async () => {
    // Implicit-caching probe (chat route): same exact prefix on two turns;
    // the second must surface cached input tokens through the shared mapping
    // (prompt_tokens_details.cached_tokens or prompt_cache_hit_tokens).
    const turn = (label: string): Promise<readonly ProviderEvent[]> =>
      assertProviderStreamConforms({
        provider: provider(),
        request: {
          model: chatModel,
          messages: [
            { role: "user", content: [{ type: "text", text: cachePrefix }] },
            { role: "user", content: [{ type: "text", text: `Reply with exactly the word: ${label}` }] },
          ],
        },
      });
    const first = await turn("one");
    const second = await turn("two");
    const firstUsage = usageOf(first);
    const secondUsage = usageOf(second);
    // eslint-disable-next-line no-console
    console.info(
      `[commandcode live] chat-route cache probe: turn1 {read:${firstUsage?.cacheReadTokens ?? 0}, write:${firstUsage?.cacheWriteTokens ?? 0}} ` +
        `turn2 {read:${secondUsage?.cacheReadTokens ?? 0}, write:${secondUsage?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok(
      (secondUsage?.cacheReadTokens ?? 0) > 0,
      `warm chat-route replay reported no cached tokens ` +
        `(turn2 usage=${JSON.stringify(secondUsage)}). Finding: implicit caching does not surface ` +
        `cached_tokens/prompt_cache_hit_tokens — record in docs/providers/commandcode.md.`,
    );
    assertNoSecretLeak(second, [API_KEY!]);
  });

  it("live_messages_route_cache_control_reports_creation_and_read_tokens", { skip }, async () => {
    // Explicit-write probe (cache_control model): system_prompt breakpoint on
    // the Anthropic route; call A creates the cache entry, warm call B reads it.
    const request = (): ProviderRequest => ({
      model: messagesModel,
      messages: [{ role: "system", content: [{ type: "text", text: cachePrefix }] }],
      options: { cache: { breakpoints: [{ location: "system_prompt" }] } },
    });
    const create = await assertProviderStreamConforms({ provider: provider(), request: request() });
    const warm = await assertProviderStreamConforms({ provider: provider(), request: request() });
    const createUsage = usageOf(create);
    const warmUsage = usageOf(warm);
    // eslint-disable-next-line no-console
    console.info(
      `[commandcode live] messages-route cache probe: create {write:${createUsage?.cacheWriteTokens ?? 0}, read:${createUsage?.cacheReadTokens ?? 0}} ` +
        `warm {read:${warmUsage?.cacheReadTokens ?? 0}, write:${warmUsage?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok(
      (createUsage?.cacheWriteTokens ?? 0) > 0,
      `cache_control create call reported no cache_creation_input_tokens ` +
        `(create usage=${JSON.stringify(createUsage)}). Finding: markers are not honored on the ` +
        `messages route — downgrade Claude models to kind "implicit" and record in docs/providers/commandcode.md.`,
    );
    assert.ok(
      (warmUsage?.cacheReadTokens ?? 0) > 0,
      `warm messages-route replay reported no cache_read_input_tokens ` +
        `(warm usage=${JSON.stringify(warmUsage)}). Finding: TTL may be shorter than a request — ` +
        `record in docs/providers/commandcode.md before depending on cross-request caching.`,
    );
    assertNoSecretLeak(warm, [API_KEY!]);
  });

  it("live_gpt56_prompt_cache_key_passthrough_probe", { skip }, async () => {
    // GPT-5.6 explicit-caching probe: the docs price cache writes for the
    // GPT-5.6 tiers but never document `prompt_cache_key` on the chat route.
    // Inject the OpenAI explicit-cache field on two identical turns; the
    // outcome decides Task 9:
    //   - 400 → not passthrough; keep implicit, close Task 9 with a recorded negative.
    //   - accepted but no cached tokens on warm replay → pass-through not
    //     honored (or cache evicted); keep implicit, record finding.
    //   - accepted + warm cached tokens → explicitBreakpoints upgrade (Task 9).
    const CACHE_KEY = "prism-probe-9f3d"; // ≤ 64 chars, stable across turns
    const baseFetch = globalThis.fetch;
    let lastBody: string | undefined;
    const probing = createCommandCodeProvider({
      apiKey,
      fetch: async (input, init) => {
        const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        parsed.prompt_cache_key = CACHE_KEY;
        lastBody = JSON.stringify(parsed);
        return baseFetch(input, { ...init, body: lastBody });
      },
    });
    const turn = (label: string): Promise<readonly ProviderEvent[]> =>
      assertProviderStreamConforms({
        provider: probing,
        request: {
          model: gpt56Model,
          messages: [
            { role: "user", content: [{ type: "text", text: cachePrefix }] },
            { role: "user", content: [{ type: "text", text: `Reply with exactly the word: ${label}` }] },
          ],
        },
      });
    const first = await turn("one");
    const second = await turn("two");
    const firstTerminal = first.at(-1);
    assert.equal(
      firstTerminal?.type,
      "done",
      `prompt_cache_key rejected (terminal=${firstTerminal?.type}) — keep GPT-5.6 implicit and record the negative`,
    );
    assert.ok(lastBody?.includes('"prompt_cache_key"'), `wire body missing prompt_cache_key: ${lastBody}`);
    const warmUsage = usageOf(second);
    // eslint-disable-next-line no-console
    console.info(
      `[commandcode live] GPT-5.6 cache-key probe: turn1 {read:${usageOf(first)?.cacheReadTokens ?? 0}, write:${usageOf(first)?.cacheWriteTokens ?? 0}} ` +
        `turn2 {read:${warmUsage?.cacheReadTokens ?? 0}, write:${warmUsage?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok(
      (warmUsage?.cacheReadTokens ?? 0) > 0,
      `prompt_cache_key accepted but warm replay reported no cached tokens ` +
        `(turn2 usage=${JSON.stringify(warmUsage)}). Finding: explicit cache key is pass-through but not ` +
        `honored (or the entry evicted) — keep GPT-5.6 implicit and record in docs/providers/commandcode.md.`,
    );
    assertNoSecretLeak(second, [API_KEY!]);
  });

  it("live_reasoning_effort_is_accepted_on_chat_route", { skip }, async () => {
    // Reasoning-param probe: the docs never document a reasoning parameter on
    // the chat route; probe whether the OpenAI-standard `reasoning_effort`
    // field is accepted (200) or rejected (400). A rejected value means any
    // future effort support must be dropped from the mapping.
    const baseFetch = globalThis.fetch;
    let capturedBody: string | undefined;
    const probing = createCommandCodeProvider({
      apiKey,
      fetch: async (input, init) => {
        const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        parsed.reasoning_effort = "low"; // lowest documented OpenAI effort value
        capturedBody = JSON.stringify(parsed);
        return baseFetch(input, { ...init, body: capturedBody });
      },
    });
    const events = await assertProviderStreamConforms({
      provider: probing,
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
    assert.equal(events.at(-1)?.type, "done", `Command Code rejected reasoning_effort=low — record finding and never emit effort values`);
    assert.ok(capturedBody?.includes('"reasoning_effort":"low"'), `wire body missing reasoning_effort: ${capturedBody}`);
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_zdr_route_probe_is_opt_in_and_routable", { skip }, async () => {
    // ZDR probe: the docs claim x-cmd-zdr: 1 routes only through ZDR-capable
    // upstreams (which may cost more, and may not exist for a given model →
    // 422 cmd_zdr_no_providers). Opt-in here: clearly labeled, uses the
    // cheapest chat model, and records either outcome — a 422 is a valid
    // finding, not a probe failure; any other terminal is a finding too.
    const probing = createCommandCodeProvider({ apiKey, zdr: true });
    const events = await assertProviderStreamConforms({
      provider: probing,
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
    const terminal = events.at(-1);
    // eslint-disable-next-line no-console
    console.info(`[commandcode live] ZDR probe terminal: ${terminal?.type}`);
    if (terminal?.type === "error") {
      const err = (terminal as { error?: { code?: number; message?: string } }).error;
      assert.equal(
        err?.code,
        422,
        `ZDR request failed with ${err?.code} (${err?.message}) — record finding; expected done or 422 cmd_zdr_no_providers`,
      );
      assert.match(String(err?.message), /cmd_zdr_no_providers/);
      // eslint-disable-next-line no-console
      console.info("[commandcode live] ZDR probe finding: no ZDR-capable upstream for Qwen/Qwen3.8-Flash (422)");
    } else {
      assert.equal(terminal?.type, "done", `unexpected terminal ${terminal?.type}`);
      assertNoSecretLeak(events, [API_KEY!]);
    }
  });
});
