import type { AgentSession, AIProvider, CredentialRequest, CredentialValueSource, ModelConfig, ProviderRequestOptions, SessionEntry, SettingsProvider } from "@arnilo/prism";
import { createSessionEntry, redactSecrets, resolveCredentialValue, resolveUseCaseModel, useCaseCredentialProviderId } from "@arnilo/prism";
import { activeObservations, foldObservationalMemoryLedger } from "./ledger.js";
import { resolveMemoryWorkerLimits, truncateWorkerText, type MemoryWorkerLimitOptions, type ResolvedMemoryWorkerLimits } from "./limits.js";
import { resolveObservationalMemorySettings, type ObservationalMemorySettingsInput } from "./settings.js";
import { estimateEntryTokens } from "./tokens.js";
import { OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "./types.js";
import { runDropper } from "./workers/dropper.js";
import { runObserver } from "./workers/observer.js";
import { runReflector } from "./workers/reflector.js";

export interface ObservationalMemoryRuntimeOptions {
  readonly session: AgentSession;
  readonly appendEntry: (entry: SessionEntry) => Promise<void>;
  readonly workerProvider: AIProvider;
  /** Explicit worker model. When omitted, falls back to {@link sessionModel} unless {@link requireExplicitModel}. */
  readonly workerModel?: ModelConfig;
  /**
   * Active session / agent model used when `workerModel` (and settings.workerModel) are unset.
   * Pass `agent.config.model` (or the current run model). `AgentSession` does not expose the agent.
   */
  readonly sessionModel?: ModelConfig;
  /**
   * When true, skip workers with `missing_model` if no explicit worker model is configured
   * (preserves pre–Plan 067 fail-skip). Default false: session fallback is preferred.
   */
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
}

export interface ObservationalMemoryRuntime {
  readonly flush: () => Promise<ObservationalMemoryFlushResult>;
  readonly status: () => ObservationalMemoryRuntimeStatus;
}

export interface ObservationalMemoryRuntimeStatus {
  readonly inFlight: boolean;
  readonly lastError?: string;
}

export interface ObservationalMemoryFlushResult {
  readonly observations: number;
  readonly reflections: number;
  readonly dropped: number;
  readonly skipped?: string;
}

export function createObservationalMemoryRuntime(options: ObservationalMemoryRuntimeOptions): ObservationalMemoryRuntime {
  if ("store" in (options as object)) throw new Error("Observational memory runtime requires appendEntry bound to the owning session store, not a separate store option");
  const configuredWorkerLimits = resolveMemoryWorkerLimits(runtimeLimitOptions(options));
  let inFlight = false;
  let lastError: string | undefined;

  return {
    status: () => ({ inFlight, lastError }),
    async flush() {
      if (inFlight) return { observations: 0, reflections: 0, dropped: 0, skipped: "in_flight" };
      inFlight = true;
      try {
        const result = await flush(options, configuredWorkerLimits);
        lastError = undefined;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Observational memory runtime failed";
        lastError = truncateWorkerText(redactSecrets(message, options.secrets ?? []), configuredWorkerLimits.maxErrorBytes) || "Observational memory runtime failed";
        options.debug?.("observational-memory:error", lastError);
        return { observations: 0, reflections: 0, dropped: 0, skipped: "error" };
      } finally {
        inFlight = false;
      }
    },
  };
}

async function flush(options: ObservationalMemoryRuntimeOptions, configuredWorkerLimits: ResolvedMemoryWorkerLimits): Promise<ObservationalMemoryFlushResult> {
  const settings = await resolveObservationalMemorySettings(options.settings, options.overrides);
  const workerLimits = { ...configuredWorkerLimits, maxTurns: options.maxWorkerTurns ?? settings.agentMaxTurns };
  if (settings.passive) return { observations: 0, reflections: 0, dropped: 0, skipped: "passive" };
  const resolved = resolveUseCaseModel({
    configured: options.workerModel ?? settings.workerModel,
    sessionModel: options.sessionModel,
    requireExplicitModel: options.requireExplicitModel ?? settings.requireExplicitModel,
    providerOptions: options.providerOptions,
    thinkingLevel: settings.thinkingLevel,
  });
  if (!resolved) return { observations: 0, reflections: 0, dropped: 0, skipped: "missing_model" };
  const model = resolved.model;
  const thinkingLevel = resolved.thinkingLevel;
  const providerOptions = resolved.providerOptions;
  const credentialProviderId = useCaseCredentialProviderId(resolved) ?? model.provider;
  const credential = await resolveCredentialValue(options.credential, options.credentialRequest ?? { provider: credentialProviderId, name: "apiKey" });
  if (options.credentialRequest && !credential) return { observations: 0, reflections: 0, dropped: 0, skipped: "missing_credentials" };
  const secrets = [...(options.secrets ?? []), credential];
  const entries = await options.session.entries();
  const ledger = foldObservationalMemoryLedger(entries);
  const observationStart = ledger.latestObservationCoverageId ? entries.findIndex((entry) => entry.id === ledger.latestObservationCoverageId) + 1 : 0;
  const newEntries = entries.slice(Math.max(0, observationStart));
  const newTokenCount = newEntries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
  let observationCount = 0;
  let reflectionCount = 0;
  let dropCount = 0;

  if (newEntries.length && newTokenCount >= settings.observeAfterTokens) {
    const observations = await runObserver({ entries: newEntries, provider: options.workerProvider, model, ...workerLimits, providerOptions, thinkingLevel, secrets, signal: options.signal });
    if (observations.length) {
      await appendCustom(options, { type: OBSERVATIONS_RECORDED, observations: JSON.parse(redactSecrets(JSON.stringify(observations), secrets)), coversUpToId: newEntries.at(-1)?.id });
      observationCount = observations.length;
    }
  }

  const afterObservations = foldObservationalMemoryLedger(await options.session.entries());
  const active = activeObservations(afterObservations);
  const activeTokens = active.reduce((sum, item) => sum + item.tokenCount, 0);
  if (active.length && activeTokens >= settings.reflectAfterTokens) {
    const reflections = await runReflector({ observations: active, provider: options.workerProvider, model, ...workerLimits, providerOptions, thinkingLevel, secrets, signal: options.signal });
    if (reflections.length) {
      await appendCustom(options, { type: REFLECTIONS_RECORDED, reflections: JSON.parse(redactSecrets(JSON.stringify(reflections), secrets)), coversUpToId: afterObservations.latestObservationCoverageId });
      reflectionCount = reflections.length;
    }
  }

  if (reflectionCount && activeTokens > settings.observationsPoolTargetTokens) {
    const dropped = await runDropper({ observations: active, targetTokens: settings.observationsPoolTargetTokens, provider: options.workerProvider, model, ...workerLimits, providerOptions, thinkingLevel, secrets, signal: options.signal });
    if (dropped.length) {
      await appendCustom(options, { type: OBSERVATIONS_DROPPED, observationIds: dropped, coversUpToId: afterObservations.latestObservationCoverageId });
      dropCount = dropped.length;
    }
  }

  options.debug?.("observational-memory:flush", { observations: observationCount, reflections: reflectionCount, dropped: dropCount, modelSource: resolved.source });
  return { observations: observationCount, reflections: reflectionCount, dropped: dropCount };
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
  const parentId = (await options.session.entries()).at(-1)?.id;
  const entry = createSessionEntry({ sessionId: options.session.id, parentId, kind: "custom", data });
  await options.appendEntry(entry);
  try {
    await options.session.checkout(entry.id);
    if ((await options.session.entries()).at(-1)?.id === entry.id) return;
  } catch {
    // Fall through to the ownership error below.
  }
  await options.session.checkout(previousLeafId);
  throw new Error("Observational memory appendEntry did not append to the owning session branch");
}
