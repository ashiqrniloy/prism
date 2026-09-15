/**
 * Attention compiler, no credentials and no network: one assembly stays byte-identical
 * because the request is under the ratio, the next one is over it, so the oldest tool
 * bodies become deterministic stubs and the host gets one `attention_compiled` report.
 *
 * Run: npm run build:core && node examples/attention-compiler.ts
 */
import { assembleProviderInput, type Message, type ModelConfig, type ProviderRequest } from "@arnilo/prism";

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

const compiler = { maxInputTokens: 2_000, triggerRatio: 0.75, compactRatio: 0.9, keepLast: 0 } as const;

/** The session emits `attention_compiled` from here; a direct caller can log it the same way. */
const reports: unknown[] = [];

async function assemble(history: readonly Message[], input: string, turn: number, withCompiler: boolean): Promise<ProviderRequest> {
  return assembleProviderInput({
    model,
    input,
    history,
    turn,
    ...(withCompiler ? { attentionCompiler: compiler, onAttentionReport: (report) => reports.push(report) } : {}),
  });
}

const smallOff = await assemble(smallHistory, "continue", 1, false);
const smallOn = await assemble(smallHistory, "continue", 2, true);
const reportsAfterUnderRatio = reports.length;
const over = await assemble(bigHistory, "continue", 3, true);

/** Stub shape: `Tool result lookup [call_old]: omitted 4006 bytes (sha256 …)`. */
const stubOf = (request: ProviderRequest, toolCallId: string) => {
  for (const message of request.messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.toolCallId === toolCallId) return String(block.result);
    }
  }
  return undefined;
};

console.log(
  JSON.stringify(
    {
      // Turn 2: same model, same history — the request bytes are those of a compiler-off run,
      // and no report is raised, so a session emits nothing for the turn.
      underRatio: {
        identicalToCompilerOff: JSON.stringify(smallOn.messages) === JSON.stringify(smallOff.messages),
        stub: stubOf(smallOn, "call_old"),
        reports: reportsAfterUnderRatio,
      },
      // Turn 3: over the ratio, so the aged row is stubbed for this request only.
      overRatio: {
        stub: stubOf(over, "call_old"),
        report: reports[0],
        // Projection only: the row the caller handed in still holds every byte.
        sourceHistoryUnchanged: JSON.stringify(bigHistory[1]).includes("x".repeat(100)),
      },
    },
    null,
    2,
  ),
);
