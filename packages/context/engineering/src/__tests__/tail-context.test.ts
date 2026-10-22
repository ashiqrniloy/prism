import assert from "node:assert/strict";
import { test } from "bun:test";
import { withTailContext } from "@arnilo/prism-memory-core";
import { createHookBus } from "../../../../../src/hooks/bus.js";
import type { Message } from "@arnilo/prism";
import { CONTEXT_ENGINEERING_PRIORITY } from "../handler.js";
import { applyDraftBudget } from "../budget.js";

test("tail context composes after engineering budget without changing the retained prefix", async () => {
  const prefix: Message = { role: "system", content: [{ type: "text", text: "Policy" }] };
  const user: Message = { role: "user", content: [{ type: "text", text: "current question" }] };
  const hooks = createHookBus();
  // Register tail first to prove priority, rather than registration order, controls placement.
  hooks.registrar("test").on("context.build", (draft) => withTailContext(draft, [{ title: "Memory", content: "useful fact" }]), {
    priority: CONTEXT_ENGINEERING_PRIORITY - 1,
  });
  hooks.registrar("test").on(
    "context.build",
    (draft) => {
      const budgeted = applyDraftBudget({ ...draft, budget: { maxInputTokens: 100 } });
      assert.ok(budgeted.report.truncated);
      return budgeted;
    },
    { priority: CONTEXT_ENGINEERING_PRIORITY },
  );
  const result = await hooks.transform("context.build", {
    messages: [prefix, { role: "user", content: [{ type: "text", text: "old".repeat(1000) }] }, user],
  });
  assert.equal(result.messages[0], prefix);
  assert.equal(result.messages.at(-1), user);
  assert.deepEqual(result.messages[1]!.content, [{ type: "text", text: "Memory:\nuseful fact" }]);
  assert.ok((result.messages[1]!.metadata!.contextBlocks as { tokens: number }[])[0]!.tokens > 0);
});
