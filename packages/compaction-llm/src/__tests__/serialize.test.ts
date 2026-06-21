import assert from "node:assert/strict";
import test from "node:test";
import { createSessionEntry, type Message, type SessionEntry } from "prism";
import { collectFileOperations, formatFileOperations } from "../file-ops.js";
import { serializeCompactionConversation } from "../serialize.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function entry(id: string, message: Message): SessionEntry {
  return createSessionEntry({ id, sessionId: "s1", timestamp, kind: "message", message });
}

test("serialize_compaction_conversation_prevents_continuation_and_truncates_tool_results", () => {
  const text = serializeCompactionConversation([
    entry("u1", { role: "user", content: [{ type: "text", text: "please inspect" }] }),
    entry("a2", { role: "assistant", content: [{ type: "thinking", text: "checking" }, { type: "tool_call", id: "call-1", name: "read", arguments: { path: "src/a.ts" } }] }),
    entry("t3", { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "read", result: "x".repeat(20) }] }),
  ], { maxToolResultChars: 5 });

  assert.match(text, /\[User\]/);
  assert.match(text, /\[Assistant thinking\]/);
  assert.match(text, /\[Assistant tool call\]/);
  assert.match(text, /\[Tool result\]/);
  assert.match(text, /characters truncated/);
});

test("serialize_compaction_conversation_redacts_known_secrets", () => {
  const text = serializeCompactionConversation([
    entry("u1", { role: "user", content: [{ type: "text", text: "token secret-value" }] }),
  ], { secrets: ["secret-value"] });

  assert.equal(text.includes("secret-value"), false);
  assert.equal(text.includes("[REDACTED]"), true);
});

test("file_operation_tracking_collects_read_and_modified_paths", () => {
  const details = collectFileOperations([
    { role: "assistant", content: [
      { type: "tool_call", id: "1", name: "read", arguments: { path: "src/a.ts" } },
      { type: "tool_call", id: "2", name: "read", arguments: { path: "src/b.ts" } },
      { type: "tool_call", id: "3", name: "edit", arguments: { path: "src/a.ts" } },
      { type: "tool_call", id: "4", name: "write", arguments: { path: "src/c.ts" } },
    ] },
  ]);

  assert.deepEqual(details.readFiles, ["src/b.ts"]);
  assert.deepEqual(details.modifiedFiles, ["src/a.ts", "src/c.ts"]);
  assert.match(formatFileOperations(details), /<read-files>/);
  assert.match(formatFileOperations(details), /<modified-files>/);
});
