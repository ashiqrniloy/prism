/** session (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */

import { ActiveDurableRun } from "../agent-approval.js";
import type { PendingToolCall, StoredAgentRunState } from "../agent-run-state.js";
import { policyList } from "../agent-tool-dispatch.js";
import { createDefaultCompactionStrategy, isCompactionEntryData } from "../compaction.js";
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
  ErrorInfo,
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
  ToolDefinition,
  ToolEffectStore,
  Usage,
} from "../contracts.js";
import { DEFAULT_MAX_PENDING_STEER_BYTES, DEFAULT_MAX_PENDING_STEERS } from "../contracts.js";
import { GuardrailError, runGuardrails } from "../guardrails.js";
import type { AgentIdentity } from "../identity.js";
import type { AgentInput } from "../input.js";
import { createProviderRequestPolicyChain, normalizeProviderRequestPolicyResult } from "../provider-request-policy.js";
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
  activeMetadata?: Readonly<Record<string, unknown>>;
  activePromptVersion?: PromptVersionRef;
  activeLimits?: RunLimitTracker;
  activeLimitOutputBuffer = false;
  activeDurable?: ActiveDurableRun;
  activeLoop?: import("../contracts.js").AgentLoopStrategy;
  /** Gated calls of the current tool round awaiting one collected suspension. */
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn = 1;
  private readonly loadedSkills = createLoadedSkillSet();
  /** Tools activated via `search_tools` this session (plan 041); names-only in persistence. */
  readonly activatedTools = createActiveToolSet();
  /** Plan 018 Task 6 (closeout `checkpoint-bodies`): persisted exact instructions, registry-independent. */
  restoredSkillBodies: readonly LoadedSkillBodiesEntry[] = [];
  /** Skills of the current run (for the bodies snapshot); replaced at each run start. */
  activeRunSkills: readonly import("../contracts.js").Skill[] = [];

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
  private ledgerChain: Promise<void> = Promise.resolve();
  private ledgerFailure: unknown;
  private snapshotGeneration = 0;
  private snapshotCache?: {
    readonly leafId?: string;
    readonly generation: number;
    readonly expiresAt: number;
    readonly value: SessionContextSnapshot;
  };

  constructor(config: AgentSessionConfig & { readonly agent: Agent }) {
    this.id = config.id ?? randomId("session");
    this.agent = config.agent;
    this.metadata = config.metadata;
    this.store = config.store ?? config.agent.config.store ?? createMemorySessionStore();
    this.currentLeafId = config.leafId;
  }

  get leafId(): string | undefined {
    return this.currentLeafId;
  }

  subscribe(options: SubscribeOptions = {}): AsyncIterable<AgentEvent> {
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
  ): Promise<AgentRunResult> {
    return this.runInternal(state.input ?? [], { runState, ownership, signal }, state.runId, {
      options: runState,
      state,
      version: state.version!,
      decisions,
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
      this.closeSubscribers();
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
      this.closeSubscribers();
    }
  }

  private async runInternal(input: AgentInput, options: RunOptions, runId: string, resumed?: ActiveDurableRun): Promise<AgentRunResult> {
    return executeRun(asSessionHost(this), input, options, runId, resumed);
  }

  prompt(input: string, options?: RunOptions): Promise<AgentRunResult> {
    return this.run(input, options);
  }

  async *stream(input: AgentInput, options: RunOptions & SubscribeOptions = {}): AsyncGenerator<AgentEvent> {
    const { maxQueuedEvents, overflow, ...runOptions } = options;
    const subscription = this.subscribe({ maxQueuedEvents, overflow });
    let runOwnedId: string | undefined;
    let settled = false;
    const runPromise = this.run(input, runOptions).finally(() => {
      settled = true;
    });
    try {
      for await (const event of subscription) {
        if ("runId" in event && typeof event.runId === "string") {
          if (runOwnedId === undefined && event.type === "agent_started") runOwnedId = event.runId;
          if (runOwnedId !== undefined && event.runId !== runOwnedId) continue;
        }
        yield event;
      }
      await runPromise;
    } finally {
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
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
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
      error: input.error,
      abortReason: input.abortReason,
      runState: input.runState,
      interruption: input.interruption,
    };
  }

  async compact(options: CompactionOptions = {}): Promise<CompactionResult> {
    if (this.activeRun) throw new Error("Agent session already has an active run");
    return this.compactBranch(options, undefined, options.signal, "manual");
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
    });
  }

  private branchReader() {
    // ponytail: prefer the store's readBranchPath (one ancestor-chain query) when present so a
    // DB-backed store never loads the full session; else fall back to list() + in-memory walk.
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
    const policies = [...policyList(this.agent.config.providerRequestPolicies), ...policyList(options.providerRequestPolicies)];
    if (policies.length === 0) return { request, secrets: [] as readonly (string | undefined)[] };
    const result = await createProviderRequestPolicyChain(policies).apply({ request, sessionId: this.id, runId, metadata, signal });
    return normalizeProviderRequestPolicyResult(result);
  }

  async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  async autoCompact(runId: string, options: RunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void> {
    const compaction = mergeCompaction(this.agent.config.compaction, options.compaction);
    if (!compaction || compaction.thresholdEntries === undefined) return;
    const snapshot = await this.snapshot();
    if (snapshot.entries.length <= compaction.thresholdEntries || snapshot.entries.at(-1)?.kind === "compaction") return;
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
    let result = await strategy.compact(context);
    result = { ...result, summary: redactSecrets(result.summary, secrets) };
    const payload: CompactionMiddlewarePayload = (await this.agent.config.middleware?.run("compaction", { context, result })) ?? {
      context,
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
    this.snapshotCache = { leafId: this.currentLeafId, generation: this.snapshotGeneration, expiresAt: now + 1_000, value };
    return value;
  }
}
