import {
  type CompactionEntryData,
  type CompactionOptions,
  type CompactionTrigger,
  type Compactor,
  type ContextBudget,
  capToolResultSummary,
  type HookRegistrar,
  isCompactionEntryData,
  type ModelConfig,
  resolveInputCap,
  resolveShouldCompact,
  type ToolResultFoldOptions,
} from "@arnilo/prism";
import { todoPinnedEntryIds } from "@arnilo/prism-coding-tools/agent";
import { createCodingCompactor } from "@arnilo/prism-memory/compaction/llm";
import { createObservationalMemoryCompactor } from "@arnilo/prism-memory/compaction/observational-memory";
import type { PrismCodeCompactionConfig } from "./config.js";
import type { ProviderCache } from "./providers.js";

export const PRISM_CODE_DEFAULT_COMPACTION_RATIO = 0.8;
export const PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES = 8;
/** Mirrors the LLM compaction strategy default; capped to half the window so a real cut point always exists. */
export const PRISM_CODE_DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const PRISM_CODE_DEFAULT_CONTEXT_WINDOW = 32_000;
/** Fallback trigger budget for a model whose input cap cannot be resolved. */
export const PRISM_CODE_DEFAULT_COMPACTION_TOKENS = 20_000;
/** Fallback trigger for `threshold_entries`; matches the kernel's default auto-trigger threshold. */
export const PRISM_CODE_DEFAULT_COMPACTION_ENTRIES = 50;

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
function keepLatestTodoTurn(compactor: Compactor): Compactor {
  return {
    ...compactor,
    async compact(context) {
      const result = await compactor.compact(context);
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
 * Prism Code's resolved compaction: the sizing knobs, the `compaction` slot implementation, and the
 * `compaction.when` gate this config asks for. Roadmap §2.5: the implementation is the slot, the
 * auto trigger is the hook, and `CompactionOptions` only sizes them.
 */
export interface PrismCodeCompactionResolution {
  /** `AgentConfig.compaction`: sizing and threshold knobs only. */
  readonly options: CompactionOptions;
  /** `AgentConfig.slots.compaction`. */
  readonly compactor: Compactor;
  /** The auto trigger this config resolves; {@link registerTrigger} wires it to `compaction.when`. */
  readonly trigger: CompactionTrigger;
  /** Registers {@link trigger} as a `compaction.when` handler. */
  readonly registerTrigger: (hooks: HookRegistrar) => void;
}

/**
 * Resolves compaction for Prism Code. Returns `false` when the config disables it entirely.
 *
 * Supports:
 * - Coding (LLM-based) and OM (Observational Memory-based) compactors.
 * - Auto-compaction triggers: `input_ratio` (default 0.8), `each_turn`, `threshold_tokens`, `threshold_entries`.
 * - Explicit disabling via `compaction: false`.
 */
export function resolvePrismCodeCompaction(
  config: PrismCodeCompactionConfig | undefined,
  sessionModel: ModelConfig,
  cache: ProviderCache,
): false | PrismCodeCompactionResolution {
  if (config === false) return false;
  const cfg = config ?? {};
  const strategyKind = cfg.strategy ?? "coding";
  const keepRecentEntries = cfg.keepRecentEntries ?? PRISM_CODE_DEFAULT_KEEP_RECENT_ENTRIES;
  // The LLM compactors keep a token budget, not an entry count. Deriving it from the window keeps
  // the keep budget below the compact trigger, so compaction always has entries to summarize
  // (a window smaller than the compactor default would otherwise turn every compaction into a no-op).
  // A host may ask for a tighter (or larger) budget; the half-window cap still applies.
  const contextWindow = sessionModel.limits?.contextWindow ?? PRISM_CODE_DEFAULT_CONTEXT_WINDOW;
  const requestedKeepRecentTokens = cfg.keepRecentTokens ?? PRISM_CODE_DEFAULT_KEEP_RECENT_TOKENS;
  const keepRecentTokens = Math.max(0, Math.min(requestedKeepRecentTokens, Math.floor(contextWindow * 0.5)));

  const compactor = keepLatestTodoTurn(
    strategyKind === "om" || strategyKind === "observational-memory"
      ? createObservationalMemoryCompactor({
          keepRecentEntries,
        })
      : createCodingCompactor({
          summaryProvider: async () => cache.get(sessionModel) ?? (await cache.prime(sessionModel)),
          model: sessionModel,
          keepRecentTokens,
        }),
  );

  let trigger: CompactionTrigger;
  if (cfg.trigger === "each_turn") {
    trigger = { type: "each_turn" };
  } else if (cfg.trigger === "threshold_tokens" || cfg.tokens !== undefined) {
    trigger = { type: "threshold_tokens", tokens: cfg.tokens ?? PRISM_CODE_DEFAULT_COMPACTION_TOKENS };
  } else if (cfg.trigger === "threshold_entries" || cfg.entries !== undefined) {
    trigger = { type: "threshold_entries", entries: cfg.entries ?? PRISM_CODE_DEFAULT_COMPACTION_ENTRIES };
  } else if (cfg.trigger === "input_ratio" || cfg.ratio !== undefined) {
    // Explicit ratio: the gate fails loudly when the model declares no window (host config error).
    trigger = { type: "input_ratio", ratio: cfg.ratio ?? PRISM_CODE_DEFAULT_COMPACTION_RATIO };
  } else if (canResolveInputCap(sessionModel)) {
    trigger = { type: "input_ratio", ratio: PRISM_CODE_DEFAULT_COMPACTION_RATIO };
  } else {
    // Model without a usable input cap (no window, or output + reserve eats the whole window): the
    // default ratio cannot resolve, so compact on a fixed input-token budget instead of failing the run.
    trigger = { type: "threshold_tokens", tokens: PRISM_CODE_DEFAULT_COMPACTION_TOKENS };
  }

  return {
    options: {
      keepRecentEntries,
      ...(cfg.maxSummaryChars ? { maxSummaryChars: cfg.maxSummaryChars } : {}),
    },
    compactor,
    trigger,
    registerTrigger: (hooks) => {
      hooks.on(
        "compaction.when",
        async (payload, context) => {
          const compact = await resolveShouldCompact(
            { trigger },
            {
              sessionId: payload.sessionId,
              entryCount: payload.entryCount,
              ...(payload.turn === undefined ? {} : { turn: payload.turn }),
              estimateInputTokens: () => payload.estimatedTokens ?? 0,
              resolveInputCapTokens: () => resolveInputCap(undefined, sessionModel),
              signal: context.signal,
            },
          );
          return compact ? { compact: true } : undefined;
        },
        { id: "compaction-trigger" },
      );
    },
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
