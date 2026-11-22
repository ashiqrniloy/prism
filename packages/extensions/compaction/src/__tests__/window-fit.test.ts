/**
 * Plan 240 Task 5 (plan 218.3 Further Action, P1): LLM compaction recovers after an over-window turn. Before, the cut
 * kept at least `keepRecentTokens` (20,000) of the newest history whatever the window, so one large tool output stayed
 * in every compacted request, and every later run of the session failed `context_overflow` (Session-Bench live:
 * sb-rt-12 0/8 tasks). The kept tail now defaults to 20% of the input cap and never exceeds 40% of it.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createSessionEntry,
  estimateTextTokens,
  type ModelConfig,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveInputCap,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memoryCompaction from "../index.js";
import { findLlmCompactionCutPoint, MAX_KEPT_SHARE, prepareLlmCompaction } from "../prepare.js";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../prompts.js";
import { estimateEntryTokens } from "../tokens.js";

const timestamp = "2026-11-22T00:00:00.000Z";
const message = (id: string, role: "user" | "assistant", text: string): SessionEntry =>
  createSessionEntry({ id, sessionId: "s", timestamp, kind: "message", message: { role, content: [{ type: "text", text }] } });
const toolResult = (id: string, callId: string, text: string): SessionEntry =>
  createSessionEntry({
    id,
    sessionId: "s",
    timestamp,
    kind: "message",
    message: { role: "tool", content: [{ type: "tool_result", toolCallId: callId, name: "dump", result: text }] },
  });
const toolCall = (id: string, callId: string): SessionEntry =>
  createSessionEntry({
    id,
    sessionId: "s",
    timestamp,
    kind: "message",
    message: { role: "assistant", content: [toolCallContent(callId, "dump", {})] },
  });
const tokens = (entries: readonly SessionEntry[]) => entries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);

describe("LLM compaction fits its kept tail to the window (plan 240 Task 5)", () => {
  it("kept_tail_never_exceeds_its_share_of_the_input_cap", () => {
    const entries = [
      message("u1", "user", "first task"),
      message("a1", "assistant", "done"),
      message("u2", "user", "dump the logs"),
      toolCall("a2", "c1"),
      toolResult("t2", "c1", "x".repeat(24_000)), // ~6,000 tokens, more than 40% of an 8,000-token cap
    ];
    const prep = prepareLlmCompaction({ entries, inputCapTokens: 8_000 }, { keepRecentTokens: 20_000 });
    assert.ok(tokens(prep.entriesToKeep) <= 8_000 * MAX_KEPT_SHARE, "the oversized output is summarized, not kept");
    assert.equal(
      prep.entriesToKeep.some((entry) => entry.id === "t2"),
      false,
    );
    assert.equal(prep.entriesToKeep[0]?.message?.role === "tool", false, "a tail never starts on a tool result");
    // Without a cap the old rule holds: keep at least keepRecentTokens.
    assert.equal(prepareLlmCompaction({ entries }, { keepRecentTokens: 20_000 }).entriesToKeep.length, entries.length);
  });

  it("host_max_kept_share_overrides_the_fit", () => {
    const entries = [message("u1", "user", "go"), message("a1", "assistant", "z".repeat(24_000))];
    // The host's value is the bound: with the whole cap allowed, the 6,000-token entry stays.
    const all = prepareLlmCompaction({ entries, inputCapTokens: 8_000 }, { keepRecentTokens: 20_000, maxKeptShare: 1 });
    assert.ok(all.entriesToKeep.some((entry) => entry.id === "a1"));
    const fit = prepareLlmCompaction({ entries, inputCapTokens: 8_000 }, { keepRecentTokens: 20_000 });
    assert.equal(fit.entriesToKeep.some((entry) => entry.id === "a1"), false);
  });

  it("default_kept_tail_is_a_share_of_the_input_cap", () => {
    const entries = Array.from({ length: 40 }, (_, index) => message(`m${index}`, index % 2 ? "assistant" : "user", "y".repeat(400)));
    const kept = tokens(prepareLlmCompaction({ entries, inputCapTokens: 10_000 }).entriesToKeep);
    assert.ok(kept >= 2_000 && kept <= 2_000 + 200, `kept ${kept} tokens, about 20% of a 10,000 cap`);
    assert.ok(tokens(prepareLlmCompaction({ entries }).entriesToKeep) >= 4_000, "no cap: the 20,000-token default keeps it all");
  });

  it("a_leading_tool_result_reaches_back_to_its_call_only_while_it_fits", () => {
    const entries = [
      message("u1", "user", "go"),
      toolCall("a1", "c1"),
      toolResult("t1", "c1", "r".repeat(400)),
      message("a2", "assistant", "ok"),
    ];
    // The cut lands on t1; reaching back to a1 fits, so the call is kept with its result.
    const cut = findLlmCompactionCutPoint(entries, { keepRecentTokens: tokens(entries.slice(2)), maxKeptTokens: 10_000 });
    assert.equal(entries[cut + 1]?.id, "a1");
    // With no room for the call, the orphaned result is summarized with it.
    const tight = findLlmCompactionCutPoint(entries, {
      keepRecentTokens: tokens(entries.slice(2)),
      maxKeptTokens: tokens(entries.slice(2)),
    });
    assert.equal(entries[tight + 1]?.id, "a2");
  });

  it("llm_compaction_recovers_after_an_over_window_turn", async () => {
    const model: ModelConfig = { provider: "mock", model: "small", limits: { contextWindow: 8_000, maxOutputTokens: 500 } };
    const cap = resolveInputCap({}, model);
    const requestTokens = (request: ProviderRequest) =>
      request.messages.reduce((sum, item) => sum + estimateTextTokens(JSON.stringify(item.content)), 0);
    const overflow = {
      name: "ProviderHttpError",
      message: "provider request failed: 400 maximum context length exceeded",
      code: 400,
      failureClass: "context_overflow" as const,
    };
    let summaries = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        const system = request.messages.find((item) => item.role === "system");
        const systemText = system?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
        if (systemText.includes(SUMMARIZATION_SYSTEM_PROMPT.slice(0, 60))) {
          summaries += 1;
          yield providerTextDelta("Summary: the user asked for a log dump; the dump was large.");
          yield providerDone();
          return;
        }
        if (requestTokens(request) > cap) {
          yield { type: "error" as const, error: overflow };
          return;
        }
        const last = request.messages.at(-1);
        const userText = last?.role === "user" ? last.content.map((block) => (block.type === "text" ? block.text : "")).join("") : "";
        if (userText.startsWith("dump")) {
          yield providerToolCall(toolCallContent(`c${Date.now()}`, "dump", {}));
          yield providerDone();
          return;
        }
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model,
      packages: [providerPackage("mock-provider", [provider]), memoryCompaction({})],
      tools: {
        add: [
          {
            name: "dump",
            description: "Return a large log dump.",
            parameters: { type: "object", properties: {} },
            // ~6,500 tokens: the next request is over the window.
            execute: (_args: unknown, context: { readonly toolCallId: string }) => ({
              toolCallId: context.toolCallId,
              name: "dump",
              content: [{ type: "text" as const, text: "L".repeat(26_000) }],
            }),
          },
        ],
      },
    });
    const session = await agent.session();
    // The dump makes the next request larger than the window. Before plan 240 Task 5 the compaction kept the dump, the
    // retry overflowed again, and every later run failed `context_overflow`.
    const dumped = await session.run("dump the logs");
    assert.equal(dumped.status, "completed", `the over-window turn recovers in the same run (${dumped.error?.code ?? "no error"})`);
    assert.ok(summaries >= 1, "LLM compaction ran");
    const next = await session.run("now summarize what you did");
    assert.equal(next.status, "completed", "and the session stays usable");
    await agent.dispose();
  });
});
