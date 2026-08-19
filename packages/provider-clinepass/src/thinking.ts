import type { JsonObject, ProviderRequest } from "@arnilo/prism";
import { normalizeThinkingLevel } from "@arnilo/prism";

export type ClinePassThinkingSlot = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ClinePassThinkingLevelMap = Readonly<Record<ClinePassThinkingSlot, string | null>>;

const GLM_MAP = map("none", null, "low", "medium", "high", "xhigh");
const KIMI_MAP = map(null, null, "low", "medium", "high", null);
const KIMI_K3_MAP = map(null, null, null, null, "max", null);
const DEEPSEEK_MAP = map("none", null, null, null, "high", "high");
const STANDARD_MAP = map("none", null, "low", "medium", "high", null);

export const CLINEPASS_THINKING_MAPS = {
  glm: GLM_MAP,
  kimi: KIMI_MAP,
  kimiK3: KIMI_K3_MAP,
  deepseek: DEEPSEEK_MAP,
  standard: STANDARD_MAP,
} as const;

function map(
  off: string | null,
  minimal: string | null,
  low: string | null,
  medium: string | null,
  high: string | null,
  xhigh: string | null,
): ClinePassThinkingLevelMap {
  return { off, minimal, low, medium, high, xhigh };
}

/** Portable level → ClinePass map slot. `none` is `off`; `max` uses the `high` slot (K3 → `max`, GLM stays off `max`). */
export function clinePassThinkingSlot(value: unknown): ClinePassThinkingSlot | undefined {
  if (value === false) return "off";
  if (value && typeof value === "object") {
    const type = (value as JsonObject).type;
    if (type === "disabled") return "off";
    if (type === "enabled") return "high";
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeThinkingLevel(value);
  if (!normalized) return undefined;
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "off";
  if (normalized === "max") return "high";
  if (normalized === "minimal" || normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "xhigh") {
    return normalized;
  }
  return undefined;
}

export function clinePassThinkingLevelMap(request: ProviderRequest): ClinePassThinkingLevelMap | undefined {
  const raw = request.model.compat?.thinkingLevelMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as ClinePassThinkingLevelMap;
}

/**
 * Per-model `reasoning_effort`. Unsupported slots (`null`) omit the field.
 * GLM `xhigh` is passed through; do not send `max` (upstream 500).
 */
export function clinePassReasoningEffort(request: ProviderRequest): string | undefined {
  const table = clinePassThinkingLevelMap(request);
  const requested = clinePassThinkingSlot(
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.options?.compat?.thinking,
  );
  const slot =
    requested ??
    (request.options?.cacheRetention === "none" ? "off" : (clinePassThinkingSlot(request.model.compat?.reasoning_effort) ?? "high"));
  if (!table) return slot === "off" ? undefined : slot;
  return table[slot] ?? undefined;
}
