import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionEntry, type SessionEntry } from "@arnilo/prism";
import { buildObservationalMemoryContextBlocks, renderRecentMessageWindow, selectRecentMessageEntries } from "../recent-messages.js";
import { OBSERVATIONS_RECORDED } from "../types.js";

const now = "2026-06-20T00:00:00.000Z";

function message(id: string, role: "user" | "assistant" | "tool", text: string, extra?: SessionEntry["message"]): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: now,
    kind: "message",
    message: extra ?? { role, content: [{ type: "text", text }] },
  });
}

describe("observational memory recent messages", () => {
  it("preserves_user_assistant_tool_order_in_recent_window", () => {
    const entries = [
      message("m1", "user", "old"),
      message("m2", "assistant", "call", {
        role: "assistant",
        content: [{ type: "tool_call", id: "tc1", name: "read", arguments: { path: "a.ts" } }],
      }),
      message("m3", "tool", "ok", {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "tc1", name: "read", result: { text: "ok" } }],
      }),
      message("m4", "user", "new"),
    ];
    const rendered = renderRecentMessageWindow(selectRecentMessageEntries(entries, { keepRecentEntries: 3 }));
    const lines = rendered.split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /m2.*assistant.*tool_call read/);
    assert.match(lines[1]!, /m3.*tool.*tool_result read/);
    assert.match(lines[2]!, /m4.*user.*new/);
    assert.equal(entries.length, 4);
  });

  it("count_limit_keeps_newest_messages", () => {
    const entries = [message("m1", "user", "one"), message("m2", "user", "two"), message("m3", "user", "three")];
    const selected = selectRecentMessageEntries(entries, { keepRecentEntries: 2 });
    assert.deepEqual(
      selected.map((entry) => entry.id),
      ["m2", "m3"],
    );
  });

  it("token_limit_drops_oldest_window_entries_first", () => {
    const entries = [message("m1", "user", "x".repeat(40)), message("m2", "user", "y".repeat(200)), message("m3", "user", "z")];
    const selected = selectRecentMessageEntries(entries, { keepRecentEntries: 3, maxTokens: 20 });
    assert.deepEqual(
      selected.map((entry) => entry.id),
      ["m3"],
    );
  });

  it("multimodal_blocks_render_as_placeholders", () => {
    const entry = message("m1", "user", "", {
      role: "user",
      content: [
        { type: "text", text: "see" },
        { type: "image", name: "shot.png" },
        { type: "audio", mediaType: "audio/wav" },
      ],
    });
    const rendered = renderRecentMessageWindow([entry]);
    assert.match(rendered, /see/);
    assert.match(rendered, /\[image shot\.png\]/);
    assert.match(rendered, /\[audio\]/);
  });

  it("redaction_applies_to_recent_window", () => {
    const entries = [message("m1", "user", "token secret-value here")];
    const rendered = renderRecentMessageWindow(entries, ["secret-value"]);
    assert.equal(rendered.includes("secret-value"), false);
  });

  it("context_blocks_include_memory_and_recent_messages", () => {
    const entries = [
      message("m1", "user", "source"),
      createSessionEntry({
        id: "om1",
        sessionId: "s1",
        parentId: "m1",
        timestamp: now,
        kind: "custom",
        data: {
          type: OBSERVATIONS_RECORDED,
          observations: [
            {
              id: "aaaaaaaaaaaa",
              content: "fact",
              timestamp: now,
              relevance: "high",
              sourceEntryIds: ["m1"],
              tokenCount: 1,
            },
          ],
          coversUpToId: "m1",
        },
      }),
      message("m2", "user", "recent"),
    ];
    const blocks = buildObservationalMemoryContextBlocks(entries, { keepRecentEntries: 1 });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.title, "observational-memory");
    assert.match(String(blocks[0]?.content ?? ""), /fact/);
    assert.equal(blocks[1]?.title, "recent-messages");
    assert.match(String(blocks[1]?.content ?? ""), /m2.*recent/);
    assert.doesNotMatch(String(blocks[1]?.content ?? ""), /m1.*source/);
  });
});
