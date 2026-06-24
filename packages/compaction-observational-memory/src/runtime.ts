import type { AgentSession, AIProvider, CredentialRequest, CredentialValueSource, ModelConfig, ProviderRequestOptions, SessionEntry, SessionStore, SettingsProvider } from "@arnilo/prism";
import { createSessionEntry, redactSecrets, resolveCredentialValue } from "@arnilo/prism";
import { activeObservations, foldObservationalMemoryLedger } from "./ledger.js";
import { resolveObservationalMemorySettings, type ObservationalMemorySettingsInput } from "./settings.js";
import { estimateEntryTokens } from "./tokens.js";
import { OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED, REFLECTIONS_RECORDED } from "./types.js";
import { runDropper } from "./workers/dropper.js";
import { runObserver } from "./workers/observer.js";
import { runReflector } from "./workers/reflector.js";

export interface ObservationalMemoryRuntimeOptions {
  readonly session: AgentSession;
  readonly store: SessionStore;
  readonly workerProvider: AIProvider;
  readonly workerModel?: ModelConfig;
  readonly providerOptions?: ProviderRequestOptions;
  readonly settings?: SettingsProvider;
  readonly overrides?: ObservationalMemorySettingsInput;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly secrets?: readonly (string | undefined)[];
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
  let inFlight = false;
  let lastError: string | undefined;

  return {
    status: () => ({ inFlight, lastError }),
    async flush() {
      if (inFlight) return { observations: 0, reflections: 0, dropped: 0, skipped: "in_flight" };
      inFlight = true;
      try {
        const result = await flush(options);
        lastError = undefined;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        options.debug?.("observational-memory:error", lastError);
        return { observations: 0, reflections: 0, dropped: 0, skipped: "error" };
      } finally {
        inFlight = false;
      }
    },
  };
}

async function flush(options: ObservationalMemoryRuntimeOptions): Promise<ObservationalMemoryFlushResult> {
  const settings = await resolveObservationalMemorySettings(options.settings, options.overrides);
  if (settings.passive) return { observations: 0, reflections: 0, dropped: 0, skipped: "passive" };
  const model = options.workerModel ?? settings.workerModel;
  if (!model) return { observations: 0, reflections: 0, dropped: 0, skipped: "missing_model" };
  const credential = await resolveCredentialValue(options.credential, options.credentialRequest ?? { provider: model.provider, name: "apiKey" });
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
    const observations = await runObserver({ entries: newEntries, provider: options.workerProvider, model, maxTurns: settings.agentMaxTurns, providerOptions: options.providerOptions, thinkingLevel: settings.thinkingLevel, secrets, signal: options.signal });
    if (observations.length) {
      await appendCustom(options, { type: OBSERVATIONS_RECORDED, observations: JSON.parse(redactSecrets(JSON.stringify(observations), secrets)), coversUpToId: newEntries.at(-1)?.id });
      observationCount = observations.length;
    }
  }

  const afterObservations = foldObservationalMemoryLedger(await options.session.entries());
  const active = activeObservations(afterObservations);
  const activeTokens = active.reduce((sum, item) => sum + item.tokenCount, 0);
  if (active.length && activeTokens >= settings.reflectAfterTokens) {
    const reflections = await runReflector({ observations: active, provider: options.workerProvider, model, maxTurns: settings.agentMaxTurns, providerOptions: options.providerOptions, thinkingLevel: settings.thinkingLevel, secrets, signal: options.signal });
    if (reflections.length) {
      await appendCustom(options, { type: REFLECTIONS_RECORDED, reflections: JSON.parse(redactSecrets(JSON.stringify(reflections), secrets)), coversUpToId: afterObservations.latestObservationCoverageId });
      reflectionCount = reflections.length;
    }
  }

  if (reflectionCount && activeTokens > settings.observationsPoolTargetTokens) {
    const dropped = await runDropper({ observations: active, targetTokens: settings.observationsPoolTargetTokens, provider: options.workerProvider, model, maxTurns: settings.agentMaxTurns, providerOptions: options.providerOptions, thinkingLevel: settings.thinkingLevel, secrets, signal: options.signal });
    if (dropped.length) {
      await appendCustom(options, { type: OBSERVATIONS_DROPPED, observationIds: dropped, coversUpToId: afterObservations.latestObservationCoverageId });
      dropCount = dropped.length;
    }
  }

  options.debug?.("observational-memory:flush", { observations: observationCount, reflections: reflectionCount, dropped: dropCount });
  return { observations: observationCount, reflections: reflectionCount, dropped: dropCount };
}

async function appendCustom(options: ObservationalMemoryRuntimeOptions, data: unknown): Promise<void> {
  const parentId = (await options.session.entries()).at(-1)?.id;
  const entry = createSessionEntry({ sessionId: options.session.id, parentId, kind: "custom", data });
  await options.store.append(entry);
  await options.session.checkout(entry.id);
}
