import type { ModelConfig, ProviderRequest } from "@arnilo/prism";
import { snapThinkingLevel } from "@arnilo/prism";
import { xaiThinkingLevels } from "./models.js";

/** Reasoning models must replay prior thinking as `reasoning_content` or the prefix cache breaks. */
export function xaiReplayThinking(request: ProviderRequest): boolean {
  return request.model.capabilities?.reasoning === true;
}

/**
 * Official `reasoning_effort` — emitted only when the model has a declared ladder
 * (per-model table or host-registered `capabilities.thinkingLevels`). Host values
 * snap to that ladder (`none` floors up on grok-4.5/4.6 which cannot disable
 * reasoning); models without a ladder omit the field entirely.
 * @see https://docs.x.ai/developers/model-capabilities/text/reasoning
 */
export function xaiReasoningEffort(request: ProviderRequest): string | undefined {
  const raw =
    request.options?.compat?.reasoning_effort ??
    request.options?.compat?.reasoningEffort ??
    request.options?.compat?.effort ??
    request.model.compat?.reasoning_effort;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const declared = request.model.capabilities?.thinkingLevels ?? xaiThinkingLevels(request.model.model);
  if (!declared || declared.length === 0) return undefined;
  const view: Pick<ModelConfig, "provider" | "compat" | "capabilities"> = {
    provider: request.model.provider,
    compat: request.model.compat,
    capabilities: { ...request.model.capabilities, thinkingLevels: declared },
  };
  return String(snapThinkingLevel(view, raw.trim().toLowerCase()));
}
