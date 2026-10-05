import type { ModelConfig, RunOptions } from "@arnilo/prism";
import type { ProviderCache } from "../providers.js";

/**
 * The single active model + effort pair. The status footer mirrors it and every run derives its
 * options from it, so a switch has exactly one place to land (no duplicated selection state).
 */
export interface ActiveSelection {
  readonly model: ModelConfig;
  readonly effort: string;
}

/** True when the effort level should ride the run (off/unavailable/none are UI-only labels). */
export function effortForRun(effort: string): string | undefined {
  return effort === "off" || effort === "unavailable" || effort === "none" ? undefined : effort;
}

/** Run options derived from the active selection: model and effort. The agent's provider package serves the model's provider. */
export function selectionRunOptions(selection: ActiveSelection, _cache?: ProviderCache, base: RunOptions = {}): RunOptions {
  const effort = effortForRun(selection.effort);
  return {
    ...base,
    model: selection.model,
    ...(effort ? { thinkingLevel: effort } : {}),
  };
}
