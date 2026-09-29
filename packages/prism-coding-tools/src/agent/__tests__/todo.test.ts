import { test } from "bun:test";
import assert from "node:assert/strict";
import type {
  JsonObject,
  Message,
  SessionEntry,
  StopHook,
  StopHookContext,
  StopHookDecision,
  ToolDefinition,
  ToolResult,
} from "@arnilo/prism";
import {
  createTodoContinuationStopHook,
  createTodoWriteTool,
  DEFAULT_MAX_TODO_NO_PROGRESS,
  formatTodoList,
  HARD_MAX_TODO_ITEMS,
  latestTodoList,
  parseTodoListMetadata,
  parseTodoWriteArgs,
  resolveTodoWriteLimits,
  TODO_WRITE_TOOL_NAME,
  type TodoItem,
  todoPinnedEntryIds,
} from "../todo.js";

const todoItem = (id: string, status: TodoItem["status"], content = `work ${id}`): TodoItem => ({ id, content, status });

// The production tool and hook are synchronous; the contract allows a Promise.
function executeTool(tool: ToolDefinition, args: Record<string, unknown>): ToolResult {
  return tool.execute(args as JsonObject, { sessionId: "s", runId: "r", toolCallId: "call_1" }) as ToolResult;
}

function decide(hook: StopHook, context: StopHookContext): StopHookDecision {
  return hook.decide(context) as StopHookDecision;
}

function steerText(decision: StopHookDecision): string {
  return decision.action === "continue" && typeof decision.steer === "string" ? decision.steer : "";
}

function todoResultMessage(todos: readonly TodoItem[], options?: { readonly toolCallId?: string; readonly error?: string }): Message {
  return {
    role: "tool",
    content: [
      {
        type: "tool_result",
        toolCallId: options?.toolCallId ?? "call_todo",
        name: TODO_WRITE_TOOL_NAME,
        result: formatTodoList(todos),
        ...(options?.error !== undefined ? { error: { message: options.error } } : {}),
      },
    ],
    ...(options?.error === undefined ? { metadata: { todos } } : {}),
  };
}

function otherToolResultMessage(name = "read"): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: `call_${name}`, name, result: "ok" }],
  };
}

function hookContext(history: readonly Message[], overrides?: Partial<StopHookContext>): StopHookContext {
  return {
    sessionId: "session_1",
    runId: "run_1",
    turn: 1,
    history,
    metadata: {},
    signal: new AbortController().signal,
    stopHookActive: false,
    ...overrides,
  };
}

test("createTodoWriteTool returns the rendered list and structured metadata", () => {
  const tool = createTodoWriteTool();
  const result = executeTool(tool, { todos: [todoItem("1", "completed"), todoItem("2", "in_progress")] });
  assert.equal(result.error, undefined);
  const text = (result.content ?? []).map((block) => ("text" in block ? block.text : "")).join("");
  assert.match(text, /\[x\] 1: work 1/);
  assert.match(text, /\[~\] 2: work 2/);
  assert.deepEqual(parseTodoListMetadata(result.metadata), [todoItem("1", "completed"), todoItem("2", "in_progress")]);
});

test("createTodoWriteTool rejects invalid lists with a model-facing error", () => {
  const tool = createTodoWriteTool();
  const execute = (todos: unknown) => executeTool(tool, { todos });

  assert.match(execute("nope").error?.message ?? "", /todos must be an array/);
  assert.match(execute([todoItem("1", "pending"), todoItem("1", "pending")]).error?.message ?? "", /duplicate id/);
  assert.match(execute([{ id: "1", content: "x", status: "blocked" }]).error?.message ?? "", /must be one of/);
  assert.match(execute([{ id: "", content: "x", status: "pending" }]).error?.message ?? "", /must be a non-empty string/);

  const tooMany = createTodoWriteTool({ maxItems: 2 });
  assert.match(
    executeTool(tooMany, { todos: [todoItem("1", "pending"), todoItem("2", "pending"), todoItem("3", "pending")] }).error?.message ?? "",
    /exceeds 2 items/,
  );
});

test("parseTodoWriteArgs accepts an empty list (clear) and enforces hard caps", () => {
  assert.deepEqual(parseTodoWriteArgs({ todos: [] }), []);
  assert.throws(() => createTodoWriteTool({ maxItems: HARD_MAX_TODO_ITEMS + 1 }), /maxItems must be a positive safe integer/);
  const limits = resolveTodoWriteLimits();
  assert.equal(limits.maxItems > 0, true);
});

test("latestTodoList reads the latest successful result and skips failures", () => {
  assert.equal(latestTodoList([]), undefined);
  assert.equal(latestTodoList([otherToolResultMessage()]), undefined);

  const first = todoResultMessage([todoItem("1", "pending")], { toolCallId: "call_a" });
  const failed = todoResultMessage([todoItem("1", "completed")], { toolCallId: "call_b", error: "bad args" });
  assert.deepEqual(latestTodoList([first, failed]), [todoItem("1", "pending")]);
  assert.deepEqual(latestTodoList([first, otherToolResultMessage()]), [todoItem("1", "pending")]);
});

test("stop hook stops when no list exists or every item is closed", () => {
  const hook = createTodoContinuationStopHook();
  assert.deepEqual(decide(hook, hookContext([])), { action: "stop" });
  assert.deepEqual(decide(hook, hookContext([todoResultMessage([todoItem("1", "completed"), todoItem("2", "cancelled")])])), {
    action: "stop",
  });
});

test("stop hook continues on open items with a steer listing them", () => {
  const hook = createTodoContinuationStopHook();
  const decision = decide(hook, hookContext([todoResultMessage([todoItem("1", "pending"), todoItem("2", "in_progress")])]));
  assert.equal(decision.action, "continue");
  if (decision.action !== "continue") return;
  assert.match(steerText(decision), /\[pending\] 1: work 1/);
  assert.match(steerText(decision), /\[in_progress\] 2: work 2/);
  assert.match(steerText(decision), /mark them completed\/cancelled/);
});

test("stop hook stops after maxNoProgress continuations without tool or todo progress", () => {
  const hook = createTodoContinuationStopHook();
  const list = todoResultMessage([todoItem("1", "pending")]);
  const stops: number[] = [];
  hook.onNoProgressStop = (info) => stops.push(info.noProgress);

  assert.equal(decide(hook, hookContext([list])).action, "continue");
  assert.equal(decide(hook, hookContext([list])).action, "continue"); // no progress #1
  const final = decide(hook, hookContext([list])); // no progress #2 -> stop
  assert.deepEqual(final, { action: "stop" });
  assert.deepEqual(stops, [DEFAULT_MAX_TODO_NO_PROGRESS]);
});

test("maxNoProgress: 1 stops on the first no-progress continuation", () => {
  const hook = createTodoContinuationStopHook({ maxNoProgress: 1 });
  const list = todoResultMessage([todoItem("1", "pending")]);
  assert.equal(decide(hook, hookContext([list])).action, "continue");
  assert.deepEqual(decide(hook, hookContext([list])), { action: "stop" });
});

test("stop hook treats a new tool result or list change as progress", () => {
  const hook = createTodoContinuationStopHook({ maxNoProgress: 1 });
  const list = todoResultMessage([todoItem("1", "pending")]);
  assert.equal(decide(hook, hookContext([list])).action, "continue");

  // New tool call -> progress -> continue (counter resets, no stop).
  assert.equal(decide(hook, hookContext([list, otherToolResultMessage()])).action, "continue");
  // List change -> progress -> continue.
  const changed = todoResultMessage([todoItem("1", "in_progress")], { toolCallId: "call_todo_2" });
  assert.equal(decide(hook, hookContext([list, otherToolResultMessage(), changed])).action, "continue");
  // No progress since the changed list -> stop (maxNoProgress: 1).
  assert.deepEqual(decide(hook, hookContext([list, otherToolResultMessage(), changed])), { action: "stop" });
});

test("stop hook never continues an aborted run", () => {
  const hook = createTodoContinuationStopHook();
  const controller = new AbortController();
  controller.abort();
  const decision = decide(hook, hookContext([todoResultMessage([todoItem("1", "pending")])], { signal: controller.signal }));
  assert.deepEqual(decision, { action: "stop" });
});

test("stop hook validates options and bounds the steer", () => {
  assert.throws(() => createTodoContinuationStopHook({ maxNoProgress: 0 }), /maxNoProgress/);
  const hook = createTodoContinuationStopHook({ maxNoProgress: 5, maxSteerItems: 1, maxSteerBytes: 64 });
  const decision = decide(
    hook,
    hookContext([todoResultMessage([todoItem("1", "pending"), todoItem("2", "pending"), todoItem("3", "pending")])]),
  );
  assert.equal(decision.action, "continue");
  if (decision.action !== "continue") return;
  assert.match(steerText(decision), /and 2 more/);
  assert.equal(Buffer.byteLength(steerText(decision), "utf8") <= 64, true);
});

function messageEntry(id: string, message: Message): SessionEntry {
  return { id, sessionId: "s", timestamp: new Date(0).toISOString(), kind: "message", message };
}

function assistantCall(id: string, calls: readonly { readonly toolCallId: string; readonly name: string }[]): SessionEntry {
  return messageEntry(id, {
    role: "assistant",
    content: calls.map((call) => ({ type: "tool_call", id: call.toolCallId, name: call.name, arguments: {} })),
  });
}

test("todoPinnedEntryIds pins the latest successful todo turn, call and results together", () => {
  const old = [
    assistantCall("a1", [{ toolCallId: "call_old", name: TODO_WRITE_TOOL_NAME }]),
    messageEntry("t1", todoResultMessage([todoItem("1", "pending")], { toolCallId: "call_old" })),
  ];
  const latest = [
    // Sibling tools of the same turn must travel with the pinned result, or the transcript is invalid.
    assistantCall("a2", [
      { toolCallId: "call_read", name: "read" },
      { toolCallId: "call_todo", name: TODO_WRITE_TOOL_NAME },
    ]),
    messageEntry("t2", otherToolResultMessage()),
    messageEntry("t3", todoResultMessage([todoItem("1", "in_progress")], { toolCallId: "call_todo" })),
  ];
  assert.deepEqual(todoPinnedEntryIds([...old, ...latest]), ["a2", "t2", "t3"]);
  // The assistant entry must be present: a tool result alone is not a valid pin.
  assert.deepEqual(todoPinnedEntryIds([messageEntry("t3", todoResultMessage([todoItem("1", "pending")]))]), []);
});

test("todoPinnedEntryIds skips failed calls and unpins when no list was ever written", () => {
  const previous = [
    assistantCall("a1", [{ toolCallId: "call_ok", name: TODO_WRITE_TOOL_NAME }]),
    messageEntry("t1", todoResultMessage([todoItem("1", "pending")], { toolCallId: "call_ok" })),
  ];
  const failed = [
    assistantCall("a2", [{ toolCallId: "call_bad", name: TODO_WRITE_TOOL_NAME }]),
    messageEntry("t2", todoResultMessage([todoItem("1", "completed")], { toolCallId: "call_bad", error: "bad args" })),
  ];
  assert.deepEqual(todoPinnedEntryIds([...previous, ...failed]), ["a1", "t1"]);
  assert.deepEqual(todoPinnedEntryIds([messageEntry("t1", otherToolResultMessage())]), []);
  assert.deepEqual(todoPinnedEntryIds([]), []);
});
