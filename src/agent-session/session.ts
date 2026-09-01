/** session (0.2.5 plan 025 Task 1 split). Moved verbatim from agent-session.ts; public surface unchanged behind the barrel. */

import {
  ActiveDurableRun,
  AgentRunSuspended,
  decisionIdentityRef,
  decisionScopesEqual,
  nestedApprovalId,
  nestedOutcomeToolResult,
  pathsEqual,
} from "../agent-approval.js";
import { resolveLoop, resolveToolConcurrency } from "../agent-loops.js";
import type { PendingToolCall, StoredAgentRunState } from "../agent-run-state.js";
import { boundedLoopSnapshot, initialAgentRunState, publicState, saveAgentRunState, validateRunStateOptions } from "../agent-run-state.js";
import { activeTools, policyList, toolElicitationRequest } from "../agent-tool-dispatch.js";
import { createDefaultCompactionStrategy, isCompactionEntryData } from "../compaction.js";
import type {
  Agent,
  AgentEvent,
  AgentEventRecord,
  AgentRunRef,
  AgentRunResult,
  AgentRunState,
  AgentRunStateOptions,
  AgentSession,
  AgentSessionConfig,
  AIProvider,
  CompactionMiddlewarePayload,
  CompactionOptions,
  CompactionResult,
  ContentBlock,
  ErrorInfo,
  Guardrails,
  LoopContext,
  Message,
  NestedRunRef,
  OwnershipScope,
  PendingDecision,
  PromptVersionRef,
  ProviderEvent,
  ProviderRequest,
  ProviderTurnMetadata,
  ProviderTurnResult,
  ResumeNestedRun,
  RetryMiddlewarePayload,
  RunDecision,
  RunLedger,
  RunOptions,
  RunRecord,
  SessionBranchRead,
  SessionEntry,
  SessionStore,
  Skill,
  SteerOptions,
  StickyDecision,
  SubscribeOptions,
  ToolCallContent,
  ToolDefinition,
  ToolEffectStore,
  ToolRegistry,
  ToolResult,
  Usage,
  UsageRecord,
} from "../contracts.js";
import {
  AgentDecisionError,
  AgentDelegationSuspendedError,
  AgentLoopStateError,
  AgentRunError,
  AgentRunStateError,
  DEFAULT_MAX_PENDING_DECISIONS,
  DEFAULT_MAX_PENDING_STEER_BYTES,
  DEFAULT_MAX_PENDING_STEERS,
  HARD_MAX_PENDING_DECISIONS,
  MAX_ATTRIBUTION_DEPTH,
} from "../contracts.js";
import { assertGuardrailsAllowed, GuardrailError, runGuardrails } from "../guardrails.js";
import type { AgentIdentity } from "../identity.js";
import { identityTelemetryAttributes, ownershipFromIdentity, resolveRunIdentity } from "../identity.js";
import type { AgentInput } from "../input.js";
import { assembleProviderInput } from "../input.js";
import { createProviderTurnMetadata, readProviderHttpStatus } from "../observability.js";
import { providerToolCallDeltaContent } from "../provider-events.js";
import { createProviderRequestPolicyChain, normalizeProviderRequestPolicyResult } from "../provider-request-policy.js";
import type { SecretRedactor } from "../redaction.js";
import {
  errorToErrorInfo,
  redactAgentEvent,
  redactProviderRequest,
  redactRunLedgerRecord,
  redactSecrets,
  redactSessionEntry,
} from "../redaction.js";
import { createDefaultRetryPolicy, waitForRetry } from "../retry.js";
import { isFlushableRunLedger } from "../run-ledger.js";
import { RunLimitError, RunLimitTracker, resolveRunLimits } from "../run-limits.js";
import type { SessionContextSnapshot } from "../session-stores.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, rebuildSessionContext } from "../session-stores.js";
import { createLoadedSkillSet, resolveSkillsDisclosure } from "../skill-disclosure.js";
import type { LoadedSkillBodiesEntry } from "../skill-load.js";
import { applyRestoredSkillBodies, snapshotLoadedSkillBodies, validateLoadedSkillBodies } from "../skill-load.js";
import { resolveActiveSkills } from "../skills.js";
import { assertStructuredOutputRequestSupported, resolveRunProviderOptions } from "../structured-output.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../system-prompts.js";
import { canonicalToolEffectJson, toolEffectArgumentsHash } from "../tool-effects.js";
import { resolveToolResultFold } from "../tool-result-fold.js";
import { createActiveToolSet, createSearchToolsTool, createToolSearchState, resolveToolsDisclosure } from "../tool-search.js";
import { createToolRegistry, dispatchToolCall, resolveToolEffectDeclaration } from "../tools.js";
import { createAgentSession } from "./create-agent.js";
import { EventSubscriber } from "./event-subscriber.js";
import {
  bridgeAbort,
  createUsageAccumulator,
  errorFromInfo,
  finalAssistantMessage,
  inputToMessages,
  isDurableLoop,
  isSteerSoftInterrupt,
  jsonBytes,
  mergeCompaction,
  mergeGuardrails,
  mergeRetry,
  messageTextBytes,
  ProviderTurnFailure,
  providerContent,
  randomId,
  reconstructMissingToolCalls,
  SteerSoftInterrupt,
  throwIfAborted,
  throwIfAbortedSignal,
  withoutTrailingInput,
} from "./helpers.js";

const PROMPT_VERSION_MAX_NAME_BYTES = 256;
const PROMPT_VERSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Plan 042: validate the opaque provenance ref fail-closed before any session mutation. */
function assertPromptVersionRef(ref: PromptVersionRef | undefined): PromptVersionRef | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref !== "object" || ref === null) throw new TypeError("RunOptions.promptVersion must be a PromptVersionRef object");
  const { name, version, hash } = ref;
  if (typeof name !== "string" || name.length === 0 || Buffer.byteLength(name, "utf8") > PROMPT_VERSION_MAX_NAME_BYTES) {
    throw new TypeError(`RunOptions.promptVersion.name must be 1-${PROMPT_VERSION_MAX_NAME_BYTES} UTF-8 bytes`);
  }
  if (!Number.isInteger(version) || version < 1 || version > 0x7fffffff) {
    throw new TypeError("RunOptions.promptVersion.version must be an integer in [1, 2147483647]");
  }
  if (typeof hash !== "string" || !PROMPT_VERSION_HASH_PATTERN.test(hash)) {
    throw new TypeError('RunOptions.promptVersion.hash must be "sha256:" plus 64 lowercase hex characters');
  }
  return ref;
}

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
  private pendingSoftInterrupt = false;
  private pendingSteers: Message[] = [];
  private pendingSteerBytes = 0;
  private activeRedactor?: SecretRedactor;
  private activeProvider?: AIProvider;
  private activeLedger?: RunLedger;
  private activeEffectStore?: ToolEffectStore;
  private activeOwnership?: OwnershipScope;
  private activeIdentity?: AgentIdentity;
  private activeIdempotencyKey?: string;
  private activeGuardrails?: Guardrails;
  private activeMetadata?: Readonly<Record<string, unknown>>;
  private activePromptVersion?: PromptVersionRef;
  private activeLimits?: RunLimitTracker;
  private activeLimitOutputBuffer = false;
  private activeDurable?: ActiveDurableRun;
  private activeLoop?: import("../contracts.js").AgentLoopStrategy;
  /** Gated calls of the current tool round awaiting one collected suspension. */
  private activeGatedRound?: Map<string, { entry: PendingToolCall; decision: PendingDecision }>;
  private activeLoopTurn = 1;
  private readonly loadedSkills = createLoadedSkillSet();
  /** Tools activated via `search_tools` this session (plan 041); names-only in persistence. */
  private readonly activatedTools = createActiveToolSet();
  /** Plan 018 Task 6 (closeout `checkpoint-bodies`): persisted exact instructions, registry-independent. */
  private restoredSkillBodies: readonly LoadedSkillBodiesEntry[] = [];
  /** Skills of the current run (for the bodies snapshot); replaced at each run start. */
  private activeRunSkills: readonly import("../contracts.js").Skill[] = [];

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
    // 0.1.5 breaking cut: the deprecated RunOptions.maxToolRounds alias was removed. Reject
    // untyped/legacy input fail-closed before any session mutation, provider call, or tool
    // execution; silently honoring it would widen or mis-apply the intended tool-round cap.
    const legacyMaxToolRounds = (options as { maxToolRounds?: unknown }).maxToolRounds;
    if (legacyMaxToolRounds !== undefined) {
      throw new TypeError("RunOptions.maxToolRounds was removed in 0.1.5; use RunOptions.limits.maxToolRounds instead");
    }
    const promptVersion = assertPromptVersionRef(options.promptVersion);
    if (
      this.agent.config.secure &&
      (options.redactor !== undefined ||
        options.ownership !== undefined ||
        options.validate !== undefined ||
        options.effectStore !== undefined ||
        options.runState !== undefined)
    ) {
      throw new AgentRunStateError("Secure agent defaults cannot be replaced per run");
    }
    const requestedLimits = options.limits;
    const resolvedLimits = resolveRunLimits(this.agent.config.limits, requestedLimits);
    const durableOptions = options.runState ?? this.agent.config.runState;
    if (this.agent.config.runState && options.runState && this.agent.config.runState !== options.runState) {
      throw new AgentRunStateError("RunOptions cannot replace agent durable run-state configuration");
    }
    if (durableOptions) {
      validateRunStateOptions(durableOptions);
      if (options.model || options.guardrails || options.loop || options.effectStore)
        throw new AgentRunStateError("Durable runs require model, guardrails, loop, and effect store on AgentConfig for fingerprinting");
      const configuredLoop = this.agent.config.loop;
      if (configuredLoop && !isDurableLoop(configuredLoop)) {
        throw new AgentLoopStateError(
          "ERR_PRISM_LOOP_NOT_DURABLE",
          "Custom AgentLoopStrategy on a durable run requires snapshot and restore hooks",
        );
      }
    }
    if (this.activeRun) {
      const error = new Error("Agent session already has an active run");
      this.emit({ type: "error", sessionId: this.id, runId, error: errorToErrorInfo(error) });
      throw error;
    }

    const controller = new AbortController();
    const cleanupSignal = bridgeAbort(options.signal, controller);
    this.activeRun = controller;
    this.activeRunId = runId;
    this.pendingSteers = [];
    this.pendingSteerBytes = 0;
    this.pendingSoftInterrupt = false;
    this.activeRedactor = options.redactor ?? this.agent.config.redactor;
    this.activeLedger = options.runLedger ?? this.agent.config.runLedger;
    this.activeEffectStore = options.effectStore ?? this.agent.config.effectStore;
    this.activeOwnership = options.ownership ?? this.agent.config.ownership;
    this.activeIdentity = resolveRunIdentity(options.identity, this.agent.config.identity, this.activeOwnership);
    if (this.activeIdentity && !this.activeOwnership) this.activeOwnership = ownershipFromIdentity(this.activeIdentity);
    this.activeIdempotencyKey = options.idempotencyKey ?? this.agent.config.idempotencyKey;
    this.activeGuardrails = mergeGuardrails(this.agent.config.guardrails, options.guardrails);
    this.activeDurable = resumed ?? (durableOptions ? { options: durableOptions, version: 0 } : undefined);
    this.activeGatedRound = undefined;
    if (resumed) this.invalidateSnapshot();

    const model = options.model ?? this.agent.config.model;
    const startedAt = new Date().toISOString();
    let runError: ErrorInfo | undefined;
    let runStatus: AgentRunResult["status"] = "succeeded";
    const runUsage = createUsageAccumulator();
    let usage: Usage | undefined;
    const metadata = {
      ...this.agent.config.metadata,
      ...this.metadata,
      ...options.metadata,
      ...(this.activeIdentity ? identityTelemetryAttributes(this.activeIdentity) : {}),
    };
    this.activeMetadata = metadata;
    this.activePromptVersion = promptVersion;
    const limits = new RunLimitTracker(resolvedLimits, {
      onExceeded: (breach) => {
        this.emit({ type: "run_limit_exceeded", sessionId: this.id, runId, breach });
        controller.abort(new RunLimitError(breach));
      },
      snapshot: resumed?.state?.counters,
      deadlineAt: resumed?.state?.deadlineAt,
    });
    this.activeLimits = limits;
    this.activeLimitOutputBuffer = [this.agent.config.limits, requestedLimits].some(
      (value) => value?.maxOutputTokens !== undefined || value?.maxTotalTokens !== undefined || value?.maxCost !== undefined,
    );

    try {
      this.resolveRunProvider(options);
      throwIfAborted(controller.signal);
      this.emit({ type: "agent_started", sessionId: this.id, runId });
      if (resumed) this.emit({ type: "agent_resumed", sessionId: this.id, runId, version: resumed.version });

      const startRecord: RunRecord = {
        id: runId,
        sessionId: this.id,
        branchId: this.currentLeafId,
        model,
        provider: model.provider,
        idempotencyKey: this.activeIdempotencyKey,
        status: "running",
        startedAt,
        ...(promptVersion ? { promptVersion } : {}),
        ...this.activeOwnership,
      };
      await this.activeLedger?.appendRun(redactRunLedgerRecord(startRecord, this.activeRedactor));

      await this.rebuildHistory();
      const { registry: baseRegistry, tools: activeToolList } = activeTools(this.agent.config.tools);
      const toolsDisclosure = resolveToolsDisclosure(options.toolsDisclosure, this.agent.config.toolsDisclosure);
      // Search mode: run-local registry copy plus the generated `search_tools` tool; the host
      // registry is never mutated. Activation names are intersected at disclosure only.
      const toolSearch =
        toolsDisclosure === "search" && activeToolList.length > 0
          ? {
              state: createToolSearchState({
                tools: activeToolList,
                activated: this.activatedTools,
                search: this.agent.config.toolsSearch,
              }),
            }
          : undefined;
      const searchTool = toolSearch ? createSearchToolsTool(toolSearch.state) : undefined;
      const registry = searchTool ? createToolRegistry([...activeToolList, searchTool]) : baseRegistry;
      const tools = searchTool ? [...activeToolList, searchTool] : activeToolList;
      const activeSkills = this.resolveRunSkills(options, tools);
      this.activeRunSkills = activeSkills; // for the durable bodies snapshot (plan 018 Task 6)
      if (options.model && JSON.stringify(options.model) !== JSON.stringify(this.agent.config.model)) {
        await this.appendEntry(
          createSessionEntry({
            sessionId: this.id,
            parentId: this.currentLeafId,
            runId,
            kind: "model_change",
            previousModel: this.agent.config.model,
            model: options.model,
          }),
        );
      }
      const inputMessages = inputToMessages(input).map((message) => this.redact(message));
      const inputGuardrails = await runGuardrails({
        stage: "input",
        guardrails: this.activeGuardrails,
        value: inputMessages,
        context: { sessionId: this.id, runId, metadata, signal: controller.signal },
        redactor: this.activeRedactor,
        emit: (event) => this.emit(event),
      });
      // Input-guardrail decision table:
      // - interrupt + durable + fresh run  → suspend for approval.
      // - interrupt + durable + resumed run → proceed: resuming IS the operator approval.
      // - interrupt without durable, or block/tripwire → fail via assertGuardrailsAllowed.
      const approvedByResume =
        resumed !== undefined && inputGuardrails.terminal?.action === "interrupt" && this.activeDurable !== undefined;
      if (inputGuardrails.terminal?.action === "interrupt" && this.activeDurable && !approvedByResume) {
        const interruption = { kind: "input_guardrail" as const, reason: inputGuardrails.terminal.reason ?? "Input requires approval" };
        throw new AgentRunSuspended(
          await this.suspendDurable({ runId, model, limits, interruption, messages: inputMessages }),
          interruption,
        );
      }
      if (inputGuardrails.terminal && !approvedByResume) assertGuardrailsAllowed(inputGuardrails);
      for (const message of inputMessages) await this.appendMessage(message, runId);
      await this.autoCompact(runId, options, controller.signal, inputMessages);
      const maxToolRounds = resolvedLimits.maxToolRounds;
      const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(this.agent.config.systemPrompt, options.systemPrompt), {
        base: this.agent.config.instructions,
      });
      const contextProviders = [
        ...(this.agent.config.context ?? []),
        // ponytail: skill context after host context; no per-skill token budget yet.
        ...activeSkills.flatMap((skill) => skill.context ?? []),
      ];
      const providerOptions = resolveRunProviderOptions(options, this.agent.config);
      assertStructuredOutputRequestSupported(options.model ?? this.agent.config.model, providerOptions);
      const validate = options.validate ?? this.agent.config.validator;
      // ponytail: RunOptions.instructionInjectors overrides AgentConfig.instructionInjectors (mirrors validate/loop).
      const instructionInjectors = options.instructionInjectors ?? this.agent.config.instructionInjectors ?? [];
      const inputLayout = options.inputLayout ?? this.agent.config.inputLayout;
      const loop = resolveLoop(options, this.agent.config);
      this.activeLoop = loop;
      const toolConcurrency = resolveToolConcurrency(options, this.agent.config);

      this.activeLoopTurn = 1;
      const recordProviderUsage = async (turnUsage: Usage | undefined, turn: number, attempt: number) => {
        limits.recordUsage(turnUsage);
        if (!turnUsage) return;
        runUsage.add(turnUsage);
        if (!this.activeLedger) return;
        const usageRecord: UsageRecord = {
          id: randomId("usage"),
          sessionId: this.id,
          runId,
          scope: "provider_turn",
          turn,
          attempt,
          usage: turnUsage,
          recordedAt: new Date().toISOString(),
          ...this.activeOwnership,
        };
        await this.activeLedger.appendUsage(redactRunLedgerRecord(usageRecord, this.activeRedactor));
      };
      // Suspends the run when a round recorded gated calls. Fires at the next provider turn
      // (generate) or after the loop ends, so ungated round siblings dispatch first.
      const suspendGatedRound = async (): Promise<void> => {
        const gated = this.activeGatedRound;
        if (!gated?.size) return;
        const entries = [...gated.values()];
        const decisions = entries.map((gatedCall) => gatedCall.decision);
        const single = decisions.length === 1 ? decisions[0]! : undefined;
        const interruption: import("../contracts.js").AgentRunInterruption = {
          kind: single?.kind === "elicitation" ? "elicitation" : "tool_approval",
          reason: single ? single.reason : `${decisions.length} tool side effects require approval`,
          ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
          ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
          pendingDecisions: decisions,
        };
        throw new AgentRunSuspended(
          await this.suspendDurable({ runId, model, limits, interruption, pendingCalls: entries.map((gatedCall) => gatedCall.entry) }),
          interruption,
        );
      };
      // Suspends on a nested run's pending decisions, merging any still-ready round entries
      // (with their decisions attached) so a nested signal mid-replay never drops own work.
      const suspendNested = async (nested: {
        entry: NestedRunRef;
        toolCall: ToolCallContent;
        pending: PendingDecision[];
      }): Promise<never> => {
        const state = this.activeDurable?.state;
        const kept = (state?.pendingCalls ?? [])
          .filter((entry) => entry.status === "ready")
          .map((entry) => {
            const decision = entry.decision ?? resumed?.decisions?.get(entry.approvalId);
            return decision ? { ...entry, decision } : entry;
          });
        const gated = [...(this.activeGatedRound?.values() ?? [])];
        const pendingCalls: PendingToolCall[] = [
          ...kept,
          ...gated.map((gatedCall) => gatedCall.entry),
          { call: nested.toolCall, status: "ready", approvalId: `nr_${nested.entry.runId}` },
        ];
        const keptIds = new Set(kept.map((entry) => entry.approvalId));
        const decisions: PendingDecision[] = [
          ...(state?.interruption?.pendingDecisions ?? []).filter((pending) => keptIds.has(pending.approvalId)),
          ...gated.map((gatedCall) => gatedCall.decision),
          ...nested.pending,
        ];
        if (decisions.length > HARD_MAX_PENDING_DECISIONS) {
          throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Pending decisions exceed ${HARD_MAX_PENDING_DECISIONS} per run`);
        }
        const single = decisions.length === 1 ? decisions[0]! : undefined;
        const interruption: import("../contracts.js").AgentRunInterruption = {
          kind: single?.kind ?? "tool_approval",
          reason: single ? single.reason : `${decisions.length} approval request(s) need a decision`,
          ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
          ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
          pendingDecisions: decisions,
        };
        throw new AgentRunSuspended(
          await this.suspendDurable({
            runId,
            model,
            limits,
            interruption,
            pendingCalls,
            nestedRuns: [...(state?.nestedRuns ?? []), nested.entry],
          }),
          interruption,
        );
      };
      // Converts a nested-run suspension into either root-visible pending decisions (hashed,
      // attributed approval ids) or — when a root sticky covers every surfaced decision and a
      // hook is available — an immediate child resume loop ending in a synthesized tool result.
      const applyNestedRun = async (input: {
        ref: AgentRunRef;
        toolCall: ToolCallContent;
        path: readonly string[];
        pending: readonly PendingDecision[];
        hook?: ResumeNestedRun;
      }): Promise<{ toolResult: ToolResult } | { entry: NestedRunRef; pending: PendingDecision[] }> => {
        let current = input.pending;
        // ponytail: sticky auto-apply only when the whole surfaced set is covered; mixed sets
        // surface to the host. Hook round-trips capped at 4 per suspension event.
        for (let depth = 0; ; depth += 1) {
          const attributed = current.map((decision) => {
            const id = nestedApprovalId(input.ref.runId, decision.approvalId);
            return {
              id,
              childApprovalId: decision.approvalId,
              decision: { ...decision, approvalId: id, attribution: decision.attribution ?? { path: input.path } },
            };
          });
          if (attributed.some(({ decision }) => (decision.attribution?.path.length ?? 0) > MAX_ATTRIBUTION_DEPTH)) {
            throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Attribution path exceeds ${MAX_ATTRIBUTION_DEPTH} entries`);
          }
          const allSticky = attributed.length > 0 && attributed.every(({ decision }) => this.matchNestedSticky(decision) !== undefined);
          if (!input.hook || !allSticky || depth >= 4) {
            return {
              entry: {
                runId: input.ref.runId,
                ...(input.ref.sessionId ? { sessionId: input.ref.sessionId } : {}),
                toolCallId: input.toolCall.id,
                path: attributed[0]?.decision.attribution?.path ?? input.path,
                approvals: attributed.map(({ id, childApprovalId }) => ({ id, childApprovalId })),
              },
              pending: attributed.map(({ decision }) => decision),
            };
          }
          const outcome = await input.hook(
            { ref: input.ref, toolCallId: input.toolCall.id, path: input.path },
            attributed.map(({ childApprovalId, decision }) => {
              const sticky = this.matchNestedSticky(decision)!;
              return {
                approvalId: childApprovalId,
                outcome: sticky.outcome,
                ...(sticky.reason !== undefined ? { reason: sticky.reason } : {}),
              };
            }),
          );
          if (outcome.status === "suspended") {
            current = outcome.pendingDecisions;
            continue;
          }
          return { toolResult: nestedOutcomeToolResult(outcome, input.toolCall.id, input.toolCall.name) };
        }
      };
      // ponytail: LoopContext binds existing private helpers; loop orchestrates only.
      let assembledTurn = false;
      let artifactFinished = false;
      let artifactFailedInfo: { message: string; code?: string | number } | undefined;
      const ctx: LoopContext = {
        sessionId: this.id,
        runId,
        metadata,
        signal: controller.signal,
        history: this.history,
        input,
        inputMessages,
        maxToolRounds,
        toolConcurrency,
        restoredLoopState: resumed?.state?.loopState?.snapshot,
        assemble: async (nextInput, toolResults, turn) => {
          limits.charge("maxTurns");
          const request = await assembleProviderInput({
            model: options.model ?? this.agent.config.model,
            input: nextInput,
            history: this.history,
            summaries: (await this.snapshot()).summaries,
            toolResults: toolResults ?? [],
            turn,
            instructionInjectors,
            inputLayout,
            systemInstructions,
            inputBuilder: this.agent.config.inputBuilder,
            promptBuilder: this.agent.config.promptBuilder,
            contextProviders,
            skills: this.restoredSkillBodies.length ? applyRestoredSkillBodies(activeSkills, this.restoredSkillBodies) : activeSkills,
            skillsDisclosure: resolveSkillsDisclosure(options.skillsDisclosure, this.agent.config.skillsDisclosure),
            toolsDisclosure,
            toolsSearch: this.agent.config.toolsSearch,
            activatedTools: this.activatedTools,
            toolResultFold: resolveToolResultFold(options.toolResultFold, this.agent.config.toolResultFold),
            loadedSkills: this.loadedSkills,
            tools,
            resourceLoader: this.agent.config.resourceLoader,
            permission: this.agent.config.permission,
            trust: this.agent.config.trust,
            providerOptions,
            redactor: this.activeRedactor,
            middleware: this.agent.config.middleware,
            sessionId: this.id,
            runId,
            metadata,
            signal: controller.signal,
          });
          assembledTurn = true;
          return request;
        },
        chargeToolRound: (calls) => {
          if (calls.length > 0) limits.charge("maxToolRounds");
          const durable = this.activeDurable;
          if (!durable?.options.interruptBeforeTool || calls.length === 0) return;
          // Round-level gate: record one pending decision per uncovered gated call. Ungated
          // and sticky-allowed calls still dispatch; the suspension fires at the next provider
          // turn (or run end) via suspendGatedRound. Per-call beforeExecute is the backstop
          // for loops that dispatch without charging a round.
          for (const call of calls) {
            if (this.matchStickyDecision(call, registry)) continue;
            const approvalId = randomId("approval");
            this.activeGatedRound ??= new Map();
            this.activeGatedRound.set(call.id, {
              entry: { call, status: "ready", approvalId },
              decision: this.buildPendingDecision(call, approvalId, registry, runId, metadata, controller.signal),
            });
          }
          if (this.activeGatedRound && this.activeGatedRound.size > DEFAULT_MAX_PENDING_DECISIONS) {
            throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Pending decisions exceed ${DEFAULT_MAX_PENDING_DECISIONS} per run`);
          }
        },
        generate: async (request) => {
          await suspendGatedRound();
          if (!assembledTurn) limits.charge("maxTurns");
          assembledTurn = false;
          const policyResult = await this.applyProviderRequestPolicies(request, runId, options, metadata, controller.signal);
          const middlewareRequest =
            (await this.agent.config.middleware?.run("provider_request", policyResult.request)) ?? policyResult.request;
          try {
            return await this.generateWithRetry(
              this.redactProviderRequest(middlewareRequest),
              runId,
              options,
              controller.signal,
              policyResult.secrets,
              this.activeLoopTurn,
              recordProviderUsage,
            );
          } catch (error) {
            if (isSteerSoftInterrupt(error)) {
              return { content: [], calls: [], started: false, usage: undefined };
            }
            throw error;
          }
        },
        isToolCallExclusive: (call) => registry.get(call.name)?.exclusive === true,
        dispatchToolCall: async (call) => {
          const sticky = this.matchStickyDecision(call, registry);
          if (sticky?.outcome === "reject_for_run") {
            return {
              toolCallId: call.id,
              name: call.name,
              error: { code: "approval_rejected", message: sticky.reason ?? "Rejected for this run" },
            };
          }
          if (this.activeGatedRound?.has(call.id)) {
            // Gated this round: never dispatched. The marker is skipped by
            // dispatchToolCallsInOrder so the transcript stays free of phantom results.
            return { toolCallId: call.id, name: call.name, metadata: { approvalPending: true } };
          }
          try {
            return await dispatchToolCall({
              call,
              registry,
              context: {
                sessionId: this.id,
                runId,
                toolCallId: call.id,
                signal: controller.signal,
                metadata: {
                  ...metadata,
                  loadedSkills: this.loadedSkills,
                  activeTools: tools,
                  activeSkillNames: activeSkills.map((skill) => skill.name),
                },
                identity: this.activeIdentity,
              },
              middleware: this.agent.config.middleware,
              emit: (event) => this.emit(event),
              permission: this.agent.config.permission,
              trust: this.agent.config.trust,
              redactor: this.activeRedactor,
              ledger: this.activeLedger,
              effectStore: this.activeEffectStore,
              ownership: this.activeOwnership,
              identity: this.activeIdentity,
              guardrails: this.activeGuardrails,
              limitTracker: limits,
              beforeExecute: async (mediatedCall) => {
                const durable = this.activeDurable;
                if (!durable) return;
                const pendingCalls = durable.state?.pendingCalls;
                const matched = pendingCalls?.find((entry) => entry.call.id === mediatedCall.id && entry.status === "ready");
                if (matched) {
                  await this.persistDurable({
                    ...durable.state!,
                    status: "running",
                    pendingCalls: pendingCalls!.map((entry) => (entry === matched ? { ...entry, status: "dispatched" as const } : entry)),
                    interruption: undefined,
                  });
                  return;
                }
                const pending = durable.state?.pending;
                if (pending?.call.id === mediatedCall.id && pending.status === "ready") {
                  await this.persistDurable({
                    ...durable.state!,
                    status: "running",
                    pending: { ...pending, status: "dispatched" },
                    interruption: undefined,
                  });
                  return;
                }
                if (!durable.options.interruptBeforeTool) return;
                if (this.matchStickyDecision(mediatedCall, registry)?.outcome === "allow_for_run") return;
                // Backstop for loops that dispatch without awaiting chargeToolRound: suspend on
                // the first uncovered gated call with a single pending decision.
                const approvalId = randomId("approval");
                const decision = this.buildPendingDecision(mediatedCall, approvalId, registry, runId, metadata, controller.signal);
                const interruption: import("../contracts.js").AgentRunInterruption = {
                  kind: "tool_approval",
                  reason: decision.reason,
                  toolCallId: mediatedCall.id,
                  toolName: mediatedCall.name,
                  pendingDecisions: [decision],
                };
                throw new AgentRunSuspended(
                  await this.suspendDurable({
                    runId,
                    model,
                    limits,
                    interruption,
                    pending: { call: mediatedCall, status: "ready" },
                    pendingCalls: [{ call: mediatedCall, status: "ready", approvalId }],
                  }),
                  interruption,
                );
              },
              // ponytail: RunOptions wins; array-compose deferred (roadmap: compose-later).
              validate,
            });
          } catch (error) {
            // Link the suspension signal to the hosting call so the root suspension can
            // synthesize this call's tool_result when the nested run later terminates.
            if (error instanceof AgentDelegationSuspendedError && !error.toolCall) error.toolCall = call;
            throw error;
          }
        },
        appendMessage: (message) => this.appendMessage(message, runId),
        hasPendingSteers: () => this.pendingSteers.length > 0,
        applyPendingSteers: () => this.applyPendingSteers(runId, metadata, controller.signal),
        emit: (event) => {
          if (event.type === "turn_started") this.activeLoopTurn = event.turn;
          if (event.type === "artifact_finished") artifactFinished = true;
          if (event.type === "artifact_failed") {
            const first = event.result.errors?.[0];
            const reason = event.result.metadata?.reason;
            artifactFailedInfo = {
              message: first?.message ?? "artifact failed",
              code: typeof reason === "string" || typeof reason === "number" ? reason : "artifact_failed",
            };
          }
          this.emit(event);
        },
      };

      const replayToolResult = async (result: ToolResult) => {
        await ctx.appendMessage({
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: result.toolCallId, name: result.name, result: result.value, error: result.error },
            ...(result.content ?? []),
          ],
          metadata: result.metadata,
        });
      };
      // Handles a nested-run suspension signal: sticky auto-apply appends a synthesized
      // tool_result and returns; anything else re-suspends the root (throws AgentRunSuspended).
      const handleNestedSignal = async (error: AgentDelegationSuspendedError): Promise<void> => {
        const durableOptions = this.activeDurable?.options;
        if (!durableOptions || !error.toolCall) {
          throw new AgentDecisionError(
            "ERR_PRISM_DECISION_INVALID",
            "Nested-run suspension requires durable run state and a hosting tool call",
          );
        }
        if (error.pendingDecisions.length === 0) {
          throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run suspension carried no pending decisions");
        }
        const applied = await applyNestedRun({
          ref: error.ref,
          toolCall: error.toolCall,
          path: error.path ?? [],
          pending: error.pendingDecisions,
          hook: durableOptions.resumeNestedRun,
        });
        if ("toolResult" in applied) {
          await replayToolResult(applied.toolResult);
          return;
        }
        await suspendNested({ entry: applied.entry, toolCall: error.toolCall, pending: applied.pending });
      };
      // Route decided nested-run approvals back to their children before replaying own calls.
      // Undecided or re-suspended children re-suspend the root with the surfaced remainder.
      let resumePendingCalls = resumed?.state?.pendingCalls;
      if (resumed?.state?.nestedRuns?.length) {
        const nestedRuns = resumed.state.nestedRuns;
        const hook = this.activeDurable?.options.resumeNestedRun;
        const oldPending = resumed.state.interruption?.pendingDecisions ?? [];
        const nestedApprovalIds = new Set(nestedRuns.flatMap((entry) => entry.approvals.map((approval) => approval.id)));
        const remainingNested: NestedRunRef[] = [];
        const surfacedPending: PendingDecision[] = [];
        const resolvedToolCallIds = new Set<string>();
        for (const entry of nestedRuns) {
          const grouped: RunDecision[] = [];
          for (const approval of entry.approvals) {
            const decision = entry.decisions?.[approval.id] ?? resumed.decisions?.get(approval.id);
            if (decision) grouped.push({ ...decision, approvalId: approval.childApprovalId });
          }
          if (grouped.length === 0) {
            remainingNested.push(entry);
            surfacedPending.push(...oldPending.filter((pending) => entry.approvals.some((approval) => approval.id === pending.approvalId)));
            continue;
          }
          if (!hook) {
            throw new AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Nested-run decisions require a resumeNestedRun hook");
          }
          const toolCall = resumePendingCalls?.find((pending) => pending.call.id === entry.toolCallId)?.call;
          if (!toolCall) throw new AgentRunStateError("Nested run link is missing its tool call");
          const ref: AgentRunRef = { runId: entry.runId, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}) };
          const outcome = await hook({ ref, toolCallId: entry.toolCallId, path: entry.path }, grouped);
          if (outcome.status !== "suspended") {
            await replayToolResult(nestedOutcomeToolResult(outcome, entry.toolCallId, toolCall.name));
            resolvedToolCallIds.add(entry.toolCallId);
            continue;
          }
          const applied = await applyNestedRun({ ref, toolCall, path: entry.path, pending: outcome.pendingDecisions, hook });
          if ("toolResult" in applied) {
            await replayToolResult(applied.toolResult);
            resolvedToolCallIds.add(entry.toolCallId);
          } else {
            remainingNested.push(applied.entry);
            surfacedPending.push(...applied.pending);
          }
        }
        resumePendingCalls = resumePendingCalls
          ?.filter((entry) => !resolvedToolCallIds.has(entry.call.id))
          .map((entry) => {
            const decision = resumed.decisions?.get(entry.approvalId);
            return decision && !entry.decision ? { ...entry, decision } : entry;
          });
        if (this.activeDurable?.state) {
          this.activeDurable.state = {
            ...this.activeDurable.state,
            pendingCalls: resumePendingCalls?.length ? resumePendingCalls : undefined,
            nestedRuns: remainingNested.length ? remainingNested : undefined,
          };
        }
        const remainingOwn = oldPending.filter(
          (pending) =>
            !nestedApprovalIds.has(pending.approvalId) &&
            !resumed.decisions?.has(pending.approvalId) &&
            !resumePendingCalls?.some((entry) => entry.approvalId === pending.approvalId && entry.decision !== undefined),
        );
        if (remainingOwn.length > 0 || surfacedPending.length > 0) {
          const pendingDecisions = [...remainingOwn, ...surfacedPending];
          const single = pendingDecisions.length === 1 ? pendingDecisions[0]! : undefined;
          const interruption: import("../contracts.js").AgentRunInterruption = {
            kind: single?.kind ?? "tool_approval",
            reason: `${pendingDecisions.length} approval request(s) remain`,
            ...(single?.toolCallId ? { toolCallId: single.toolCallId } : {}),
            ...(single?.scope.toolName ? { toolName: single.scope.toolName } : {}),
            pendingDecisions,
          };
          throw new AgentRunSuspended(
            await this.suspendDurable({
              runId,
              model,
              limits,
              interruption,
              pendingCalls: resumePendingCalls,
              nestedRuns: remainingNested,
            }),
            interruption,
          );
        }
      }
      if (resumePendingCalls?.length) {
        for (const entry of resumePendingCalls) {
          if (entry.status !== "ready") continue;
          const decision = entry.decision ?? resumed?.decisions?.get(entry.approvalId);
          if (decision && (decision.outcome === "reject_once" || decision.outcome === "reject_for_run")) {
            await replayToolResult({
              toolCallId: entry.call.id,
              name: entry.call.name,
              error: { code: "approval_rejected", message: decision.reason ?? "Approval rejected" },
            });
            continue;
          }
          if (decision?.elicitation !== undefined) {
            // Elicitation acceptance resolves the suspended call with the validated payload.
            await replayToolResult({ toolCallId: entry.call.id, name: entry.call.name, value: decision.elicitation });
            continue;
          }
          const call = decision?.modifiedArguments ? { ...entry.call, arguments: decision.modifiedArguments } : entry.call;
          try {
            await replayToolResult(await ctx.dispatchToolCall(call));
          } catch (error) {
            if (!(error instanceof AgentDelegationSuspendedError)) throw error;
            await handleNestedSignal(error);
          }
        }
      } else if (resumed?.state?.pending?.status === "ready") {
        await replayToolResult(await ctx.dispatchToolCall(resumed.state.pending.call));
      }

      const resumedLoopState = resumed?.state?.loopState;
      if (resumedLoopState) {
        if (loop.name !== resumedLoopState.name || (loop.revision ?? "1") !== resumedLoopState.revision) {
          throw new AgentLoopStateError(
            "ERR_PRISM_LOOP_REVISION",
            `Loop ${resumedLoopState.name} revision ${resumedLoopState.revision} does not match the resumed durable run`,
          );
        }
        loop.restore?.(resumedLoopState.snapshot);
      }
      let loopUsage: Usage | undefined;
      while (true) {
        try {
          loopUsage = await loop.run(ctx);
          await suspendGatedRound();
          break;
        } catch (error) {
          if (!(error instanceof AgentDelegationSuspendedError)) throw error;
          await handleNestedSignal(error);
        }
      }
      if (loop.name === "generate-validate-revise" && !artifactFinished) {
        throw Object.assign(new Error(artifactFailedInfo?.message ?? "artifact loop ended without a validated artifact"), {
          name: "ArtifactFailed",
          code: artifactFailedInfo?.code ?? "artifact_failed",
        });
      }
      usage = runUsage.value() ?? loopUsage;
      if (usage && this.activeLedger) {
        const usageRecord: UsageRecord = {
          id: randomId("usage"),
          sessionId: this.id,
          runId,
          scope: "run_total",
          usage,
          recordedAt: new Date().toISOString(),
          ...this.activeOwnership,
        };
        await this.activeLedger.appendUsage(redactRunLedgerRecord(usageRecord, this.activeRedactor));
      }
      await this.drainLedger();
      const runState = this.activeDurable?.state
        ? await this.persistDurable({
            ...this.activeDurable.state,
            status: "succeeded",
            pending: undefined,
            pendingCalls: undefined,
            nestedRuns: undefined,
            stickyDecisions: undefined,
            interruption: undefined,
            loopState: undefined,
          })
        : undefined;
      this.emit({
        type: "agent_finished",
        sessionId: this.id,
        runId,
        usage,
        // F4: loop strategies record why a ceiling ended the run cleanly (e.g. turn_limit).
        ...(ctx.finishReason ? { finishReason: ctx.finishReason } : {}),
      });
      return this.buildRunResult({ runId, status: "succeeded", usage, runState });
    } catch (error) {
      if (error instanceof AgentRunSuspended) {
        runStatus = "suspended";
        const version = error.state.version!;
        this.emit({ type: "agent_suspended", sessionId: this.id, runId, interruption: error.interruption, version });
        return this.buildRunResult({ runId, status: "suspended", runState: error.state, interruption: error.interruption });
      }
      runError = errorToErrorInfo(error);
      this.emit({ type: "error", sessionId: this.id, runId, error: runError });
      const breach = error instanceof RunLimitError ? error.breach : limits.breach;
      runStatus = breach ? "failed" : controller.signal.aborted ? "aborted" : "failed";
      const runState = this.activeDurable?.state
        ? await this.persistDurable({
            ...this.activeDurable.state,
            status: runStatus,
            interruption: undefined,
            loopState: undefined,
            pendingCalls: undefined,
            nestedRuns: undefined,
            stickyDecisions: undefined,
          })
        : undefined;
      const result = this.buildRunResult({
        runId,
        status: runStatus,
        usage: runUsage.value() ?? usage,
        limit: breach,
        error: runError,
        abortReason: !breach && controller.signal.aborted ? String(controller.signal.reason) : undefined,
        runState,
      });
      throw new AgentRunError(result, { cause: error });
    } finally {
      if (this.activeRun === controller) this.activeRun = undefined;
      this.activeRunId = undefined;
      this.activeLoop = undefined;
      this.activeGatedRound = undefined;
      this.activeProviderTurnAbort = undefined;
      this.pendingSoftInterrupt = false;
      this.pendingSteers = [];
      this.pendingSteerBytes = 0;
      try {
        await this.drainLedger();
        if (this.activeLedger) {
          const status = runStatus;
          const finishRecord: RunRecord = {
            id: runId,
            sessionId: this.id,
            branchId: this.currentLeafId,
            model,
            provider: model.provider,
            idempotencyKey: this.activeIdempotencyKey,
            status,
            startedAt,
            finishedAt: new Date().toISOString(),
            abortReason: controller.signal.aborted ? String(controller.signal.reason) : undefined,
            error: runError,
            ...(this.activePromptVersion ? { promptVersion: this.activePromptVersion } : {}),
            ...this.activeOwnership,
          };
          await this.activeLedger.appendRun(redactRunLedgerRecord(finishRecord, this.activeRedactor));
          if (isFlushableRunLedger(this.activeLedger) && this.activeLedger.durability === "flush_on_terminal")
            await this.activeLedger.flush();
        }
      } finally {
        this.activeLedger = undefined;
        this.activeEffectStore = undefined;
        this.activeOwnership = undefined;
        this.activeIdentity = undefined;
        this.activeIdempotencyKey = undefined;
        this.activeGuardrails = undefined;
        this.activeMetadata = undefined;
        this.activePromptVersion = undefined;
        this.activeLimits?.dispose();
        this.activeLimits = undefined;
        this.activeLimitOutputBuffer = false;
        this.activeRedactor = undefined;
        this.activeProvider = undefined;
        cleanupSignal();
        this.closeSubscribers();
      }
    }
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

  private buildRunResult(input: {
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

  private async suspendDurable(input: {
    readonly runId: string;
    readonly model: import("../contracts.js").ModelConfig;
    readonly limits: RunLimitTracker;
    readonly interruption: import("../contracts.js").AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
    readonly pendingCalls?: readonly PendingToolCall[];
    /** Full replacement when provided; otherwise the recorded nested runs are preserved. */
    readonly nestedRuns?: readonly NestedRunRef[];
  }): Promise<AgentRunState> {
    const durable = this.activeDurable;
    if (!durable) throw new AgentRunStateError("Durable interruption is not configured");
    // Capture loop-local state before persisting the suspension. Undefined before the loop
    // starts (input-guardrail suspensions) and for snapshot-less built-ins.
    const loop = this.activeLoop;
    const loopState = loop?.snapshot ? boundedLoopSnapshot(loop.name, loop.revision ?? "1", loop.snapshot()) : undefined;
    const state =
      durable.state ??
      initialAgentRunState({
        agent: this.agent,
        options: durable.options,
        runId: input.runId,
        sessionId: this.id,
        leafId: this.currentLeafId,
        model: input.model,
        counters: input.limits.snapshot(),
        deadlineAt: input.limits.deadlineAt,
        status: "suspended",
        interruption: input.interruption,
        messages: input.messages,
        pending: input.pending,
        pendingCalls: input.pendingCalls,
        interruptBeforeTool: durable.options.interruptBeforeTool,
      });
    return this.persistDurable({
      ...state,
      leafId: this.currentLeafId,
      status: "suspended",
      interruption: input.interruption,
      ...(input.messages ? { input: input.messages } : {}),
      ...(input.pending ? { pending: input.pending } : {}),
      ...(input.pendingCalls ? { pendingCalls: input.pendingCalls } : {}),
      nestedRuns: input.nestedRuns ?? state.nestedRuns,
      ...(loopState ? { loopState } : {}),
      counters: input.limits.snapshot(),
    });
  }

  /** First attributed sticky whose scope and delegation path exactly match a nested decision. */
  private matchNestedSticky(decision: PendingDecision): StickyDecision | undefined {
    const stickies = this.activeDurable?.state?.stickyDecisions;
    return stickies?.find(
      (sticky) =>
        sticky.attribution !== undefined &&
        pathsEqual(sticky.attribution.path, decision.attribution?.path) &&
        decisionScopesEqual(sticky.scope, decision.scope),
    );
  }

  /** First sticky decision whose scope exactly matches this call, if any. */
  private matchStickyDecision(call: ToolCallContent, registry: ToolRegistry): StickyDecision | undefined {
    const stickies = this.activeDurable?.state?.stickyDecisions;
    if (!stickies?.length) return undefined;
    const identityRef = decisionIdentityRef(this.activeIdentity);
    let argumentsHash: string | undefined;
    let effectKind: import("../contracts.js").ToolEffectKind | undefined;
    let effectResolved = false;
    return stickies.find((sticky) => {
      if (sticky.attribution !== undefined) return false; // nested-run stickies match decisions, not calls
      const scope = sticky.scope;
      if (scope.toolName !== undefined && scope.toolName !== call.name) return false;
      if (scope.identity !== undefined && scope.identity !== identityRef) return false;
      if (scope.argumentsHash !== undefined) {
        argumentsHash ??= toolEffectArgumentsHash(call.arguments);
        if (scope.argumentsHash !== argumentsHash) return false;
      }
      if (scope.effectKind !== undefined) {
        if (!effectResolved) {
          effectResolved = true;
          const tool = registry.get(call.name);
          effectKind = tool?.effect
            ? resolveToolEffectDeclaration(tool, call.arguments, { sessionId: this.id, runId: "", toolCallId: call.id })?.kind
            : undefined;
        }
        if (scope.effectKind !== effectKind) return false;
      }
      if (scope.actionConstraints) {
        for (const [key, value] of Object.entries(scope.actionConstraints)) {
          const actual = (call.arguments as Record<string, unknown>)[key];
          if (canonicalToolEffectJson(actual === undefined ? null : actual) !== canonicalToolEffectJson(value)) return false;
        }
      }
      return true;
    });
  }

  /** Redacted pending-decision descriptor for one gated call; never carries raw arguments. */
  private buildPendingDecision(
    call: ToolCallContent,
    approvalId: string,
    registry: ToolRegistry,
    runId: string,
    metadata: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): PendingDecision {
    const tool = registry.get(call.name);
    const declaration = tool?.effect
      ? resolveToolEffectDeclaration(tool, call.arguments, {
          sessionId: this.id,
          runId,
          toolCallId: call.id,
          signal,
          metadata,
        })
      : undefined;
    const identityRef = decisionIdentityRef(this.activeIdentity);
    const elicitation = toolElicitationRequest(tool, call.arguments, {
      sessionId: this.id,
      runId,
      toolCallId: call.id,
      signal,
      metadata,
    });
    return {
      approvalId,
      kind: elicitation ? "elicitation" : "tool_approval",
      toolCallId: call.id,
      scope: {
        toolName: call.name,
        argumentsHash: toolEffectArgumentsHash(call.arguments),
        ...(declaration && declaration.kind !== "none" ? { effectKind: declaration.kind } : {}),
        ...(identityRef ? { identity: identityRef } : {}),
      },
      reason: elicitation?.reason ?? "Tool side effect requires approval",
      ...(elicitation ? { elicitationSchema: elicitation.schema } : {}),
    };
  }

  private async persistDurable(state: StoredAgentRunState): Promise<AgentRunState> {
    const durable = this.activeDurable;
    if (!durable) throw new AgentRunStateError("Durable run state is not configured");
    const persisted = durable.options.persistSessionState
      ? {
          ...state,
          sessionState: {
            loadedSkillNames: this.loadedSkills.list(),
            ...(this.activatedTools.list().length ? { activatedToolNames: this.activatedTools.list() } : {}),
            ...(durable.options.includeSkillBodies
              ? {
                  loadedSkillBodies: snapshotLoadedSkillBodies(
                    this.activeRunSkills,
                    this.loadedSkills,
                    this.restoredSkillBodies.length ? new Map(this.restoredSkillBodies.map((e) => [e.name, e.instructions])) : undefined,
                  ),
                }
              : {}),
          },
        }
      : state;
    const saved = await saveAgentRunState({
      checkpoints: durable.options.checkpoints,
      state: persisted,
      expectedVersion: durable.version,
      ownership: this.activeOwnership,
      fencingToken: durable.options.fencingToken,
      redactor: this.activeRedactor,
      maxStateBytes: durable.options.maxStateBytes,
    });
    durable.state = saved.state;
    durable.version = saved.record.version;
    return publicState(saved.state);
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

  private resolveRunProvider(options: RunOptions): void {
    const model = options.model ?? this.agent.config.model;
    // Provider precedence: an explicit `AgentConfig.provider` wins and bypasses
    // the resolver entirely; otherwise `RunOptions.providerSource` overrides
    // `AgentConfig.providerSource` for this run. A miss on every source fails
    // closed with `Unknown provider: ${model.provider}` before any provider turn.
    const provider = this.agent.config.provider ?? options.providerSource?.(model) ?? this.agent.config.providerSource?.(model);
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    this.activeProvider = provider;
  }

  private resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[] {
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

  private emit(event: AgentEvent): void {
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

  private closeSubscribers(): void {
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }

  private async drainLedger(): Promise<void> {
    await this.ledgerChain;
    const failure = this.ledgerFailure;
    this.ledgerChain = Promise.resolve();
    this.ledgerFailure = undefined;
    if (failure) throw failure;
  }

  private async generateWithRetry(
    request: ProviderRequest,
    runId: string,
    options: RunOptions,
    signal: AbortSignal,
    requestSecrets: readonly (string | undefined)[] = [],
    turn = 1,
    recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<void>,
  ): Promise<ProviderTurnResult> {
    const retry = mergeRetry(this.agent.config.retry, options.retry);
    const secrets = [...requestSecrets, ...(retry?.secrets ?? [])];
    const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.generateProviderTurn(request, runId, signal, secrets, turn, attempt, recordUsage);
      } catch (error) {
        if (error instanceof GuardrailError || isSteerSoftInterrupt(error)) throw error;
        const failure = error instanceof ProviderTurnFailure ? error : undefined;
        const info = failure ? redactSecrets(failure.info, secrets) : errorToErrorInfo(error, secrets);
        if (!policy || failure?.observable) throw errorFromInfo(info);
        const context = { sessionId: this.id, runId, attempt, error: info, metadata: retry?.metadata, signal };
        let decision = await policy.decide(context);
        const payload: RetryMiddlewarePayload = (await this.agent.config.middleware?.run("retry", { context, decision })) ?? {
          context,
          decision,
        };
        decision = payload.decision;
        if (!decision.retry) throw errorFromInfo(info);
        const delayMs = decision.delayMs ?? 0;
        this.emit({ type: "retry_scheduled", sessionId: this.id, runId, attempt, delayMs, error: info });
        await waitForRetry(decision, signal);
      }
    }
  }

  private async generateProviderTurn(
    request: ProviderRequest,
    runId: string,
    signal: AbortSignal,
    secrets: readonly (string | undefined)[] = [],
    turn = 1,
    attempt = 1,
    recordUsage?: (usage: Usage | undefined, turn: number, attempt: number) => Promise<void>,
  ): Promise<ProviderTurnResult> {
    this.activeLimits!.charge("maxProviderAttempts");
    this.activeLimits!.charge("maxRequestBytes", jsonBytes(request));
    const startedAt = performance.now();
    const providerId = this.activeProvider?.id ?? request.model.provider;
    const buildMetadata = (extra: Omit<ProviderTurnMetadata, "providerId" | "model"> = {}) =>
      createProviderTurnMetadata(request, providerId, { attempt, ...extra });
    this.emit({
      type: "provider_turn_started",
      sessionId: this.id,
      runId,
      turn,
      metadata: buildMetadata(),
    });
    const content: ContentBlock[] = [];
    const calls: ToolCallContent[] = [];
    const toolDeltas: ProviderEvent[] = [];
    let messageId: string | undefined;
    let started = false;
    let usage: Usage | undefined;
    let usageRecorded = false;
    const bufferedOutput: AgentEvent[] = [];
    const bufferOutput = Boolean(this.activeGuardrails?.output?.length || this.activeLimitOutputBuffer);
    const emitOutput = (event: AgentEvent) => {
      if (bufferOutput) bufferedOutput.push(event);
      else this.emit(event);
    };
    const recordTurnUsage = async () => {
      if (usageRecorded) return;
      usageRecorded = true;
      await recordUsage?.(usage, turn, attempt);
    };
    const turnAbort = new AbortController();
    const cleanupTurn = bridgeAbort(signal, turnAbort);
    this.activeProviderTurnAbort = turnAbort;
    if (this.pendingSoftInterrupt) {
      this.pendingSoftInterrupt = false;
      turnAbort.abort(new SteerSoftInterrupt());
    }
    const turnRequest = { ...request, signal: turnAbort.signal };
    try {
      throwIfAborted(turnAbort.signal);
      for await (const event of this.activeProvider!.generate(turnRequest)) {
        throwIfAborted(turnAbort.signal);
        this.activeLimits!.charge("maxResponseBytes", jsonBytes(event));
        if (event.type === "error") throw new ProviderTurnFailure(event.error, started);
        if (event.type === "usage") usage = event.usage;
        if (event.type === "done") {
          usage = event.usage ?? usage;
          break;
        }
        if (event.type === "message_start") {
          started = true;
          messageId = event.messageId;
          emitOutput({ type: "message_started", sessionId: this.id, runId, message: { id: messageId, role: "assistant", content: [] } });
          continue;
        }
        if (event.type === "content_delta" || event.type === "tool_call" || event.type === "tool_call_delta") {
          if (!started) {
            started = true;
            emitOutput({ type: "message_started", sessionId: this.id, runId, message: { role: "assistant", content: [] } });
          }
          if (event.type === "tool_call_delta") {
            toolDeltas.push(event);
            emitOutput({ type: "message_delta", sessionId: this.id, runId, content: providerToolCallDeltaContent(event) });
            continue;
          }
          const block = providerContent(event);
          content.push(block);
          if (block.type === "tool_call") calls.push(block);
          emitOutput({ type: "message_delta", sessionId: this.id, runId, content: block });
        }
      }
      for (const call of reconstructMissingToolCalls(toolDeltas, calls)) {
        content.push(call);
        calls.push(call);
        emitOutput({ type: "message_delta", sessionId: this.id, runId, content: call });
      }
      await recordTurnUsage();
      if (this.activeGuardrails?.output?.length) {
        assertGuardrailsAllowed(
          await runGuardrails({
            stage: "output",
            guardrails: this.activeGuardrails,
            value: { content, calls, messageId, started, usage },
            context: { sessionId: this.id, runId, metadata: this.activeMetadata ?? {}, signal: turnAbort.signal },
            redactor: this.activeRedactor,
            emit: (event) => this.emit(event),
          }),
        );
      }
      if (bufferOutput) for (const event of bufferedOutput) this.emit(event);
      const latencyMs = Math.round(performance.now() - startedAt);
      this.emit({
        type: "provider_turn_finished",
        sessionId: this.id,
        runId,
        turn,
        metadata: buildMetadata({ latencyMs }),
        usage,
      });
      return { content, calls, messageId, started, usage };
    } catch (error) {
      if (isSteerSoftInterrupt(error) || isSteerSoftInterrupt(turnAbort.signal.reason)) {
        await recordTurnUsage();
        const latencyMs = Math.round(performance.now() - startedAt);
        this.emit({
          type: "provider_turn_finished",
          sessionId: this.id,
          runId,
          turn,
          metadata: buildMetadata({ latencyMs }),
          usage,
        });
        throw new SteerSoftInterrupt();
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      const info = error instanceof ProviderTurnFailure ? redactSecrets(error.info, secrets) : errorToErrorInfo(error, secrets);
      await recordTurnUsage();
      this.emit({
        type: "provider_turn_finished",
        sessionId: this.id,
        runId,
        turn,
        metadata: buildMetadata({ latencyMs, httpStatus: readProviderHttpStatus(info) }),
        usage,
        error: info,
      });
      if (error instanceof GuardrailError || error instanceof ProviderTurnFailure) throw error;
      throw new ProviderTurnFailure(info, started);
    } finally {
      cleanupTurn();
      if (this.activeProviderTurnAbort === turnAbort) this.activeProviderTurnAbort = undefined;
    }
  }

  private async applyPendingSteers(runId: string, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<boolean> {
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

  private async applyProviderRequestPolicies(
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

  private async appendMessage(message: Message, runId: string): Promise<void> {
    await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "message", message }));
  }

  private async autoCompact(runId: string, options: RunOptions, signal: AbortSignal, inputMessages: readonly Message[]): Promise<void> {
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

  private async appendEntry(entry: SessionEntry): Promise<void> {
    const redacted = redactSessionEntry(entry, this.activeRedactor);
    await this.store.append(redacted, {
      expectedParentId: this.currentLeafId,
      idempotencyKey: this.activeIdempotencyKey,
    });
    this.currentLeafId = redacted.id;
    this.invalidateSnapshot();
  }

  private invalidateSnapshot(): void {
    this.snapshotGeneration += 1;
    this.snapshotCache = undefined;
  }

  private redact<T>(value: T): T {
    return this.activeRedactor?.redact(value) ?? value;
  }

  private redactProviderRequest(request: ProviderRequest): ProviderRequest {
    return redactProviderRequest(request, this.activeRedactor);
  }

  private async rebuildHistory(): Promise<void> {
    this.history = (await this.snapshot()).messages.slice();
  }

  private async snapshot(): Promise<SessionContextSnapshot> {
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
