import type { JsonObject, ModelConfig, ProviderRequestOptions } from "./contracts.js";
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
export type ThinkingCompatFamily =
  | "openai_reasoning"
  | "reasoning_effort"
  | "thinking_type"
  | "noop";

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
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
  if (family === "openai_reasoning" && options?.compat?.reasoning && typeof options.compat.reasoning === "object" && !Array.isArray(options.compat.reasoning)) {
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
 * Best-effort family inference from model metadata without a second options tree.
 * Prefer an explicit family in hosts/use-case workers when the provider is known.
 *
 * Heuristics (ordered):
 * 1. Existing `compat.thinking` object → `thinking_type`
 * 2. Existing `compat.reasoning` → `openai_reasoning`
 * 3. Existing `compat.reasoning_effort` → `reasoning_effort`
 * 4. Provider id starting with `openai` → `openai_reasoning`
 * 5. Provider id `neuralwatt` → `reasoning_effort`
 * 6. `capabilities.reasoning` → `reasoning_effort` (portable string field)
 * 7. Else `noop`
 */
export function thinkingFamilyForModel(
  model: Pick<ModelConfig, "provider" | "compat" | "capabilities">,
): ThinkingCompatFamily {
  const compat = model.compat ?? {};
  if (compat.thinking != null && typeof compat.thinking === "object") return "thinking_type";
  if (compat.reasoning != null) return "openai_reasoning";
  if (compat.reasoning_effort != null) return "reasoning_effort";

  const provider = model.provider.trim().toLowerCase();
  if (provider === "openai" || provider.startsWith("openai")) return "openai_reasoning";
  if (provider === "neuralwatt") return "reasoning_effort";
  if (model.capabilities?.reasoning) return "reasoning_effort";
  return "noop";
}
