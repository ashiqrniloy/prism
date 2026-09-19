import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateMessageTokens, type Message, MODEL_FAMILY_TOKENS, type ModelFamily, resolveModelFamily } from "../index.js";

// Plan 091 Task 1. Reference token counts are measured with tiktoken's
// `o200k_base` (dev-time oracle; no tokenizer dependency ships and no tokenizer
// runs in CI). ±15% is the task's acceptance band: the tables are heuristics, not
// tokenizers. o200k_base is the reference because it is a current-generation
// tokenizer — the legacy cl100k_base is atypical for CJK (1.03 chars/token vs
// o200k's 1.44), while the table's 1.5 CJK ratio tracks modern families.
const PROSE =
  "You are a coding assistant working inside a repository. Read the relevant files before editing, keep diffs small, and run the test suite after every change. If a request is ambiguous, ask one clarifying question instead of guessing.";
const SYSTEM_PROMPT =
  "You are a careful software engineer. When the user asks for a change, inspect the repository, identify the root cause, and make the smallest correct edit. Prefer existing helpers over new abstractions. Run the focused test file after editing, then report what changed and what remains uncertain.";
const HISTORY_TURN =
  "The provider returned a 429 response with a quota failure class, so the runtime narrowed the attempt budget and retried after the configured backoff. No usage was reported for that attempt, which means the token counters treat it as unknown rather than zero.";
const FENCED_CODE = "```ts\nfunction estimate(text: string): number {\n  return Math.ceil(text.length / 4);\n}\n```";
const CJK = "这是一个用于估算令牌数量的中文段落，包含标点符号和混合 text 的英文单词。";

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

const TOOL_CALL: Message = {
  role: "assistant",
  content: [
    {
      type: "tool_call",
      id: "call_1",
      name: "grep",
      arguments: { path: "src/index.ts", pattern: "estimateMessageTokens", limit: 25, ignoreCase: true },
    },
  ],
};

const FIXTURES: ReadonlyArray<{ readonly name: string; readonly message: Message; readonly reference: number }> = [
  { name: "agent prose", message: userText(PROSE), reference: 46 },
  { name: "system prompt", message: userText(SYSTEM_PROMPT), reference: 56 },
  { name: "history turn", message: userText(HISTORY_TURN), reference: 50 },
  { name: "fenced code", message: userText(FENCED_CODE), reference: 23 },
  { name: "tool-call JSON", message: TOOL_CALL, reference: 23 },
  { name: "CJK paragraph", message: userText(CJK), reference: 27 },
  { name: "mixed prose+CJK", message: userText(`${PROSE}\n${CJK}`), reference: 73 },
];

describe("usage estimation (plan 091 Task 1)", () => {
  it("openai-family estimates land within 15% of o200k_base on sampled fixtures", () => {
    for (const fixture of FIXTURES) {
      const estimate = estimateMessageTokens([fixture.message], "gpt-5");
      const drift = Math.abs(estimate.tokens - fixture.reference) / fixture.reference;
      assert.ok(
        drift <= 0.15,
        `${fixture.name}: estimated ${estimate.tokens} vs reference ${fixture.reference} (${(drift * 100).toFixed(1)}% drift)`,
      );
      assert.equal(estimate.confidence, "medium");
      assert.equal(estimate.lowConfidence, false);
    }
  });

  it("unknown family uses the conservative default and flags lowConfidence", () => {
    const message = userText(`${PROSE} ${CJK}`);
    const unknown = estimateMessageTokens([message], "totally-unregistered-model");
    assert.equal(unknown.confidence, "low");
    assert.equal(unknown.lowConfidence, true);
    for (const family of Object.keys(MODEL_FAMILY_TOKENS) as ModelFamily[]) {
      if (family === "unknown") continue;
      const known = estimateMessageTokens([message], family);
      assert.ok(unknown.tokens >= known.tokens, `unknown estimate ${unknown.tokens} < ${family} estimate ${known.tokens}`);
      assert.equal(known.lowConfidence, false);
    }
  });

  it("CJK-heavy content takes the higher-density ratio branch", () => {
    const cjk = "这是一个用于估算令牌数量的中文段落";
    const ascii = "x".repeat(cjk.length); // equal UTF-16 length, prose ratio applies
    const cjkEstimate = estimateMessageTokens([userText(cjk)], "gpt-5");
    const asciiEstimate = estimateMessageTokens([userText(ascii)], "gpt-5");
    assert.ok(
      cjkEstimate.tokens > asciiEstimate.tokens,
      `CJK ${cjkEstimate.tokens} should exceed equal-length ASCII ${asciiEstimate.tokens}`,
    );
  });

  it("resolves model ids, provider ids, and explicit family names", () => {
    const cases: ReadonlyArray<readonly [string | undefined, ModelFamily]> = [
      [undefined, "unknown"],
      ["", "unknown"],
      ["local-llm-7b", "unknown"],
      ["anthropic", "anthropic"],
      ["claude-sonnet-4.5", "anthropic"],
      ["openai/anthropic/claude-3", "anthropic"], // explicit name wins inside a namespaced id
      ["gpt-4o-mini", "openai"],
      ["o3-mini", "openai"],
      ["gemini-2.5-pro", "google"],
      ["deepseek-chat", "deepseek"],
      ["mistral-large-latest", "mistral"],
      ["openrouter/auto", "openrouter-generic"],
    ];
    for (const [input, expected] of cases) {
      assert.equal(resolveModelFamily(input), expected, `resolveModelFamily(${JSON.stringify(input)})`);
    }
  });

  it("array estimate reuses per-message folding with one family overhead per message", () => {
    const message = userText("first message");
    const empty: Message = { role: "user", content: [] };
    const single = estimateMessageTokens([message], "gpt-5");
    assert.equal(estimateMessageTokens([message, message], "gpt-5").tokens, single.tokens * 2);
    assert.equal(
      estimateMessageTokens([empty, empty], "gpt-5").tokens,
      MODEL_FAMILY_TOKENS.openai.perMessageOverhead * 2,
      "empty messages cost exactly the family per-message overhead",
    );
    assert.equal(estimateMessageTokens([], "gpt-5").tokens, 0);
  });

  it("is pure: caller messages are not mutated and content is not retained", () => {
    const messages = [userText(PROSE), TOOL_CALL];
    const snapshot = structuredClone(messages);
    estimateMessageTokens(messages, "claude-sonnet-4.5");
    assert.deepEqual(messages, snapshot);
  });

  it("estimates 100k chars inside the task envelope", () => {
    const large = `${PROSE}\n`.repeat(450); // ~104k chars
    const startedAt = performance.now();
    const estimate = estimateMessageTokens([userText(large)], "gpt-5");
    const elapsedMs = performance.now() - startedAt;
    assert.ok(estimate.tokens > 0);
    // ponytail: generous wall-clock envelope to avoid CI flake; catches only gross regressions (task target: <0.1ms/100k).
    assert.ok(elapsedMs < 100, `100k-char estimate took ${elapsedMs}ms`);
  });
});
