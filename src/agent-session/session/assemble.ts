/** Context-assembly + runInternal orchestrator (plan 059). */

import type { ActiveDurableRun } from "../../agent-approval.js";
import { AgentRunSuspended } from "../../agent-approval.js";
import { resolveLoop, resolveToolConcurrency } from "../../agent-loops.js";
import { validateRunStateOptions } from "../../agent-run-state.js";
import { activeTools } from "../../agent-tool-dispatch.js";
import type { AgentRunResult, ErrorInfo, LoopContext, PromptVersionRef, RunOptions, RunRecord, Usage } from "../../contracts.js";
import { AgentLoopStateError, AgentRunError, AgentRunStateError } from "../../contracts.js";
import { assertGuardrailsAllowed, runGuardrails } from "../../guardrails.js";
import { identityTelemetryAttributes, ownershipFromIdentity, resolveRunIdentity } from "../../identity.js";
import type { AgentInput } from "../../input.js";
import { assembleProviderInput } from "../../input.js";
import { errorToErrorInfo, redactRunLedgerRecord } from "../../redaction.js";
import { RunLimitError, RunLimitTracker, resolveRunLimits } from "../../run-limits.js";
import { createSessionEntry } from "../../session-stores.js";
import { resolveSkillsDisclosure } from "../../skill-disclosure.js";
import { applyRestoredSkillBodies } from "../../skill-load.js";
import { assertStructuredOutputRequestSupported, resolveRunProviderOptions } from "../../structured-output.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../../system-prompts.js";
import { resolveToolResultFold } from "../../tool-result-fold.js";
import { createSearchToolsTool, createToolSearchState, resolveToolsDisclosure } from "../../tool-search.js";
import { createToolRegistry } from "../../tools.js";
import {
  bridgeAbort,
  createUsageAccumulator,
  inputToMessages,
  isDurableLoop,
  isSteerSoftInterrupt,
  mergeGuardrails,
  throwIfAborted,
} from "../helpers.js";
import { cleanupRun, persistDurable, persistSucceeded, suspendDurable } from "./persist.js";
import { generateWithRetry, recordProviderUsage } from "./provider-round.js";
import {
  bindChargeToolRound,
  bindDispatchToolCall,
  replayDurableNestedAndPending,
  runLoopUntilSettled,
  suspendGatedRound,
} from "./tool-round.js";
import type { RoundContext, SessionHost } from "./types.js";

const PROMPT_VERSION_MAX_NAME_BYTES = 256;
const PROMPT_VERSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

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

async function assembleRoundContext(params: {
  session: SessionHost;
  input: AgentInput;
  options: RunOptions;
  runId: string;
  resumed: ActiveDurableRun | undefined;
  controller: AbortController;
  model: import("../../contracts.js").ModelConfig;
  startedAt: string;
  promptVersion: PromptVersionRef | undefined;
  metadata: Readonly<Record<string, unknown>>;
  limits: RunLimitTracker;
  runUsage: RoundContext["runUsage"];
}): Promise<RoundContext> {
  const { session, input, options, runId, resumed, controller, model, startedAt, promptVersion, metadata, limits, runUsage } = params;
  session.resolveRunProvider(options);
  throwIfAborted(controller.signal);
  session.emit({ type: "agent_started", sessionId: session.id, runId });
  if (resumed) session.emit({ type: "agent_resumed", sessionId: session.id, runId, version: resumed.version });

  const startRecord: RunRecord = {
    id: runId,
    sessionId: session.id,
    branchId: session.currentLeafId,
    model,
    provider: model.provider,
    idempotencyKey: session.activeIdempotencyKey,
    status: "running",
    startedAt,
    ...(promptVersion ? { promptVersion } : {}),
    ...session.activeOwnership,
  };
  await session.activeLedger?.appendRun(redactRunLedgerRecord(startRecord, session.activeRedactor));

  await session.rebuildHistory();
  const { registry: baseRegistry, tools: activeToolList } = activeTools(session.agent.config.tools);
  const toolsDisclosure = resolveToolsDisclosure(options.toolsDisclosure, session.agent.config.toolsDisclosure);
  const toolSearch =
    toolsDisclosure === "search" && activeToolList.length > 0
      ? {
          state: createToolSearchState({
            tools: activeToolList,
            activated: session.activatedTools,
            search: session.agent.config.toolsSearch,
          }),
        }
      : undefined;
  const searchTool = toolSearch ? createSearchToolsTool(toolSearch.state) : undefined;
  const registry = searchTool ? createToolRegistry([...activeToolList, searchTool]) : baseRegistry;
  const tools = searchTool ? [...activeToolList, searchTool] : activeToolList;
  const activeSkills = session.resolveRunSkills(options, tools);
  session.activeRunSkills = activeSkills;
  if (options.model && JSON.stringify(options.model) !== JSON.stringify(session.agent.config.model)) {
    await session.appendEntry(
      createSessionEntry({
        sessionId: session.id,
        parentId: session.currentLeafId,
        runId,
        kind: "model_change",
        previousModel: session.agent.config.model,
        model: options.model,
      }),
    );
  }
  const inputMessages = inputToMessages(input).map((message) => session.redact(message));
  const inputGuardrails = await runGuardrails({
    stage: "input",
    guardrails: session.activeGuardrails,
    value: inputMessages,
    context: { sessionId: session.id, runId, metadata, signal: controller.signal },
    redactor: session.activeRedactor,
    emit: (event) => session.emit(event),
  });
  const approvedByResume = resumed !== undefined && inputGuardrails.terminal?.action === "interrupt" && session.activeDurable !== undefined;
  if (inputGuardrails.terminal?.action === "interrupt" && session.activeDurable && !approvedByResume) {
    const interruption = { kind: "input_guardrail" as const, reason: inputGuardrails.terminal.reason ?? "Input requires approval" };
    throw new AgentRunSuspended(
      await suspendDurable(session, { runId, model, limits, interruption, messages: inputMessages }),
      interruption,
    );
  }
  if (inputGuardrails.terminal && !approvedByResume) assertGuardrailsAllowed(inputGuardrails);
  for (const message of inputMessages) await session.appendMessage(message, runId);
  await session.autoCompact(runId, options, controller.signal, inputMessages);
  const maxToolRounds = resolveRunLimits(session.agent.config.limits, options.limits).maxToolRounds;
  const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(session.agent.config.systemPrompt, options.systemPrompt), {
    base: session.agent.config.instructions,
  });
  const contextProviders = [...(session.agent.config.context ?? []), ...activeSkills.flatMap((skill) => skill.context ?? [])];
  const providerOptions = resolveRunProviderOptions(options, session.agent.config);
  assertStructuredOutputRequestSupported(options.model ?? session.agent.config.model, providerOptions);
  const validate = options.validate ?? session.agent.config.validator;
  const instructionInjectors = options.instructionInjectors ?? session.agent.config.instructionInjectors ?? [];
  const inputLayout = options.inputLayout ?? session.agent.config.inputLayout;
  const loop = resolveLoop(options, session.agent.config);
  session.activeLoop = loop;
  const toolConcurrency = resolveToolConcurrency(options, session.agent.config);
  session.activeLoopTurn = 1;

  const ctx = {
    session,
    input,
    options,
    runId,
    resumed,
    controller,
    model,
    metadata,
    limits,
    registry,
    tools,
    activeSkills,
    inputMessages,
    maxToolRounds,
    systemInstructions,
    contextProviders,
    providerOptions,
    validate,
    instructionInjectors,
    inputLayout,
    loop,
    toolConcurrency,
    toolsDisclosure,
    assembledTurn: false,
    artifactFinished: false,
    artifactFailedInfo: undefined as RoundContext["artifactFailedInfo"],
    runUsage,
    loopCtx: undefined as unknown as LoopContext,
  } as RoundContext;

  const loopCtx: LoopContext = {
    sessionId: session.id,
    runId,
    metadata,
    signal: controller.signal,
    history: session.history,
    input,
    inputMessages,
    maxToolRounds,
    toolConcurrency,
    restoredLoopState: resumed?.state?.loopState?.snapshot,
    assemble: async (nextInput, toolResults, turn) => {
      limits.charge("maxTurns");
      const request = await assembleProviderInput({
        model: options.model ?? session.agent.config.model,
        input: nextInput,
        history: session.history,
        summaries: (await session.snapshot()).summaries,
        toolResults: toolResults ?? [],
        turn,
        instructionInjectors,
        inputLayout,
        systemInstructions,
        inputBuilder: session.agent.config.inputBuilder,
        promptBuilder: session.agent.config.promptBuilder,
        contextProviders,
        skills: session.restoredSkillBodies.length ? applyRestoredSkillBodies(activeSkills, session.restoredSkillBodies) : activeSkills,
        skillsDisclosure: resolveSkillsDisclosure(options.skillsDisclosure, session.agent.config.skillsDisclosure),
        toolsDisclosure,
        toolsSearch: session.agent.config.toolsSearch,
        activatedTools: session.activatedTools,
        toolResultFold: resolveToolResultFold(options.toolResultFold, session.agent.config.toolResultFold),
        loadedSkills: session.loadedSkills,
        tools,
        resourceLoader: session.agent.config.resourceLoader,
        permission: session.agent.config.permission,
        trust: session.agent.config.trust,
        providerOptions,
        redactor: session.activeRedactor,
        middleware: session.agent.config.middleware,
        sessionId: session.id,
        runId,
        metadata,
        signal: controller.signal,
      });
      ctx.assembledTurn = true;
      return request;
    },
    chargeToolRound: bindChargeToolRound(ctx),
    generate: async (request) => {
      await suspendGatedRound(ctx);
      if (!ctx.assembledTurn) limits.charge("maxTurns");
      ctx.assembledTurn = false;
      const policyResult = await session.applyProviderRequestPolicies(request, runId, options, metadata, controller.signal);
      const middlewareRequest =
        (await session.agent.config.middleware?.run("provider_request", policyResult.request)) ?? policyResult.request;
      try {
        return await generateWithRetry(
          session,
          session.redactProviderRequest(middlewareRequest),
          runId,
          options,
          controller.signal,
          policyResult.secrets,
          session.activeLoopTurn,
          (turnUsage, turn, attempt) => recordProviderUsage(ctx, turnUsage, turn, attempt),
        );
      } catch (error) {
        if (isSteerSoftInterrupt(error)) {
          return { content: [], calls: [], started: false, usage: undefined };
        }
        throw error;
      }
    },
    isToolCallExclusive: (call) => registry.get(call.name)?.exclusive === true,
    dispatchToolCall: bindDispatchToolCall(ctx),
    appendMessage: (message) => session.appendMessage(message, runId),
    hasPendingSteers: () => session.pendingSteers.length > 0,
    applyPendingSteers: () => session.applyPendingSteers(runId, metadata, controller.signal),
    emit: (event) => {
      if (event.type === "turn_started") session.activeLoopTurn = event.turn;
      if (event.type === "artifact_finished") ctx.artifactFinished = true;
      if (event.type === "artifact_failed") {
        const first = event.result.errors?.[0];
        const reason = event.result.metadata?.reason;
        ctx.artifactFailedInfo = {
          message: first?.message ?? "artifact failed",
          code: typeof reason === "string" || typeof reason === "number" ? reason : "artifact_failed",
        };
      }
      session.emit(event);
    },
  };
  ctx.loopCtx = loopCtx;
  return ctx;
}

export async function executeRun(
  session: SessionHost,
  input: AgentInput,
  options: RunOptions,
  runId: string,
  resumed?: ActiveDurableRun,
): Promise<AgentRunResult> {
  const legacyMaxToolRounds = (options as { maxToolRounds?: unknown }).maxToolRounds;
  if (legacyMaxToolRounds !== undefined) {
    throw new TypeError("RunOptions.maxToolRounds was removed in 0.1.5; use RunOptions.limits.maxToolRounds instead");
  }
  const promptVersion = assertPromptVersionRef(options.promptVersion);
  if (
    session.agent.config.secure &&
    (options.redactor !== undefined ||
      options.ownership !== undefined ||
      options.validate !== undefined ||
      options.effectStore !== undefined ||
      options.runState !== undefined)
  ) {
    throw new AgentRunStateError("Secure agent defaults cannot be replaced per run");
  }
  const requestedLimits = options.limits;
  const resolvedLimits = resolveRunLimits(session.agent.config.limits, requestedLimits);
  const durableOptions = options.runState ?? session.agent.config.runState;
  if (session.agent.config.runState && options.runState && session.agent.config.runState !== options.runState) {
    throw new AgentRunStateError("RunOptions cannot replace agent durable run-state configuration");
  }
  if (durableOptions) {
    validateRunStateOptions(durableOptions);
    if (options.model || options.guardrails || options.loop || options.effectStore)
      throw new AgentRunStateError("Durable runs require model, guardrails, loop, and effect store on AgentConfig for fingerprinting");
    const configuredLoop = session.agent.config.loop;
    if (configuredLoop && !isDurableLoop(configuredLoop)) {
      throw new AgentLoopStateError(
        "ERR_PRISM_LOOP_NOT_DURABLE",
        "Custom AgentLoopStrategy on a durable run requires snapshot and restore hooks",
      );
    }
  }
  if (session.activeRun) {
    const error = new Error("Agent session already has an active run");
    session.emit({ type: "error", sessionId: session.id, runId, error: errorToErrorInfo(error) });
    throw error;
  }

  const controller = new AbortController();
  const cleanupSignal = bridgeAbort(options.signal, controller);
  session.activeRun = controller;
  session.activeRunId = runId;
  session.pendingSteers = [];
  session.pendingSteerBytes = 0;
  session.pendingSoftInterrupt = false;
  session.activeRedactor = options.redactor ?? session.agent.config.redactor;
  session.activeLedger = options.runLedger ?? session.agent.config.runLedger;
  session.activeEffectStore = options.effectStore ?? session.agent.config.effectStore;
  session.activeOwnership = options.ownership ?? session.agent.config.ownership;
  session.activeIdentity = resolveRunIdentity(options.identity, session.agent.config.identity, session.activeOwnership);
  if (session.activeIdentity && !session.activeOwnership) session.activeOwnership = ownershipFromIdentity(session.activeIdentity);
  session.activeIdempotencyKey = options.idempotencyKey ?? session.agent.config.idempotencyKey;
  session.activeGuardrails = mergeGuardrails(session.agent.config.guardrails, options.guardrails);
  session.activeDurable = resumed ?? (durableOptions ? { options: durableOptions, version: 0 } : undefined);
  session.activeGatedRound = undefined;
  if (resumed) session.invalidateSnapshot();

  const model = options.model ?? session.agent.config.model;
  const startedAt = new Date().toISOString();
  let runError: ErrorInfo | undefined;
  let runStatus: AgentRunResult["status"] = "succeeded";
  const runUsage = createUsageAccumulator();
  let usage: Usage | undefined;
  const metadata = {
    ...session.agent.config.metadata,
    ...session.metadata,
    ...options.metadata,
    ...(session.activeIdentity ? identityTelemetryAttributes(session.activeIdentity) : {}),
  };
  session.activeMetadata = metadata;
  session.activePromptVersion = promptVersion;
  const limits = new RunLimitTracker(resolvedLimits, {
    onExceeded: (breach) => {
      session.emit({ type: "run_limit_exceeded", sessionId: session.id, runId, breach });
      controller.abort(new RunLimitError(breach));
    },
    snapshot: resumed?.state?.counters,
    deadlineAt: resumed?.state?.deadlineAt,
  });
  session.activeLimits = limits;
  session.activeLimitOutputBuffer = [session.agent.config.limits, requestedLimits].some(
    (value) => value?.maxOutputTokens !== undefined || value?.maxTotalTokens !== undefined || value?.maxCost !== undefined,
  );

  try {
    const ctx = await assembleRoundContext({
      session,
      input,
      options,
      runId,
      resumed,
      controller,
      model,
      startedAt,
      promptVersion,
      metadata,
      limits,
      runUsage,
    });

    await replayDurableNestedAndPending(ctx);

    const resumedLoopState = resumed?.state?.loopState;
    if (resumedLoopState) {
      if (ctx.loop.name !== resumedLoopState.name || (ctx.loop.revision ?? "1") !== resumedLoopState.revision) {
        throw new AgentLoopStateError(
          "ERR_PRISM_LOOP_REVISION",
          `Loop ${resumedLoopState.name} revision ${resumedLoopState.revision} does not match the resumed durable run`,
        );
      }
      ctx.loop.restore?.(resumedLoopState.snapshot);
    }
    const loopUsage = await runLoopUntilSettled(ctx);
    if (ctx.loop.name === "generate-validate-revise" && !ctx.artifactFinished) {
      throw Object.assign(new Error(ctx.artifactFailedInfo?.message ?? "artifact loop ended without a validated artifact"), {
        name: "ArtifactFailed",
        code: ctx.artifactFailedInfo?.code ?? "artifact_failed",
      });
    }
    usage = runUsage.value() ?? loopUsage;
    return await persistSucceeded(ctx, loopUsage);
  } catch (error) {
    if (error instanceof AgentRunSuspended) {
      runStatus = "suspended";
      const version = error.state.version!;
      session.emit({ type: "agent_suspended", sessionId: session.id, runId, interruption: error.interruption, version });
      return session.buildRunResult({ runId, status: "suspended", runState: error.state, interruption: error.interruption });
    }
    runError = errorToErrorInfo(error);
    session.emit({ type: "error", sessionId: session.id, runId, error: runError });
    const breach = error instanceof RunLimitError ? error.breach : limits.breach;
    runStatus = breach ? "failed" : controller.signal.aborted ? "aborted" : "failed";
    const runState = session.activeDurable?.state
      ? await persistDurable(session, {
          ...session.activeDurable.state,
          status: runStatus,
          interruption: undefined,
          loopState: undefined,
          pendingCalls: undefined,
          nestedRuns: undefined,
          stickyDecisions: undefined,
        })
      : undefined;
    const result = session.buildRunResult({
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
    await cleanupRun({ session, controller, cleanupSignal, runId, model, startedAt, runStatus, runError });
  }
}
