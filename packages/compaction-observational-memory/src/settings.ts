import type { ModelConfig, SettingsProvider } from "@arnilo/prism";

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
    agentMaxTurns: Math.max(1, Math.floor(positive(merged.agentMaxTurns, defaultObservationalMemorySettings.agentMaxTurns))),
    passive: Boolean(merged.passive),
    debugLog: Boolean(merged.debugLog),
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
