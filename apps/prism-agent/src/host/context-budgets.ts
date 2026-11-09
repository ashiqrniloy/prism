import { type CompactionTrigger, definePackage, type ModelRef, type PackageInstance } from "@arnilo/prism";

export interface ContextBudget {
  /** Task 6's measured effective input budget, in tokens. */
  readonly inputTokens: number;
  /** The evidence file the number comes from. */
  readonly evidence: string;
}

/**
 * Measured effective input budgets, keyed by `provider/model`. The ratio gate is 0.6 of the model's
 * input cap; each budget here is already below that, so `threshold_tokens` is the smaller of the two.
 */
export const CONTEXT_BUDGETS: Readonly<Record<string, ContextBudget>> = {
  // docs/_evidence/context-rot/opencode-go-mimo-v2.5-2026-10-24.json (pilot: 96,000 tokens).
  "opencode-go/mimo-v2.5": { inputTokens: 96_000, evidence: "docs/_evidence/context-rot/opencode-go-mimo-v2.5-2026-10-24.json" },
};

/** `provider/model` for a string ref or a model object. */
export function modelKey(ref: ModelRef): string {
  return typeof ref === "string" ? ref : `${ref.provider}/${ref.model}`;
}

export function contextBudgetFor(ref: ModelRef): ContextBudget | undefined {
  return CONTEXT_BUDGETS[modelKey(ref)];
}

/** Listed model: its measured budget; unlisted: the relative 0.6 gate only. */
export function compactionTriggerFor(ref: ModelRef): CompactionTrigger {
  const budget = contextBudgetFor(ref);
  return budget === undefined ? { type: "input_ratio", ratio: 0.6 } : { type: "threshold_tokens", tokens: budget.inputTokens };
}

/** One batched fold per ~10% of the measured budget; unlisted models keep the package minimum. */
export function foldClearAtLeastTokensFor(ref: ModelRef): number {
  const budget = contextBudgetFor(ref);
  return budget === undefined ? 4_096 : Math.max(1, Math.round(budget.inputTokens * 0.1));
}

/** OM's gate: 0.6 of the input cap, never above the measured budget. */
export function sessionCompactAtFor(ref: ModelRef): { ratio: number; maxTokens?: number } {
  const budget = contextBudgetFor(ref);
  return budget === undefined ? { ratio: 0.6 } : { ratio: 0.6, maxTokens: budget.inputTokens };
}

/** Notes the unlisted-model fallback once per agent; listed models note nothing. */
export function contextBudgetNotice(ref: ModelRef): PackageInstance {
  return definePackage({
    name: "@prism-agent/context-budget",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      if (contextBudgetFor(ref) !== undefined) return;
      prism.status.note("info", `${modelKey(ref)} has no measured context-rot budget; using input_ratio 0.6 of the model input cap`);
    },
  })();
}
