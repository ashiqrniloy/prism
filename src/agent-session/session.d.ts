/** session (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */
import { ActiveDurableRun } from "../agent-approval.js";
import type { PendingToolCall, StoredAgentRunState } from "../agent-run-state.js";
import { type DurableRunStateOptions } from "../run-state-cell.js";
import type { Agent, AgentEvent, AgentRunState, AgentRunStatus, CompactionOptions, CompactionResult, ContextMeter, Decision, ErrorInfo, Message, ModelProvider, OwnershipScope, PendingDecision, PromptVersionRef, ProviderRequest, ResolvedRunOptions, RunOptions, RunResult, Session, SessionEntry, SessionForkOptions, SessionOptions, SessionStore, Skill, SteerOptions, SubscribeOptions, ToolCallSummary, ToolDefinition, ToolEffectStore, Usage } from "../contracts.js";
import { type HookBus } from "../hooks/index.js";
import type { Principal } from "../contracts-core/principal.js";
import type { AgentInput } from "../input.js";
import type { LoopStrategy } from "../loop/index.js";
import { type SecretRedactor } from "../redaction.js";
import { type RunLimitTracker } from "../run-limits.js";
import { type ExternalStateHandle } from "../session/external-state.js";
import type { SessionContext } from "../session-context.js";
import type { SessionContextSnapshot } from "../session-stores.js";
import type { LoadedSkillBodiesEntry } from "../skill-load.js";
import { type SlotRegistry } from "../slots/index.js";
import { type SuspendedRunEntryData } from "../suspended-run.js";
export declare class RuntimeAgentSession implements Session {
    readonly id: string;
    private readonly agent;
    /** Plan 177 Task 4: the agent's scope narrowed by `SessionOptions.ownership`; every run narrows it further. */
    readonly scope: OwnershipScope | undefined;
    private readonly metadata?;
    private readonly store;
    private readonly subscribers;
    /** Plan 106 R2: `session_start` is dispatched at the first run start, once per runtime session. */
    private currentLeafId?;
    private history;
    private activeRun?;
    private activeRunId?;
    private activeProviderTurnAbort?;
    pendingSoftInterrupt: boolean;
    private pendingSteers;
    private readonly steerListeners;
    private pendingSteerBytes;
    private activeRedactor?;
    activeProvider?: ModelProvider;
    private activeLedger?;
    activeEffectStore?: ToolEffectStore;
    private activeOwnership?;
    activePrincipal?: Principal;
    private activeIdempotencyKey?;
    /** Messages the active run appended to the branch (as stored, after redaction); reset at each run start. */
    activeRunMessages: Message[];
    activeMetadata?: Readonly<Record<string, unknown>>;
    activePromptVersion?: PromptVersionRef;
    activeLimits?: RunLimitTracker;
    /** Plan 091 T2: input tokens of the latest provider turn plus whether the provider reported
     *  them; set by the usage seam, read by `contextMeter()`. */
    activeInputMeter?: {
        readonly tokens: number;
        readonly source: "reported" | "estimated";
    };
    /** Bounded last-N tool-call summaries of the active run (plan 087 T2): ids, names, arg hashes. */
    activeRecentToolCalls?: ToolCallSummary[];
    activeLimitOutputBuffer: boolean;
    activeDurable?: ActiveDurableRun;
    activeLoop?: LoopStrategy;
    activeLoopHistory?: Message[];
    /** Gated calls of the current tool round awaiting one collected suspension. */
    activeGatedRound?: Map<string, {
        entry: PendingToolCall;
        decision: PendingDecision;
    }>;
    activeLoopTurn: number;
    private readonly loadedSkills;
    /** Run-owned only: loaded bodies and URI resources retain first insertion order within one provider loop. */
    readonly tailSegments: Map<string, Message>;
    /** Plan 018 Task 6 (closeout `checkpoint-bodies`): persisted exact instructions, registry-independent. */
    restoredSkillBodies: readonly LoadedSkillBodiesEntry[];
    /** Skills of the current run (for the bodies snapshot); replaced at each run start. */
    activeRunSkills: readonly import("../contracts.js").Skill[];
    /** Per-run tool allow-list (Task 21); undefined means the full registered set. */
    activeToolNames?: readonly string[];
    /** Plan 015 Task 4: re-add persisted loaded-skill names (names only; bodies re-resolve on demand). */
    restoreLoadedSkills(names: readonly string[], runId?: string): void;
    /** Plan 137 Task 3: loaded skill names currently active in this session. */
    getLoadedSkillNames(): readonly string[];
    /** Plan 018 Task 6: restore persisted loaded-skill bodies (already validated fail-closed at load). */
    restoreLoadedSkillBodies(bodies: readonly LoadedSkillBodiesEntry[], runId?: string): void;
    private ledgerChain;
    private ledgerFailure;
    private snapshotGeneration;
    private snapshotCache?;
    private readonly snapshotCacheTtlMs;
    /**
     * Plan 103 T4: identity-keyed meter cache. Holds only the last public meter value
     * plus the identity of everything the cold read consumed (`snapshotGeneration`,
     * leaf, active meter/limits, and the history array reference + length, which catches
     * in-place `history.push` during a run) — never history content, never an estimator.
     */
    private meterCache?;
    /** Host hook bus (roadmap §2.4); per-agent, shared across this agent's sessions. */
    private readonly hookBusInstance;
    /** The same bus, bound so each handler's `context.session` is a view for its registering owner. */
    private readonly boundHooks;
    /** Per-owner session views, built once so hook dispatch allocates none. */
    private readonly sessionViews;
    /** Declared capabilities per package. An owner absent from it (`host`, `kernel`) is unrestricted. */
    private readonly packageCapabilities;
    /** Tasks started through `SessionContext.background`: reported as events, settled by `close()`. */
    private readonly background;
    /** Package state (`package_state` entries on this branch). Bound to every view this session hands out. */
    private readonly stateStore;
    private readyPromise?;
    private closing?;
    /** Serializes appends, so a state `set` racing a run's own append cannot orphan either entry. */
    private appendTail;
    /** Slot registry (roadmap §2.5); direct assignments come from `AgentConfig.slots`. */
    private readonly slotRegistry;
    /** Re-entry guard for observe dispatch: an observer that throws on `hook.error` must not loop. */
    private observingHookError;
    /** Pending suspended run entry found on session resume (plan 149 Task 2 / Task 4). */
    pendingSuspendedRun?: SuspendedRunEntryData;
    /** `SessionOptions.parent` and `actor`, written once when a new session opens. */
    private readonly links;
    constructor(config: SessionOptions & {
        readonly agent: Agent;
        readonly store: SessionStore;
    });
    get leafId(): string | undefined;
    /** Host hook bus for this agent (roadmap §2.4). */
    hooks(): HookBus;
    /** This session as `owner` sees it. A package without `"background"` gets `capability_missing` from `background(...)`. */
    sessionContextFor(owner: string): SessionContext;
    /**
     * Reads this session's branch once, so package state is available and `session.opened` can fire. Awaited
     * at run start (which covers resume), in `agent.commands.run`, by `set`, and by `close()`. A session no
     * package or hook cares about reads nothing, so existing sessions cost no extra store read.
     */
    ready(): Promise<void>;
    /**
     * Called eagerly when `agent.session()` opens a new session.
     * Zero store read; marks ready, hydrates empty state, and fires eager `session.opened`.
     */
    openNewSession(): Promise<void>;
    /**
     * Called eagerly when `agent.session({ id, create: true })` resumes an existing session.
     * Hydrates package state from branch, finds pending suspended run, and fires eager `session.opened`.
     */
    openResumedSession(branch: readonly SessionEntry[]): Promise<void>;
    /** Whether anything needs the branch read: package state, or a `session.opened` hook. */
    private needsOpening;
    private openSession;
    /** Re-reads package state for a new leaf. `session.opened` already fired for this session. */
    private rehydrateState;
    private appendPackageState;
    /** `run.state(key)` for the loop `vendor` (roadmap §2.12.9 K5): an `external_state` log on this branch. */
    externalState(vendor: string, key: string): ExternalStateHandle;
    /** Slot registry for this agent (roadmap §2.5). */
    slots(): SlotRegistry;
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
    contextMeter(): ContextMeter;
    /** Cold path of `contextMeter()`: one estimate over stored history plus cap/budget resolution. */
    private measureContextMeter;
    /**
     * Live events for this session. A run-scoped subscriber (the default) is closed when the run ends,
     * suspends, or is denied; `SubscribeOptions.acrossRuns: true` keeps one subscriber open across runs
     * of the same session until the host closes it, the session tears it down, or its bounded queue
     * overflows under the default policy. Subscribe before `run()`; the consumer loop and `run()` must
     * run concurrently, since events are only emitted during a live run.
     */
    subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
    private createSubscriber;
    run(input: AgentInput, options?: RunOptions): Promise<RunResult>;
    steer(input: AgentInput, options?: SteerOptions): void;
    /**
     * Kernel-internal resume core, shared by `session.resume` (the store-slot `suspended_run` entry is
     * the only durable anchor): re-enters the run loop for a suspended run's stored state. Announces the
     * settled batch with `decision.resolved` first, keyed by the tool call id the pending decision
     * named (never the arguments, which a decision may have modified).
     */
    continueSuspendedRun(state: StoredAgentRunState, runState: DurableRunStateOptions, ownership?: OwnershipScope, signal?: AbortSignal, decisions?: ReadonlyMap<string, Decision>, runOptions?: ResolvedRunOptions, 
    /** The suspension's pending decisions: the claimed state no longer carries them. */
    pending?: readonly PendingDecision[]): Promise<RunResult>;
    resume(decisions: readonly Decision[], options?: RunOptions & SubscribeOptions): AsyncGenerator<AgentEvent>;
    /**
     * Read this session's pending suspension from its branch and turn the host's decisions into a claimed,
     * resumable run. The claim lives in a private in-memory cell seeded from the stored state, because
     * the store slot's `suspended_run` entry is the durable anchor (plan 168 Task 5).
     */
    private prepareResume;
    private runInternal;
    /** Session teardown: closes every subscriber, run-scoped and `acrossRuns` alike (idempotent). */
    close(): Promise<void>;
    /**
     * Settles background tasks within `limits.backgroundSettleMs` and aborts the rest, removes this session's
     * pack hooks from the shared bus, tells hooks the session closed, then closes every subscriber.
     */
    private closeSession;
    stream(input: AgentInput, options?: RunOptions & SubscribeOptions): AsyncGenerator<AgentEvent>;
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
    }): RunResult;
    compact(options?: CompactionOptions): Promise<CompactionResult>;
    abort(reason?: unknown): void;
    entries(): Promise<readonly SessionEntry[]>;
    checkout(leafId?: string): Promise<void>;
    messages(): Promise<readonly Message[]>;
    fork(options?: SessionForkOptions): Promise<Session>;
    private branchReader;
    /** The agent's redactor, plus any value `credentials.resolve` returned (a package may resolve one mid-run). */
    runRedactor(base?: SecretRedactor | undefined): SecretRedactor | undefined;
    resolveRunProvider(options: ResolvedRunOptions, skip?: boolean): void;
    resolveRunSkills(tools: readonly ToolDefinition[]): readonly Skill[];
    emit(event: AgentEvent): void;
    /**
     * An event raised outside a run (a background task ending after the run did). `activeRedactor` is unset
     * then, so the agent's own redactor and the resolved secrets apply instead.
     */
    private emitBetweenRuns;
    private redactBetweenRuns;
    /**
     * Session lifecycle events reach hooks and agent subscribers. A session stream stays what it was: its first event is still
     * the run's own, and nothing sees `session.opened` before `run.started`.
     */
    private observeOnly;
    private dispatchEvent;
    /**
     * Observe hooks: every agent event is an observe hook (roadmap §2.4). A `hook.error` raised by a
     * throwing observer routes back here, so drop a `hook.error` that is itself produced while
     * dispatching a `hook.error`.
     */
    private observe;
    private recordToLedger;
    /**
     * Run end (finish, suspension, or denial): closes the run-scoped subscribers only. Subscribers that
     * opted into `SubscribeOptions.acrossRuns` stay open for the next run of this session.
     */
    closeRunSubscribers(): void;
    closeSubscribers(): void;
    drainLedger(): Promise<void>;
    /** Register a `steer()` listener (the `RunController.steers()` wake-up); returns its unsubscribe. */
    onSteer(listener: () => void): () => void;
    applyPendingSteers(runId: string, _metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean>;
    /** Drain the steer queue through the `run.input` gate; returns the messages that survived it. */
    drainSteers(runId: string, signal: AbortSignal): Promise<readonly Message[]>;
    appendMessage(message: Message, runId: string): Promise<void>;
    autoCompact(runId: string, options: ResolvedRunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void>;
    autoCompactTurn(runId: string, options: ResolvedRunOptions, signal: AbortSignal, turn: number): Promise<void>;
    /**
     * Compact because the provider rejected the request for size (plan 194 Task 3). The provider
     * already decided, so `compaction.when` is not consulted; a failure propagates so recovery can
     * fail closed with `ContextOverflowError` instead of retrying an oversized request.
     */
    compactOverflow(runId: string, options: ResolvedRunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void>;
    /**
     * Resolve the auto-compaction decision, or `undefined` when there is nothing to do. A
     * `compaction.when` handler votes `true`/`false` or abstains; the configured
     * `trigger`/`thresholdEntries` is the fallback used only when every registered handler abstains
     * (or none is registered).
     */
    private resolveAutoCompact;
    /**
     * Compact, falling back to continuing uncompacted with a `compaction_failed` event. The trigger
     * decision stays outside this seam: an unresolvable input cap is a host config error and must
     * fail loudly, while a summarizer/strategy failure is a runtime hiccup the run survives.
     */
    private compactBranchResilient;
    private compactBranch;
    /**
     * Appends at the tip, one at a time. A `package_state` write from a hook or background task can overlap
     * the run's own append, and two appends from the same tip would orphan one of them. An entry made for
     * the tip it saw is rebased onto the tip it lands on.
     */
    appendEntry(entry: SessionEntry): Promise<void>;
    private serialAppend;
    private appendNow;
    invalidateSnapshot(): void;
    redact<T>(value: T): T;
    redactProviderRequest(request: ProviderRequest): ProviderRequest;
    rebuildHistory(): Promise<void>;
    /**
     * Replace the live history in place. A mid-run compaction must never reassign `history`: the
     * active loop holds that array (`activeLoopHistory`), so a fresh array would silently drop every
     * later turn from the session view (run result text/content, tool narrowing) while the loop kept
     * appending to its own copy.
     */
    private replaceHistory;
    snapshot(): Promise<SessionContextSnapshot>;
}
