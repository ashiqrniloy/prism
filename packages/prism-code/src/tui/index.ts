import type { AgentSession, CommandDrivers, ModelConfig, RunOptions, SessionEntry, SessionStore, ToolRegistry } from "@arnilo/prism";
import type { AgentSdkDefinition } from "@arnilo/prism-agent-sdk";
import type { AskUserDecisionAnswer, AskUserDecisionRequest, TodoContinuationStopHook } from "@arnilo/prism-coding-tools/agent";
import type { CodingApprovalRequest } from "@arnilo/prism-coding-tools/security";
import { BoxRenderable, type CliRenderer, createCliRenderer, type PasteEvent, type SyntaxStyle } from "@opentui/core";
import type { PrismCodeApprovalController } from "../approval.js";
import type { PrismCodeConfig, PrismCodeMcpServer } from "../config.js";
import { PrismCodeCredentialManager } from "../credentials.js";
import type { PrismCodeCredentialStoreChoice } from "../home.js";
import { ObservationalMemoryCoordinator } from "../observational-memory.js";
import {
  createProviderCache,
  cycleThinkingLevel,
  getShippedProvider,
  hasUsableProvider,
  type ProviderCache,
  validateThinkingLevel,
} from "../providers.js";
import { deriveSessionTitle, ensureDurableSessionRecord, resolveSessionStore, setSessionTitle } from "../sessions.js";
import type { WebToolResolution } from "../web.js";
import type { WikiContributions } from "../wiki.js";
import { type CommandContext, executeResumeSessionCommand, handleSlashCommand, type McpSessionControl } from "./commands.js";
import {
  buildPromptInput,
  type CompletionContext,
  completionContext,
  type FileIndexEntry,
  filterCompletionItems,
  filterFileIndex,
  loadRepoFileIndex,
} from "./completion.js";
import { type ApprovalDecision, ApprovalPromptComponent } from "./components/approval.js";
import { InputEditorComponent } from "./components/input.js";
import { createPrismSyntaxStyle } from "./components/markdown-message.js";
import { PickerComponent, type UiPickerOption } from "./components/picker.js";
import { SecretInputComponent } from "./components/secret-input.js";
import { detectGitBranch, StatusFooterComponent } from "./components/status.js";
import { MessageStreamComponent } from "./components/stream.js";
import { TodoPanelComponent } from "./components/todo.js";
import { entriesToUiEntries } from "./history.js";
import { appendPromptHistory, loadPromptHistory } from "./history-store.js";
import { CORE_SLASH_COMMANDS } from "./keybindings.js";
import { createInitialTuiState, type TuiState, tuiReducer } from "./reducer.js";
import { type ActiveSelection, selectionRunOptions } from "./selection.js";

export { detectGitBranch } from "./components/status.js";
export type { UiFooterStatus, UiStreamEntry } from "./reducer.js";
export { createInitialTuiState, tuiReducer } from "./reducer.js";

export interface CodeUi {
  start(definition: AgentSdkDefinition): Promise<void>;
  close(): Promise<void>;
  promptApproval(request: CodingApprovalRequest): Promise<ApprovalDecision>;
  readonly isDestroyed: boolean;
  readonly renderer: CliRenderer;
}

export interface PrismCodeTuiOptions {
  readonly config?: PrismCodeConfig;
  readonly sessionId?: string;
  readonly store?: SessionStore;
  readonly renderer?: CliRenderer;
  readonly exitOnCtrlC?: boolean;
  readonly onExit?: (code: number) => void;
  readonly maxScrollback?: number;
  readonly approvalTimeoutMs?: number;
  readonly credentialManager?: PrismCodeCredentialManager;
  /** Shared provider cache; the assembled agent's `providerSource` reads the same instances. */
  readonly providerCache?: ProviderCache;
  /** Effort level remembered in `~/.prism/state.json`; clamped to the model's declared levels. */
  readonly initialEffort?: string;
  /** Footer notice when the active model's limits are assumed rather than catalog-declared. */
  readonly modelNotice?: string;
  readonly omCoordinator?: ObservationalMemoryCoordinator;
  /** Fired after a successful `/provider`, `/model`, or Shift+Tab effort change (remembered in `~/.prism/state.json`). */
  readonly onSelectionChange?: (selection: { readonly model: ModelConfig; readonly effort: string }) => void;
  /** Shared approval controller: `/approval`, the footer mode, and the prompt timeout read from it. */
  readonly approvalController?: PrismCodeApprovalController;
  /** Opens the `/resume` picker once the UI is ready (`--resume`). */
  readonly openResumePicker?: boolean;
  /** Startup diagnostics (e.g. missing web backend) rendered as system messages. */
  readonly setupNotes?: readonly string[];
  /** Runs once when the TUI first renders and no durable credential store has been chosen yet. */
  readonly onCredentialStoreChoiceNeeded?: () => Promise<void>;
}

export class PrismCodeTui implements CodeUi {
  public isDestroyed = false;
  private _renderer?: CliRenderer;
  private readonly config: PrismCodeConfig;
  private readonly options: PrismCodeTuiOptions;
  private readonly credentialManager: PrismCodeCredentialManager;
  /** Shared cache; adopted from the assembled definition in `start()` when the host supplied none. */
  private providerCache: ProviderCache;
  /** Single active model + effort; every run derives its options from this value. */
  private selection: ActiveSelection;
  private state: TuiState;
  private definition?: AgentSdkDefinition;
  private session?: ReturnType<AgentSdkDefinition["createSession"]>;
  private todoComponent?: TodoPanelComponent;
  private store?: SessionStore;
  private container?: BoxRenderable;
  private streamComponent?: MessageStreamComponent;
  private syntaxStyle?: SyntaxStyle;
  private inputComponent?: InputEditorComponent;
  private statusComponent?: StatusFooterComponent;
  private approvalComponent?: ApprovalPromptComponent;
  private pickerComponent?: PickerComponent;
  private secretInputComponent?: SecretInputComponent;
  private keyListener?: (key: {
    name: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    sequence?: string;
    preventDefault: () => void;
  }) => void;
  private pasteListener?: (event: PasteEvent) => void;
  private uncaughtListener?: (err: Error) => void;
  private rejectionListener?: (reason: unknown) => void;
  private sigtermListener?: () => void;
  private sighupListener?: () => void;
  private activeRun?: Promise<unknown>;
  private activePrompt?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private currentAbortController?: AbortController;
  private omCoordinator?: ObservationalMemoryCoordinator;
  /** Servers whose tools were unregistered for this session via `/mcp disable`. */
  private readonly mcpSessionDisabled = new Set<string>();
  private uiReady = false;
  // Inline completion popup state (shares the picker renderable with modal pickers).
  private completionActive = false;
  private completionMatch?: CompletionContext;
  private suppressCompletion = false;
  private fileIndex: FileIndexEntry[] = [];
  private fileIndexLoadedAt = 0;
  private lastCtrlCAt = 0;
  /** Last context-meter reading pushed into the footer, so unchanged values never re-render. */
  private lastContextMeterKey?: string;

  constructor(options?: PrismCodeTuiOptions) {
    this.options = options ?? {};
    this.config = options?.config ?? { cwd: process.cwd() };
    this._renderer = options?.renderer;
    this.credentialManager = options?.credentialManager ?? new PrismCodeCredentialManager();
    this.providerCache =
      options?.providerCache ??
      createProviderCache({
        credentialRef: this.config.credentialRef,
        resolver: this.credentialManager.createResolver(),
        credentialManager: this.credentialManager,
      });

    const selectedModel = this.config.model ?? { provider: "mock", model: "default" };
    const branch = detectGitBranch(this.config.cwd);
    const initialEffort = validateThinkingLevel(selectedModel, options?.initialEffort ?? "none");
    this.selection = { model: selectedModel, effort: initialEffort };

    this.state = createInitialTuiState({
      repo: this.config.cwd,
      branch,
      provider: selectedModel.provider ?? "mock",
      model: selectedModel.model ?? "default",
      effort: initialEffort,
      approval: options?.approvalController?.getMode() ?? this.config.approval?.mode ?? "ask",
      modelNotice: options?.modelNotice,
      maxEntries: options?.maxScrollback ?? 500,
    });
  }

  private get currentModel(): ModelConfig {
    return this.selection.model;
  }

  /** Resolves the active provider into the shared cache (no-op once cached). */
  private async ensureProvider(): Promise<void> {
    await this.providerCache.prime(this.selection.model);
  }

  /** Applies an effort level to the one selection value and mirrors it to the footer. */
  private setEffort(effort: string): void {
    this.selection = { ...this.selection, effort };
    this.state = { ...this.state, footer: { ...this.state.footer, effort } };
    this.statusComponent?.update(this.state.footer);
    this.notifySelectionChange();
  }

  /** Footer effort is the UI mirror of `selection.effort`; command-side footer patches land here. */
  private syncSelectionEffort(): void {
    const effort = this.state.footer.effort;
    if (effort !== this.selection.effort) {
      this.selection = { ...this.selection, effort };
    }
  }

  get renderer(): CliRenderer {
    if (!this._renderer) {
      throw new Error("TUI renderer has not been initialized. Call start() first.");
    }
    return this._renderer;
  }

  /**
   * Builds the renderer, layout, and keybindings once. `start()` and `onboardProvider()` both call this,
   * so a first-run TUI can accept credential input before an agent definition exists.
   */
  private async ensureUi(): Promise<void> {
    if (this.uiReady) return;

    if (!this._renderer) {
      this._renderer = await createCliRenderer({ exitOnCtrlC: false });
    }
    const renderer = this._renderer;

    this.container = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: "100%",
      height: "100%",
    });

    this.syntaxStyle = createPrismSyntaxStyle();

    this.streamComponent = new MessageStreamComponent(renderer, {
      maxEntries: this.state.maxEntries,
      syntaxStyle: this.syntaxStyle,
    });

    this.todoComponent = new TodoPanelComponent(renderer);

    this.approvalComponent = new ApprovalPromptComponent(renderer, {
      defaultTimeoutMs: this.options.approvalTimeoutMs ?? this.config.approval?.timeoutMs ?? 0,
      syntaxStyle: this.syntaxStyle,
    });

    this.pickerComponent = new PickerComponent(renderer);
    this.secretInputComponent = new SecretInputComponent(renderer);

    this.inputComponent = new InputEditorComponent(renderer, {
      history: loadPromptHistory(this.config.cwd),
      onHistoryAdd: (text) => appendPromptHistory(this.config.cwd, text),
      onSubmit: (text) => {
        const prompt = this.handlePromptSubmit(text);
        this.activePrompt = prompt;
        void prompt.then(
          () => {
            if (this.activePrompt === prompt) this.activePrompt = undefined;
          },
          () => {
            if (this.activePrompt === prompt) this.activePrompt = undefined;
          },
        );
      },
    });
    this.inputComponent.textarea.onContentChange = () => {
      this.updateCompletion();
    };

    this.statusComponent = new StatusFooterComponent(renderer, this.state.footer);

    this.container.add(this.streamComponent.root);
    this.container.add(this.todoComponent.root);
    this.container.add(this.approvalComponent.root);
    this.container.add(this.pickerComponent.root);
    this.container.add(this.secretInputComponent.root);
    this.container.add(this.inputComponent.root);
    this.container.add(this.statusComponent.root);

    renderer.root.add(this.container);

    this.wireKeybindings();
    this.inputComponent.focus();
    this.uiReady = true;

    // One-time durable credential store choice (TUI only; headless/ACP never reach this).
    if (this.options.onCredentialStoreChoiceNeeded) {
      await this.options.onCredentialStoreChoiceNeeded();
    }
  }

  private appendSetupNotes(notes: readonly string[]): void {
    for (const [index, note] of notes.entries()) {
      this.streamComponent?.appendOrUpdate({
        id: `setup_note_${index}`,
        type: "message",
        role: "system",
        text: note,
        finished: true,
      });
    }
  }

  async start(definition: AgentSdkDefinition): Promise<void> {
    this.definition = definition;
    this.store = this.options.store ?? definition.agent.config.store ?? resolveSessionStore(this.config);

    // Surface the todo no-progress stop as a system note (plan 137 Task 7).
    const todoStopHook = (definition as unknown as { todoStopHook?: TodoContinuationStopHook }).todoStopHook;
    if (todoStopHook) {
      todoStopHook.onNoProgressStop = () => this.notify("Stopped: no progress on open todos");
    }

    // One provider cache per process: reuse the one the definition was assembled with.
    if (!this.options.providerCache) {
      const sharedCache = (definition as unknown as { providerCache?: ProviderCache }).providerCache;
      if (sharedCache) this.providerCache = sharedCache;
    }

    if (this.options.sessionId && this.config.store?.type === "memory") {
      throw new Error(
        "Session resumption is not supported with in-memory session store. Configure a durable SQLite store in prism-code.json.",
      );
    }

    await this.ensureUi();

    this.refreshMcpFooter();

    const webResolution = (definition as unknown as { webResolution?: WebToolResolution }).webResolution;
    this.appendSetupNotes([...(this.options.setupNotes ?? []), ...(webResolution?.notes ?? [])]);

    // Create agent session
    this.session = definition.createSession({
      id: this.options.sessionId,
      metadata: {
        workspaceRoot: this.config.cwd,
        userId: this.config.userId ?? "local",
      },
    });

    await ensureDurableSessionRecord(this.store, this.session.id, this.config.cwd, {
      userId: this.config.userId,
    });

    const initialEntries = await this.session.entries();
    this.renderHistory(initialEntries);
    this.applyResumedModel(initialEntries);

    this.omCoordinator =
      this.options.omCoordinator ??
      (definition as any).omCoordinator ??
      new ObservationalMemoryCoordinator({
        config: this.config,
        store: this.store,
        credentialManager: this.credentialManager,
        providerResolver: (model) => this.providerCache.prime(model),
      });

    const omCoordinator = this.omCoordinator;
    if (this.session && omCoordinator) {
      const omState = await omCoordinator.loadSessionState(this.session.id, this.store);
      const omModelStr = omState.workerModel ? `${omState.workerModel.provider}/${omState.workerModel.model}` : undefined;
      this.state = {
        ...this.state,
        footer: {
          ...this.state.footer,
          omEnabled: omState.enabled,
          omModel: omModelStr,
        },
      };
      this.statusComponent?.update(this.state.footer);
    }

    // Seed the meter from the resumed/estimated context before the first run.
    this.syncContextMeter();
    this.statusComponent?.update(this.state.footer);

    // Subscribe to event feed
    this.subscribeToSessionEvents();

    // `--resume`: open the session picker as soon as the UI is usable.
    if (this.options.openResumePicker) {
      const context = await this.buildCommandContext();
      if (context) await executeResumeSessionCommand(context);
    }
  }

  /** Replays stored entries through the live reducer and redraws the bounded transcript. */
  private renderHistory(entries: readonly SessionEntry[]): void {
    const uiEntries = entriesToUiEntries(entries, this.state.maxEntries);
    this.streamComponent?.clear();
    for (const entry of uiEntries) {
      this.streamComponent?.appendOrUpdate(entry);
    }
    this.state = tuiReducer(this.state, {
      type: "reset_session",
      sessionId: this.session?.id ?? this.state.sessionId ?? "",
      entries: uiEntries,
    });
    this.todoComponent?.update(this.state.todos);
  }

  /**
   * Adopts the model of the last run recorded in the session when that provider is still
   * shipped; otherwise keeps the configured model and says so once.
   */
  private applyResumedModel(entries: readonly SessionEntry[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.kind !== "model_change" || !entry.model) continue;
      const model = entry.model;
      if (model.provider === this.selection.model.provider && model.model === this.selection.model.model) return;
      if (!getShippedProvider(model.provider)) {
        this.notify(
          `Session used ${model.provider}/${model.model}, which is not available; keeping ${this.selection.model.provider}/${this.selection.model.model}.`,
        );
        return;
      }
      this.selection = { ...this.selection, model };
      const effort = validateThinkingLevel(model, this.selection.effort);
      this.selection = { ...this.selection, effort };
      this.state = {
        ...this.state,
        footer: { ...this.state.footer, provider: model.provider, model: model.model, effort },
      };
      this.statusComponent?.update(this.state.footer);
      return;
    }
  }

  /**
   * First-run onboarding: provider picker -> credential entry/OAuth -> model picker, with no agent constructed.
   * Returns the chosen model, or `undefined` when the operator escapes the provider picker.
   * Cancelled credential entry returns to the provider picker instead of dropping the operator out.
   */
  async onboardProvider(): Promise<ModelConfig | undefined> {
    await this.ensureUi();

    const picker = this.pickerComponent;
    const stream = this.streamComponent;
    const status = this.statusComponent;
    if (!picker || !stream || !status) return undefined;

    const store = this.options.store ?? resolveSessionStore(this.config);
    const context: CommandContext = {
      state: this.state,
      picker,
      stream,
      status,
      credentialManager: this.credentialManager,
      currentModel: this.currentModel,
      config: this.config,
      store,
      onUpdateState: (patch) => {
        this.state = { ...this.state, ...patch };
        this.syncSelectionEffort();
      },
      onUpdateModel: (model) => {
        this.selection = { ...this.selection, model };
      },
      promptSecret: (promptText) => this.promptSecret(promptText),
    };

    for (;;) {
      const result = await handleSlashCommand("/provider", context);
      if (result.message === "provider_selection_cancelled") return undefined;

      // Gate on the command completing plus a usable provider, not on a model change: /provider keeps
      // a model that is already pinned for the selected provider, so requiring a model change (the
      // old `applied` flag) looped the picker forever after a successful login.
      const completed = result.message === undefined;
      if (
        completed &&
        (await hasUsableProvider({ ...this.config, model: this.currentModel }, { credentialManager: this.credentialManager }))
      ) {
        return this.currentModel;
      }

      const desc = getShippedProvider(this.currentModel.provider);
      const hints = desc && desc.envVars.length > 0 ? desc.envVars.join(" or ") : undefined;
      this.notify(
        hints
          ? `No usable credentials for ${desc?.name ?? this.currentModel.provider} yet. Set ${hints}, or pick another provider.`
          : "No usable provider selected yet. Pick another provider, or press Esc to exit.",
      );
    }
  }

  /** Recomputes MCP footer counts from the plane's cached status (no network calls). */
  refreshMcpFooter(): void {
    const status = this.definition?.mcp.status ?? [];
    this.state = {
      ...this.state,
      footer: {
        ...this.state.footer,
        connectedMcpCount: status.filter((server) => server.state === "connected").length,
        mcpTotalCount: status.length,
        mcpFailedCount: status.filter((server) => server.state === "failed").length,
      },
    };
    this.statusComponent?.update(this.state.footer);
  }

  /**
   * Mirrors `session.contextMeter()` into the footer. Reuses the session's cached assembly estimate
   * (no extra tokenization) and skips the state/render update while the reading is unchanged, so the
   * meter never repaints twice for one frame.
   */
  syncContextMeter(): void {
    if (!this.session) return;
    let meter: ReturnType<AgentSession["contextMeter"]>;
    try {
      meter = this.session.contextMeter();
    } catch {
      return;
    }
    const key = `${meter.inputTokens}:${meter.inputCap ?? ""}:${meter.source}`;
    if (key === this.lastContextMeterKey) return;
    this.lastContextMeterKey = key;
    this.state = tuiReducer(this.state, {
      type: "set_footer",
      footer: {
        contextTokens: meter.inputTokens,
        contextCap: meter.inputCap,
        contextSource: meter.source,
      },
    });
  }

  /** Host-owned session tool control for `/mcp disable|enable`; the registry is read per run. */
  private mcpSessionControl(): McpSessionControl {
    return {
      disabled: this.mcpSessionDisabled,
      disable: (serverId) => {
        const registry = this.toolRegistry();
        if (!registry?.unregister) return { error: "Session MCP tool control is unavailable in this session." };
        const tools = this.definition?.mcp.getServerTools(serverId) ?? [];
        if (tools.length === 0) return { error: `MCP server "${serverId}" has no tools to disable.` };
        let removed = 0;
        for (const tool of tools) if (registry.unregister(tool.name)) removed++;
        this.mcpSessionDisabled.add(serverId);
        return { removed };
      },
      enable: (serverId) => {
        const registry = this.toolRegistry();
        if (!registry) return { error: "Session MCP tool control is unavailable in this session." };
        const tools = this.definition?.mcp.getServerTools(serverId) ?? [];
        for (const tool of tools) registry.register(tool);
        this.mcpSessionDisabled.delete(serverId);
        return { restored: tools.length };
      },
    };
  }

  private toolRegistry(): ToolRegistry | undefined {
    const tools = this.definition?.agent.config.tools;
    return tools && !Array.isArray(tools) ? (tools as ToolRegistry) : undefined;
  }

  /** Appends an operator-facing system message (never a secret). */
  notify(text: string): void {
    this.streamComponent?.appendOrUpdate({
      id: `notice_${Date.now()}`,
      type: "message",
      role: "system",
      text,
      finished: true,
    });
  }

  /** One-time picker for the durable store; only valid after the UI is up. */
  async promptCredentialStoreChoice(): Promise<PrismCodeCredentialStoreChoice | undefined> {
    await this.ensureUi();
    if (!this.pickerComponent) return undefined;
    const selected = await this.pickerComponent.show("Where should Prism Code save credentials?", [
      { name: "Save to owner-only auth.json in the Prism home", value: "file", description: "Plaintext, 0600, owner-only" },
      { name: "Encrypted file", value: "encrypted-file", description: "Passphrase each launch" },
      { name: "Don't save", value: "memory", description: "This session only" },
    ]);
    return selected?.value as PrismCodeCredentialStoreChoice | undefined;
  }

  /** Masked single-line secret prompt; resolves `undefined` on Escape. Never echoes the secret. */
  promptSecret(label: string): Promise<string | undefined> {
    // Not `async`: when the UI already exists the prompt must be visible before this call returns,
    // so an immediate keypress (paste/typing/Escape) is routed to the mask.
    return this.uiReady ? this.beginSecretPrompt(label) : this.ensureUi().then(() => this.beginSecretPrompt(label));
  }

  private beginSecretPrompt(label: string): Promise<string | undefined> {
    if (!this.secretInputComponent) {
      throw new Error("Secret input is unavailable before the TUI is initialized.");
    }
    return this.secretInputComponent.show(label);
  }

  private async switchSession(newSession: AgentSession, initialEntries?: readonly SessionEntry[]): Promise<void> {
    this.session = newSession;
    this.currentAbortController = undefined;

    if (initialEntries && initialEntries.length > 0) {
      this.renderHistory(initialEntries);
      this.applyResumedModel(initialEntries);
    } else {
      this.streamComponent?.clear();
      this.state = tuiReducer(this.state, {
        type: "reset_session",
        sessionId: newSession.id,
        entries: [],
      });
    }

    if (this.omCoordinator) {
      const omState = await this.omCoordinator.loadSessionState(newSession.id, this.store);
      const omModelStr = omState.workerModel ? `${omState.workerModel.provider}/${omState.workerModel.model}` : undefined;
      this.state = {
        ...this.state,
        footer: {
          ...this.state.footer,
          omEnabled: omState.enabled,
          omModel: omModelStr,
        },
      };
    }

    this.statusComponent?.update(this.state.footer);
    this.todoComponent?.update(this.state.todos);
    this.syncContextMeter();
    this.statusComponent?.update(this.state.footer);
    this.subscribeToSessionEvents();
    this.inputComponent?.focus();
  }

  private subscribeToSessionEvents(): void {
    if (!this.session) return;
    const session = this.session;

    void (async () => {
      try {
        for await (const event of session.subscribe({ acrossRuns: true })) {
          if (this.isDestroyed || this.session !== session) break;
          const previousEntries = this.state.entries;
          const previousFooter = this.state.footer;
          this.state = tuiReducer(this.state, { type: "session_event", event });
          if (previousEntries !== this.state.entries && this.streamComponent) {
            const last = this.state.entries.at(-1);
            for (const id of this.state.changedEntryIds) {
              const entry = last?.id === id ? last : this.state.entries.find((item) => item.id === id);
              if (entry) this.streamComponent.appendOrUpdate(entry);
            }
          }
          this.todoComponent?.update(this.state.todos);
          // Reported usage and manual compaction both move the next-request context reading.
          if (event.type === "provider_turn_finished" || (event.type === "compaction_finished" && event.runId === undefined)) {
            this.syncContextMeter();
          }
          if (previousFooter !== this.state.footer && this.statusComponent) {
            this.statusComponent.update(this.state.footer);
          }
        }
      } catch {
        // Session closed or subscription ended
      }
    })();
  }

  private async buildCommandDrivers(): Promise<CommandDrivers> {
    return {
      startRun: async (input, options) => {
        if (!this.session) throw new Error("No active session");
        await this.ensureProvider();
        const session = this.omCoordinator
          ? await this.omCoordinator.getActiveSession(this.session, this.currentModel, this.store)
          : this.session;
        return session.run(input, selectionRunOptions(this.selection, this.providerCache, options ?? {}));
      },
      startWorkflow: async () => {
        throw new Error("workflow drivers are not supported in Prism Code");
      },
      steer: (_runId, input) => {
        this.session?.steer(input);
      },
    };
  }

  /** Builds the slash-command context once, shared by prompt submission and `--resume`. */
  private async buildCommandContext(): Promise<CommandContext | undefined> {
    if (!this.pickerComponent || !this.streamComponent || !this.statusComponent) return undefined;
    const store = this.store ?? this.options.store ?? this.definition?.agent.config.store ?? resolveSessionStore(this.config);
    return {
      state: this.state,
      picker: this.pickerComponent,
      stream: this.streamComponent,
      status: this.statusComponent,
      credentialManager: this.credentialManager,
      providerCache: this.providerCache,
      promptSecret: (promptText) => this.promptSecret(promptText),
      refreshMcpFooter: () => this.refreshMcpFooter(),
      mcpSession: this.mcpSessionControl(),
      requestExit: (code) => void this.shutdown(code ?? 0),
      webResolution: (this.definition as unknown as { webResolution?: WebToolResolution } | undefined)?.webResolution,
      currentModel: this.currentModel,
      session: this.session,
      definition: this.definition,
      config: this.config,
      store,
      approval: this.options.approvalController,
      omCoordinator: this.omCoordinator,
      commandDrivers: await this.buildCommandDrivers(),
      onUpdateState: (patch) => {
        this.state = { ...this.state, ...patch };
        this.syncSelectionEffort();
        if (patch.footer) this.notifySelectionChange();
      },
      onUpdateModel: (model) => {
        this.selection = { ...this.selection, model };
      },
      onSwitchSession: async (newSession, initialEntries) => {
        await this.switchSession(newSession, initialEntries);
      },
    };
  }

  private notifySelectionChange(): void {
    this.options.onSelectionChange?.({ model: this.selection.model, effort: this.selection.effort });
  }

  private async handlePromptSubmit(text: string): Promise<void> {
    if (!this.session || this.isDestroyed) return;

    // Intercept slash commands (e.g. /provider, /model, /new, /resume, /compact, /wiki-*)
    if (text.trim().startsWith("/")) {
      const userEntry = {
        id: `user_cmd_${Date.now()}`,
        type: "message" as const,
        role: "user" as const,
        text,
        finished: true,
      };
      this.streamComponent?.appendOrUpdate(userEntry);

      const context = await this.buildCommandContext();
      if (context) await handleSlashCommand(text, context);
      return;
    }

    if (this.state.isRunning) {
      // Steer: user submitted while a run is in progress
      try {
        this.session.steer(text);
        const steerEntry = {
          id: `steer_${Date.now()}`,
          type: "message" as const,
          role: "user" as const,
          text: `[steer] ${text}`,
          finished: true,
        };
        this.streamComponent?.appendOrUpdate(steerEntry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.streamComponent?.appendOrUpdate({
          id: `steer_err_${Date.now()}`,
          type: "error" as const,
          message: `Steer failed: ${message}`,
        });
      }
      return;
    }

    // Normal run prompt. `@path` mentions become bounded attachments on the same user message.
    const attachmentInput = buildPromptInput(text, this.config.cwd);
    if (attachmentInput.skipped.length > 0) {
      this.notify(`Skipped attachment(s), not readable inside the repository: ${attachmentInput.skipped.join(", ")}`);
    }
    this.state = tuiReducer(this.state, { type: "user_prompt", text });
    const userEntry = this.state.entries.at(-1);
    if (userEntry && this.streamComponent) {
      this.streamComponent.appendOrUpdate(userEntry);
    }

    // First prompt names the session (redacted like the message entry); `/rename` can change it later.
    if (this.store) {
      const redactor = this.definition?.agent.config.redactor;
      const title = deriveSessionTitle(redactor ? redactor.redact(text) : text);
      if (title) {
        try {
          await setSessionTitle(this.store, this.session.id, title, { onlyIfUnset: true });
        } catch {
          // Titles are display-only; a failed metadata write must not block the run.
        }
      }
    }

    this.currentAbortController = new AbortController();

    try {
      await this.ensureProvider();
      const runOpts: RunOptions = selectionRunOptions(this.selection, this.providerCache, {
        signal: this.currentAbortController.signal,
      });
      // Wiki guidance (and any other host injectors) rides the same run options as the CLI.
      const wikiContributions = (this.definition as any).wikiContributions as WikiContributions | undefined;
      const finalRunOpts =
        wikiContributions && wikiContributions.instructionInjectors.length > 0
          ? { ...runOpts, instructionInjectors: wikiContributions.instructionInjectors }
          : runOpts;
      const sessionToRun = this.omCoordinator
        ? await this.omCoordinator.getActiveSession(this.session, this.currentModel, this.store)
        : this.session;
      const run = sessionToRun.run(attachmentInput.input, finalRunOpts);
      this.activeRun = run;
      await run;
    } catch (error) {
      if (!this.isDestroyed) {
        const message = error instanceof Error ? error.message : String(error);
        this.streamComponent?.appendOrUpdate({
          id: `run_err_${Date.now()}`,
          type: "error" as const,
          message,
        });
      }
    } finally {
      this.currentAbortController = undefined;
      this.activeRun = undefined;
      this.lastCtrlCAt = 0;
      this.state = tuiReducer(this.state, { type: "run_finished" });
    }
  }

  // --- Inline completion (slash commands and @file paths) -------------------------------

  /** Recomputes the popup from the buffer; printable keys are not consumed, so the editor keeps typing. */
  private updateCompletion(): void {
    if (this.suppressCompletion || this.isDestroyed || !this.inputComponent || !this.pickerComponent) {
      return;
    }
    const text = this.inputComponent.getText();
    const match = completionContext(text, this.inputComponent.textarea.cursorOffset);
    if (!match) {
      this.hideCompletion();
      return;
    }

    const options = this.completionOptions(match);
    if (options.length === 0) {
      this.hideCompletion();
      return;
    }
    this.completionMatch = match;
    this.completionActive = true;
    const title = match.kind === "command" ? "Commands" : "Repository files";
    if (this.pickerComponent.isVisible) {
      this.pickerComponent.setOptions(options, title);
    } else {
      void this.pickerComponent.show(title, options);
    }
  }

  private completionOptions(match: CompletionContext): UiPickerOption[] {
    if (match.kind === "command") {
      const extensionItems = (this.definition?.commands ?? []).map((command) => ({
        name: `/${command.name}`,
        value: `/${command.name}`,
        matchKey: command.name,
        description: command.description ?? "custom command",
      }));
      const coreItems = CORE_SLASH_COMMANDS.map((command) => ({
        name: command.name,
        value: command.name,
        matchKey: command.name.replace(/^\//, ""),
        description: command.description,
      }));
      return filterCompletionItems([...coreItems, ...extensionItems], match.query).map((item) => ({
        name: item.name,
        value: item.value,
        ...(item.description ? { description: item.description } : {}),
      }));
    }
    return filterFileIndex(this.ensureFileIndex(), match.query).map((entry) => ({
      name: entry.path,
      value: `@${entry.path}`,
    }));
  }

  private ensureFileIndex(): FileIndexEntry[] {
    const now = Date.now();
    if (this.fileIndex.length === 0 || now - this.fileIndexLoadedAt > 60_000) {
      this.fileIndex = loadRepoFileIndex(this.config.cwd);
      this.fileIndexLoadedAt = now;
    }
    return this.fileIndex;
  }

  /** Tab/Enter accepted the popup: replace the typed prefix with the selected value. */
  private acceptCompletion(): boolean {
    const selected = this.pickerComponent?.selectedOption;
    const match = this.completionMatch;
    this.hideCompletion();
    if (!selected || !match || !this.inputComponent) return true;
    const text = this.inputComponent.getText();
    const next = `${text.slice(0, match.start)}${selected.value}${text.slice(match.end)}`;
    this.suppressCompletion = true;
    try {
      this.inputComponent.setText(next);
    } finally {
      this.suppressCompletion = false;
    }
    this.inputComponent.focus();
    return true;
  }

  private hideCompletion(): void {
    if (!this.completionActive) return;
    this.completionActive = false;
    this.completionMatch = undefined;
    this.pickerComponent?.hide();
  }

  private wireKeybindings(): void {
    const renderer = this.renderer;

    this.keyListener = (key) => {
      if (this.isDestroyed) return;

      // 0. Masked secret prompt takes every key while active
      if (this.secretInputComponent?.isVisible) {
        this.secretInputComponent.handleKey(key);
        return;
      }

      // 0a. Inline completion popup owns Tab/Enter/Esc/Up/Down; printable keys still reach the
      // textarea and `onContentChange` refreshes the popup from the buffer.
      if (this.completionActive) {
        if (key.name === "tab" || key.name === "return" || key.name === "enter") {
          key.preventDefault();
          this.acceptCompletion();
          return;
        }
        if (key.name === "escape") {
          key.preventDefault();
          this.hideCompletion();
          return;
        }
        if (key.name === "up") {
          key.preventDefault();
          this.pickerComponent?.moveUp();
          return;
        }
        if (key.name === "down") {
          key.preventDefault();
          this.pickerComponent?.moveDown();
          return;
        }
      }

      // 1. If approval prompt is active, route key to approval component
      if (this.approvalComponent?.isPrompting) {
        if (this.approvalComponent.handleKey(key.name)) {
          return;
        }
      }

      // 2. If picker is visible, route navigation & search filter keys
      if (this.pickerComponent?.isVisible && !this.completionActive) {
        if (this.pickerComponent.handleKey(key)) {
          return;
        }
      }

      // 3. Shift+Tab: model-aware reasoning effort control (writes the one selection value)
      if (key.name === "tab" && key.shift) {
        const reasoning = this.currentModel.capabilities?.reasoning;
        const declaredLevels = this.currentModel.capabilities?.thinkingLevels;

        if (reasoning === false) {
          // Non-reasoning model: show 'off' and do not cycle
          this.setEffort("off");
          return;
        }

        if (!declaredLevels || declaredLevels.length === 0) {
          // Capability declares no levels: do not invent a list, show 'unavailable' and do not cycle
          this.setEffort("unavailable");
          return;
        }

        // Declared levels cycle in declared order and wrap
        this.setEffort(cycleThinkingLevel(this.currentModel, this.selection.effort));
        return;
      }

      // 3a. Ctrl+T: expand/collapse thinking blocks; Ctrl+O: expand/collapse the last tool card
      if (key.ctrl && key.name === "t") {
        key.preventDefault();
        this.streamComponent?.toggleThinking();
        return;
      }
      if (key.ctrl && key.name === "o") {
        key.preventDefault();
        this.streamComponent?.toggleLastToolCard();
        return;
      }

      // 3b. Trailing backslash + Enter continues the line instead of submitting.
      if (key.name === "return" && !key.shift && !key.meta) {
        if (this.inputComponent?.continueLine()) {
          key.preventDefault();
          return;
        }
      }

      // 4. Escape: cancel active run without quitting app
      if (key.name === "escape") {
        if (this.state.isRunning && this.currentAbortController) {
          this.currentAbortController.abort("Run cancelled by user via Escape");
          this.streamComponent?.appendOrUpdate({
            id: `cancel_${Date.now()}`,
            type: "error" as const,
            message: "Run cancelled by user (ESC)",
          });
          return;
        }
      }

      // 5. Ctrl+C: clear input, abort a running turn, or quit
      if (key.ctrl && key.name === "c") {
        const now = Date.now();
        if (this.inputComponent && this.inputComponent.getText().length > 0) {
          this.inputComponent.clear();
          this.lastCtrlCAt = now;
          return;
        }
        if (this.state.isRunning && this.currentAbortController) {
          // Second Ctrl+C within 2 s of the abort exits instead of aborting again.
          if (now - this.lastCtrlCAt < 2_000 && this.lastCtrlCAt > 0) {
            void this.close().then(() => {
              this.options.onExit?.(0);
            });
            return;
          }
          this.currentAbortController.abort("Run cancelled by user (Ctrl+C)");
          this.streamComponent?.appendOrUpdate({
            id: `cancel_ctrlc_${now}`,
            type: "error" as const,
            message: "Run cancelled by user (Ctrl+C)",
          });
          this.lastCtrlCAt = now;
          return;
        }
        // Empty buffer and idle -> graceful quit
        void this.close().then(() => {
          this.options.onExit?.(0);
        });
        return;
      }

      // 6. Ctrl+D: graceful quit
      if (key.ctrl && key.name === "d") {
        this.close().then(() => {
          this.options.onExit?.(0);
        });
        return;
      }

      // 7. Up / Down history navigation from the first/last buffer line
      if (this.inputComponent && !this.completionActive) {
        if (key.name === "up" && this.inputComponent.isCursorOnFirstLine) {
          key.preventDefault();
          this.inputComponent.historyPrevious();
          return;
        }
        if (key.name === "down" && this.inputComponent.isCursorOnLastLine) {
          key.preventDefault();
          this.inputComponent.historyNext();
          return;
        }
      }
    };

    renderer.keyInput.on("keypress", this.keyListener);

    // Paste is delivered to focused editables by default; while a secret prompt is active it belongs
    // to the mask, and oversized editor pastes collapse to a token instead of flooding the buffer.
    this.pasteListener = (event) => {
      if (this.secretInputComponent?.isVisible) {
        event.preventDefault();
        this.secretInputComponent.handlePaste(event.bytes);
        return;
      }
      if (this.inputComponent?.handlePaste(event.bytes)) {
        event.preventDefault();
      }
    };
    renderer.keyInput.on("paste", this.pasteListener);

    this.uncaughtListener = (error) => {
      void this.shutdown(1, error);
    };
    this.rejectionListener = (reason) => {
      void this.shutdown(1, reason);
    };
    this.sigtermListener = () => {
      void this.shutdown(143);
    };
    this.sighupListener = () => {
      void this.shutdown(129);
    };
    process.on("uncaughtException", this.uncaughtListener);
    process.on("unhandledRejection", this.rejectionListener);
    process.on("SIGTERM", this.sigtermListener);
    process.on("SIGHUP", this.sighupListener);
  }

  /** Resolves the `ask_user_decision` tool through the picker; Escape is a model-visible decline. */
  async promptAskUserDecision(request: AskUserDecisionRequest): Promise<AskUserDecisionAnswer> {
    if (!this.pickerComponent || this.isDestroyed) {
      throw new Error("user declined to answer: no interactive picker is available");
    }
    const options = request.options.map((option) => ({
      name: option.label,
      value: option.id,
      description: `pro: ${option.pros[0] ?? ""} | con: ${option.cons[0] ?? ""}`,
    }));
    const selected = await this.pickerComponent.show(request.question, options);
    if (!selected) {
      throw new Error("user declined to answer (Esc)");
    }
    if (request.selectionMode === "multiple") {
      return { selectedIds: [selected.value] };
    }
    return { selectedId: selected.value };
  }

  /** Asks once per repo and server fingerprint whether a project MCP server may run; Esc skips. */
  async promptMcpTrust(server: PrismCodeMcpServer): Promise<boolean> {
    await this.ensureUi();
    if (!this.pickerComponent) return false;
    const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
    const selected = await this.pickerComponent.show(`Trust MCP server "${server.serverId}" for this repository?`, [
      { name: "Trust", value: "trust", description: target },
      { name: "Skip", value: "skip", description: "Do not connect this server" },
    ]);
    return selected?.value === "trust";
  }

  async promptApproval(request: CodingApprovalRequest): Promise<ApprovalDecision> {
    if (!this.approvalComponent || this.isDestroyed) {
      return "deny"; // Fail closed
    }

    const action = request.action;
    const pathsSummary = action.paths && action.paths.length > 0 ? ` [${action.paths.join(", ")}]` : "";
    const commandSummary = action.command ? ` $ ${action.command}` : "";
    const summary = `${action.kind}: ${action.operation}${pathsSummary}${commandSummary}`;

    const patch = this.findPendingPatch(action.kind);
    return await this.approvalComponent.prompt({
      toolName: typeof action.metadata?.toolName === "string" ? action.metadata.toolName : action.kind,
      actionKind: action.kind,
      operation: action.operation,
      summary,
      ...(patch ? { patch } : {}),
    });
  }

  /**
   * The proposal diff for the tool awaiting approval. The runtime emits `tool_execution_started`
   * (with full arguments) before it awaits the approval policy, so the matching running card is
   * normally already in TUI state; a miss just means the prompt renders without a diff.
   */
  private findPendingPatch(actionKind: string): string | undefined {
    const candidates = actionKind === "git" ? ["git_apply"] : [actionKind];
    for (let index = this.state.entries.length - 1; index >= 0; index--) {
      const entry = this.state.entries[index];
      if (entry.type !== "tool_call" || entry.status !== "running" || entry.patch === undefined) continue;
      if (candidates.includes(entry.name)) return entry.patch;
    }
    return undefined;
  }

  private shutdown(code: number, reason?: unknown): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      try {
        await this.close();
        if (reason !== undefined) {
          const error = reason instanceof Error ? reason : new Error(String(reason));
          process.stderr.write(`prism-code: ${process.env.PRISM_DEBUG === "1" ? (error.stack ?? error.message) : error.message}\n`);
        }
      } catch (error) {
        process.stderr.write(`prism-code: shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        if (this.options.onExit) this.options.onExit(code);
        else process.exit(code);
      }
    })();
    return this.shutdownPromise;
  }

  async close(): Promise<void> {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.uncaughtListener) process.off("uncaughtException", this.uncaughtListener);
    if (this.rejectionListener) process.off("unhandledRejection", this.rejectionListener);
    if (this.sigtermListener) process.off("SIGTERM", this.sigtermListener);
    if (this.sighupListener) process.off("SIGHUP", this.sighupListener);

    if (this.approvalComponent) {
      this.approvalComponent.cancel();
    }

    if (this.secretInputComponent) {
      this.secretInputComponent.cancel();
    }
    this.pickerComponent?.hide();

    if (this.currentAbortController) this.currentAbortController.abort("TUI closed");
    this.session?.abort(new Error("TUI closed"));

    if (this._renderer) {
      try {
        this._renderer.destroy();
      } catch {
        // Ignore secondary teardown errors
      }
    }
    this.syntaxStyle?.destroy();
    this.syntaxStyle = undefined;
    // A cancelled run must settle its durable append before we close the session or exit.
    await this.activePrompt?.catch(() => undefined);
    await this.activeRun?.catch(() => undefined);
    await this.session?.close();
  }
}

export function createPrismCodeTui(options?: PrismCodeTuiOptions): PrismCodeTui {
  return new PrismCodeTui(options);
}
