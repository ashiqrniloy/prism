/**
 * Attention compiler, no credentials and no network: one pass stays byte-identical because the
 * request is under the ratio, the next one is over it, so the oldest tool bodies become
 * deterministic stubs and the caller gets one report.
 *
 * The compiler lives in `@arnilo/prism-extensions/context-engineering` (plan 158): a session gets it by
 * installing the package — `contextEngineering({ attention: { maxInputTokens: 2_000 } })` runs
 * this same pass inside a `context.build` handler and emits `attention.compiled` as a package
 * event. This file calls the library directly so the pass is visible on its own.
 *
 * Run: npm run build:core && node examples/attention-compiler.ts
 */
import type { Message, ModelConfig } from "@arnilo/prism";
import { type AttentionReport, compileAttention, createAttentionCompiler } from "@arnilo/prism-extensions/context-engineering";

/** Cap 2,000 tokens, default reserve 1,024: the ratio is compared against 976 input tokens. */
const model: ModelConfig = { provider: "mock", model: "demo" };

const big = (label: string) => `${label} ${"x".repeat(4_000)}`;

/** Short enough to stay under the ratio: ~40 tokens against a 1,500-token trigger. */
const smallHistory: Message[] = [
  { role: "tool", content: [{ type: "tool_result", toolCallId: "call_old", name: "lookup", result: "row: ready" }] },
];

/** The same shape with a payload aged into the thousands of tokens. */
const bigHistory: Message[] = [
  {
    role: "assistant",
    content: [
      { type: "thinking", text: big("reasoning") },
      { type: "text", text: "Looking it up." },
    ],
  },
  { role: "tool", content: [{ type: "tool_result", toolCallId: "call_old", name: "lookup", result: big("row") }] },
];

const turnInput = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

/** One validated handle: the package builds it from the same options a session would pass. */
const compiler = createAttentionCompiler({ maxInputTokens: 2_000, triggerRatio: 0.75, compactRatio: 0.9, keepLast: 0 }, { model });

/** Stub shape: `Tool result lookup [call_old]: omitted 4006 bytes (sha256 …)`. */
const stubOf = (messages: readonly Message[], toolCallId: string) => {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.toolCallId === toolCallId) return String(block.result);
    }
  }
  return undefined;
};

// Turn 2: same model, same history — the pass mutates nothing, so the bytes a host sends are those
// of a compiler-off run and no report is raised.
const underRatio = await compileAttention({ compiler, messages: [...smallHistory, turnInput("continue")], turn: 2 });

// Turn 3: over the ratio, so the aged row is stubbed for this pass only.
const overRatio = await compileAttention({ compiler, messages: [...bigHistory, turnInput("continue")], turn: 3 });

const report: AttentionReport = overRatio.report;

console.log(
  JSON.stringify(
    {
      underRatio: {
        identicalToCompilerOff: JSON.stringify(underRatio.messages) === JSON.stringify([...smallHistory, turnInput("continue")]),
        mutated: underRatio.mutated,
        stub: stubOf(underRatio.messages, "call_old"),
      },
      overRatio: {
        mutated: overRatio.mutated,
        stub: stubOf(overRatio.messages, "call_old"),
        report,
        // Projection only: the row the caller handed in still holds every byte.
        sourceHistoryUnchanged: JSON.stringify(bigHistory[1]).includes("x".repeat(100)),
      },
    },
    null,
    2,
  ),
);
