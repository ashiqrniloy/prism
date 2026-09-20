/** Shared host/round types for runInternal phase split (plan 059). Internal only. */

import type { ActiveDurableRun } from "../../agent-approval.js";
import type { PendingToolCall } from "../../agent-run-state.js";
import type {
  AttentionFoldLedger,
  AttentionStickyFrontier,
  PersistedAttentionFoldLedger,
  PersistedAttentionStickyFrontier,
} from "../../attention-compiler.js";
import type {
  Agent,
  AgentEvent,
  AgentFinishReason,
  AgentLoopStrategy,
  AgentRunResult,
  AIProvider,
  ErrorInfo,
  Guardrails,
  LoopContext,
  Message,
  ModelConfig,
  OwnershipScope,
  PendingDecision,
  PromptVersionRef,
  ProviderRequest,
  RunLedger,
  RunOptions,
  SessionEntry,
  SessionStore,
  Skill,
  ToolCallSummary,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
  ToolResult,
  Usage,
} from "../../contracts.js";
import type { AgentIdentity } from "../../identity.js";
import type { AgentInput } from "../../input.js";
import type { PersistedGuardrailPacks } from "../../agent-run-state.js";
import type { SecretRedactor } from "../../redaction.js";
import type { RunLimitTracker } from "../../run-limits.js";
import type { SessionContextSnapshot } from "../../session-stores.js";
import type { LoadedSkillSet } from "../../skill-disclosure.js";
import type { LoadedSkillBodiesEntry } from "../../skill-load.js";
import type { ActiveToolSet } from "../../tool-search.js";

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
  activeProvider?: AIProvider;
  activeLedger?: RunLedger;
  activeEffectStore?: ToolEffectStore;
  activeOwnership?: OwnershipScope;
  activeIdentity?: AgentIdentity;
  activeIdempotencyKey?: string;
  activeGuardrails?: Guardrails;
  /** Plan 092 Task 2: packs compiled once at session construction; read-only for phases. */
  readonly packGuardrails?: Guardrails;
  /** Plan 104 T3: `ask` rules as the durable charge-time gate (`interrupt` records) and as plain
   *  blocks for a run that cannot suspend. */
  readonly packAskGate?: Guardrails;
  readonly packAskBlocks?: Guardrails;
  /** Plan 104 T2: pack refs + live pack-owned state for a durable checkpoint. */
  serializedGuardrailPackState(): PersistedGuardrailPacks | undefined;
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
  activeLoop?: AgentLoopStrategy;
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn: number;
  readonly loadedSkills: LoadedSkillSet;
  /** Run-owned monotonic prompt tail; cleared before each new run. */
  readonly tailSegments: Map<string, Message>;
  readonly activatedTools: ActiveToolSet;
  restoredSkillBodies: readonly LoadedSkillBodiesEntry[];
  activeRunSkills: readonly Skill[];
  /** Names-only grant for this run; undefined means the full registered set. */
  activeToolNames?: readonly string[];
  /** Sticky mutation frontier for this session (plan 074 C10); session-owned so it survives
   *  across turns, runs, and provider rounds. Lazily created on first use. */
  attentionStickyFor(): AttentionStickyFrontier;
  /** Plan 074 P3: bounded frontier snapshot for durable checkpoints (undefined before any mutation). */
  serializedAttentionSticky(): PersistedAttentionStickyFrontier | undefined;
  /** Plan 074 P3: restore a frontier that was validated when the checkpoint was loaded. */
  restoreAttentionSticky(persisted: PersistedAttentionStickyFrontier): void;
  /** Folded bodies for this session (plan 086 T3); session-owned so a resumed fold re-applies
   *  the same stub bytes instead of calling the host `summarize` again. Lazily created. */
  attentionFoldFor(): AttentionFoldLedger;
  /** Plan 086 T3: bounded ledger snapshot for a durable checkpoint (undefined before any fold). */
  serializedAttentionFold(): PersistedAttentionFoldLedger | undefined;
  /** Plan 086 T3: adopt a ledger validated when the checkpoint was loaded. */
  restoreAttentionFold(ledger: AttentionFoldLedger): void;
  /** Plan 086 T3: `attention.compiler.durable` for the current run; set by the run assembler. */
  attentionDurable: boolean;
  invalidateSnapshot(): void;
  resolveRunProvider(options: RunOptions): void;
  emit(event: AgentEvent): void;
  rebuildHistory(): Promise<void>;
  resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[];
  appendEntry(entry: SessionEntry): Promise<void>;
  redact<T>(value: T): T;
  appendMessage(message: Message, runId: string): Promise<void>;
  autoCompact(runId: string, options: RunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void>;
  applyPendingSteers(runId: string, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean>;
  applyProviderRequestPolicies(
    request: ProviderRequest,
    runId: string,
    options: RunOptions,
    metadata: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<{ request: ProviderRequest; secrets: readonly (string | undefined)[] }>;
  redactProviderRequest(request: ProviderRequest): ProviderRequest;
  drainLedger(): Promise<void>;
  buildRunResult(input: {
    readonly runId: string;
    readonly status: AgentRunResult["status"];
    readonly usage?: Usage;
    readonly limit?: import("../../contracts.js").RunLimitBreach;
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
    readonly runState?: import("../../contracts.js").AgentRunState;
    readonly interruption?: import("../../contracts.js").AgentRunInterruption;
  }): AgentRunResult;
  /** Session teardown: close every subscriber, run-scoped and `acrossRuns` alike. */
  closeSubscribers(): void;
  /** Run end (finish, suspend, or deny): close only the subscribers that do not opt into `acrossRuns`. */
  closeRunSubscribers(): void;
  snapshot(): Promise<SessionContextSnapshot>;
};

export function asSessionHost(session: unknown): SessionHost {
  return session as SessionHost;
}

/** Why a run's loop ended, plus the host's stop detail when `RunOptions.turnPolicy` stopped it. */
export type RunStopInfo = { readonly reason: AgentFinishReason; readonly detail?: string };

export type RoundContext = {
  session: SessionHost;
  input: AgentInput;
  options: RunOptions;
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
  contextProviders: NonNullable<Agent["config"]["context"]>;
  providerOptions: import("../../contracts.js").ProviderRequestOptions | undefined;
  validate: RunOptions["validate"];
  instructionInjectors: NonNullable<Agent["config"]["instructionInjectors"]>;
  inputLayout: RunOptions["inputLayout"];
  loop: AgentLoopStrategy;
  toolConcurrency: number;
  toolsDisclosure: import("../../tool-search.js").ToolsDisclosure;
  /** Per-turn dispatch overlay; undefined when `toolNarrowing` is unset. */
  turnAllow?: readonly string[];
  assembledTurn: boolean;
  artifactFinished: boolean;
  artifactFailedInfo: { message: string; code?: string | number } | undefined;
  /** Host tool calls dispatched in this run; the turn-boundary context's `toolCalls` (plan 084 Task 2). */
  toolCalls: number;
  /** Completed host tool results from this run, for output evidence guardrails (plan 084 Task 5). */
  toolResults: ToolResult[];
  /** Set when a `RunOptions.turnPolicy` stop ended the loop (plan 084 Task 2). */
  runStop?: RunStopInfo;
  runUsage: { add(usage: Usage): void; value(): Usage | undefined };
  loopCtx: LoopContext;
};
