import type { JsonObject, ModelConfig, ProviderRequest, ProviderRequestOptions } from "../contracts.js";
import { mergeProviderRequestOptions } from "./provider-request-policy.js";

/**
 * Portable thinking / reasoning effort levels shared across first-party providers.
 * Model-dependent legality (which values a given model accepts) stays provider-owned.
 */
export const THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Compat mapping families used by ≥2 packages, or explicit no-op for host-owned adapters.
 * Provider packages keep unique escape hatches (budgets, keep/all, tool_stream) local.
 */
export type ThinkingCompatFamily = "openai_reasoning" | "reasoning_effort" | "thinking_type" | "google" | "output_config_effort" | "noop";

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

const LEVEL_RANK: Readonly<Record<ThinkingLevel, number>> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

function isThinkingFamily(value: unknown): value is ThinkingCompatFamily {
  return (
    typeof value === "string" &&
    (value === "openai_reasoning" ||
      value === "reasoning_effort" ||
      value === "thinking_type" ||
      value === "google" ||
      value === "output_config_effort" ||
      value === "noop")
  );
}

function thinkingLevelRank(level: string): number | undefined {
  return isThinkingLevel(level) ? LEVEL_RANK[level] : undefined;
}

/**
 * Parse a host thinking-level value without guessing: known levels canonicalize to
 * `ThinkingLevel`, unknown non-empty strings pass through as opaque `{ opaque }`
 * (forward-compat passthrough), invalid/empty/non-string input fails closed.
 */
export function parseThinkingLevel(value: unknown): ThinkingLevel | { readonly opaque: string } | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeThinkingLevel(value);
  if (!normalized) return undefined;
  return isThinkingLevel(normalized) ? normalized : { opaque: normalized };
}

/**
 * Normalize a host thinkingLevel string. Known levels are lowercased; other non-empty
 * strings pass through as opaque effort values for forward-compatible provider fields.
 */
export function normalizeThinkingLevel(level: string): ThinkingLevel | string | undefined {
  const normalized = level.trim().toLowerCase();
  if (!normalized) return undefined;
  return isThinkingLevel(normalized) ? normalized : normalized;
}

/**
 * Build the `ProviderRequestOptions.compat` patch for a shared thinking level.
 * Does not invent a second options tree — providers keep reading official fields from `compat`.
 */
export function thinkingCompatFor(family: ThinkingCompatFamily, level: ThinkingLevel | string): JsonObject {
  const normalized = typeof level === "string" ? normalizeThinkingLevel(level) : level;
  if (!normalized || family === "noop") return {};

  switch (family) {
    case "openai_reasoning":
      return { reasoning: { effort: normalized } };
    case "reasoning_effort":
      return { reasoning_effort: normalized };
    case "thinking_type":
      return { thinking: { type: normalized === "none" ? "disabled" : "enabled" } };
    case "google":
      return { thinkingLevel: normalized };
    case "output_config_effort":
      return { output_config: { effort: normalized } };
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

/**
 * Merge a shared thinking level into `providerOptions.compat` for the given family.
 * Per-turn patches win over prior compat via {@link mergeProviderRequestOptions}.
 */
export function applyThinkingLevel(
  options: ProviderRequestOptions | undefined,
  level: ThinkingLevel | string,
  family: ThinkingCompatFamily = "reasoning_effort",
): ProviderRequestOptions {
  const normalized = normalizeThinkingLevel(String(level));
  if (!normalized || family === "noop") return options ?? {};

  const patch = thinkingCompatFor(family, normalized);
  if (
    family === "openai_reasoning" &&
    options?.compat?.reasoning &&
    typeof options.compat.reasoning === "object" &&
    !Array.isArray(options.compat.reasoning)
  ) {
    return mergeProviderRequestOptions(options, {
      compat: {
        reasoning: {
          ...(options.compat.reasoning as JsonObject),
          ...(patch.reasoning as JsonObject),
        },
      },
    })!;
  }

  return mergeProviderRequestOptions(options, { compat: patch })!;
}

/**
 * Declared portable thinking levels for a model, if any (ascending ladder order).
 * `undefined` means the provider declares no subset — forward-compat passthrough.
 */
export function thinkingLevelsForModel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">): readonly string[] | undefined {
  return model.capabilities?.thinkingLevels;
}

/**
 * Strict declared-set membership (hosts fail closed on unknown levels).
 * A model that declares no levels supports any value (forward-compat passthrough).
 */
export function isSupportedThinkingLevel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">, level: unknown): boolean {
  const parsed = parseThinkingLevel(level);
  if (!parsed) return false;
  const declared = thinkingLevelsForModel(model);
  if (!declared || declared.length === 0) return true;
  const value = typeof parsed === "string" ? parsed : parsed.opaque;
  return declared.includes(value);
}

/**
 * Snap a portable level to a model's declared set (design record §2):
 * in-set → unchanged; below the declared minimum → up to the minimum
 * (never silently disable what cannot be disabled); otherwise nearest declared
 * level by ladder distance with ties breaking up; undeclared levels and
 * undeclared sets pass through. Provider-documented snap tables
 * (deepseek, Z.AI GLM-5.2, clinepass slots) override this generic fallback
 * inside their own resolvers.
 */
export function snapThinkingLevel(
  model: Pick<ModelConfig, "provider" | "compat" | "capabilities">,
  level: ThinkingLevel | string,
): ThinkingLevel | string {
  const normalized = normalizeThinkingLevel(String(level));
  if (!normalized) return String(level);
  const declared = thinkingLevelsForModel(model);
  if (!declared || declared.length === 0) return normalized;
  if (declared.includes(normalized)) return normalized;

  const rank = thinkingLevelRank(normalized);
  const ranked = declared
    .map((entry) => ({ entry, rank: thinkingLevelRank(entry) }))
    .filter((entry): entry is { entry: string; rank: number } => entry.rank != null);
  if (rank == null || ranked.length === 0) return normalized;

  const minRank = Math.min(...ranked.map(({ rank: r }) => r));
  if (rank < minRank) return ranked.find(({ rank: r }) => r === minRank)!.entry;

  let best = ranked[0].entry;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const { entry, rank: candidateRank } of ranked) {
    const distance = Math.abs(candidateRank - rank);
    if (distance < bestDistance || (distance === bestDistance && candidateRank > bestRank)) {
      best = entry;
      bestDistance = distance;
      bestRank = candidateRank;
    }
  }
  return best;
}

/**
 * Model-aware thinking-level application (design record §5). Resolves the family
 * stamp-first (`compat.thinkingFamily` → inference → `capabilities.reasoning`),
 * snaps the level to the model's declared set, and merges the compat patch
 * per-turn-wins. Returns options unchanged for non-reasoning models — never
 * invents a field where the model declares no thinking support.
 */
export function applyThinkingLevelForModel(
  options: ProviderRequestOptions | undefined,
  level: ThinkingLevel | string,
  model: Pick<ModelConfig, "provider" | "compat" | "capabilities">,
): ProviderRequestOptions {
  const normalized = normalizeThinkingLevel(String(level));
  if (!normalized) return options ?? {};

  const family =
    model.compat?.thinkingFamily != null && isThinkingFamily(model.compat.thinkingFamily)
      ? model.compat.thinkingFamily
      : thinkingFamilyForModel(model);
  if (family === "noop") return options ?? {};

  return applyThinkingLevel(options, snapThinkingLevel(model, normalized), family);
}

/**
 * Best-effort family inference from model metadata without a second options tree.
 * Prefer an explicit `compat.thinkingFamily` stamp in host/use-case workers when
 * the provider is known; inference is the fallback (stamp-first).
 *
 * Heuristics (ordered):
 * 1. `compat.thinkingFamily` stamp → itself
 * 2. Existing `compat.thinking` object → `thinking_type`
 * 3. Existing `compat.thinkingConfig` object/boolean → `google`
 * 4. Existing `compat.reasoning` → `openai_reasoning`
 * 5. Existing `compat.reasoning_effort` → `reasoning_effort`
 * 6. Provider id starting with `openai` → `openai_reasoning`
 * 7. Provider id `neuralwatt` → `reasoning_effort`
 * 8. `capabilities.reasoning` → `reasoning_effort` (portable string field)
 * 9. Else `noop`
 */
export function thinkingFamilyForModel(model: Pick<ModelConfig, "provider" | "compat" | "capabilities">): ThinkingCompatFamily {
  const stamp = model.compat?.thinkingFamily;
  if (isThinkingFamily(stamp)) return stamp;

  const compat = model.compat ?? {};
  if (compat.thinking != null && typeof compat.thinking === "object") return "thinking_type";
  if (compat.thinkingConfig != null && (typeof compat.thinkingConfig === "object" || typeof compat.thinkingConfig === "boolean")) {
    return "google";
  }
  if (compat.reasoning != null) return "openai_reasoning";
  if (compat.reasoning_effort != null) return "reasoning_effort";

  const provider = model.provider.trim().toLowerCase();
  if (provider === "openai" || provider.startsWith("openai")) return "openai_reasoning";
  if (provider === "neuralwatt") return "reasoning_effort";
  if (model.capabilities?.reasoning) return "reasoning_effort";
  return "noop";
}

/**
 * Standard provider-owned compat keys stripped before request body spread so
 * resolved options/flags are not overwritten by raw passthrough.
 */
export const DEFAULT_OWNED_COMPAT_KEYS = [
  "route",
  "thinking",
  "reasoning",
  "reasoning_effort",
  "reasoningEffort",
  "preserveThinking",
  "preserve_thinking",
  "output_config",
  "thinkingFamily",
  "effortLevels",
] as const;

/**
 * Resolves whether to replay historical thinking blocks on the next request.
 * Request compat wins over model compat; defaults to true when reasoning is declared.
 */
export function resolvePreserveThinking(request: ProviderRequest): boolean {
  const value =
    request.options?.compat?.preserveThinking ??
    request.options?.compat?.preserve_thinking ??
    request.model.compat?.preserveThinking ??
    request.model.compat?.preserve_thinking;
  if (value === false) return false;
  if (value === true) return true;
  return request.model.capabilities?.reasoning === true;
}

export const preserveThinking = resolvePreserveThinking;

/**
 * Resolves reasoning effort string snapped to declared thinking levels.
 * Request compat wins over model compat. Undeclared levels pass through.
 */
export function resolveReasoningEffort(request: ProviderRequest): string | undefined {
  const effort =
    request.options?.compat?.reasoning_effort ??
    request.options?.compat?.reasoningEffort ??
    request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort.trim()) return undefined;
  const normalized = effort.trim().toLowerCase();
  const declared =
    request.model.capabilities?.thinkingLevels ??
    (request.model.compat?.effortLevels as readonly string[] | undefined);
  if (!declared || declared.length === 0) return normalized;
  const view: Pick<ModelConfig, "provider" | "compat" | "capabilities"> = {
    provider: request.model.provider,
    compat: request.model.compat,
    capabilities: { ...request.model.capabilities, thinkingLevels: declared },
  };
  return String(snapThinkingLevel(view, normalized));
}

export const reasoningEffort = resolveReasoningEffort;

/**
 * Resolves upstream thinking object (e.g. `{ type: "enabled" }` or `{ type: "disabled" }`).
 */
export function resolveThinkingObject(request: ProviderRequest): JsonObject | undefined {
  const value = request.options?.compat?.thinking ?? request.model.compat?.thinking;
  if (value === false) return { type: "disabled" };
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return value === true ? { type: "enabled" } : undefined;
}

export const thinkingObject = resolveThinkingObject;

/**
 * Resolves upstream OpenAI-style reasoning object with effort snapped to declared levels.
 */
export function resolveReasoningObject(request: ProviderRequest): JsonObject | undefined {
  const fromModel = asJsonObject(request.model.compat?.reasoning);
  const fromOptions = asJsonObject(request.options?.compat?.reasoning);
  if (!fromModel && !fromOptions) return undefined;
  const merged: Record<string, unknown> = { ...fromModel, ...fromOptions };
  const effort = merged.effort;
  if (typeof effort === "string" && effort.trim()) {
    const normalized = effort.trim().toLowerCase();
    const declared =
      request.model.capabilities?.thinkingLevels ??
      (request.model.compat?.effortLevels as readonly string[] | undefined);
    if (declared && declared.length > 0) {
      const view: Pick<ModelConfig, "provider" | "compat" | "capabilities"> = {
        provider: request.model.provider,
        compat: request.model.compat,
        capabilities: { ...request.model.capabilities, thinkingLevels: declared },
      };
      merged.effort = String(snapThinkingLevel(view, normalized));
    } else {
      merged.effort = normalized;
    }
  }
  const clean = Object.fromEntries(Object.entries(merged).filter(([, item]) => item !== undefined)) as JsonObject;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export const reasoningObject = resolveReasoningObject;

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

/**
 * Strips provider-owned compat keys from request options before serializing to wire.
 * Can be called with (compat, extraKeys) or with (keys) returning a function.
 */
export function stripOwnedCompat(keys?: readonly string[]): (compat: JsonObject | undefined) => JsonObject | undefined;
export function stripOwnedCompat(compat: JsonObject | undefined, extraKeys?: readonly string[]): JsonObject | undefined;
export function stripOwnedCompat(
  arg1?: JsonObject | readonly string[],
  arg2?: readonly string[],
): JsonObject | undefined | ((compat: JsonObject | undefined) => JsonObject | undefined) {
  if (Array.isArray(arg1) || arg1 === undefined) {
    const customKeys = arg1 as readonly string[] | undefined;
    return (compat: JsonObject | undefined) => doStripCompat(compat, customKeys);
  }
  return doStripCompat(arg1 as JsonObject | undefined, arg2);
}

function doStripCompat(compat: JsonObject | undefined, extraKeys?: readonly string[]): JsonObject | undefined {
  if (!compat) return undefined;
  const stripSet = new Set<string>([...DEFAULT_OWNED_COMPAT_KEYS, ...(extraKeys ?? [])]);
  const entries = Object.entries(compat).filter(([key]) => !stripSet.has(key));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

