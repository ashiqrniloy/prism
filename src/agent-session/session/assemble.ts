/** Context-assembly + runInternal orchestrator (plan 059). */

import type { ActiveDurableRun } from "../../agent-approval.js";
import { AgentRunSuspended } from "../../agent-approval.js";
import { resolveLoop, resolveToolConcurrency } from "../../agent-loops.js";
import { validateRunStateOptions } from "../../agent-run-state.js";
import { activeTools } from "../../agent-tool-dispatch.js";
import { resolveRunAttentionCompiler } from "../../attention-compiler.js";
import type {
  AgentFinishReason,
  AgentRunResult,
  AttentionReport,
  ErrorInfo,
  LoopContext,
  Message,
  PromptVersionRef,
  ResolvedRunLimits,
  RunOptions,
  RunRecord,
  StopHook,
  StopHookContext,
  TurnBoundaryContext,
  TurnPolicyOptions,
  Usage,
} from "../../contracts.js";
import { AgentLoopStateError, AgentRunError, AgentRunStateError } from "../../contracts.js";
import { assertGuardrailsAllowed, runGuardrails } from "../../guardrails.js";
import { identityTelemetryAttributes, ownershipFromIdentity, resolveRunIdentity } from "../../identity.js";
import type { AgentInput } from "../../input.js";
import { assembleProviderInput } from "../../input.js";
import { errorToErrorInfo, redactRunLedgerRecord } from "../../redaction.js";
import { describeBudgetExhaustion, RunLimitError, RunLimitTracker, resolveRunLimits } from "../../run-limits.js";
import { createSessionEntry } from "../../session-stores.js";
import { resolveSkillsDisclosure } from "../../skill-disclosure.js";
import { applyRestoredSkillBodies } from "../../skill-load.js";
import { assertStructuredOutputRequestSupported, resolveRunProviderOptions } from "../../structured-output.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../../system-prompts.js";
import { resolveToolResultFold } from "../../tool-result-fold.js";
import { createSearchToolsTool, createToolSearchState, resolveToolsDisclosure } from "../../tool-search.js";
import { clampTurnToolNames, createToolRegistry, selectRunTools } from "../../tools.js";
import {
  bridgeAbort,
  createUsageAccumulator,
  inputToMessages,
  isDurableLoop,
  isSteerSoftInterrupt,
  mergeGuardrails,
  throwIfAborted,
} from "../helpers.js";
import { checkpointDurableFold, checkpointDurableTurn, cleanupRun, persistDurable, persistSucceeded, suspendDurable } from "./persist.js";
import { generateWithRetry, recordProviderUsage, resolveDeterministicTurn } from "./provider-round.js";
import {
  bindChargeToolRound,
  bindDispatchToolCall,
  replayDurableNestedAndPending,
  runLoopUntilSettled,
  suspendGatedRound,
} from "./tool-round.js";
import type { RoundContext, RunStopInfo, SessionHost } from "./types.js";

const PROMPT_VERSION_MAX_NAME_BYTES = 256;
const PROMPT_VERSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
/** Cap on the host stop detail that reaches the result, ledger, and timeline (plan 084 Task 2). */
const TURN_STOP_DETAIL_MAX_BYTES = 256;

function lastAssistantText(history: readonly Message[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== "assistant") continue;
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    if (text) return text;
  }
  return undefined;
}

/**
 * `RunOptions.turnPolicy` stopped the run at a turn boundary (plan 084 Task 2). Internal control
 * signal: it unwinds any loop shape and `executeRun` turns it into a clean terminal success with
 * `stopReason: "host_policy"` — never a run error.
 */
class AgentRunStopped extends Error {
  constructor() {
    super("Agent run stopped by host turn policy");
    this.name = "AgentRunStopped";
  }
}

/** Host turn-policy misuse: a throwing or malformed callback fails the run closed. */
class TurnPolicyError extends Error {
  readonly code = "ERR_PRISM_TURN_POLICY";
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "TurnPolicyError";
  }
}

/** Stop-hook misuse: a throwing or malformed hook fails the run closed (plan 106 R1). */
class StopHookError extends Error {
  readonly code = "ERR_PRISM_STOP_HOOK";
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "StopHookError";
  }
}

/** Validate the merged stop-hook list once per run, before any provider turn (plan 106 R1). */
function assertStopHooks(hooks: readonly StopHook[]): void {
  for (const hook of hooks) {
    if (
      typeof hook !== "object" ||
      hook === null ||
      typeof hook.name !== "string" ||
      hook.name.length === 0 ||
      typeof hook.decide !== "function"
    ) {
      throw new TypeError("stopHooks entries must be StopHook objects with a non-empty name and a decide function");
    }
  }
}

/**
 * Run stop hooks in order at a natural loop end (plan 106 R1). The first `continue` wins; every
 * `stop` (or no hook continuing) leaves the run finished. Hook context is metadata plus the live
 * transcript — tool arguments, prompts, and results are never reshaped by core.
 */
async function evaluateStopHooks(
  ctx: RoundContext,
  stopHookActive: boolean,
): Promise<{ readonly reason: string; readonly steer?: string | Message } | undefined> {
  const context: StopHookContext = {
    sessionId: ctx.session.id,
    runId: ctx.runId,
    turn: ctx.limits.snapshot().turns,
    history: ctx.loopCtx.history,
    metadata: ctx.metadata,
    signal: ctx.controller.signal,
    stopHookActive,
  };
  for (const hook of ctx.stopHooks) {
    let decision: unknown;
    try {
      decision = await hook.decide(context);
    } catch (error) {
      throw new StopHookError(`Stop hook "${hook.name}" threw`, { cause: error });
    }
    if (decision === null || typeof decision !== "object") {
      throw new StopHookError(`Stop hook "${hook.name}" must return a StopHookDecision`);
    }
    const action = (decision as { action?: unknown }).action;
    if (action === "stop") continue;
    if (action !== "continue") {
      throw new StopHookError(`Stop hook "${hook.name}" decision action must be "stop" or "continue"`);
    }
    const reason = (decision as { reason?: unknown }).reason;
    if (typeof reason !== "string" || reason.length === 0) {
      throw new StopHookError(`Stop hook "${hook.name}" continue decision requires a non-empty reason string`);
    }
    const steer = (decision as { steer?: unknown }).steer;
    if (!isStopHookSteer(steer)) {
      throw new StopHookError(`Stop hook "${hook.name}" steer must be a string or Message`);
    }
    return steer === undefined ? { reason } : { reason, steer };
  }
  return undefined;
}

function isStopHookSteer(value: unknown): value is string | Message | undefined {
  if (value === undefined || typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const message = value as Message;
  return typeof message.role === "string" && Array.isArray(message.content);
}

/**
 * Queue a continuation through the host steer path (plan 106 R1): same redaction, same 8-message /
 * 64 KiB caps, and the same input-guardrail re-check when the loop drains it. A queue failure fails
 * the run closed — the hook asked for something the run cannot deliver.
 */
function queueStopHookContinuation(ctx: RoundContext, decision: { readonly reason: string; readonly steer?: string | Message }): void {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: decision.reason }] }];
  if (decision.steer !== undefined) {
    messages.push(
      typeof decision.steer === "string" ? { role: "user", content: [{ type: "text", text: decision.steer }] } : decision.steer,
    );
  }
  try {
    ctx.session.steer(messages);
  } catch (error) {
    throw new StopHookError("Stop hook continuation could not be queued", { cause: error });
  }
}

/** The generate-validate-revise loop promises a validated artifact; a bare return is a failure. */
function assertArtifactOutcome(ctx: RoundContext): void {
  if (ctx.loop.name === "generate-validate-revise" && !ctx.artifactFinished) {
    throw Object.assign(new Error(ctx.artifactFailedInfo?.message ?? "artifact loop ended without a validated artifact"), {
      name: "ArtifactFailed",
      code: ctx.artifactFailedInfo?.code ?? "artifact_failed",
    });
  }
}

/** Validate `RunOptions.turnPolicy` once, before any provider turn (plan 084 Task 2). */
function assertTurnPolicy(policy: TurnPolicyOptions | undefined, resolvedLimits: ResolvedRunLimits): void {
  if (policy === undefined) return;
  if (typeof policy !== "object" || policy === null) throw new TypeError("RunOptions.turnPolicy must be an object");
  if (policy.stop !== undefined && typeof policy.stop !== "function") {
    throw new TypeError("RunOptions.turnPolicy.stop must be a function");
  }
  const maxTurns = policy.maxTurns;
  if (maxTurns === undefined) return;
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new TypeError("RunOptions.turnPolicy.maxTurns must be a positive safe integer");
  }
  // Same narrowing law as `limits`: a run overlay may tighten the agent's cap, never widen it.
  const configured = resolvedLimits.maxTurns;
  if (configured !== null && maxTurns > configured) {
    throw new TypeError(`RunOptions.turnPolicy.maxTurns (${maxTurns}) cannot widen limits.maxTurns (${configured})`);
  }
}

/** Redact and bound a host stop reason; anything unusable fails the run closed. */
function boundedStopDetail(session: SessionHost, reason: unknown): string {
  if (typeof reason !== "string" || reason.length === 0) {
    throw new TurnPolicyError("RunOptions.turnPolicy.stop must return a non-empty reason string");
  }
  const redacted = session.redact(reason);
  if (Buffer.byteLength(redacted, "utf8") > TURN_STOP_DETAIL_MAX_BYTES) {
    throw new TurnPolicyError(`RunOptions.turnPolicy.stop reason must be at most ${TURN_STOP_DETAIL_MAX_BYTES} UTF-8 bytes`);
  }
  return redacted;
}

/**
 * Evaluate the host turn policy at the current provider-turn boundary (plan 084 Task 2). Returns
 * the stop to record, or `undefined` to run the turn. Omitted policy → nothing is read or called.
 */
function evaluateTurnStop(ctx: RoundContext): RunStopInfo | undefined {
  const policy = ctx.options.turnPolicy;
  if (!policy) return undefined;
  const turn = Math.max(1, ctx.session.activeLoopTurn);
  const turns = turn - 1;
  if (policy.maxTurns !== undefined && turns >= policy.maxTurns) return { reason: "turn_limit", detail: "maxTurns" };
  if (!policy.stop) return undefined;
  const context: TurnBoundaryContext = {
    sessionId: ctx.session.id,
    runId: ctx.runId,
    turn,
    turns,
    toolCalls: ctx.toolCalls,
    ...(ctx.runUsage.value() ? { usage: ctx.runUsage.value() } : {}),
    metadata: ctx.metadata,
  };
  let decision: unknown;
  try {
    decision = policy.stop(context);
  } catch (error) {
    throw new TurnPolicyError("RunOptions.turnPolicy.stop threw", { cause: error });
  }
  if (decision === null || typeof decision !== "object" || typeof (decision as { then?: unknown }).then === "function") {
    throw new TurnPolicyError("RunOptions.turnPolicy.stop must synchronously return a TurnStopDecision");
  }
  const action = (decision as { action?: unknown }).action;
  if (action === "continue") return undefined;
  if (action !== "stop") throw new TurnPolicyError('RunOptions.turnPolicy.stop decision action must be "continue" or "stop"');
  return { reason: "host_policy", detail: boundedStopDetail(ctx.session, (decision as { reason?: unknown }).reason) };
}

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
  stopHooks: readonly StopHook[];
}): Promise<RoundContext> {
  const { session, input, options, runId, resumed, controller, model, startedAt, promptVersion, metadata, limits, runUsage, stopHooks } =
    params;
  session.resolveRunProvider(options);
  throwIfAborted(controller.signal);
  session.emit({ type: "agent_started", sessionId: session.id, runId });
  if (resumed)
    session.emit({
      type: "agent_resumed",
      sessionId: session.id,
      runId,
      version: resumed.version,
      ...(resumed.restore ? { restore: resumed.restore } : {}),
    });
  // Plan 106 R2: first run start of this session opens it. Awaited after the two emits above so the
  // run's synchronous announce burst stays intact; middleware error policy owns failures.
  await session.openSession(runId);

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
  const { tools: listed } = activeTools(session.agent.config.tools);
  const selected = selectRunTools(listed, options.toolNames, resumed?.state?.toolNames);
  session.activeToolNames = selected.grant;
  // Run-local snapshot: concurrent runs and MCP refresh must not mutate this registry.
  const activeToolList = selected.tools;
  const baseRegistry = createToolRegistry(activeToolList);
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
  session.tailSegments.clear();
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
  // Disabled cap (`null`) maps to +Infinity so loop comparisons never trip (`n >= null` would be true).
  const maxToolRounds = resolveRunLimits(session.agent.config.limits, options.limits).maxToolRounds ?? Number.POSITIVE_INFINITY;
  const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(session.agent.config.systemPrompt, options.systemPrompt), {
    base: session.agent.config.instructions,
  });
  const contextProviders = [...(session.agent.config.context ?? []), ...activeSkills.flatMap((skill) => skill.context ?? [])];
  const providerOptions = resolveRunProviderOptions(options, session.agent.config);
  assertStructuredOutputRequestSupported(options.model ?? session.agent.config.model, providerOptions);
  const validate = options.validate ?? session.agent.config.validator;
  // Resolved once per run, before any provider turn: a bad setting or a widening run overlay
  // fails here rather than on the turn that happens to cross the ratio (plan 074 C12). The
  // resolved run input budget rides the handle so `run_input_ratio` folds against the same cap
  // the run limit enforces (plan 086 T2); `null` (disabled) leaves that axis on the input cap.
  const attentionCompiler = resolveRunAttentionCompiler(
    session.agent.config.attentionCompiler,
    options.attentionCompiler,
    options.model ?? session.agent.config.model,
    limits.limits.maxInputTokens,
  );
  // Plan 086 T3: durable folding writes the fold ledger to the run checkpoint, so it needs a
  // durable run (the session's durable state is set before this call). Fail at run start, before
  // any provider turn, rather than folding into memory only. The fold state rides that
  // checkpoint independently of `persistSessionState`.
  if (attentionCompiler?.durable && !session.activeDurable) {
    throw new AgentRunStateError(
      "attentionCompiler.durable requires a durable run: set AgentConfig or RunOptions runState with a checkpoint store",
    );
  }
  session.attentionDurable = attentionCompiler?.durable === true;
  // Telemetry seam (plan 074 T6): one `attention_compiled` per mutated turn, counts and the
  // measured ratio inputs only. Under-ratio turns and compiler-off runs emit nothing.
  // Plan 086 T3: a turn that folded new bodies is the fold-boundary durability signal, so it is
  // remembered here (the callback is synchronous) and checkpointed by the assembler below.
  let foldCheckpointPending = false;
  const onAttentionReport = attentionCompiler
    ? (report: AttentionReport) => {
        if (report.newFoldedBodies > 0) foldCheckpointPending = true;
        session.emit({
          type: "attention_compiled",
          sessionId: session.id,
          runId,
          used: report.used,
          usedAfter: report.usedAfter,
          inputCap: report.inputCap,
          triggerRatio: report.triggerRatio,
          droppedThinkingTurns: report.droppedThinkingTurns,
          stubbedToolResults: report.stubbedToolResults,
          stubbedBytes: report.stubbedBytes,
          truncated: report.truncated,
        });
      }
    : undefined;
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
    toolCalls: 0,
    toolResults: [],
    stopHooks,
    runUsage,
    loopCtx: undefined as unknown as LoopContext,
  } as RoundContext;

  const toolNarrowing = options.toolNarrowing ?? session.agent.config.toolNarrowing;
  let narrowedForTurn: { turn: number; tools: typeof tools } | undefined;

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
      const turnIndex = turn ?? 1;
      let turnTools = tools;
      if (toolNarrowing) {
        if (typeof toolNarrowing !== "function") throw new TypeError("toolNarrowing must be a function");
        if (narrowedForTurn?.turn === turnIndex) {
          turnTools = narrowedForTurn.tools;
        } else {
          const assistant = lastAssistantText(session.history);
          const requested = await toolNarrowing({
            turn: turnIndex,
            toolIds: tools.map((tool) => tool.name),
            ...(assistant !== undefined ? { lastAssistantText: assistant } : {}),
          });
          if (!Array.isArray(requested)) throw new TypeError("toolNarrowing must return a string array");
          const clamped = clampTurnToolNames(tools, requested);
          if (clamped.dropped.length > 0) {
            session.emit({
              type: "tool_narrowing_clamped",
              sessionId: session.id,
              runId,
              turn: turnIndex,
              dropped: clamped.dropped,
            });
          }
          turnTools = clamped.tools;
          narrowedForTurn = { turn: turnIndex, tools: turnTools };
        }
        ctx.turnAllow = turnTools.map((tool) => tool.name);
      }
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
        contextBudget: session.agent.config.contextBudget,
        attentionCompiler,
        // Session-owned: a stub made earlier stays applied even on a later under-ratio turn, so
        // the prompt-cache prefix is not rewritten (C10). Undefined when the compiler is off.
        attentionSticky: attentionCompiler ? session.attentionStickyFor() : undefined,
        // Folded bodies (plan 086 T3): a row summarized once is re-applied, never re-summarized,
        // so sticky rows stay byte-identical and a resumed run reuses the persisted bodies.
        attentionFold: attentionCompiler ? session.attentionFoldFor() : undefined,
        // Charge-so-far for the `run_input_ratio` axis: the counter only holds completed turns,
        // so the axis projects this turn's estimate onto it.
        runInputTokens: limits.snapshot().inputTokens,
        onAttentionReport,
        loadedSkills: session.loadedSkills,
        tailSegments: session.tailSegments,
        tools: turnTools,
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
      if (foldCheckpointPending) {
        foldCheckpointPending = false;
        // Fold-boundary durability (plan 086 T3): one write per turn that added folded bodies,
        // after the request is assembled and before the provider sees it, so a crash during this
        // turn resumes with the same ledger. No-op unless the compiler is durable.
        await checkpointDurableFold(session, { runId, model, limits });
      }
      return request;
    },
    chargeToolRound: bindChargeToolRound(ctx),
    generate: async (request) => {
      await suspendGatedRound(ctx);
      if (!ctx.assembledTurn) limits.charge("maxTurns");
      ctx.assembledTurn = false;
      // Host turn policy (plan 084 Task 2): evaluated at the same turn boundary as the
      // crash-recovery checkpoint below, before any provider work. Throwing unwinds any loop
      // shape; `executeRun` converts it into a clean terminal success with `stopReason`.
      const stop = evaluateTurnStop(ctx);
      if (stop) {
        ctx.runStop = stop;
        ctx.loopCtx.finishReason = stop.reason;
        throw new AgentRunStopped();
      }
      // Crash-recovery boundary (plan 084 Task 1): after the previous turn's tool results are in
      // the store and before this provider request. No-op unless `checkpointPolicy: "every-turn"`.
      if (session.activeDurable?.options.checkpointPolicy === "every-turn") {
        await checkpointDurableTurn(session, { runId, model, limits });
      }
      // Deterministic no-model turn (plan 096): host middleware answers at the provider boundary,
      // before any provider-round work. No answer → provider path unchanged.
      const deterministic = await resolveDeterministicTurn(
        session,
        request,
        runId,
        session.activeLoopTurn,
        controller.signal,
        ctx.toolResults,
      );
      if (deterministic) return deterministic;
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
          (turnUsage, turn, attempt) => recordProviderUsage(ctx, turnUsage, turn, attempt, middlewareRequest),
          ctx.toolResults,
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

/**
 * Run the loop to settlement, then apply stop hooks at the natural loop end (plan 106 R1). Each
 * `continue` queues its reason through the steer path and re-enters the loop with a continuation
 * context whose `input`/`inputMessages` are empty — the continuation message is already in
 * `history`, and replaying run-start input would duplicate it. A loop ceiling, a host turn-policy
 * stop, or an artifact failure is not a natural end: hooks never run there, and a continuation leg
 * that hits a ceiling ends the run instead of asking again. `limits.maxStopContinuations`
 * (default 3; `0` observes only; `null` uncapped) bounds continuations as a clean `hook_limit` stop.
 */
async function runLoopWithStopHooks(ctx: RoundContext): Promise<Usage | undefined> {
  let usage = await runLoopUntilSettled(ctx);
  assertArtifactOutcome(ctx);
  // Zero overhead when nothing is configured: no wrapper state, no reads.
  if (ctx.stopHooks.length === 0) return usage;
  const cap = ctx.limits.limits.maxStopContinuations;
  let continuations = 0;
  let stopHookActive = false;
  for (;;) {
    if (ctx.runStop !== undefined || ctx.loopCtx.finishReason !== undefined) return usage;
    const decision = await evaluateStopHooks(ctx, stopHookActive);
    if (!decision) return usage;
    if (cap !== null && continuations >= cap) {
      ctx.loopCtx.finishReason = "hook_limit";
      return usage;
    }
    continuations += 1;
    stopHookActive = true;
    queueStopHookContinuation(ctx, decision);
    const continuationCtx: LoopContext = { ...ctx.loopCtx, input: [], inputMessages: [], continuation: true };
    try {
      usage = await runLoopUntilSettled({ ...ctx, loopCtx: continuationCtx });
    } finally {
      // The loops set `finishReason` on the context they receive; carry it back so the ceiling
      // survives onto the result, the finish record, and `persistSucceeded`.
      if (continuationCtx.finishReason !== undefined) ctx.loopCtx.finishReason = continuationCtx.finishReason;
    }
    assertArtifactOutcome(ctx);
  }
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
  assertTurnPolicy(options.turnPolicy, resolvedLimits);
  const stopHooks = [...(session.agent.config.stopHooks ?? []), ...(options.stopHooks ?? [])];
  assertStopHooks(stopHooks);
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
  session.activeDurable = resumed ?? (durableOptions ? { options: durableOptions, version: 0 } : undefined);
  // Plan 104 T3: an `ask` rule is gated at charge time when the run can suspend; a run that cannot
  // suspend enforces the same rule as a plain block, so it joins the ordinary stage guardrails.
  const packGuardrails = session.activeDurable ? session.packGuardrails : mergeGuardrails(session.packGuardrails, session.packAskBlocks);
  session.activeGuardrails = mergeGuardrails(mergeGuardrails(session.agent.config.guardrails, packGuardrails), options.guardrails);
  // Plan 086 T3: reset here, so a suspension before the compiler is resolved (input guardrail)
  // cannot inherit the previous run's durable-folding flag. `assembleRoundContext` sets it true.
  session.attentionDurable = false;
  session.activeGatedRound = undefined;
  if (resumed) session.invalidateSnapshot();

  const model = options.model ?? session.agent.config.model;
  const startedAt = new Date().toISOString();
  let runError: ErrorInfo | undefined;
  let runStatus: AgentRunResult["status"] = "succeeded";
  // Set only on the clean-success path; the finish ledger record carries them (plan 084 Task 2).
  let stopReason: AgentFinishReason | undefined;
  let stopDetail: string | undefined;
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
  session.activeRecentToolCalls = [];
  const hasFiniteTokenCap = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
  session.activeLimitOutputBuffer = [session.agent.config.limits, requestedLimits].some(
    (value) => hasFiniteTokenCap(value?.maxOutputTokens) || hasFiniteTokenCap(value?.maxTotalTokens) || value?.maxCost !== undefined,
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
      stopHooks,
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
    const loopUsage = await runLoopWithStopHooks(ctx).catch((error: unknown) => {
      // Host turn-policy stop (plan 084 Task 2): the loop was unwound on purpose at a turn
      // boundary. Not an error — the run settles cleanly and stays resumable.
      if (error instanceof AgentRunStopped) return undefined;
      throw error;
    });
    stopReason = ctx.runStop?.reason ?? ctx.loopCtx.finishReason;
    stopDetail = ctx.runStop?.detail;
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
    const breach = error instanceof RunLimitError ? error.breach : limits.breach;
    // Built once: the event and the terminal result carry the same attribution payload (plan 108 T5).
    const exhaustion = breach ? describeBudgetExhaustion(limits, breach, session.activeRecentToolCalls ?? []) : undefined;
    // Terminal attribution before the terminal `error`/finish records, so a subscriber that stops
    // at the first terminal event still sees why the run died (plan 087 T2).
    if (exhaustion) {
      session.emit({ type: "budget_exhausted", sessionId: session.id, runId, ...exhaustion });
    }
    session.emit({ type: "error", sessionId: session.id, runId, error: runError });
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
      attribution: exhaustion && {
        consumed: exhaustion.consumed,
        closestOtherAxes: exhaustion.closestOtherAxes,
        recentToolCalls: exhaustion.recentToolCalls,
      },
      error: runError,
      abortReason: !breach && controller.signal.aborted ? String(controller.signal.reason) : undefined,
      runState,
    });
    throw new AgentRunError(result, { cause: error });
  } finally {
    await cleanupRun({ session, controller, cleanupSignal, runId, model, startedAt, runStatus, runError, stopReason, stopDetail });
  }
}
