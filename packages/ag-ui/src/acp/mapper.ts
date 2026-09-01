import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";
import type { AgentEvent, ToolCallContent as PrismToolCall, SecretRedactor, ToolResult, Usage } from "@arnilo/prism";
import type { CodingLifecycleEvent, FileChangedEvent } from "@arnilo/prism-coding-tools/agent";
import { type AgUiLimitOptions, resolveAgUiLimits } from "../limits.js";
import { type AgUiProjection, projectCoWorkEvent } from "../projection.js";
import type { CoWorkEvent } from "../types.js";
import type { AcpUsageSeam } from "./capabilities.js";

/**
 * Maps shipped `CodingLifecycleEvent` values to stable ACP v1 session updates
 * (freeze `lifecycleEventMapping`). Deny-by-default: process/worktree events
 * surface only through the shared projection allow-list; `file_changed` needs
 * the event's toolCallId; diffs need the `fileDiff` allow-list hook and are
 * byte-capped at `acpDiffBytes`. `configuration_changed` returns [] — the
 * agent wires it to `config_option_update` (it owns the host configOptions
 * seam and the per-session current values). Never raw file bodies, args, or
 * secrets; all text passes the shared redactor.
 */
export function createAcpLifecycleMapper(options: AcpEventMapperOptions = {}): AcpLifecycleMapper {
  const limits = resolveAgUiLimits(options.limits);
  const text = (value: string, maxBytes = limits.maxTextBytes) =>
    truncate(options.redactor?.redact(value) ?? value, Math.min(maxBytes, limits.maxEventBytes));
  const projectedText = async (event: CodingLifecycleEvent): Promise<string | undefined> => {
    try {
      const value = await options.projection?.lifecycle?.(event);
      return typeof value === "string" ? text(value) : undefined;
    } catch {
      return undefined;
    }
  };
  const projectedDiff = async (event: FileChangedEvent): Promise<ToolCallContent | undefined> => {
    try {
      const value = await options.projection?.fileDiff?.(event);
      if (!value || typeof value !== "object") return undefined;
      const path = value.path;
      const newText = value.newText;
      if (typeof path !== "string" || path.length === 0 || typeof newText !== "string") return undefined;
      const oldText = value.oldText;
      const diff: ToolCallContent = {
        type: "diff",
        path: text(path),
        ...(typeof oldText === "string" && oldText.length > 0 ? { oldText: text(oldText) } : {}),
        newText: text(newText),
      };
      return Buffer.byteLength(JSON.stringify(diff), "utf8") <= limits.acpDiffBytes ? diff : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    async map(event) {
      switch (event.type) {
        case "file_changed": {
          if (!event.toolCallId) return [];
          const diff = await projectedDiff(event);
          return [
            {
              sessionUpdate: "tool_call_update",
              toolCallId: text(event.toolCallId),
              ...(diff ? { content: [diff] } : {}),
              locations: [{ path: text(event.path) }],
            },
          ];
        }
        case "worktree_changed":
        case "process_started":
        case "process_exited":
        case "process_killed": {
          const value = await projectedText(event);
          if (value === undefined) return [];
          const messageId =
            event.type === "worktree_changed" ? `prism:worktree:${event.path}` : `prism:process:${event.sessionId}:${event.processId}`;
          return [{ sessionUpdate: "agent_message_chunk", messageId: text(messageId), content: { type: "text", text: value } }];
        }
        case "permission_denied": {
          const toolCallId = event.toolCallId ?? (event.approvalId ? `prism:denied:${event.approvalId}` : undefined);
          if (!toolCallId) return [];
          return [{ sessionUpdate: "tool_call_update", toolCallId: text(toolCallId), title: text(event.toolName), status: "failed" }];
        }
        case "configuration_changed":
          // Agent-wired: needs the host configOptions seam + per-session values (config_option_update).
          return [];
        case "plan_changed": {
          // F5: complete entry list per update; the client replaces its plan wholesale.
          const entries: Array<{
            content: string;
            priority: "high" | "medium" | "low";
            status: "pending" | "in_progress" | "completed";
          }> = event.todos.map((todo) => ({
            content: text(todo.text),
            priority: "medium",
            status: todo.done ? "completed" : "pending",
          }));
          return [
            {
              sessionUpdate: "plan_update",
              plan: { type: "items", planId: text(event.planPath), entries },
            },
          ];
        }
        case "plan_removed":
          return [{ sessionUpdate: "plan_removed", planId: text(event.planPath) }];
        default:
          // process_released/expired/unknown are not shipped lifecycle mappings (freeze deferred).
          return [];
      }
    },
  };
}

export interface AcpLifecycleMapper {
  /** Maps one coding lifecycle event to safe ACP session updates; empty when the event carries no consumer-safe update. */
  map(event: CodingLifecycleEvent): Promise<readonly SessionUpdate[]>;
}

/** Options shared by the event and lifecycle mappers (redactor, projection allow-list, limits). */
export interface AcpEventMapperOptions {
  readonly redactor?: SecretRedactor;
  /** Shared host allow-list; tool text is omitted unless explicitly projected. */
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
  /** Host-reported context window (B1); absent => `usage_update` is omitted, never `size = used`. */
  readonly usage?: AcpUsageSeam;
  /** Run signal forwarded to the usage seam. */
  readonly signal?: AbortSignal;
  /** Explicit tool kinds (B4); consulted before the name heuristic. */
  readonly toolKinds?: ReadonlyMap<string, ToolKind>;
}

export interface AcpEventMapper {
  map(event: AgentEvent): Promise<readonly SessionUpdate[]>;
  /** Projects one co-work event to a safe ACP session update; malformed input yields none. */
  mapCoWork(event: CoWorkEvent): Promise<readonly SessionUpdate[]>;
}

/** Maps redacted Prism lifecycle events to stable ACP v1 session updates. */
export function createAcpEventMapper(options: AcpEventMapperOptions = {}): AcpEventMapper {
  const limits = resolveAgUiLimits(options.limits);
  let messageId: string | undefined;
  let textDeltaSeen = false;
  let thoughtDeltaSeen = false;

  const text = (value: string, maxBytes = limits.maxTextBytes) =>
    truncate(options.redactor?.redact(value) ?? value, Math.min(maxBytes, limits.maxEventBytes));
  const tool = async (call: PrismToolCall) => {
    const input = await projected(() => options.projection?.toolArguments?.(call));
    return {
      toolCallId: text(call.id),
      title: text(call.name),
      kind: kind(call.name, options.toolKinds),
      status: "in_progress" as const,
      ...(input ? { content: [content(input)] } : {}),
    };
  };
  const finish = async (id: string, name: string, status: "completed" | "failed", result?: ToolResult): Promise<SessionUpdate> => {
    const output = result ? await projectedResult(result) : undefined;
    const locations = result ? await projectedLocations(result) : undefined;
    const diff = result ? await projectedDiff(result) : undefined;
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: text(id),
      title: text(name),
      status,
      ...(output || diff ? { content: [...(output ? [output] : []), ...(diff ? [diff] : [])] } : {}),
      ...(locations ? { locations } : {}),
    };
  };
  const projected = async (callback: () => string | undefined | Promise<string | undefined>): Promise<string | undefined> => {
    try {
      const value = await callback();
      return typeof value === "string" ? text(value) : undefined;
    } catch {
      return undefined;
    }
  };
  /** B1: host-reported context window; absent/undefined/throw/invalid => omit the update (never `size = used`). */
  const contextWindow = async (model?: string): Promise<number | undefined> => {
    try {
      const size = await options.usage?.contextWindow?.({ model, signal: options.signal ?? new AbortController().signal });
      return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : undefined;
    } catch {
      return undefined;
    }
  };
  const usage = async (value: Usage, model: string | undefined): Promise<readonly SessionUpdate[]> => {
    const used = value.totalTokens ?? (value.inputTokens ?? 0) + (value.outputTokens ?? 0);
    const size = await contextWindow(model);
    return size === undefined ? [] : [{ sessionUpdate: "usage_update", used: Math.max(0, used), size: Math.max(1, size) }];
  };
  /** Host allow-list for tool results: string → text content; `{ type: "image" }` → image content (F8). */
  const projectedResult = async (result: ToolResult): Promise<ToolCallContent | undefined> => {
    try {
      const value = await options.projection?.toolResult?.(result);
      if (typeof value === "string") return content(text(value));
      if (!value || typeof value !== "object" || value.type !== "image") return undefined;
      const { data, mimeType } = value;
      if (typeof data !== "string" || data.length === 0 || typeof mimeType !== "string" || mimeType.length === 0) return undefined;
      // Drop, don't truncate: a sliced base64 payload is corrupt. Redactor stays off binary data.
      if (Buffer.byteLength(data, "utf8") > limits.acpImageBytes) return undefined;
      return { type: "content", content: { type: "image", data, mimeType } };
    } catch {
      return undefined;
    }
  };
  /** Host allow-list for file locations: count-capped at acpLocationsPerUpdate, entries validated. */
  const projectedLocations = async (result: ToolResult): Promise<ToolCallLocation[] | undefined> => {
    try {
      const value = await options.projection?.toolLocations?.(result);
      if (!value) return undefined;
      const capped = value.slice(0, limits.acpLocationsPerUpdate);
      const entries: ToolCallLocation[] = [];
      for (const entry of capped) {
        if (typeof entry !== "object" || entry === null) continue;
        const path = entry.path;
        if (typeof path !== "string" || path.length === 0) continue;
        const line = entry.line;
        if (line !== undefined && line !== null && (!Number.isInteger(line) || line < 0)) continue;
        entries.push({ path: text(path), ...(line === undefined || line === null ? {} : { line }) });
      }
      return entries.length > 0 ? entries : undefined;
    } catch {
      return undefined;
    }
  };
  /** Host allow-list for file diffs: single diff, redacted, byte-capped at acpDiffBytes. */
  const projectedDiff = async (result: ToolResult): Promise<ToolCallContent | undefined> => {
    try {
      const value = await options.projection?.toolDiff?.(result);
      if (!value || typeof value !== "object") return undefined;
      const path = value.path;
      const newText = value.newText;
      if (typeof path !== "string" || path.length === 0 || typeof newText !== "string") return undefined;
      const oldText = value.oldText;
      const diff: ToolCallContent = {
        type: "diff",
        path: text(path),
        ...(typeof oldText === "string" && oldText.length > 0 ? { oldText: text(oldText) } : {}),
        newText: text(newText),
      };
      return Buffer.byteLength(JSON.stringify(diff), "utf8") <= limits.acpDiffBytes ? diff : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async mapCoWork(input) {
      const payload = await projectCoWorkEvent(input, {
        redactor: options.redactor,
        projection: options.projection,
        maxBytes: limits.maxTextBytes,
      });
      if (payload === undefined) return [];
      return [message(`prism:cowork:${input.kind}`, truncate(JSON.stringify(payload), limits.maxTextBytes))];
    },
    async map(input) {
      const event = options.redactor?.redact(input) ?? input;
      switch (event.type) {
        case "message_started":
          if (event.message.role !== "assistant") return [];
          messageId = text(event.message.id ?? `${event.runId}:message`);
          textDeltaSeen = false;
          thoughtDeltaSeen = false;
          return [];
        case "message_delta":
          // F1: thinking deltas ride agent_thought_chunk (same messageId scheme as
          // text); image/audio deltas stay dropped.
          if (event.content.type === "thinking") {
            messageId ??= `${text(event.runId)}:message`;
            thoughtDeltaSeen = true;
            return [thought(messageId ?? `${text(event.runId)}:message`, text(event.content.text))];
          }
          if (event.content.type !== "text") return [];
          messageId ??= `${text(event.runId)}:message`;
          textDeltaSeen = true;
          return [message(messageId ?? `${text(event.runId)}:message`, text(event.content.text))];
        case "message_finished": {
          if (event.message.role !== "assistant") return [];
          const id = messageId ?? text(event.message.id ?? `${event.runId}:message`);
          // F1: emit finished blocks only for the kinds that had no live delta,
          // so a mixed text+thinking message never loses either channel.
          const updates = event.message.content.flatMap((block) => {
            if (block.type === "text" && !textDeltaSeen) return [message(id, text(block.text))];
            if (block.type === "thinking" && !thoughtDeltaSeen) return [thought(id, text(block.text))];
            return [];
          });
          messageId = undefined;
          textDeltaSeen = false;
          thoughtDeltaSeen = false;
          return updates;
        }
        case "tool_execution_started":
          return [{ sessionUpdate: "tool_call", ...(await tool(event.call)) }];
        case "tool_execution_progress":
          return [
            { sessionUpdate: "tool_call_update", toolCallId: text(event.toolCallId), title: text(event.name), status: "in_progress" },
          ];
        case "tool_execution_finished":
          return [await finish(event.result.toolCallId, event.result.name, "completed", event.result)];
        case "tool_execution_error":
          return [await finish(event.call.id, event.call.name, "failed")];
        case "tool_execution_blocked":
          return [await finish(event.toolCallId, event.name, "failed")];
        case "provider_turn_finished":
          // B2: a failed provider turn is a request-level condition, not transcript content;
          // the agent's forward() throws ERR_PRISM_ACP_RUN when the run ends in a terminal
          // `error` event (retryable turn failures stay silent here and may recover).
          return event.usage ? await usage(event.usage, event.metadata.model.model) : [];
        case "agent_denied":
          return [message(`${text(event.runId)}:status`, "Run denied")];
        case "error":
          // B2: run-level errors fail the prompt request (forward() throws); never a fake chunk.
          return [];
        default:
          return [];
      }
    },
  };
}

function message(messageId: string, text: string): SessionUpdate {
  return { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } };
}

// F1: thinking content rides the SDK's agent_thought_chunk variant (a ContentChunk
// with the thought text, same messageId scheme as text chunks).
function thought(messageId: string, text: string): SessionUpdate {
  return { sessionUpdate: "agent_thought_chunk", messageId, content: { type: "text", text } };
}

function content(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } };
}

function kind(name: string, toolKinds?: ReadonlyMap<string, ToolKind>): ToolKind {
  const explicit = toolKinds?.get(name);
  if (explicit) return explicit;
  if (name.includes("read")) return "read";
  if (name.includes("edit") || name.includes("write")) return "edit";
  if (name.includes("delete")) return "delete";
  if (name.includes("search") || name.includes("list")) return "search";
  if (name.includes("shell") || name.includes("exec") || name.includes("bash")) return "execute";
  if (name.includes("fetch")) return "fetch";
  return "other";
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
