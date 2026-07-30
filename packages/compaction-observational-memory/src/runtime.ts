import type {
  AgentSession,
  AIProvider,
  CredentialRequest,
  CredentialValueSource,
  ModelConfig,
  ProviderRequestOptions,
  SessionEntry,
  SettingsProvider,
} from "@arnilo/prism";
import { createSessionEntry, redactSecrets, resolveCredentialValue, resolveUseCaseModel, useCaseCredentialProviderId } from "@arnilo/prism";
import {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  observationsUncoveredByReflection,
  unscannedEntries,
} from "./coverage-helpers.js";
import { activeObservations, foldObservationalMemoryLedger } from "./ledger.js";
import { type MemoryWorkerLimitOptions, type ResolvedMemoryWorkerLimits, resolveMemoryWorkerLimits, truncateWorkerText } from "./limits.js";
import { type ObservationalMemorySettings, type ObservationalMemorySettingsInput, resolveObservationalMemorySettings } from "./settings.js";
import { OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "./types.js";
import { dropObservationsToTarget, runDropper } from "./workers/dropper.js";
import { runObserver } from "./workers/observer.js";
import { runReflector } from "./workers/reflector.js";

export interface ObservationalMemoryWorkerRuntimeConfig {
  readonly provider: AIProvider;
  readonly model?: ModelConfig;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryAppendOptions {
  readonly expectedParentId?: string;
}

export interface ObservationalMemoryRuntimeOptions {
  readonly session: AgentSession;
  readonly appendEntry: (entry: SessionEntry, options?: ObservationalMemoryAppendOptions) => Promise<void>;
  readonly observation?: ObservationalMemoryWorkerRuntimeConfig;
  readonly reflection?: ObservationalMemoryWorkerRuntimeConfig;
  readonly dropper?: ObservationalMemoryWorkerRuntimeConfig;
  /** @deprecated use observation/reflection/dropper providers */
  readonly workerProvider?: AIProvider;
  /** @deprecated use observation/reflection/dropper models */
  readonly workerModel?: ModelConfig;
  readonly sessionModel?: ModelConfig;
  readonly requireExplicitModel?: boolean;
  readonly providerOptions?: ProviderRequestOptions;
  readonly settings?: SettingsProvider;
  readonly overrides?: ObservationalMemorySettingsInput;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly secrets?: readonly (string | undefined)[];
  readonly maxWorkerTurns?: number;
  readonly maxWorkerToolCallsPerTurn?: number;
  readonly maxWorkerToolCalls?: number;
  readonly maxWorkerArgumentBytes?: number;
  readonly maxWorkerResultBytes?: number;
  readonly maxWorkerMessageBytes?: number;
  readonly maxWorkerErrorBytes?: number;
  readonly debug?: (message: string, data?: unknown) => void;
  readonly signal?: AbortSignal;
  readonly isRunActive?: () => boolean;
}

export interface ObservationalMemoryRuntime {
  readonly flush: (options?: ObservationalMemoryFlushOptions) => Promise<ObservationalMemoryFlushResult>;
  readonly status: () => ObservationalMemoryRuntimeStatus;
}

export interface ObservationalMemoryRuntimeStatus {
  readonly inFlight: boolean;
  readonly lastError?: string;
}

export interface ObservationalMemoryFlushOptions {
  readonly fullReflectionRebuild?: boolean;
}

export interface ObservationalMemoryFlushResult {
  readonly observations: number;
  readonly reflections: number;
  readonly dropped: number;
  readonly skipped?: string;
}

export function createObservationalMemoryRuntime(options: ObservationalMemoryRuntimeOptions): ObservationalMemoryRuntime {
  if ("store" in (options as object))
    throw new Error("Observational memory runtime requires appendEntry bound to the owning session store, not a separate store option");
  const configuredWorkerLimits = resolveMemoryWorkerLimits(runtimeLimitOptions(options));
  let inFlight = false;
  let lastError: string | undefined;

  return {
    status: () => ({ inFlight, lastError }),
    async flush(flushOptions?: ObservationalMemoryFlushOptions) {
      if (inFlight) return { observations: 0, reflections: 0, dropped: 0, skipped: "in_flight" };
      inFlight = true;
      try {
        const result = await flush(options, configuredWorkerLimits, flushOptions);
        lastError = undefined;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Observational memory runtime failed";
        lastError =
          truncateWorkerText(redactSecrets(message, options.secrets ?? []), configuredWorkerLimits.maxErrorBytes) ||
          "Observational memory runtime failed";
        options.debug?.("observational-memory:error", lastError);
        return { observations: 0, reflections: 0, dropped: 0, skipped: "error" };
      } finally {
        inFlight = false;
      }
    },
  };
}

async function flush(
  options: ObservationalMemoryRuntimeOptions,
  configuredWorkerLimits: ResolvedMemoryWorkerLimits,
  flushOptions: ObservationalMemoryFlushOptions = {},
): Promise<ObservationalMemoryFlushResult> {
  if (options.isRunActive?.()) return { observations: 0, reflections: 0, dropped: 0, skipped: "run_active" };
  const settings = await resolveObservationalMemorySettings(options.settings, options.overrides);
  const workerLimits = { ...configuredWorkerLimits, maxTurns: options.maxWorkerTurns ?? settings.agentMaxTurns };
  if (settings.passive) return { observations: 0, reflections: 0, dropped: 0, skipped: "passive" };

  const entries = await options.session.entries();
  const ledger = foldObservationalMemoryLedger(entries);
  const pending = unscannedEntries(entries, ledger.latestObservationCoverageId);
  const eligibleSources = eligibleObservationSources(pending);
  const eligibleTokens = eligibleObservationTokenCount(eligibleSources);
  const lastScannedId = pending.at(-1)?.id;
  let observationCount = 0;
  let reflectionCount = 0;
  let dropCount = 0;

  if (pending.length && lastScannedId) {
    if (!eligibleSources.length) {
      await appendCustom(options, {
        type: OBSERVATIONS_RECORDED,
        observations: [],
        coversUpToId: lastScannedId,
      });
    } else if (eligibleTokens >= settings.observation.messageTokens) {
      const observer = await resolveWorker("observation", options, settings);
      if (!observer) return { observations: 0, reflections: 0, dropped: 0, skipped: "missing_model" };
      const secrets = workerSecrets(observer, options);
      if (observer.missingCredentials) return { observations: 0, reflections: 0, dropped: 0, skipped: "missing_credentials" };
      const observations = await runObserver({
        entries: eligibleSources,
        provider: observer.provider,
        model: observer.model,
        ...workerLimits,
        providerOptions: observer.providerOptions,
        thinkingLevel: observer.thinkingLevel,
        instruction: settings.observation.instruction,
        secrets,
        signal: options.signal,
      });
      await appendCustom(options, {
        type: OBSERVATIONS_RECORDED,
        observations: JSON.parse(redactSecrets(JSON.stringify(observations), secrets)),
        coversUpToId: lastScannedId,
      });
      observationCount = observations.length;
    }
  }

  const afterObservationEntries = await options.session.entries();
  const afterObservations = foldObservationalMemoryLedger(afterObservationEntries);
  const uncovered = observationsUncoveredByReflection(
    afterObservationEntries,
    afterObservations,
    flushOptions.fullReflectionRebuild === true,
  );
  const uncoveredTokens = uncovered.reduce((sum, item) => sum + item.tokenCount, 0);
  const active = activeObservations(afterObservations);
  const activeTokens = active.reduce((sum, item) => sum + item.tokenCount, 0);
  if (uncovered.length && uncoveredTokens >= settings.reflection.observationTokens) {
    const reflector = await resolveWorker("reflection", options, settings);
    if (!reflector) return { observations: observationCount, reflections: 0, dropped: 0, skipped: "missing_model" };
    const secrets = workerSecrets(reflector, options);
    if (reflector.missingCredentials) return { observations: observationCount, reflections: 0, dropped: 0, skipped: "missing_credentials" };
    const reflections = await runReflector({
      observations: uncovered,
      provider: reflector.provider,
      model: reflector.model,
      ...workerLimits,
      providerOptions: reflector.providerOptions,
      thinkingLevel: reflector.thinkingLevel,
      instruction: settings.reflection.instruction,
      secrets,
      signal: options.signal,
    });
    await appendCustom(options, {
      type: REFLECTIONS_RECORDED,
      reflections: JSON.parse(redactSecrets(JSON.stringify(reflections), secrets)),
      coversUpToId: afterObservations.latestObservationCoverageId,
    });
    reflectionCount = reflections.length;
  }

  if (reflectionCount && activeTokens > settings.dropper.targetTokens) {
    let dropped: readonly string[] = [];
    if (settings.dropper.policy === "lowest-relevance") {
      dropped = dropObservationsToTarget(active, settings.dropper.targetTokens);
    } else {
      const dropper = await resolveWorker("dropper", options, settings);
      if (!dropper) return { observations: observationCount, reflections: reflectionCount, dropped: 0, skipped: "missing_model" };
      const secrets = workerSecrets(dropper, options);
      if (dropper.missingCredentials) {
        return { observations: observationCount, reflections: reflectionCount, dropped: 0, skipped: "missing_credentials" };
      }
      dropped = await runDropper({
        observations: active,
        targetTokens: settings.dropper.targetTokens,
        provider: dropper.provider,
        model: dropper.model,
        ...workerLimits,
        providerOptions: dropper.providerOptions,
        thinkingLevel: dropper.thinkingLevel,
        instruction: settings.dropper.instruction,
        secrets,
        signal: options.signal,
      });
    }
    if (dropped.length) {
      await appendCustom(options, {
        type: OBSERVATIONS_DROPPED,
        observationIds: dropped,
        coversUpToId: afterObservations.latestObservationCoverageId,
      });
      dropCount = dropped.length;
    }
  }

  options.debug?.("observational-memory:flush", { observations: observationCount, reflections: reflectionCount, dropped: dropCount });
  return { observations: observationCount, reflections: reflectionCount, dropped: dropCount };
}

interface ResolvedWorker {
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
  readonly credential?: string;
  readonly missingCredentials?: boolean;
}

async function resolveWorker(
  kind: "observation" | "reflection" | "dropper",
  options: ObservationalMemoryRuntimeOptions,
  settings: ObservationalMemorySettings,
): Promise<ResolvedWorker | undefined> {
  const runtime = options[kind] ?? fallbackWorker(options);
  if (!runtime?.provider) return undefined;
  const workerSettings = settings[kind];
  const resolved = resolveUseCaseModel({
    configured: runtime.model ?? workerSettings.model,
    sessionModel: options.sessionModel,
    requireExplicitModel: runtime.requireExplicitModel ?? workerSettings.requireExplicitModel ?? options.requireExplicitModel,
    providerOptions: workerSettings.providerOptions ?? options.providerOptions,
    thinkingLevel: workerSettings.thinkingLevel,
  });
  if (!resolved) return undefined;
  const credentialProviderId = useCaseCredentialProviderId(resolved) ?? resolved.model.provider;
  const explicitRequest = runtime.credentialRequest ?? options.credentialRequest;
  const credentialRequest = explicitRequest ?? { provider: credentialProviderId, name: "apiKey" };
  const credential = await resolveCredentialValue(runtime.credential ?? options.credential, credentialRequest);
  return {
    provider: runtime.provider,
    model: resolved.model,
    providerOptions: resolved.providerOptions,
    thinkingLevel: resolved.thinkingLevel,
    credential,
    missingCredentials: Boolean(explicitRequest && !credential),
  };
}

function fallbackWorker(options: ObservationalMemoryRuntimeOptions): ObservationalMemoryWorkerRuntimeConfig | undefined {
  if (!options.workerProvider) return undefined;
  return {
    provider: options.workerProvider,
    model: options.workerModel,
    credential: options.credential,
    credentialRequest: options.credentialRequest,
    requireExplicitModel: options.requireExplicitModel,
  };
}

function workerSecrets(worker: ResolvedWorker, options: ObservationalMemoryRuntimeOptions): readonly (string | undefined)[] {
  return [...(options.secrets ?? []), worker.credential];
}

function runtimeLimitOptions(options: ObservationalMemoryRuntimeOptions): MemoryWorkerLimitOptions {
  return {
    maxTurns: options.maxWorkerTurns,
    maxToolCallsPerTurn: options.maxWorkerToolCallsPerTurn,
    maxToolCalls: options.maxWorkerToolCalls,
    maxArgumentBytes: options.maxWorkerArgumentBytes,
    maxResultBytes: options.maxWorkerResultBytes,
    maxMessageBytes: options.maxWorkerMessageBytes,
    maxErrorBytes: options.maxWorkerErrorBytes,
  };
}

async function appendCustom(options: ObservationalMemoryRuntimeOptions, data: unknown): Promise<void> {
  const previousLeafId = options.session.leafId;
  const expectedParentId = previousLeafId;
  const entry = createSessionEntry({ sessionId: options.session.id, parentId: expectedParentId, kind: "custom", data });
  await options.appendEntry(entry, { expectedParentId });
  try {
    await options.session.checkout(entry.id);
    if ((await options.session.entries()).at(-1)?.id === entry.id) return;
  } catch {
    // Fall through to the ownership error below.
  }
  await options.session.checkout(previousLeafId);
  throw new Error("Observational memory appendEntry did not append to the owning session branch");
}
