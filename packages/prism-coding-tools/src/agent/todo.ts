/**
 * `todo_write` planning tool + task-completion continuation stop hook (plan 137 Task 7).
 *
 * Stateless by design: the canonical todo list is the latest successful `todo_write` tool result
 * in the transcript, so it survives durable resume for free and the stop hook scans history
 * instead of keeping a second store. The hook continues a run that would end with open items,
 * and stops it when the model makes no tool calls and no list change across continuations.
 *
 * Because the list lives in history, compaction must not cut it away: {@link todoPinnedEntryIds}
 * reports the session entries a compaction has to keep.
 */
import { Buffer } from "node:buffer";
import type {
  JsonObject,
  Message,
  SessionEntry,
  StopHook,
  StopHookContext,
  StopHookDecision,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  ToolResultContent,
} from "@arnilo/prism";
import { CODING_OBSERVATION_EFFECT } from "./effects.js";
import { validateCodingLimit } from "./limits.js";

export const TODO_WRITE_TOOL_NAME = "todo_write" as const;

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
}

/** Shape carried on the `todo_write` tool result metadata (and so in transcript history). */
export interface TodoListMetadata {
  readonly todos: readonly TodoItem[];
}

export const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];

const OPEN_TODO_STATUSES: ReadonlySet<TodoStatus> = new Set<TodoStatus>(["pending", "in_progress"]);

const STATUS_GLYPHS: Readonly<Record<TodoStatus, string>> = {
  pending: " ",
  in_progress: "~",
  completed: "x",
  cancelled: "-",
};

export const DEFAULT_MAX_TODO_ITEMS = 50;
export const HARD_MAX_TODO_ITEMS = 200;
export const DEFAULT_MAX_TODO_CONTENT_BYTES = 512;
export const HARD_MAX_TODO_CONTENT_BYTES = 4_096;
export const DEFAULT_MAX_TODO_ID_BYTES = 128;
export const HARD_MAX_TODO_ID_BYTES = 512;

export const DEFAULT_MAX_TODO_NO_PROGRESS = 2;
export const HARD_MAX_TODO_NO_PROGRESS = 20;
export const DEFAULT_MAX_TODO_STEER_ITEMS = 20;
export const HARD_MAX_TODO_STEER_ITEMS = 50;
export const DEFAULT_MAX_TODO_STEER_BYTES = 4_096;
export const HARD_MAX_TODO_STEER_BYTES = 16_384;

export interface TodoWriteToolOptions {
  readonly maxItems?: number;
  readonly maxContentBytes?: number;
  readonly maxIdBytes?: number;
}

export interface ResolvedTodoWriteLimits {
  readonly maxItems: number;
  readonly maxContentBytes: number;
  readonly maxIdBytes: number;
}

export function resolveTodoWriteLimits(options?: TodoWriteToolOptions): ResolvedTodoWriteLimits {
  return {
    maxItems: validateCodingLimit("maxItems", options?.maxItems ?? DEFAULT_MAX_TODO_ITEMS, HARD_MAX_TODO_ITEMS),
    maxContentBytes: validateCodingLimit(
      "maxContentBytes",
      options?.maxContentBytes ?? DEFAULT_MAX_TODO_CONTENT_BYTES,
      HARD_MAX_TODO_CONTENT_BYTES,
    ),
    maxIdBytes: validateCodingLimit("maxIdBytes", options?.maxIdBytes ?? DEFAULT_MAX_TODO_ID_BYTES, HARD_MAX_TODO_ID_BYTES),
  };
}

const READ_LIMITS: ResolvedTodoWriteLimits = {
  maxItems: HARD_MAX_TODO_ITEMS,
  maxContentBytes: HARD_MAX_TODO_CONTENT_BYTES,
  maxIdBytes: HARD_MAX_TODO_ID_BYTES,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function requireBoundedString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (byteLength(value) > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  return value;
}

function requireStatus(value: unknown, label: string): TodoStatus {
  if (typeof value !== "string" || !TODO_STATUSES.includes(value as TodoStatus)) {
    throw new Error(`${label} must be one of ${TODO_STATUSES.join(", ")}`);
  }
  return value as TodoStatus;
}

function parseTodoItem(value: unknown, index: number, limits: ResolvedTodoWriteLimits): TodoItem {
  if (!isRecord(value)) throw new Error(`todos[${index}] must be an object`);
  return {
    id: requireBoundedString(value.id, `todos[${index}].id`, limits.maxIdBytes),
    content: requireBoundedString(value.content, `todos[${index}].content`, limits.maxContentBytes),
    status: requireStatus(value.status, `todos[${index}].status`),
  };
}

/** Parse and validate `todo_write` arguments; throws with a model-facing message. */
export function parseTodoWriteArgs(args: JsonObject, limits: ResolvedTodoWriteLimits = resolveTodoWriteLimits()): readonly TodoItem[] {
  const raw = args.todos;
  if (!Array.isArray(raw)) throw new Error("todos must be an array");
  if (raw.length > limits.maxItems) throw new Error(`todos exceeds ${limits.maxItems} items`);
  const todos = raw.map((value, index) => parseTodoItem(value, index, limits));
  const seen = new Set<string>();
  for (const todo of todos) {
    if (seen.has(todo.id)) throw new Error(`todos contains duplicate id "${todo.id}"`);
    seen.add(todo.id);
  }
  return todos;
}

/** Read a todo list back from stored metadata; invalid shapes read as absent, never throw. */
export function parseTodoListMetadata(metadata: unknown): readonly TodoItem[] | undefined {
  if (!isRecord(metadata) || !Array.isArray(metadata.todos)) return undefined;
  try {
    return metadata.todos.map((value, index) => parseTodoItem(value, index, READ_LIMITS));
  } catch {
    return undefined;
  }
}

/** Render the list for the model (also the tool result text). */
export function formatTodoList(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return "Todo list cleared (no items).";
  const lines = todos.map((todo) => `- [${STATUS_GLYPHS[todo.status]}] ${todo.id}: ${todo.content}`);
  const open = todos.filter((todo) => OPEN_TODO_STATUSES.has(todo.status)).length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length;
  lines.push(`Summary: ${open} open, ${completed} completed, ${cancelled} cancelled.`);
  return lines.join("\n");
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: TODO_WRITE_TOOL_NAME,
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

export function createTodoWriteTool(options?: TodoWriteToolOptions): ToolDefinition {
  const limits = resolveTodoWriteLimits(options);
  return {
    name: TODO_WRITE_TOOL_NAME,
    kind: "think",
    effect: CODING_OBSERVATION_EFFECT,
    description:
      "Replace the full todo list for the current task. Use it for multi-step work: one item per step, status pending/in_progress/completed/cancelled. Send every item on each call; the latest call is the current list.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The complete todo list (replaces any previous list).",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable short id for the item" },
              content: { type: "string", description: "What the step is" },
              status: { type: "string", enum: [...TODO_STATUSES] },
            },
            required: ["id", "content", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    } as JsonObject,
    execute(args: JsonObject, context: ToolExecutionContext): ToolResult {
      let todos: readonly TodoItem[];
      try {
        todos = parseTodoWriteArgs(args, limits);
      } catch (error) {
        return errorResult(context.toolCallId, error instanceof Error ? error.message : String(error));
      }
      return {
        toolCallId: context.toolCallId,
        name: TODO_WRITE_TOOL_NAME,
        content: [{ type: "text", text: formatTodoList(todos) }],
        metadata: { todos },
      };
    },
  };
}

/** The `tool_result` block of a successful `todo_write` call, or `undefined` for any other message. */
function todoResultBlock(message: Message | undefined): ToolResultContent | undefined {
  if (message?.role !== "tool") return undefined;
  for (const block of message.content) {
    if (block.type !== "tool_result" || block.name !== TODO_WRITE_TOOL_NAME) continue;
    if (block.error !== undefined && block.error !== null) continue;
    return block;
  }
  return undefined;
}

/**
 * Latest successful `todo_write` list in a transcript. Scans backwards and stops at the first
 * result, so cost stays proportional to the distance to the most recent list. A failed call is
 * skipped (the previous successful list still stands).
 */
export function latestTodoList(history: readonly Message[]): readonly TodoItem[] | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message === undefined || todoResultBlock(message) === undefined) continue;
    const todos = parseTodoListMetadata(message.metadata);
    if (todos !== undefined) return todos;
  }
  return undefined;
}

/**
 * Session entry ids a compaction must keep so the latest plan stays readable: the assistant entry
 * that called `todo_write` plus every tool entry of that turn. A pinned tool result without its
 * assistant call is not a valid transcript, so the whole turn is pinned or nothing is.
 *
 * Returns `[]` when no successful call exists (the tool was never used, or every call failed) or
 * when the owning assistant entry is missing — in both cases there is nothing the hook could read.
 */
export function todoPinnedEntryIds(entries: readonly SessionEntry[]): readonly string[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind !== "message" || entry.message === undefined) continue;
    const block = todoResultBlock(entry.message);
    if (block === undefined || parseTodoListMetadata(entry.message.metadata) === undefined) continue;
    const start = assistantEntryIndex(entries, index, block.toolCallId);
    if (start < 0) return [];
    const ids: string[] = [];
    for (let cursor = start; cursor < entries.length; cursor += 1) {
      const current = entries[cursor];
      if (current?.kind !== "message" || current.message === undefined) break;
      if (cursor > start && current.message.role !== "tool") break;
      ids.push(current.id);
    }
    return ids;
  }
  return [];
}

function assistantEntryIndex(entries: readonly SessionEntry[], before: number, toolCallId: string): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role !== "assistant") continue;
    if (message.content.some((block) => block.type === "tool_call" && block.id === toolCallId)) return index;
  }
  return -1;
}

function countToolResults(history: readonly Message[]): number {
  let count = 0;
  for (const message of history) {
    if (message.role !== "tool") continue;
    for (const block of message.content) {
      if (block.type === "tool_result") count += 1;
    }
  }
  return count;
}

export interface TodoContinuationStopHookOptions {
  /** Consecutive continuations with no new tool call and no list change before stopping. Default 2. */
  readonly maxNoProgress?: number;
  readonly maxSteerItems?: number;
  readonly maxSteerBytes?: number;
}

export interface TodoNoProgressStopInfo {
  readonly openTodos: readonly TodoItem[];
  readonly noProgress: number;
}

export interface TodoContinuationStopHook extends StopHook {
  /** Host hook for surfacing the stop (e.g. a TUI system note). Never called with secrets. */
  onNoProgressStop?: (info: TodoNoProgressStopInfo) => void;
}

interface TodoRunState {
  signature: string;
  noProgress: number;
}

const MAX_TRACKED_RUNS = 1_024;

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= maxBytes ? value : bytes.subarray(0, maxBytes).toString("utf8");
}

function continueDecision(open: readonly TodoItem[], maxSteerItems: number, maxSteerBytes: number): StopHookDecision {
  const shown = open.slice(0, maxSteerItems);
  const lines = shown.map((todo) => `- [${todo.status}] ${todo.id}: ${todo.content}`);
  if (open.length > shown.length) lines.push(`- …and ${open.length - shown.length} more`);
  const steer = truncateUtf8(
    `Open todo items (${open.length}):\n${lines.join("\n")}\nContinue with the remaining items, or mark them completed/cancelled with a reason.`,
    maxSteerBytes,
  );
  return { action: "continue", reason: "Open todo items remain; the task is not complete.", steer };
}

export function createTodoContinuationStopHook(options?: TodoContinuationStopHookOptions): TodoContinuationStopHook {
  const maxNoProgress =
    options?.maxNoProgress === undefined
      ? DEFAULT_MAX_TODO_NO_PROGRESS
      : validateCodingLimit("maxNoProgress", options.maxNoProgress, HARD_MAX_TODO_NO_PROGRESS);
  const maxSteerItems =
    options?.maxSteerItems === undefined
      ? DEFAULT_MAX_TODO_STEER_ITEMS
      : validateCodingLimit("maxSteerItems", options.maxSteerItems, HARD_MAX_TODO_STEER_ITEMS);
  const maxSteerBytes =
    options?.maxSteerBytes === undefined
      ? DEFAULT_MAX_TODO_STEER_BYTES
      : validateCodingLimit("maxSteerBytes", options.maxSteerBytes, HARD_MAX_TODO_STEER_BYTES);

  // Per-run continuation counters; a host reuses one hook instance across runs.
  const runs = new Map<string, TodoRunState>();

  const hook: TodoContinuationStopHook = {
    name: "todo-continuation",
    decide(context: StopHookContext): StopHookDecision {
      const key = `${context.sessionId}:${context.runId}`;
      // User abort always wins over continuation.
      if (context.signal.aborted) {
        runs.delete(key);
        return { action: "stop" };
      }
      const todos = latestTodoList(context.history);
      if (todos === undefined) {
        runs.delete(key);
        return { action: "stop" };
      }
      const open = todos.filter((todo) => OPEN_TODO_STATUSES.has(todo.status));
      if (open.length === 0) {
        runs.delete(key);
        return { action: "stop" };
      }

      const signature = `${countToolResults(context.history)}:${JSON.stringify(todos)}`;
      const previous = runs.get(key);
      if (previous === undefined) {
        if (runs.size >= MAX_TRACKED_RUNS) runs.clear();
        runs.set(key, { signature, noProgress: 0 });
        return continueDecision(open, maxSteerItems, maxSteerBytes);
      }
      if (previous.signature === signature) {
        previous.noProgress += 1;
        if (previous.noProgress >= maxNoProgress) {
          runs.delete(key);
          hook.onNoProgressStop?.({ openTodos: open, noProgress: previous.noProgress });
          return { action: "stop" };
        }
      } else {
        previous.signature = signature;
        previous.noProgress = 0;
      }
      return continueDecision(open, maxSteerItems, maxSteerBytes);
    },
  };
  return hook;
}
