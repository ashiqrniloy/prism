import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AttentionFoldLedger,
  compileAttention,
  createAttentionCompiler,
  createAttentionFoldLedger,
  createAttentionStickyFrontier,
  restoreAttentionFoldLedger,
  serializeAttentionFoldLedger,
} from "../attention.js";
import { type Message, type ModelConfig, type ProviderRequest, type ToolDefinition, createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { resolveToolResultFold } from "../fold.js";
import contextEngineering from "../index.js";

/**
 * The fold ledger (plan 086 T3), moved to `@arnilo/prism-context-engineering` by plan 158 Task 7:
 * a row is summarized once and re-applied from the session on later turns. The kernel run-checkpoint
 * legs stay with the kernel — the package keeps the ledger in the session's own package state, which
 * `attention_durable_session_state` covers.
 */

const model: ModelConfig = { provider: "test", model: "test-model" };

function toolMessage(toolCallId: string, name: string, result: unknown): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId, name, result }] };
}

/** The draft is one flat list; the specs read the stub back out of it. */
function groups(history: Message[]): readonly Message[] {
  return history;
}

/** The stubbed body the provider would see, so the specs can compare bytes across turns. */
function toolResultText(
  messages: readonly { readonly content: readonly { readonly type: string; readonly toolCallId?: unknown; readonly result?: unknown }[] }[],
  toolCallId: string,
): string | undefined {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.toolCallId === toolCallId) return JSON.stringify(block.result ?? null);
    }
  }
  return undefined;
}

describe("attention fold ledger", () => {
  it("summarizes a folded row once and re-applies the stored body on later turns", async () => {
    let calls = 0;
    const fold = resolveToolResultFold(
      {
        minAgeTurns: 1,
        minBytes: 1,
        summarize: ({ toolCallId }) => {
          calls += 1;
          return `summary ${calls} of ${toolCallId}`;
        },
      },
      undefined,
    );
    assert.ok(fold);
    const compiler = createAttentionCompiler({ maxInputTokens: 100, triggerRatio: 0.2, keepLast: 0 }, { model });
    const attentionFold = createAttentionFoldLedger();
    const history = [toolMessage("call_1", "lookup", "x".repeat(400))];

    const first = await compileAttention({ compiler, messages: groups(history), fold, attentionFold, turn: 9 });
    const second = await compileAttention({ compiler, messages: groups(history), fold, attentionFold, turn: 10 });

    assert.equal(calls, 1, "the host summarize runs once for the row, not once per turn");
    assert.equal(first.report.newFoldedBodies, 1);
    assert.equal(second.report.newFoldedBodies, 0, "a re-applied body is not a new fold");
    assert.equal(
      toolResultText(first.messages, "call_1"),
      toolResultText(second.messages, "call_1"),
      "the stub body is byte-identical across turns",
    );
    assert.match(String(toolResultText(second.messages, "call_1")), /summary 1 of call_1/);
  });

  it("round-trips a persisted ledger and drops entries it cannot trust", () => {
    const ledger: AttentionFoldLedger = createAttentionFoldLedger();
    ledger.bodies.set("call_1", "body one");
    ledger.bodies.set("call_2", "body two");
    const persisted = serializeAttentionFoldLedger(ledger);
    assert.equal(persisted.v, 1, "the snapshot is versioned");
    const restored = restoreAttentionFoldLedger(persisted);
    assert.ok(restored);
    assert.deepEqual(
      [...restored.bodies],
      [
        ["call_1", "body one"],
        ["call_2", "body two"],
      ],
    );

    assert.equal(restoreAttentionFoldLedger(undefined), undefined);
    assert.equal(restoreAttentionFoldLedger(null), undefined);
    assert.equal(restoreAttentionFoldLedger({ bodies: "nope" }), undefined, "a malformed shape starts empty, not fatal");
    const messy = restoreAttentionFoldLedger({
      v: 1,
      bodies: [
        { id: "call_3", body: "kept" },
        { id: 7, body: "not an id" },
        { id: "call_4", body: "" },
        "junk",
        { id: "x".repeat(300), body: "id too long" },
        { id: "call_5", body: "z".repeat(5_000) },
      ],
    });
    assert.ok(messy);
    assert.deepEqual([...messy.bodies], [["call_3", "kept"]], "malformed entries are dropped one by one");
    assert.equal(createAttentionStickyFrontier().toolCallIds.size, 0, "the frontier factory stays independent");
  });

  it("re-applies a restored body under a closed gate, so a resumed run never re-summarizes", async () => {
    let calls = 0;
    const fold = resolveToolResultFold(
      {
        minAgeTurns: 1,
        minBytes: 1,
        summarize: () => {
          calls += 1;
          return `drifted summary ${calls}`;
        },
      },
      undefined,
    );
    assert.ok(fold);
    // A wide cap: the gate is closed, only the restored frontier keeps the row stubbed.
    const compiler = createAttentionCompiler({ maxInputTokens: 400_000, triggerRatio: 0.2, keepLast: 0 }, { model });
    const attentionFold = restoreAttentionFoldLedger({ v: 1, bodies: [{ id: "call_1", body: "persisted body" }] });
    assert.ok(attentionFold);
    const frontier = createAttentionStickyFrontier();
    frontier.toolCallIds.add("call_1");

    const out = await compileAttention({
      compiler,
      messages: groups([toolMessage("call_1", "lookup", "x".repeat(400))]),
      fold,
      attentionFold,
      frontier,
      turn: 30,
    });

    assert.equal(calls, 0, "a row with a persisted body is never re-summarized");
    assert.equal(toolResultText(out.messages, "call_1"), JSON.stringify("Tool result lookup [call_1]: persisted body"));
    assert.equal(out.report.newFoldedBodies, 0);
  });
});

describe("package-owned fold state", () => {
  const bigTool: ToolDefinition = {
    name: "big_read",
    description: "big",
    effects: ["read"],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, context) => ({
      toolCallId: context.toolCallId,
      name: "big_read",
      value: { text: `${"y".repeat(4_000)} END-OF-PAYLOAD` },
    }),
  };

  /** The kernel kept the ledger in the run checkpoint; the package keeps it in session state, so a
   *  reopened session re-applies the stored body instead of paying for a second summary. */
  it("attention_durable_session_state", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    let summaries = 0;
    const build = () =>
      createAgent({
        model: { provider: "mock", model: "main" },
        slots: { store },
        packages: [
          // One scripted provider per agent: the first call yields the tool call, the rest answer.
          mockProvider([[providerToolCall(toolCallContent("c1", "big_read", {})), providerDone()], [providerTextDelta("ok"), providerDone()]], {
            onRequest: (request) => {
              requests.push(request);
              if (request.model.model === "summarizer") summaries += 1;
            },
          }),
          contextEngineering({
            fold: { minAgeTurns: 1, minBytes: 1, maxSummaryBytes: 64, summarize: { model: "mock/summarizer" } },
          }),
        ],
        tools: { add: [bigTool] },
      });

    const first = await build();
    const firstSession = await first.session({ id: "s1", create: true });
    await firstSession.run("read it");
    await firstSession.run("again");
    const stubOf = (request: ProviderRequest | undefined) => toolResultText(request?.messages ?? [], "c1");
    const stubBefore = stubOf(requests.at(-1));
    assert.equal(summaries, 1, "one summary call for the folded row");
    assert.match(String(stubBefore), /\[folded: big_read \[c1\], [\d,]+ bytes/);
    await firstSession.close();
    await first.dispose();

    const second = await build();
    const resumed = await second.session({ id: "s1" });
    await resumed.run("third");
    assert.equal(summaries, 1, "the reopened session re-applied the stored body, so no second summary");
    assert.equal(stubOf(requests.at(-1)), stubBefore, "the stub is byte-identical after the reopen");
    assert.equal(String(stubOf(requests.at(-1))).includes("END-OF-PAYLOAD"), false, "the payload never came back");
    await resumed.close();
    await second.dispose();
  });
});
