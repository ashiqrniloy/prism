/** Shared host/round types for runInternal phase split (plan 059). Internal only. */

import type { ActiveDurableRun } from "../../agent-approval.js";
import type { PendingToolCall } from "../../agent-run-state.js";

import type {
  Agent,
  AgentEvent,
  AgentFinishReason,
  AgentRunStatus,
  RunResult,
  ModelProvider,
  ErrorInfo,
  Message,
  ModelConfig,
  OwnershipScope,
  PendingDecision,
  PromptVersionRef,
  ProviderRequest,
  RunLedger,
  RunOptions,
  ResolvedRunOptions,
  SessionEntry,
  SessionStore,
  Skill,
  EventOrigin,
  ToolCallContent,
  ToolCallSummary,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
  ToolResult,
  Usage,
} from "../../contracts.js";
import type { Principal } from "../../contracts-core/principal.js";
import type { AgentInput } from "../../input.js";
import type { HookBus } from "../../hooks/index.js";
import type { LoopStrategy, RunController } from "../../loop/index.js";
import type { SecretRedactor } from "../../redaction.js";
import type { RunLimitTracker } from "../../run-limits.js";
import type { SessionContextSnapshot } from "../../session-stores.js";
import type { LoadedSkillSet } from "../../skill-disclosure.js";
import type { LoadedSkillBodiesEntry } from "../../skill-load.js";
import type { SlotRegistry } from "../../slots/index.js";

/** Live session bag phases mutate. Cast from RuntimeAgentSession (private fields). */
export type SessionHost = {
  readonly id: string;
  readonly agent: Agent;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly store: SessionStore;
  currentLeafId?: string;
  history: Message[];
  activeRun?: AbortController;
  activeRunId?: string;
  activeProviderTurnAbort?: AbortController;
  pendingSoftInterrupt: boolean;
  pendingSteers: Message[];
  pendingSteerBytes: number;
  activeRedactor?: SecretRedactor;
  activeProvider?: ModelProvider;
  activeLedger?: RunLedger;
  activeEffectStore?: ToolEffectStore;
  activeOwnership?: OwnershipScope;
  activePrincipal?: Principal;
  activeIdempotencyKey?: string;
  activeRunMessages: Message[];
  activeMetadata?: Readonly<Record<string, unknown>>;
  activePromptVersion?: PromptVersionRef;
  activeLimits?: RunLimitTracker;
  /** Plan 091 T2: input tokens of the latest provider turn plus whether the
   *  provider reported them. Set by the usage seam; read by `contextMeter()`. */
  activeInputMeter?: { readonly tokens: number; readonly source: "reported" | "estimated" };
  /** Bounded last-N tool-call summaries of the active run (plan 087 T2): ids, names, arg hashes. */
  activeRecentToolCalls?: ToolCallSummary[];
  activeLimitOutputBuffer: boolean;
  activeDurable?: ActiveDurableRun;
  activeLoop?: LoopStrategy;
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn: number;
  readonly loadedSkills: LoadedSkillSet;
  /** Run-owned monotonic prompt tail; cleared before each new run. */
  readonly tailSegments: Map<string, Message>;

  restoredSkillBodies: readonly LoadedSkillBodiesEntry[];
  activeRunSkills: readonly Skill[];
  /** Names-only grant for this run; undefined means the full registered set. */
  activeToolNames?: readonly string[];
  invalidateSnapshot(): void;
  /** Host hook bus for this agent (roadmap §2.4). */
  hooks(): HookBus;
  /** Slot registry for this agent (roadmap §2.5). */
  slots(): SlotRegistry;
  resolveRunProvider(options: ResolvedRunOptions, skip?: boolean): void;
  emit(event: AgentEvent): void;
  rebuildHistory(): Promise<void>;
  resolveRunSkills(tools: readonly ToolDefinition[]): readonly Skill[];
  runRedactor(base?: SecretRedactor): SecretRedactor | undefined;
  sessionContextFor(owner: string): import("../../session-context.js").SessionContext;
  /** Redacted, cap-checked steer queue push (plan 106 R1 uses it for stop-hook continuations). */
  steer(input: AgentInput): void;
  appendEntry(entry: SessionEntry): Promise<void>;
  externalState(vendor: string, key: string): import("../../session/external-state.js").ExternalStateHandle;
  redact<T>(value: T): T;
  appendMessage(message: Message, runId: string): Promise<void>;
  autoCompact(runId: string, options: ResolvedRunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void>;
  autoCompactTurn(runId: string, options: ResolvedRunOptions, signal: AbortSignal, turn: number): Promise<void>;
  activeLoopHistory?: Message[];
  applyPendingSteers(runId: string, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean>;
  drainSteers(runId: string, signal: AbortSignal): Promise<readonly Message[]>;
  onSteer(listener: () => void): () => void;
  redactProviderRequest(request: ProviderRequest): ProviderRequest;
  drainLedger(): Promise<void>;
  buildRunResult(input: {
    readonly runId: string;
    /** The persisted run status; the result carries the host-facing status. */
    readonly status: AgentRunStatus;
    readonly usage?: Usage;
    readonly stopReason?: AgentFinishReason;
    readonly stopDetail?: string;
    readonly limit?: import("../../contracts.js").RunLimitBreach;
    readonly attribution?: import("../../run-limits.js").BudgetExhaustionAttribution;
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
    readonly runState?: import("../../contracts.js").AgentRunState;
    readonly interruption?: import("../../contracts.js").AgentRunInterruption;
  }): RunResult;
  /** Session teardown: close every subscriber, run-scoped and `acrossRuns` alike. */
  closeSubscribers(): void;
  /** Run end (finish, suspend, or deny): close only the subscribers that do not opt into `acrossRuns`. */
  closeRunSubscribers(): void;
  snapshot(): Promise<SessionContextSnapshot>;
};

export function asSessionHost(session: unknown): SessionHost {
  return session as SessionHost;
}

export type RoundContext = {
  session: SessionHost;
  input: AgentInput;
  options: ResolvedRunOptions;
  runId: string;
  resumed: ActiveDurableRun | undefined;
  controller: AbortController;
  model: ModelConfig;
  metadata: Readonly<Record<string, unknown>>;
  limits: RunLimitTracker;
  registry: ToolRegistry;
  tools: readonly ToolDefinition[];
  activeSkills: readonly Skill[];
  inputMessages: Message[];
  maxToolRounds: number | undefined;
  systemInstructions: string | undefined;
  providerOptions: import("../../contracts.js").ProviderRequestOptions | undefined;
  validate: RunOptions["validate"];
  inputLayout: RunOptions["inputLayout"];
  loop: LoopStrategy;
  /** The loop's only handle; the default loop reaches the kernel through it. */
  runController: RunController;
  /** Bound tool dispatch (approval/sticky-aware); the run loop reaches tools only through it. */
  dispatchToolCall(call: ToolCallContent, origin?: EventOrigin): Promise<ToolResult>;
  /** Why the loop stopped, when a ceiling or a hook ended it cleanly (F4). */
  loopFinishReason?: AgentFinishReason;
  /** Redacted, byte-capped reason a `turn.before` handler returned with its `{ stop }`. */
  loopStopDetail?: string;

  /** Per-turn dispatch overlay; set when `RunOptions.tools` scopes the turn. */
  turnAllow?: readonly string[];
  assembledTurn: boolean;
  /** Host tool calls dispatched in this run; the turn-boundary context's `toolCalls` (plan 084 Task 2). */
  toolCalls: number;
  /** Completed host tool results from this run, for output evidence guardrails (plan 084 Task 5). */
  toolResults: ToolResult[];
  runUsage: { add(usage: Usage): void; value(): Usage | undefined };
};
