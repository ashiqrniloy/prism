/**
 * Opt-in `ask_user_decision` tool: model proposes choices with pros/cons;
 * host-injected `ask` blocks until the user picks one or more option ids.
 *
 * Durable path (opt-in): `suspendAskUserDecision` / `validateAskUserDecisionResume`
 * compose `@arnilo/prism-workflows` suspend/resume — no Goal DB, no second store.
 * Blocking `ask()` remains the default. Agent durable interruption kinds are
 * unchanged; hosts reuse the same resume validator against host-held request data.
 *
 * Not included in `createCodingTools` / `createAllTools` / `createReadOnlyTools`.
 */
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import {
  suspend,
  type WorkflowResumeValidationInput,
  type WorkflowResumeValidator,
  type WorkflowSuspension,
} from "@arnilo/prism-workflows";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { validateCodingLimit } from "./limits.js";

export const ASK_USER_DECISION_TOOL_NAME = "ask_user_decision" as const;
export const ASK_USER_DECISION_SUSPEND_REASON = "ask_user_decision" as const;

/** Exactly three rationale bullets per side. */
export const ASK_USER_DECISION_RATIONALE_COUNT = 3 as const;

export const DEFAULT_MAX_ASK_USER_DECISION_OPTIONS = 6;
export const HARD_MAX_ASK_USER_DECISION_OPTIONS = 16;
export const DEFAULT_MAX_ASK_USER_DECISION_QUESTION_BYTES = 2_048;
export const HARD_MAX_ASK_USER_DECISION_QUESTION_BYTES = 8_192;
export const DEFAULT_MAX_ASK_USER_DECISION_LABEL_BYTES = 512;
export const HARD_MAX_ASK_USER_DECISION_LABEL_BYTES = 2_048;
export const DEFAULT_MAX_ASK_USER_DECISION_BULLET_BYTES = 512;
export const HARD_MAX_ASK_USER_DECISION_BULLET_BYTES = 2_048;
/** Same ceiling as question text — free-text answers stay short. */
export const DEFAULT_MAX_ASK_USER_DECISION_CUSTOM_BYTES =
  DEFAULT_MAX_ASK_USER_DECISION_QUESTION_BYTES;
export const HARD_MAX_ASK_USER_DECISION_CUSTOM_BYTES =
  HARD_MAX_ASK_USER_DECISION_QUESTION_BYTES;

export type AskUserDecisionSelectionMode = "single" | "multiple";

export interface AskUserDecisionOption {
  readonly id: string;
  readonly label: string;
  readonly pros: readonly [string, string, string];
  readonly cons: readonly [string, string, string];
}

export interface AskUserDecisionRequest {
  readonly question: string;
  readonly options: readonly AskUserDecisionOption[];
  readonly selectionMode: AskUserDecisionSelectionMode;
  readonly allowCustom: boolean;
  readonly toolCallId: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

/**
 * Host answer shapes. Custom text is XOR with selection (v1): never both.
 * `allowCustom` must be true for `{ customText }`.
 */
export type AskUserDecisionAnswer =
  | { readonly selectedId: string; readonly selectedIds?: never; readonly customText?: never }
  | { readonly selectedIds: readonly string[]; readonly selectedId?: never; readonly customText?: never }
  | { readonly selectedId: string; readonly selectedIds: readonly string[]; readonly customText?: never }
  | { readonly customText: string; readonly selectedId?: never; readonly selectedIds?: never };

export type ResolvedAskUserDecisionAnswer =
  | { readonly kind: "selection"; readonly selectedId: string; readonly selectedIds: readonly string[] }
  | { readonly kind: "custom"; readonly customText: string };

export type AskUserDecisionHandler = (
  request: AskUserDecisionRequest,
) => Promise<AskUserDecisionAnswer>;

export interface AskUserDecisionToolOptions {
  /** Required host UI/callback — tool fails closed without it. */
  readonly ask: AskUserDecisionHandler;
  readonly executionPolicy?: ExecutionPolicy;
  readonly maxOptions?: number;
  readonly maxQuestionBytes?: number;
  readonly maxLabelBytes?: number;
  readonly maxBulletBytes?: number;
  readonly maxCustomTextBytes?: number;
}

export interface ResolvedAskUserDecisionLimits {
  readonly maxOptions: number;
  readonly maxQuestionBytes: number;
  readonly maxLabelBytes: number;
  readonly maxBulletBytes: number;
  readonly maxCustomTextBytes: number;
}

export function resolveAskUserDecisionLimits(
  options?: Pick<
    AskUserDecisionToolOptions,
    | "maxOptions"
    | "maxQuestionBytes"
    | "maxLabelBytes"
    | "maxBulletBytes"
    | "maxCustomTextBytes"
  >,
): ResolvedAskUserDecisionLimits {
  return {
    maxOptions: validateCodingLimit(
      "maxOptions",
      options?.maxOptions ?? DEFAULT_MAX_ASK_USER_DECISION_OPTIONS,
      HARD_MAX_ASK_USER_DECISION_OPTIONS,
    ),
    maxQuestionBytes: validateCodingLimit(
      "maxQuestionBytes",
      options?.maxQuestionBytes ?? DEFAULT_MAX_ASK_USER_DECISION_QUESTION_BYTES,
      HARD_MAX_ASK_USER_DECISION_QUESTION_BYTES,
    ),
    maxLabelBytes: validateCodingLimit(
      "maxLabelBytes",
      options?.maxLabelBytes ?? DEFAULT_MAX_ASK_USER_DECISION_LABEL_BYTES,
      HARD_MAX_ASK_USER_DECISION_LABEL_BYTES,
    ),
    maxBulletBytes: validateCodingLimit(
      "maxBulletBytes",
      options?.maxBulletBytes ?? DEFAULT_MAX_ASK_USER_DECISION_BULLET_BYTES,
      HARD_MAX_ASK_USER_DECISION_BULLET_BYTES,
    ),
    maxCustomTextBytes: validateCodingLimit(
      "maxCustomTextBytes",
      options?.maxCustomTextBytes ?? DEFAULT_MAX_ASK_USER_DECISION_CUSTOM_BYTES,
      HARD_MAX_ASK_USER_DECISION_CUSTOM_BYTES,
    ),
  };
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: ASK_USER_DECISION_TOOL_NAME,
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function assertByteLimit(label: string, text: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < 1 || bytes > maxBytes) {
    throw new Error(`${label} must be 1..${maxBytes} UTF-8 bytes`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new Error(`${label} contains control characters`);
  }
}

function requireThreeBullets(
  value: unknown,
  label: string,
  maxBytes: number,
): [string, string, string] {
  if (!Array.isArray(value) || value.length !== ASK_USER_DECISION_RATIONALE_COUNT) {
    throw new Error(`${label} must be exactly ${ASK_USER_DECISION_RATIONALE_COUNT} strings`);
  }
  const out: string[] = [];
  for (let i = 0; i < ASK_USER_DECISION_RATIONALE_COUNT; i++) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new Error(`${label}[${i}] must be a string`);
    }
    const trimmed = item.trim();
    assertByteLimit(`${label}[${i}]`, trimmed, maxBytes);
    out.push(trimmed);
  }
  return out as [string, string, string];
}

function parseSelectionMode(value: unknown): AskUserDecisionSelectionMode {
  if (value === undefined || value === null) return "single";
  if (value === "single" || value === "multiple") return value;
  throw new Error('selectionMode must be "single" or "multiple"');
}

function hasSelectionFields(answer: AskUserDecisionAnswer | null | undefined): boolean {
  if (!answer) return false;
  if (typeof answer.selectedId === "string" && answer.selectedId.trim() !== "") return true;
  return Array.isArray(answer.selectedIds) && answer.selectedIds.length > 0;
}

/** Normalize host answer against mode + allowCustom. Exported for tests. */
export function resolveAskUserDecisionAnswer(
  answer: AskUserDecisionAnswer | null | undefined,
  selectionMode: AskUserDecisionSelectionMode,
  options: readonly AskUserDecisionOption[],
  gates: { readonly allowCustom: boolean; readonly maxCustomTextBytes: number },
): ResolvedAskUserDecisionAnswer {
  const customRaw =
    answer && typeof answer.customText === "string" ? answer.customText.trim() : "";
  const hasCustom = customRaw.length > 0;
  const hasSelection = hasSelectionFields(answer);

  if (hasCustom && hasSelection) {
    throw new Error("customText is mutually exclusive with selectedId/selectedIds");
  }

  if (hasCustom) {
    if (!gates.allowCustom) throw new Error("customText rejected (allowCustom=false)");
    assertByteLimit("customText", customRaw, gates.maxCustomTextBytes);
    return { kind: "custom", customText: customRaw };
  }

  const byId = new Map(options.map((o) => [o.id, o]));
  const rawIds: string[] = [];

  if (answer && Array.isArray(answer.selectedIds)) {
    for (const id of answer.selectedIds) {
      if (typeof id !== "string") throw new Error("selectedIds entries must be strings");
      rawIds.push(id.trim());
    }
  }
  if (answer && typeof answer.selectedId === "string") {
    const id = answer.selectedId.trim();
    if (rawIds.length === 0) rawIds.push(id);
    else if (!(rawIds.length === 1 && rawIds[0] === id)) {
      throw new Error("selectedId and selectedIds disagree");
    }
  }

  if (rawIds.length === 0) {
    throw new Error(
      gates.allowCustom
        ? "ask() must return selectedId/selectedIds or customText"
        : selectionMode === "multiple"
          ? "ask() must return non-empty selectedIds"
          : "ask() must return selectedId",
    );
  }

  const seen = new Set<string>();
  const selectedIds: string[] = [];
  for (const id of rawIds) {
    if (!byId.has(id)) throw new Error(`ask() returned unknown selectedId: ${id}`);
    if (seen.has(id)) throw new Error(`duplicate selectedId: ${id}`);
    seen.add(id);
    selectedIds.push(id);
  }

  if (selectionMode === "single" && selectedIds.length !== 1) {
    // Single accepts selectedIds only when length is exactly 1.
    throw new Error("single selectionMode requires exactly one selected id");
  }

  return { kind: "selection", selectedIds, selectedId: selectedIds[0]! };
}

function parseAllowCustom(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new Error("allowCustom must be a boolean");
  return value;
}

/** Parse + validate model args into a bounded decision request. Exported for tests. */
export function parseAskUserDecisionArgs(
  args: Record<string, unknown>,
  limits: ResolvedAskUserDecisionLimits,
): {
  question: string;
  options: AskUserDecisionOption[];
  selectionMode: AskUserDecisionSelectionMode;
  allowCustom: boolean;
} {
  if (typeof args.question !== "string") {
    throw new Error("question must be a string");
  }
  const question = args.question.trim();
  assertByteLimit("question", question, limits.maxQuestionBytes);
  const selectionMode = parseSelectionMode(args.selectionMode);
  const allowCustom = parseAllowCustom(args.allowCustom);

  if (!Array.isArray(args.options)) {
    throw new Error("options must be an array");
  }
  if (args.options.length < 2) {
    throw new Error("options must include at least 2 choices");
  }
  if (args.options.length > limits.maxOptions) {
    throw new Error(`options exceeds maxOptions (${limits.maxOptions})`);
  }

  const seen = new Set<string>();
  const options: AskUserDecisionOption[] = [];
  for (let i = 0; i < args.options.length; i++) {
    const raw = args.options[i];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`options[${i}] must be an object`);
    }
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string") throw new Error(`options[${i}].id must be a string`);
    const id = row.id.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) {
      throw new Error(`options[${i}].id has invalid format`);
    }
    if (seen.has(id)) throw new Error(`duplicate option id: ${id}`);
    seen.add(id);

    if (typeof row.label !== "string") throw new Error(`options[${i}].label must be a string`);
    const label = row.label.trim();
    assertByteLimit(`options[${i}].label`, label, limits.maxLabelBytes);

    options.push({
      id,
      label,
      pros: requireThreeBullets(row.pros, `options[${i}].pros`, limits.maxBulletBytes),
      cons: requireThreeBullets(row.cons, `options[${i}].cons`, limits.maxBulletBytes),
    });
  }
  return { question, options, selectionMode, allowCustom };
}

/**
 * Create the opt-in `ask_user_decision` tool.
 * Host must supply `ask`; factory throws if missing.
 */
export function createAskUserDecisionTool(
  options: AskUserDecisionToolOptions,
): ToolDefinition {
  if (typeof options?.ask !== "function") {
    throw new Error("ask_user_decision requires options.ask");
  }
  const limits = resolveAskUserDecisionLimits(options);
  const ask = options.ask;

  return {
    name: ASK_USER_DECISION_TOOL_NAME,
    description:
      "Ask the user to choose a direction when instructions are ambiguous and the choice matters. " +
      "Provide 2+ options; each option MUST include exactly 3 pros and 3 cons. " +
      'Use selectionMode "multiple" when several options may apply together; default is single choice. ' +
      "Set allowCustom=true only when a short free-text alternative to the listed options is acceptable " +
      "(custom answer is mutually exclusive with selecting option ids). " +
      "Do not use for trivia, confirmations that are already clear, or when a single safe default exists.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Clear decision question for the user",
        },
        selectionMode: {
          type: "string",
          enum: ["single", "multiple"],
          description: 'single (default) or multiple selection',
        },
        allowCustom: {
          type: "boolean",
          description:
            "When true, host may return customText instead of selecting option ids (XOR). Default false.",
        },
        options: {
          type: "array",
          minItems: 2,
          maxItems: limits.maxOptions,
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Stable option id returned when selected (e.g. keep_sqlite)",
              },
              label: {
                type: "string",
                description: "User-facing option label",
              },
              pros: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: { type: "string" },
                description: "Exactly 3 advantages of this option",
              },
              cons: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: { type: "string" },
                description: "Exactly 3 disadvantages of this option",
              },
            },
            required: ["id", "label", "pros", "cons"],
            additionalProperties: false,
          },
          description: `2..${limits.maxOptions} options with pros/cons`,
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      let parsed: {
        question: string;
        options: AskUserDecisionOption[];
        selectionMode: AskUserDecisionSelectionMode;
        allowCustom: boolean;
      };
      try {
        parsed = parseAskUserDecisionArgs(args as Record<string, unknown>, limits);
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }

      const policyCheck = await enforceExecutionPolicy(
        options.executionPolicy,
        {
          kind: "ask_user_decision",
          operation: "ask",
          risk: "medium",
          metadata: {
            optionCount: parsed.options.length,
            optionIds: parsed.options.map((o) => o.id),
            selectionMode: parsed.selectionMode,
            allowCustom: parsed.allowCustom,
            sessionId: context.sessionId,
            runId: context.runId,
            signal: context.signal,
          },
        },
        toolCallId,
        ASK_USER_DECISION_TOOL_NAME,
      );
      if (!policyCheck.allowed) return policyCheck.result;

      let answer: AskUserDecisionAnswer;
      try {
        answer = await ask({
          question: parsed.question,
          options: parsed.options,
          selectionMode: parsed.selectionMode,
          allowCustom: parsed.allowCustom,
          toolCallId,
          sessionId: context.sessionId,
          runId: context.runId,
          signal: context.signal,
        });
      } catch (error) {
        return errorResult(
          toolCallId,
          error instanceof Error ? error.message : String(error),
        );
      }

      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");

      let resolved: ResolvedAskUserDecisionAnswer;
      try {
        resolved = resolveAskUserDecisionAnswer(answer, parsed.selectionMode, parsed.options, {
          allowCustom: parsed.allowCustom,
          maxCustomTextBytes: limits.maxCustomTextBytes,
        });
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }

      if (resolved.kind === "custom") {
        return {
          toolCallId,
          name: ASK_USER_DECISION_TOOL_NAME,
          content: [
            {
              type: "text",
              text: `User provided custom answer: ${resolved.customText}`,
            },
          ],
          metadata: {
            customText: resolved.customText,
            selectionMode: parsed.selectionMode,
            allowCustom: parsed.allowCustom,
            question: parsed.question,
            options: parsed.options,
          },
        };
      }

      const selected = resolved.selectedIds.map((id) => parsed.options.find((o) => o.id === id)!);
      const labelText = selected.map((o) => `"${o.label}" (id=${o.id})`).join(", ");

      return {
        toolCallId,
        name: ASK_USER_DECISION_TOOL_NAME,
        content: [
          {
            type: "text",
            text:
              parsed.selectionMode === "multiple"
                ? `User selected ${selected.length} option(s): ${labelText}.`
                : `User selected ${labelText}.`,
          },
        ],
        metadata: {
          selectedId: resolved.selectedId,
          selectedIds: resolved.selectedIds,
          selectedLabels: selected.map((o) => o.label),
          selectionMode: parsed.selectionMode,
          allowCustom: parsed.allowCustom,
          question: parsed.question,
          options: parsed.options,
        },
      };
    },
  };
}

/** Durable decision payload for workflow suspension `data` (no AbortSignal / secrets). */
export interface AskUserDecisionSuspendData {
  readonly question: string;
  readonly options: readonly AskUserDecisionOption[];
  readonly selectionMode: AskUserDecisionSelectionMode;
  readonly allowCustom: boolean;
  readonly toolCallId?: string;
  readonly sessionId?: string;
  readonly runId?: string;
}

export interface SuspendAskUserDecisionOptions {
  readonly reason?: string;
  readonly maxCustomTextBytes?: number;
}

/** JSON Schema describing resume `input` (= AskUserDecisionAnswer). */
export function askUserDecisionResumeSchema(
  request: Pick<AskUserDecisionSuspendData, "selectionMode" | "allowCustom" | "options">,
): JsonObject {
  const optionIds = request.options.map((o) => o.id);
  const selectionProps: JsonObject = {
    selectedId: { type: "string", enum: optionIds },
    selectedIds: {
      type: "array",
      minItems: 1,
      maxItems: optionIds.length,
      items: { type: "string", enum: optionIds },
    },
  };
  if (!request.allowCustom) {
    return {
      type: "object",
      additionalProperties: false,
      properties: selectionProps,
      // Host may send either field; tool/validator enforces mode + XOR with custom.
      anyOf: [{ required: ["selectedId"] }, { required: ["selectedIds"] }],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...selectionProps,
      customText: {
        type: "string",
        minLength: 1,
        maxLength: DEFAULT_MAX_ASK_USER_DECISION_CUSTOM_BYTES,
      },
    },
    anyOf: [
      { required: ["selectedId"] },
      { required: ["selectedIds"] },
      { required: ["customText"] },
    ],
  };
}

export function toAskUserDecisionSuspendData(
  request: {
    readonly question: string;
    readonly options: readonly AskUserDecisionOption[];
    readonly selectionMode: AskUserDecisionSelectionMode;
    readonly allowCustom: boolean;
    readonly toolCallId?: string;
    readonly sessionId?: string;
    readonly runId?: string;
  },
): AskUserDecisionSuspendData {
  return {
    question: request.question,
    options: request.options,
    selectionMode: request.selectionMode,
    allowCustom: request.allowCustom,
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.runId ? { runId: request.runId } : {}),
  };
}

function isAskUserDecisionSuspendData(value: unknown): value is AskUserDecisionSuspendData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.question === "string"
    && Array.isArray(row.options)
    && (row.selectionMode === "single" || row.selectionMode === "multiple")
    && typeof row.allowCustom === "boolean"
  );
}

/**
 * Return from a workflow node to pause for a user decision (opt-in durable path).
 * Host resumes via `resumeWorkflow` + `createAskUserDecisionResumeValidator` / `validateAskUserDecisionResume`.
 */
export function suspendAskUserDecision(
  request: AskUserDecisionSuspendData | Pick<
    AskUserDecisionRequest,
    "question" | "options" | "selectionMode" | "allowCustom" | "toolCallId" | "sessionId" | "runId"
  >,
  options?: SuspendAskUserDecisionOptions,
): WorkflowSuspension<AskUserDecisionAnswer> {
  const data = toAskUserDecisionSuspendData(request);
  if (data.options.length < 2) {
    throw new Error("suspendAskUserDecision requires at least 2 options");
  }
  return suspend<AskUserDecisionAnswer>({
    reason: options?.reason ?? ASK_USER_DECISION_SUSPEND_REASON,
    data,
    resumeSchema: askUserDecisionResumeSchema(data),
  });
}

/**
 * Validate resume input against the original decision request.
 * Shared by workflow `validateResume` and host-held agent resume adapters.
 */
export function validateAskUserDecisionResume(
  request: AskUserDecisionSuspendData,
  value: unknown,
  limits?: Pick<ResolvedAskUserDecisionLimits, "maxCustomTextBytes">,
): ResolvedAskUserDecisionAnswer {
  if (!isAskUserDecisionSuspendData(request)) {
    throw new Error("invalid ask_user_decision suspend data");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("resume input must be an ask_user_decision answer object");
  }
  const maxCustomTextBytes =
    limits?.maxCustomTextBytes ?? DEFAULT_MAX_ASK_USER_DECISION_CUSTOM_BYTES;
  return resolveAskUserDecisionAnswer(
    value as AskUserDecisionAnswer,
    request.selectionMode,
    request.options,
    { allowCustom: request.allowCustom, maxCustomTextBytes },
  );
}

/**
 * Workflow `validateResume` adapter. Reads durable request from `suspension.data`
 * (written by `suspendAskUserDecision`). Deny paths skip answer validation.
 */
export function createAskUserDecisionResumeValidator(
  limits?: Pick<ResolvedAskUserDecisionLimits, "maxCustomTextBytes">,
): WorkflowResumeValidator {
  return (input: WorkflowResumeValidationInput) => {
    if (!isAskUserDecisionSuspendData(input.suspension.data)) {
      throw new Error("suspension.data missing ask_user_decision request");
    }
    // Deny (and other no-input resumes) may omit answer; approve supplies it.
    if (input.value === undefined || input.value === null) return;
    validateAskUserDecisionResume(input.suspension.data, input.value, limits);
  };
}

/**
 * Thin agent-path adapter: same validation as workflow resume, for hosts that
 * persist `AskUserDecisionSuspendData` outside `AgentRunInterruption` (core kinds
 * unchanged in 0.0.12). Call after operator supplies an answer.
 */
export function validateAskUserDecisionAgentResume(input: {
  readonly request: AskUserDecisionSuspendData;
  readonly answer: unknown;
  readonly maxCustomTextBytes?: number;
}): ResolvedAskUserDecisionAnswer {
  return validateAskUserDecisionResume(
    input.request,
    input.answer,
    input.maxCustomTextBytes === undefined
      ? undefined
      : { maxCustomTextBytes: input.maxCustomTextBytes },
  );
}
