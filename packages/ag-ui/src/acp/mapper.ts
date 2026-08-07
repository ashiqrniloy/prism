import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";
import type { AgentEvent, ErrorInfo, ToolCallContent as PrismToolCall, SecretRedactor, ToolResult, Usage } from "@arnilo/prism";
import type { CodingLifecycleEvent, FileChangedEvent } from "@arnilo/prism-coding-agent";
import { type AgUiLimitOptions, resolveAgUiLimits } from "../limits.js";
import { type AgUiProjection, projectCoWorkEvent } from "../projection.js";
import type { CoWorkEvent } from "../types.js";

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
  let messageHasDelta = false;

  const text = (value: string, maxBytes = limits.maxTextBytes) =>
    truncate(options.redactor?.redact(value) ?? value, Math.min(maxBytes, limits.maxEventBytes));
  const tool = async (call: PrismToolCall) => {
    const input = await projected(() => options.projection?.toolArguments?.(call));
    return {
      toolCallId: text(call.id),
      title: text(call.name),
      kind: kind(call.name),
      status: "in_progress" as const,
      ...(input ? { content: [content(input)] } : {}),
    };
  };
  const finish = async (id: string, name: string, status: "completed" | "failed", result?: ToolResult): Promise<SessionUpdate> => {
    const output = result ? await projected(() => options.projection?.toolResult?.(result)) : undefined;
    const locations = result ? await projectedLocations(result) : undefined;
    const diff = result ? await projectedDiff(result) : undefined;
    return {
      sessionUpdate: "tool_call_update",
      toolCallId: text(id),
      title: text(name),
      status,
      ...(output || diff ? { content: [...(output ? [content(output)] : []), ...(diff ? [diff] : [])] } : {}),
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
          messageHasDelta = false;
          return [];
        case "message_delta":
          if (event.content.type !== "text") return [];
          messageId ??= `${text(event.runId)}:message`;
          messageHasDelta = true;
          return [message(messageId ?? `${text(event.runId)}:message`, text(event.content.text))];
        case "message_finished": {
          if (event.message.role !== "assistant") return [];
          const id = messageId ?? text(event.message.id ?? `${event.runId}:message`);
          const updates = messageHasDelta
            ? []
            : event.message.content.flatMap((block) => (block.type === "text" ? [message(id, text(block.text))] : []));
          messageId = undefined;
          messageHasDelta = false;
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
          if (event.error) return [error(event.error, text)];
          return event.usage ? [usage(event.usage)] : [];
        case "agent_denied":
          return [message(`${text(event.runId)}:status`, "Run denied")];
        case "error":
          return [error(event.error, text)];
        default:
          return [];
      }
    },
  };
}

function message(messageId: string, text: string): SessionUpdate {
  return { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } };
}

function content(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } };
}

function error(value: ErrorInfo, text: (value: string, maxBytes?: number) => string): SessionUpdate {
  return message("prism:error", `Agent error: ${text(value.message, 8 * 1024)}`);
}

function usage(value: Usage): SessionUpdate {
  const used = value.totalTokens ?? (value.inputTokens ?? 0) + (value.outputTokens ?? 0);
  return { sessionUpdate: "usage_update", used: Math.max(0, used), size: Math.max(1, used) };
}

function kind(name: string): ToolKind {
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
