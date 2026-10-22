/**
 * Tool-result folding, moved from the kernel's `src/tool-result-fold.ts` into
 * `@arnilo/prism-context-engineering` by plan 158 Task 7. The kernel-assembly legs (`toolResultFold`
 * on `assembleProviderInput`) stay with the kernel field until Task 8 deletes it; the package's own
 * `context_engineering_fold_view_only` covers the same behavior through `context.build`.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS,
  DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES,
  foldedToolResultHeader,
  foldToolResultHistory,
  resolveToolResultFold,
  TOOL_RESULT_FOLD_TURN_METADATA_KEY,
} from "../fold.js";
import type { Message } from "@arnilo/prism";

function toolMessage(toolCallId: string, name: string, result: unknown, turn?: number): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId, name, result }],
    metadata: turn === undefined ? undefined : { [TOOL_RESULT_FOLD_TURN_METADATA_KEY]: turn },
  };
}

function resultOf(message: Message | undefined): unknown {
  const block = message?.content[0];
  return block?.type === "tool_result" ? block.result : undefined;
}

describe("tool result fold", () => {
  it("resolveToolResultFold is disabled without summarize", () => {
    assert.equal(resolveToolResultFold(undefined, undefined), undefined);
    assert.equal(resolveToolResultFold({ minAgeTurns: 1 } as never, undefined), undefined);
  });

  it("keeps raw tool result when summarizer throws", async () => {
    const raw = "y".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES);
    const history = [toolMessage("call_2", "lookup", raw, 1)];
    const folded = await foldToolResultHistory(
      history,
      resolveToolResultFold(
        {
          summarize: () => {
            throw new Error("boom");
          },
        },
        undefined,
      )!,
      { sessionId: "s", runId: "r", turn: 5 },
    );
    assert.equal(resultOf(folded[0]), raw);
  });

  it("caps oversized summarizer output", async () => {
    const raw = "z".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES);
    const history = [toolMessage("call_3", "lookup", raw, 1)];
    const folded = await foldToolResultHistory(
      history,
      resolveToolResultFold(
        {
          maxSummaryBytes: 16,
          summarize: () => `summary-${"w".repeat(200)}`,
        },
        undefined,
      )!,
      { sessionId: "s", runId: "r", turn: 5 },
    );
    const value = String(resultOf(folded[0]));
    assert.ok(value.endsWith("…"));
    assert.ok(new TextEncoder().encode(value).length <= 16 + 80);
  });

  it("does not fold a row younger than minAgeTurns or smaller than minBytes", async () => {
    const aged = toolMessage("call_5", "lookup", "a".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES), 3);
    const fresh = toolMessage("call_6", "lookup", "b".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES), 4);
    const small = toolMessage("call_7", "lookup", "tiny", 1);
    const folded = await foldToolResultHistory(
      [aged, fresh, small],
      resolveToolResultFold({ summarize: () => "folded" }, undefined)!,
      { sessionId: "s", runId: "r", turn: 3 + DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS },
    );
    assert.match(String(resultOf(folded[0])), /Tool result lookup \[call_5\]: folded/);
    assert.equal(String(resultOf(folded[1])).includes("Tool result"), false, "the fresh row is protected by the age gate");
    assert.equal(resultOf(folded[2]), "tiny", "the small row is protected by the byte gate");
  });

  it("foldedToolResultHeader formats one-line ref", () => {
    assert.equal(foldedToolResultHeader("lookup", "call_1", "ref:call_1 ok"), "Tool result lookup [call_1]: ref:call_1 ok");
  });
});
