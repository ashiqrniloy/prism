/**
 * The package's one `context.build` handler (plan 158 Task 7).
 *
 * It composes the configured stages in a fixed order — **fold → tool search → attention or budget** —
 * so the order cannot drift with hook priorities, and there is no plugin registry for stages. The
 * handler runs at the lowest first-party priority (negative), so a budget or an attention pass sees
 * every block another `context.build` handler added this turn.
 *
 * Everything here changes the provider view only. The store keeps the full transcript: the handler
 * rewrites a clone of `draft.messages` and returns it, and the kernel's `message.append` path is
 * untouched. `context_engineering_fold_view_only` proves it.
 */
import type {
  ContextDraft,
  HookContext,
  HookRejection,
  JsonObject,
  JsonValue,
  Message,
  PackageAPI,
  SessionContext,
  SessionLog,
  SessionState,
} from "@arnilo/prism";
import { AttentionBudgetError, compileAttention, type AttentionCompilation, type AttentionFoldLedger } from "./attention.js";
import type { AttentionCompiler } from "./attention-types.js";
import { applyDraftBudget, ContextBudgetError } from "./budget.js";
import type { ContextEngineeringConfig, ResolvedContextEngineeringConfig } from "./config.js";
import { foldToolResultHistory, planToolResultFoldBatch, resolveToolResultFold, type ResolvedToolResultFoldOptions, type ToolResultFoldInput } from "./fold.js";
import { readActivatedNames, readAttentionState, readFoldFrontier, readLedger, writeFoldFrontier, writeFrontier } from "./state.js";
import type { SearchToolsWiring } from "./search-tools.js";
import { selectDisclosedTools } from "./tool-search.js";

/** The lowest first-party priority: nothing else registered by a package runs after this one. */
export const CONTEXT_ENGINEERING_PRIORITY = -1_000;

export interface ContextEngineeringHandlerDeps {
  readonly prism: PackageAPI<ContextEngineeringConfig>;
  readonly config: ResolvedContextEngineeringConfig;
  /** Sticky frontier, one value per session. */
  readonly frontierState: SessionState<JsonObject>;
  /** Batch fold frontier (cleared tool-call ids), its own key and value. */
  readonly foldFrontierState: SessionState<JsonObject>;
  /** Folded bodies, one append per newly summarized result. */
  readonly foldLog: SessionLog<JsonValue>;
  /** Activated tool names, one value per session. */
  readonly activatedState: SessionState<JsonObject>;
  /** The fold's summarize function for one session (`"truncate"` or a model client call). */
  readonly summarizeFor: (session: SessionContext) => (input: ToolResultFoldInput) => Promise<string> | string;
  /** The compiled attention handle for one session, memoized by the caller. */
  readonly attentionCompilerFor: (session: SessionContext) => AttentionCompiler;
  /** The `search_tools` wiring, present only when the disclosure stage is configured. */
  readonly searchTools?: SearchToolsWiring;
}

export type ContextEngineeringHandler = (draft: ContextDraft, context: HookContext) => Promise<ContextDraft | undefined | HookRejection>;

export function createContextEngineeringHandler(deps: ContextEngineeringHandlerDeps): ContextEngineeringHandler {
  const { config, prism } = deps;
  return async (draft, context) => {
    const session = context.session;
    // Without a session there is no per-session state to read or write, so the handler changes
    // nothing rather than folding into a state it cannot remember.
    if (!session) return undefined;
    const turn = currentTurnOf(draft.messages);
    const ledger = readLedger(deps.foldLog.entries(session));
    const fold = config.fold
      ? resolveToolResultFold({ ...config.fold, summarize: cachedSummarize(deps, config, session, ledger) }, undefined)
      : undefined;

    // --- Stage 1: fold old tool results. Provider view only; the store keeps the full result.
    // Batch mode (clearAtLeastTokens > 0) folds already-cleared rows every request, and pending
    // rows only once their combined size covers a cache miss, so the prefix moves in batches.
    const cleared = fold && fold.clearAtLeastTokens > 0 ? readFoldFrontier(deps.foldFrontierState.get(session)) : undefined;
    const selection =
      fold && cleared ? planToolResultFoldBatch(draft.messages, fold, { turn, clearedToolCallIds: cleared }) : undefined;
    const foldedRows: readonly Message[] = fold
      ? await foldToolResultHistory(draft.messages, fold, {
          sessionId: session.id,
          runId: context.runId,
          turn,
          ...(context.signal ? { signal: context.signal } : {}),
          ...(selection ? { restrictToToolCallIds: selection.foldToolCallIds } : {}),
        })
      : draft.messages;
    if (selection && selection.advance.length > 0) {
      await deps.foldFrontierState.set(session, writeFoldFrontier([...cleared!, ...selection.advance]));
    }
    // The fold returns a new array even when it replaced nothing, so compare row identity: a turn
    // that folded nothing must report "no change" and keep the controller's fast path.
    const folded = sameRows(draft.messages, foldedRows) ? draft.messages : foldedRows;

    // --- Stage 2: narrow the tool list to the activated and selected set.
    const tools = toolSearchTools(config, draft, folded, deps, session);

    // --- Stage 3: attention or budget, never both (config validation rejects the pair).
    if (config.attention) {
      const compiled = await runAttention({ deps, config, draft, folded, tools, session, context, turn, fold });
      if (isRejection(compiled)) return compiled;
      return changed(draft, compiled.messages, tools) ? { ...draft, messages: compiled.messages, tools } : undefined;
    }
    if (config.budget) {
      try {
        const result = applyDraftBudget({
          messages: folded,
          tools,
          ...(draft.context === undefined ? {} : { context: draft.context }),
          ...(draft.systemPrompt === undefined ? {} : { systemPrompt: draft.systemPrompt }),
          budget: config.budget,
        });
        if (result.report.truncated && config.budget.reportOmissions) {
          prism.events.emit("context.omissions", {
            keptTokens: result.report.keptTokens,
            keptBytes: result.report.keptBytes,
            omitted: result.report.omitted.map((omission) => ({
              kind: omission.kind,
              ...(omission.id === undefined ? {} : { id: omission.id }),
              tokenEstimate: omission.tokenEstimate,
              byteLength: omission.byteLength,
            })),
          });
        }
        const nextContext = sameBlocks(draft.context, result.context) ? draft.context : result.context;
        return changed(draft, result.messages, tools, nextContext)
          ? { ...draft, messages: result.messages, tools, ...(nextContext === undefined ? {} : { context: nextContext }) }
          : undefined;
      } catch (error) {
        // A mandatory prefix that cannot fit fails the run closed. `ctx.reject` names the package
        // and the hook in the thrown `HookRejectedError`, so the host sees who refused.
        if (error instanceof ContextBudgetError) return context.reject(error.message);
        throw error;
      }
    }
    return changed(draft, folded, tools) ? { ...draft, messages: folded, tools } : undefined;
  };
}

/** One attention pass: compile, persist the frontier and any new bodies, and emit the report. */
async function runAttention(input: {
  readonly deps: ContextEngineeringHandlerDeps;
  readonly config: ResolvedContextEngineeringConfig;
  readonly draft: ContextDraft;
  readonly folded: readonly Message[];
  readonly tools: readonly import("@arnilo/prism").ToolDefinition[] | undefined;
  readonly session: SessionContext;
  readonly context: HookContext;
  readonly turn: number;
  readonly fold: ResolvedToolResultFoldOptions | undefined;
}): Promise<AttentionCompilation | HookRejection> {
  const { deps, draft, folded, tools, session, context, turn, fold } = input;
  const compiler = deps.attentionCompilerFor(session);
  const { frontier, ledger } = readAttentionState(deps.frontierState.get(session), deps.foldLog.entries(session));
  const known = new Set(ledger.bodies.keys());
  let compiled: AttentionCompilation;
  try {
    compiled = await compileAttention({
      compiler,
      messages: folded,
      ...(draft.context === undefined ? {} : { context: draft.context }),
      ...(tools === undefined ? {} : { tools }),
      ...(fold === undefined ? {} : { fold }),
      frontier,
      attentionFold: ledger,
      turn,
      sessionId: session.id,
      runId: context.runId,
      ...(context.signal ? { signal: context.signal } : {}),
    });
  } catch (error) {
    if (error instanceof AttentionBudgetError) return context.reject(error.message);
    throw error;
  }
  // New bodies go to the log; the frontier is one value. Both are written only when a stage moved.
  for (const [id, body] of ledger.bodies) {
    if (!known.has(id)) await deps.foldLog.append(session, { id, body });
  }
  if (compiled.mutated) await deps.frontierState.set(session, writeFrontier(frontier));
  deps.prism.events.emit("attention.compiled", {
    used: compiled.report.used,
    usedAfter: compiled.report.usedAfter,
    inputCap: compiled.report.inputCap,
    triggerRatio: compiled.report.triggerRatio,
    droppedThinkingTurns: compiled.report.droppedThinkingTurns,
    stubbedToolResults: compiled.report.stubbedToolResults,
    stubbedBytes: compiled.report.stubbedBytes,
    newFoldedBodies: compiled.report.newFoldedBodies,
    truncated: compiled.report.truncated,
    ...(compiled.report.firedAxis === undefined ? {} : { firedAxis: compiled.report.firedAxis }),
  });
  return compiled;
}

/** The disclosure stage: `undefined` keeps the draft's own list (nothing to narrow). */
function toolSearchTools(
  config: ResolvedContextEngineeringConfig,
  draft: ContextDraft,
  messages: readonly Message[],
  deps: ContextEngineeringHandlerDeps,
  session: SessionContext,
): readonly import("@arnilo/prism").ToolDefinition[] | undefined {
  if (config.toolSearch?.disclosure !== "search" || !draft.tools?.length) return draft.tools;
  const topK = config.toolSearch.topK;
  // Publish the turn's index first, so `search_tools` scores against exactly the offered tools.
  deps.searchTools?.publish(session, draft.tools, topK);
  const activated = new Set(readActivatedNames(deps.activatedState.get(session)));
  return selectDisclosedTools({
    tools: draft.tools,
    input: messages,
    search: { topK },
    activated: { has: (name) => activated.has(name) },
  });
}

/** `true` when the handler would change anything at all. */
function changed(
  draft: ContextDraft,
  messages: readonly Message[],
  tools: readonly import("@arnilo/prism").ToolDefinition[] | undefined,
  context?: readonly import("@arnilo/prism").ContextBlock[],
): boolean {
  if (messages !== draft.messages) return true;
  if (tools !== draft.tools) return true;
  return context !== undefined && context !== draft.context;
}

/**
 * The fold's summarize, cached per session by tool-call id. A model summary is the expensive case,
 * so only it is cached: `"truncate"` is deterministic and costs nothing to recompute, and caching it
 * would write one store entry per folded row for no benefit.
 */
function cachedSummarize(
  deps: ContextEngineeringHandlerDeps,
  config: ResolvedContextEngineeringConfig,
  session: SessionContext,
  ledger: AttentionFoldLedger,
): (input: ToolResultFoldInput) => Promise<string> | string {
  const summarize = deps.summarizeFor(session);
  if (config.fold?.summarize === "truncate") return summarize;
  return async (input) => {
    const cached = ledger.bodies.get(input.toolCallId);
    if (cached !== undefined) return cached;
    const body = await summarize(input);
    ledger.bodies.set(input.toolCallId, body);
    await deps.foldLog.append(session, { id: input.toolCallId, body: String(body) });
    return body;
  };
}

/** Element-wise identity: the fold reuses every row it did not rewrite. */
function sameRows(left: readonly Message[], right: readonly Message[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

function sameBlocks(
  left: readonly import("@arnilo/prism").ContextBlock[] | undefined,
  right: readonly import("@arnilo/prism").ContextBlock[],
): boolean {
  if (left === undefined) return right.length === 0;
  return left.length === right.length && left.every((block, index) => block === right[index]);
}

/** `true` when a stage stopped the chain instead of returning a draft. */
function isRejection(value: AttentionCompilation | HookRejection): value is HookRejection {
  return typeof value === "object" && value !== null && "__prismHookRejection" in value;
}

/** The provider turn the draft belongs to: one per assistant reply already in the transcript. */
export function currentTurnOf(messages: readonly Message[]): number {
  let assistant = 0;
  for (const message of messages) if (message.role === "assistant") assistant += 1;
  return assistant + 1;
}
