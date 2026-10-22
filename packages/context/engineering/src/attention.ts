/** Attention Compiler (plan 074 Tasks 2–3), ported into `@arnilo/prism-context-engineering`
 *  (plan 158 Task 7). Creation is synchronous and fails closed; `compileAttention` measures the
 *  assembled draft once, rewrites only the message clone it is given, and never touches the store,
 *  the compaction ledger, or the frozen prefix.
 *
 *  The kernel version rewrote two of the assembler's groups (`history` and the in-flight
 *  `toolResults`); a `context.build` draft is one flat message list, so the port rewrites the list
 *  and treats every row as history. The stages, gates, ledger, and frontier are otherwise the same
 *  code, which is why the kernel's attention suites still pass against this module.
 */

import { createHash } from "node:crypto";
import type { ContextBlock, Message, SecretRedactor, ToolDefinition, ToolResultContent } from "@arnilo/prism";
import { estimateMessageBytes, estimateMessageTokens, estimateTextBytes, estimateTextTokens } from "@arnilo/prism";
import type {
  AttentionCompiler,
  AttentionCompilerContext,
  AttentionCompilerOptions,
  AttentionReport,
  AttentionTrigger,
  AttentionTriggerDecision,
  AttentionTriggerFunction,
  AttentionTriggerState,
  AttentionInputCapOptions,
} from "./attention-types.js";
import {
  capToolResultSummary,
  foldedToolResultHeader,
  HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES,
  inferToolResultTurns,
  type ResolvedToolResultFoldOptions,
  toolResultFoldText,
} from "./fold.js";

export const ATTENTION_BUDGET_ERROR_CODE = "attention_budget_exceeded" as const;

/** C9: still over `triggerRatio` after every eligible stage — host should compact, not delete. */
export class AttentionBudgetError extends Error {
  readonly code = ATTENTION_BUDGET_ERROR_CODE;
  constructor(message = "attention budget exceeded: still over triggerRatio after stub stages") {
    super(message);
    this.name = "AttentionBudgetError";
  }
}

export function isAttentionBudgetError(error: unknown): error is AttentionBudgetError {
  return error instanceof Error && (error as { code?: unknown }).code === ATTENTION_BUDGET_ERROR_CODE;
}

export const DEFAULT_ATTENTION_TRIGGER_RATIO = 0.75;
export const DEFAULT_ATTENTION_COMPACT_RATIO = 0.9;
export const DEFAULT_ATTENTION_THINKING_KEEP_TURNS = 1;
export const DEFAULT_ATTENTION_KEEP_LAST = 3;
export const DEFAULT_ATTENTION_RESERVE_TOKENS = 1024;

/** Matches the run allow-list caps in the kernel's tool table: no more names than a run could hold. */
const MAX_EXCLUDE_TOOL_NAMES = 1_024;
const MAX_TOOL_NAME_CHARS = 256;

function resolveRatio(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || (value as number) <= 0 || (value as number) >= 1) {
    throw new TypeError(`${name} must be a number in (0, 1)`);
  }
  return value as number;
}

function resolveCount(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

/** `resolveRatio` for a value with no default: an axis ratio is required. */
function requiredRatio(value: unknown, name: string): number {
  if (value === undefined) throw new TypeError(`${name} must be a number in (0, 1)`);
  return resolveRatio(value, DEFAULT_ATTENTION_TRIGGER_RATIO, name);
}

export function resolveAttentionReserveTokens(value: unknown): number {
  return resolveCount(value, DEFAULT_ATTENTION_RESERVE_TOKENS, "attention.reserveTokens");
}

/** C2: host `maxInputTokens` wins; otherwise `contextWindow - (maxOutputTokens ?? 0) - reserve`.
 *  Throws when no cap can be derived. */
export function resolveInputCap(options: AttentionInputCapOptions = {}, model?: AttentionCompilerContext["model"]): number {
  const reserveTokens = resolveAttentionReserveTokens(options.reserveTokens);
  if (options.maxInputTokens !== undefined) {
    if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1) {
      throw new TypeError("attention.maxInputTokens must be a positive safe integer");
    }
    return options.maxInputTokens;
  }
  const window = model?.limits?.contextWindow;
  if (!Number.isSafeInteger(window) || (window as number) <= 0) {
    throw new TypeError("attention requires maxInputTokens or model.limits.contextWindow");
  }
  const maxOutputTokens = model?.limits?.maxOutputTokens;
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0)) {
    throw new TypeError("attention requires model.limits.maxOutputTokens to be a non-negative safe integer");
  }
  const cap = (window as number) - (maxOutputTokens ?? 0) - reserveTokens;
  if (cap <= 0) {
    throw new TypeError(`attention resolved a non-positive input cap (${cap}): raise contextWindow or lower reserveTokens`);
  }
  return cap;
}

function resolveExcludeTools(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError("attention.excludeTools must be an array of tool names");
  if (value.length > MAX_EXCLUDE_TOOL_NAMES) {
    throw new TypeError(`attention.excludeTools exceeds ${MAX_EXCLUDE_TOOL_NAMES} entries`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_TOOL_NAME_CHARS) {
      throw new TypeError(`attention.excludeTools entries must be non-empty strings of at most ${MAX_TOOL_NAME_CHARS} characters`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return Object.freeze(out);
}

/** Normalize one configured axis, freezing it. Unnamed predicates are wrapped so the evaluator
 *  sees one shape; every failure is a config-time `TypeError` naming the option. */
function normalizeAttentionTrigger(value: unknown, name: string): AttentionTrigger {
  if (typeof value === "function") return Object.freeze({ kind: "predicate", shouldFold: value as AttentionTriggerFunction } as const);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be a trigger object, a predicate function, or an array of them`);
  }
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case "input_ratio":
    case "run_input_ratio":
      return Object.freeze({ kind, ratio: requiredRatio((value as { ratio?: unknown }).ratio, `${name}.ratio`) } as const);
    case "token_floor": {
      const tokens = (value as { tokens?: unknown }).tokens;
      if (!Number.isSafeInteger(tokens) || (tokens as number) < 1) {
        throw new TypeError(`${name}.tokens must be a positive safe integer`);
      }
      return Object.freeze({ kind, tokens: tokens as number } as const);
    }
    case "predicate": {
      const shouldFold = (value as { shouldFold?: unknown }).shouldFold;
      if (typeof shouldFold !== "function") throw new TypeError(`${name}.shouldFold must be a function`);
      return Object.freeze({ kind, shouldFold: shouldFold as AttentionTriggerFunction } as const);
    }
    default:
      throw new TypeError(`unknown ${name} kind: ${String(kind)} (expected input_ratio, run_input_ratio, token_floor, or predicate)`);
  }
}

/** Fold axes for a compiler: exactly the configured `trigger`, or the `triggerRatio` axis alone
 *  (plan 074 behavior) when none is. Frozen, in evaluation order. */
function resolveAttentionTriggerAxes(triggerRatio: number, value: unknown): readonly AttentionTrigger[] {
  if (value === undefined) return Object.freeze([Object.freeze({ kind: "input_ratio", ratio: triggerRatio } as const)]);
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) {
    throw new TypeError("attention.trigger must be a trigger object, a predicate function, or a non-empty array of them");
  }
  const single = entries.length === 1;
  return Object.freeze(
    entries.map((entry, index) => normalizeAttentionTrigger(entry, single ? "attention.trigger" : `attention.trigger[${index}]`)),
  );
}

/** Resolved run input budget; `null` disables the cap, so it is no budget either. */
function resolveAttentionRunInputBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("attention.runInputBudget must be a positive safe integer");
  }
  return value as number;
}

/**
 * Build the frozen per-turn state the axes read: the compiler supplies the cap and the run budget
 * (so a caller cannot silently drop the budget and fall back to the input cap), the caller
 * supplies what only the turn knows.
 */
export function attentionTriggerState(
  compiler: Pick<AttentionCompiler, "inputCap" | "runInputBudget">,
  turn: { readonly estimatedInputTokens: number; readonly runInputTokens?: number; readonly turn?: number },
): AttentionTriggerState {
  return Object.freeze({
    estimatedInputTokens: turn.estimatedInputTokens,
    inputCapTokens: compiler.inputCap,
    ...(compiler.runInputBudget === undefined ? {} : { runInputBudgetTokens: compiler.runInputBudget }),
    runInputTokens: turn.runInputTokens ?? 0,
    turn: turn.turn ?? 1,
  });
}

/**
 * Evaluate the fold axes in order against one turn's state; the first axis that fires wins, and
 * its `targetTokens` (when it has one) is what the stages fold to. Called at most twice per turn —
 * once at turn start, once after the stages — so a host predicate never runs per row.
 */
export function evaluateAttentionTrigger(axes: readonly AttentionTrigger[], state: AttentionTriggerState): AttentionTriggerDecision {
  for (const axis of axes) {
    switch (axis.kind) {
      case "input_ratio": {
        const targetTokens = axis.ratio * state.inputCapTokens;
        if (state.estimatedInputTokens >= targetTokens) {
          return { shouldFold: true, firedAxis: "input_ratio", targetTokens, failsClosed: true };
        }
        continue;
      }
      case "token_floor":
        if (state.estimatedInputTokens >= axis.tokens) {
          return { shouldFold: true, firedAxis: "token_floor", targetTokens: axis.tokens, failsClosed: true };
        }
        continue;
      case "run_input_ratio": {
        const budget = state.runInputBudgetTokens;
        if (budget === undefined) {
          // No run budget declared: the axis is the per-request ratio comparison.
          const targetTokens = axis.ratio * state.inputCapTokens;
          if (state.estimatedInputTokens >= targetTokens) {
            return { shouldFold: true, firedAxis: "run_input_ratio", targetTokens, failsClosed: true };
          }
          continue;
        }
        if (state.runInputTokens + state.estimatedInputTokens < axis.ratio * budget) continue;
        // Cumulative: the spend is already booked, so folding cannot settle the axis. No
        // per-request target (fold every eligible row) and no fail-closed throw — the run limit
        // owns the cap, and folding is what keeps the run under it.
        return { shouldFold: true, firedAxis: "run_input_ratio", failsClosed: false };
      }
      case "predicate": {
        const fired = axis.shouldFold(state);
        if (typeof fired !== "boolean") {
          throw new TypeError("attention.trigger predicate must return a boolean (use a synchronous function)");
        }
        if (fired) return { shouldFold: true, firedAxis: "predicate", failsClosed: true };
        continue;
      }
    }
  }
  return { shouldFold: false, failsClosed: false };
}

/** Validate compiler options + resolve the input cap. No provider I/O; unknown or
 *  unresolvable input throws here rather than on the first turn. */
export function createAttentionCompiler(options: AttentionCompilerOptions = {}, context: AttentionCompilerContext = {}): AttentionCompiler {
  if (typeof options !== "object" || options === null) throw new TypeError("attention options must be an object");
  const triggerRatio = resolveRatio(options.triggerRatio, DEFAULT_ATTENTION_TRIGGER_RATIO, "attention.triggerRatio");
  const triggerAxes = resolveAttentionTriggerAxes(triggerRatio, options.trigger);
  // Reference ratio the handle reports and `compactRatio` is checked against: the explicit
  // `triggerRatio`, else the first `input_ratio` axis, so a `trigger` that replaces the gate still
  // reports the ratio that gate actually folds at.
  let referenceRatio = triggerRatio;
  if (options.triggerRatio === undefined) {
    for (const axis of triggerAxes) {
      if (axis.kind === "input_ratio") {
        referenceRatio = axis.ratio;
        break;
      }
    }
  }
  const compactRatio = resolveRatio(options.compactRatio, DEFAULT_ATTENTION_COMPACT_RATIO, "attention.compactRatio");
  if (compactRatio <= referenceRatio) {
    throw new TypeError(`attention.compactRatio (${compactRatio}) must exceed triggerRatio (${referenceRatio})`);
  }
  const thinkingKeepTurns = resolveCount(options.thinkingKeepTurns, DEFAULT_ATTENTION_THINKING_KEEP_TURNS, "attention.thinkingKeepTurns");
  const keepLast = resolveCount(options.keepLast, DEFAULT_ATTENTION_KEEP_LAST, "attention.keepLast");
  const inputCap = resolveInputCap(options, context.model);
  const reserveTokens = resolveAttentionReserveTokens(options.reserveTokens);
  const excludeTools = resolveExcludeTools(options.excludeTools);
  const runInputBudget = resolveAttentionRunInputBudget(context.runInputBudget);

  return Object.freeze({
    inputCap,
    reserveTokens,
    triggerRatio: referenceRatio,
    compactRatio,
    thinkingKeepTurns,
    keepLast,
    excludeTools,
    trigger: triggerAxes,
    ...(runInputBudget === undefined ? {} : { runInputBudget }),
  });
}

export interface AttentionStickyFrontier {
  /** SHA-256 keys of assistant messages whose thinking blocks were stripped. */
  readonly thinking: Set<string>;
  /** Tool call ids whose results were stubbed. */
  readonly toolCallIds: Set<string>;
}

export function createAttentionStickyFrontier(): AttentionStickyFrontier {
  return { thinking: new Set<string>(), toolCallIds: new Set<string>() };
}

/** Host decision/effect payloads are never stubbed (C6): any of these metadata keys on a tool
 *  message protects the row. Hosts with decision tools should list them in `attention.excludeTools`. */
const PROTECTED_TOOL_RESULT_METADATA_KEYS = [
  "approval",
  "approvalId",
  "prismApproval",
  "decision",
  "decisions",
  "pendingDecisions",
  "elicitation",
] as const;

const THINKING_KEY_BYTES = 32;

export interface AttentionCompileOptions {
  readonly compiler: AttentionCompiler;
  /** The exact messages the draft will send; the returned list is a rewritten clone. */
  readonly messages: readonly Message[];
  readonly context?: readonly ContextBlock[];
  readonly tools?: readonly ToolDefinition[];
  /** Host fold: its `summarize` wins for the rows the compiler picks, and its age/byte gates
   *  decide fold-eligibility. Omitted → the deterministic stub and `keepLast` alone. */
  readonly fold?: ResolvedToolResultFoldOptions;
  readonly frontier?: AttentionStickyFrontier;
  /** Session-owned folded bodies: a body stored here is re-applied instead of re-summarized, so a
   *  sticky row stays byte-identical and the host `summarize` runs once per row instead of once per
   *  turn. Omit for one-shot assemblies. */
  readonly attentionFold?: AttentionFoldLedger;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly turn?: number;
  /** Run input tokens already charged this run; the `run_input_ratio` axis projects onto it. */
  readonly runInputTokens?: number;
  readonly sessionId?: string;
  readonly runId?: string;
}

export interface AttentionCompilation {
  /** The input list unchanged when nothing was mutated; otherwise a rewritten clone. The caller's
   *  array and messages are never mutated. */
  readonly messages: readonly Message[];
  readonly mutated: boolean;
  readonly report: AttentionReport;
}

/** One O(n) measurement of what the draft will send: messages, context blocks, tool declarations. */
export function measureDraftCost(options: {
  readonly messages: readonly Message[];
  readonly context?: readonly ContextBlock[];
  readonly tools?: readonly ToolDefinition[];
}): { tokens: number; bytes: number } {
  let tokens = 0;
  let bytes = 0;
  for (const message of options.messages) {
    tokens += estimateMessageTokens(message);
    bytes += estimateMessageBytes(message);
  }
  for (const block of options.context ?? []) {
    const text = contextBlockMeasureText(block);
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  if (options.tools?.length) {
    const text = toolsMeasureText(options.tools);
    tokens += estimateTextTokens(text);
    bytes += estimateTextBytes(text);
  }
  return { tokens, bytes };
}

function contextBlockText(block: ContextBlock): string {
  if (typeof block.content === "string") return block.content;
  return block.content
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text;
      return "[content]";
    })
    .join("\n");
}

/** The context block exactly as the assembler measures it (kernel `contextBlockMeasureText`). */
function contextBlockMeasureText(block: ContextBlock): string {
  return `${block.title ? `${block.title}:\n` : "Context:\n"}${contextBlockText(block)}`;
}

/** The tool list exactly as the assembler measures it (kernel `toolsMeasureText`). */
function toolsMeasureText(tools: readonly ToolDefinition[]): string {
  return `Available tools:\n${tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`).join("\n")}`;
}

/**
 * Measure once, then mutate oldest-first until back under `triggerRatio` (C4), or throw
 * `AttentionBudgetError` when every eligible row is exhausted (C9). The frozen prefix (the leading
 * system messages) is never touched, and neither are the caller's arrays.
 */
export async function compileAttention(options: AttentionCompileOptions): Promise<AttentionCompilation> {
  const { compiler } = options;
  const turn = options.turn ?? 1;
  const frontier = options.frontier;
  const runInputTokens = options.runInputTokens ?? 0;
  // One frozen state per evaluation: predicates never see a live object they could mutate, and
  // the axes are evaluated at most twice a turn (turn start, then after the stages).
  const triggerState = (estimatedInputTokens: number) => attentionTriggerState(compiler, { estimatedInputTokens, runInputTokens, turn });
  const usedAtStart = measureDraftCost({ messages: options.messages, context: options.context, tools: options.tools }).tokens;
  const decision = evaluateAttentionTrigger(compiler.trigger, triggerState(usedAtStart));
  const targetTokens = decision.targetTokens;
  const gateOpen = decision.shouldFold;
  let used = usedAtStart;
  // The gate is decided once per turn against the assembled estimate; the per-row loop then only
  // compares numbers, so a predicate axis costs one call, not one per eligible row. A target-less
  // axis (cumulative run budget, predicate) folds every eligible row.
  const needsMore = () => gateOpen && (targetTokens === undefined || used >= targetTokens);
  /** Post-stage verdict: a per-request axis still over its target, or a target-less axis whose
   *  predicate still fires, fails closed. A cumulative run-budget axis never does. */
  const stillFired = () =>
    targetTokens !== undefined
      ? used >= targetTokens
      : decision.failsClosed && evaluateAttentionTrigger(compiler.trigger, triggerState(Math.max(0, used))).shouldFold;

  const history = [...options.messages];
  let droppedThinkingTurns = 0;
  let stubbedToolResults = 0;
  let stubbedBytes = 0;
  let newFoldedBodies = 0;
  let leftEligible = 0;

  // Stage 1 — strip thinking from every assistant turn except the newest `thinkingKeepTurns`.
  const rowTurns = inferToolResultTurns(history);
  for (const index of thinkingTargetIndexes(history, compiler.thinkingKeepTurns)) {
    const message = history[index];
    if (!message) continue;
    const key = thinkingKey(message, options.redactor);
    const sticky = frontier?.thinking.has(key) === true;
    if (!sticky && !needsMore()) {
      leftEligible += 1;
      continue;
    }
    const stripped: Message = { ...message, content: message.content.filter((part) => part.type !== "thinking") };
    history[index] = stripped;
    used -= estimateMessageTokens(message) - estimateMessageTokens(stripped);
    droppedThinkingTurns += 1;
    rememberThinking(frontier, key);
  }

  // Stage 2 — stub the oldest tool results beyond the newest `keepLast` rows.
  for (const target of toolResultTargets({ history, rowTurns, turn, compiler, fold: options.fold })) {
    const sticky = frontier?.toolCallIds.has(target.toolCallId) === true;
    if (!sticky && !needsMore()) {
      leftEligible += 1;
      continue;
    }
    const folded = await foldedBody(target, options);
    const stubbed = stubToolResultMessage(target, folded.body);
    const before = estimateMessageTokens(target.message);
    const after = estimateMessageTokens(stubbed);
    if (after >= before && !sticky) {
      // The stub would cost more than the payload it replaces: leave the row alone.
      leftEligible += 1;
      continue;
    }
    if (!folded.cached && rememberFold(options.attentionFold, target.toolCallId, folded.body)) newFoldedBodies += 1;
    const beforeBytes = estimateMessageBytes(target.message);
    target.update(stubbed);
    used -= before - after;
    stubbedToolResults += 1;
    stubbedBytes += Math.max(0, beforeBytes - estimateMessageBytes(stubbed));
    rememberToolCall(frontier, target.toolCallId);
  }

  if (gateOpen && stillFired()) {
    const threshold = targetTokens === undefined ? String(decision.firedAxis) : Math.ceil(targetTokens);
    throw new AttentionBudgetError(
      `attention budget exceeded: estimated ${used} tokens >= ${threshold} (${gateDetail(compiler, decision)}) after dropping ${droppedThinkingTurns} thinking turns and stubbing ${stubbedToolResults} tool results`,
    );
  }

  const mutated = droppedThinkingTurns > 0 || stubbedToolResults > 0;
  return {
    messages: mutated ? history : options.messages,
    mutated,
    report: {
      used: usedAtStart,
      usedAfter: Math.max(0, used),
      inputCap: compiler.inputCap,
      triggerRatio: compiler.triggerRatio,
      ...(decision.firedAxis === undefined ? {} : { firedAxis: decision.firedAxis }),
      droppedThinkingTurns,
      stubbedToolResults,
      stubbedBytes,
      newFoldedBodies,
      truncated: leftEligible > 0,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    },
  };
}

/** Error detail for the fail-closed throw: the legacy wording for the plain `triggerRatio` axis,
 *  the axis name (and run budget, when one is in play) for every other axis. */
function gateDetail(compiler: AttentionCompiler, decision: AttentionTriggerDecision): string {
  if (decision.firedAxis === "input_ratio" && decision.targetTokens === compiler.triggerRatio * compiler.inputCap) {
    return `triggerRatio ${compiler.triggerRatio} of inputCap ${compiler.inputCap}`;
  }
  const budget = compiler.runInputBudget === undefined ? "" : ` with run input budget ${compiler.runInputBudget}`;
  return `${String(decision.firedAxis)} gate of inputCap ${compiler.inputCap}${budget}`;
}

/** Thinking-bearing assistant-message indexes, oldest first, excluding the newest `keepTurns`.
 *  Counts thinking turns, not assistant messages, so a thinking-free reply does not push an
 *  older reasoning block out of the keep window. */
function thinkingTargetIndexes(history: readonly Message[], keepTurns: number): number[] {
  const withThinking = history.flatMap((message, index) =>
    message.role === "assistant" && message.content.some((part) => part.type === "thinking") ? [index] : [],
  );
  return withThinking.slice(0, Math.max(0, withThinking.length - keepTurns));
}

/** Identity of one assistant turn's thinking, hashed so the frontier retains no model output. */
function thinkingKey(message: Message, redactor?: SecretRedactor): string {
  const text = message.content
    .flatMap((part) => (part.type === "thinking" ? [`${part.signature ?? ""}\u0000${part.text}`] : []))
    .join("\u0001");
  return digest(redactor?.redact(text) ?? text);
}

interface ToolResultTarget {
  /** The row as this turn received it; the compiler replaces the array slot, never the message. */
  readonly message: Message;
  readonly block: ToolResultContent;
  readonly toolCallId: string;
  readonly toolName: string;
  /** Turn the result belongs to; the host summarize receives it, and the age gate uses it. */
  readonly rowTurn: number;
  /** Writes the stubbed message back into the list this row came from. */
  readonly update: (message: Message) => void;
}

/** Rows beyond the newest `keepLast`, in oldest-first order, minus everything C6 protects. */
function toolResultTargets(options: {
  /** Mutable clone owned by this turn: `update` writes the stub into the caller's copy. */
  readonly history: Message[];
  readonly rowTurns: readonly number[];
  readonly turn: number;
  readonly compiler: AttentionCompiler;
  readonly fold?: ResolvedToolResultFoldOptions;
}): ToolResultTarget[] {
  const rows: ToolResultTarget[] = [];
  const add = (message: Message, rowTurn: number, update: (next: Message) => void) => {
    const block = toolResultBlock(message);
    if (!block) return;
    rows.push({ message, block, toolCallId: block.toolCallId, toolName: block.name, rowTurn, update });
  };
  for (let index = 0; index < options.history.length; index += 1) {
    const message = options.history[index];
    if (message) add(message, options.rowTurns[index] ?? options.turn, (next) => void (options.history[index] = next));
  }

  const excluded = new Set(options.compiler.excludeTools);
  const keepFrom = Math.max(0, rows.length - options.compiler.keepLast);
  return rows.slice(0, keepFrom).filter((target) => {
    const { block, message } = target;
    if (block.error !== undefined && block.error !== null) return false;
    if (excluded.has(target.toolName)) return false;
    if (isProtectedToolResult(message.metadata)) return false;
    const fold = options.fold;
    if (!fold) return true;
    if (options.turn - target.rowTurn < fold.minAgeTurns) return false;
    return estimateTextBytes(toolResultFoldText(block.result, block.error, message.content)) >= fold.minBytes;
  });
}

/** The stub body for one row: the ledger's copy when it has one, the host `summarize` otherwise.
 *  `cached` is the turn's summarize saving — a miss is the only case that costs a host call, and
 *  the only case that has new fold state to persist. */
async function foldedBody(
  target: ToolResultTarget,
  options: AttentionCompileOptions,
): Promise<{ readonly body: string; readonly cached: boolean }> {
  const cached = options.attentionFold?.bodies.get(target.toolCallId);
  if (cached !== undefined) return { body: cached, cached: true };
  const { block, message } = target;
  const text = toolResultFoldText(block.result, block.error, message.content);
  const fold = options.fold;
  const body = fold
    ? capToolResultSummary(
        String(
          await fold.summarize({
            sessionId: options.sessionId ?? "",
            runId: options.runId ?? "",
            turn: target.rowTurn,
            toolCallId: target.toolCallId,
            toolName: target.toolName,
            text,
          }),
        ),
        fold.maxSummaryBytes,
      )
    : attentionStubText(options.redactor?.redact(text) ?? text);
  return { body, cached: false };
}

function stubToolResultMessage(target: ToolResultTarget, body: string): Message {
  const { message } = target;
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool_result" ? { ...part, result: foldedToolResultHeader(target.toolName, target.toolCallId, body) } : part,
    ),
    metadata: { ...message.metadata, prismFolded: true },
  };
}

/** Deterministic default stub (C5): byte count plus a digest of the already-redacted text, so
 *  the model keeps a stable placeholder and never sees the payload again. */
function attentionStubText(redactedText: string): string {
  return `omitted ${estimateTextBytes(redactedText)} bytes (sha256 ${digest(redactedText)})`;
}

function toolResultBlock(message: Message) {
  const block = message.content.find((part) => part.type === "tool_result");
  return block?.type === "tool_result" ? block : undefined;
}

function isProtectedToolResult(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!metadata) return false;
  return PROTECTED_TOOL_RESULT_METADATA_KEYS.some((key) => metadata[key] !== undefined);
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, THINKING_KEY_BYTES);
}

/* ------------------------------------------------------------------------------------------------
 * Sticky frontier + fold ledger. The kernel serialized these into the durable run state; the
 * package keeps them in the session's own package state (`state.session`), so a reopened session
 * restores the same frontier and re-applies the same bodies.
 * ------------------------------------------------------------------------------------------------ */

const MAX_ATTENTION_THINKING_KEYS = 256;
const MAX_ATTENTION_TOOL_CALL_IDS = 256;
const MAX_ATTENTION_TOOL_CALL_ID_CHARS = 256;
const ATTENTION_STICKY_SCHEMA_VERSION = 1 as const;

export interface PersistedAttentionStickyFrontier {
  readonly v: 1;
  /** Newest-last, so a restored frontier is the tail of the mutations the session made. */
  readonly thinking: readonly string[];
  readonly toolCallIds: readonly string[];
}

/** Keep the newest `max` keys: a session that runs long enough to overflow the cap should
 *  re-apply its recent mutations, not its oldest. */
function trimNewest(set: Set<string>, max: number): string[] {
  while (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  return [...set];
}

/** Record one mutation, keeping the live frontier inside its cap. The evicted key is the
 *  oldest one, whose row has almost certainly left the input window; if it ever comes back the
 *  compiler re-decides (and the deterministic stub re-applies byte-identically when over). */
function rememberThinking(frontier: AttentionStickyFrontier | undefined, key: string): void {
  if (!frontier) return;
  frontier.thinking.add(key);
  trimNewest(frontier.thinking, MAX_ATTENTION_THINKING_KEYS);
}

function rememberToolCall(frontier: AttentionStickyFrontier | undefined, toolCallId: string): void {
  if (!frontier) return;
  frontier.toolCallIds.add(toolCallId);
  trimNewest(frontier.toolCallIds, MAX_ATTENTION_TOOL_CALL_IDS);
}

/** Bounded snapshot of a live frontier; caller-owned (the session state persists it, the compiler
 *  never writes anywhere). */
export function serializeAttentionStickyFrontier(frontier: AttentionStickyFrontier): PersistedAttentionStickyFrontier {
  return {
    v: ATTENTION_STICKY_SCHEMA_VERSION,
    thinking: trimNewest(frontier.thinking, MAX_ATTENTION_THINKING_KEYS),
    toolCallIds: trimNewest(frontier.toolCallIds, MAX_ATTENTION_TOOL_CALL_IDS),
  };
}

const THINKING_KEY_PATTERN = /^[0-9a-f]{32}$/;

/** Validate a persisted frontier from an untrusted store (plan 074 P3). Malformed *entries* are
 *  dropped one by one — a key the compiler cannot trust simply re-decides on the next turn —
 *  while a malformed *shape* yields `undefined` so the caller starts from an empty frontier.
 *  Never throws: a resume must not fail because a hand-edited record was stored. */
export function parseAttentionStickyFrontier(value: unknown): PersistedAttentionStickyFrontier | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as { thinking?: unknown; toolCallIds?: unknown };
  if (!Array.isArray(record.thinking) || !Array.isArray(record.toolCallIds)) return undefined;
  const thinking = record.thinking.filter((key): key is string => typeof key === "string" && THINKING_KEY_PATTERN.test(key));
  const toolCallIds = record.toolCallIds.filter(
    (id): id is string =>
      typeof id === "string" && id.length > 0 && id.length <= MAX_ATTENTION_TOOL_CALL_ID_CHARS && !id.includes("\u0000"),
  );
  return {
    v: ATTENTION_STICKY_SCHEMA_VERSION,
    // The tail is the newest window; a long-lived record cannot grow past the live caps.
    thinking: thinking.slice(-MAX_ATTENTION_THINKING_KEYS),
    toolCallIds: toolCallIds.slice(-MAX_ATTENTION_TOOL_CALL_IDS),
  };
}

/** Rebuild a frontier from a restored snapshot; callers hold the session that owns it. */
export function restoreAttentionStickyFrontier(persisted: PersistedAttentionStickyFrontier): AttentionStickyFrontier {
  const frontier = createAttentionStickyFrontier();
  for (const key of persisted.thinking) frontier.thinking.add(key);
  for (const id of persisted.toolCallIds) frontier.toolCallIds.add(id);
  return frontier;
}

export interface AttentionFoldLedger {
  /** toolCallId → stub body (never the payload); insertion order is fold order, oldest first. */
  readonly bodies: Map<string, string>;
}

export function createAttentionFoldLedger(): AttentionFoldLedger {
  return { bodies: new Map<string, string>() };
}

/** Live and persisted ledger caps. One body is bounded by the fold's own `maxSummaryBytes`
 *  (hard cap 4 KiB), so the entry count is what bounds the record. */
const MAX_ATTENTION_FOLD_BODIES = 64;
const ATTENTION_FOLD_SCHEMA_VERSION = 1 as const;

/** Keep the newest `max` entries: a session that folds more rows than the cap keeps the recent
 *  bodies and re-summarizes the oldest if their rows are ever folded again. */
function trimOldest(bodies: Map<string, string>, max: number): void {
  while (bodies.size > max) {
    const oldest = bodies.keys().next().value;
    if (oldest === undefined) break;
    bodies.delete(oldest);
  }
}

/** Record one folded body, keeping the live ledger inside its caps. Returns `false` for a body
 *  too large to be worth a store byte (the fold's own cap makes this host-only in practice). */
function rememberFold(ledger: AttentionFoldLedger | undefined, toolCallId: string, body: string): boolean {
  if (!ledger || estimateTextBytes(body) > HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES) return false;
  ledger.bodies.delete(toolCallId);
  ledger.bodies.set(toolCallId, body);
  trimOldest(ledger.bodies, MAX_ATTENTION_FOLD_BODIES);
  return true;
}

/** Serialized fold ledger (plan 086 T3). Stub bodies only — no payload, and every entry was
 *  already capped and redacted when it was folded, so a restore re-applies it verbatim. */
export interface PersistedAttentionFoldLedger {
  readonly v: 1;
  /** Oldest-first, so a restored ledger is the tail of the folds the session made. */
  readonly bodies: readonly { readonly id: string; readonly body: string }[];
}

/** Bounded snapshot of a live ledger; caller-owned. */
export function serializeAttentionFoldLedger(ledger: AttentionFoldLedger): PersistedAttentionFoldLedger {
  return {
    v: ATTENTION_FOLD_SCHEMA_VERSION,
    bodies: [...ledger.bodies].slice(-MAX_ATTENTION_FOLD_BODIES).map(([id, body]) => ({ id, body })),
  };
}

/** Validate a persisted ledger from an untrusted store (plan 086 T3). Malformed *entries* are
 *  dropped one by one — a body the compiler cannot trust simply re-summarizes on the next turn —
 *  while a malformed *shape* yields `undefined` so the caller starts from an empty ledger.
 *  Never throws: a resume must not fail because a hand-edited record was stored. */
export function restoreAttentionFoldLedger(value: unknown): AttentionFoldLedger | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const bodies = (value as { bodies?: unknown }).bodies;
  if (!Array.isArray(bodies)) return undefined;
  const ledger = createAttentionFoldLedger();
  for (const entry of bodies) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, body } = entry as { id?: unknown; body?: unknown };
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ATTENTION_TOOL_CALL_ID_CHARS || id.includes("\u0000")) continue;
    if (typeof body !== "string" || body.length === 0 || estimateTextBytes(body) > HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES) continue;
    ledger.bodies.delete(id);
    ledger.bodies.set(id, body);
  }
  trimOldest(ledger.bodies, MAX_ATTENTION_FOLD_BODIES);
  return ledger;
}

/* ------------------------------------------------------------------------------------------------
 * Truncation follow-up policy (plan 074 P4). Exported for hosts that wire it themselves; the
 * package's own `compaction.when` handler evaluates `compactRatio` instead.
 * ------------------------------------------------------------------------------------------------ */

/** Consecutive `truncated` turns that arm compaction by default. */
export const DEFAULT_ATTENTION_TRUNCATION_THRESHOLD = 2;

export interface AttentionTruncationTriggerOptions {
  /** Truncated turns in a row before the trigger fires (default 2). */
  readonly threshold?: number;
}

/**
 * Host-side follow-up policy for `truncated` turns (plan 074 P4). `truncated: true` means the
 * gate ran out of *eligible* rows: stubs cannot hold the request under the ratio, so the honest
 * answer is a new prefix at the next task boundary rather than a silent eviction.
 *
 * Wire it by feeding every `attention.compiled` event to `observe` and handing `trigger` to a
 * `compaction.when` handler. It fires **once per armed streak**, so a branch is compacted once and
 * then left alone until new truncated turns arrive; a mutated turn that was not truncated clears
 * the streak because the pressure was relieved.
 */
export interface AttentionTruncationTrigger {
  /** Feed an `attention.compiled` event or an `AttentionReport`; returns the resulting streak. */
  observe(report: { readonly truncated?: unknown }): number;
  /** Truncated turns in a row since the last fire or relief. */
  readonly streak: () => number;
  /** `true` once the streak reaches the threshold, resetting it. */
  readonly shouldCompact: () => boolean;
  /** Clear the streak (host compacted for its own reasons). */
  reset(): void;
}

export function createAttentionTruncationTrigger(options: AttentionTruncationTriggerOptions = {}): AttentionTruncationTrigger {
  const threshold = options.threshold ?? DEFAULT_ATTENTION_TRUNCATION_THRESHOLD;
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new TypeError("attention truncation threshold must be a positive safe integer");
  }
  let streak = 0;
  return {
    observe: (report) => {
      streak = report.truncated === true ? streak + 1 : 0;
      return streak;
    },
    streak: () => streak,
    shouldCompact: () => {
      if (streak < threshold) return false;
      streak = 0;
      return true;
    },
    reset: () => {
      streak = 0;
    },
  };
}
