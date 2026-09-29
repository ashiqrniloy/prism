import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent } from "@arnilo/prism";
import { createInitialTuiState, tuiReducer, type UiMessageEntry, type UiToolCallEntry } from "../tui/reducer.js";

describe("TUI Reducer", () => {
  it("delta append coalesces sequential message_delta events into one message entry", () => {
    let state = createInitialTuiState();

    const startEvent: AgentEvent = {
      type: "message_started",
      sessionId: "s1",
      runId: "r1",
      message: { role: "assistant", content: [] },
    };
    state = tuiReducer(state, { type: "session_event", event: startEvent });
    assert.strictEqual(state.entries.length, 1);
    assert.strictEqual(state.entries[0]?.type, "message");
    assert.strictEqual((state.entries[0] as UiMessageEntry).text, "");

    const delta1: AgentEvent = {
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "Hello " },
    };
    state = tuiReducer(state, { type: "session_event", event: delta1 });
    assert.strictEqual(state.entries.length, 1, "Should coalesce into the same entry");
    assert.strictEqual((state.entries[0] as UiMessageEntry).text, "Hello ");

    const delta2: AgentEvent = {
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "world!" },
    };
    state = tuiReducer(state, { type: "session_event", event: delta2 });
    assert.strictEqual(state.entries.length, 1, "Should coalesce into the same entry");
    assert.strictEqual((state.entries[0] as UiMessageEntry).text, "Hello world!");

    const finishEvent: AgentEvent = {
      type: "message_finished",
      sessionId: "s1",
      runId: "r1",
      message: { role: "assistant", content: [{ type: "text", text: "Hello world!" }] },
    };
    state = tuiReducer(state, { type: "session_event", event: finishEvent });
    assert.strictEqual(state.entries.length, 1);
    assert.strictEqual((state.entries[0] as UiMessageEntry).finished, true);
  });

  it("tool call start and finish update tool call entry status", () => {
    let state = createInitialTuiState();

    const toolStart: AgentEvent = {
      type: "tool_execution_started",
      sessionId: "s1",
      runId: "r1",
      call: {
        id: "call_abc123",
        type: "tool_call",
        name: "repo_list",
        arguments: { path: "src/" },
      },
    };
    state = tuiReducer(state, { type: "session_event", event: toolStart });
    assert.strictEqual(state.entries.length, 1);
    const toolEntry = state.entries[0] as UiToolCallEntry;
    assert.strictEqual(toolEntry.type, "tool_call");
    assert.strictEqual(toolEntry.name, "repo_list");
    assert.strictEqual(toolEntry.status, "running");
    assert.ok(toolEntry.argsSummary.includes("src/"));

    const toolFinish: AgentEvent = {
      type: "tool_execution_finished",
      sessionId: "s1",
      runId: "call_abc123",
      result: {
        toolCallId: "call_abc123",
        name: "repo_list",
        content: [{ type: "text", text: "index.ts, config.ts" }],
      },
      metadata: { durationMs: 12, status: "finished" },
    };
    state = tuiReducer(state, { type: "session_event", event: toolFinish });
    assert.strictEqual(state.entries.length, 1);
    const finishedEntry = state.entries[0] as UiToolCallEntry;
    assert.strictEqual(finishedEntry.status, "success");
    assert.ok(finishedEntry.resultSummary?.includes("index.ts"));
  });

  it("updates parallel tools out of order without using runId as a tool id", () => {
    let state = createInitialTuiState();
    for (const id of ["first", "second"]) {
      state = tuiReducer(state, {
        type: "session_event",
        event: {
          type: "tool_execution_started",
          sessionId: "s",
          runId: "shared-run",
          call: { id, type: "tool_call", name: "shell", arguments: { id } },
        },
      });
    }
    for (const id of ["second", "first"]) {
      state = tuiReducer(state, {
        type: "session_event",
        event: {
          type: "tool_execution_finished",
          sessionId: "s",
          runId: "shared-run",
          result: { toolCallId: id, name: "shell", value: id },
          metadata: { durationMs: 1, status: "finished" },
        },
      });
      assert.deepStrictEqual(state.changedEntryIds, [`tool_${id}`]);
      assert.strictEqual((state.entries.find((entry) => entry.id === `tool_${id}`) as UiToolCallEntry).status, "success");
      assert.strictEqual((state.entries.find((entry) => entry.id === `tool_${id}`) as UiToolCallEntry).version, 2);
    }
    assert.strictEqual((state.entries[0] as UiToolCallEntry).argsSummary, '{"id":"first"}');
  });

  it("marks blocked/approval-denied and error-result cards independently", () => {
    let state = createInitialTuiState();
    for (const id of ["blocked", "error", "refused"]) {
      state = tuiReducer(state, {
        type: "session_event",
        event: {
          type: "tool_execution_started",
          sessionId: "s",
          runId: "r",
          call: { id, type: "tool_call", name: "shell", arguments: {} },
        },
      });
    }
    state = tuiReducer(state, {
      type: "session_event",
      event: {
        type: "tool_execution_blocked",
        sessionId: "s",
        runId: "r",
        toolCallId: "blocked",
        name: "shell",
        reason: "approval refused",
        error: { message: "denied" },
        metadata: { durationMs: 1, status: "error" },
      },
    });
    state = tuiReducer(state, {
      type: "session_event",
      event: {
        type: "tool_execution_finished",
        sessionId: "s",
        runId: "r",
        result: { toolCallId: "error", name: "shell", error: { message: "operation failed" } },
        metadata: { durationMs: 1, status: "error" },
      },
    });
    state = tuiReducer(state, {
      type: "session_event",
      event: {
        type: "tool_execution_error",
        sessionId: "s",
        runId: "r",
        call: { id: "refused", type: "tool_call", name: "shell", arguments: {} },
        error: { message: "permission denied" },
        metadata: { durationMs: 1, status: "error" },
      },
    });
    assert.deepStrictEqual(
      state.entries.map((entry) => (entry as UiToolCallEntry).status),
      ["denied", "failure", "denied"],
    );
  });

  it("tool call error updates status to failure with error message", () => {
    let state = createInitialTuiState();

    const toolStart: AgentEvent = {
      type: "tool_execution_started",
      sessionId: "s1",
      runId: "r1",
      call: {
        id: "call_err456",
        type: "tool_call",
        name: "shell",
        arguments: { command: "false" },
      },
    };
    state = tuiReducer(state, { type: "session_event", event: toolStart });

    const toolError: AgentEvent = {
      type: "tool_execution_error",
      sessionId: "s1",
      runId: "r1",
      call: {
        id: "call_err456",
        type: "tool_call",
        name: "shell",
        arguments: { command: "false" },
      },
      error: { message: "Command failed with exit code 1" },
      metadata: { durationMs: 12, status: "error" },
    };
    state = tuiReducer(state, { type: "session_event", event: toolError });

    const entry = state.entries[0] as UiToolCallEntry;
    assert.strictEqual(entry.status, "failure");
    assert.strictEqual(entry.error, "Command failed with exit code 1");
  });

  it("error events (run_limit_exceeded, budget_exhausted, agent_denied) render distinctly", () => {
    let state = createInitialTuiState();

    const limitEvent: AgentEvent = {
      type: "run_limit_exceeded",
      sessionId: "s1",
      runId: "r1",
      breach: { limit: "maxToolRounds", maximum: 5, observed: 6 },
    };
    state = tuiReducer(state, { type: "session_event", event: limitEvent });
    assert.strictEqual(state.entries.length, 1);
    assert.strictEqual(state.entries[0]?.type, "error");
    assert.ok(state.entries[0]?.message.includes("maxToolRounds"));

    const budgetEvent: AgentEvent = {
      type: "budget_exhausted",
      sessionId: "s1",
      runId: "r1",
      limit: "maxTurns",
      consumed: { turns: 10, inputTokens: 50000, providerAttempts: 10, requestBytes: 1024 },
      closestOtherAxes: [],
      recentToolCalls: [],
    };
    state = tuiReducer(state, { type: "session_event", event: budgetEvent });
    assert.strictEqual(state.entries.length, 2);
    assert.strictEqual(state.entries[1]?.type, "error");
    assert.ok(state.entries[1]?.message.includes("maxTurns"));

    const deniedEvent: AgentEvent = {
      type: "agent_denied",
      sessionId: "s1",
      runId: "r1",
      interruption: { kind: "tool_approval", reason: "Operation cancelled by operator" },
      version: 1,
    };
    state = tuiReducer(state, { type: "session_event", event: deniedEvent });
    assert.strictEqual(state.entries.length, 3);
    assert.strictEqual(state.entries[2]?.type, "error");
    assert.ok(state.entries[2]?.message.includes("Operation cancelled by operator"));
  });

  it("scrollback cap is enforced and evicts oldest entries", () => {
    let state = createInitialTuiState({ maxEntries: 3 });

    state = tuiReducer(state, { type: "user_prompt", text: "Entry 1" });
    state = tuiReducer(state, { type: "user_prompt", text: "Entry 2" });
    state = tuiReducer(state, { type: "user_prompt", text: "Entry 3" });
    assert.strictEqual(state.entries.length, 3);
    assert.strictEqual((state.entries[0] as UiMessageEntry).text, "Entry 1");

    // Adding 4th entry evicts Entry 1
    state = tuiReducer(state, { type: "user_prompt", text: "Entry 4" });
    assert.strictEqual(state.entries.length, 3);
    assert.strictEqual((state.entries[0] as UiMessageEntry).text, "Entry 2");
    assert.strictEqual((state.entries[1] as UiMessageEntry).text, "Entry 3");
    assert.strictEqual((state.entries[2] as UiMessageEntry).text, "Entry 4");
  });

  it("effort cycling wraps through declared effort levels", () => {
    let state = createInitialTuiState({ effort: "none" });
    assert.strictEqual(state.footer.effort, "none");

    state = tuiReducer(state, { type: "cycle_effort" });
    assert.strictEqual(state.footer.effort, "low");

    state = tuiReducer(state, { type: "cycle_effort" });
    assert.strictEqual(state.footer.effort, "medium");

    state = tuiReducer(state, { type: "cycle_effort" });
    assert.strictEqual(state.footer.effort, "high");

    state = tuiReducer(state, { type: "cycle_effort" });
    assert.strictEqual(state.footer.effort, "max");

    state = tuiReducer(state, { type: "cycle_effort" });
    assert.strictEqual(state.footer.effort, "none");
  });

  it("tracks usage updates on agent_finished", () => {
    let state = createInitialTuiState();

    const finishEvent: AgentEvent = {
      type: "agent_finished",
      sessionId: "s1",
      runId: "r1",
      usage: { inputTokens: 1200, outputTokens: 350, totalTokens: 1550 },
    };
    state = tuiReducer(state, { type: "session_event", event: finishEvent });
    assert.strictEqual(state.isRunning, false);
    assert.strictEqual(state.footer.usage?.totalTokens, 1550);
  });
});
