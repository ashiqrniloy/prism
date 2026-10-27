import manifest from "../package.json" with { type: "json" };
import {
  type CompactionContext,
  type CompactionResult,
  type Compactor,
  definePackage,
  type ModelClient,
  type ModelConfig,
  type PackageAPI,
  resolveInputCap,
  resolveShouldCompact,
} from "@arnilo/prism";

import { createCodingCompactor, keepLatestPlanTurn } from "./coding.js";
import {
  type MemoryCompactionConfig,
  memoryCompactionConfigSchema,
  type ResolvedMemoryCompactionConfig,
  resolveMemoryCompactionConfig,
} from "./config.js";
import { createLlmCompactor, fallbackReason, type LlmCompactorOptions, type SummaryClientFor } from "./strategy.js";

export type { MemoryCompactionConfig, MemoryCompactionProfile } from "./config.js";

/**
 * LLM summarization compaction (roadmap §2.9/§2.5). Claims the `compaction` slot and summarizes the
 * history the cut drops with one model call per compaction. When that call fails the compactor falls
 * back to `prism.slots.compaction.default` and emits `compaction.fallback`, so a summary-model failure
 * never fails a run and never leaves the branch uncompacted. Installing the package is the opt-in:
 * without it the kernel's deterministic compactor makes no model call.
 */
const definition = definePackage<MemoryCompactionConfig>({
  name: "@arnilo/prism-memory-compaction",
  version: manifest.version,
  description: "LLM summarization compaction: one model call per compaction, with the kernel default as fallback.",
  requires: { api: 1 },
  capabilities: ["models", "slot:compaction"],
  config: memoryCompactionConfigSchema,
  setup(prism) {
    const config = resolveMemoryCompactionConfig(prism.config ?? {});
    const clientFor = summaryClient(prism, config);
    const shared: Omit<LlmCompactorOptions, "name" | "clientFor"> & { clientFor: SummaryClientFor } = {
      clientFor,
      keepRecentTokens: config.keepRecentTokens,
      maxSummaryTokens: config.maxSummaryTokens,
      ...(config.summaryPrompt === undefined ? {} : { summaryPrompt: config.summaryPrompt }),
    };
    const coding = config.profile === "coding";
    const compactor = withFallback(
      prism,
      coding ? createCodingCompactor(shared) : createLlmCompactor({ ...shared, name: "llm-compaction" }),
    );
    prism.slots.compaction.provide(coding ? keepLatestPlanTurn(compactor) : compactor);

    // The auto trigger, when the host asks for one: the package votes on `compaction.when`, and
    // declines (`false`) below the gate so the kernel's `compaction.thresholdEntries` fallback — which
    // only runs when every handler abstains — stays out of the way.
    if (!config.trigger) return;
    prism.hooks.on("compaction.when", async (payload, context) => {
      const session = context.session;
      if (!session) return undefined;
      const compact = await resolveShouldCompact(
        { trigger: config.trigger },
        {
          sessionId: payload.sessionId,
          entryCount: payload.entryCount,
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
          estimateInputTokens: () => payload.estimatedTokens ?? 0,
          resolveInputCapTokens: () => resolveInputCap(undefined, session.model),
          signal: context.signal,
        },
      );
      return compact ? { compact: true } : { compact: false };
    });
  },
});

export default definition;

/**
 * The summary model call. `config.model` wins, else the session's model, else the agent's (which
 * `models.client` rejects when the agent holds none). The model's own output limit caps the budget.
 */
function summaryClient(prism: PackageAPI<MemoryCompactionConfig>, config: ResolvedMemoryCompactionConfig): SummaryClientFor {
  return (maxTokens, context: CompactionContext): ModelClient => {
    const ref = config.model ?? context.session?.model;
    const base = ref ? prism.models.client(ref) : prism.models.client();
    return prism.models.client(withOutputBudget(base.model, maxTokens));
  };
}

function withOutputBudget(model: ModelConfig, maxTokens: number): ModelConfig {
  const declared = model.limits?.maxOutputTokens;
  const cap = Number.isSafeInteger(declared) && (declared as number) > 0 ? Math.min(maxTokens, declared as number) : maxTokens;
  return { ...model, parameters: { ...model.parameters, maxTokens: cap } };
}

/**
 * A summary-model failure is never a run failure: report it as `compaction.fallback` and let the kernel's
 * deterministic compactor produce the entry. An aborted signal is the caller's stop, so it propagates and
 * appends nothing.
 */
function withFallback(prism: PackageAPI<MemoryCompactionConfig>, llm: Compactor): Compactor {
  return {
    name: llm.name,
    async compact(context): Promise<CompactionResult> {
      try {
        return await llm.compact(context);
      } catch (error) {
        if (context.signal?.aborted) throw error;
        prism.events.emit("compaction.fallback", {
          strategy: llm.name ?? "llm-compaction",
          reason: fallbackReason(error, context.secrets ?? []),
        });
        return prism.slots.compaction.default.compact(context);
      }
    },
  };
}
