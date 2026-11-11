/**
 * The draft input budget, ported from the kernel's `src/context-budget.ts` into
 * `@arnilo/prism-extensions/context-engineering` by plan 158 Task 7.
 *
 * The kernel budget evicted from six named message groups plus skills and context blocks; a
 * `context.build` draft is one flat message list with an addition channel for context blocks, so
 * these legs pin the adapted shape: the leading system block is the mandatory prefix, everything
 * after it is droppable in the kernel's order (tool results, then history, then context blocks), and
 * the whole pass rejects when the prefix alone cannot fit.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import type { ContextBlock, Message, ToolDefinition } from "@arnilo/prism";
import {
  applyDraftBudget,
  ContextBudgetError,
  DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS,
  HARD_MAX_CONTEXT_BUDGET_BYTES,
  isContextBudgetError,
  measureBudgetCost,
  resolveContextBudget,
} from "../budget.js";

const body = (chars: number) => "x".repeat(chars);

function text(role: Message["role"], value: string, id?: string): Message {
  return { ...(id === undefined ? {} : { id }), role, content: [{ type: "text", text: value }] };
}

function tool(id: string, value: string): Message {
  return { id, role: "tool", content: [{ type: "tool_result", toolCallId: id, name: "lookup", result: value }] };
}

const system = text("system", "Policy");
const user = (value = "go") => text("user", value);

describe("draft input budget", () => {
  it("requires a cap and validates it against the hard maximum", () => {
    assert.throws(() => resolveContextBudget({}), /maxInputTokens and\/or maxInputBytes/);
    assert.throws(() => resolveContextBudget({ maxInputTokens: 0 }), /maxInputTokens/);
    assert.throws(() => resolveContextBudget({ maxInputTokens: 1.5 }), /maxInputTokens/);
    assert.throws(() => resolveContextBudget({ maxInputBytes: HARD_MAX_CONTEXT_BUDGET_BYTES + 1 }), /maxInputBytes/);
    assert.equal(resolveContextBudget({ maxInputTokens: 10 }).reportOmissions, false);
    assert.equal(resolveContextBudget({ maxInputTokens: 10, reportOmissions: true }).reportOmissions, true);
  });

  it("measures messages, context blocks, and tool declarations", () => {
    const tools: ToolDefinition[] = [
      {
        name: "lookup",
        description: "Looks things up.",
        parameters: { type: "object", properties: {} },
        execute: () => ({ toolCallId: "x", name: "lookup" }),
      },
    ];
    const blocks: ContextBlock[] = [{ id: "b", title: "Retrieved", content: body(400) }];
    const messages = [system, user()];
    const base = measureBudgetCost({ messages });
    const withBlocks = measureBudgetCost({ messages, context: blocks });
    const withTools = measureBudgetCost({ messages, tools });
    assert.ok(base.tokens > 0 && base.bytes > 0);
    assert.ok(withBlocks.tokens > base.tokens, "context blocks are counted");
    assert.ok(withTools.tokens > base.tokens, "tool declarations are counted");
  });

  it("preserves array identity when nothing has to be dropped", () => {
    const messages = [system, user()];
    const result = applyDraftBudget({ messages, budget: { maxInputTokens: 1_000_000 } });
    assert.equal(result.messages, messages, "an under-budget pass reports no change");
    assert.equal(result.report.truncated, false);
    assert.deepEqual(result.report.omitted, []);
  });

  it("drops tool results first, then history, then the lowest-priority context block", () => {
    const messages = [system, user("older"), tool("call_1", body(4_000)), user("newer")];
    const blocks: ContextBlock[] = [
      { id: "keep", title: "Keep", content: body(4_000), priority: 5 },
      { id: "drop", title: "Drop", content: body(4_000) },
    ];
    const result = applyDraftBudget({ messages, context: blocks, budget: { maxInputTokens: 1_200, reportOmissions: true } });

    // The kernel's drop order over a flat draft: tool results, then history oldest-first, then the
    // lowest-priority context block.
    assert.deepEqual([...new Set(result.report.omitted.map((omission) => omission.kind))], ["tool_results", "history", "context"]);
    assert.equal(result.report.omitted[0]?.id, "call_1", "the tool result goes first");
    assert.equal(result.report.omitted.at(-1)?.id, "drop", "the lowest-priority block goes last");
    assert.equal(result.context.length, 1);
    assert.equal(
      result.messages.some((message) => message.role === "tool"),
      false,
    );
    assert.equal(result.report.truncated, true);
  });

  it("enforces a byte cap independently of the token cap", () => {
    const messages = [system, user(body(4_000))];
    const result = applyDraftBudget({ messages, budget: { maxInputBytes: 100 } });
    assert.ok(result.report.keptBytes <= 100);
    assert.equal(
      result.messages.some((message) => message.role === "user"),
      false,
      "the history row was evicted",
    );
  });

  it("keeps the leading system block and rejects when it alone cannot fit", () => {
    const prefix = [text("system", body(40_000)), text("system", body(40_000))];
    const error = (() => {
      try {
        applyDraftBudget({ messages: [...prefix, user()], budget: { maxInputTokens: 100 } });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    assert.ok(error instanceof ContextBudgetError);
    assert.ok(isContextBudgetError(error));
    assert.equal((error as ContextBudgetError).code, "context_budget_exceeded");
    assert.match((error as Error).message, /mandatory prefix cannot fit/, "the 0.12 message is preserved");
    assert.equal(isContextBudgetError(new Error("nope")), false);
  });

  it("never drops the leading system block even when the rest is droppable", () => {
    const messages = [system, user(body(40_000))];
    const result = applyDraftBudget({ messages, budget: { maxInputTokens: 500 } });
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, "system");
  });

  it("caps the report at the documented omission limit", () => {
    const messages = [system, ...Array.from({ length: DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS + 50 }, (_, _index) => user(body(40)))];
    const result = applyDraftBudget({ messages, budget: { maxInputTokens: 5, reportOmissions: true } });
    assert.equal(result.report.omitted.length, DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS);
    assert.equal(result.report.truncated, true);
  });

  it("reports no omissions when reportOmissions is off, and still trims", () => {
    const messages = [system, user(body(40_000))];
    const result = applyDraftBudget({ messages, budget: { maxInputTokens: 500 } });
    assert.deepEqual(result.report.omitted, []);
    assert.equal(result.report.truncated, true, "the trim still happened");
  });
});
