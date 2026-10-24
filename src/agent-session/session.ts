/** session (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */

import { ActiveDurableRun, pendingDecisionsOf, resolveRunDecisions } from "../agent-approval.js";
import { restoreRunSessionState } from "../agent-run-restore.js";
import type { PendingToolCall, StoredAgentRunState } from "../agent-run-state.js";
import { agentFingerprint, saveAgentRunState } from "../agent-run-state.js";
import { createMemoryRunStateCell, type DurableRunStateOptions } from "../run-state-cell.js";
import { isCompactionEntryData } from "../compaction.js";
import type {
  Agent,
  AgentEvent,
  AgentEventRecord,
  AgentRunState,
  AgentRunStatus,
  CompactionOptions,
  CompactionResult,
  ContextMeter,
  Decision,
  ErrorInfo,
  JsonValue,
  Message,
  ModelProvider,
  OwnershipScope,
  PendingDecision,
  PromptVersionRef,
  ProviderRequest,
  ResolvedRunOptions,
  RunLedger,
  RunOptions,
  RunResult,
  Session,
  SessionBranchRead,
  SessionEntry,
  SessionLinks,
  SessionForkOptions,
  SessionOptions,
  SessionStore,
  Skill,
  SteerOptions,
  SubscribeOptions,
  ToolCallSummary,
  ToolDefinition,
  ToolEffectStore,
  Usage,
} from "../contracts.js";
import {
  AgentDecisionError,
  AgentRunStateError,
  assertSessionLinks,
  DEFAULT_MAX_PENDING_STEER_BYTES,
  DEFAULT_MAX_PENDING_STEERS,
  DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
  resolveShouldCompact,
  SESSION_LINKS_DATA_KEY,
  SessionNotFoundError,
  toRunResultStatus,
} from "../contracts.js";
import { createHookBus, type HookBus, } from "../hooks/index.js";
import type { Principal } from "../contracts-core/principal.js";
import type { AgentInput } from "../input.js";
import type { LoopStrategy } from "../loop/index.js";
import { estimateAssemblyTokens, estimateMessageTokens, estimateTextTokens, resolveInputCap } from "../models/estimate.js";
import { resolveRunOptions } from "../models/ref.js";
import { type Capability, requireCapability } from "../packages/capabilities.js";
import {
  errorToErrorInfo,
  redactAgentEvent,
  redactProviderRequest,
  redactRunLedgerRecord,
  redactSecrets,
  redactSessionEntry,
  type SecretRedactor,
} from "../redaction.js";
import { type RunLimitTracker, resolveBackgroundSettleMs } from "../run-limits.js";
import { type BackgroundTracker, createBackgroundTracker } from "../session/background.js";
import { createExternalState, type ExternalStateHandle } from "../session/external-state.js";
import { bindSessionState, type PackageStateData, SessionStateStore } from "../session/state.js";
import type { SessionContext } from "../session-context.js";
import type { SessionContextSnapshot } from "../session-stores.js";
import { narrowScope } from "../agent/sessions.js";
import { createSessionEntry, entriesInScope, getSessionBranchEntries, rebuildSessionContext } from "../session-stores.js";
import { createLoadedSkillSet } from "../skill-disclosure.js";
import type { LoadedSkillBodiesEntry } from "../skill-load.js";
import { validateLoadedSkillBodies } from "../skill-load.js";
import { resolveAllActiveSkills } from "../skills.js";
import { createSlotDefaults, createSlotRegistry, type SlotRegistry } from "../slots/index.js";
import { pendingSuspensionOf, type SuspendedRunEntryData } from "../suspended-run.js";
import { tryAgentRuntime } from "./create-agent.js";
import { EventSubscriber } from "./event-subscriber.js";
import {
  finalAssistantMessage,
  inputToMessages,
  mergeCompaction,
  messageTextBytes,
  randomId,
  SteerSoftInterrupt,
  throwIfAborted,
  throwIfAbortedSignal,
  withoutTrailingInput,
} from "./helpers.js";
import { agentSkillSource } from "./runtime-registry.js";
import { executeRun } from "./session/assemble.js";
import { asSessionHost } from "./session/types.js";

export class RuntimeAgentSession implements Session {
  readonly id: string;
  private readonly agent: Agent;
  /** Plan 177 Task 4: the agent's scope narrowed by `SessionOptions.ownership`; every run narrows it further. */
  readonly scope: OwnershipScope | undefined;
  private readonly metadata?: Readonly<Record<string, unknown>>;
  private readonly store: SessionStore;
  private readonly subscribers = new Set<EventSubscriber>();
  /** Plan 106 R2: `session_start` is dispatched at the first run start, once per runtime session. */
  private currentLeafId?: string;
  private history: Message[] = [];
  private activeRun?: AbortController;
  private activeRunId?: string;
  private activeProviderTurnAbort?: AbortController;
  pendingSoftInterrupt = false;
  private pendingSteers: Message[] = [];
  private readonly steerListeners = new Set<() => void>();
  private pendingSteerBytes = 0;
  private activeRedactor?: SecretRedactor;
  activeProvider?: ModelProvider;
  private activeLedger?: RunLedger;
  activeEffectStore?: ToolEffectStore;
  private activeOwnership?: OwnershipScope;
  activePrincipal?: Principal;
  private activeIdempotencyKey?: string;
  /** Messages the active run appended to the branch (as stored, after redaction); reset at each run start. */
  activeRunMessages: Message[] = [];
  activeMetadata?: Readonly<Record<string, unknown>>;
  activePromptVersion?: PromptVersionRef;
  activeLimits?: RunLimitTracker;
  /** Plan 091 T2: input tokens of the latest provider turn plus whether the provider reported
   *  them; set by the usage seam, read by `contextMeter()`. */
  activeInputMeter?: { readonly tokens: number; readonly source: "reported" | "estimated" };
  /** Bounded last-N tool-call summaries of the active run (plan 087 T2): ids, names, arg hashes. */
  activeRecentToolCalls?: ToolCallSummary[];
  activeLimitOutputBuffer = false;
  activeDurable?: ActiveDurableRun;
  activeLoop?: LoopStrategy;
  activeLoopHistory?: Message[];
  /** Gated calls of the current tool round awaiting one collected suspension. */
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn = 1;
  private readonly loadedSkills = createLoadedSkillSet();
  /** Run-owned only: loaded bodies and URI resources retain first insertion order within one provider loop. */
  readonly tailSegments = new Map<string, Message>();
  /** Plan 018 Task 6 (closeout `checkpoint-bodies`): persisted exact instructions, registry-independent. */
  restoredSkillBodies: readonly LoadedSkillBodiesEntry[] = [];
  /** Skills of the current run (for the bodies snapshot); replaced at each run start. */
  activeRunSkills: readonly import("../contracts.js").Skill[] = [];
  /** Per-run tool allow-list (Task 21); undefined means the full registered set. */
  activeToolNames?: readonly string[];
  /** Plan 015 Task 4: re-add persisted loaded-skill names (names only; bodies re-resolve on demand). */
  restoreLoadedSkills(names: readonly string[], runId?: string): void {
    for (const name of names) this.loadedSkills.add(name, runId);
  }

  /** Plan 137 Task 3: loaded skill names currently active in this session. */
  getLoadedSkillNames(): readonly string[] {
    return this.loadedSkills.list();
  }

  /** Plan 018 Task 6: restore persisted loaded-skill bodies (already validated fail-closed at load). */
  restoreLoadedSkillBodies(bodies: readonly LoadedSkillBodiesEntry[], runId?: string): void {
    validateLoadedSkillBodies(bodies);
    this.restoredSkillBodies = bodies;
    for (const entry of bodies) this.loadedSkills.add(entry.name, runId);
  }

  private ledgerChain: Promise<void> = Promise.resolve();
  private ledgerFailure: unknown;
  private snapshotGeneration = 0;
  private snapshotCache?: {
    readonly leafId?: string;
    readonly generation: number;
    readonly expiresAt: number;
    readonly value: SessionContextSnapshot;
  };
  private readonly snapshotCacheTtlMs: number;
  /**
   * Plan 103 T4: identity-keyed meter cache. Holds only the last public meter value
   * plus the identity of everything the cold read consumed (`snapshotGeneration`,
   * leaf, active meter/limits, and the history array reference + length, which catches
   * in-place `history.push` during a run) — never history content, never an estimator.
   */
  private meterCache?: {
    readonly leafId?: string;
    readonly generation: number;
    readonly meter?: { readonly tokens: number; readonly source: "reported" | "estimated" };
    readonly limits?: RunLimitTracker;
    readonly history: readonly Message[];
    readonly historyLength: number;
    readonly value: ContextMeter;
  };

  /** Host hook bus (roadmap §2.4); per-agent, shared across this agent's sessions. */
  private readonly hookBusInstance: HookBus;
  /** The same bus, bound so each handler's `context.session` is a view for its registering owner. */
  private readonly boundHooks: HookBus;
  /** Per-owner session views, built once so hook dispatch allocates none. */
  private readonly sessionViews = new Map<string, SessionContext>();
  /** Declared capabilities per package. An owner absent from it (`host`, `kernel`) is unrestricted. */
  private readonly packageCapabilities: ReadonlyMap<string, ReadonlySet<Capability>>;
  /** Tasks started through `SessionContext.background`: reported as events, settled by `close()`. */
  private readonly background: BackgroundTracker;
  /** Package state (`package_state` entries on this branch). Bound to every view this session hands out. */
  private readonly stateStore = new SessionStateStore({
    append: (data) => this.appendPackageState(data),
    ready: () => this.ready(),
    redact: (value) => this.redactBetweenRuns(value),
  });
  private readyPromise?: Promise<void>;
  private closing?: Promise<void>;
  /** Serializes appends, so a state `set` racing a run's own append cannot orphan either entry. */
  private appendTail: Promise<unknown> = Promise.resolve();
  /** Slot registry (roadmap §2.5); direct assignments come from `AgentConfig.slots`. */
  private readonly slotRegistry: SlotRegistry;
  /** Re-entry guard for observe dispatch: an observer that throws on `hook.error` must not loop. */
  private observingHookError = false;
  /** Pending suspended run entry found on session resume (plan 149 Task 2 / Task 4). */
  pendingSuspendedRun?: SuspendedRunEntryData;

  /** `SessionOptions.parent` and `actor`, written once when a new session opens. */
  private readonly links: SessionLinks | undefined;

  constructor(config: SessionOptions & { readonly agent: Agent; readonly store: SessionStore }) {
    this.id = config.id ?? randomId("session");
    this.agent = config.agent;
    this.background = createBackgroundTracker({
      sessionId: this.id,
      emit: (event) => this.emitBetweenRuns(event),
      errorInfo: (error) => this.redactBetweenRuns(errorToErrorInfo(error)),
    });
    const runtime = tryAgentRuntime(config.agent);
    this.hookBusInstance = runtime?.hooks ?? createHookBus();
    this.packageCapabilities = runtime?.packages.capabilities ?? new Map();
    this.boundHooks = this.hookBusInstance.bound((owner) => this.sessionContextFor(owner));
    this.slotRegistry = runtime?.slots ?? createSlotRegistry(createSlotDefaults());
    // `hook.error`/`emit` events raised by a hook route back to this session.
    runtime?.setEventSink((event) => this.emit(event));
    this.metadata = config.metadata;
    this.scope = config.ownership;
    this.links = sessionLinksOption(config);
    this.store = config.store;
    this.currentLeafId = config.leafId;
    this.snapshotCacheTtlMs = resolveSnapshotCacheTtlMs(config.snapshotCacheTtlMs);
    const usageEstimation = config.agent.config.usageEstimation;
    if (usageEstimation !== undefined && usageEstimation !== "fallback" && usageEstimation !== "off" && usageEstimation !== "strict") {
      throw new TypeError('usageEstimation must be "fallback", "off", or "strict"');
    }
  }

  get leafId(): string | undefined {
    return this.currentLeafId;
  }

  /** Host hook bus for this agent (roadmap §2.4). */
  hooks(): HookBus {
    return this.boundHooks;
  }

  /** This session as `owner` sees it. A package without `"background"` gets `capability_missing` from `background(...)`. */
  sessionContextFor(owner: string): SessionContext {
    let view = this.sessionViews.get(owner);
    if (!view) {
      const session = this;
      view = {
        id: this.id,
        get principal() {
          return session.activePrincipal ?? session.agent.config.principal;
        },
        metadata: this.metadata,
        model: this.agent.config.model,
        entries() {
          const declared = session.packageCapabilities.get(owner);
          if (declared) requireCapability(owner, declared, "session-state", "SessionContext.entries");
          return session.entries();
        },
        background(name, task) {
          const declared = session.packageCapabilities.get(owner);
          if (declared) requireCapability(owner, declared, "background", "SessionContext.background");
          session.background.start(declared ? owner : undefined, name, task);
        },
      };
      bindSessionState(view, this.stateStore);
      this.sessionViews.set(owner, view);
    }
    return view;
  }

  /**
   * Reads this session's branch once, so package state is available and `session.opened` can fire. Awaited
   * at run start (which covers resume), in `agent.commands.run`, by `set`, and by `close()`. A session no
   * package or hook cares about reads nothing, so existing sessions cost no extra store read.
   */
  ready(): Promise<void> {
    this.readyPromise ??= this.openSession().catch((error: unknown) => {
      this.readyPromise = undefined;
      throw error;
    });
    return this.readyPromise;
  }

  /**
   * Called eagerly when `agent.session()` opens a new session.
   * Zero store read; marks ready, hydrates empty state, and fires eager `session.opened`.
   */
  async openNewSession(): Promise<void> {
    this.readyPromise = Promise.resolve();
    this.stateStore.hydrate([]);
    // The one metadata write: links are the session's first entry, so `fork` copies them and stores can index them.
    if (this.links) {
      await this.appendEntry({
        id: randomId("entry"),
        sessionId: this.id,
        timestamp: new Date().toISOString(),
        kind: "metadata",
        data: { [SESSION_LINKS_DATA_KEY]: this.links },
      });
    }
    this.observeOnly({ type: "session.opened", sessionId: this.id, runId: "", restored: false });
  }

  /**
   * Called eagerly when `agent.session({ id, create: true })` resumes an existing session.
   * Hydrates package state from branch, finds pending suspended run, and fires eager `session.opened`.
   */
  async openResumedSession(branch: readonly SessionEntry[]): Promise<void> {
    this.readyPromise = Promise.resolve();
    this.currentLeafId = this.currentLeafId ?? branch.at(-1)?.id;
    this.stateStore.hydrate(branch);
    this.pendingSuspendedRun = pendingSuspensionOf(branch);
    this.observeOnly({ type: "session.opened", sessionId: this.id, runId: "", restored: true });
  }

  /** Whether anything needs the branch read: package state, or a `session.opened` hook. */
  private needsOpening(): boolean {
    return tryAgentRuntime(this.agent)?.packages.usesSessionState === true || this.hookBusInstance.has("session.opened");
  }

  private async openSession(): Promise<void> {
    if (!this.needsOpening()) return;
    const branch = await this.entries();
    this.stateStore.hydrate(branch);
    this.pendingSuspendedRun = pendingSuspensionOf(branch);
    this.observeOnly({ type: "session.opened", sessionId: this.id, runId: "", restored: branch.length > 0 });
  }

  /** Re-reads package state for a new leaf. `session.opened` already fired for this session. */
  private async rehydrateState(): Promise<void> {
    // An opened session is always ready, so only a package that holds session state pays the branch read.
    if (this.stateStore.isReady && tryAgentRuntime(this.agent)?.packages.usesSessionState === true)
      this.stateStore.hydrate(await this.entries());
  }

  private async appendPackageState(data: PackageStateData): Promise<void> {
    await this.serialAppend(() =>
      this.appendNow(
        createSessionEntry({
          sessionId: this.id,
          parentId: this.currentLeafId,
          ...(this.activeRunId ? { runId: this.activeRunId } : {}),
          kind: "package_state",
          data,
        }),
      ),
    );
  }

  /** `run.state(key)` for the loop `vendor` (roadmap §2.12.9 K5): an `external_state` log on this branch. */
  externalState(vendor: string, key: string): ExternalStateHandle {
    return createExternalState(
      {
        branch: () => this.entries(),
        write: async (build) => {
          await this.ready();
          await this.serialAppend(async () => {
            const data = build(await this.entries());
            await this.appendNow(
              createSessionEntry({
                sessionId: this.id,
                parentId: this.currentLeafId,
                ...(this.activeRunId ? { runId: this.activeRunId } : {}),
                kind: "external_state",
                data,
              }),
            );
          });
        },
        redact: (value) => this.redactBetweenRuns(value),
      },
      vendor,
      key,
    );
  }

  /** Slot registry for this agent (roadmap §2.5). */
  slots(): SlotRegistry {
    return this.slotRegistry;
  }

  /**
   * Context-fill read (plan 091 T2): the latest provider turn's input tokens —
   * provider-reported when it reported, else a labeled estimate — plus the
   * per-request cap and cumulative run input budget, resolved exactly as
   * `provider_turn_finished.budgets` resolves them. Before any provider turn in
   * this session it estimates stored history, so a non-reporting model still
   * shows a working meter instead of zero. Never billing; estimates are labeled.
   *
   * Plan 103 T4: reads are cached until the history generation, leaf, history
   * length, or active-run identity changes, so a per-frame poll pays one estimate
   * per mutation instead of one per read. The cached value is frozen and is
   * identical (`===`) to the previous read while nothing changed.
   */
  contextMeter(): ContextMeter {
    const cached = this.meterCache;
    if (
      cached &&
      cached.leafId === this.currentLeafId &&
      cached.generation === this.snapshotGeneration &&
      cached.meter === this.activeInputMeter &&
      cached.limits === this.activeLimits &&
      cached.history === this.history &&
      cached.historyLength === this.history.length
    ) {
      return cached.value;
    }
    const value = Object.freeze(this.measureContextMeter());
    this.meterCache = {
      leafId: this.currentLeafId,
      generation: this.snapshotGeneration,
      meter: this.activeInputMeter,
      limits: this.activeLimits,
      history: this.history,
      historyLength: this.history.length,
      value,
    };
    return value;
  }

  /** Cold path of `contextMeter()`: one estimate over stored history plus cap/budget resolution. */
  private measureContextMeter(): ContextMeter {
    const model = this.agent.config.model;
    const inputTokens = this.activeInputMeter?.tokens ?? estimateMessageTokens(this.history, model?.model).tokens;
    const source = this.activeInputMeter?.source ?? "estimated";
    let inputCap: number | undefined;
    try {
      inputCap = model ? resolveInputCap({}, model) : undefined;
    } catch {
      inputCap = undefined; // undialed model: omit instead of throwing a state read
    }
    const runInputBudget = this.activeLimits?.limits.maxInputTokens ?? undefined;
    return {
      inputTokens,
      source,
      ...(inputCap === undefined ? {} : { inputCap }),
      ...(runInputBudget == null ? {} : { runInputBudget }),
      ...(inputCap === undefined ? {} : { usedRatio: inputTokens / inputCap }),
    };
  }

  /**
   * Live events for this session. A run-scoped subscriber (the default) is closed when the run ends,
   * suspends, or is denied; `SubscribeOptions.acrossRuns: true` keeps one subscriber open across runs
   * of the same session until the host closes it, the session tears it down, or its bounded queue
   * overflows under the default policy. Subscribe before `run()`; the consumer loop and `run()` must
   * run concurrently, since events are only emitted during a live run.
   */
  subscribe(options: SubscribeOptions = {}): AsyncIterable<AgentEvent> {
    return this.createSubscriber(options);
  }

  private createSubscriber(options: SubscribeOptions): EventSubscriber {
    const subscriber = new EventSubscriber(this.id, options, () => this.subscribers.delete(subscriber));
    this.subscribers.add(subscriber);
    return subscriber;
  }

  async run(input: AgentInput, options: RunOptions = {}): Promise<RunResult> {
    return this.runInternal(input, resolveRunOptions(options), randomId("run"));
  }

  steer(input: AgentInput, options: SteerOptions = {}): void {
    if (!this.activeRun || !this.activeRunId) throw new Error("Agent session has no active run to steer");
    const messages = inputToMessages(input).map((message) => this.redact(message));
    if (messages.length === 0) throw new Error("steer requires non-empty input");
    let addBytes = 0;
    for (const message of messages) addBytes += messageTextBytes(message);
    if (this.pendingSteers.length + messages.length > DEFAULT_MAX_PENDING_STEERS) {
      throw new Error(`steer queue exceeds max pending messages (${DEFAULT_MAX_PENDING_STEERS})`);
    }
    if (this.pendingSteerBytes + addBytes > DEFAULT_MAX_PENDING_STEER_BYTES) {
      throw new Error(`steer queue exceeds max pending bytes (${DEFAULT_MAX_PENDING_STEER_BYTES})`);
    }
    this.pendingSteers.push(...messages);
    this.pendingSteerBytes += addBytes;
    for (const listener of [...this.steerListeners]) listener();
    if (options.softInterrupt) {
      if (this.activeProviderTurnAbort) this.activeProviderTurnAbort.abort(new SteerSoftInterrupt());
      else this.pendingSoftInterrupt = true;
    }
  }

  /**
   * Kernel-internal resume core, shared by `session.resume` (the store-slot `suspended_run` entry is
   * the only durable anchor): re-enters the run loop for a suspended run's stored state. Announces the
   * settled batch with `decision.resolved` first, keyed by the tool call id the pending decision
   * named (never the arguments, which a decision may have modified).
   */
  async continueSuspendedRun(
    state: StoredAgentRunState,
    runState: DurableRunStateOptions,
    ownership?: OwnershipScope,
    signal?: AbortSignal,
    decisions?: ReadonlyMap<string, Decision>,
    runOptions: ResolvedRunOptions = {},
    /** The suspension's pending decisions: the claimed state no longer carries them. */
    pending?: readonly PendingDecision[],
  ): Promise<RunResult> {
    this.pendingSuspendedRun = undefined;
    if (decisions && decisions.size > 0) {
      const pendingByApproval = new Map((pending ?? pendingDecisionsOf(state) ?? []).map((entry) => [entry.approvalId, entry]));
      this.emit({
        type: "decision.resolved",
        sessionId: this.id,
        runId: state.runId,
        decisions: [...decisions.values()].map((decision) => ({
          toolCallId: pendingByApproval.get(decision.approvalId)?.toolCallId ?? decision.approvalId,
          outcome: decision.outcome.startsWith("allow") ? ("allow" as const) : ("deny" as const),
        })),
        via: "resume",
      });
    }
    return this.runInternal(state.input ?? [], { ...runOptions, ownership, signal }, state.runId, {
      options: runState,
      state,
      decisions,
    });
  }

  async *resume(decisions: readonly Decision[], options: RunOptions & SubscribeOptions = {}): AsyncGenerator<AgentEvent> {
    const { maxQueuedEvents, overflow, ...rawRunOptions } = options;
    // An already-aborted caller never claims: fail closed before the first read or write.
    throwIfAbortedSignal(rawRunOptions.signal);
    const runOptions = resolveRunOptions(rawRunOptions);
    // Everything that can reject (no suspension, bad or incomplete decisions, drift, a stale claim)
    // happens here, before a subscriber exists or a single event is emitted.
    const prepared = await this.prepareResume(decisions, runOptions);
    const subscriber = this.createSubscriber({ maxQueuedEvents, overflow });
    let settled = false;
    const runPromise = this.continueSuspendedRun(
      prepared.state,
      prepared.runState,
      runOptions.ownership,
      runOptions.signal,
      prepared.decisions,
      runOptions,
      prepared.pending,
    ).finally(() => {
      settled = true;
      subscriber.close();
    });
    try {
      for await (const event of subscriber) {
        if ("runId" in event && typeof event.runId === "string" && event.runId !== prepared.state.runId) continue;
        yield event;
      }
      await runPromise;
    } finally {
      subscriber.close();
      if (!settled) {
        this.abort(new Error("resume stream consumer closed"));
        await runPromise.catch(() => undefined);
      }
    }
  }

  /**
   * Read this session's pending suspension from its branch and turn the host's decisions into a claimed,
   * resumable run. The claim lives in a private in-memory cell seeded from the stored state, because
   * the store slot's `suspended_run` entry is the durable anchor (plan 168 Task 5).
   */
  private async prepareResume(
    decisions: readonly Decision[],
    runOptions: ResolvedRunOptions,
  ): Promise<{
    readonly state: StoredAgentRunState;
    readonly runState: DurableRunStateOptions;
    readonly decisions: ReadonlyMap<string, Decision>;
    readonly pending: readonly PendingDecision[];
  }> {
    await this.ready();
    const branch = await this.entries();
    // Plan 177 Task 4: fail closed before `decision.resolved` when the branch is outside the run's scope.
    const scope = narrowScope(this.scope, runOptions.ownership, "Run");
    if (scope && !entriesInScope(branch, scope)) throw new SessionNotFoundError(this.id);
    const suspension = pendingSuspensionOf(branch);
    if (!suspension) throw new AgentDecisionError("ERR_PRISM_DECISION_STALE", "Session has no suspended run to resume");
    if (this.activeRun) throw new Error("Agent session already has an active run");
    const stored = suspension.state;
    restoreRunSessionState(this, stored, { persistSessionState: true, includeSkillBodies: true });
    const resolved = await resolveRunDecisions({
      agent: this.agent,
      state: stored,
      decisions,
      signal: runOptions.signal,
    });
    if (resolved.remaining.length > 0) {
      throw new AgentDecisionError(
        "ERR_PRISM_DECISION_INVALID",
        `Missing decisions for ${resolved.remaining.length} pending approval request(s)`,
      );
    }
    // Fail closed on drift before the claim touches anything: the hook-id set, tools, model, loop and revision.
    if (stored.fingerprint !== agentFingerprint(this.agent, stored.definitionRevision)) {
      throw new AgentRunStateError("Agent definition revision or fingerprint mismatch on resume");
    }
    const runState: DurableRunStateOptions = {
      cell: createMemoryRunStateCell(),
      definitionRevision: stored.definitionRevision,
      persistSessionState: true,
    };
    const { version: _version, ...unversioned } = stored;
    const claimed = await saveAgentRunState({
      cell: runState.cell,
      state: { ...unversioned, status: "running", interruption: undefined, stickyDecisions: resolved.stickyDecisions },
    });
    return { state: claimed.state, runState, decisions: resolved.decisionsById, pending: pendingDecisionsOf(stored) ?? [] };
  }

  private async runInternal(input: AgentInput, options: ResolvedRunOptions, runId: string, resumed?: ActiveDurableRun): Promise<RunResult> {
    // Only a session that needs its branch read waits: the rest start the run in the same tick, as before.
    if (this.needsOpening()) await this.ready();
    // Plan 177 Task 4: narrow before any event, then fail closed when the branch is outside the scope.
    const scope = narrowScope(this.scope, options.ownership, "Run");
    if (scope && !entriesInScope((await this.snapshot()).entries, scope)) throw new SessionNotFoundError(this.id);
    return executeRun(asSessionHost(this), input, { ...options, ownership: scope }, runId, resumed);
  }

  /** Session teardown: closes every subscriber, run-scoped and `acrossRuns` alike (idempotent). */
  close(): Promise<void> {
    this.closing ??= this.closeSession();
    return this.closing;
  }

  /**
   * Settles background tasks within `limits.backgroundSettleMs` and aborts the rest, removes this session's
   * pack hooks from the shared bus, tells hooks the session closed, then closes every subscriber.
   */
  private async closeSession(): Promise<void> {
    try {
      // `session.opened` precedes `session.closed`. A failing store must not keep the session from closing.
      await this.ready().catch(() => undefined);
      await this.background.settle(resolveBackgroundSettleMs(this.agent.config.limits));
    } finally {
      this.observeOnly({ type: "session.closed", sessionId: this.id, runId: "" });
      this.closeSubscribers();
      // Plan 177 Task 5: the agent's open-session registry drops this session as soon as it closes.
      tryAgentRuntime(this.agent)?.openSessions.delete(this);
    }
  }

  async *stream(input: AgentInput, options: RunOptions & SubscribeOptions = {}): AsyncGenerator<AgentEvent> {
    const { maxQueuedEvents, overflow, ...runOptions } = options;
    const subscriber = this.createSubscriber({ maxQueuedEvents, overflow });
    let runOwnedId: string | undefined;
    let settled = false;
    // This subscription is stream()'s own, so it does not depend on the run-end close: settling the
    // run closes it too, which also unblocks the consumer loop when the run fails before it ever
    // emits (a pre-flight validation rejection returns before run-end cleanup).
    const runPromise = this.run(input, runOptions).finally(() => {
      settled = true;
      subscriber.close();
    });
    try {
      for await (const event of subscriber) {
        if ("runId" in event && typeof event.runId === "string") {
          if (runOwnedId === undefined && event.type === "run.started") runOwnedId = event.runId;
          if (runOwnedId !== undefined && event.runId !== runOwnedId) continue;
        }
        yield event;
      }
      await runPromise;
    } finally {
      subscriber.close();
      if (!settled) {
        this.abort(new Error("stream consumer closed"));
        await runPromise.catch(() => undefined);
      }
    }
  }

  buildRunResult(input: {
    readonly runId: string;
    /** The persisted run status; the result carries the host-facing {@link RunResultStatus}. */
    readonly status: AgentRunStatus;
    readonly usage?: Usage;
    readonly limit?: import("../contracts.js").RunLimitBreach;
    readonly attribution?: import("../run-limits.js").BudgetExhaustionAttribution;
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
    readonly stopReason?: import("../contracts.js").AgentFinishReason;
    readonly stopDetail?: string;
    readonly runState?: AgentRunState;
    readonly interruption?: import("../contracts.js").AgentRunInterruption;
  }): RunResult {
    const final = finalAssistantMessage(this.history);
    return {
      sessionId: this.id,
      runId: input.runId,
      status: toRunResultStatus(input.status, input.stopReason),
      leafId: this.currentLeafId,
      text: final.text,
      content: final.content,
      message: final.message,
      messages: [...this.activeRunMessages],
      usage: input.usage,
      limit: input.limit,
      attribution: input.attribution,
      error: input.error,
      abortReason: input.abortReason,
      stopReason: input.stopReason,
      stopDetail: input.stopDetail,
      pending: input.interruption?.pendingDecisions,
      runState: input.runState,
    };
  }

  async compact(options: CompactionOptions = {}): Promise<CompactionResult> {
    if (this.activeRun) throw new Error("Agent session already has an active run");
    // Same agent/run merge the auto trigger uses, so agent-level sizing and secrets apply here too.
    const merged = { ...(this.agent.config.compaction || {}), ...options };
    const result = await this.compactBranch(merged, undefined, merged.signal, "manual");
    // Plan 091 T2: history changed, so a pre-compaction meter reading would overstate the context.
    this.activeInputMeter = undefined;
    return result;
  }

  abort(reason?: unknown): void {
    this.activeRun?.abort(reason);
  }

  async entries(): Promise<readonly SessionEntry[]> {
    const reader = this.branchReader();
    return reader
      ? getSessionBranchEntries(reader, { sessionId: this.id, leafId: this.currentLeafId })
      : getSessionBranchEntries(await this.store.list(this.id), { leafId: this.currentLeafId });
  }

  async checkout(leafId?: string): Promise<void> {
    this.currentLeafId = leafId;
    this.invalidateSnapshot();
    await this.rebuildHistory();
    await this.rehydrateState();
  }

  async messages(): Promise<readonly Message[]> {
    // The snapshot is rebuilt from stored entries (after `message.append`), so a `context.build` draft never shows here.
    return [...(await this.snapshot()).messages];
  }

  async fork(options: SessionForkOptions = {}): Promise<Session> {
    const leafId = options.at ?? this.currentLeafId;
    const reader = this.branchReader();
    const branch = reader
      ? await getSessionBranchEntries(reader, { sessionId: this.id, leafId })
      : getSessionBranchEntries(await this.store.list(this.id), { leafId });
    const id = randomId("session");
    const remap = new Map<string, string>();
    const copied: SessionEntry[] = [];
    for (const entry of branch) {
      const parentId = entry.parentId ? remap.get(entry.parentId) : undefined;
      // A suspended run belongs to the session it suspended in, so the fork would resume someone else's run.
      if (entry.kind === "suspended_run") {
        if (parentId !== undefined) remap.set(entry.id, parentId);
        continue;
      }
      const nextId = randomId("entry");
      remap.set(entry.id, nextId);
      const { id: _oldId, parentId: _oldParentId, sessionId: _oldSessionId, ...rest } = entry;
      const next = { ...rest, id: nextId, parentId, sessionId: id } as SessionEntry;
      await this.store.append(next);
      copied.push(next);
    }
    const forked = new RuntimeAgentSession({
      agent: this.agent,
      id,
      store: this.store,
      leafId: copied.at(-1)?.id,
      metadata: this.metadata,
      ownership: this.scope,
      snapshotCacheTtlMs: this.snapshotCacheTtlMs,
    });
    // Resolved opened: package state is hydrated from the copied entries and `session.opened` has fired.
    const registry = tryAgentRuntime(this.agent)?.openSessions;
    registry?.add(forked);
    try {
      await forked.openResumedSession(copied);
    } catch (error) {
      registry?.delete(forked);
      throw error;
    }
    return forked;
  }

  private branchReader() {
    // ponytail: prefer readBranchPath when present (memory, SQLite, Postgres) so snapshot does
    // not list() the whole session. JSONL and other omitters fall back to list() + in-memory walk.
    const read = this.store.readBranchPath;
    return read ? (query: SessionBranchRead) => read.call(this.store, query) : undefined;
  }

  /** The agent's redactor, plus any value `credentials.resolve` returned (a package may resolve one mid-run). */
  runRedactor(base: SecretRedactor | undefined = this.agent.config.redactor): SecretRedactor | undefined {
    return tryAgentRuntime(this.agent)?.packages.redactor(base) ?? base;
  }

  resolveRunProvider(options: ResolvedRunOptions, skip = false): void {
    const model = options.model ?? this.agent.config.model;
    // A model-less agent has no provider to resolve; `turn()` fails `no_model` if a loop asks for one.
    if (!model || skip) return;
    // One resolution shared with `models.client` and `agent.models`: the run's model picks its provider, so a
    // fixed `AgentConfig.provider` never shadows a `RunOptions.model` on another id. A miss on every source
    // fails closed with `Unknown provider: ${model.provider}` before any provider turn.
    const runtime = tryAgentRuntime(this.agent);
    const provider = runtime?.packages.resolveProvider(model);
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    this.activeProvider = provider;
  }

  resolveRunSkills(tools: readonly ToolDefinition[]): readonly Skill[] {
    return resolveAllActiveSkills(agentSkillSource(this.agent), tools);
  }

  emit(event: AgentEvent): void {
    this.dispatchEvent(event, this.activeRedactor);
  }

  /**
   * An event raised outside a run (a background task ending after the run did). `activeRedactor` is unset
   * then, so the agent's own redactor and the resolved secrets apply instead.
   */
  private emitBetweenRuns(event: AgentEvent): void {
    this.dispatchEvent(event, this.activeRedactor ?? this.runRedactor());
  }

  private redactBetweenRuns<T>(value: T): T {
    const redactor = this.activeRedactor ?? this.runRedactor();
    return redactor ? redactor.redact(value) : value;
  }

  /**
   * Session lifecycle events reach hooks and agent subscribers. A session stream stays what it was: its first event is still
   * the run's own, and nothing sees `session.opened` before `run.started`.
   */
  private observeOnly(event: AgentEvent): void {
    const redacted = redactAgentEvent(event, this.activeRedactor ?? this.runRedactor());
    this.observe(redacted);
    tryAgentRuntime(this.agent)?.emitAgentEvent?.(redacted);
  }

  private dispatchEvent(event: AgentEvent, redactor: SecretRedactor | undefined): void {
    const redacted = redactAgentEvent(event, redactor);
    for (const subscriber of this.subscribers) subscriber.push(redacted);
    this.observe(redacted);
    // Background work is agent-visible: a host watching `agent.subscribe()` sees it without a session stream.
    if (redacted.type.startsWith("background.")) tryAgentRuntime(this.agent)?.emitAgentEvent?.(redacted);

    this.recordToLedger(event, redacted);
  }

  /**
   * Observe hooks: every agent event is an observe hook (roadmap §2.4). A `hook.error` raised by a
   * throwing observer routes back here, so drop a `hook.error` that is itself produced while
   * dispatching a `hook.error`.
   */
  private observe(redacted: AgentEvent): void {
    if (redacted.type === "hook.error" && this.observingHookError) return;
    const dispatchingError = redacted.type === "hook.error";
    if (dispatchingError) this.observingHookError = true;
    try {
      this.boundHooks.observe(redacted.type, redacted);
    } finally {
      if (dispatchingError) this.observingHookError = false;
    }
  }

  private recordToLedger(event: AgentEvent, redacted: AgentEvent): void {
    if (this.activeLedger) {
      const record: AgentEventRecord = {
        id: randomId("event"),
        sessionId: event.sessionId ?? this.id,
        runId: event.runId,
        type: event.type,
        timestamp: new Date().toISOString(),
        event: redacted,
        redacted: Boolean(this.activeRedactor),
        ...this.activeOwnership,
      };
      const ledger = this.activeLedger;
      this.ledgerChain = this.ledgerChain.then(async () => {
        if (this.ledgerFailure) return;
        try {
          await ledger.appendEvent(redactRunLedgerRecord(record, this.activeRedactor));
        } catch (error) {
          this.ledgerFailure = error;
        }
      });
    }
  }

  /**
   * Run end (finish, suspension, or denial): closes the run-scoped subscribers only. Subscribers that
   * opted into `SubscribeOptions.acrossRuns` stay open for the next run of this session.
   */
  closeRunSubscribers(): void {
    for (const subscriber of this.subscribers) if (!subscriber.acrossRuns) subscriber.close();
  }

  closeSubscribers(): void {
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }

  async drainLedger(): Promise<void> {
    await this.ledgerChain;
    const failure = this.ledgerFailure;
    this.ledgerChain = Promise.resolve();
    this.ledgerFailure = undefined;
    if (failure) throw failure;
  }

  /** Register a `steer()` listener (the `RunController.steers()` wake-up); returns its unsubscribe. */
  onSteer(listener: () => void): () => void {
    this.steerListeners.add(listener);
    return () => {
      this.steerListeners.delete(listener);
    };
  }

  async applyPendingSteers(runId: string, _metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean> {
    if (this.pendingSteers.length === 0) return false;
    await this.drainSteers(runId, signal);
    return true;
  }

  /** Drain the steer queue through the `run.input` gate; returns the messages that survived it. */
  async drainSteers(runId: string, signal: AbortSignal): Promise<readonly Message[]> {
    const drained = this.pendingSteers.splice(0);
    this.pendingSteerBytes = 0;
    const kept: Message[] = [];
    for (const message of drained) {
      throwIfAborted(signal);
      // Mid-run steer passes the same `run.input` gate as run-start input: a handler that drops the
      // message removes it (it never enters history or the session store) and the run continues, while
      // `ctx.reject(reason)` fails the run closed.
      const steered = await this.hooks().transform("run.input", [message], { sessionId: this.id, runId });
      if (steered.length === 0) {
        this.emit({
          type: "package.event",
          sessionId: this.id,
          runId,
          package: "kernel",
          name: "steer.rejected",
          // Kernel-owned payloads are JSON-serializable but carry optional members, which `JsonValue`
          // does not admit structurally; the cast is the one place that boundary is crossed.
          data: {
            message: this.activeRedactor ? this.activeRedactor.redact(message) : message,
            record: { guardrail: "run.input", stage: "input", action: "block", reason: "run.input dropped the steered message" },
          } as unknown as JsonValue,
        });
        continue;
      }
      for (const survivor of steered) this.history.push(survivor);
      for (const survivor of steered) await this.appendMessage(survivor, runId);
      kept.push(...steered);
    }
    return kept;
  }

  async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  async autoCompact(runId: string, options: ResolvedRunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void> {
    const resolved = await this.resolveAutoCompact(runId, options, signal, undefined);
    if (!resolved) return;
    await this.compactBranchResilient(resolved, runId, signal, "auto");
    const compacted = await this.snapshot();
    this.replaceHistory(withoutTrailingInput(compacted.messages, inputMessages));
  }

  async autoCompactTurn(runId: string, options: ResolvedRunOptions, signal: AbortSignal, turn: number): Promise<void> {
    const resolved = await this.resolveAutoCompact(runId, options, signal, turn);
    if (!resolved) return;
    await this.compactBranchResilient(resolved, runId, signal, "auto");
  }

  /**
   * Resolve the auto-compaction decision, or `undefined` when there is nothing to do. A registered
   * `compaction.when` handler owns the decision (roadmap §2.4): the configured `trigger`/
   * `thresholdEntries` is the fallback used only when no handler is registered.
   */
  private async resolveAutoCompact(
    runId: string,
    options: ResolvedRunOptions,
    signal: AbortSignal,
    turn: number | undefined,
  ): Promise<CompactionOptions | undefined> {
    const compaction = mergeCompaction(this.agent.config.compaction, options.compaction);
    const configured = compaction?.thresholdEntries !== undefined;
    const hasWhen = this.hooks().has("compaction.when");
    if (!configured && !hasWhen) return undefined;
    const snapshot = await this.snapshot();
    // A branch that just compacted keeps its fresh summary: no second pass over the same entries.
    if (snapshot.entries.at(-1)?.kind === "compaction") return undefined;
    const estimateInputTokens = () =>
      estimateAssemblyTokens(snapshot.messages) + snapshot.summaries.reduce((sum, summary) => sum + estimateTextTokens(summary), 0);
    if (hasWhen) {
      // The handler is the whole decision while it is registered: an abstaining handler (`undefined`)
      // means no compaction, not a fallback to the configured trigger.
      const forced = await this.hooks().decide("compaction.when", {
        sessionId: this.id,
        runId,
        messages: snapshot.messages,
        entryCount: snapshot.entries.length,
        ...(turn === undefined ? {} : { turn }),
        estimatedTokens: estimateInputTokens(),
      });
      return forced?.compact === true ? (compaction ?? {}) : undefined;
    }
    if (!compaction) return undefined;
    const compact = await resolveShouldCompact(
      { thresholdEntries: compaction.thresholdEntries },
      {
        sessionId: this.id,
        entryCount: snapshot.entries.length,
        ...(turn === undefined ? {} : { turn }),
        // Estimates of the branch the run is about to send: messages plus carried summaries.
        estimateInputTokens,
        // The model-derived per-request cap (`contextWindow - maxOutputTokens - reserve`).
        resolveInputCapTokens: () => resolveInputCap({}, options.model ?? this.agent.config.model),
        metadata: compaction.metadata,
        signal,
      },
    );
    return compact ? compaction : undefined;
  }

  /**
   * Compact, falling back to continuing uncompacted with a `compaction_failed` event. The trigger
   * decision stays outside this seam: an unresolvable input cap is a host config error and must
   * fail loudly, while a summarizer/strategy failure is a runtime hiccup the run survives.
   */
  private async compactBranchResilient(
    options: CompactionOptions,
    runId: string | undefined,
    signal: AbortSignal | undefined,
    trigger: "manual" | "auto",
  ): Promise<void> {
    try {
      await this.compactBranch(options, runId, signal, trigger);
    } catch (error) {
      this.emit({ type: "compaction.completed", sessionId: this.id, runId, error: errorToErrorInfo(error) });
    }
  }

  private async compactBranch(
    options: CompactionOptions,
    runId: string | undefined,
    signal: AbortSignal | undefined,
    trigger: "manual" | "auto",
  ): Promise<CompactionResult> {
    throwIfAbortedSignal(signal);
    const entries = await this.entries();
    const secrets = options.secrets ?? [];
    // The `compaction` slot owns the implementation (roadmap §2.5); `CompactionOptions` only sizes it.
    const compactor = this.slotRegistry.resolve("compaction", this.agent.config.slots?.compaction);
    const owner = this.slotRegistry.ownerOf("compaction", this.agent.config.slots?.compaction);
    const context = {
      sessionId: this.id,
      entries,
      keepRecentEntries: options.keepRecentEntries,
      trigger,
      secrets,
      metadata: options.metadata,
      signal,
      // A package owner can read its own session (ledger, per-session knobs); a host or kernel compactor gets none.
      ...(owner === "host" || owner === "kernel" ? {} : { session: this.sessionContextFor(owner) }),
    };
    this.emit({ type: "compaction.started", sessionId: this.id, runId });
    let result = await compactor.compact(context);
    result = { ...result, summary: redactSecrets(result.summary, secrets) };
    const source = result.entries?.find((entry) => entry.kind === "compaction");
    const data = isCompactionEntryData(source?.data) ? source.data : undefined;
    const entry = createSessionEntry({
      sessionId: this.id,
      parentId: this.currentLeafId,
      runId,
      kind: "compaction",
      summary: result.summary,
      data,
    });
    await this.appendEntry(entry);
    const finalResult = { ...result, entries: [entry] };
    const throughIndex = data?.throughEntryId ? entries.findIndex((e) => e.id === data.throughEntryId) : -1;
    const entriesCompacted = throughIndex >= 0 ? throughIndex + 1 : Math.max(0, entries.length - (options.keepRecentEntries ?? 8));
    this.emit({ type: "compaction.completed", sessionId: this.id, runId, summary: finalResult.summary, entriesCompacted });
    await this.rebuildHistory();
    return finalResult;
  }

  /**
   * Appends at the tip, one at a time. A `package_state` write from a hook or background task can overlap
   * the run's own append, and two appends from the same tip would orphan one of them. An entry made for
   * the tip it saw is rebased onto the tip it lands on.
   */
  async appendEntry(entry: SessionEntry): Promise<void> {
    const forTip = entry.parentId === this.currentLeafId;
    await this.serialAppend(() =>
      this.appendNow(forTip && entry.parentId !== this.currentLeafId ? { ...entry, parentId: this.currentLeafId } : entry),
    );
  }

  private serialAppend<T>(job: () => Promise<T>): Promise<T> {
    const run = this.appendTail.then(job);
    this.appendTail = run.catch(() => undefined);
    return run;
  }

  private async appendNow(entry: SessionEntry): Promise<void> {
    // Entries carry the owning scope so a resume by id can fail closed across scopes.
    const scope = this.activeOwnership ?? this.scope;
    const stamp: Record<string, unknown> = {};
    for (const key of ["tenantId", "accountId", "userId"] as const) {
      if (scope?.[key] !== undefined && entry.metadata?.[key] === undefined) stamp[key] = scope[key];
    }
    const owned = Object.keys(stamp).length > 0 ? { ...entry, metadata: { ...entry.metadata, ...stamp } } : entry;
    const redacted = redactSessionEntry(owned, this.activeRedactor);
    await this.store.append(redacted, {
      expectedParentId: this.currentLeafId,
      idempotencyKey: this.activeIdempotencyKey,
    });
    this.currentLeafId = redacted.id;
    if (redacted.kind === "message" && redacted.message && this.activeRunId !== undefined) this.activeRunMessages.push(redacted.message);
    this.invalidateSnapshot();
  }

  invalidateSnapshot(): void {
    this.snapshotGeneration += 1;
    this.snapshotCache = undefined;
  }

  redact<T>(value: T): T {
    return this.activeRedactor?.redact(value) ?? value;
  }

  redactProviderRequest(request: ProviderRequest): ProviderRequest {
    return redactProviderRequest(request, this.activeRedactor);
  }

  async rebuildHistory(): Promise<void> {
    this.replaceHistory((await this.snapshot()).messages);
  }

  /**
   * Replace the live history in place. A mid-run compaction must never reassign `history`: the
   * active loop holds that array (`activeLoopHistory`), so a fresh array would silently drop every
   * later turn from the session view (run result text/content, tool narrowing) while the loop kept
   * appending to its own copy.
   */
  private replaceHistory(messages: readonly Message[]): void {
    this.history.length = 0;
    this.history.push(...messages);
    if (this.activeLoopHistory && this.activeLoopHistory !== this.history) {
      this.activeLoopHistory.length = 0;
      this.activeLoopHistory.push(...this.history);
    }
  }

  async snapshot(): Promise<SessionContextSnapshot> {
    const now = performance.now();
    const cached = this.snapshotCache;
    if (cached && cached.leafId === this.currentLeafId && cached.generation === this.snapshotGeneration && cached.expiresAt > now)
      return cached.value;
    const reader = this.branchReader();
    const value = reader
      ? await rebuildSessionContext(reader, { sessionId: this.id, leafId: this.currentLeafId })
      : rebuildSessionContext(await this.store.list(this.id), { leafId: this.currentLeafId });
    this.snapshotCache = {
      leafId: this.currentLeafId,
      generation: this.snapshotGeneration,
      expiresAt: now + this.snapshotCacheTtlMs,
      value,
    };
    return value;
  }
}

/**
 * `snapshotCacheTtlMs` resolution: `0` disables the branch cache (a host that needs a
 * fresh store read per snapshot), otherwise a safe integer up to the hard cap.
 */
function resolveSnapshotCacheTtlMs(value: number | undefined): number {
  const ttl = value ?? DEFAULT_SNAPSHOT_CACHE_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > HARD_MAX_SNAPSHOT_CACHE_TTL_MS) {
    throw new TypeError(`AgentSessionConfig.snapshotCacheTtlMs must be a safe integer from 0 to ${HARD_MAX_SNAPSHOT_CACHE_TTL_MS}`);
  }
  return ttl;
}

function sessionLinksOption(config: SessionOptions): SessionLinks | undefined {
  if (config.parent === undefined && config.actor === undefined) return undefined;
  const links: SessionLinks = { ...config.parent, ...(config.actor !== undefined ? { actor: config.actor } : {}) };
  assertSessionLinks(links);
  return links;
}
