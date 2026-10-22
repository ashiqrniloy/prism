import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  type ContentBlock,
  type ProviderRequest,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { assertCompactorConforms } from "@arnilo/prism/testing/compaction-conformance";
import { createMockProvider } from "@arnilo/prism/testing";
import { createCodingCompactor, keepLatestPlanTurn } from "../coding.js";
import { summaryClient } from "./helpers.js";

const model = { provider: "mock", model: "summary" };
const timestamp = "2026-01-01T00:00:00.000Z";

function message(id: string, role: "user" | "assistant", content: readonly ContentBlock[], parentId?: string): SessionEntry {
  return createSessionEntry({ id, parentId, sessionId: "s1", timestamp, kind: "message", message: { role, content } });
}

test("coding_compaction_preset_prioritizes_coding_handoff_and_redacts_paths", async () => {
  const secret = "secret-token";
  const requests: ProviderRequest[] = [];
  const strategy = createCodingCompactor({
    clientFor: summaryClient(
      createMockProvider([providerTextDelta(`## Progress\ncheck ${secret}`), providerDone()], {
        onRequest: (request) => requests.push(request),
      }),
      model,
    ),
    keepRecentTokens: 1,
    maxSummaryTokens: 100,
    customInstructions: "Prefer the remaining TODO.",
  });
  const previous = createSessionEntry({
    id: "c0",
    sessionId: "s1",
    timestamp,
    kind: "compaction",
    summary: "prior decision: retain tests",
    data: { firstKeptEntryId: "u1" },
  });
  const entries = [
    previous,
    message("u1", "user", [{ type: "text", text: "Plan: fix parser TODO; blocker is failing npm test." }], "c0"),
    message(
      "a2",
      "assistant",
      [
        toolCallContent("read-1", "read", { path: `src/${secret}.ts` }),
        toolCallContent("edit-1", "edit", { path: "src/parser.ts", oldText: "old", newText: "new" }),
      ],
      "u1",
    ),
    message("u3", "user", [{ type: "text", text: "Run npm test next; parser check failed." }], "a2"),
  ];

  const result = await strategy.compact({ sessionId: "s1", entries, secrets: [secret] });
  const prompt = requests[0]?.messages[1]?.content[0];

  assert.equal(strategy.name, "coding");
  assert.equal(prompt?.type, "text");
  assert.match(prompt.text, /prior decision/);
  assert.match(prompt.text, /modified and read file paths/);
  assert.match(prompt.text, /failing-check summaries/);
  assert.match(prompt.text, /Prefer the remaining TODO/);
  assert.equal(prompt.text.includes(secret), false);
  assert.match(result.summary, /<modified-files>\nsrc\/parser.ts/);
  assert.equal(result.summary.includes(secret), false);
  const data = result.entries?.[0]?.data as {
    throughEntryId?: string;
    keepEntryIds?: string[];
    strategy?: string;
    firstKeptEntryId?: string;
    estimatedTokensBefore?: number;
    estimatedTokensAfter?: number;
    readFiles?: string[];
    modifiedFiles?: string[];
  };
  assert.equal(data.throughEntryId, "a2");
  assert.deepEqual(data.keepEntryIds, ["u3"]);
  assert.equal(data.strategy, "coding");
  assert.equal(data.firstKeptEntryId, "u3");
  assert.ok((data.estimatedTokensBefore ?? 0) > (data.estimatedTokensAfter ?? 0));
  assert.deepEqual(data.readFiles, ["src/[REDACTED].ts"]);
  assert.deepEqual(data.modifiedFiles, ["src/parser.ts"]);
  assert.equal(entries.length, 4);
});

test("coding_compaction_preset_keeps_the_shared_summary_cap", async () => {
  const strategy = createCodingCompactor({
    clientFor: summaryClient(createMockProvider([providerTextDelta("x".repeat(100)), providerDone()]), model),
    keepRecentTokens: 1,
    maxSummaryTokens: 1,
  });
  const result = await strategy.compact({
    sessionId: "s1",
    entries: [message("u1", "user", [{ type: "text", text: "old" }]), message("a2", "assistant", [{ type: "text", text: "new" }], "u1")],
  });
  assert.ok(result.summary.length <= 4);
});

test("coding_compaction_preset_keeps_the_latest_plan_turn", async () => {
  const entries: SessionEntry[] = [
    {
      id: "e1",
      sessionId: "s1",
      timestamp,
      kind: "message",
      message: { role: "assistant", content: [{ type: "tool_call", id: "call_todo", name: "todo_write", arguments: {} }] },
    },
    {
      id: "e2",
      sessionId: "s1",
      timestamp,
      kind: "message",
      message: {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call_todo", name: "todo_write", result: "- [ ] 1: step" }],
        metadata: { todos: [{ id: "1", content: "step", status: "pending" }] },
      },
    },
    // Large tail entry: the token budget keeps only this one.
    {
      id: "e3",
      sessionId: "s1",
      timestamp,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "x".repeat(12_000) }] },
    },
  ];
  const strategy = keepLatestPlanTurn(
    createCodingCompactor({
      clientFor: summaryClient(createMockProvider([providerTextDelta("summary"), providerDone()]), model),
      keepRecentTokens: 1,
    }),
  );

  const result = await strategy.compact({ sessionId: "s1", entries, trigger: "auto" });

  const data = result.entries?.[0]?.data as { keepEntryIds?: string[] };
  assert.deepEqual(data.keepEntryIds, ["e3", "e1", "e2"], "the plan turn is re-pinned after the kept tail");
});

test("coding_compaction_preset_conforms without a second runtime", async () => {
  const strategy = createCodingCompactor({
    clientFor: summaryClient(createMockProvider([providerTextDelta("## Goal\nsummary"), providerDone()]), model),
    keepRecentTokens: 1,
  });
  const { summary } = await assertCompactorConforms(strategy, { secrets: ["secret-value"], exerciseAbort: true });
  assert.match(summary, /summary/);
});
