/**
 * Plan 240 Task 5 (live smoke finding): a reasoning summary model that ignores a low effort spends its whole output
 * thinking and answers no text ("Summarization failed: empty response"), so LLM compaction fell back to the kernel
 * default. The summary call is now asked once more with thinking off, as session memory's STM worker is.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createSessionEntry,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import { createLlmCompactor } from "../strategy.js";
import { summaryClient } from "./helpers.js";

const entry = (index: number, text: string): SessionEntry =>
  createSessionEntry({
    id: `e${index}`,
    sessionId: "s1",
    timestamp: "2026-11-22T00:00:00.000Z",
    kind: "message",
    message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text }] },
  });

function provider(answers: readonly string[], requests: ProviderRequest[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)] ?? "";
      if (answer) yield providerTextDelta(answer);
      yield providerDone();
    },
  };
}

const entries = [entry(0, "fix the parser"), entry(1, "reading parser.ts"), entry(2, "next")];
const model = { provider: "mock", model: "summary", limits: { contextWindow: 1_000_000 } };

describe("LLM compaction retries an empty summary with thinking off (plan 240 Task 5)", () => {
  it("empty_summary_is_asked_again_with_thinking_off", async () => {
    const requests: ProviderRequest[] = [];
    const compactor = createLlmCompactor({ clientFor: summaryClient(provider(["", "the summary"], requests), model), keepRecentTokens: 0 });
    const result = await compactor.compact({ sessionId: "s1", entries });
    assert.equal(requests.length, 2, "one retry");
    assert.match(result.summary, /the summary/);
  });

  it("two_empty_answers_still_fail_so_the_package_falls_back", async () => {
    const requests: ProviderRequest[] = [];
    const compactor = createLlmCompactor({ clientFor: summaryClient(provider([""], requests), model), keepRecentTokens: 0 });
    await assert.rejects(compactor.compact({ sessionId: "s1", entries }), /Summarization failed: empty response/);
    assert.equal(requests.length, 2, "no third call");
  });
});
