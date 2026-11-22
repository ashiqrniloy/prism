import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  createSessionEntry,
  definePackage,
  estimateTextTokens,
  type ModelConfig,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerError,
  providerTextDelta,
  resolveInputCap,
  type SessionEntry,
} from "@arnilo/prism";
import { mockProvider, packageConformance } from "@arnilo/prism/testing";
import { chunkCompactionEntries } from "../chunk.js";
import memoryCompaction from "../index.js";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../prompts.js";
import { serializeCompactionConversation } from "../serialize.js";
import { createLlmCompactor } from "../strategy.js";
import { summaryClient } from "./helpers.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const OUTPUT = 200;
/** A summary model with a small window: 4,000 − 200 output − 1,024 reserve = a 2,776-token input cap. */
const smallModel: ModelConfig = { provider: "mock", model: "summary", limits: { contextWindow: 4_000 } };
const smallCap = resolveInputCap({}, { limits: { contextWindow: 4_000, maxOutputTokens: OUTPUT } });

function entry(index: number, text: string): SessionEntry {
  return createSessionEntry({
    id: `e${index}`,
    parentId: index === 0 ? undefined : `e${index - 1}`,
    sessionId: "s1",
    timestamp,
    kind: "message",
    message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text }] },
  });
}

/** 21 entries, user first and last, each ~500 tokens: the 20 before the kept user message are ~10,000 tokens. */
function oversizedHistory(): SessionEntry[] {
  return Array.from({ length: 21 }, (_, index) => entry(index, `m${index} ${"x".repeat(2_000)}`));
}

/** Answers call N with `summary-N`, or fails on `failOn`. */
function rollingProvider(requests: ProviderRequest[], failOn?: number): ModelProvider {
  return {
    id: "mock",
    async *generate(request): AsyncIterable<ProviderEvent> {
      requests.push(request);
      if (requests.length === failOn) {
        yield providerError(new Error(`chunk ${failOn} failed`));
        return;
      }
      yield providerTextDelta(`summary-${requests.length}`);
      yield providerDone();
    },
  };
}

function promptOf(request: ProviderRequest | undefined): string {
  const block = request?.messages[1]?.content[0];
  return block?.type === "text" ? block.text : "";
}

function requestTokens(request: ProviderRequest): number {
  return request.messages.reduce(
    (sum, message) =>
      sum + message.content.reduce((inner, block) => inner + (block.type === "text" ? estimateTextTokens(block.text) : 0), 0),
    0,
  );
}

describe("LLM compactor over a history larger than its model's window (plan 229 Task 6)", () => {
  it("history_that_fits_makes_one_identical_call", async () => {
    const requests: ProviderRequest[] = [];
    const compactor = createLlmCompactor({
      clientFor: summaryClient(rollingProvider(requests), { ...smallModel, limits: { contextWindow: 1_000_000 } }),
      keepRecentTokens: 0,
      maxSummaryTokens: OUTPUT,
    });
    const entries = [entry(0, "fix the parser"), entry(1, "reading parser.ts"), entry(2, "next")];

    const result = await compactor.compact({ sessionId: "s1", entries });

    assert.equal(requests.length, 1);
    const system = requests[0]?.messages[0]?.content[0];
    assert.equal(system?.type === "text" ? system.text : "", SUMMARIZATION_SYSTEM_PROMPT);
    assert.equal(promptOf(requests[0]), "<conversation>\n[User]\nfix the parser\n\n[Assistant]\nreading parser.ts\n</conversation>");
    assert.equal(result.summary, "summary-1");

    // A model with no declared window is never chunked: one call, as before.
    const unbounded: ProviderRequest[] = [];
    await createLlmCompactor({
      clientFor: summaryClient(rollingProvider(unbounded), { provider: "mock", model: "summary" }),
      keepRecentTokens: 0,
      maxSummaryTokens: OUTPUT,
    }).compact({ sessionId: "s1", entries: oversizedHistory() });
    assert.equal(unbounded.length, 1);
  });

  it("oversized_history_is_summarized_in_rolling_chunks", async () => {
    const requests: ProviderRequest[] = [];
    const compactor = createLlmCompactor({
      clientFor: summaryClient(rollingProvider(requests), smallModel),
      keepRecentTokens: 0,
      maxSummaryTokens: OUTPUT,
    });

    const result = await compactor.compact({ sessionId: "s1", entries: oversizedHistory() });

    assert.ok(requests.length > 1 && requests.length <= 6, `chunked into ${requests.length} calls`);
    for (const request of requests) assert.ok(requestTokens(request) <= smallCap, `request ${requestTokens(request)} > cap ${smallCap}`);
    assert.doesNotMatch(promptOf(requests[0]), /<previous-summary>/, "the first chunk has no earlier summary");
    for (let index = 1; index < requests.length; index += 1)
      assert.match(promptOf(requests[index]), new RegExp(`<previous-summary>\\nsummary-${index}\\n</previous-summary>`));
    // Every dropped entry is summarized exactly once, in order.
    const seen = requests.flatMap((request) => [...promptOf(request).matchAll(/\bm(\d+) x/g)].map((match) => Number(match[1])));
    assert.deepEqual(
      seen,
      Array.from({ length: 20 }, (_, index) => index),
    );
    assert.equal(result.summary, `summary-${requests.length}`, "the last rolling summary is the result");
  });

  it("max_chunks_bounds_calls_and_states_omission", async () => {
    const all: ProviderRequest[] = [];
    await createLlmCompactor({
      clientFor: summaryClient(rollingProvider(all), smallModel),
      keepRecentTokens: 0,
      maxSummaryTokens: OUTPUT,
    }).compact({
      sessionId: "s1",
      entries: oversizedHistory(),
    });
    const total = all.length;
    assert.ok(total > 2);

    const requests: ProviderRequest[] = [];
    const result = await createLlmCompactor({
      clientFor: summaryClient(rollingProvider(requests), smallModel),
      keepRecentTokens: 0,
      maxSummaryTokens: OUTPUT,
      maxChunks: 2,
    }).compact({ sessionId: "s1", entries: oversizedHistory() });

    assert.equal(requests.length, 2);
    assert.match(result.summary, new RegExp(`^\\[Earlier history omitted: the oldest ${total - 2} of ${total} chunks`));
    assert.match(result.summary, /summary-2$/);
    assert.match(promptOf(requests[1]), /\bm19 x/, "the newest chunks are the ones summarized");
    assert.doesNotMatch(promptOf(requests[0]), /\bm0 x/);
    assert.throws(() => createLlmCompactor({ clientFor: summaryClient(rollingProvider([]), smallModel), maxChunks: 0 }), /maxChunks/);
  });

  it("long_text_block_is_capped_with_a_marker", () => {
    const text = serializeCompactionConversation([entry(0, "a".repeat(20_000))]);
    assert.ok(text.length < 8_100);
    assert.match(text, /\[\.\.\., 12000 characters truncated\]/);

    const call = createSessionEntry({
      id: "t",
      sessionId: "s1",
      timestamp,
      kind: "message",
      message: { role: "assistant", content: [{ type: "tool_call", id: "c1", name: "write", arguments: { content: "b".repeat(20_000) } }] },
    });
    const serialized = serializeCompactionConversation([call]);
    assert.ok(serialized.length < 8_200);
    assert.match(serialized, /characters truncated\]/);
    assert.equal(serializeCompactionConversation([entry(0, "a".repeat(20_000))], { maxTextBlockChars: 0 }).length > 20_000, true);
  });

  it("chunk_failure_falls_back_once", async () => {
    // Strategy level: the second chunk fails and no further chunk is attempted.
    const requests: ProviderRequest[] = [];
    await assert.rejects(
      async () =>
        createLlmCompactor({
          clientFor: summaryClient(rollingProvider(requests, 2), smallModel),
          keepRecentTokens: 0,
          maxSummaryTokens: OUTPUT,
        }).compact({
          sessionId: "s1",
          entries: oversizedHistory(),
        }),
      /Summarization failed: chunk 2 failed/,
    );
    assert.equal(requests.length, 2);

    // Package level: one `compaction.fallback`, then the kernel default writes the entry.
    const seen: AgentEvent[] = [];
    const calls: ProviderRequest[] = [];
    const turns = Array.from({ length: 10 }, () => [providerTextDelta(`done ${"y".repeat(2_000)}`), providerDone()]);
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "main" },
        packages: [
          memoryCompaction({ model: smallModel, keepRecentTokens: 0, maxSummaryTokens: OUTPUT }),
          mockProvider([...turns, [providerTextDelta("summary-1"), providerDone()], [providerError(new Error("chunk 2 failed"))]], {
            onRequest: (request) => calls.push(request),
          }),
          definePackage({
            name: "@acme/event-observer",
            version: "1.0.0",
            requires: { api: 2 },
            setup: ({ hooks }) => {
              hooks.on("package.event", (event) => {
                seen.push(event);
              });
            },
          }),
        ],
      })
    ).session();
    for (let index = 0; index < 10; index += 1) await session.run(`task ${index} ${"x".repeat(2_000)}`);

    const result = await session.compact();

    assert.equal(calls.length, 12, "ten turns, then two chunk calls and no third");
    assert.equal(result.entries?.[0]?.kind, "compaction", "the kernel default still compacts");
    assert.equal(seen.filter((event) => event.type === "package.event" && event.name === "compaction.fallback").length, 1);
  });

  it("chunking_is_a_pure_split_at_entry_boundaries", () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry(index, "z"));
    const chunks = chunkCompactionEntries(entries, 3, () => 1);
    assert.deepEqual(
      chunks.map((chunk) => chunk.map((item) => item.id)),
      [["e0", "e1", "e2"], ["e3", "e4", "e5"], ["e6"]],
    );
    // An entry over the budget gets a chunk of its own.
    assert.deepEqual(
      chunkCompactionEntries(entries.slice(0, 3), 3, (item) => (item.id === "e1" ? 10 : 1)).map((chunk) => chunk.length),
      [1, 1, 1],
    );
    assert.deepEqual(
      chunkCompactionEntries([], 3, () => 1),
      [],
    );
  });

  it("package_conformance_passes_with_max_chunks", async () => {
    const result = await packageConformance(memoryCompaction, { config: { maxChunks: 3 } });
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });
});
