import type { ModelConfig, ProviderRequestOptions, SettingsProvider } from "@arnilo/prism";
import { DEFAULT_RECALL_PAGE_LIMIT, HARD_MAX_WORKER_TURNS } from "./limits.js";

export interface ObservationalMemoryObservationSettings {
  readonly messageTokens: number;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryReflectionSettings {
  readonly observationTokens: number;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export type ObservationalMemoryDropperPolicy = "model" | "lowest-relevance";

export interface ObservationalMemoryDropperSettings {
  readonly targetTokens: number;
  readonly policy: ObservationalMemoryDropperPolicy;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryContextSettings {
  readonly recentMessages: number;
  readonly recentMessageMaxTokens?: number;
  readonly compactAfterTokens: number;
  readonly observationsPoolMaxTokens: number;
  readonly observationsPoolTargetTokens: number;
}

export interface ObservationalMemoryRetrievalSettings {
  readonly pageLimit: number;
}

export interface ObservationalMemorySettings {
  readonly observation: ObservationalMemoryObservationSettings;
  readonly reflection: ObservationalMemoryReflectionSettings;
  readonly dropper: ObservationalMemoryDropperSettings;
  readonly context: ObservationalMemoryContextSettings;
  readonly retrieval: ObservationalMemoryRetrievalSettings;
  readonly agentMaxTurns: number;
  readonly passive: boolean;
  readonly debugLog: boolean;
}

export interface ObservationalMemoryObservationSettingsInput {
  readonly messageTokens?: number;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryReflectionSettingsInput {
  readonly observationTokens?: number;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryDropperSettingsInput {
  readonly targetTokens?: number;
  readonly policy?: ObservationalMemoryDropperPolicy;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryContextSettingsInput {
  readonly recentMessages?: number;
  readonly recentMessageMaxTokens?: number;
  readonly compactAfterTokens?: number;
  readonly observationsPoolMaxTokens?: number;
  readonly observationsPoolTargetTokens?: number;
}

export interface ObservationalMemoryRetrievalSettingsInput {
  readonly pageLimit?: number;
}

/** @deprecated Pre-0.0.19 flat keys map to nested settings; conflicting flat+nested values throw. */
export interface ObservationalMemorySettingsInput {
  readonly observeAfterTokens?: number;
  readonly reflectAfterTokens?: number;
  readonly compactAfterTokens?: number;
  readonly keepRecentEntries?: number;
  readonly recentMessageMaxTokens?: number;
  readonly observationsPoolMaxTokens?: number;
  readonly observationsPoolTargetTokens?: number;
  readonly workerModel?: ModelConfig;
  readonly thinkingLevel?: string;
  readonly requireExplicitModel?: boolean;
  readonly agentMaxTurns?: number;
  readonly passive?: boolean;
  readonly debugLog?: boolean;
  readonly observation?: ObservationalMemoryObservationSettingsInput;
  readonly reflection?: ObservationalMemoryReflectionSettingsInput;
  readonly dropper?: ObservationalMemoryDropperSettingsInput;
  readonly context?: ObservationalMemoryContextSettingsInput;
  readonly retrieval?: ObservationalMemoryRetrievalSettingsInput;
}

export const defaultObservationalMemorySettings: ObservationalMemorySettings = {
  observation: { messageTokens: 10_000 },
  reflection: { observationTokens: 20_000 },
  dropper: { targetTokens: 10_000, policy: "model" },
  context: {
    recentMessages: 8,
    compactAfterTokens: 81_000,
    observationsPoolMaxTokens: 20_000,
    observationsPoolTargetTokens: 10_000,
  },
  retrieval: { pageLimit: DEFAULT_RECALL_PAGE_LIMIT },
  agentMaxTurns: 16,
  passive: false,
  debugLog: false,
};

export async function resolveObservationalMemorySettings(
  settings?: SettingsProvider,
  overrides: ObservationalMemorySettingsInput = {},
): Promise<ObservationalMemorySettings> {
  const fromProvider = (await settings?.get<ObservationalMemorySettingsInput>("observational-memory")) ?? {};
  const merged = { ...fromProvider, ...overrides };
  conflict(merged.observeAfterTokens !== undefined && merged.observation?.messageTokens !== undefined, "observeAfterTokens");
  conflict(merged.reflectAfterTokens !== undefined && merged.reflection?.observationTokens !== undefined, "reflectAfterTokens");
  conflict(merged.compactAfterTokens !== undefined && merged.context?.compactAfterTokens !== undefined, "compactAfterTokens");
  conflict(merged.keepRecentEntries !== undefined && merged.context?.recentMessages !== undefined, "keepRecentEntries");
  conflict(merged.recentMessageMaxTokens !== undefined && merged.context?.recentMessageMaxTokens !== undefined, "recentMessageMaxTokens");
  conflict(
    merged.observationsPoolMaxTokens !== undefined && merged.context?.observationsPoolMaxTokens !== undefined,
    "observationsPoolMaxTokens",
  );
  conflict(
    merged.observationsPoolTargetTokens !== undefined && merged.context?.observationsPoolTargetTokens !== undefined,
    "observationsPoolTargetTokens",
  );
  conflict(
    merged.workerModel !== undefined &&
      (merged.observation?.model !== undefined || merged.reflection?.model !== undefined || merged.dropper?.model !== undefined),
    "workerModel",
  );
  const poolTarget = positive(
    merged.context?.observationsPoolTargetTokens ?? merged.observationsPoolTargetTokens,
    defaultObservationalMemorySettings.context.observationsPoolTargetTokens,
  );
  return {
    observation: {
      messageTokens: positive(
        merged.observation?.messageTokens ?? merged.observeAfterTokens,
        defaultObservationalMemorySettings.observation.messageTokens,
      ),
      model: merged.observation?.model ?? merged.workerModel,
      instruction: merged.observation?.instruction,
      thinkingLevel: merged.observation?.thinkingLevel ?? merged.thinkingLevel,
      providerOptions: merged.observation?.providerOptions,
      requireExplicitModel: (merged.observation?.requireExplicitModel ?? merged.requireExplicitModel === true) ? true : undefined,
    },
    reflection: {
      observationTokens: positive(
        merged.reflection?.observationTokens ?? merged.reflectAfterTokens,
        defaultObservationalMemorySettings.reflection.observationTokens,
      ),
      model: merged.reflection?.model ?? merged.workerModel,
      instruction: merged.reflection?.instruction,
      thinkingLevel: merged.reflection?.thinkingLevel ?? merged.thinkingLevel,
      providerOptions: merged.reflection?.providerOptions,
      requireExplicitModel: (merged.reflection?.requireExplicitModel ?? merged.requireExplicitModel === true) ? true : undefined,
    },
    dropper: {
      targetTokens: positive(merged.dropper?.targetTokens ?? poolTarget, poolTarget),
      policy: merged.dropper?.policy === "lowest-relevance" ? "lowest-relevance" : "model",
      model: merged.dropper?.model ?? merged.workerModel,
      instruction: merged.dropper?.instruction,
      thinkingLevel: merged.dropper?.thinkingLevel ?? merged.thinkingLevel,
      providerOptions: merged.dropper?.providerOptions,
      requireExplicitModel: (merged.dropper?.requireExplicitModel ?? merged.requireExplicitModel === true) ? true : undefined,
    },
    context: {
      recentMessages: nonNegativeInt(
        merged.context?.recentMessages ?? merged.keepRecentEntries,
        defaultObservationalMemorySettings.context.recentMessages,
      ),
      recentMessageMaxTokens: optionalPositive(merged.context?.recentMessageMaxTokens ?? merged.recentMessageMaxTokens),
      compactAfterTokens: positive(
        merged.context?.compactAfterTokens ?? merged.compactAfterTokens,
        defaultObservationalMemorySettings.context.compactAfterTokens,
      ),
      observationsPoolMaxTokens: positive(
        merged.context?.observationsPoolMaxTokens ?? merged.observationsPoolMaxTokens,
        defaultObservationalMemorySettings.context.observationsPoolMaxTokens,
      ),
      observationsPoolTargetTokens: poolTarget,
    },
    retrieval: {
      pageLimit: recallPageLimit(merged.retrieval?.pageLimit),
    },
    agentMaxTurns: workerTurns(merged.agentMaxTurns ?? defaultObservationalMemorySettings.agentMaxTurns),
    passive: Boolean(merged.passive),
    debugLog: Boolean(merged.debugLog),
  };
}

function conflict(active: boolean, key: string): void {
  if (active) throw new Error(`Observational memory settings conflict: flat ${key} cannot be combined with nested override`);
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function optionalPositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function recallPageLimit(value: unknown): number {
  if (value === undefined) return defaultObservationalMemorySettings.retrieval.pageLimit;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new RangeError("retrieval.pageLimit must be a positive safe integer");
  }
  return value as number;
}

function workerTurns(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > HARD_MAX_WORKER_TURNS) {
    throw new RangeError(`agentMaxTurns must be a positive safe integer at most ${HARD_MAX_WORKER_TURNS}`);
  }
  return value as number;
}
