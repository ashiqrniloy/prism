/** Shared host/round types for runInternal phase split (plan 059). Internal only. */

import type { ActiveDurableRun } from "../../agent-approval.js";
import type { PendingToolCall } from "../../agent-run-state.js";
import type {
  Agent,
  AgentEvent,
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
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
  Usage,
} from "../../contracts.js";
import type { AgentIdentity } from "../../identity.js";
import type { AgentInput } from "../../input.js";
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
  activeMetadata?: Readonly<Record<string, unknown>>;
  activePromptVersion?: PromptVersionRef;
  activeLimits?: RunLimitTracker;
  activeLimitOutputBuffer: boolean;
  activeDurable?: ActiveDurableRun;
  activeLoop?: AgentLoopStrategy;
  activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  activeLoopTurn: number;
  readonly loadedSkills: LoadedSkillSet;
  readonly activatedTools: ActiveToolSet;
  restoredSkillBodies: readonly LoadedSkillBodiesEntry[];
  activeRunSkills: readonly Skill[];
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
  closeSubscribers(): void;
  snapshot(): Promise<SessionContextSnapshot>;
};

export function asSessionHost(session: unknown): SessionHost {
  return session as SessionHost;
}

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
  assembledTurn: boolean;
  artifactFinished: boolean;
  artifactFailedInfo: { message: string; code?: string | number } | undefined;
  runUsage: { add(usage: Usage): void; value(): Usage | undefined };
  loopCtx: LoopContext;
};
