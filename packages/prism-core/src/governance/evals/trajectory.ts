import type { JsonObject } from "@arnilo/prism";
import { createJsonSchemaArgumentValidator } from "../../validation/json-schema/json-schema.js";
import type { ExecutionStep, ExecutionTimeline } from "../observability/timeline-types.js";
import { EvalError } from "./errors.js";
import type { ScoreResult, Scorer, ScorerInput } from "./types.js";

// ─── Caps & Limits ────────────────────────────────────────────────────────────

export const DEFAULT_MAX_EXPECTED_CALLS = 64;
export const HARD_MAX_EXPECTED_CALLS = 256;

// ─── ToolCallSpec & Helpers ───────────────────────────────────────────────────

export interface ToolCallSpec {
  readonly name: string;
  readonly args?: (actual: Record<string, unknown>) => boolean;
}

export type ToolCallMatchMode = "strict" | "unordered" | "subset" | "superset";

export interface ToolCallMatchScorerOptions {
  readonly id?: string;
  readonly mode: ToolCallMatchMode;
  readonly expected?: readonly (string | ToolCallSpec)[];
  readonly deny?: readonly (string | ToolCallSpec)[];
  /** When true, marks failures as invariant violations that fail closed in thresholds. Defaults to true if deny is set. */
  readonly invariant?: boolean;
}

function normalizeSpec(item: string | ToolCallSpec): ToolCallSpec {
  if (typeof item === "string") return { name: item };
  return item;
}

function matchesSpec(step: ExecutionStep, spec: ToolCallSpec): boolean {
  if (step.name !== spec.name) return false;
  if (spec.args) {
    const inputObj = (typeof step.input === "object" && step.input !== null ? step.input : {}) as Record<string, unknown>;
    return spec.args(inputObj);
  }
  return true;
}

/**
 * Trajectory match scorer evaluating actual timeline tool steps against expected specs.
 *
 * - `"strict"`: exact sequence in exact order (no extras, no missing).
 * - `"unordered"`: exact multiset of expected calls (no extras, order ignored).
 * - `"subset"`: every actual tool call was expected (unexpected/extra tool calls fail).
 * - `"superset"`: every expected tool call was performed (extra tool calls are allowed).
 * - `deny`: forbidden tool specs; if any match, score is immediately 0.
 */
export function createToolCallMatchScorer<TInput = unknown, TExpected = unknown>(
  options: ToolCallMatchScorerOptions,
): Scorer<TInput, TExpected> {
  const mode = options.mode;
  const isInvariant = options.invariant ?? (options.deny !== undefined && options.deny.length > 0);
  const rawExpected = options.expected ?? [];
  if (rawExpected.length > HARD_MAX_EXPECTED_CALLS) {
    throw new EvalError(
      `expected tool calls count (${rawExpected.length}) exceeds hard limit (${HARD_MAX_EXPECTED_CALLS})`,
      "ERR_PRISM_EVAL_TRAJECTORY_BOUNDS",
    );
  }
  const expectedSpecs = rawExpected.map(normalizeSpec);
  const denySpecs = (options.deny ?? []).map(normalizeSpec);

  return {
    id: options.id ?? `tool_call_match_${mode}`,
    description: `tool call match (${mode})`,
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      const timeline: ExecutionTimeline | undefined = input.timeline ?? input.target?.timeline;
      if (!timeline) {
        return {
          score: 0,
          reason: "no execution timeline available for trajectory scoring",
          metadata: { invariant: isInvariant },
        };
      }

      const toolSteps = timeline.steps.filter((s) => s.kind === "tool");

      // 1. Deny list check
      for (const step of toolSteps) {
        for (const deny of denySpecs) {
          if (matchesSpec(step, deny)) {
            return {
              score: 0,
              reason: `forbidden tool "${step.name}" was called`,
              metadata: { invariant: true, forbiddenTool: step.name },
            };
          }
        }
      }

      // 2. Mode match check
      switch (mode) {
        case "strict": {
          if (toolSteps.length !== expectedSpecs.length) {
            return {
              score: 0,
              reason: `strict match count mismatch: expected ${expectedSpecs.length}, got ${toolSteps.length}`,
              metadata: { invariant: isInvariant },
            };
          }
          for (let i = 0; i < toolSteps.length; i++) {
            const step = toolSteps[i]!;
            const expected = expectedSpecs[i]!;
            if (!matchesSpec(step, expected)) {
              return {
                score: 0,
                reason: `strict match mismatch at index ${i}: expected "${expected.name}", got "${step.name}"`,
                metadata: { invariant: isInvariant },
              };
            }
          }
          return { score: 1, metadata: { invariant: isInvariant } };
        }

        case "unordered": {
          if (toolSteps.length !== expectedSpecs.length) {
            return {
              score: 0,
              reason: `unordered match count mismatch: expected ${expectedSpecs.length}, got ${toolSteps.length}`,
              metadata: { invariant: isInvariant },
            };
          }
          const unmatchedIndices = new Set(toolSteps.keys());
          for (const expected of expectedSpecs) {
            let matchedIndex: number | undefined;
            for (const idx of unmatchedIndices) {
              if (matchesSpec(toolSteps[idx]!, expected)) {
                matchedIndex = idx;
                break;
              }
            }
            if (matchedIndex === undefined) {
              return {
                score: 0,
                reason: `unordered match failed: expected tool "${expected.name}" not found in unmatched actual steps`,
                metadata: { invariant: isInvariant },
              };
            }
            unmatchedIndices.delete(matchedIndex);
          }
          return { score: 1, metadata: { invariant: isInvariant } };
        }

        case "subset": {
          // Every actual call must match at least one expected spec (no unexpected extra calls)
          const availableSpecs = [...expectedSpecs];
          for (const step of toolSteps) {
            const specIdx = availableSpecs.findIndex((s) => matchesSpec(step, s));
            if (specIdx === -1) {
              return {
                score: 0,
                reason: `subset match failed: extra tool "${step.name}" was not in expected set`,
                metadata: { invariant: isInvariant },
              };
            }
            availableSpecs.splice(specIdx, 1);
          }
          return { score: 1, metadata: { invariant: isInvariant } };
        }

        case "superset": {
          // All expected specs must be satisfied by actual steps (extra tool calls are ok)
          let stepSearchIndex = 0;
          for (const expected of expectedSpecs) {
            let found = false;
            while (stepSearchIndex < toolSteps.length) {
              const candidate = toolSteps[stepSearchIndex++]!;
              if (matchesSpec(candidate, expected)) {
                found = true;
                break;
              }
            }
            if (!found) {
              return {
                score: 0,
                reason: `superset match failed: expected tool "${expected.name}" was not found in sequence`,
                metadata: { invariant: isInvariant },
              };
            }
          }
          return { score: 1, metadata: { invariant: isInvariant } };
        }
      }
    },
  };
}

// ─── Step Budget Scorer (R-E2) ────────────────────────────────────────────────

export interface StepBudgetScorerOptions {
  readonly id?: string;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxDurationMs?: number;
  readonly maxTotalTokens?: number;
  readonly maxCost?: number;
}

/**
 * Verifies that the run stayed within resource and turn limits.
 */
export function createStepBudgetScorer<TInput = unknown, TExpected = unknown>(options: StepBudgetScorerOptions): Scorer<TInput, TExpected> {
  return {
    id: options.id ?? "step_budget",
    description: "step budget and resource ceiling scorer",
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      const timeline = input.timeline ?? input.target?.timeline;
      if (!timeline) {
        return { score: 0, reason: "no timeline available for step budget evaluation" };
      }

      if (options.maxTurns !== undefined) {
        const turnSteps = timeline.steps.filter((s) => s.kind === "turn");
        if (turnSteps.length > options.maxTurns) {
          return {
            score: 0,
            reason: `turns exceeded maxTurns (${turnSteps.length} > ${options.maxTurns})`,
          };
        }
      }

      if (options.maxToolCalls !== undefined) {
        const toolCalls = timeline.steps.filter((s) => s.kind === "tool");
        if (toolCalls.length > options.maxToolCalls) {
          return {
            score: 0,
            reason: `tool calls exceeded maxToolCalls (${toolCalls.length} > ${options.maxToolCalls})`,
          };
        }
      }

      if (options.maxDurationMs !== undefined) {
        if (timeline.startedAt && timeline.finishedAt) {
          const duration = Date.parse(timeline.finishedAt) - Date.parse(timeline.startedAt);
          if (Number.isFinite(duration) && duration > options.maxDurationMs) {
            return {
              score: 0,
              reason: `duration exceeded maxDurationMs (${duration}ms > ${options.maxDurationMs}ms)`,
            };
          }
        }
      }

      if (options.maxTotalTokens !== undefined) {
        const tokens = timeline.usage?.totalTokens ?? input.result.usage?.totalTokens ?? 0;
        if (tokens > options.maxTotalTokens) {
          return {
            score: 0,
            reason: `total tokens exceeded maxTotalTokens (${tokens} > ${options.maxTotalTokens})`,
          };
        }
      }

      if (options.maxCost !== undefined) {
        const cost = timeline.usage?.cost ?? input.result.usage?.cost ?? 0;
        if (cost > options.maxCost) {
          return {
            score: 0,
            reason: `cost exceeded maxCost (${cost} > ${options.maxCost})`,
          };
        }
      }

      return { score: 1 };
    },
  };
}

// ─── No-Loop Scorer (R-E2) ────────────────────────────────────────────────────

export interface NoLoopScorerOptions {
  readonly id?: string;
  /** Maximum consecutive identical tool+arguments calls before failing. Defaults to 2 (3 consecutive fails). */
  readonly maxRepeatedToolCalls?: number;
}

/**
 * Detects degenerate loops where an agent calls the exact same tool with identical arguments repeatedly.
 */
export function createNoLoopScorer<TInput = unknown, TExpected = unknown>(options: NoLoopScorerOptions = {}): Scorer<TInput, TExpected> {
  const threshold = options.maxRepeatedToolCalls ?? 2;

  return {
    id: options.id ?? "no_loop",
    description: "detects identical tool+arguments repetitive loops",
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      const timeline = input.timeline ?? input.target?.timeline;
      if (!timeline) {
        return { score: 0, reason: "no timeline available for loop detection" };
      }

      const toolSteps = timeline.steps.filter((s) => s.kind === "tool");
      let streakTool = "";
      let streakArgs = "";
      let streakCount = 0;

      for (const step of toolSteps) {
        const serializedArgs = JSON.stringify(step.input ?? null);
        if (step.name === streakTool && serializedArgs === streakArgs) {
          streakCount++;
          if (streakCount > threshold) {
            return {
              score: 0,
              reason: `loop detected: tool "${step.name}" called ${streakCount} times with identical arguments`,
              metadata: { invariant: true, loopingTool: step.name },
            };
          }
        } else {
          streakTool = step.name;
          streakArgs = serializedArgs;
          streakCount = 1;
        }
      }

      return { score: 1 };
    },
  };
}

// ─── Schema Scorer (R-E2) ─────────────────────────────────────────────────────

export interface SchemaScorerOptions {
  readonly id?: string;
  readonly schema: Record<string, unknown>;
  readonly target?: "result" | "step";
  readonly stepName?: string;
}

/**
 * Validates agent final output or a named step output against a JSON schema.
 */
export function createSchemaScorer<TInput = unknown, TExpected = unknown>(options: SchemaScorerOptions): Scorer<TInput, TExpected> {
  const validator = createJsonSchemaArgumentValidator();

  return {
    id: options.id ?? "schema_validation",
    description: "validates output against JSON schema",
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      let candidate: unknown;

      if (options.target === "step" && options.stepName) {
        const timeline = input.timeline ?? input.target?.timeline;
        const step = timeline?.steps.find((s) => s.name === options.stepName);
        if (!step) {
          return { score: 0, reason: `step "${options.stepName}" not found on timeline` };
        }
        candidate = step.output;
      } else {
        // Output from result or timeline
        const resultOutput = (input.result as { output?: unknown }).output;
        if (resultOutput !== undefined) {
          candidate = resultOutput;
        } else if (input.result.text) {
          try {
            candidate = JSON.parse(input.result.text);
          } catch {
            candidate = input.result.text;
          }
        }
      }

      if (candidate === undefined || candidate === null) {
        return { score: 0, reason: "output value is empty or undefined" };
      }

      const res = validator.validate(options.schema as JsonObject, candidate);
      if (!res.ok) {
        const messages = res.errors ? res.errors.map((e) => e.message).join("; ") : "invalid schema";
        return { score: 0, reason: `schema validation failed: ${messages}` };
      }

      return { score: 1 };
    },
  };
}

// ─── Error Class Scorer (R-E2) ────────────────────────────────────────────────

export interface ErrorClassScorerOptions {
  readonly id?: string;
  readonly deny?: readonly (string | number)[];
}

/**
 * Checks that denied error codes or blocked executions did not occur on the timeline.
 */
export function createErrorClassScorer<TInput = unknown, TExpected = unknown>(
  options: ErrorClassScorerOptions = {},
): Scorer<TInput, TExpected> {
  const deniedSet = options.deny ? new Set(options.deny.map(String)) : undefined;

  return {
    id: options.id ?? "error_class",
    description: "checks for denied error codes and blocked executions",
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      const timeline = input.timeline ?? input.target?.timeline;
      if (!timeline) {
        return { score: 1 };
      }

      for (const step of timeline.steps) {
        if (step.status === "failed" || step.status === "blocked") {
          const code = step.error?.code !== undefined ? String(step.error.code) : undefined;
          const reason = typeof step.metadata?.reason === "string" ? step.metadata.reason : undefined;

          if (deniedSet) {
            if (code && deniedSet.has(code)) {
              return {
                score: 0,
                reason: `denied error code "${code}" encountered on step "${step.name}"`,
                metadata: { invariant: true, errorCode: code },
              };
            }
            if (reason && deniedSet.has(reason)) {
              return {
                score: 0,
                reason: `denied blocked reason "${reason}" encountered on step "${step.name}"`,
                metadata: { invariant: true, reason },
              };
            }
          } else {
            // General error denial
            return {
              score: 0,
              reason: `step "${step.name}" failed with status "${step.status}"`,
              metadata: { invariant: true },
            };
          }
        }
      }

      return { score: 1 };
    },
  };
}

// ─── Approval-Before-Effect Scorer (R-E12) ────────────────────────────────────

export interface ApprovalBeforeEffectScorerOptions {
  readonly id?: string;
  /** Name of the sensitive tool/effect requiring prior approval. If omitted, checks all tools with effect metadata. */
  readonly toolName?: string;
  /** Custom matcher to correlate an approval step with an effect step. */
  readonly matchApproval?: (approvalStep: ExecutionStep, effectStep: ExecutionStep) => boolean;
}

/**
 * Hard invariant scorer requiring explicit approval on the timeline BEFORE any sensitive effect execution.
 */
export function createApprovalBeforeEffectScorer<TInput = unknown, TExpected = unknown>(
  options: ApprovalBeforeEffectScorerOptions = {},
): Scorer<TInput, TExpected> {
  return {
    id: options.id ?? "approval_before_effect",
    description: "verifies approval occurred on timeline prior to tool effect",
    score(input: ScorerInput<TInput, TExpected>): ScoreResult {
      const timeline = input.timeline ?? input.target?.timeline;
      if (!timeline) {
        return {
          score: 0,
          reason: "no timeline available for approval-before-effect verification",
          metadata: { invariant: true },
        };
      }

      const effectSteps = timeline.steps.filter((s) => {
        if (s.kind !== "tool") return false;
        if (options.toolName) return s.name === options.toolName;
        return true;
      });

      if (effectSteps.length === 0) {
        return { score: 1, metadata: { invariant: true } };
      }

      for (const effect of effectSteps) {
        // Look for prior approval step
        const priorApprovals = timeline.steps.filter((s) => {
          if (s.order >= effect.order) return false;
          if (options.matchApproval) return options.matchApproval(s, effect);

          // By default, HITL or guardrail steps before the effect
          if (s.kind === "hitl" && s.status !== "denied" && s.status !== "failed") return true;
          if (s.kind === "guardrail" && s.status === "succeeded") return true;
          return false;
        });

        if (priorApprovals.length === 0) {
          return {
            score: 0,
            reason: `effect tool "${effect.name}" executed at step order ${effect.order} without prior approval`,
            metadata: { invariant: true, unapprovedTool: effect.name },
          };
        }
      }

      return { score: 1, metadata: { invariant: true } };
    },
  };
}
