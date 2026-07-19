import type { ModelConfig, SettingsProvider } from "@arnilo/prism";
import { HARD_MAX_WORKER_TURNS } from "./limits.js";

export interface ObservationalMemorySettings {
  readonly observeAfterTokens: number;
  readonly reflectAfterTokens: number;
  readonly compactAfterTokens: number;
  readonly observationsPoolMaxTokens: number;
  readonly observationsPoolTargetTokens: number;
  readonly agentMaxTurns: number;
  readonly passive: boolean;
  readonly debugLog: boolean;
  readonly workerModel?: ModelConfig;
  readonly thinkingLevel?: string;
  /** When true, skip session-model fallback (runtime still needs an explicit workerModel). */
  readonly requireExplicitModel?: boolean;
}

export const defaultObservationalMemorySettings: ObservationalMemorySettings = {
  observeAfterTokens: 10_000,
  reflectAfterTokens: 20_000,
  compactAfterTokens: 81_000,
  observationsPoolMaxTokens: 20_000,
  observationsPoolTargetTokens: 10_000,
  agentMaxTurns: 16,
  passive: false,
  debugLog: false,
};

export type ObservationalMemorySettingsInput = Partial<ObservationalMemorySettings>;

export async function resolveObservationalMemorySettings(settings?: SettingsProvider, overrides: ObservationalMemorySettingsInput = {}): Promise<ObservationalMemorySettings> {
  const fromProvider = await settings?.get<ObservationalMemorySettingsInput>("observational-memory") ?? {};
  const merged = { ...defaultObservationalMemorySettings, ...fromProvider, ...overrides };
  return {
    ...merged,
    observeAfterTokens: positive(merged.observeAfterTokens, defaultObservationalMemorySettings.observeAfterTokens),
    reflectAfterTokens: positive(merged.reflectAfterTokens, defaultObservationalMemorySettings.reflectAfterTokens),
    compactAfterTokens: positive(merged.compactAfterTokens, defaultObservationalMemorySettings.compactAfterTokens),
    observationsPoolMaxTokens: positive(merged.observationsPoolMaxTokens, defaultObservationalMemorySettings.observationsPoolMaxTokens),
    observationsPoolTargetTokens: positive(merged.observationsPoolTargetTokens, defaultObservationalMemorySettings.observationsPoolTargetTokens),
    agentMaxTurns: workerTurns(merged.agentMaxTurns),
    passive: Boolean(merged.passive),
    debugLog: Boolean(merged.debugLog),
    requireExplicitModel: merged.requireExplicitModel === true ? true : undefined,
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function workerTurns(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > HARD_MAX_WORKER_TURNS) {
    throw new RangeError(`agentMaxTurns must be a positive safe integer at most ${HARD_MAX_WORKER_TURNS}`);
  }
  return value as number;
}
