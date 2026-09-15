/** Telemetry (plan 074 Task 6): one redacted `attention_compiled` per mutated turn, counts only,
 *  zero events when the compiler is off or the request is under the ratio. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentConfig,
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

const model: ModelConfig = { provider: "mock", model: "demo" };
const payload = `payload ${"y".repeat(4_000)}`;
const STUB = /omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/;
/** Every field the event may ever carry: identity, the gate inputs, and the mutation counts. */
const EVENT_KEYS = [
  "type",
  "sessionId",
  "runId",
  "used",
  "usedAfter",
  "inputCap",
  "triggerRatio",
  "droppedThinkingTurns",
  "stubbedToolResults",
  "stubbedBytes",
  "truncated",
].sort();

const bigTool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object", properties: {} },
  execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: payload }),
};

function toolThenReply(): { provider: AIProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) yield providerToolCall(toolCallContent("call-1", "echo", {}));
        else yield providerTextDelta(`reply ${requests.length}`);
        yield providerDone();
      },
    },
  };
}

const agentWith = (provider: AIProvider, config: Partial<AgentConfig> = {}) =>
  createAgent({ model, provider, tools: [bigTool], ...config });

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("attention_compiled telemetry", () => {
  it("emits nothing when the compiler is off", async () => {
    const { provider } = toolThenReply();
    const session = agentWith(provider).createSession({ id: "s" });
    const reader = collect(session.subscribe());

    await session.run("seed: use the tool");

    assert.deepEqual(
      (await reader).filter((event) => event.type === "attention_compiled"),
      [],
    );
  });

  it("emits nothing under the ratio", async () => {
    const { provider } = toolThenReply();
    const session = agentWith(provider, { attentionCompiler: { maxInputTokens: 500_000 } }).createSession({ id: "s" });
    const reader = collect(session.subscribe());

    await session.run("seed: use the tool");

    assert.deepEqual(
      (await reader).filter((event) => event.type === "attention_compiled"),
      [],
    );
  });

  it("emits one counts-only event for a mutated turn, before that turn's provider call", async () => {
    const { provider, requests } = toolThenReply();
    const session = agentWith(provider, { attentionCompiler: { maxInputTokens: 120, keepLast: 0 } }).createSession({ id: "s" });
    const reader = collect(session.subscribe());

    await session.run("seed: use the tool");
    const events = await reader;
    const compiled = events.filter((event) => event.type === "attention_compiled");

    assert.ok(compiled[0] && compiled[0].type === "attention_compiled");
    // Round 1 is the tiny pre-tool request (under the ratio, no event); round 2 carries the
    // 4 KB tool result, is over the ratio, and is the one turn that reports a mutation.
    assert.equal(requests.length, 2);
    assert.equal(compiled.length, 1);
    const first = compiled[0];
    assert.equal(first.sessionId, "s");
    assert.equal(typeof first.runId, "string");
    assert.equal(first.inputCap, 120);
    assert.equal(first.triggerRatio, 0.75);
    assert.equal(first.stubbedToolResults, 1);
    assert.equal(first.droppedThinkingTurns, 0);
    assert.equal(first.truncated, false);
    assert.ok(first.used > 0);
    // The cost curve: stubbing the 4 KB payload moved the estimate down, and the byte total
    // reports the payload mass that left the request (never the stub text).
    assert.ok(first.usedAfter < first.used, "usedAfter must be below used on a mutated turn");
    // Message bytes minus the folded header the stub leaves behind, so payload-sized, not exact.
    assert.ok(first.stubbedBytes > 3_000, `stubbedBytes ${first.stubbedBytes} must be payload-sized`);
    assert.ok(first.usedAfter > 0);
    const providerTurns = events.flatMap((event, index) => (event.type === "provider_turn_started" ? [index] : []));
    assert.equal(providerTurns.length, 2);
    const emittedAt = events.indexOf(first);
    assert.equal(emittedAt > (providerTurns[0] ?? -1) && emittedAt < (providerTurns[1] ?? -1), true, "emitted between round 1 and round 2");
    // Payload-free by construction: no field can hold message text, and the stub body never leaks.
    assert.deepEqual(Object.keys(first).sort(), EVENT_KEYS);
    assert.doesNotMatch(JSON.stringify(first), /yyyy|sha256|payload/);
  });

  it("emits one event per mutated turn and reports, but does not delete", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        // Two tool rounds, so two provider rounds carry the aged row and mutate.
        if (requests.length <= 2) yield providerToolCall(toolCallContent(`call-${requests.length}`, "echo", {}));
        else yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const session = agentWith(provider, { attentionCompiler: { maxInputTokens: 120, keepLast: 0 } }).createSession({ id: "s", store });
    const reader = collect(session.subscribe());

    await session.run("seed: use the tool");
    const compiled = (await reader).filter((event) => event.type === "attention_compiled");

    assert.equal(requests.length, 3);
    assert.equal(compiled.length, 2, "each over-ratio round reports, and the pre-tool round does not");
    assert.match(JSON.stringify(requests[2]?.messages), STUB);
    assert.equal(JSON.stringify(await store.list("s")).includes(payload), true, "the payload survives in the store");
  });
});
