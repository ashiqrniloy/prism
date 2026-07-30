import type {
  AgentRunRef,
  AgentRunResume,
  AgentRunResumeOptions,
  AgentRunResumeStreamOptions,
  AgentSession,
  AIProvider,
  CompactionStrategy,
  ContextProvider,
  CredentialRequest,
  CredentialValueSource,
  ModelConfig,
  ProviderRequestOptions,
  SessionEntry,
  SettingsProvider,
} from "@arnilo/prism";
import { resumeAgentRun, resumeAgentRunStream } from "@arnilo/prism";
import { buildObservationalMemoryContextBlocks } from "./recent-messages.js";
import type { ObservationalMemoryFlushOptions, ObservationalMemoryRuntime, ObservationalMemoryWorkerRuntimeConfig } from "./runtime.js";
import { createObservationalMemoryRuntime } from "./runtime.js";
import {
  type ObservationalMemoryContextSettingsInput,
  type ObservationalMemoryDropperSettingsInput,
  type ObservationalMemoryObservationSettingsInput,
  type ObservationalMemoryReflectionSettingsInput,
  type ObservationalMemoryRetrievalSettingsInput,
  type ObservationalMemorySettings,
  type ObservationalMemorySettingsInput,
  defaultObservationalMemorySettings,
  resolveObservationalMemorySettings,
} from "./settings.js";
import { createObservationalMemoryCompactionStrategy, type ObservationalMemoryCompactionStrategyOptions } from "./strategy.js";
import { estimateEntryTokens } from "./tokens.js";

export interface ObservationalMemoryAppendOptions {
  readonly expectedParentId?: string;
}

export interface ObservationalMemoryWorkerConfig {
  readonly provider?: AIProvider;
  readonly model?: ModelConfig;
  readonly instruction?: string;
  readonly thinkingLevel?: string;
  readonly providerOptions?: ProviderRequestOptions;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly requireExplicitModel?: boolean;
}

export interface ObservationalMemoryObservationConfig extends ObservationalMemoryWorkerConfig {
  readonly messageTokens?: number;
}

export interface ObservationalMemoryReflectionConfig extends ObservationalMemoryWorkerConfig {
  readonly observationTokens?: number;
}

export interface ObservationalMemoryDropperConfig extends ObservationalMemoryWorkerConfig {
  readonly targetTokens?: number;
  readonly policy?: "model" | "lowest-relevance";
}

export interface ObservationalMemoryContextConfig extends ObservationalMemoryContextSettingsInput {}

export interface ObservationalMemoryRetrievalConfig extends ObservationalMemoryRetrievalSettingsInput {}

export interface CreateObservationalMemoryOptions {
  readonly observation?: ObservationalMemoryObservationConfig;
  readonly reflection?: ObservationalMemoryReflectionConfig;
  readonly dropper?: ObservationalMemoryDropperConfig;
  readonly context?: ObservationalMemoryContextConfig;
  readonly retrieval?: ObservationalMemoryRetrievalConfig;
  /** @deprecated use observation.provider */
  readonly workerProvider?: AIProvider;
  /** @deprecated use observation.model / reflection.model */
  readonly workerModel?: ModelConfig;
  readonly settings?: SettingsProvider;
  readonly overrides?: ObservationalMemorySettingsInput;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly requireExplicitModel?: boolean;
  readonly secrets?: readonly (string | undefined)[];
  readonly compaction?: ObservationalMemoryCompactionStrategyOptions;
  readonly maxWorkerTurns?: number;
  readonly maxWorkerToolCallsPerTurn?: number;
  readonly maxWorkerToolCalls?: number;
  readonly maxWorkerArgumentBytes?: number;
  readonly maxWorkerResultBytes?: number;
  readonly maxWorkerMessageBytes?: number;
  readonly maxWorkerErrorBytes?: number;
  readonly debug?: (message: string, data?: unknown) => void;
}

export interface ObservationalMemoryAttachOptions {
  readonly appendEntry: (entry: SessionEntry, options?: ObservationalMemoryAppendOptions) => Promise<void>;
  readonly sessionModel?: ModelConfig;
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly requireExplicitModel?: boolean;
  readonly signal?: AbortSignal;
}

export interface AttachedObservationalMemorySession {
  readonly session: AgentSession;
  readonly runtime: ObservationalMemoryRuntime;
  readonly contextProvider: ContextProvider;
  readonly compactionStrategy: CompactionStrategy;
  readonly settings: ObservationalMemorySettings;
}

export interface ObservationalMemory {
  attach(session: AgentSession, options: ObservationalMemoryAttachOptions): AttachedObservationalMemorySession;
  wrapResumeRun(resume: typeof resumeAgentRun): typeof resumeAgentRun;
  wrapResumeStream(resumeStream: typeof resumeAgentRunStream): typeof resumeAgentRunStream;
}

export function createObservationalMemory(options: CreateObservationalMemoryOptions): ObservationalMemory {
  assertWorkerModelCompatibility(options);
  const lifecycles = new Map<string, () => Promise<void>>();
  const runtimeWorkers = resolveRuntimeWorkers(options);
  const settingsOverrides = composeSettingsOverrides(options);
  const memory: ObservationalMemory = {
    attach(session, attachOptions) {
      let runDepth = 0;
      const settingsHolder: { value: ObservationalMemorySettings } = { value: defaultObservationalMemorySettings };
      void resolveObservationalMemorySettings(options.settings, settingsOverrides).then((resolved) => {
        settingsHolder.value = resolved;
      });
      const compactionStrategy = createObservationalMemoryCompactionStrategy({
        keepRecentEntries: defaultObservationalMemorySettings.context.recentMessages,
        observationsPoolMaxTokens: defaultObservationalMemorySettings.context.observationsPoolMaxTokens,
        ...options.compaction,
        secrets: options.secrets,
      });

      const runtime = createObservationalMemoryRuntime({
        session,
        appendEntry: attachOptions.appendEntry,
        ...runtimeWorkers,
        sessionModel: attachOptions.sessionModel,
        requireExplicitModel: attachOptions.requireExplicitModel ?? options.requireExplicitModel,
        settings: options.settings,
        overrides: settingsOverrides,
        credential: attachOptions.credential ?? options.credential,
        credentialRequest: attachOptions.credentialRequest ?? options.credentialRequest,
        secrets: options.secrets,
        maxWorkerTurns: options.maxWorkerTurns,
        maxWorkerToolCallsPerTurn: options.maxWorkerToolCallsPerTurn,
        maxWorkerToolCalls: options.maxWorkerToolCalls,
        maxWorkerArgumentBytes: options.maxWorkerArgumentBytes,
        maxWorkerResultBytes: options.maxWorkerResultBytes,
        maxWorkerMessageBytes: options.maxWorkerMessageBytes,
        maxWorkerErrorBytes: options.maxWorkerErrorBytes,
        debug: options.debug,
        signal: attachOptions.signal,
        isRunActive: () => runDepth > 0,
      });

      const contextProvider: ContextProvider = {
        name: "observational-memory",
        async resolve() {
          const entries = await session.entries();
          const settings = await resolveObservationalMemorySettings(options.settings, settingsOverrides);
          settingsHolder.value = settings;
          return buildObservationalMemoryContextBlocks(entries, {
            keepRecentEntries: settings.context.recentMessages,
            maxTokens: settings.context.recentMessageMaxTokens,
            secrets: options.secrets,
          });
        },
      };

      const sync = async (flushOptions?: ObservationalMemoryFlushOptions) => {
        if (runDepth > 0) return;
        settingsHolder.value = await resolveObservationalMemorySettings(options.settings, settingsOverrides);
        if (settingsHolder.value.passive) return;
        await runtime.flush(flushOptions);
        const entries = await session.entries();
        const tokens = entries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
        if (tokens >= settingsHolder.value.context.compactAfterTokens) {
          await session.compact({
            strategy: compactionStrategy,
            keepRecentEntries: settingsHolder.value.context.recentMessages,
            signal: attachOptions.signal,
          });
        }
      };

      lifecycles.set(session.id, sync);

      const proxied: AgentSession = {
        get id() {
          return session.id;
        },
        get leafId() {
          return session.leafId;
        },
        run: async (input, runOptions) => {
          runDepth++;
          try {
            return await session.run(input, runOptions);
          } finally {
            runDepth--;
            await sync();
          }
        },
        prompt: async (input, runOptions) => {
          runDepth++;
          try {
            return await session.prompt(input, runOptions);
          } finally {
            runDepth--;
            await sync();
          }
        },
        stream(input, runOptions) {
          runDepth++;
          return (async function* () {
            try {
              for await (const event of session.stream(input, runOptions)) yield event;
            } finally {
              runDepth--;
              await sync();
            }
          })();
        },
        steer: (input, steerOptions) => session.steer(input, steerOptions),
        compact: async (compactOptions) => {
          await runtime.flush();
          return session.compact({
            ...compactOptions,
            strategy: compactOptions?.strategy ?? compactionStrategy,
            signal: compactOptions?.signal ?? attachOptions.signal,
          });
        },
        subscribe: (subscribeOptions) => session.subscribe(subscribeOptions),
        abort: (reason) => session.abort(reason),
        entries: () => session.entries(),
        checkout: (leafId) => session.checkout(leafId),
        fork: (forkOptions) => memory.attach(session.fork(forkOptions), attachOptions).session,
        clone: async (cloneOptions) => {
          const cloned = await session.clone(cloneOptions);
          return memory.attach(cloned, attachOptions).session;
        },
      };

      return {
        get session() {
          return proxied;
        },
        runtime,
        contextProvider,
        compactionStrategy,
        get settings() {
          return settingsHolder.value;
        },
      };
    },
    wrapResumeRun(resume) {
      return async (agent, ref, resumeInput, resumeOptions) => {
        const result = await resume(agent, ref, resumeInput, resumeOptions);
        await runLifecycle(lifecycles, result.sessionId);
        return result;
      };
    },
    wrapResumeStream(resumeStream) {
      return async function* (agent, ref, resumeInput, resumeOptions) {
        let sessionId: string | undefined = ref.sessionId;
        for await (const event of resumeStream(agent, ref, resumeInput, resumeOptions)) {
          if (event.type === "agent_finished" || event.type === "agent_suspended") sessionId = event.sessionId;
          yield event;
        }
        if (sessionId) await runLifecycle(lifecycles, sessionId);
      };
    },
  };
  return memory;
}

function assertWorkerModelCompatibility(options: CreateObservationalMemoryOptions): void {
  if (!options.workerModel) return;
  if (options.observation?.model || options.reflection?.model || options.dropper?.model) {
    throw new Error("Observational memory config conflict: workerModel cannot be combined with nested worker models");
  }
}

function resolveRuntimeWorkers(options: CreateObservationalMemoryOptions): {
  readonly observation?: ObservationalMemoryWorkerRuntimeConfig;
  readonly reflection?: ObservationalMemoryWorkerRuntimeConfig;
  readonly dropper?: ObservationalMemoryWorkerRuntimeConfig;
} {
  const fallbackProvider = options.workerProvider ?? options.observation?.provider ?? options.reflection?.provider;
  const toRuntime = (config?: ObservationalMemoryWorkerConfig): ObservationalMemoryWorkerRuntimeConfig | undefined => {
    const provider = config?.provider ?? fallbackProvider;
    if (!provider) return undefined;
    return {
      provider,
      model: config?.model ?? options.workerModel,
      credential: config?.credential ?? options.credential,
      credentialRequest: config?.credentialRequest ?? options.credentialRequest,
      requireExplicitModel: config?.requireExplicitModel ?? options.requireExplicitModel,
    };
  };
  return {
    observation: toRuntime(options.observation),
    reflection: toRuntime(options.reflection),
    dropper: toRuntime(options.dropper),
  };
}

function composeSettingsOverrides(options: CreateObservationalMemoryOptions): ObservationalMemorySettingsInput {
  return {
    ...options.overrides,
    observation: {
      ...options.overrides?.observation,
      messageTokens: options.observation?.messageTokens ?? options.overrides?.observation?.messageTokens,
      model: options.observation?.model ?? options.overrides?.observation?.model,
      instruction: options.observation?.instruction ?? options.overrides?.observation?.instruction,
      thinkingLevel: options.observation?.thinkingLevel ?? options.overrides?.observation?.thinkingLevel,
      providerOptions: options.observation?.providerOptions ?? options.overrides?.observation?.providerOptions,
      requireExplicitModel: options.observation?.requireExplicitModel ?? options.overrides?.observation?.requireExplicitModel,
    },
    reflection: {
      ...options.overrides?.reflection,
      observationTokens: options.reflection?.observationTokens ?? options.overrides?.reflection?.observationTokens,
      model: options.reflection?.model ?? options.overrides?.reflection?.model,
      instruction: options.reflection?.instruction ?? options.overrides?.reflection?.instruction,
      thinkingLevel: options.reflection?.thinkingLevel ?? options.overrides?.reflection?.thinkingLevel,
      providerOptions: options.reflection?.providerOptions ?? options.overrides?.reflection?.providerOptions,
      requireExplicitModel: options.reflection?.requireExplicitModel ?? options.overrides?.reflection?.requireExplicitModel,
    },
    dropper: {
      ...options.overrides?.dropper,
      targetTokens: options.dropper?.targetTokens ?? options.overrides?.dropper?.targetTokens,
      policy: options.dropper?.policy ?? options.overrides?.dropper?.policy,
      model: options.dropper?.model ?? options.overrides?.dropper?.model,
      instruction: options.dropper?.instruction ?? options.overrides?.dropper?.instruction,
      thinkingLevel: options.dropper?.thinkingLevel ?? options.overrides?.dropper?.thinkingLevel,
      providerOptions: options.dropper?.providerOptions ?? options.overrides?.dropper?.providerOptions,
      requireExplicitModel: options.dropper?.requireExplicitModel ?? options.overrides?.dropper?.requireExplicitModel,
    },
    context: {
      ...options.overrides?.context,
      recentMessages: options.context?.recentMessages ?? options.overrides?.context?.recentMessages,
      recentMessageMaxTokens: options.context?.recentMessageMaxTokens ?? options.overrides?.context?.recentMessageMaxTokens,
      compactAfterTokens: options.context?.compactAfterTokens ?? options.overrides?.context?.compactAfterTokens,
      observationsPoolMaxTokens: options.context?.observationsPoolMaxTokens ?? options.overrides?.context?.observationsPoolMaxTokens,
      observationsPoolTargetTokens:
        options.context?.observationsPoolTargetTokens ?? options.overrides?.context?.observationsPoolTargetTokens,
    },
    retrieval: {
      ...options.overrides?.retrieval,
      pageLimit: options.retrieval?.pageLimit ?? options.overrides?.retrieval?.pageLimit,
    },
    workerModel: options.workerModel ?? options.overrides?.workerModel,
  };
}

async function runLifecycle(lifecycles: Map<string, () => Promise<void>>, sessionId: string): Promise<void> {
  await lifecycles.get(sessionId)?.();
}

export { resumeAgentRun, resumeAgentRunStream };
