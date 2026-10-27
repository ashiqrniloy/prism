/**
 * Cache-aware fold batching (plan 194 Task 4): fold old tool results in batches big enough to pay
 * for one prefix break instead of rewriting one older position per turn.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  type Message,
  type ProviderRequest,
  type ToolDefinition,
  createAgent,
  createMemorySessionStore,
  estimateTextBytes,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";

import {
  capToolResultSummary,
  foldToolResultHistory,
  foldedToolResultStub,
  planToolResultFoldBatch,
  resolveToolResultFold,
  TOOL_RESULT_FOLD_TURN_METADATA_KEY,
  toolResultFoldText,
  truncateSummarize,
} from "../fold.js";
import contextEngineering from "../index.js";
import { readFoldFrontier, writeFoldFrontier } from "../state.js";

const reply = (text = "ok") => [providerTextDelta(text), providerDone()];

function toolMessage(toolCallId: string, name: string, result: unknown, turn: number): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId, name, result }],
    metadata: { [TOOL_RESULT_FOLD_TURN_METADATA_KEY]: turn, hostNote: "kept" },
  };
}

function resultOf(message: Message | undefined): unknown {
  const block = message?.content[0];
  return block?.type === "tool_result" ? block.result : undefined;
}

/** A tool whose result is large enough to clear a small batch threshold quickly. */
function bigTool(): ToolDefinition {
  return {
    name: "big_read",
    description: "Read a large document.",
    effects: ["read"],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, context) => ({
      toolCallId: context.toolCallId,
      name: "big_read",
      value: { text: `${"x".repeat(8_000)} PAYLOAD` },
    }),
  };
}

const fold = resolveToolResultFold({ minAgeTurns: 1, minBytes: 1, keepLast: 0, clearAtLeastTokens: 1, summarize: truncateSummarize }, undefined)!;

describe("cache-aware fold batching (plan 194 Task 4)", () => {
  it("fold_stub_names_tool_call_and_size", async () => {
    const result = { text: "x".repeat(9_000) };
    const message = toolMessage("call_1", "read", result, 1);
    const text = toolResultFoldText(result, undefined, message.content);
    const [folded] = await foldToolResultHistory([message], fold, { sessionId: "s", runId: "r", turn: 5 });
    assert.equal(
      resultOf(folded),
      foldedToolResultStub("read", "call_1", capToolResultSummary(text, 512), estimateTextBytes(text)),
      "the stub is the shared format",
    );
    assert.match(String(resultOf(folded)), /^\[folded: read \[call_1\], 9,\d{3} bytes — re-run the tool to see it again\] /);
  });

  it("folded_result_keeps_tool_call_id_and_metadata", async () => {
    const message = toolMessage("call_1", "read", { text: "x".repeat(9_000) }, 1);
    const [folded] = await foldToolResultHistory([message], fold, { sessionId: "s", runId: "r", turn: 5 });
    const block = folded?.content[0];
    assert.equal(block?.type, "tool_result");
    if (block?.type !== "tool_result") return;
    assert.equal(block.toolCallId, "call_1");
    assert.equal(block.name, "read");
    assert.equal(folded?.metadata?.prismFolded, true);
    assert.equal(folded?.metadata?.hostNote, "kept", "unrelated metadata survives");
  });

  it("fold_zero_threshold_matches_previous_behavior", async () => {
    // Default `keepLast` is 3, but with `clearAtLeastTokens` 0 it must not protect anything:
    // zero threshold is exactly the per-turn fold every existing host already runs.
    const perTurn = resolveToolResultFold({ minAgeTurns: 1, minBytes: 1, summarize: truncateSummarize }, undefined)!;
    assert.equal(perTurn.clearAtLeastTokens, 0);
    assert.equal(perTurn.keepLast, 3);
    const [folded] = await foldToolResultHistory([toolMessage("call_1", "read", "x".repeat(9_000), 1)], perTurn, {
      sessionId: "s",
      runId: "r",
      turn: 5,
    });
    assert.match(String(resultOf(folded)), /^\[folded: read \[call_1\],/);
  });

  it("fold_keeps_last_n_results", async () => {
    const options = resolveToolResultFold(
      { minAgeTurns: 1, minBytes: 1, keepLast: 2, clearAtLeastTokens: 1, summarize: truncateSummarize },
      undefined,
    )!;
    const history = [
      toolMessage("call_1", "read", "a".repeat(9_000), 1),
      toolMessage("call_2", "read", "b".repeat(9_000), 2),
      toolMessage("call_3", "read", "c".repeat(9_000), 3),
      toolMessage("call_4", "read", "d".repeat(9_000), 4),
    ];
    const selection = planToolResultFoldBatch(history, options, { turn: 5, clearedToolCallIds: new Set() });
    const folded = await foldToolResultHistory(history, options, {
      sessionId: "s",
      runId: "r",
      turn: 5,
      restrictToToolCallIds: selection.foldToolCallIds,
    });
    assert.match(String(resultOf(folded[0])), /^\[folded:/);
    assert.match(String(resultOf(folded[1])), /^\[folded:/);
    assert.equal(String(resultOf(folded[2])).startsWith("[folded:"), false, "the newest keepLast batch rows stay raw");
    assert.equal(String(resultOf(folded[3])).startsWith("[folded:"), false);
  });

  it("fold_batch_folds_all_pending_together", async () => {
    const options = resolveToolResultFold(
      { minAgeTurns: 1, minBytes: 1, keepLast: 0, clearAtLeastTokens: 1_000, summarize: truncateSummarize },
      undefined,
    )!;
    const history = [
      toolMessage("call_1", "read", "a".repeat(9_000), 1),
      toolMessage("call_2", "read", "b".repeat(9_000), 2),
    ];
    const selection = planToolResultFoldBatch(history, options, { turn: 4, clearedToolCallIds: new Set() });
    assert.deepEqual(selection.advance, ["call_1", "call_2"], "one advance covers every pending row");
    const folded = await foldToolResultHistory(history, options, {
      sessionId: "s",
      runId: "r",
      turn: 4,
      restrictToToolCallIds: selection.foldToolCallIds,
    });
    assert.match(String(resultOf(folded[0])), /^\[folded:/);
    assert.match(String(resultOf(folded[1])), /^\[folded:/);
  });

  it("fold_batch_holds_until_clear_at_least_reached", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const script = [
      [providerToolCall(toolCallContent("c1", "big_read", {})), providerDone()],
      reply("one"),
      [providerToolCall(toolCallContent("c2", "big_read", {})), providerDone()],
      reply("two"),
      [providerToolCall(toolCallContent("c3", "big_read", {})), providerDone()],
      reply("three"),
    ];
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      slots: { store },
      packages: [
        mockProvider(script, { onRequest: (request) => requests.push(request) }),
        contextEngineering({
          fold: { minAgeTurns: 1, minBytes: 1, keepLast: 0, clearAtLeastTokens: 1_000_000, summarize: "truncate" },
        }),
      ],
      tools: { add: [bigTool()] },
    });
    const session = await agent.session({ id: "s1", create: true });
    for (const text of ["read one", "read two", "read three"]) await session.run(text);

    const main = requests.filter((request) => request.model.model === "main");
    for (let index = 2; index < main.length; index += 1) {
      const earlier = main[index - 2]!;
      const later = main[index]!;
      assert.equal(
        JSON.stringify(later.messages.slice(0, earlier.messages.length)),
        JSON.stringify(earlier.messages),
        `request ${index + 1} keeps the earlier prefix byte-identical`,
      );
    }
    assert.equal(JSON.stringify(requests).includes("[folded:"), false, "a batch below the threshold folds nothing");
    await agent.dispose();
  });

  it("fold_frontier_restored_after_reopen", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const build = (script: Parameters<typeof mockProvider>[0]) =>
      createAgent({
        model: { provider: "mock", model: "main" },
        slots: { store },
        packages: [
          mockProvider(script, { onRequest: (request) => requests.push(request) }),
          contextEngineering({
            fold: { minAgeTurns: 1, minBytes: 1, keepLast: 0, clearAtLeastTokens: 3_000, summarize: "truncate" },
          }),
        ],
        tools: { add: [bigTool()] },
      });

    const first = await build([
      [providerToolCall(toolCallContent("c1", "big_read", {})), providerDone()],
      reply("one"),
      [providerToolCall(toolCallContent("c2", "big_read", {})), providerDone()],
      reply("two"),
      [providerToolCall(toolCallContent("c3", "big_read", {})), providerDone()],
      reply("three"),
    ]);
    const firstSession = await first.session({ id: "s1", create: true });
    await firstSession.run("read one");
    await firstSession.run("read two");
    await firstSession.run("read three");
    const stubsBefore = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.equal((stubsBefore.match(/\[folded:/g) ?? []).length, 2, "the third result alone is below the batch size");
    await firstSession.close();
    await first.dispose();

    const second = await build([[providerTextDelta("ok"), providerDone()]]);
    const resumed = await second.session({ id: "s1" });
    await resumed.run("again");
    const stubsAfter = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.match(stubsAfter, /\[folded: big_read \[c1\]/);
    assert.match(stubsAfter, /\[folded: big_read \[c2\]/);
    assert.equal(stubsAfter.includes("[folded: big_read [c3]"), false, "the restored frontier kept the third result raw");
    assert.equal(
      JSON.stringify(await resumed.messages()).includes("PAYLOAD"),
      true,
      "the store keeps the full result while the provider view is folded",
    );
    await resumed.close();
    await second.dispose();
  });

  it("fold_batch_conformance_keeps_provider_prefixes_byte_identical", async () => {
    const skills = [
      { name: "alpha", description: "Alpha catalog entry", instructions: "Alpha body." },
      { name: "beta", description: "Beta catalog entry", instructions: "Beta body." },
    ] as const;
    const result = await runPrefixStabilityConformance({
      host: {
        model: { provider: "mock", model: "demo" },
        packages: [
          contextEngineering({
            fold: { minAgeTurns: 1, minBytes: 1, keepLast: 0, clearAtLeastTokens: 1_000_000, summarize: "truncate" },
          }),
        ],
      },
      skills: [skills[0], skills[1]],
      foldableToolResultBytes: 8_192,
    });
    assert.equal(result.requests, 4);
    assert.deepEqual(result.resets, [], "a held batch never moves an earlier position");
    assert.ok(result.minContinuity >= 0.95, `expected a stable prefix, got ${result.minContinuity}`);
  });

  it("fold_frontier_restores_nothing_when_malformed", () => {
    assert.equal(readFoldFrontier(undefined).size, 0);
    assert.equal(readFoldFrontier({ folded: "nope" }).size, 0);
    assert.equal(readFoldFrontier({ folded: ["a", 7] }).size, 0, "one bad entry fails the whole value closed");
    assert.equal([...readFoldFrontier(writeFoldFrontier(["a", "b"]))].join(","), "a,b");
  });
});
