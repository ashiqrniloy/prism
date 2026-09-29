import {
  type CompactionEntryData,
  type CompactionOptions,
  type CompactionStrategy,
  type CompactionTrigger,
  type ContextBudget,
  capToolResultSummary,
  isCompactionEntryData,
  type ModelConfig,
  resolveInputCap,
  type ToolResultFoldOptions,
} from "@arnilo/prism";
import { todoPinnedEntryIds } from "@arnilo/prism-coding-tools/agent";
import { createCodingCompactionStrategy } from "@arnilo/prism-memory/compaction/llm";
import { createObservationalMemoryCompactionStrategy } from "@arnilo/prism-memory/compaction/observational-memory";
import type { PrismCodeCompactionConfig } from "./config.js";
import type { ProviderCache } from "./providers.js";

export const PRISM_CODE_DEFAULT_COMPACTION_RATIO = 0.8;
export const PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES = 8;
/** Mirrors the LLM compaction strategy default; capped to half the window so a real cut point always exists. */
export const PRISM_CODE_DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const PRISM_CODE_DEFAULT_CONTEXT_WINDOW = 32_000;
/** Fallback trigger budget for a model whose input cap cannot be resolved. */
export const PRISM_CODE_DEFAULT_COMPACTION_TOKENS = 20_000;

/** Same helper the core `input_ratio` trigger resolves its cap with; a throw here means unusable limits. */
function canResolveInputCap(model: ModelConfig): boolean {
  try {
    resolveInputCap(undefined, model);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps the latest `todo_write` turn out of the compaction cut.
 *
 * The plan and the todo continuation stop hook both read that tool result from history. A cut that
 * summarized it away would hide the plan from the model and silently stop continuing a run with
 * open items. Entries are re-pinned on every compaction, so one plan written once at the start of
 * a long run survives any number of cuts.
 */
function keepLatestTodoTurn(strategy: CompactionStrategy): CompactionStrategy {
  return {
    ...strategy,
    async compact(context) {
      const result = await strategy.compact(context);
      const pinned = todoPinnedEntryIds(context.entries);
      if (pinned.length === 0) return result;
      const source = result.entries?.find((entry) => entry.kind === "compaction");
      const data = source?.data;
      if (source === undefined || !isCompactionEntryData(data)) return result;
      const keepEntryIds = [...(data.keepEntryIds ?? []), ...pinned.filter((id) => !data.keepEntryIds?.includes(id))];
      const patched: CompactionEntryData = { ...data, keepEntryIds };
      return { ...result, entries: result.entries?.map((entry) => (entry === source ? { ...entry, data: patched } : entry)) };
    },
  };
}
export const PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS = 2;
export const PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES = 4096;
export const PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES = 512;

/**
 * Resolves compaction options for Prism Code.
 * Supports:
 * - Coding (LLM-based) and OM (Observational Memory-based) strategies.
 * - Auto-compaction triggers: `input_ratio` (default 0.8), `each_turn`, `threshold_tokens`, `threshold_entries`.
 * - Explicit disabling via `compaction: false`.
 */
export function resolvePrismCodeCompaction(
  config: PrismCodeCompactionConfig | undefined,
  sessionModel: ModelConfig,
  cache: ProviderCache,
): false | CompactionOptions {
  if (config === false) return false;
  const cfg = config ?? {};
  const strategyKind = cfg.strategy ?? "coding";
  const keepRecentEntries = cfg.keepRecentEntries ?? PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES;
  // The LLM strategies keep a token budget, not an entry count. Deriving it from the window keeps
  // the keep budget below the compact trigger, so compaction always has entries to summarize
  // (a window smaller than the strategy default would otherwise turn every compaction into a no-op).
  // A host may ask for a tighter (or larger) budget; the half-window cap still applies.
  const contextWindow = sessionModel.limits?.contextWindow ?? PRISM_CODE_DEFAULT_CONTEXT_WINDOW;
  const requestedKeepRecentTokens = cfg.keepRecentTokens ?? PRISM_CODE_DEFAULT_KEEP_RECENT_TOKENS;
  const keepRecentTokens = Math.max(0, Math.min(requestedKeepRecentTokens, Math.floor(contextWindow * 0.5)));

  const strategy = keepLatestTodoTurn(
    strategyKind === "om" || strategyKind === "observational-memory"
      ? createObservationalMemoryCompactionStrategy({
          keepRecentEntries,
        })
      : createCodingCompactionStrategy({
          summaryProvider: async () => cache.get(sessionModel) ?? (await cache.prime(sessionModel)),
          model: sessionModel,
          keepRecentTokens,
        }),
  );

  let trigger: CompactionTrigger;
  if (cfg.trigger === "each_turn") {
    trigger = { type: "each_turn" };
  } else if (cfg.trigger === "threshold_tokens" || cfg.tokens !== undefined) {
    trigger = { type: "threshold_tokens", tokens: cfg.tokens ?? 20_000 };
  } else if (cfg.trigger === "threshold_entries" || cfg.entries !== undefined) {
    trigger = { type: "threshold_entries", entries: cfg.entries ?? 50 };
  } else if (cfg.trigger === "input_ratio" || cfg.ratio !== undefined) {
    // Explicit ratio: the core trigger fails loudly when the model declares no window (host config error).
    trigger = { type: "input_ratio", ratio: cfg.ratio ?? PRISM_CODE_DEFAULT_COMPACTION_RATIO };
  } else if (canResolveInputCap(sessionModel)) {
    trigger = { type: "input_ratio", ratio: PRISM_CODE_DEFAULT_COMPACTION_RATIO };
  } else {
    // Model without a usable input cap (no window, or output + reserve eats the whole window): the
    // default ratio cannot resolve, so compact on a fixed input-token budget instead of failing the run.
    trigger = { type: "threshold_tokens", tokens: PRISM_CODE_DEFAULT_COMPACTION_TOKENS };
  }

  return {
    strategy,
    trigger,
    keepRecentEntries,
    ...(cfg.maxSummaryChars ? { maxSummaryChars: cfg.maxSummaryChars } : {}),
  };
}

/**
 * Resolves default tool result folding options for Prism Code.
 * Large tool outputs (>4KB) older than 2 turns are summarized into compact placeholders.
 */
export function resolvePrismCodeToolResultFold(): ToolResultFoldOptions {
  return {
    minAgeTurns: PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS,
    minBytes: PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES,
    maxSummaryBytes: PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES,
    summarize: (input) =>
      capToolResultSummary(
        `[Folded output of ${input.toolName} (${input.text.length} chars)]\n${input.text.slice(0, 300)}...`,
        PRISM_CODE_DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES,
      ),
  };
}

/**
 * Resolves default context budget for Prism Code.
 * Sets `maxInputTokens` to 95% of the model context window to demote non-essential items
 * rather than throwing a provider context overflow.
 */
export function resolvePrismCodeContextBudget(sessionModel: ModelConfig): ContextBudget {
  const window = sessionModel.limits?.contextWindow ?? 32_000;
  return {
    maxInputTokens: Math.floor(window * 0.95),
    reportOmissions: true,
  };
}
