import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Message,
  selectTranscript,
  type SessionEntry,
  toolCallContent,
} from "../index.js";

let seq = 0;
const message = (role: Message["role"], text: string, extra: Message["content"] = []): Message => ({
  id: `msg_${++seq}`,
  role,
  content: [{ type: "text", text }, ...extra],
});

/** Entries form one parent chain, which is what a branch walk follows. */
function entries(messages: readonly Message[], sessionId = "session_1"): SessionEntry[] {
  let previous: SessionEntry | undefined;
  return messages.map((message) => {
    const next: SessionEntry = {
      id: `entry_${++seq}`,
      ...(previous === undefined ? {} : { parentId: previous.id }),
      sessionId,
      timestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
      kind: "message",
      message,
    };
    previous = next;
    return next;
  });
}
const entry = (message: Message): SessionEntry => entries([message])[0] as SessionEntry;
/** Appends one entry after a chain, so the branch walk still reaches it. */
const after = (chain: readonly SessionEntry[], extra: Omit<SessionEntry, "parentId" | "id" | "sessionId" | "timestamp">): SessionEntry => ({
  ...extra,
  id: `entry_${++seq}`,
  ...(chain.at(-1) === undefined ? {} : { parentId: chain.at(-1)?.id }),
  sessionId: "session_1",
  timestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
});

/** n user turns, each followed by an assistant reply. */
function turns(n: number, size = 10): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(message("user", `u${i} ${"x".repeat(size)}`));
    out.push(message("assistant", `a${i} ${"y".repeat(size)}`));
  }
  return out;
}

describe("selectTranscript", () => {
  it("select_transcript_keeps_last_n_turns", () => {
    const slice = selectTranscript(entries(turns(10)), { lastTurns: 3, maxChars: 100_000 });
    assert.equal(slice.turns, 3);
    assert.equal(slice.omittedTurns, 7);
    assert.equal(slice.messages.length, 6);
    assert.match(text(slice.messages[0]), /^u7 /);
    assert.equal(slice.truncated, false);
  });

  it("select_transcript_respects_max_chars_newest_first", () => {
    const slice = selectTranscript(entries(turns(5, 100)), { maxChars: 450 });
    const json = JSON.stringify(slice.messages);
    assert.equal(slice.omittedTurns > 0, true);
    assert.equal(json.includes("u0 "), false, "the oldest turns drop first");
    assert.equal(json.includes("u1 "), false);
    assert.match(text(slice.messages.at(-1) as Message), /^a4 /, "the newest turn always survives");
  });

  it("select_transcript_cuts_a_newest_turn_larger_than_the_cap", () => {
    const slice = selectTranscript(entries(turns(3, 400)), { maxChars: 300 });
    assert.equal(slice.truncated, true);
    assert.ok(text(slice.messages.at(-1) ?? message("user", "")).length <= 300);
    assert.match(text(slice.messages.at(-1) ?? message("user", "")), /a2 /, "the newest turn survives, cut");
  });

  it("select_transcript_drops_non_message_entries", () => {
    const base = entries(turns(2));
    const first = after(base, { kind: "package_state", data: { package: "p", value: { x: 1 } } });
    const second = after([...base, first], { kind: "custom", data: { kind: "k", payload: { secret: 1 } } });
    const third = after([...base, first, second], { kind: "event", event: { type: "run.completed" } as never });
    const fourth = after([...base, first, second, third], {
      kind: "suspended_run",
      data: { runId: "run_1", loop: { kind: "default" }, input: [] } as never,
    });
    const slice = selectTranscript([...base, first, second, third, fourth], { maxChars: 100_000 });
    const json = JSON.stringify(slice.messages);
    assert.equal(json.includes("secret"), false);
    assert.equal(json.includes("package_state"), false);
    assert.equal(json.includes("run_1"), false);
    assert.equal(slice.messages.length, 4);
  });

  it("select_transcript_uses_compaction_summary", () => {
    const base = entries(turns(4));
    const through = base[3] as SessionEntry;
    const compaction = after(base, {
      kind: "compaction",
      summary: "Earlier the user asked for a summary.",
      data: { throughEntryId: through.id },
    });
    const tail = after([...base, compaction], { kind: "message", message: message("user", "after compaction") });
    const slice = selectTranscript([...base, compaction, tail], { maxChars: 100_000 });
    assert.deepEqual(slice.summaries, ["Earlier the user asked for a summary."]);
    assert.equal(JSON.stringify(slice.messages).includes("u0 "), false);
    assert.match(text(slice.messages.at(-1) ?? message("user", "")), /after compaction/);
  });

  it("select_transcript_renders_tool_activity_as_text", () => {
    const call = message("assistant", "checking", [toolCallContent("call_1", "read", { path: "/a" } as never)]);
    const result: Message = {
      id: `msg_${++seq}`,
      role: "tool",
      content: [
        {
          type: "tool_result",
          toolCallId: "call_1",
          name: "read",
          result: { content: [{ type: "text", text: "z".repeat(500) }] },
        },
      ],
    };
    const slice = selectTranscript(entries([message("user", "go"), call, result]), { maxChars: 100_000, maxToolChars: 40 });
    const json = JSON.stringify(slice.messages);
    assert.equal(json.includes('"tool_call"'), false);
    assert.equal(slice.messages.some((m) => m.role === "tool"), false);
    assert.match(text(slice.messages[1] ?? message("user", "")), /\[tool_call read \{"path":"\/a"\}\]/);
    assert.match(text(slice.messages[2] ?? message("user", "")), /^\[tool_result read: z{40}…\]/);
    assert.equal(slice.messages[2]?.role, "user", "a tool result is a user-role message");
  });

  it("select_transcript_drops_dangling_tool_call_and_thinking", () => {
    const dangling = message("assistant", "", [toolCallContent("call_missing", "delegate", { child: "x" } as never)]);
    const thinking = message("assistant", "answer", [{ type: "thinking", text: "internal", signature: "sig" }]);
    const slice = selectTranscript(entries([message("user", "go"), dangling, thinking]), { maxChars: 100_000 });
    const json = JSON.stringify(slice.messages);
    assert.equal(json.includes("delegate"), false);
    assert.equal(json.includes("internal"), false);
    assert.equal(json.includes("sig"), false);
    assert.equal(slice.messages.length, 2);
  });

  it("select_transcript_pinned_survives_cut", () => {
    const all = entries(turns(20));
    const first = (all[0] as SessionEntry).message as Message;
    const slice = selectTranscript(all, { lastTurns: 1, maxChars: 100_000, pinned: [first] });
    assert.equal(slice.pinned.length, 1);
    assert.match(text(slice.pinned[0] as Message), /^u0 /);
    assert.equal(slice.turns, 1);
    assert.match(text(slice.messages[0] as Message), /^u19 /);
  });

  it("select_transcript_pinned_inside_the_selection_is_not_repeated", () => {
    const all = entries(turns(2));
    const second = (all[2] as SessionEntry).message as Message;
    const slice = selectTranscript(all, { maxChars: 100_000, pinned: [second] });
    assert.equal(slice.pinned.length, 1);
    const json = JSON.stringify(slice.messages);
    assert.equal(json.includes("u1 "), false, "the pinned message was removed from the selected turns");
    assert.equal(json.includes("u0 "), true);
  });

  it("select_transcript_cuts_an_oversized_pinned_message", () => {
    const pinned = message("user", "p".repeat(500));
    const slice = selectTranscript([entry(message("user", "go"))], { maxChars: 100, pinned: [pinned], lastTurns: 1 });
    assert.equal(slice.truncated, true);
    assert.equal(text(slice.pinned[0] as Message).length, 100);
    assert.equal(slice.messages.length, 0, "nothing is left for the selected turn");
  });

  it("select_transcript_accepts_live_messages", () => {
    const all = turns(4);
    const fromMessages = selectTranscript(all, { lastTurns: 2, maxChars: 100_000 });
    const fromEntries = selectTranscript(entries(all), { lastTurns: 2, maxChars: 100_000 });
    assert.deepEqual(fromMessages.messages.map(text), fromEntries.messages.map(text));
    assert.deepEqual(fromMessages.summaries, []);
  });
});

function text(message: Message): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}
