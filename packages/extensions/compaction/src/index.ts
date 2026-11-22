import manifest from "../../package.json" with { type: "json" };
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
 * history the cut drops with one model call per compaction, or a rolling summary over at most `maxChunks`
 * calls when that history does not fit the summary model's input cap. When that call fails the compactor falls
 * back to `prism.slots.compaction.default` and emits `compaction.fallback`, so a summary-model failure
 * never fails a run and never leaves the branch uncompacted. Installing the package is the opt-in:
 * without it the kernel's deterministic compactor makes no model call.
 */
const definition = definePackage<MemoryCompactionConfig>({
  name: "@arnilo/prism-extensions/compaction",
  version: manifest.version,
  description: "LLM summarization compaction: one model call per compaction, with the kernel default as fallback.",
  requires: { api: 2 },
  capabilities: ["models", "slot:compaction"],
  config: memoryCompactionConfigSchema,
  setup(prism) {
    const config = resolveMemoryCompactionConfig(prism.config ?? {});
    const clientFor = summaryClient(prism, config);
    const shared: Omit<LlmCompactorOptions, "name" | "clientFor"> & { clientFor: SummaryClientFor } = {
      clientFor,
      keepRecentTokens: config.keepRecentTokens,
      maxSummaryTokens: config.maxSummaryTokens,
      maxChunks: config.maxChunks,
      maxKeptShare: config.maxKeptShare,
      ...(config.reserveTokens === undefined ? {} : { reserveTokens: config.reserveTokens }),
      ...(config.maxErrorBytes === undefined ? {} : { maxErrorBytes: config.maxErrorBytes }),
      ...(config.maxToolResultChars === undefined ? {} : { maxToolResultChars: config.maxToolResultChars }),
      ...(config.maxTextBlockChars === undefined ? {} : { maxTextBlockChars: config.maxTextBlockChars }),
      ...(config.summaryPrompt === undefined ? {} : { summaryPrompt: config.summaryPrompt }),
    };
    const coding = config.profile === "coding";
    const compactor = withFallback(
      prism,
      coding ? createCodingCompactor(shared) : createLlmCompactor({ ...shared, name: "llm-compaction" }),
    );
    prism.slots.compaction.provide(coding ? keepLatestPlanTurn(compactor) : compactor);
    claimCompactionSystem(prism);

    // The auto trigger, when the host asks for one: the package votes on `compaction.when`, and
    // declines (`false`) below the gate so the kernel's fallback trigger — which only runs when every
    // handler abstains — stays out of the way. With no `trigger` the package does not vote, and the
    // kernel's trigger decides (by default 80% of the model's input cap, plan 229 Task 4).
    if (!config.trigger) return;
    const trigger = config.trigger;
    // Only a gate that reads the cap pays for a catalog read (plan 229 Further Actions P2).
    const readsCap = trigger.type === "input_ratio" || trigger.type === "custom";
    prism.hooks.on("compaction.when", async (payload, context) => {
      const session = context.session;
      if (!session) return undefined;
      const model = readsCap ? await describeForCap(prism, session.model) : session.model;
      const compact = await resolveShouldCompact(
        { trigger },
        {
          sessionId: payload.sessionId,
          entryCount: payload.entryCount,
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
          estimateInputTokens: () => payload.estimatedTokens ?? 0,
          resolveInputCapTokens: () => resolveInputCap(undefined, model),
          signal: context.signal,
        },
      );
      return compact ? { compact: true } : { compact: false };
    });
  },
});

export default definition;

/**
 * The service every compaction system provides (`{ name }`), so two never run in one agent: the memory system's session
 * compaction provides it as `session-memory` (plan 218.3 Task 2). Whichever loads second fails agent creation.
 */
const COMPACTION_SYSTEM_SERVICE = "compaction.system";

function claimCompactionSystem(prism: PackageAPI<MemoryCompactionConfig>): void {
  const other = prism.services.consume<{ readonly name?: string }>(COMPACTION_SYSTEM_SERVICE);
  if (other !== undefined)
    throw new TypeError(
      `LLM compaction cannot run beside another compaction system ("${other.name ?? "unknown"}"); list one. ` +
        "For the memory system, set its context.compaction: false to keep this package",
    );
  prism.services.provide(COMPACTION_SYSTEM_SERVICE, Object.freeze({ name: "llm-compaction" }));
}

/**
 * `model` with the provider catalog's description filled in under the host's fields, through the kernel's cached
 * lookup (`models.client(...).resolve()`), so a bare `"provider/model"` ref still has a window. A model that already
 * declares one, or a failed lookup, answers the model as given.
 */
async function describeForCap(prism: PackageAPI<MemoryCompactionConfig>, model: ModelConfig | undefined): Promise<ModelConfig | undefined> {
  if (!model || model.limits?.contextWindow !== undefined) return model;
  try {
    const client = prism.models.client(model);
    return client.resolve ? await client.resolve() : model;
  } catch {
    return model;
  }
}

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
