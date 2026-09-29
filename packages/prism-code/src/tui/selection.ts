import type { AIProvider, ModelConfig, ProviderResolver, RunOptions } from "@arnilo/prism";
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

/** Synchronous `ProviderResolver` over a cache; core calls it per run, before the provider turn. */
export function providerSourceFor(cache?: ProviderCache): ProviderResolver | undefined {
  return cache ? (model: ModelConfig): AIProvider | undefined => cache.get(model) : undefined;
}

/** Run options derived from the active selection: model, provider source, and effort. */
export function selectionRunOptions(selection: ActiveSelection, cache?: ProviderCache, base: RunOptions = {}): RunOptions {
  const effort = effortForRun(selection.effort);
  return {
    ...base,
    model: selection.model,
    ...(providerSourceFor(cache) ? { providerSource: providerSourceFor(cache) } : {}),
    ...(effort ? { thinkingLevel: effort } : {}),
  };
}
