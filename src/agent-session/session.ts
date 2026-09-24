/** session (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */

import { ActiveDurableRun, ActiveDurableRunExtras } from "../agent-approval.js";
import type { PendingToolCall, PersistedGuardrailPacks, StoredAgentRunState } from "../agent-run-state.js";
import { policyList } from "../agent-tool-dispatch.js";
import {
  type AttentionFoldLedger,
  type AttentionStickyFrontier,
  createAttentionFoldLedger,
  createAttentionStickyFrontier,
  type PersistedAttentionFoldLedger,
  type PersistedAttentionStickyFrontier,
  resolveInputCap,
  restoreAttentionStickyFrontier,
  serializeAttentionFoldLedger,
  serializeAttentionStickyFrontier,
} from "../attention-compiler.js";
import { createDefaultCompactionStrategy, isCompactionEntryData } from "../compaction.js";
import { estimateAssemblyTokens, estimateMessageTokens, estimateTextTokens } from "../context-budget.js";
import type {
  Agent,
  AgentEvent,
  AgentEventRecord,
  AgentRunResult,
  AgentRunState,
  AgentRunStateOptions,
  AgentSession,
  AgentSessionConfig,
  AIProvider,
  CompactionMiddlewarePayload,
  CompactionOptions,
  CompactionResult,
  ContextMeter,
  ErrorInfo,
  GuardrailPackRef,
  Guardrails,
  Message,
  OwnershipScope,
  PendingDecision,
  PromptVersionRef,
  ProviderRequest,
  RunDecision,
  RunLedger,
  RunOptions,
  SessionBranchRead,
  SessionEntry,
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
  AgentRunStateError,
  DEFAULT_MAX_PENDING_STEER_BYTES,
  DEFAULT_MAX_PENDING_STEERS,
  DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
  resolveShouldCompact,
} from "../contracts.js";
import { compileGuardrailPacksWithState, GuardrailError, GuardrailPackError, runGuardrails } from "../guardrails.js";
import type { AgentIdentity } from "../identity.js";
import type { AgentInput } from "../input.js";
import {
  applyDefaultProviderRequestOptions,
  createProviderRequestPolicyChain,
  normalizeProviderRequestPolicyResult,
} from "../provider-request-policy.js";
import type { SecretRedactor } from "../redaction.js";
import { redactAgentEvent, redactProviderRequest, redactRunLedgerRecord, redactSecrets, redactSessionEntry } from "../redaction.js";
import type { RunLimitTracker } from "../run-limits.js";
import type { SessionContextSnapshot } from "../session-stores.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, rebuildSessionContext } from "../session-stores.js";
import { createLoadedSkillSet } from "../skill-disclosure.js";
import type { LoadedSkillBodiesEntry } from "../skill-load.js";
import { validateLoadedSkillBodies } from "../skill-load.js";
import { resolveActiveSkills } from "../skills.js";
import { createActiveToolSet } from "../tool-search.js";
import { createAgentSession } from "./create-agent.js";
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
import { executeRun } from "./session/assemble.js";
import { asSessionHost } from "./session/types.js";

export class RuntimeAgentSession implements AgentSession {
  readonly id: string;
  private readonly agent: Agent;
  private readonly metadata?: Readonly<Record<string, unknown>>;
  private readonly store: SessionStore;
  private readonly subscribers = new Set<EventSubscriber>();
  /** Plan 106 R2: `session_start` is dispatched at the first run start, once per runtime session. */
  private sessionOpened = false;
  /** Plan 106 R2: `close()` dispatches `session_shutdown` and closes subscribers exactly once. */
  private closed = false;
  private currentLeafId?: string;
  private history: Message[] = [];
  private activeRun?: AbortController;
  private activeRunId?: string;
  private activeProviderTurnAbort?: AbortController;
  pendingSoftInterrupt = false;
  private pendingSteers: Message[] = [];
  private pendingSteerBytes = 0;
  private activeRedactor?: SecretRedactor;
  activeProvider?: AIProvider;
  private activeLedger?: RunLedger;
  activeEffectStore?: ToolEffectStore;
  private activeOwnership?: OwnershipScope;
  activeIdentity?: AgentIdentity;
  private activeIdempotencyKey?: string;
  private activeGuardrails?: Guardrails;
  /** Plan 092 Task 2: guardrail packs compiled once in the constructor; merged into every run's `activeGuardrails`. */
  packGuardrails?: Guardrails;
  /** Plan 104 Task 3: `ask` rules as the durable charge-time gate (a match records `interrupt`). */
  packAskGate?: Guardrails;
  /** Plan 104 Task 3: the same `ask` rules as plain blocks for a run that cannot suspend. */
  packAskBlocks?: Guardrails;
  /** Original pack refs, carried into `fork()`/`clone()` so a branch cannot silently lose its policy. */
  private packRefs?: readonly GuardrailPackRef[];
  /** Plan 104 Task 2: compiled refs + live pack state, replaced by `restoreGuardrailPacks` on resume. */
  private compiledGuardrailPacks?: ReturnType<typeof compileGuardrailPacksWithState>;
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
  activeLoop?: import("../contracts.js").AgentLoopStrategy;
  /** Gated calls of the current tool round awaiting one collected suspension. */
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn = 1;
  private readonly loadedSkills = createLoadedSkillSet();
  /** Run-owned only: loaded bodies and URI resources retain first insertion order within one provider loop. */
  readonly tailSegments = new Map<string, Message>();
  /** Tools activated via `search_tools` this session (plan 041); names-only in persistence. */
  readonly activatedTools = createActiveToolSet();
  /** Plan 018 Task 6 (closeout `checkpoint-bodies`): persisted exact instructions, registry-independent. */
  restoredSkillBodies: readonly LoadedSkillBodiesEntry[] = [];
  /** Skills of the current run (for the bodies snapshot); replaced at each run start. */
  activeRunSkills: readonly import("../contracts.js").Skill[] = [];
  /** Per-run tool allow-list (Task 21); undefined means the full registered set. */
  activeToolNames?: readonly string[];
  /** Sticky frontier for this session (plan 074 C10); created on first use, so a session whose
   *  agents never enable the compiler allocates nothing. Mutations stay applied once made, so a
   *  later under-ratio turn re-applies them instead of rewriting the prompt-cache prefix. */
  private attentionSticky?: AttentionStickyFrontier;

  attentionStickyFor(): AttentionStickyFrontier {
    this.attentionSticky ??= createAttentionStickyFrontier();
    return this.attentionSticky;
  }

  /** Plan 074 P3: bounded snapshot for a durable checkpoint; `undefined` when the session never
   *  mutated anything, so a compiler-off (or never-over-ratio) session persists nothing extra. */
  serializedAttentionSticky(): PersistedAttentionStickyFrontier | undefined {
    return this.attentionSticky && this.attentionSticky.thinking.size + this.attentionSticky.toolCallIds.size > 0
      ? serializeAttentionStickyFrontier(this.attentionSticky)
      : undefined;
  }

  /** Plan 074 P3: restore a frontier validated at checkpoint load, so a resumed run keeps its
   *  stubs instead of re-deciding its first turn from the ratio. */
  restoreAttentionSticky(persisted: PersistedAttentionStickyFrontier): void {
    this.attentionSticky = restoreAttentionStickyFrontier(persisted);
  }

  /** Session-owned folded bodies (plan 086 T3); created on first use like the frontier, so a
   *  compiler-off session allocates nothing. */
  private attentionFold?: AttentionFoldLedger;
  /** Set per run from the resolved compiler: `durable: true` opts the fold ledger and its
   *  frontier into checkpoints even when `persistSessionState` is off. */
  attentionDurable = false;

  attentionFoldFor(): AttentionFoldLedger {
    this.attentionFold ??= createAttentionFoldLedger();
    return this.attentionFold;
  }

  /** Plan 086 T3: bounded ledger snapshot for a durable checkpoint; `undefined` before any fold. */
  serializedAttentionFold(): PersistedAttentionFoldLedger | undefined {
    return this.attentionFold && this.attentionFold.bodies.size > 0 ? serializeAttentionFoldLedger(this.attentionFold) : undefined;
  }

  /** Plan 086 T3: adopt a ledger validated at checkpoint load, so a resumed fold is byte-identical. */
  restoreAttentionFold(ledger: AttentionFoldLedger): void {
    this.attentionFold = ledger;
  }

  /** Plan 015 Task 4: re-add persisted loaded-skill names (names only; bodies re-resolve on demand). */
  restoreLoadedSkills(names: readonly string[]): void {
    for (const name of names) this.loadedSkills.add(name);
  }

  /** Plan 041: re-add persisted activated-tool names (names only; inert for absent tools). */
  restoreActivatedTools(names: readonly string[]): void {
    for (const name of names) this.activatedTools.add(name);
  }

  /** Plan 041: host reset of search-activated tools. */
  clearActivatedTools(): void {
    this.activatedTools.clear();
  }

  /** Plan 018 Task 6: restore persisted loaded-skill bodies (already validated fail-closed at load). */
  restoreLoadedSkillBodies(bodies: readonly LoadedSkillBodiesEntry[]): void {
    validateLoadedSkillBodies(bodies);
    this.restoredSkillBodies = bodies;
    for (const entry of bodies) this.loadedSkills.add(entry.name);
  }

  /** Plan 104 T2: the refs this session actually enforces (restored ones after a resume). */
  get guardrailPackRefs(): readonly GuardrailPackRef[] | undefined {
    return this.packRefs;
  }

  /** Plan 104 T2: pack refs + live pack-owned state for a durable checkpoint (opt-in with `persistSessionState`). */
  serializedGuardrailPackState(): PersistedGuardrailPacks | undefined {
    const compiled = this.compiledGuardrailPacks;
    if (!compiled || compiled.packs.length === 0) return undefined;
    const state = compiled.snapshotState();
    return { packs: compiled.packs, ...(state ? { state } : {}) };
  }

  /**
   * Plan 104 T2: recompile checkpoint packs before the resumed run's first turn. `state` present
   * (even empty) marks a restore, so unknown ids, version mismatches, and codec-less state fail
   * closed as `AgentRunStateError` — never a session that silently enforces less than it did.
   */
  restoreGuardrailPacks(refs: readonly GuardrailPackRef[], state?: Readonly<Record<string, unknown>>): void {
    let compiled: ReturnType<typeof compileGuardrailPacksWithState>;
    try {
      compiled = compileGuardrailPacksWithState(refs, undefined, state ?? {});
    } catch (error) {
      if (error instanceof GuardrailPackError) throw new AgentRunStateError(`Cannot restore guardrail packs: ${error.message}`);
      throw error;
    }
    this.compiledGuardrailPacks = compiled;
    this.packGuardrails = compiled.guardrails;
    this.packAskGate = compiled.askGate;
    this.packAskBlocks = compiled.askBlocks;
    this.packRefs = refs;
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

  constructor(config: AgentSessionConfig & { readonly agent: Agent }) {
    this.id = config.id ?? randomId("session");
    this.agent = config.agent;
    this.metadata = config.metadata;
    this.store = config.store ?? config.agent.config.store ?? createMemorySessionStore();
    this.currentLeafId = config.leafId;
    this.snapshotCacheTtlMs = resolveSnapshotCacheTtlMs(config.snapshotCacheTtlMs);
    this.compiledGuardrailPacks = compileGuardrailPacksWithState(config.guardrailPacks);
    this.packGuardrails = this.compiledGuardrailPacks.guardrails;
    this.packAskGate = this.compiledGuardrailPacks.askGate;
    this.packAskBlocks = this.compiledGuardrailPacks.askBlocks;
    this.packRefs = config.guardrailPacks;
    const usageEstimation = config.agent.config.usageEstimation;
    if (usageEstimation !== undefined && usageEstimation !== "fallback" && usageEstimation !== "off" && usageEstimation !== "strict") {
      throw new TypeError('usageEstimation must be "fallback", "off", or "strict"');
    }
  }

  get leafId(): string | undefined {
    return this.currentLeafId;
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
    const inputTokens = this.activeInputMeter?.tokens ?? estimateMessageTokens(this.history, model.model).tokens;
    const source = this.activeInputMeter?.source ?? "estimated";
    let inputCap: number | undefined;
    try {
      const setting = this.agent.config.attentionCompiler;
      const options = typeof setting === "object" && setting !== null ? setting : undefined;
      inputCap = resolveInputCap(options ? { maxInputTokens: options.maxInputTokens, reserveTokens: options.reserveTokens } : {}, model);
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

  async run(input: AgentInput, options: RunOptions = {}): Promise<AgentRunResult> {
    return this.runInternal(input, options, randomId("run"));
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
    this.emit({ type: "queue_updated", sessionId: this.id, runId: this.activeRunId, size: this.pendingSteers.length });
    if (options.softInterrupt) {
      if (this.activeProviderTurnAbort) this.activeProviderTurnAbort.abort(new SteerSoftInterrupt());
      else this.pendingSoftInterrupt = true;
    }
  }

  async resumeDurable(
    state: StoredAgentRunState,
    runState: AgentRunStateOptions,
    ownership?: OwnershipScope,
    signal?: AbortSignal,
    decisions?: ReadonlyMap<string, RunDecision>,
    extras?: ActiveDurableRunExtras,
  ): Promise<AgentRunResult> {
    return this.runInternal(state.input ?? [], { runState, ownership, signal }, state.runId, {
      options: runState,
      state,
      version: state.version!,
      decisions,
      ...extras,
    });
  }

  async recordDurableResumption(
    runId: string,
    interruption: import("../contracts.js").AgentRunInterruption,
    version: number,
    ownership?: OwnershipScope,
  ): Promise<void> {
    this.activeLedger = this.agent.config.runLedger;
    this.activeOwnership = ownership ?? this.agent.config.ownership;
    this.activeRedactor = this.agent.config.redactor;
    try {
      this.emit({ type: "agent_suspended", sessionId: this.id, runId, interruption, version });
      await this.drainLedger();
    } finally {
      this.activeLedger = undefined;
      this.activeOwnership = undefined;
      this.activeRedactor = undefined;
      this.closeRunSubscribers();
    }
  }

  async recordDurableDenial(
    runId: string,
    interruption: import("../contracts.js").AgentRunInterruption,
    version: number,
    ownership?: OwnershipScope,
  ): Promise<void> {
    this.activeLedger = this.agent.config.runLedger;
    this.activeOwnership = ownership ?? this.agent.config.ownership;
    this.activeRedactor = this.agent.config.redactor;
    try {
      this.emit({ type: "agent_denied", sessionId: this.id, runId, interruption, version });
      await this.drainLedger();
    } finally {
      this.activeLedger = undefined;
      this.activeOwnership = undefined;
      this.activeRedactor = undefined;
      this.closeRunSubscribers();
    }
  }

  private async runInternal(input: AgentInput, options: RunOptions, runId: string, resumed?: ActiveDurableRun): Promise<AgentRunResult> {
    return executeRun(asSessionHost(this), input, options, runId, resumed);
  }

  /**
   * Plan 106 R2: dispatch `session_start` once per session, at its first run start (including the
   * first run of a session rebuilt from a durable checkpoint). The run assembler awaits it right
   * after `agent_started`/`agent_resumed`, so session-scoped provisioning is done before the first
   * turn while the runtime's synchronous emit burst stays intact. Middleware error policy decides
   * whether a failure surfaces or becomes an `extension_error` event.
   */
  async openSession(runId: string): Promise<void> {
    if (this.sessionOpened) return;
    this.sessionOpened = true;
    await this.agent.config.middleware?.run("session_start", { sessionId: this.id, runId });
  }

  /**
   * Plan 106 R2: session teardown. Dispatches `session_shutdown` middleware once (idempotent) and
   * then closes every subscriber, run-scoped and `acrossRuns` alike. Call it after the active run
   * settles; `closeSubscribers()` remains the subscriber-only seam.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.agent.config.middleware?.run("session_shutdown", { sessionId: this.id });
    } finally {
      this.closeSubscribers();
    }
  }

  prompt(input: string, options?: RunOptions): Promise<AgentRunResult> {
    return this.run(input, options);
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
          if (runOwnedId === undefined && event.type === "agent_started") runOwnedId = event.runId;
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
    readonly status: AgentRunResult["status"];
    readonly usage?: Usage;
    readonly limit?: import("../contracts.js").RunLimitBreach;
    readonly attribution?: import("../run-limits.js").BudgetExhaustionAttribution;
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
    readonly stopReason?: import("../contracts.js").AgentFinishReason;
    readonly stopDetail?: string;
    readonly runState?: AgentRunState;
    readonly interruption?: import("../contracts.js").AgentRunInterruption;
  }): AgentRunResult {
    const final = finalAssistantMessage(this.history);
    return {
      sessionId: this.id,
      runId: input.runId,
      status: input.status,
      leafId: this.currentLeafId,
      text: final.text,
      content: final.content,
      message: final.message,
      usage: input.usage,
      limit: input.limit,
      attribution: input.attribution,
      error: input.error,
      abortReason: input.abortReason,
      stopReason: input.stopReason,
      stopDetail: input.stopDetail,
      runState: input.runState,
      interruption: input.interruption,
    };
  }

  async compact(options: CompactionOptions = {}): Promise<CompactionResult> {
    if (this.activeRun) throw new Error("Agent session already has an active run");
    const result = await this.compactBranch(options, undefined, options.signal, "manual");
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
  }

  fork(options: { readonly leafId?: string } = {}): AgentSession {
    return createAgentSession({
      agent: this.agent,
      id: this.id,
      store: this.store,
      leafId: options.leafId ?? this.currentLeafId,
      metadata: this.metadata,
      ...(this.packRefs ? { guardrailPacks: this.packRefs } : {}),
    });
  }

  async clone(options: { readonly id?: string; readonly leafId?: string } = {}): Promise<AgentSession> {
    const id = options.id ?? randomId("session");
    const leafId = options.leafId ?? this.currentLeafId;
    const reader = this.branchReader();
    const branch = reader
      ? await getSessionBranchEntries(reader, { sessionId: this.id, leafId })
      : getSessionBranchEntries(await this.store.list(this.id), { leafId });
    const remap = new Map<string, string>();
    for (const entry of branch) {
      const nextId = randomId("entry");
      remap.set(entry.id, nextId);
      const { id: _oldId, parentId: _oldParentId, sessionId: _oldSessionId, ...rest } = entry;
      await this.store.append({ ...rest, id: nextId, parentId: entry.parentId ? remap.get(entry.parentId) : undefined, sessionId: id });
    }
    return createAgentSession({
      agent: this.agent,
      id,
      store: this.store,
      leafId: branch.length ? remap.get(branch[branch.length - 1]!.id) : undefined,
      metadata: this.metadata,
      ...(this.packRefs ? { guardrailPacks: this.packRefs } : {}),
    });
  }

  private branchReader() {
    // ponytail: prefer readBranchPath when present (memory, SQLite, Postgres) so snapshot does
    // not list() the whole session. JSONL and other omitters fall back to list() + in-memory walk.
    const read = this.store.readBranchPath;
    return read ? (query: SessionBranchRead) => read.call(this.store, query) : undefined;
  }

  resolveRunProvider(options: RunOptions): void {
    const model = options.model ?? this.agent.config.model;
    // Provider precedence: an explicit `AgentConfig.provider` wins and bypasses
    // the resolver entirely; otherwise `RunOptions.providerSource` overrides
    // `AgentConfig.providerSource` for this run. A miss on every source fails
    // closed with `Unknown provider: ${model.provider}` before any provider turn.
    const provider = this.agent.config.provider ?? options.providerSource?.(model) ?? this.agent.config.providerSource?.(model);
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    this.activeProvider = provider;
  }

  resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[] {
    const configured = this.agent.config.skills;
    if (configured && typeof configured === "object" && "list" in configured) {
      if (options.activeSkills) return resolveActiveSkills({ registry: configured, names: options.activeSkills, tools });
      if (options.skills !== undefined) return options.skills;
      if (options.activateAllSkills ?? this.agent.config.activateAllSkills) return configured.list();
      return [];
    }
    const arr = options.skills ?? (Array.isArray(configured) ? configured : []);
    return arr;
  }

  emit(event: AgentEvent): void {
    const redacted = redactAgentEvent(event, this.activeRedactor);
    for (const subscriber of this.subscribers) subscriber.push(redacted);

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

  async applyPendingSteers(runId: string, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean> {
    if (this.pendingSteers.length === 0) return false;
    const drained = this.pendingSteers.splice(0);
    this.pendingSteerBytes = 0;
    this.emit({ type: "queue_updated", sessionId: this.id, runId, size: 0 });
    for (const message of drained) {
      throwIfAborted(signal);
      const inputGuardrails = await runGuardrails({
        stage: "input",
        guardrails: this.activeGuardrails,
        value: [message],
        context: { sessionId: this.id, runId, metadata, signal },
        redactor: this.activeRedactor,
        emit: (event) => this.emit(event),
      });
      // Mid-run steer: a terminal decision drops the message (never enters history or
      // the session store) and the run continues. Run-start input blocking still fails
      // the run — only the blast radius of steered input is narrowed.
      const terminal = inputGuardrails.terminal;
      if (terminal) {
        if (terminal.action === "interrupt") throw new GuardrailError(terminal);
        this.emit({
          type: "steer_rejected",
          sessionId: this.id,
          runId,
          message: this.activeRedactor ? this.activeRedactor.redact(message) : message,
          record: terminal,
        });
        continue;
      }
      this.history.push(message);
      await this.appendMessage(message, runId);
    }
    return true;
  }

  async applyProviderRequestPolicies(
    request: ProviderRequest,
    runId: string,
    options: RunOptions,
    metadata: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) {
    const stamped = applyDefaultProviderRequestOptions(request, {
      sessionId: this.id,
      thinkingLevel: options.thinkingLevel ?? this.agent.config.thinkingLevel,
    });
    const policies = [...policyList(this.agent.config.providerRequestPolicies), ...policyList(options.providerRequestPolicies)];
    if (policies.length === 0) return { request: stamped, secrets: [] as readonly (string | undefined)[] };
    const result = await createProviderRequestPolicyChain(policies).apply({
      request: stamped,
      sessionId: this.id,
      runId,
      metadata,
      signal,
    });
    return normalizeProviderRequestPolicyResult(result);
  }

  async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  async autoCompact(runId: string, options: RunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void> {
    const compaction = mergeCompaction(this.agent.config.compaction, options.compaction);
    if (!compaction || (compaction.trigger === undefined && compaction.thresholdEntries === undefined)) return;
    const snapshot = await this.snapshot();
    // A branch that just compacted keeps its fresh summary: no second pass over the same entries.
    if (snapshot.entries.at(-1)?.kind === "compaction") return;
    const shouldCompact = await resolveShouldCompact(
      { trigger: compaction.trigger, thresholdEntries: compaction.thresholdEntries },
      {
        sessionId: this.id,
        entryCount: snapshot.entries.length,
        // Estimates of the branch the run is about to send: messages plus carried summaries.
        estimateInputTokens: () =>
          estimateAssemblyTokens(snapshot.messages) + snapshot.summaries.reduce((sum, summary) => sum + estimateTextTokens(summary), 0),
        // Same cap helper the attention compiler resolves its `inputCap` with.
        resolveInputCapTokens: () => resolveInputCap(undefined, options.model ?? this.agent.config.model),
        metadata: compaction.metadata,
        signal,
      },
    );
    if (!shouldCompact) return;
    await this.compactBranch(compaction, runId, signal, "auto");
    const compacted = await this.snapshot();
    this.history = withoutTrailingInput(compacted.messages, inputMessages);
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
    const strategy =
      options.strategy ??
      createDefaultCompactionStrategy({ keepRecentEntries: options.keepRecentEntries, maxSummaryChars: options.maxSummaryChars, secrets });
    const context = {
      sessionId: this.id,
      entries,
      keepRecentEntries: options.keepRecentEntries,
      trigger,
      secrets,
      metadata: options.metadata,
      signal,
    };
    this.emit({ type: "compaction_started", sessionId: this.id, runId });
    // Plan 106 R3: pre-compaction seam — the strategy compacts exactly the context this returns.
    const requested = (await this.agent.config.middleware?.run("compaction_request", context)) ?? context;
    let result = await strategy.compact(requested);
    result = { ...result, summary: redactSecrets(result.summary, secrets) };
    const payload: CompactionMiddlewarePayload = (await this.agent.config.middleware?.run("compaction", {
      context: requested,
      result,
    })) ?? {
      context: requested,
      result,
    };
    result = { ...payload.result, summary: redactSecrets(payload.result.summary, secrets) };
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
    this.emit({ type: "compaction_finished", sessionId: this.id, runId, summary: finalResult.summary });
    await this.rebuildHistory();
    return finalResult;
  }

  async appendEntry(entry: SessionEntry): Promise<void> {
    const redacted = redactSessionEntry(entry, this.activeRedactor);
    await this.store.append(redacted, {
      expectedParentId: this.currentLeafId,
      idempotencyKey: this.activeIdempotencyKey,
    });
    this.currentLeafId = redacted.id;
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
    this.history = (await this.snapshot()).messages.slice();
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
