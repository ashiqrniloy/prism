import type { AgentEvent, ToolResult, Usage } from "@arnilo/prism";
import { parseTodoListMetadata, TODO_WRITE_TOOL_NAME, type TodoItem } from "@arnilo/prism-coding-tools/agent";
import type { PrismCodeApprovalMode } from "../approval.js";
import { sanitizeTerminalText } from "./sanitize.js";

export type UiMessageRole = "user" | "assistant" | "system";
export type UiToolCallStatus = "running" | "success" | "failure" | "denied";

export interface UiMessageEntry {
  readonly id: string;
  readonly version?: number;
  readonly type: "message";
  readonly role: UiMessageRole;
  readonly text: string;
  readonly finished?: boolean;
}

export interface UiToolCallEntry {
  readonly id: string;
  readonly version?: number;
  readonly type: "tool_call";
  readonly toolCallId: string;
  readonly name: string;
  readonly argsSummary: string;
  readonly status: UiToolCallStatus;
  readonly resultSummary?: string;
  readonly error?: string;
  /** Elapsed time reported by the runtime; absent while running or on replayed history. */
  readonly durationMs?: number;
  /** Sanitized, byte-bounded result text (head+tail with an omitted-lines marker when huge). */
  readonly output?: string;
  /** Bounded unified patch: the real one when reported, otherwise the proposal from the call arguments. */
  readonly patch?: string;
}

export interface UiErrorEntry {
  readonly id: string;
  readonly version?: number;
  readonly type: "error";
  readonly message: string;
}

/** Reasoning/thinking block, rendered collapsed to a single line. */
export interface UiThinkingEntry {
  readonly id: string;
  readonly version?: number;
  readonly type: "thinking";
  readonly text: string;
  readonly finished?: boolean;
}

export type UiStreamEntry = UiMessageEntry | UiToolCallEntry | UiErrorEntry | UiThinkingEntry;

export interface UiFooterStatus {
  readonly repo?: string;
  readonly branch?: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  /** Active approval mode; rendered in the footer so `auto` is always visible. */
  readonly approval?: PrismCodeApprovalMode;
  readonly connectedMcpCount: number;
  /** Total configured MCP servers; enables `MCP: connected/total` rendering. */
  readonly mcpTotalCount?: number;
  /** Failed MCP servers, highlighted in the footer. */
  readonly mcpFailedCount?: number;
  readonly omEnabled?: boolean;
  readonly omModel?: string;
  /** Set when the active model had no catalog entry: limits are assumed, not measured. */
  readonly modelNotice?: string;
  readonly usage?: Usage;
  /** Context usage for the next request, mirrored from `session.contextMeter()` by the host. */
  readonly contextTokens?: number;
  readonly contextCap?: number;
  readonly contextSource?: "reported" | "estimated";
  /** Cumulative provider usage for this session, aggregated per provider turn. */
  readonly usageTotals?: Usage;
}

export interface UiApprovalRequest {
  readonly toolName: string;
  readonly actionKind: string;
  readonly operation: string;
  readonly summary: string;
  /** Proposed unified patch for mutating tools; rendered before the operator decides. */
  readonly patch?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TuiState {
  readonly entries: readonly UiStreamEntry[];
  /** Entry ids touched by the last reducer transition; render only these, not the entire transcript. */
  readonly changedEntryIds: readonly string[];
  readonly maxEntries: number;
  readonly isRunning: boolean;
  readonly sessionId?: string;
  readonly activeRunId?: string;
  readonly footer: UiFooterStatus;
  readonly approval?: UiApprovalRequest;
  readonly effortIndex: number;
  /** Latest `todo_write` list, rendered as a live panel (plan 137 Task 7). */
  readonly todos?: readonly TodoItem[];
  /** Run whose provider turns were already added to `footer.usageTotals` (fallback bookkeeping). */
  readonly usageRunId?: string;
}

export type TuiAction =
  | { readonly type: "session_event"; readonly event: AgentEvent }
  | { readonly type: "user_prompt"; readonly text: string; readonly id?: string }
  | { readonly type: "set_session_id"; readonly sessionId: string }
  | { readonly type: "run_started"; readonly runId: string }
  | { readonly type: "run_finished" }
  | { readonly type: "show_approval"; readonly request: UiApprovalRequest }
  | { readonly type: "clear_approval" }
  | { readonly type: "cycle_effort"; readonly levels?: readonly string[] }
  | { readonly type: "set_footer"; readonly footer: Partial<UiFooterStatus> }
  | { readonly type: "reset_session"; readonly sessionId: string; readonly entries?: readonly UiStreamEntry[] };

export const DEFAULT_MAX_ENTRIES = 500;
export const DEFAULT_EFFORT_LEVELS = ["none", "low", "medium", "high", "max"] as const;

export function createInitialTuiState(initial?: {
  repo?: string;
  branch?: string;
  provider?: string;
  model?: string;
  effort?: string;
  approval?: PrismCodeApprovalMode;
  connectedMcpCount?: number;
  omEnabled?: boolean;
  omModel?: string;
  modelNotice?: string;
  maxEntries?: number;
  sessionId?: string;
}): TuiState {
  const effort = initial?.effort ?? "none";
  const effortIndex = Math.max(0, DEFAULT_EFFORT_LEVELS.indexOf(effort as (typeof DEFAULT_EFFORT_LEVELS)[number]));

  return {
    entries: [],
    changedEntryIds: [],
    maxEntries: initial?.maxEntries ?? DEFAULT_MAX_ENTRIES,
    isRunning: false,
    sessionId: initial?.sessionId,
    effortIndex: effortIndex === -1 ? 0 : effortIndex,
    footer: {
      repo: initial?.repo,
      branch: initial?.branch,
      provider: initial?.provider ?? "mock",
      model: initial?.model ?? "default",
      effort,
      approval: initial?.approval ?? "ask",
      connectedMcpCount: initial?.connectedMcpCount ?? 0,
      omEnabled: initial?.omEnabled ?? false,
      omModel: initial?.omModel,
      modelNotice: initial?.modelNotice,
    },
  };
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 1)}…`;
}

/** Changed-id list for the entry a branch just appended (exactly one entry). */
function appendedEntryIds(entries: readonly UiStreamEntry[]): string[] {
  const last = entries[entries.length - 1];
  return last ? [last.id] : [];
}

function formatArgsSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    const serialized = JSON.stringify(args);
    return truncate(serialized, 64);
  } catch {
    return "[args]";
  }
}

function formatResultSummary(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return truncate(result, 120);
  try {
    return truncate(JSON.stringify(result), 120);
  } catch {
    return "[result]";
  }
}

function capEntries(entries: readonly UiStreamEntry[], max: number): readonly UiStreamEntry[] {
  if (entries.length <= max) return entries;
  return entries.slice(entries.length - max);
}

/** Pure cumulative addition of provider usage; absent fields stay absent, estimate provenance sticks. */
function addUsage(previous: Usage | undefined, next: Usage): Usage {
  const sum = (a?: number, b?: number): number | undefined => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  const inputTokens = sum(previous?.inputTokens, next.inputTokens);
  const outputTokens = sum(previous?.outputTokens, next.outputTokens);
  const cacheReadTokens = sum(previous?.cacheReadTokens, next.cacheReadTokens);
  const cacheWriteTokens = sum(previous?.cacheWriteTokens, next.cacheWriteTokens);
  const totalTokens = sum(previous?.totalTokens, next.totalTokens);
  const cost = sum(previous?.cost, next.cost);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cost === undefined ? {} : { cost }),
    ...(cost === undefined ? {} : { currency: next.currency ?? previous?.currency }),
    ...(previous?.estimated === true || next.estimated === true ? { estimated: true } : {}),
  };
}

/** Per-card result text ceiling; larger results keep head+tail and report the omitted line count. */
export const MAX_TOOL_OUTPUT_BYTES = 16 * 1024;
/** Patches over this ceiling are omitted rather than stored truncated (a truncated patch cannot be parsed). */
export const MAX_TOOL_PATCH_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textLines(text: string): string[] {
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function boundedPatch(text: string): string | undefined {
  const sanitized = sanitizeTerminalText(text);
  return Buffer.byteLength(sanitized, "utf8") <= MAX_TOOL_PATCH_BYTES ? sanitized : undefined;
}

function joinPatch(path: string, hunks: readonly string[]): string | undefined {
  return boundedPatch(`--- ${path}\n+++ ${path}\n${hunks.join("\n")}`);
}

function additionsPatch(path: string, content: string): string | undefined {
  const lines = textLines(content);
  if (lines.length === 0) return undefined;
  return joinPatch(path, [`@@ -1,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)]);
}

function replacementPatch(path: string, edits: readonly { readonly oldText: string; readonly newText: string }[]): string | undefined {
  const hunks: string[] = [];
  let oldStart = 1;
  let newStart = 1;
  for (const edit of edits) {
    const oldLines = textLines(edit.oldText);
    const newLines = textLines(edit.newText);
    hunks.push(`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`);
    hunks.push(...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`));
    oldStart += oldLines.length;
    newStart += newLines.length;
  }
  return hunks.length === 0 ? undefined : joinPatch(path, hunks);
}

function editPairs(args: Record<string, unknown>): readonly { readonly oldText: string; readonly newText: string }[] {
  let edits: unknown = args.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      return [];
    }
  }
  const pairs: { oldText: string; newText: string }[] = [];
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (isRecord(edit) && typeof edit.oldText === "string" && typeof edit.newText === "string") {
        pairs.push({ oldText: edit.oldText, newText: edit.newText });
      }
    }
  }
  // Legacy single replacement: top-level oldText/newText.
  if (pairs.length === 0 && typeof args.oldText === "string" && typeof args.newText === "string") {
    pairs.push({ oldText: args.oldText, newText: args.newText });
  }
  return pairs;
}

/**
 * The approval prompt fires before a mutating tool reads the target file, so the only honest
 * pre-execution diff is the one the caller asked for: build it from the call arguments.
 * The finished `edit` result replaces this proposal with the exact patch it applied.
 */
function proposalPatch(name: string, args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  if (name === "git_apply") {
    return typeof args.patch === "string" ? boundedPatch(args.patch) : undefined;
  }
  const path = typeof args.path === "string" && args.path.length > 0 ? args.path : undefined;
  if (path === undefined) return undefined;
  if (name === "write") return typeof args.content === "string" ? additionsPatch(path, args.content) : undefined;
  if (name === "edit") return replacementPatch(path, editPairs(args));
  return undefined;
}

/** Sanitizes untrusted result text and bounds it to head+tail so one card cannot grow without limit. */
export function boundToolOutput(output: string): string {
  const sanitized = sanitizeTerminalText(output);
  if (Buffer.byteLength(sanitized, "utf8") <= MAX_TOOL_OUTPUT_BYTES) return sanitized;
  const lines = sanitized.split("\n");
  const head = lines.slice(0, 100);
  const tail = lines.slice(-50);
  return `${head.join("\n")}\n… [${lines.length - head.length - tail.length} lines omitted] …\n${tail.join("\n")}`;
}

function resultOutput(result: ToolResult): string | undefined {
  const text = (result.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((part) => part.length > 0)
    .join("\n");
  if (text.length > 0) return text;
  if (typeof result.value === "string") return result.value;
  if (result.value === undefined) return undefined;
  try {
    return JSON.stringify(result.value, null, 2);
  } catch {
    return undefined;
  }
}

function withEntry(state: TuiState, entry: UiStreamEntry): TuiState {
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index < 0) return state;
  const entries = state.entries.slice();
  entries[index] = { ...entry, version: (entry.version ?? 0) + 1 };
  return { ...state, entries, changedEntryIds: [entry.id] };
}

/**
 * A denied tool call is reported as an error result by dispatch/approval. The error carries no
 * stable denial code (codes are adapter-defined), so match the bounded display text.
 * ponytail: string heuristic; add an ErrorInfo.code contract if hosts need exact classification.
 */
function isDeniedToolError(error: { readonly message?: string; readonly code?: string | number } | undefined): boolean {
  if (!error) return false;
  if (typeof error.code === "string" && (error.code === "tool_denied" || error.code === "permission_denied")) return true;
  return /denied/i.test(error.message ?? "");
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "user_prompt": {
      const id = action.id ?? `user_${Date.now()}`;
      const newEntries = [
        ...state.entries,
        {
          id,
          version: 1,
          type: "message" as const,
          role: "user" as const,
          text: action.text,
          finished: true,
        },
      ];
      return {
        ...state,
        isRunning: true,
        entries: capEntries(newEntries, state.maxEntries),
        changedEntryIds: [id],
      };
    }

    case "set_session_id": {
      return {
        ...state,
        sessionId: action.sessionId,
      };
    }

    case "reset_session": {
      return {
        ...state,
        sessionId: action.sessionId,
        entries: action.entries ? capEntries(action.entries, state.maxEntries) : [],
        changedEntryIds: [],
        isRunning: false,
        activeRunId: undefined,
        approval: undefined,
        todos: undefined,
        usageRunId: undefined,
        footer: {
          ...state.footer,
          usage: undefined,
          usageTotals: undefined,
          contextTokens: undefined,
          contextSource: undefined,
        },
      };
    }

    case "run_started": {
      return {
        ...state,
        isRunning: true,
        activeRunId: action.runId,
        usageRunId: undefined,
      };
    }

    case "run_finished": {
      return {
        ...state,
        isRunning: false,
        activeRunId: undefined,
      };
    }

    case "show_approval": {
      return {
        ...state,
        approval: action.request,
      };
    }

    case "clear_approval": {
      return {
        ...state,
        approval: undefined,
      };
    }

    case "cycle_effort": {
      const levels = action.levels ?? DEFAULT_EFFORT_LEVELS;
      if (levels.length === 0) return state;
      const nextIndex = (state.effortIndex + 1) % levels.length;
      const nextEffort = levels[nextIndex] ?? "none";
      return {
        ...state,
        effortIndex: nextIndex,
        footer: {
          ...state.footer,
          effort: nextEffort,
        },
      };
    }

    case "set_footer": {
      return {
        ...state,
        footer: {
          ...state.footer,
          ...action.footer,
        },
      };
    }

    case "session_event": {
      const event = action.event;
      switch (event.type) {
        case "agent_started": {
          return {
            ...state,
            isRunning: true,
            activeRunId: event.runId,
            sessionId: event.sessionId,
          };
        }

        case "message_started": {
          if (event.message.role === "assistant") {
            const id = `msg_${event.runId}_${state.entries.length}`;
            const newEntries = [
              ...state.entries,
              {
                id,
                version: 1,
                type: "message" as const,
                role: "assistant" as const,
                text: "",
                finished: false,
              },
            ];
            return {
              ...state,
              entries: capEntries(newEntries, state.maxEntries),
              changedEntryIds: [id],
            };
          }
          return state;
        }

        case "message_delta": {
          if (event.content.type === "thinking") {
            const deltaText = event.content.text;
            const lastIndex = state.entries.length - 1;
            const lastEntry = state.entries[lastIndex];
            if (lastEntry && lastEntry.type === "thinking" && !lastEntry.finished) {
              return {
                ...state,
                entries: [
                  ...state.entries.slice(0, lastIndex),
                  { ...lastEntry, text: lastEntry.text + deltaText, version: (lastEntry.version ?? 0) + 1 },
                ],
                changedEntryIds: [lastEntry.id],
              };
            }
            const newEntries = [
              ...state.entries,
              {
                id: `think_${event.runId}_${state.entries.length}`,
                version: 1,
                type: "thinking" as const,
                text: deltaText,
                finished: false,
              },
            ];
            return {
              ...state,
              entries: capEntries(newEntries, state.maxEntries),
              changedEntryIds: appendedEntryIds(newEntries),
            };
          }
          if (event.content.type !== "text") return state;
          const deltaText = event.content.text;
          const lastIndex = state.entries.length - 1;
          const lastEntry = state.entries[lastIndex];

          // Coalesce into existing active assistant message
          if (lastEntry && lastEntry.type === "message" && lastEntry.role === "assistant" && !lastEntry.finished) {
            const updated = [
              ...state.entries.slice(0, lastIndex),
              {
                ...lastEntry,
                text: lastEntry.text + deltaText,
                version: (lastEntry.version ?? 0) + 1,
              },
            ];
            return { ...state, entries: updated, changedEntryIds: [lastEntry.id] };
          }

          // If no active assistant message, create one
          const newEntries = [
            ...state.entries,
            {
              id: `msg_${event.runId}_${state.entries.length}`,
              version: 1,
              type: "message" as const,
              role: "assistant" as const,
              text: deltaText,
              finished: false,
            },
          ];
          return {
            ...state,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
          };
        }

        case "message_finished": {
          let updated = state.entries;
          const changed: string[] = [];
          const lastIndex = updated.length - 1;
          const lastEntry = updated[lastIndex];
          if (lastEntry && lastEntry.type === "message" && lastEntry.role === "assistant") {
            updated = [...updated.slice(0, lastIndex), { ...lastEntry, finished: true, version: (lastEntry.version ?? 0) + 1 }];
            changed.push(lastEntry.id);
          }
          for (let i = updated.length - 1; i >= 0; i--) {
            const entry = updated[i];
            if (entry && entry.type === "thinking") {
              if (!entry.finished) {
                updated = [
                  ...updated.slice(0, i),
                  { ...entry, finished: true, version: (entry.version ?? 0) + 1 },
                  ...updated.slice(i + 1),
                ];
                changed.push(entry.id);
              }
              break;
            }
          }
          return updated === state.entries ? state : { ...state, entries: updated, changedEntryIds: changed };
        }

        case "tool_execution_started": {
          const toolCallId = event.call.id;
          const patch = proposalPatch(event.call.name, event.call.arguments);
          const newEntries = [
            ...state.entries,
            {
              id: `tool_${toolCallId}`,
              version: 1,
              type: "tool_call" as const,
              toolCallId,
              name: event.call.name,
              argsSummary: formatArgsSummary(event.call.arguments),
              status: "running" as const,
              ...(patch ? { patch } : {}),
            },
          ];
          return {
            ...state,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: [`tool_${toolCallId}`],
          };
        }

        case "tool_execution_finished": {
          const toolCallId = event.result.toolCallId;
          const toolError = event.result.error;
          const status: UiToolCallStatus = toolError ? (isDeniedToolError(toolError) ? "denied" : "failure") : "success";
          const resultSummary = status === "success" ? formatResultSummary(event.result.value ?? event.result.content) : undefined;
          const rawOutput = resultOutput(event.result);
          const output = rawOutput === undefined ? undefined : boundToolOutput(rawOutput);
          const reportedPatch =
            status === "success" && typeof event.result.metadata?.patch === "string"
              ? boundedPatch(event.result.metadata.patch)
              : undefined;
          const entry = state.entries.find((item): item is UiToolCallEntry => item.type === "tool_call" && item.toolCallId === toolCallId);
          const updated = entry
            ? withEntry(state, {
                ...entry,
                status,
                durationMs: event.metadata.durationMs,
                ...(resultSummary ? { resultSummary } : {}),
                ...(output !== undefined ? { output } : {}),
                ...(reportedPatch !== undefined ? { patch: reportedPatch } : {}),
                ...(toolError ? { error: toolError.message } : {}),
              })
            : state;
          const todos = !toolError && event.result.name === TODO_WRITE_TOOL_NAME ? parseTodoListMetadata(event.result.metadata) : undefined;
          return todos === undefined ? updated : { ...updated, todos };
        }

        case "tool_execution_error": {
          const toolCallId = event.call.id;
          const denied = isDeniedToolError(event.error);
          const entry = state.entries.find((item): item is UiToolCallEntry => item.type === "tool_call" && item.toolCallId === toolCallId);
          return entry
            ? withEntry(state, {
                ...entry,
                status: denied ? "denied" : "failure",
                error: event.error.message,
                durationMs: event.metadata.durationMs,
              })
            : state;
        }

        case "tool_execution_blocked": {
          const toolCallId = event.toolCallId;
          const entry = state.entries.find((item): item is UiToolCallEntry => item.type === "tool_call" && item.toolCallId === toolCallId);
          return entry
            ? withEntry(state, { ...entry, status: "denied", error: event.reason, durationMs: event.metadata.durationMs })
            : state;
        }

        case "compaction_finished": {
          const count = event.entriesCompacted ?? 0;
          const summary = event.summary?.trim();
          const text = summary ? `[Compacted history]\n${summary}` : count > 0 ? `Compacted ${count} entries` : "Compacted context";
          const newEntries = [
            ...state.entries,
            {
              id: `compact_${event.sessionId}_${state.entries.length}`,
              version: 1,
              type: "message" as const,
              role: "system" as const,
              text,
              finished: true,
            },
          ];
          return {
            ...state,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
            footer: {
              ...state.footer,
              // A pre-compaction reported reading overstates the rebuilt context until the next
              // provider turn (or a host refresh after a manual compaction) reports the new one.
              contextTokens: undefined,
              contextSource: undefined,
            },
          };
        }

        case "compaction_failed": {
          const newEntries = [
            ...state.entries,
            {
              id: `compact_err_${event.sessionId}_${state.entries.length}`,
              version: 1,
              type: "message" as const,
              role: "system" as const,
              text: `Warning: Compaction failed (${event.error.message}), continuing uncompacted`,
              finished: true,
            },
          ];
          return {
            ...state,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
          };
        }

        case "provider_turn_finished": {
          const usage = event.usage;
          if (!usage) return state;
          return {
            ...state,
            usageRunId: event.runId,
            footer: {
              ...state.footer,
              usageTotals: addUsage(state.footer.usageTotals, usage),
              ...(usage.inputTokens === undefined
                ? {}
                : {
                    contextTokens: usage.inputTokens,
                    contextSource: usage.estimated === true ? ("estimated" as const) : ("reported" as const),
                  }),
            },
          };
        }

        case "agent_finished": {
          const usage = event.usage;
          // Per-turn usage already landed in the totals; a run that emitted none (deterministic or
          // resumed turns) contributes its run total once instead of double counting.
          const uncounted = usage && state.usageRunId !== event.runId ? usage : undefined;
          return {
            ...state,
            isRunning: false,
            activeRunId: undefined,
            usageRunId: undefined,
            footer: {
              ...state.footer,
              usage: usage ?? state.footer.usage,
              ...(uncounted ? { usageTotals: addUsage(state.footer.usageTotals, uncounted) } : {}),
            },
          };
        }

        case "run_limit_exceeded": {
          const newEntries = [
            ...state.entries,
            {
              id: `err_limit_${Date.now()}`,
              version: 1,
              type: "error" as const,
              message: `Limit exceeded: ${event.breach.limit} (${event.breach.observed} > ${event.breach.maximum})`,
            },
          ];
          return {
            ...state,
            isRunning: false,
            activeRunId: undefined,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
          };
        }

        case "budget_exhausted": {
          const newEntries = [
            ...state.entries,
            {
              id: `err_budget_${Date.now()}`,
              version: 1,
              type: "error" as const,
              message: `Budget exhausted: ${event.limit}`,
            },
          ];
          return {
            ...state,
            isRunning: false,
            activeRunId: undefined,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
          };
        }

        case "agent_denied": {
          const newEntries = [
            ...state.entries,
            {
              id: `err_denied_${Date.now()}`,
              version: 1,
              type: "error" as const,
              message: `Run denied: ${event.interruption.reason}`,
            },
          ];
          return {
            ...state,
            isRunning: false,
            activeRunId: undefined,
            entries: capEntries(newEntries, state.maxEntries),
            changedEntryIds: appendedEntryIds(newEntries),
          };
        }

        default:
          return state;
      }
    }

    default:
      return state;
  }
}
