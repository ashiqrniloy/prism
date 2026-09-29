import type {
  AgentSession,
  AIProvider,
  ContextBlock,
  ContextProvider,
  ContextResolutionContext,
  ModelConfig,
  RunOptions,
  SessionEntry,
  SessionStore,
  ToolDefinition,
} from "@arnilo/prism";
import { SESSION_SEARCH_WORKSPACE_METADATA_KEY } from "@arnilo/prism";
import {
  type AttachedObservationalMemorySession,
  createObservationalMemory,
  createRecallMemoryTool,
  type ObservationalMemory,
} from "@arnilo/prism-memory/compaction/observational-memory";
import type { PrismCodeConfig } from "./config.js";
import type { PrismCodeCredentialManager } from "./credentials.js";
import { PrismCodeExecutionError } from "./errors.js";
import { resolveProvider } from "./providers.js";
import { getCanonicalWorkspaceRoot, resolveSessionStore, type SessionStoreWithAppend } from "./sessions.js";

export interface SessionOmState {
  readonly enabled: boolean;
  readonly workerModel?: ModelConfig;
}

export interface AttachedInstanceRecord {
  readonly om: ObservationalMemory;
  readonly attached: AttachedObservationalMemorySession;
  readonly workerModel: ModelConfig;
  readonly provider: AIProvider;
}

export interface ObservationalMemoryCoordinatorOptions {
  readonly config?: PrismCodeConfig;
  readonly credentialManager?: PrismCodeCredentialManager;
  readonly store?: SessionStore;
  readonly providerResolver?: (model: ModelConfig) => Promise<AIProvider>;
}

export class ObservationalMemoryCoordinator {
  private readonly config?: PrismCodeConfig;
  private readonly credentialManager?: PrismCodeCredentialManager;
  readonly store?: SessionStore;
  private readonly providerResolver?: (model: ModelConfig) => Promise<AIProvider>;

  private readonly sessionStates = new Map<string, SessionOmState>();
  private readonly attachedInstances = new Map<string, AttachedInstanceRecord>();

  constructor(options?: ObservationalMemoryCoordinatorOptions) {
    this.config = options?.config;
    this.credentialManager = options?.credentialManager;
    this.store = options?.store;
    this.providerResolver = options?.providerResolver;
  }

  isSessionEnabled(sessionId: string): boolean {
    return Boolean(this.sessionStates.get(sessionId)?.enabled);
  }

  getSessionWorkerModel(sessionId: string): ModelConfig | undefined {
    return this.sessionStates.get(sessionId)?.workerModel;
  }

  getAttachedInstance(sessionId: string): AttachedInstanceRecord | undefined {
    return this.attachedInstances.get(sessionId);
  }

  isFlushInFlight(sessionId: string): boolean {
    const instance = this.attachedInstances.get(sessionId);
    if (!instance) return false;
    return instance.attached.runtime.status().inFlight;
  }

  getLastError(sessionId: string): string | undefined {
    const instance = this.attachedInstances.get(sessionId);
    if (!instance) return undefined;
    return instance.attached.runtime.status().lastError;
  }

  async loadSessionState(sessionId: string, store?: SessionStore): Promise<SessionOmState> {
    const cached = this.sessionStates.get(sessionId);
    if (cached) return cached;

    const resolvedStore = store ?? this.store;
    if (resolvedStore && typeof (resolvedStore as any).querySessions === "function") {
      try {
        const page = await (resolvedStore as any).querySessions({ id: sessionId, limit: 1 });
        const rec = page?.items?.[0];
        if (rec?.metadata && rec.metadata.omEnabled !== undefined) {
          const state: SessionOmState = {
            enabled: Boolean(rec.metadata.omEnabled),
            workerModel: rec.metadata.omModel as ModelConfig | undefined,
          };
          this.sessionStates.set(sessionId, state);
          return state;
        }
      } catch {
        // Query failed, fall back to default
      }
    }

    // Default configuration from config if available, otherwise default off
    let initialEnabled = false;
    let initialWorkerModel: ModelConfig | undefined;
    const omConfig = this.config?.observationalMemory;
    if (omConfig) {
      if (omConfig === true || omConfig === "on") {
        initialEnabled = true;
      } else if (typeof omConfig === "object") {
        initialEnabled = Boolean(omConfig.enabled);
        initialWorkerModel = omConfig.model;
      }
    }

    const state: SessionOmState = {
      enabled: initialEnabled,
      workerModel: initialWorkerModel,
    };
    this.sessionStates.set(sessionId, state);
    return state;
  }

  async saveSessionState(sessionId: string, state: SessionOmState, workspaceRoot: string, store?: SessionStore): Promise<void> {
    this.sessionStates.set(sessionId, state);

    const resolvedStore = store ?? this.store;
    if (!resolvedStore) return;

    const storeWithAppend = resolvedStore as SessionStoreWithAppend;
    if (typeof storeWithAppend.appendSession !== "function") {
      return;
    }

    let existingMetadata: Record<string, unknown> = {};
    if (typeof (resolvedStore as any).querySessions === "function") {
      try {
        const page = await (resolvedStore as any).querySessions({ id: sessionId, limit: 1 });
        if (page?.items?.[0]?.metadata) {
          existingMetadata = { ...page.items[0].metadata };
        }
      } catch {
        // ignore
      }
    }

    const canonicalRoot = getCanonicalWorkspaceRoot(workspaceRoot);
    const now = new Date().toISOString();

    await storeWithAppend.appendSession({
      id: sessionId,
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...existingMetadata,
        [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: canonicalRoot,
        omEnabled: state.enabled,
        omModel: state.workerModel,
      },
    });
  }

  async toggleSession(
    session: AgentSession,
    sessionModel: ModelConfig,
    store?: SessionStore,
    workspaceRoot?: string,
  ): Promise<{ enabled: boolean; workerModel: ModelConfig }> {
    if (this.isFlushInFlight(session.id)) {
      throw new PrismCodeExecutionError("Cannot toggle observational memory while worker flush is in flight.");
    }

    const current = await this.loadSessionState(session.id, store);
    const nextEnabled = !current.enabled;
    const nextState: SessionOmState = {
      enabled: nextEnabled,
      workerModel: current.workerModel,
    };

    const resolvedRoot = workspaceRoot ?? this.config?.cwd ?? process.cwd();
    await this.saveSessionState(session.id, nextState, resolvedRoot, store);

    const effectiveModel = current.workerModel ?? sessionModel;
    if (nextEnabled) {
      await this.getOrAttach(session, sessionModel, store);
    }

    return { enabled: nextEnabled, workerModel: effectiveModel };
  }

  async setSessionWorkerModel(
    session: AgentSession,
    workerModel: ModelConfig | undefined,
    sessionModel: ModelConfig,
    store?: SessionStore,
    workspaceRoot?: string,
  ): Promise<{ workerModel: ModelConfig }> {
    if (this.isFlushInFlight(session.id)) {
      throw new PrismCodeExecutionError("Cannot change observational memory model while worker flush is in flight.");
    }

    if (workerModel && this.credentialManager) {
      const isAuthed = await this.credentialManager.hasCredentials(workerModel.provider);
      if (!isAuthed) {
        throw new PrismCodeExecutionError(`Provider "${workerModel.provider}" is not authenticated. Please run /provider first.`);
      }
    }

    const current = await this.loadSessionState(session.id, store);
    const nextState: SessionOmState = {
      enabled: current.enabled,
      workerModel,
    };

    const resolvedRoot = workspaceRoot ?? this.config?.cwd ?? process.cwd();
    await this.saveSessionState(session.id, nextState, resolvedRoot, store);

    // If model changed, remove existing attached instance so next run attaches with new model
    const existing = this.attachedInstances.get(session.id);
    const effectiveModel = workerModel ?? sessionModel;
    if (existing && (existing.workerModel.provider !== effectiveModel.provider || existing.workerModel.model !== effectiveModel.model)) {
      this.attachedInstances.delete(session.id);
      if (current.enabled) {
        await this.getOrAttach(session, sessionModel, store);
      }
    }

    return { workerModel: effectiveModel };
  }

  async getOrAttach(session: AgentSession, sessionModel: ModelConfig, store?: SessionStore): Promise<AttachedObservationalMemorySession> {
    const state = await this.loadSessionState(session.id, store);
    const effectiveModel = state.workerModel ?? sessionModel;

    const existing = this.attachedInstances.get(session.id);
    if (existing && existing.workerModel.provider === effectiveModel.provider && existing.workerModel.model === effectiveModel.model) {
      return existing.attached;
    }

    let workerProvider: AIProvider;
    if (this.providerResolver) {
      workerProvider = await this.providerResolver(effectiveModel);
    } else {
      workerProvider = await resolveProvider(effectiveModel, {
        credentialRef: this.config?.credentialRef,
        resolver: this.credentialManager?.createResolver(),
        credentialManager: this.credentialManager,
      });
    }

    const om = createObservationalMemory({
      observation: { provider: workerProvider, model: effectiveModel },
      reflection: { provider: workerProvider, model: effectiveModel },
      dropper: { provider: workerProvider, model: effectiveModel },
      compaction: {
        advertiseRecall: true,
      },
      // Operator/live-journey tracing for skipped observer passes (`PRISM_CODE_OM_DEBUG=1`).
      // Never carries secrets: the runtime only reports counts, reasons, and errors.
      debug:
        process.env.PRISM_CODE_OM_DEBUG === "1"
          ? (message, data) => {
              process.stderr.write(`[om] ${message} ${JSON.stringify(data ?? {})}\n`);
            }
          : undefined,
    });

    const resolvedStore =
      store ?? this.store ?? (session as any).agent?.config?.store ?? resolveSessionStore(this.config ?? { cwd: process.cwd() });
    if (!resolvedStore) {
      throw new PrismCodeExecutionError("No session store available for observational memory attachment");
    }

    const attached = om.attach(session, {
      appendEntry: (entry, opts) => resolvedStore.append(entry, opts),
      sessionModel: effectiveModel,
    });

    this.attachedInstances.set(session.id, {
      om,
      attached,
      workerModel: effectiveModel,
      provider: workerProvider,
    });

    return attached;
  }

  async getActiveSession(session: AgentSession, sessionModel: ModelConfig, store?: SessionStore): Promise<AgentSession> {
    if (this.isSessionEnabled(session.id)) {
      const attached = await this.getOrAttach(session, sessionModel, store);
      return attached.session;
    }
    return this.wrapSessionDisabled(session);
  }

  private wrapSessionDisabled(session: AgentSession): AgentSession {
    const filterOptions = <T extends RunOptions | undefined>(opts: T): T => {
      const tools = this.getAgentTools(session);
      const hasRecall = tools.some((t) => t.name === "recall");
      if (!hasRecall) return opts;
      const allowed = tools.map((t) => t.name).filter((n) => n !== "recall");
      if (opts?.toolNames) {
        return {
          ...opts,
          toolNames: opts.toolNames.filter((n) => n !== "recall"),
        };
      }
      return {
        ...opts,
        toolNames: allowed,
      };
    };

    const wrapper = Object.create(session);
    wrapper.run = (input: any, opts: any) => session.run(input, filterOptions(opts));
    wrapper.prompt = (input: any, opts: any) => session.prompt(input, filterOptions(opts));
    wrapper.stream = (input: any, opts: any) => session.stream(input, filterOptions(opts));
    return wrapper;
  }

  private getAgentTools(session: AgentSession): readonly ToolDefinition[] {
    const toolsConfig = (session as any).agent?.config?.tools;
    if (!toolsConfig) return [];
    if (typeof toolsConfig.list === "function") return toolsConfig.list();
    if (Array.isArray(toolsConfig)) return toolsConfig;
    return [];
  }

  createDelegatingContextProvider(): ContextProvider {
    return {
      name: "observational-memory",
      resolve: async (context: ContextResolutionContext): Promise<readonly ContextBlock[]> => {
        const sessionId = context.sessionId;
        if (!sessionId || !this.isSessionEnabled(sessionId)) {
          return [];
        }
        const instance = this.attachedInstances.get(sessionId);
        if (!instance) {
          return [];
        }
        return await instance.attached.contextProvider.resolve(context);
      },
    };
  }

  createRecallTool(store?: SessionStore): ToolDefinition {
    const baseRecall = createRecallMemoryTool({
      getEntries: async (sessionId: string): Promise<readonly SessionEntry[]> => {
        const instance = this.attachedInstances.get(sessionId);
        if (instance) {
          return await instance.attached.session.entries();
        }
        const resolvedStore = store ?? this.store;
        if (resolvedStore) {
          return await resolvedStore.list(sessionId);
        }
        return [];
      },
    });

    return {
      ...baseRecall,
      execute: async (args, context) => {
        if (!this.isSessionEnabled(context.sessionId)) {
          return {
            toolCallId: context.toolCallId,
            name: baseRecall.name,
            value: {
              found: false,
              reason: "disabled",
              text: "Observational memory is disabled for this session.",
            },
            content: [{ type: "text", text: "Observational memory is disabled for this session." }],
          };
        }
        return baseRecall.execute(args, context);
      },
    };
  }
}
