import {
  type AgentEvent,
  createDelegatedAgentStep,
  type DelegatedAgentStepKind,
  type DelegatedAgentStepState,
  type DelegatedAgentStepUsage,
  type Message,
  type SecretRedactor,
} from "@arnilo/prism";
import { safeUsage } from "./ndjson.js";
import type { AntigravityStreamRecord, InitRecord, ResultRecord, StepUpdateRecord } from "./types.js";

export const DEFAULT_ADAPTER_ID = "antigravity";

export interface AntigravityEventProjectorOptions {
  readonly sessionId: string;
  readonly runId: string;
  readonly adapterId?: string;
  readonly redactor?: SecretRedactor;
}

function sanitizeOpaque(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[\0\r\n\\/:]/g, "-").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 512) : undefined;
}

function sanitizeToolName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[\0\r\n]/g, "").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 256) : undefined;
}

function sanitizeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[\0\r\n]/g, " ").trim();
  return sanitized.length > 0 ? sanitized.slice(0, 256) : undefined;
}

function normalizeState(state: string | undefined): DelegatedAgentStepState {
  if (!state) return "active";
  const upper = state.toUpperCase();
  if (upper === "DONE" || upper === "SUCCESS" || upper === "COMPLETED") return "done";
  if (upper === "ERROR" || upper === "FAILED" || upper === "CANCELLED") return "error";
  return "active";
}

function normalizeStepKind(stepType: string | undefined, hasTool: boolean, hasSubagent: boolean): DelegatedAgentStepKind {
  if (hasTool || stepType === "tool") return "tool";
  if (hasSubagent || stepType === "subagent") return "subagent";
  if (stepType === "checkpoint") return "checkpoint";
  if (stepType === "assistant") return "assistant";
  return "unknown";
}

export function mapAntigravityUsage(rawUsage: unknown): DelegatedAgentStepUsage | undefined {
  const usage = safeUsage(rawUsage);
  if (!usage) return undefined;

  const result: Record<string, number> = {};
  if (usage.inputTokens !== undefined) result.inputTokens = usage.inputTokens;
  if (usage.outputTokens !== undefined) result.outputTokens = usage.outputTokens;
  if (usage.thinkingTokens !== undefined) result.thinkingTokens = usage.thinkingTokens;
  if (usage.cacheReadTokens !== undefined) result.cacheReadTokens = usage.cacheReadTokens;
  if (usage.cacheWriteTokens !== undefined) result.cacheWriteTokens = usage.cacheWriteTokens;
  if (usage.totalTokens !== undefined) result.totalTokens = usage.totalTokens;

  return Object.keys(result).length > 0 ? (result as unknown as DelegatedAgentStepUsage) : undefined;
}

export class AntigravityEventProjector {
  readonly sessionId: string;
  readonly runId: string;
  readonly adapterId: string;
  private readonly redactor?: SecretRedactor;

  private externalConversationId = "unknown";
  private lastStepIndex = 0;
  private messageStarted = false;
  private accumulatedResponse = "";
  private messageId?: string;

  constructor(options: AntigravityEventProjectorOptions) {
    this.sessionId = options.sessionId;
    this.runId = options.runId;
    this.adapterId = options.adapterId ?? DEFAULT_ADAPTER_ID;
    this.redactor = options.redactor;
    this.messageId = `${options.runId}:msg-1`;
  }

  projectRecord(record: AntigravityStreamRecord): readonly AgentEvent[] {
    switch (record.type) {
      case "init":
        return this.handleInit(record);
      case "step_update":
        return this.handleStepUpdate(record);
      case "result":
        return this.handleResult(record);
      default:
        return [];
    }
  }

  private handleInit(record: InitRecord): readonly AgentEvent[] {
    if (typeof record.conversation_id === "string" && record.conversation_id.trim()) {
      this.externalConversationId = record.conversation_id.trim();
    }

    const step = createDelegatedAgentStep({
      sessionId: this.sessionId,
      runId: this.runId,
      adapterId: this.adapterId,
      externalConversationId: sanitizeOpaque(this.externalConversationId) ?? "init",
      stepIndex: 0,
      state: "active",
      kind: "assistant",
      detail: {
        label: "Antigravity initialized",
      },
    });

    return [step];
  }

  private handleStepUpdate(record: StepUpdateRecord): readonly AgentEvent[] {
    const events: AgentEvent[] = [];

    if (typeof record.conversation_id === "string" && record.conversation_id.trim()) {
      this.externalConversationId = record.conversation_id.trim();
    }

    const stepIndex = typeof record.step_index === "number" && record.step_index >= 0 ? record.step_index : this.lastStepIndex + 1;
    this.lastStepIndex = stepIndex;

    const hasTool = Boolean(record.tool_info?.name);
    const hasSubagent = Boolean(record.subagent_info?.type || record.subagent_info?.role);
    const kind = normalizeStepKind(record.step_type, hasTool, hasSubagent);
    const state = normalizeState(record.state);
    const usage = mapAntigravityUsage(record.usage);

    // Stream text delta if present
    if (record.text_delta) {
      const text = this.redactor ? this.redactor.redact(record.text_delta) : record.text_delta;
      this.accumulatedResponse += text;

      if (!this.messageStarted) {
        this.messageStarted = true;
        const msg: Message = {
          id: this.messageId!,
          role: "assistant",
          content: [],
        };
        events.push({
          type: "message_started",
          sessionId: this.sessionId,
          runId: this.runId,
          message: msg,
        });
      }

      events.push({
        type: "message_delta",
        sessionId: this.sessionId,
        runId: this.runId,
        content: {
          type: "text",
          text,
        },
      });
    }

    // Detail & tool labels
    let label: string | undefined;
    let referenceId: string | undefined;

    if (hasTool && record.tool_info?.name) {
      const toolName = record.tool_info.name;
      const isPrismTool = toolName.startsWith("prism:") || toolName.startsWith("prism_") || toolName.startsWith("prism/");
      label = isPrismTool ? `Prism tool: ${toolName}` : `Delegated tool: ${toolName}`;
      const rawToolCallId = (record.tool_info as { tool_call_id?: string }).tool_call_id;
      referenceId = sanitizeOpaque(rawToolCallId);
    } else if (hasSubagent && record.subagent_info) {
      label = record.subagent_info.role ?? record.subagent_info.type ?? "Subagent";
      referenceId = sanitizeOpaque(record.subagent_info.conversation_id);
    } else if (kind === "checkpoint") {
      label = "Checkpoint saved";
    }

    const step = createDelegatedAgentStep({
      sessionId: this.sessionId,
      runId: this.runId,
      adapterId: this.adapterId,
      externalConversationId: sanitizeOpaque(this.externalConversationId) ?? "unknown",
      stepIndex,
      state,
      kind,
      ...(typeof record.duration_ms === "number" && record.duration_ms >= 0 ? { durationMs: record.duration_ms } : {}),
      ...(record.tool_info?.name ? { toolName: sanitizeToolName(record.tool_info.name) } : {}),
      ...(record.subagent_info?.type ? { subagentType: sanitizeLabel(record.subagent_info.type) } : {}),
      ...(usage ? { usage } : {}),
      ...(label || referenceId
        ? {
            detail: {
              ...(label ? { label: sanitizeLabel(label) } : {}),
              ...(referenceId ? { referenceId } : {}),
            },
          }
        : {}),
    });

    events.push(step);
    return events;
  }

  private handleResult(record: ResultRecord): readonly AgentEvent[] {
    const events: AgentEvent[] = [];

    if (record.conversation_id) {
      this.externalConversationId = record.conversation_id;
    }

    const finalResponse = record.response
      ? this.redactor
        ? this.redactor.redact(record.response)
        : record.response
      : this.accumulatedResponse;

    if (this.messageStarted || finalResponse) {
      const finalMsg: Message = {
        id: this.messageId!,
        role: "assistant",
        content: [{ type: "text", text: finalResponse }],
      };
      events.push({
        type: "message_finished",
        sessionId: this.sessionId,
        runId: this.runId,
        message: finalMsg,
      });
    }

    const finalStepIndex = this.lastStepIndex + 1;
    const isSuccess = record.status === "SUCCESS";
    const state: DelegatedAgentStepState = isSuccess ? "done" : "error";
    const usage = mapAntigravityUsage(record.usage);

    let errorLabel = "Execution failed";
    if (record.error) {
      if (typeof record.error === "string") {
        errorLabel = record.error;
      } else if (typeof record.error === "object" && "message" in record.error) {
        errorLabel = String((record.error as { message?: unknown }).message ?? "Execution failed");
      }
    }

    const step = createDelegatedAgentStep({
      sessionId: this.sessionId,
      runId: this.runId,
      adapterId: this.adapterId,
      externalConversationId: sanitizeOpaque(this.externalConversationId) ?? "result",
      stepIndex: finalStepIndex,
      state,
      kind: "assistant",
      ...(typeof record.duration_ms === "number" && record.duration_ms >= 0 ? { durationMs: record.duration_ms } : {}),
      ...(usage ? { usage } : {}),
      detail: {
        label: isSuccess ? "Execution completed" : (sanitizeLabel(errorLabel) ?? "Failed"),
      },
    });

    events.push(step);
    return events;
  }

  flush(): readonly AgentEvent[] {
    return [];
  }
}

export function createAntigravityEventProjector(options: AntigravityEventProjectorOptions): AntigravityEventProjector {
  return new AntigravityEventProjector(options);
}
