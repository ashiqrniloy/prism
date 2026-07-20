import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentEventRecord,
  AgentRunResult,
  AgentRunResume,
  AgentRunResumeOptions,
  AgentRunState,
  AgentRunStateOptions,
  AgentRunRef,
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
  OwnershipScope,
  ProviderEvent,
  ProviderRequest,
  ProviderRequestPolicy,
  ProviderResolver,
  ProviderTurnMetadata,
  ProviderTurnResult,
  RetryMiddlewarePayload,
  RetryOptions,
  RunLedger,
  RunOptions,
  RunRecord,
  SessionEntry,
  SessionStore,
  SessionBranchRead,
  Skill,
  SubscribeOptions,
  TextContent,
  ToolCallContent,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
  Usage,
  UsageRecord,
} from "./contracts.js";
import { AgentRunError, AgentRunStateError } from "./contracts.js";
import { resolveLoop, resolveToolConcurrency } from "./agent-loops.js";
import { createId } from "./ids.js";
import { assertGuardrailsAllowed, GuardrailError, runGuardrails } from "./guardrails.js";
import { createProviderTurnMetadata, readProviderHttpStatus } from "./observability.js";
import { createDefaultCompactionStrategy, isCompactionEntryData } from "./compaction.js";
import { assembleProviderInput, type AgentInput } from "./input.js";
import { providerToolCallDeltaContent, reconstructToolCallDeltas } from "./provider-events.js";
import { createProviderRequestPolicyChain, mergeProviderRequestOptions, normalizeProviderRequestPolicyResult } from "./provider-request-policy.js";
import { assertStructuredOutputRequestSupported, resolveRunProviderOptions } from "./structured-output.js";
import { errorToErrorInfo, redactAgentEvent, redactProviderRequest, redactRunLedgerRecord, redactSecrets, redactSessionEntry, type SecretRedactor } from "./redaction.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "./system-prompts.js";
import { createDefaultRetryPolicy, waitForRetry } from "./retry.js";
import { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, rebuildSessionContext, type SessionContextSnapshot } from "./session-stores.js";
import { isFlushableRunLedger } from "./run-ledger.js";
import { createToolRegistry, dispatchToolCall } from "./tools.js";
import { RunLimitError, RunLimitTracker, resolveRunLimits } from "./run-limits.js";
import { agentFingerprint, initialAgentRunState, loadAgentRunState, publicState, saveAgentRunState, validateRunStateOptions, type StoredAgentRunState } from "./agent-run-state.js";
import { resolveActiveSkills } from "./skills.js";

export function createAgent(config: AgentConfig): Agent {
  return {
    config,
    createSession(sessionConfig = {}) {
      return createAgentSession({ ...sessionConfig, agent: this });
    },
  };
}

export function createAgentSession(config: AgentSessionConfig & { readonly agent: Agent }): AgentSession {
  return new RuntimeAgentSession(config);
}

/** Resume a persisted built-in run. A claimed/dispatched tool is never replayed automatically. */
export async function resumeAgentRun(
  agent: Agent,
  ref: AgentRunRef,
  resume: AgentRunResume,
  options: AgentRunResumeOptions,
): Promise<AgentRunResult> {
  const { record, state } = await loadAgentRunState(options.checkpoints, ref, options.ownership);
  if (state.definitionRevision !== options.definitionRevision || state.agentId !== (agent.config.id ?? agent.config.name) || state.fingerprint !== agentFingerprint(agent, options.definitionRevision)) {
    throw new AgentRunStateError("Agent definition revision or fingerprint mismatch on resume");
  }
  if (record.version !== resume.expectedVersion || state.status !== "suspended") {
    throw new AgentRunStateError("Stale or non-suspended agent run resume");
  }
  if (resume.decision === "deny") {
    const denied = await saveAgentRunState({
      checkpoints: options.checkpoints,
      state: { ...state, status: "denied" },
      expectedVersion: record.version,
      ownership: options.ownership,
      fencingToken: options.fencingToken,
    });
    const session = new RuntimeAgentSession({ agent, id: state.sessionId, leafId: state.leafId });
    await session.recordDurableDenial(state.runId, state.interruption!, denied.record.version, options.ownership);
    const runState = publicState(denied.state);
    return { sessionId: state.sessionId, runId: state.runId, status: "denied", leafId: state.leafId, text: "", content: [], runState, interruption: state.interruption };
  }
  if (state.pending?.status === "dispatched") throw new AgentRunStateError("Ambiguous dispatched tool requires operator resolution");
  const configured = agent.config.runState;
  if (configured && (configured.checkpoints !== options.checkpoints || configured.definitionRevision !== options.definitionRevision)) {
    throw new AgentRunStateError("Agent durable run-state configuration mismatch on resume");
  }
  const claimed = await saveAgentRunState({
    checkpoints: options.checkpoints,
    state: { ...state, status: "running", interruption: undefined },
    expectedVersion: record.version,
    ownership: options.ownership,
    fencingToken: options.fencingToken,
  });
  const session = new RuntimeAgentSession({ agent, id: state.sessionId, leafId: state.leafId });
  return session.resumeDurable(claimed.state, configured ?? {
    checkpoints: options.checkpoints,
    definitionRevision: options.definitionRevision,
    interruptBeforeTool: state.interruptBeforeTool,
    fencingToken: options.fencingToken,
  }, options.ownership);
}

class AgentRunSuspended extends Error {
  readonly code = "ERR_PRISM_AGENT_RUN_SUSPENDED";
  constructor(readonly state: AgentRunState, readonly interruption: import("./contracts.js").AgentRunInterruption) {
    super("Agent run suspended");
    this.name = "AgentRunSuspended";
  }
}

interface ActiveDurableRun {
  readonly options: AgentRunStateOptions;
  state?: StoredAgentRunState;
  version: number;
}

class RuntimeAgentSession implements AgentSession {
  readonly id: string;
  private readonly agent: Agent;
  private readonly metadata?: Readonly<Record<string, unknown>>;
  private readonly store: SessionStore;
  private readonly subscribers = new Set<EventSubscriber>();
  private currentLeafId?: string;
  private history: Message[] = [];
  private activeRun?: AbortController;
  private activeRedactor?: SecretRedactor;
  private activeProvider?: AIProvider;
  private activeLedger?: RunLedger;
  private activeOwnership?: OwnershipScope;
  private activeIdempotencyKey?: string;
  private activeGuardrails?: Guardrails;
  private activeMetadata?: Readonly<Record<string, unknown>>;
  private activeLimits?: RunLimitTracker;
  private activeLimitOutputBuffer = false;
  private activeDurable?: ActiveDurableRun;
  private activeLoopTurn = 1;
  private ledgerChain: Promise<void> = Promise.resolve();
  private ledgerFailure: unknown;
  private snapshotGeneration = 0;
  private snapshotCache?: { readonly leafId?: string; readonly generation: number; readonly expiresAt: number; readonly value: SessionContextSnapshot };

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

  async resumeDurable(state: StoredAgentRunState, runState: AgentRunStateOptions, ownership?: OwnershipScope): Promise<AgentRunResult> {
    return this.runInternal(state.input ?? [], { runState, ownership }, state.runId, { options: runState, state, version: state.version! });
  }

  async recordDurableDenial(
    runId: string,
    interruption: import("./contracts.js").AgentRunInterruption,
    version: number,
    ownership?: OwnershipScope,
  ): Promise<void> {
    this.activeLedger = this.agent.config.runLedger;
    this.activeOwnership = ownership ?? this.agent.config.ownership;
    this.activeRedactor = this.agent.config.redactor;
    this.emit({ type: "agent_denied", sessionId: this.id, runId, interruption, version });
    await this.drainLedger();
    this.activeLedger = undefined;
    this.activeOwnership = undefined;
    this.activeRedactor = undefined;
  }

  private async runInternal(
    input: AgentInput,
    options: RunOptions,
    runId: string,
    resumed?: ActiveDurableRun,
  ): Promise<AgentRunResult> {
    if (this.agent.config.secure && (options.redactor !== undefined || options.ownership !== undefined || options.validate !== undefined || options.runState !== undefined)) {
      throw new AgentRunStateError("Secure agent defaults cannot be replaced per run");
    }
    const requestedLimits = options.maxToolRounds === undefined
      ? options.limits
      : { ...options.limits, maxToolRounds: Math.min(options.maxToolRounds, options.limits?.maxToolRounds ?? options.maxToolRounds) };
    const resolvedLimits = resolveRunLimits(this.agent.config.limits, requestedLimits);
    const durableOptions = options.runState ?? this.agent.config.runState;
    if (this.agent.config.runState && options.runState && this.agent.config.runState !== options.runState) {
      throw new AgentRunStateError("RunOptions cannot replace agent durable run-state configuration");
    }
    if (durableOptions) {
      validateRunStateOptions(durableOptions);
      if (options.model || options.guardrails || options.loop) throw new AgentRunStateError("Durable runs require model, guardrails, and loop on AgentConfig for fingerprinting");
      const configuredLoop = this.agent.config.loop;
      if (configuredLoop && !isBuiltInLoop(configuredLoop)) throw new AgentRunStateError("Custom AgentLoopStrategy is not durable");
    }
    if (this.activeRun) {
      const error = new Error("Agent session already has an active run");
      this.emit({ type: "error", sessionId: this.id, runId, error: errorToErrorInfo(error) });
      throw error;
    }

    const controller = new AbortController();
    const cleanupSignal = bridgeAbort(options.signal, controller);
    this.activeRun = controller;
    this.activeRedactor = options.redactor ?? this.agent.config.redactor;
    this.activeLedger = options.runLedger ?? this.agent.config.runLedger;
    this.activeOwnership = options.ownership ?? this.agent.config.ownership;
    this.activeIdempotencyKey = options.idempotencyKey ?? this.agent.config.idempotencyKey;
    this.activeGuardrails = mergeGuardrails(this.agent.config.guardrails, options.guardrails);
    this.activeDurable = resumed ?? (durableOptions ? { options: durableOptions, version: 0 } : undefined);
    if (resumed) this.invalidateSnapshot();

    const model = options.model ?? this.agent.config.model;
    const startedAt = new Date().toISOString();
    let runError: ErrorInfo | undefined;
    let runStatus: AgentRunResult["status"] = "succeeded";
    const runUsage = createUsageAccumulator();
    let usage: Usage | undefined;
    const metadata = { ...this.agent.config.metadata, ...this.metadata, ...options.metadata };
    this.activeMetadata = metadata;
    const limits = new RunLimitTracker(resolvedLimits, {
      onExceeded: (breach) => {
        this.emit({ type: "run_limit_exceeded", sessionId: this.id, runId, breach });
        controller.abort(new RunLimitError(breach));
      },
      snapshot: resumed?.state?.counters,
      deadlineAt: resumed?.state?.deadlineAt,
    });
    this.activeLimits = limits;
    this.activeLimitOutputBuffer = [this.agent.config.limits, requestedLimits].some((value) =>
      value?.maxOutputTokens !== undefined || value?.maxTotalTokens !== undefined || value?.maxCost !== undefined,
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
        ...this.activeOwnership,
      };
      await this.activeLedger?.appendRun(redactRunLedgerRecord(startRecord, this.activeRedactor));

      await this.rebuildHistory();
      const { registry, tools } = activeTools(this.agent.config.tools);
      const activeSkills = this.resolveRunSkills(options, tools);
      if (options.model && JSON.stringify(options.model) !== JSON.stringify(this.agent.config.model)) {
        await this.appendEntry(createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "model_change", previousModel: this.agent.config.model, model: options.model }));
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
      if (inputGuardrails.terminal?.action === "interrupt" && this.activeDurable) {
        if (!resumed) {
          const interruption = { kind: "input_guardrail" as const, reason: inputGuardrails.terminal.reason ?? "Input requires approval" };
          throw new AgentRunSuspended(await this.suspendDurable({ runId, model, limits, interruption, messages: inputMessages }), interruption);
        }
      } else {
        assertGuardrailsAllowed(inputGuardrails);
      }
      for (const message of inputMessages) await this.appendMessage(message, runId);
      await this.autoCompact(runId, options, controller.signal, inputMessages);
      const maxToolRounds = resolvedLimits.maxToolRounds;
      const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(this.agent.config.systemPrompt, options.systemPrompt), { base: this.agent.config.instructions });
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
      // ponytail: LoopContext binds existing private helpers; loop orchestrates only.
      let assembledTurn = false;
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
          skills: activeSkills,
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
        },
        generate: async (request) => {
          if (!assembledTurn) limits.charge("maxTurns");
          assembledTurn = false;
          const policyResult = await this.applyProviderRequestPolicies(request, runId, options, metadata, controller.signal);
          const middlewareRequest = await this.agent.config.middleware?.run("provider_request", policyResult.request) ?? policyResult.request;
          return this.generateWithRetry(
            this.redactProviderRequest(middlewareRequest),
            runId,
            options,
            controller.signal,
            policyResult.secrets,
            this.activeLoopTurn,
            recordProviderUsage,
          );
        },
        isToolCallExclusive: (call) => registry.get(call.name)?.exclusive === true,
        dispatchToolCall: (call) => dispatchToolCall({
          call,
          registry,
          context: { sessionId: this.id, runId, toolCallId: call.id, signal: controller.signal, metadata },
          middleware: this.agent.config.middleware,
          emit: (event) => this.emit(event),
          permission: this.agent.config.permission,
          trust: this.agent.config.trust,
          redactor: this.activeRedactor,
          ledger: this.activeLedger,
          ownership: this.activeOwnership,
          guardrails: this.activeGuardrails,
          limitTracker: limits,
          beforeExecute: async (mediatedCall) => {
            const durable = this.activeDurable;
            if (!durable) return;
            const pending = durable.state?.pending;
            if (pending?.call.id === mediatedCall.id && pending.status === "ready") {
              await this.persistDurable({ ...durable.state!, status: "running", pending: { ...pending, status: "dispatched" }, interruption: undefined });
              return;
            }
            if (!durable.options.interruptBeforeTool) return;
            const interruption = { kind: "tool_approval" as const, reason: "Tool side effect requires approval", toolCallId: mediatedCall.id, toolName: mediatedCall.name };
            throw new AgentRunSuspended(await this.suspendDurable({
              runId,
              model,
              limits,
              interruption,
              pending: { call: mediatedCall, status: "ready" },
            }), interruption);
          },
          // ponytail: RunOptions wins; array-compose deferred (roadmap: compose-later).
          validate,
        }),
        appendMessage: (message) => this.appendMessage(message, runId),
        emit: (event) => {
          if (event.type === "turn_started") this.activeLoopTurn = event.turn;
          this.emit(event);
        },
      };

      if (resumed?.state?.pending?.status === "ready") {
        const result = await ctx.dispatchToolCall(resumed.state.pending.call);
        await ctx.appendMessage({
          role: "tool",
          content: [{ type: "tool_result", toolCallId: result.toolCallId, name: result.name, result: result.value, error: result.error }, ...(result.content ?? [])],
          metadata: result.metadata,
        });
      }
      const loopUsage = await loop.run(ctx);
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
        ? await this.persistDurable({ ...this.activeDurable.state, status: "succeeded", pending: undefined, interruption: undefined })
        : undefined;
      this.emit({ type: "agent_finished", sessionId: this.id, runId, usage });
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
        ? await this.persistDurable({ ...this.activeDurable.state, status: runStatus, interruption: undefined })
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
            ...this.activeOwnership,
          };
          await this.activeLedger.appendRun(redactRunLedgerRecord(finishRecord, this.activeRedactor));
          if (isFlushableRunLedger(this.activeLedger) && this.activeLedger.durability === "flush_on_terminal") await this.activeLedger.flush();
        }
      } finally {
        this.activeLedger = undefined;
        this.activeOwnership = undefined;
        this.activeIdempotencyKey = undefined;
        this.activeGuardrails = undefined;
        this.activeMetadata = undefined;
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
    readonly limit?: import("./contracts.js").RunLimitBreach;
    readonly error?: ErrorInfo;
    readonly abortReason?: string;
    readonly runState?: AgentRunState;
    readonly interruption?: import("./contracts.js").AgentRunInterruption;
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
    readonly model: import("./contracts.js").ModelConfig;
    readonly limits: RunLimitTracker;
    readonly interruption: import("./contracts.js").AgentRunInterruption;
    readonly messages?: readonly Message[];
    readonly pending?: StoredAgentRunState["pending"];
  }): Promise<AgentRunState> {
    const durable = this.activeDurable;
    if (!durable) throw new AgentRunStateError("Durable interruption is not configured");
    const state = durable.state ?? initialAgentRunState({
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
      interruptBeforeTool: durable.options.interruptBeforeTool,
    });
    return this.persistDurable({
      ...state,
      leafId: this.currentLeafId,
      status: "suspended",
      interruption: input.interruption,
      ...(input.messages ? { input: input.messages } : {}),
      ...(input.pending ? { pending: input.pending } : {}),
      counters: input.limits.snapshot(),
    });
  }

  private async persistDurable(state: StoredAgentRunState): Promise<AgentRunState> {
    const durable = this.activeDurable;
    if (!durable) throw new AgentRunStateError("Durable run state is not configured");
    const saved = await saveAgentRunState({
      checkpoints: durable.options.checkpoints,
      state,
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
    return createAgentSession({ agent: this.agent, id: this.id, store: this.store, leafId: options.leafId ?? this.currentLeafId, metadata: this.metadata });
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
    return createAgentSession({ agent: this.agent, id, store: this.store, leafId: branch.length ? remap.get(branch[branch.length - 1]!.id) : undefined, metadata: this.metadata });
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
    const provider =
      this.agent.config.provider ??
      options.providerSource?.(model) ??
      this.agent.config.providerSource?.(model);
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
    this.activeProvider = provider;
  }

  private resolveRunSkills(options: RunOptions, tools: readonly ToolDefinition[]): readonly Skill[] {
    const configured = this.agent.config.skills;
    if (configured && typeof configured === "object" && "list" in configured) {
      if (options.activeSkills) return resolveActiveSkills({ registry: configured, names: options.activeSkills, tools });
      return configured.list();
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
        if (error instanceof GuardrailError) throw error;
        const failure = error instanceof ProviderTurnFailure ? error : undefined;
        const info = failure ? redactSecrets(failure.info, secrets) : errorToErrorInfo(error, secrets);
        if (!policy || failure?.observable) throw errorFromInfo(info);
        const context = { sessionId: this.id, runId, attempt, error: info, metadata: retry?.metadata, signal };
        let decision = await policy.decide(context);
        const payload: RetryMiddlewarePayload = await this.agent.config.middleware?.run("retry", { context, decision }) ?? { context, decision };
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
    try {
      for await (const event of this.activeProvider!.generate(request)) {
        throwIfAborted(signal);
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
        assertGuardrailsAllowed(await runGuardrails({
          stage: "output",
          guardrails: this.activeGuardrails,
          value: { content, calls, messageId, started, usage },
          context: { sessionId: this.id, runId, metadata: this.activeMetadata ?? {}, signal },
          redactor: this.activeRedactor,
          emit: (event) => this.emit(event),
        }));
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
    }
  }

  private async applyProviderRequestPolicies(request: ProviderRequest, runId: string, options: RunOptions, metadata: Readonly<Record<string, unknown>>, signal: AbortSignal) {
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

  private async compactBranch(options: CompactionOptions, runId: string | undefined, signal: AbortSignal | undefined, trigger: "manual" | "auto"): Promise<CompactionResult> {
    throwIfAbortedSignal(signal);
    const entries = await this.entries();
    const secrets = options.secrets ?? [];
    const strategy = options.strategy ?? createDefaultCompactionStrategy({ keepRecentEntries: options.keepRecentEntries, maxSummaryChars: options.maxSummaryChars, secrets });
    const context = { sessionId: this.id, entries, keepRecentEntries: options.keepRecentEntries, trigger, secrets, metadata: options.metadata, signal };
    this.emit({ type: "compaction_started", sessionId: this.id, runId });
    let result = await strategy.compact(context);
    result = { ...result, summary: redactSecrets(result.summary, secrets) };
    const payload: CompactionMiddlewarePayload = await this.agent.config.middleware?.run("compaction", { context, result }) ?? { context, result };
    result = { ...payload.result, summary: redactSecrets(payload.result.summary, secrets) };
    const source = result.entries?.find((entry) => entry.kind === "compaction");
    const data = isCompactionEntryData(source?.data) ? source.data : undefined;
    const entry = createSessionEntry({ sessionId: this.id, parentId: this.currentLeafId, runId, kind: "compaction", summary: result.summary, data });
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
    if (cached && cached.leafId === this.currentLeafId && cached.generation === this.snapshotGeneration && cached.expiresAt > now) return cached.value;
    const reader = this.branchReader();
    const value = reader
      ? await rebuildSessionContext(reader, { sessionId: this.id, leafId: this.currentLeafId })
      : rebuildSessionContext(await this.store.list(this.id), { leafId: this.currentLeafId });
    this.snapshotCache = { leafId: this.currentLeafId, generation: this.snapshotGeneration, expiresAt: now + 1_000, value };
    return value;
  }
}

class EventSubscriber implements AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent> {
  private readonly queue: AgentEvent[] = [];
  private readonly waiters: ((result: IteratorResult<AgentEvent>) => void)[] = [];
  private readonly maxQueuedEvents: number;
  private readonly overflow: NonNullable<SubscribeOptions["overflow"]>;
  private closed = false;

  constructor(private readonly sessionId: string, options: SubscribeOptions, private readonly onClose: () => void) {
    const maxQueuedEvents = options.maxQueuedEvents ?? 1024;
    this.maxQueuedEvents = Number.isFinite(maxQueuedEvents) ? Math.max(1, Math.floor(maxQueuedEvents)) : 1024;
    this.overflow = options.overflow ?? "close";
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this;
  }

  next(): Promise<IteratorResult<AgentEvent>> {
    const event = this.queue.shift();
    if (event) return Promise.resolve({ value: event, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return(): Promise<IteratorResult<AgentEvent>> {
    this.close();
    this.onClose();
    return Promise.resolve({ value: undefined, done: true });
  }

  push(event: AgentEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    if (this.closed) return;
    if (this.queue.length < this.maxQueuedEvents) {
      this.queue.push(event);
      return;
    }
    if (this.overflow === "drop_oldest") {
      this.queue.shift();
      this.queue.push(event);
      return;
    }
    if (this.overflow === "drop_newest") return;
    const droppedEvents = this.queue.length + 1;
    this.queue.splice(0, this.queue.length, {
      type: "event_subscriber_overflow",
      sessionId: this.sessionId,
      droppedEvents,
      maxQueuedEvents: this.maxQueuedEvents,
      overflow: this.overflow,
    });
    this.close();
    this.onClose();
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
}

function providerContent(event: Extract<ProviderEvent, { type: "content_delta" | "tool_call" }>): ContentBlock {
  return event.type === "content_delta" ? event.content : event.call;
}

function reconstructMissingToolCalls(deltas: readonly ProviderEvent[], calls: readonly ToolCallContent[]): readonly ToolCallContent[] {
  if (deltas.length === 0) return [];
  const seen = new Set(calls.map((call) => call.id));
  return reconstructToolCallDeltas(deltas).filter((call) => !seen.has(call.id));
}

function inputToMessages(input: AgentInput): Message[] {
  if (typeof input === "string") return [{ role: "user", content: [{ type: "text", text: input }] }];
  if ("role" in input) return [input];
  return [...input];
}

function finalAssistantMessage(history: readonly Message[]): {
  readonly message?: Message;
  readonly content: readonly ContentBlock[];
  readonly text: string;
} {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { message, content: message.content, text };
  }
  return { content: [], text: "" };
}

function activeTools(tools: AgentConfig["tools"]): { registry: ToolRegistry; tools: readonly ToolDefinition[] } {
  if (!tools) return { registry: createToolRegistry(), tools: [] };
  if ("list" in tools) return { registry: tools, tools: tools.list() };
  const registry = createToolRegistry(tools);
  return { registry, tools };
}

function policyList(policies: ProviderRequestPolicy | readonly ProviderRequestPolicy[] | undefined): readonly ProviderRequestPolicy[] {
  if (!policies) return [];
  return "apply" in policies ? [policies] : policies;
}

function errorFromInfo(error: ErrorInfo): Error {
  return Object.assign(new Error(error.message), { name: error.name ?? "Error", cause: error.cause });
}

class ProviderTurnFailure extends Error {
  constructor(readonly info: ErrorInfo, readonly observable: boolean) {
    super(info.message);
  }
}

function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

function mergeCompaction(agent: false | CompactionOptions | undefined, run: false | CompactionOptions | undefined): CompactionOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

function isBuiltInLoop(loop: import("./contracts.js").AgentLoopStrategy | import("./contracts.js").AgentLoopOptions): boolean {
  return typeof loop === "object" && loop !== null && "strategy" in loop;
}

function mergeGuardrails(agent: Guardrails | undefined, run: Guardrails | undefined): Guardrails | undefined {
  if (!agent && !run) return undefined;
  return {
    input: [...(agent?.input ?? []), ...(run?.input ?? [])],
    output: [...(agent?.output ?? []), ...(run?.output ?? [])],
    toolInput: [...(agent?.toolInput ?? []), ...(run?.toolInput ?? [])],
    toolOutput: [...(agent?.toolOutput ?? []), ...(run?.toolOutput ?? [])],
    maxConcurrency: run?.maxConcurrency ?? agent?.maxConcurrency,
  };
}

function withoutTrailingInput(messages: readonly Message[], input: readonly Message[]): Message[] {
  const next = [...messages];
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const last = next.at(-1);
    if (last && JSON.stringify(last) === JSON.stringify(input[i])) next.pop();
  }
  return next;
}

function bridgeAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function throwIfAborted(signal: AbortSignal): void {
  throwIfAbortedSignal(signal);
}

function throwIfAbortedSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Agent run aborted");
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new TypeError("Provider request or event must be JSON-serializable for run limits");
  }
}

function createUsageAccumulator(): { add(usage: Usage): void; value(): Usage | undefined } {
  const sums = new Map<keyof Usage, number>();
  let costCurrency: string | undefined;
  let costCompatible = true;

  return {
    add(usage) {
      for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
        const value = usage[key];
        if (value !== undefined) sums.set(key, (sums.get(key) ?? 0) + value);
      }
      const total = usage.totalTokens
        ?? (usage.inputTokens !== undefined || usage.outputTokens !== undefined
          ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
          : undefined);
      if (total !== undefined) sums.set("totalTokens", (sums.get("totalTokens") ?? 0) + total);
      if (usage.cost !== undefined && costCompatible) {
        if (!sums.has("cost")) costCurrency = usage.currency;
        else if (usage.currency !== costCurrency) costCompatible = false;
        if (costCompatible) sums.set("cost", (sums.get("cost") ?? 0) + usage.cost);
      }
    },
    value() {
      if (sums.size === 0) return undefined;
      const usage: Record<string, number | string> = {};
      for (const [key, value] of sums) {
        if (key !== "cost" || costCompatible) usage[key] = value;
      }
      if (costCompatible && sums.has("cost") && costCurrency !== undefined) usage.currency = costCurrency;
      return Object.keys(usage).length > 0 ? usage as Usage : undefined;
    },
  };
}

const randomId = createId;
