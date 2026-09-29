import type { AgentEvent, ContentBlock, SessionEntry, ToolResult } from "@arnilo/prism";
import { ATTACHMENT_MARKER } from "./completion.js";
import { createInitialTuiState, DEFAULT_MAX_ENTRIES, type TuiAction, tuiReducer, type UiStreamEntry } from "./reducer.js";

/**
 * Flatten the text-bearing blocks of a message into display text (empty when none).
 * `@path` attachment blocks are dropped: the file body belongs to the model, not the transcript.
 */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === "text" && !block.text.startsWith(ATTACHMENT_MARKER) ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function sessionEvent(event: AgentEvent): TuiAction {
  return { type: "session_event", event };
}

/**
 * Rewrites one stored `SessionEntry` into the same actions the live event stream produces, so
 * resume rendering and live rendering share one reducer and one visual language.
 *
 * Persisted history holds messages (assistant text/thinking/tool_call blocks and tool-role
 * tool_result blocks) plus compaction summaries; run events live in the run ledger, not here.
 */
export function sessionEntryToUiActions(entry: SessionEntry): TuiAction[] {
  const actions: TuiAction[] = [];
  const runId = entry.runId ?? `history_${entry.id}`;
  const sessionId = entry.sessionId;

  if (entry.kind === "compaction") {
    actions.push(
      sessionEvent({
        type: "compaction_finished",
        sessionId,
        runId,
        summary: entry.summary ?? "",
      }),
    );
    return actions;
  }

  if (entry.kind !== "message" || !entry.message) return actions;
  const message = entry.message;

  if (message.role === "user") {
    const text = textOf(message.content);
    if (text) actions.push({ type: "user_prompt", text, id: entry.id });
    return actions;
  }

  if (message.role === "tool") {
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const result: ToolResult = {
        toolCallId: block.toolCallId,
        name: block.name,
        value: block.result,
        ...(block.error ? { error: block.error } : {}),
      };
      actions.push(
        sessionEvent({
          type: "tool_execution_finished",
          sessionId,
          runId,
          result,
          metadata: { durationMs: 0, status: block.error ? "error" : "finished" },
        }),
      );
    }
    return actions;
  }

  if (message.role !== "assistant") return actions;

  let textOpen = false;
  const openText = () => {
    if (textOpen) return;
    actions.push(
      sessionEvent({
        type: "message_started",
        sessionId,
        runId,
        message: { role: "assistant", content: [] },
      }),
    );
    textOpen = true;
  };
  const closeText = () => {
    if (!textOpen) return;
    actions.push(
      sessionEvent({
        type: "message_finished",
        sessionId,
        runId,
        message: { role: "assistant", content: [] },
      }),
    );
    textOpen = false;
  };

  for (const block of message.content) {
    if (block.type === "text") {
      openText();
      actions.push(sessionEvent({ type: "message_delta", sessionId, runId, content: block }));
    } else if (block.type === "thinking") {
      closeText();
      actions.push(sessionEvent({ type: "message_delta", sessionId, runId, content: block }));
      // Close the thinking entry immediately so the next text/tool block starts fresh.
      actions.push(
        sessionEvent({
          type: "message_finished",
          sessionId,
          runId,
          message: { role: "assistant", content: [] },
        }),
      );
    } else if (block.type === "tool_call") {
      closeText();
      actions.push(sessionEvent({ type: "tool_execution_started", sessionId, runId, call: block }));
    } else if (block.type === "tool_result") {
      closeText();
      const result: ToolResult = {
        toolCallId: block.toolCallId,
        name: block.name,
        value: block.result,
        ...(block.error ? { error: block.error } : {}),
      };
      actions.push(
        sessionEvent({
          type: "tool_execution_finished",
          sessionId,
          runId,
          result,
          metadata: { durationMs: 0, status: block.error ? "error" : "finished" },
        }),
      );
    } else {
      // Non-text content (image/file/...): keep a placeholder so the turn is not invisible.
      openText();
      actions.push(
        sessionEvent({
          type: "message_delta",
          sessionId,
          runId,
          content: { type: "text", text: `[${block.type}]` },
        }),
      );
    }
  }
  closeText();
  return actions;
}

/**
 * Rebuilds the capped UI transcript for a stored session by replaying entry-derived actions
 * through `tuiReducer` (the same reducer the live event feed uses). Returns the last
 * `maxEntries` entries, mirroring live scrollback.
 */
export function entriesToUiEntries(entries: readonly SessionEntry[], maxEntries: number = DEFAULT_MAX_ENTRIES): readonly UiStreamEntry[] {
  let state = createInitialTuiState({ maxEntries });
  for (const entry of entries) {
    for (const action of sessionEntryToUiActions(entry)) {
      state = tuiReducer(state, action);
    }
  }
  return state.entries;
}
