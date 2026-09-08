/** Contracts-core run-limits family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ProviderTurnResult, ToolResult } from "../contracts-protocol.js";
import type { Message, ToolCallContent } from "./content.js";

/**
 * Host-authored run limits. Policy axes accept `null` to explicitly disable the cap
 * (process safety still caps request/response bytes, which reject `null`). Omitted keys
 * resolve to `DEFAULT_RUN_LIMITS`.
 */
export interface RunLimits {
  readonly maxTurns?: number | null;
  readonly maxProviderAttempts?: number | null;
  readonly maxToolRounds?: number | null;
  readonly maxToolCalls?: number | null;
  readonly maxWallTimeMs?: number | null;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxInputTokens?: number | null;
  readonly maxOutputTokens?: number | null;
  readonly maxTotalTokens?: number | null;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
}

/** Fully resolved limits after `resolveRunLimits`: every policy axis is a finite cap or `null` (disabled). */
export interface ResolvedRunLimits {
  readonly maxTurns: number | null;
  readonly maxProviderAttempts: number | null;
  readonly maxToolRounds: number | null;
  readonly maxToolCalls: number | null;
  readonly maxWallTimeMs: number | null;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxTotalTokens: number | null;
  readonly maxCost?: { readonly amount: number; readonly currency: string };
}

export type RunLimitName = keyof Required<RunLimits>;

export interface RunLimitCounters {
  readonly turns: number;
  readonly providerAttempts: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly wallTimeMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
}

export interface RunLimitBreach {
  readonly limit: RunLimitName;
  readonly maximum: number;
  readonly observed: number;
  readonly currency?: string;
}

export type GuardrailStage = "input" | "output" | "tool_input" | "tool_output";
export type GuardrailAction = "allow" | "block" | "tripwire" | "interrupt";

export type GuardrailValue<S extends GuardrailStage> = S extends "input"
  ? readonly Message[]
  : S extends "output"
    ? ProviderTurnResult
    : S extends "tool_input"
      ? ToolCallContent
      : ToolResult;

export interface GuardrailContext<S extends GuardrailStage> {
  readonly stage: S;
  readonly value: GuardrailValue<S>;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface GuardrailDecision {
  readonly action: GuardrailAction;
  readonly reason?: string;
  /** Public data only; Prism JSON-normalizes, bounds, and redacts it before emission. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Guardrail<S extends GuardrailStage = GuardrailStage> {
  readonly name: string;
  readonly stage: S;
  /** Host-authored stable identity for durable definitions; unused by ordinary runs. */
  readonly revision?: string;
  evaluate(context: GuardrailContext<S>): GuardrailDecision | Promise<GuardrailDecision>;
}

export interface GuardrailRecord {
  readonly guardrail: string;
  readonly stage: GuardrailStage;
  readonly action: GuardrailAction;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Guardrails {
  readonly input?: readonly Guardrail<"input">[];
  readonly output?: readonly Guardrail<"output">[];
  readonly toolInput?: readonly Guardrail<"tool_input">[];
  readonly toolOutput?: readonly Guardrail<"tool_output">[];
  /** Defaults to sequential; at most 16 stage evaluations run at once. */
  readonly maxConcurrency?: number;
}
