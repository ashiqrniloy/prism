/** Context-assembly + runInternal orchestrator (plan 059). */

import type { ActiveDurableRun } from "../../agent-approval.js";
import { AgentRunSuspended } from "../../agent-approval.js";
import { agentFingerprint, validateRunStateOptions } from "../../agent-run-state.js";
import { activeTools } from "../../agent-tool-dispatch.js";
import { resolveRunAttentionCompiler } from "../../attention-compiler.js";
import type {
  AgentFinishReason,
  AgentRunStatus,
  RunResult,
  AttentionReport,
  ErrorInfo,
  JsonObject,
  JsonValue,
  Message,
  PromptVersionRef,
  ResolvedRunLimits,
  RunOptions,
  RunRecord,
  ToolDefinition,
  Usage,
} from "../../contracts.js";
import { AgentLoopStateError, AgentRunStateError } from "../../contracts.js";
import { HookError } from "../../hooks/errors.js";
import type { AgentInput } from "../../input.js";
import { assembleProviderInput } from "../../input.js";
import type { AskRequest, AskResolution, LoopStrategy, RunTurnOptions } from "../../loop/index.js";
import { createRunController } from "../../loop/index.js";
import { applyDefaultProviderRequestOptions } from "../../provider-request-policy.js";
import { errorToErrorInfo, redactRunLedgerRecord } from "../../redaction.js";
import { describeBudgetExhaustion, RunLimitError, RunLimitTracker, resolveRunLimits } from "../../run-limits.js";
import { createSessionEntry } from "../../session-stores.js";
import { applyRestoredSkillBodies, createLoadSkillTool } from "../../skill-load.js";
import { createSkillRegistry } from "../../skills.js";
import { assertStructuredOutputRequestSupported, resolveRunProviderOptions } from "../../structured-output.js";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../../system-prompts.js";
import { resolveToolResultFold } from "../../tool-result-fold.js";
import { createSearchToolsTool, createToolSearchState, resolveToolsDisclosure } from "../../tool-search.js";
import { clampTurnToolNames, createToolRegistry, resolveToolEffects, selectRunTools } from "../../tools.js";
import { bridgeAbort, createUsageAccumulator, inputToMessages, isDurableLoop, isSteerSoftInterrupt, throwIfAborted } from "../helpers.js";
import { assignedLoop, tryAgentRuntime } from "../runtime-registry.js";
import { checkpointDurableFold, checkpointDurableTurn, cleanupRun, persistDurable, persistSucceeded, suspendDurable } from "./persist.js";
import { generateWithRetry, recordProviderUsage } from "./provider-round.js";
import {
  bindChargeToolRound,
  bindDispatchToolCall,
  matchStickyDecision,
  replayDurableNestedAndPending,
  runLoopUntilSettled,
  stageAskDecisions,
  suspendGatedRound,
} from "./tool-round.js";
import type { RoundContext, SessionHost } from "./types.js";

const PROMPT_VERSION_MAX_NAME_BYTES = 256;
const PROMPT_VERSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
/** Capabilities reported to `tool.call` for a tool the registry does not know (fail closed). */
const ALL_TOOL_CAPABILITY_KINDS = [
  "read",
  "write",
  "execute",
  "network",
  "external",
] as const satisfies readonly import("../../contracts.js").ToolCapabilityKind[];

/** Bound for the redacted argument preview in a `host.ui` confirm detail. */
const ASK_PREVIEW_MAX_CHARS = 1024;

/** Redacted, bounded argument preview for a `host.ui` confirm detail. Never the raw arguments. */
function askArgumentPreview(session: SessionHost, args: JsonObject): string {
  const redacted = session.activeRedactor?.redact(args) ?? args;
  let text: string;
  try {
    text = JSON.stringify(redacted);
  } catch {
    text = "[unserializable arguments]";
  }
  return text.length > ASK_PREVIEW_MAX_CHARS ? `${text.slice(0, ASK_PREVIEW_MAX_CHARS)}\u2026` : text;
}

/**
 * Resolve a `tool.call` `{ ask }` (roadmap §2.4). An attached `HostUi` answers a `confirm` inline:
 * `answered: true` executes the call, `answered: false` and `dismissed` refuse it, and an absent,
 * `unavailable`, or non-interactive run suspends it. A loop cannot bypass this: the controller's
 * `tool.call` gate calls here.
 */
async function resolveAskDecisions(ctx: RoundContext, requests: readonly AskRequest[]): Promise<ReadonlyMap<string, AskResolution>> {
  const resolutions = new Map<string, AskResolution>();
  // A sticky decision from an earlier approval in this run short-circuits the ask without
  // re-prompting; `tool.call` still fired, so a host gate cannot be bypassed.
  const unresolved: AskRequest[] = [];
  for (const request of requests) {
    const sticky = matchStickyDecision(ctx.session, request.call, ctx.registry);
    if (sticky?.outcome === "allow_for_run") {
      resolutions.set(request.call.id, { kind: "allow" });
    } else if (sticky?.outcome === "reject_for_run") {
      resolutions.set(request.call.id, { kind: "deny", reason: sticky.reason ?? "Rejected for this run" });
    } else {
      unresolved.push(request);
    }
  }
  if (unresolved.length === 0) return resolutions;
  const ui = ctx.session.agent.config.host?.ui;
  const interactive = ctx.options.interactive ?? true;
  const toSuspend: AskRequest[] = [];
  const inlineResolved: { readonly toolCallId: string; readonly outcome: "allow" | "deny" }[] = [];
  for (const request of unresolved) {
    if (!ui || !interactive) {
      toSuspend.push(request);
      continue;
    }
    const { call, reason } = request;
    const response = await ui.request({
      kind: "confirm",
      title: `Approve tool "${call.name}"`,
      detail: `${reason}\n${askArgumentPreview(ctx.session, call.arguments)}`,
      sessionId: ctx.session.id,
    });
    if (response.status === "answered") {
      resolutions.set(call.id, response.value ? { kind: "allow" } : { kind: "deny", reason: `Denied by host: ${reason}` });
      inlineResolved.push({ toolCallId: call.id, outcome: response.value ? "allow" : "deny" });
    } else if (response.status === "dismissed") {
      resolutions.set(call.id, { kind: "deny", reason: `Dismissed by host: ${reason}` });
      inlineResolved.push({ toolCallId: call.id, outcome: "deny" });
    } else {
      toSuspend.push(request);
    }
  }
  if (inlineResolved.length > 0) {
    ctx.session.emit({ type: "decision.resolved", sessionId: ctx.session.id, runId: ctx.runId, decisions: inlineResolved, via: "inline" });
  }
  if (toSuspend.length > 0) {
    // Stage for suspension; the round's allowed calls still run first and the run suspends at the
    // next turn boundary / loop end (`suspendGatedRound`).
    for (const { call } of toSuspend) resolutions.set(call.id, { kind: "suspend" });
    stageAskDecisions(ctx, toSuspend);
  }
  return resolutions;
}

/** Internal seams the run loop is assembled from (private to the kernel). */
type LoopInternals = {
  readonly sessionId: string;
  readonly runId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly history: Message[];
  readonly input: AgentInput;
  readonly inputMessages: readonly Message[];
  readonly maxToolRounds: number;
  readonly restoredLoopState?: JsonValue;
  assemble(
    nextInput: AgentInput,
    toolResults: readonly import("../../contracts.js").ToolResult[] | undefined,
    turn: number | undefined,
    runOptions?: RunTurnOptions,
  ): Promise<import("../../contracts.js").ProviderRequest>;
  chargeToolRound(calls: readonly import("../../contracts.js").ToolCallContent[]): void | Promise<void>;
  generate(
    request: import("../../contracts.js").ProviderRequest,
    requestSecrets?: readonly (string | undefined)[],
  ): Promise<import("../../contracts.js").ProviderTurnResult>;
  isToolCallExclusive(call: import("../../contracts.js").ToolCallContent): boolean;
  dispatchToolCall(call: import("../../contracts.js").ToolCallContent): Promise<import("../../contracts.js").ToolResult>;
  ask(
    requests: readonly import("../../loop/index.js").AskRequest[],
  ): Promise<ReadonlyMap<string, import("../../loop/index.js").AskResolution>>;
  appendMessage(message: Message): Promise<void>;
  hasPendingSteers(): boolean;
  applyPendingSteers(): Promise<boolean>;
  emit(event: import("../../contracts.js").AgentEvent): void;
  /** The loop's turn counter advanced; the provider attempt emits the catalog's `turn.started`. */
  onTurnStart?(turn: number): void;
};
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
 * Redact and bound a `turn.before` stop reason. A `turn.before` handler returning a stop is a
 * host decision that ends the run cleanly, so its reason rides `stopDetail` on the result — it is
 * still host text, so it is redacted and byte-capped exactly like the retired turn policy's was.
 * A missing or non-string reason is a bus invariant violation, not host input: fall back to a
 * constant rather than failing the run over cosmetics.
 */
function boundedHookStopDetail(session: SessionHost, reason: unknown): string {
  if (typeof reason !== "string" || reason.length === 0) return "stopped by a turn.before hook";
  const redacted = session.redact(reason);
  if (Buffer.byteLength(redacted, "utf8") <= TURN_STOP_DETAIL_MAX_BYTES) return redacted;
  let bytes = 0;
  let end = 0;
  for (const char of redacted) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > TURN_STOP_DETAIL_MAX_BYTES) break;
    bytes += size;
    end += char.length;
  }
  return redacted.slice(0, end);
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
}): Promise<RoundContext> {
  const { session, input, options, runId, resumed, controller, model, startedAt, promptVersion, metadata, limits, runUsage } = params;
  session.resolveRunProvider(options);
  throwIfAborted(controller.signal);
  session.emit({
    type: "run.started",
    sessionId: session.id,
    runId,
    ...(resumed ? { resumed: true } : {}),
    ...(resumed?.restore ? { restore: resumed.restore } : {}),
  });
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
  const { tools: listed } = activeTools(session.agent);
  const selected = selectRunTools(listed, options.tools?.only, resumed?.state?.toolNames);
  session.activeToolNames = selected.grant;
  // Run-local snapshot: concurrent runs and MCP refresh must not mutate this registry.
  const activeToolList = selected.tools;
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
  const narrowedTools = searchTool ? [...activeToolList, searchTool] : activeToolList;
  const activeSkills = session.resolveRunSkills(narrowedTools);
  // Progressive disclosure registers the `load_skill` bridge; eager renders every body up front.
  const disclosure = session.agent.config.skills?.disclosure ?? "progressive";
  const loadSkill =
    activeSkills.length > 0 && disclosure === "progressive"
      ? createLoadSkillTool({ registry: createSkillRegistry(activeSkills) })
      : undefined;
  const tools = loadSkill ? [...narrowedTools, loadSkill] : narrowedTools;
  // `duplicate: "error"` fails closed when a host tool already owns `load_skill`/`search_tools`.
  const registry = createToolRegistry(tools, { duplicate: "error" });
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
  const inputMessages = [
    ...(await session.hooks().transform(
      "run.input",
      inputToMessages(input).map((message) => session.redact(message)),
    )),
  ];
  for (const message of inputMessages) await session.appendMessage(message, runId);
  await session.autoCompact(runId, options, controller.signal, inputMessages);
  // Disabled cap (`null`) maps to +Infinity so loop comparisons never trip (`n >= null` would be true).
  const maxToolRounds = resolveRunLimits(session.agent.config.limits, options.limits).maxToolRounds ?? Number.POSITIVE_INFINITY;
  const systemInstructions = composeSystemPrompt(mergeSystemPromptConfig(session.agent.config.systemPrompt, options.systemPrompt), {
    base: session.agent.config.instructions,
  });
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
          type: "package.event",
          sessionId: session.id,
          runId,
          package: "kernel",
          name: "attention.compiled",
          data: {
            used: report.used,
            usedAfter: report.usedAfter,
            inputCap: report.inputCap,
            triggerRatio: report.triggerRatio,
            droppedThinkingTurns: report.droppedThinkingTurns,
            stubbedToolResults: report.stubbedToolResults,
            stubbedBytes: report.stubbedBytes,
            truncated: report.truncated,
          },
        });
      }
    : undefined;
  const inputLayout = options.inputLayout ?? session.agent.config.inputLayout;
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
    providerOptions,
    validate,
    inputLayout,
    loop: undefined as unknown as LoopStrategy,
    runController: undefined as unknown as import("../../loop/index.js").RunController,
    dispatchToolCall: undefined as unknown as RoundContext["dispatchToolCall"],
    toolsDisclosure,
    assembledTurn: false,
    toolCalls: 0,
    toolResults: [],
    runUsage,
  } as RoundContext;

  session.activeLoopHistory = session.history;

  const dispatchBound = bindDispatchToolCall(ctx);
  ctx.dispatchToolCall = dispatchBound;

  const loopInternals: LoopInternals = {
    sessionId: session.id,
    runId,
    metadata,
    signal: controller.signal,
    history: session.history,
    input,
    inputMessages,
    maxToolRounds,
    restoredLoopState: resumed?.state?.loopState?.snapshot,
    assemble: async (nextInput, toolResults, turn, runOptions) => {
      limits.charge("maxTurns");
      const turnIndex = turn ?? 1;
      if (turnIndex > 1) {
        await session.autoCompactTurn(runId, options, controller.signal, turnIndex);
      }
      let turnTools = tools;
      // Package tools hidden by their `when` predicate for this session: not advertised and not
      // callable (`dispatchFilter` allows only `turnAllow`), unless `allowHiddenToolCalls` is set.
      const hidden = hiddenPackageTools(session, tools);
      if (hidden) {
        turnTools = tools.filter((tool) => !hidden.has(tool.name));
        ctx.turnAllow = hidden.size > 0 ? turnTools.map((tool) => tool.name) : undefined;
      }
      const requestedTools = runOptions?.tools;
      if (requestedTools === false) {
        turnTools = [];
        ctx.turnAllow = [];
      } else if (Array.isArray(requestedTools)) {
        const clamped = clampTurnToolNames(turnTools, requestedTools);
        if (clamped.dropped.length > 0) {
          session.emit({
            type: "package.event",
            sessionId: session.id,
            runId,
            package: "kernel",
            name: "tools.clamped",
            data: { turn: turnIndex, dropped: clamped.dropped } as unknown as JsonValue,
          });
        }
        turnTools = clamped.tools;
        ctx.turnAllow = turnTools.map((tool) => tool.name);
      }
      const request = await assembleProviderInput({
        model: options.model ?? session.agent.config.model,
        input: nextInput,
        history: session.history,
        summaries: (await session.snapshot()).summaries,
        toolResults: toolResults ?? [],
        turn,
        inputLayout,
        systemInstructions: runOptions?.system ?? systemInstructions,
        skills: session.restoredSkillBodies.length ? applyRestoredSkillBodies(activeSkills, session.restoredSkillBodies) : activeSkills,
        skillsDisclosure: session.agent.config.skills?.disclosure,
        deferSkillsCatalog: true,
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
        trust: session.agent.config.trust,
        providerOptions,
        redactor: session.activeRedactor,
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
    generate: async (request, requestSecrets) => {
      await suspendGatedRound(ctx);
      if (!ctx.assembledTurn) limits.charge("maxTurns");
      ctx.assembledTurn = false;
      // `turn.before` decided this turn in `RunController.turn`, before assembly, so a host stop
      // never reaches here. Crash-recovery boundary (plan 084 Task 1): after the previous turn's
      // tool results are in
      // the store and before this provider request. No-op unless `checkpointPolicy: "every-turn"`.
      if (session.activeDurable?.options.checkpointPolicy === "every-turn") {
        await checkpointDurableTurn(session, { runId, model, limits });
      }
      // `model.request` transforms already ran in the controller; redaction is last so a transform
      // cannot un-redact. A `model.call` handler answers without a provider request by skipping `next`.
      // Fill-if-missing sessionId / cacheKey / cache defaults and the portable thinking intent, then
      // redact: both run after `model.request`, so a transform can neither skip them nor un-redact.
      const stamped = applyDefaultProviderRequestOptions(request, {
        sessionId: session.id,
        thinkingLevel: options.thinkingLevel ?? session.agent.config.thinkingLevel,
      });
      const redactedRequest = session.redactProviderRequest(stamped);
      try {
        return await generateWithRetry(
          session,
          redactedRequest,
          runId,
          options,
          controller.signal,
          requestSecrets ?? [],
          session.activeLoopTurn,
          (turnUsage, turn, attempt) => recordProviderUsage(ctx, turnUsage, turn, attempt, redactedRequest),
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
    dispatchToolCall: dispatchBound,
    ask: (requests) => resolveAskDecisions(ctx, requests),
    appendMessage: (message) => session.appendMessage(message, runId),
    hasPendingSteers: () => session.pendingSteers.length > 0,
    applyPendingSteers: () => session.applyPendingSteers(runId, metadata, controller.signal),
    onTurnStart: (turn) => {
      session.activeLoopTurn = turn;
    },
    emit: (event) => session.emit(event),
  };
  ctx.loop = session.slots().resolve("loop", session.agent.config.slots?.loop);
  session.activeLoop = ctx.loop;
  ctx.runController = createRunController({
    ...loopInternals,
    session: session as unknown as import("../../contracts.js").Session,
    limits,
    hooks: session.hooks(),
    maxContinuations: limits.limits.maxContinuations,
    assemble: (nextInput, turn, runOptions) => loopInternals.assemble(nextInput, undefined, turn, runOptions),
    effectsFor: (call) => {
      const tool = registry.get(call.name);
      return tool ? resolveToolEffects(tool) : ALL_TOOL_CAPABILITY_KINDS;
    },
    queueContinuation: (continuation) => {
      const messages: Message[] = [{ role: "user", content: [{ type: "text", text: continuation.reason }] }];
      if (continuation.steer !== undefined) {
        messages.push(
          typeof continuation.steer === "string"
            ? { role: "user", content: [{ type: "text", text: continuation.steer }] }
            : continuation.steer,
        );
      }
      try {
        // Same path a host steer takes: same redaction and the same 8-message / 64 KiB caps.
        session.steer(messages);
      } catch (error) {
        throw new HookError("run.end continuation could not be queued", { owner: "kernel", hook: "run.end" });
      }
    },
    setFinishReason: (reason, detail) => {
      ctx.loopFinishReason = reason;
      ctx.loopStopDetail = detail === undefined ? undefined : boundedHookStopDetail(session, detail);
    },
    finishReason: () => ctx.loopFinishReason,
    usage: () => runUsage.value(),
  });
  return ctx;
}

/**
 * Package tools whose `when` predicate hides them from this session this turn, or `undefined` when no
 * package tool has a predicate. A predicate that throws or answers falsy hides the tool (fail closed).
 */
function hiddenPackageTools(session: SessionHost, tools: readonly ToolDefinition[]): Set<string> | undefined {
  const entries = tryAgentRuntime(session.agent)
    ?.packages.tools()
    .filter((entry) => entry.when);
  if (!entries?.length) return undefined;
  const present = new Set(tools.map((tool) => tool.name));
  const hidden = new Set<string>();
  for (const { owner, tool, when } of entries) {
    if (!present.has(tool.name)) continue;
    let visible = false;
    try {
      visible = Boolean(when?.(session.sessionContextFor(owner)));
    } catch {
      visible = false;
    }
    if (!visible) hidden.add(tool.name);
  }
  return hidden;
}

export async function executeRun(
  session: SessionHost,
  input: AgentInput,
  options: RunOptions,
  runId: string,
  resumed?: ActiveDurableRun,
): Promise<RunResult> {
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
  const durableOptions = options.runState ?? session.agent.config.runState ?? resumed?.options;
  if (session.agent.config.runState && options.runState && session.agent.config.runState !== options.runState) {
    throw new AgentRunStateError("RunOptions cannot replace agent durable run-state configuration");
  }
  if (durableOptions) {
    validateRunStateOptions(durableOptions);
    if (options.model || options.effectStore)
      throw new AgentRunStateError("Durable runs require model, loop, and effect store on AgentConfig for fingerprinting");
    const configuredLoop = assignedLoop(session.agent);
    if (configuredLoop && !isDurableLoop(configuredLoop)) {
      throw new AgentLoopStateError(
        "ERR_PRISM_LOOP_NOT_DURABLE",
        "Custom LoopStrategy on a durable run requires snapshot and restore hooks",
      );
    }
    // Fingerprint drift fails closed on a store-slot resume too (`session.resume` bypasses
    // `prepareAgentRunResume`). Covers the hook-id set, tools, model, and definition revision.
    if (resumed?.state && resumed.state.fingerprint !== agentFingerprint(session.agent, resumed.state.definitionRevision)) {
      throw new AgentRunStateError("Agent definition revision or fingerprint mismatch on resume");
    }
  }
  if (session.activeRun) {
    const error = new Error("Agent session already has an active run");
    session.emit({ type: "run.failed", sessionId: session.id, runId, error: errorToErrorInfo(error) });
    throw error;
  }

  const controller = new AbortController();
  const cleanupSignal = bridgeAbort(options.signal, controller);
  session.activeRun = controller;
  session.activeRunId = runId;
  session.pendingSteers = [];
  session.pendingSteerBytes = 0;
  session.pendingSoftInterrupt = false;
  session.activeRunMessages = [];
  session.activeRedactor = session.runRedactor(options.redactor ?? session.agent.config.redactor);
  session.activeLedger = options.runLedger ?? session.agent.config.runLedger;
  session.activeEffectStore = options.effectStore ?? session.agent.config.effectStore;
  session.activeOwnership = options.ownership ?? session.agent.config.ownership;
  session.activePrincipal = options.principal ?? session.agent.config.principal;
  session.activeIdempotencyKey = options.idempotencyKey ?? session.agent.config.idempotencyKey;
  session.activeDurable = resumed ?? (durableOptions ? { options: durableOptions, version: 0 } : undefined);
  // Plan 104 T3: pack `deny`/`tripwire`/`ask` rules run as the session's `tool.call` hook, so
  // Plan 086 T3: reset here, so a suspension before the compiler is resolved (input guardrail)
  // cannot inherit the previous run's durable-folding flag. `assembleRoundContext` sets it true.
  session.attentionDurable = false;
  session.activeGatedRound = undefined;
  session.packAskRecords = undefined;
  if (resumed) session.invalidateSnapshot();

  const model = options.model ?? session.agent.config.model;
  const startedAt = new Date().toISOString();
  let runError: ErrorInfo | undefined;
  let runStatus: AgentRunStatus = "succeeded";
  // Set only on the clean-success path; the finish ledger record carries them (plan 084 Task 2).
  let stopReason: AgentFinishReason | undefined;
  let stopDetail: string | undefined;
  const runUsage = createUsageAccumulator();
  let usage: Usage | undefined;
  const metadata = {
    ...session.agent.config.metadata,
    ...session.metadata,
    ...options.metadata,
  };
  session.activeMetadata = metadata;
  session.activePromptVersion = promptVersion;
  const limits = new RunLimitTracker(resolvedLimits, {
    onExceeded: (breach) => {
      // No event here: the run's single `run.failed` (with `limit` and `attribution`) is emitted by
      // the catch below, so a limit death never produces two outcome records.
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
    stopReason = ctx.loopFinishReason;
    stopDetail = ctx.loopStopDetail;
    usage = runUsage.value() ?? loopUsage;
    return await persistSucceeded(ctx, loopUsage);
  } catch (error) {
    if (error instanceof AgentRunSuspended) {
      runStatus = "suspended";
      const version = error.state.version!;
      session.emit({ type: "run.suspended", sessionId: session.id, runId, interruption: error.interruption, version });
      return session.buildRunResult({ runId, status: "suspended", runState: error.state, interruption: error.interruption });
    }
    runError = errorToErrorInfo(error);
    const breach = error instanceof RunLimitError ? error.breach : limits.breach;
    // Built once: the event and the terminal result carry the same attribution payload (plan 108 T5).
    const exhaustion = breach ? describeBudgetExhaustion(limits, breach, session.activeRecentToolCalls ?? []) : undefined;
    // Terminal attribution before the terminal `error`/finish records, so a subscriber that stops
    // at the first terminal event still sees why the run died (plan 087 T2).
    // One terminal record: `run.failed` carries the redacted error plus, when a ceiling ended the
    // run, the breached limit and the plan-087/108 attribution (the former `run_limit_exceeded` and
    // `budget_exhausted`). Subscribers that stop at the first terminal event still see why it died.
    session.emit({
      type: "run.failed",
      sessionId: session.id,
      runId,
      error: runError,
      ...(breach ? { limit: breach } : {}),
      ...(exhaustion
        ? {
            attribution: {
              consumed: exhaustion.consumed,
              closestOtherAxes: exhaustion.closestOtherAxes,
              recentToolCalls: exhaustion.recentToolCalls,
            },
          }
        : {}),
    });
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
    return result;
  } finally {
    await cleanupRun({ session, controller, cleanupSignal, runId, model, startedAt, runStatus, runError, stopReason, stopDetail });
  }
}
