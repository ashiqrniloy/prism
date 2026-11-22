import { isJsonObject } from "./config.js";
import type {
  AgentEvent,
  ErrorInfo,
  JsonObject,
  OwnershipScope,
  RunLedger,
  ToolCallContent,
  ToolCallRecord,
  ToolCallStatus,
  ToolCapabilityKind,
  ToolDefinition,
  ToolEffectDeclaration,
  ToolEffectKey,
  ToolEffectStore,
  ToolExecutionContext,
  ToolExecutionMetadata,
  ToolRegistry,
  ToolResult,
} from "./contracts.js";
import { createId } from "./ids.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets, type SecretRedactor } from "./redaction.js";
import { assertCanRegister, type DuplicateRegistrationOptions } from "./registry-options.js";
import type { RunLimitTracker } from "./run-limits.js";
import { compileToolSchema } from "./packages/schema.js";
import { assertTrusted, type TrustPolicy } from "./security.js";
import { deriveToolEffectKey, ToolEffectError, toolEffectArgumentsHash } from "./tool-effects.js";

export interface ToolFilter {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export type ToolFilterInput = ToolFilter | readonly ToolFilter[];
export type ToolValidator = (
  tool: ToolDefinition,
  args: JsonObject,
  context: ToolExecutionContext,
) => undefined | string | ErrorInfo | Promise<undefined | string | ErrorInfo>;

export type ToolArgumentValidation = "schema" | "off";

export interface ToolArgumentValidationError {
  readonly path?: string;
  readonly message: string;
}

export interface ToolArgumentValidationResult {
  readonly ok: boolean;
  readonly errors?: readonly ToolArgumentValidationError[];
}

export interface ToolArgumentValidator {
  validate(schema: JsonObject, value: unknown): ToolArgumentValidationResult;
}

export interface ToolParameterValidatorOptions {
  /** When a tool omits `parameters`. Default `"allow"` preserves pre-validation behavior. */
  readonly missingSchema?: "allow" | "reject";
}

/** Wrap a schema adapter as the existing `ToolValidator` seam used by dispatch and the agent runtime. */
export function createToolParameterValidator(validator: ToolArgumentValidator, options: ToolParameterValidatorOptions = {}): ToolValidator {
  const missingSchema = options.missingSchema ?? "allow";
  return (tool, args) => {
    if (!tool.parameters) {
      if (missingSchema === "reject") return `Tool ${tool.name} has no parameters schema`;
      return undefined;
    }
    const result = validator.validate(tool.parameters, args);
    if (result.ok) return undefined;
    return formatToolArgumentValidationErrors(tool.name, result.errors);
  };
}

const MAX_ARGUMENT_ERROR_CHARS = 1024;

/**
 * The built-in argument check: `tool.parameters` in tolerant mode (see `compileToolSchema`). Returns
 * the failing paths with what each expected, never argument values, or `undefined` when the call may
 * run. A tool with no `parameters`, or with `validateArguments: false`, accepts any JSON object.
 */
export function checkToolArguments(tool: ToolDefinition, args: JsonObject): string | undefined {
  if (!tool.parameters || tool.validateArguments === false) return undefined;
  const errors = compileToolSchema(tool.parameters).validate(args);
  if (errors.length === 0) return undefined;
  const message = errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  return message.length > MAX_ARGUMENT_ERROR_CHARS ? `${message.slice(0, MAX_ARGUMENT_ERROR_CHARS - 1)}…` : message;
}

function formatToolArgumentValidationErrors(toolName: string, errors?: readonly ToolArgumentValidationError[]): string {
  if (!errors?.length) return `Tool arguments failed validation: ${toolName}`;
  return errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join("; ");
}

export interface DispatchToolCallOptions {
  readonly call: ToolCallContent;
  readonly registry: ToolRegistry;
  readonly context: ToolExecutionContext;
  readonly filter?: ToolFilterInput;
  readonly validate?: ToolValidator;
  /**
   * Built-in argument check against `tool.parameters` (default `"schema"`). It runs before `validate`;
   * `"off"` skips it. A tool can opt out alone with `ToolDefinition.validateArguments: false`.
   */
  readonly validation?: ToolArgumentValidation;
  /** Adapter-specific policy check immediately before the tool side effect. */
  readonly beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
  readonly secrets?: readonly (string | undefined)[];
  readonly trust?: TrustPolicy;
  readonly redactor?: SecretRedactor;
  readonly ledger?: RunLedger;
  /** Optional shared recovery store. Only declared optional/required effects use it. */
  readonly effectStore?: ToolEffectStore;
  readonly ownership?: OwnershipScope;
  /** Opaque host principal, passed through unchanged. */
  readonly principal?: import("./contracts-core/principal.js").Principal;
  /** Shared run tracker; direct hosts may supply one for their call scope. */
  readonly limitTracker?: RunLimitTracker;
}

export interface ToolRegistryOptions extends DuplicateRegistrationOptions {}

/** Every capability kind, used as the fail-closed default for a tool that declares no `effects`. */
const ALL_TOOL_CAPABILITY_KINDS: readonly ToolCapabilityKind[] = Object.freeze([
  "read",
  "write",
  "execute",
  "network",
  "external",
] as const);

const TOOL_CAPABILITY_KIND_SET: ReadonlySet<string> = new Set(ALL_TOOL_CAPABILITY_KINDS);

export class ToolDefinitionError extends Error {
  constructor(
    readonly code: "ERR_PRISM_TOOL_EFFECTS",
    message: string,
  ) {
    super(message);
    this.name = "ToolDefinitionError";
  }
}

function assertToolEffects(tool: ToolDefinition): void {
  const effects = tool.effects;
  if (effects === undefined) return;
  if (!Array.isArray(effects)) {
    throw new ToolDefinitionError("ERR_PRISM_TOOL_EFFECTS", `Tool ${tool.name} effects must be an array of capability kinds`);
  }
  const seen = new Set<string>();
  for (const kind of effects) {
    if (typeof kind !== "string" || !TOOL_CAPABILITY_KIND_SET.has(kind)) {
      throw new ToolDefinitionError("ERR_PRISM_TOOL_EFFECTS", `Tool ${tool.name} has unknown capability kind ${JSON.stringify(kind)}`);
    }
    if (seen.has(kind)) {
      throw new ToolDefinitionError("ERR_PRISM_TOOL_EFFECTS", `Tool ${tool.name} repeats capability kind ${kind}`);
    }
    seen.add(kind);
  }
}

function assertToolTimeout(tool: ToolDefinition): void {
  const timeout = tool.timeoutMs;
  if (timeout === undefined) return;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new TypeError(`Tool ${tool.name} timeoutMs must be a positive safe integer`);
}

/**
 * Capabilities reported to `tool.call` hooks. A tool with no `effects` resolves to all kinds, so a
 * missing annotation never widens what an effects-based policy allows.
 */
export function resolveToolEffects(tool: ToolDefinition): readonly ToolCapabilityKind[] {
  return tool.effects ?? ALL_TOOL_CAPABILITY_KINDS;
}

export function createToolRegistry(tools: readonly ToolDefinition[] = [], options: ToolRegistryOptions = {}): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    register(tool) {
      assertCanRegister(byName, tool.name, "tool", tool.name, options.duplicate);
      assertToolEffects(tool);
      assertToolTimeout(tool);
      byName.set(tool.name, tool);
    },
    get(name) {
      return byName.get(name);
    },
    resolve(name) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool;
    },
    list() {
      return [...byName.values()];
    },
    unregister(name) {
      return byName.delete(name);
    },
  };

  for (const tool of tools) registry.register(tool);
  return registry;
}

export function filterTools(tools: readonly ToolDefinition[], filter?: ToolFilterInput): readonly ToolDefinition[] {
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  const denied = new Set(filters.flatMap((item) => item.deny ?? []));
  const allows = filters
    .map((item) => (item.allow?.length ? new Set(item.allow) : undefined))
    .filter((item): item is Set<string> => Boolean(item));

  return tools.filter((tool) => !denied.has(tool.name) && allows.every((allow) => allow.has(tool.name)));
}

/** Run allow-lists never exceed the disclosed set. */
export const HARD_RUN_TOOL_NAMES = 1024;
const MAX_RUN_TOOL_NAME_CHARS = 256;

function assertRunToolNames(names: readonly string[], label = "RunOptions.toolNames"): readonly string[] {
  if (names.length > HARD_RUN_TOOL_NAMES) {
    throw new TypeError(`${label} exceeds ${HARD_RUN_TOOL_NAMES} entries`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0 || name.length > MAX_RUN_TOOL_NAME_CHARS) {
      throw new TypeError(`${label} entries must be non-empty strings of at most ${MAX_RUN_TOOL_NAME_CHARS} characters`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Restrictive clamp: keep listed order; names outside the grant are dropped (not thrown). */
export function clampTurnToolNames(
  listed: readonly ToolDefinition[],
  requested: readonly string[],
): { readonly tools: readonly ToolDefinition[]; readonly dropped: readonly string[] } {
  const names = assertRunToolNames(requested, "RunOptions.tools");
  const grant = new Set(listed.map((tool) => tool.name));
  const dropped = names.filter((name) => !grant.has(name));
  const allow = names.filter((name) => grant.has(name));
  return { tools: allow.length === 0 ? [] : filterTools(listed, { allow }), dropped };
}

/**
 * Per-run allow-list. Omitted grant → unchanged list. Checkpointed grant cannot widen.
 * Fresh unknown names fail closed; resume drops names the current registry no longer has.
 */
/** Default number of calls of one round that run at once (`AgentConfig.tools.concurrency`). */
const DEFAULT_TOOL_CONCURRENCY = 4;
/** Shipped `ceilings.toolConcurrency`: the most calls of one round that run at once. */
export const MAX_TOOL_CONCURRENCY = 16;

/**
 * Resolve a round's concurrency: the agent value (default 4), narrowed by the run value. Each is at most
 * `max`, the agent's `ceilings.toolConcurrency`.
 */
export function resolveToolConcurrency(agent: number | undefined, run: number | undefined, max = MAX_TOOL_CONCURRENCY): number {
  for (const [label, value] of [
    ["tools.concurrency", agent],
    ["RunOptions.tools.concurrency", run],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) {
      throw new TypeError(`${label} must be an integer from 1 to ${max}`);
    }
  }
  const base = agent ?? DEFAULT_TOOL_CONCURRENCY;
  return run === undefined ? base : Math.min(base, run);
}

export function selectRunTools(
  listed: readonly ToolDefinition[],
  requested: readonly string[] | undefined,
  checkpoint?: readonly string[],
): { readonly tools: readonly ToolDefinition[]; readonly grant: readonly string[] | undefined } {
  const req = requested === undefined ? undefined : assertRunToolNames(requested);
  const grant = checkpoint === undefined ? req : req === undefined ? checkpoint : req.filter((name) => checkpoint.includes(name));
  if (grant === undefined) return { tools: listed, grant };
  if (grant.length === 0) return { tools: [], grant };
  const available = new Set(listed.map((tool) => tool.name));
  if (checkpoint === undefined) {
    for (const name of grant) {
      if (!available.has(name)) throw new TypeError(`Unknown run tool: ${name}`);
    }
    return { tools: filterTools(listed, { allow: grant }), grant };
  }
  return { tools: filterTools(listed, { allow: grant.filter((name) => available.has(name)) }), grant };
}

function toolExecutionMetadata(startedAt: string, status: ToolCallStatus): ToolExecutionMetadata {
  return { durationMs: Math.max(0, Date.now() - Date.parse(startedAt)), status };
}

/** `tool_aborted` / `tool_timeout`: how a call ends when the race in `executeInterruptibly` is lost. */
class ToolInterruptedError extends Error {
  constructor(
    readonly code: "tool_aborted" | "tool_timeout",
    message: string,
  ) {
    super(message);
    this.name = "ToolInterruptedError";
  }
}

/**
 * Per-call signal and lifetime. The signal is the run signal combined with a controller only dispatch
 * can abort, so a tool cannot extend its own deadline. After `close()` a detached tool's `progress`
 * calls are dropped, so a late tool emits nothing.
 */
class ToolCallScope {
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  closed = false;

  constructor(parent: AbortSignal | undefined) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  close(): void {
    this.closed = true;
  }
}

function effectiveToolTimeoutMs(tool: ToolDefinition, options: DispatchToolCallOptions): number | undefined {
  const own = tool.timeoutMs;
  const run = options.limitTracker?.limits.maxToolTimeMs ?? undefined;
  if (own === undefined) return run;
  return run === undefined ? own : Math.min(own, run);
}

/**
 * Run `execute` and settle with the first of: its outcome, the call's signal aborting, or the timeout.
 * The tool's promise is detached when it loses: a late result is dropped and a late rejection swallowed.
 * No timer is armed without a timeout.
 */
function executeInterruptibly(
  tool: ToolDefinition,
  call: ToolCallContent,
  context: ToolExecutionContext,
  scope: ToolCallScope,
  timeoutMs: number | undefined,
): Promise<ToolResult> {
  const signal = scope.signal;
  if (signal.aborted) return Promise.reject(new ToolInterruptedError("tool_aborted", "Tool call aborted"));
  return new Promise<ToolResult>((resolve, reject) => {
    let running: Promise<ToolResult> | ToolResult;
    try {
      running = tool.execute(call.arguments, context);
    } catch (error) {
      reject(error);
      return;
    }
    // A result already in hand (a synchronous tool) is the call's outcome, even if the tool aborted the run on its way out.
    if (typeof (running as { then?: unknown } | null)?.then !== "function") {
      resolve(running as ToolResult);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => finish(() => reject(new ToolInterruptedError("tool_aborted", "Tool call aborted")));
    const finish = (settle: () => void): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    // Handlers go on first: a promise that loses the race must still have its late rejection handled.
    (running as Promise<ToolResult>).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        // Settle first, then abort, so a cooperative tool's own abort handling cannot turn this into `tool_aborted`.
        finish(() => reject(new ToolInterruptedError("tool_timeout", `Tool call timed out after ${timeoutMs} ms`)));
        scope.abort();
      }, timeoutMs);
    }
  });
}

export async function dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult> {
  const scope = new ToolCallScope(options.context.signal);
  try {
    return await dispatchToolCallInScope(options, scope);
  } finally {
    scope.close();
  }
}

async function dispatchToolCallInScope(options: DispatchToolCallOptions, scope: ToolCallScope): Promise<ToolResult> {
  const secrets = options.secrets ?? [];
  const startedAt = new Date().toISOString();
  options.limitTracker?.charge("maxToolCalls");
  const mediatedCall = options.call;
  const tool = options.registry.get(mediatedCall.name);
  const postcheck = await checkCall(mediatedCall, options, startedAt);
  if (postcheck) return postcheck;

  const { idempotencyKey: _untrustedKey, ...baseContext } = options.context;
  let context: ToolExecutionContext = {
    ...baseContext,
    toolCallId: mediatedCall.id,
    signal: scope.signal,
    principal: options.principal ?? options.context.principal,
    progress: async (progress, metadata) => {
      if (scope.closed) return;
      await options.context.progress?.(progress, metadata);
      await options.emit?.({
        type: "tool.progress",
        sessionId: options.context.sessionId,
        runId: options.context.runId,
        toolCallId: mediatedCall.id,
        name: mediatedCall.name,
        progress,
        metadata,
      });
      await appendToolCallRecord(options, "started", mediatedCall, startedAt, {
        progress,
        progressMetadata: metadata,
        progressAt: new Date().toISOString(),
      });
    },
  };

  try {
    await assertTrusted(options.trust, {
      kind: "tool",
      target: mediatedCall.name,
      capability: "execute",
      metadata: options.context.metadata,
    });
  } catch (error) {
    return blocked(mediatedCall, context, "permission_denied", errorToErrorInfo(error, secrets), options, startedAt);
  }

  if (options.validation !== "off") {
    const invalid = checkToolArguments(tool!, mediatedCall.arguments);
    if (invalid)
      return blocked(mediatedCall, context, "invalid_arguments", { code: "invalid_arguments", message: invalid }, options, startedAt);
  }
  const validation = await options.validate?.(tool!, mediatedCall.arguments, context);
  if (validation) return blocked(mediatedCall, context, "validation_failed", toErrorInfo(validation, secrets), options, startedAt);

  let effect: ClaimedToolEffect | undefined;
  try {
    const prepared = await prepareToolEffect(tool!, mediatedCall, context, options);
    if (prepared.result) return prepared.result;
    context = prepared.context;
    effect = prepared.effect;
  } catch (error) {
    return blocked(mediatedCall, context, "execution_denied", errorToErrorInfo(error, secrets), options, startedAt);
  }

  try {
    await options.beforeExecute?.(mediatedCall, tool!, context);
  } catch (error) {
    await failBeforeEffect(effect, isSuspended(error) ? "failed_retryable" : "failed_terminal");
    // Loop-state contract errors (snapshot capture) are terminal run errors, not tool errors.
    if (isSuspended(error) || isLoopStateError(error) || isDelegationSuspended(error)) throw error;
    return blocked(mediatedCall, context, "execution_denied", errorToErrorInfo(error, secrets), options, startedAt);
  }

  let completedResult: ToolResult | undefined;
  let dispatchAttempted = false;
  try {
    await options.emit?.({ type: "tool.started", sessionId: context.sessionId, runId: context.runId, call: mediatedCall });
    await appendToolCallRecord(options, "started", mediatedCall, startedAt, {});
    // An already-aborted call never reaches the effect store's `dispatched` mark, so it stays retryable.
    if (scope.signal.aborted) throw new ToolInterruptedError("tool_aborted", "Tool call aborted");
    if (effect) {
      dispatchAttempted = true;
      const record = await effect.store.markDispatched(transition(effect));
      effect.expectedVersion = record.version;
      effect.dispatched = true;
    }
    const raw = await executeInterruptibly(tool!, mediatedCall, context, scope, effectiveToolTimeoutMs(tool!, options));
    const mediatedResult = raw;
    if (effect && mediatedResult.error) return finishUnknownEffect(effect, mediatedCall, context, options, startedAt);
    const result = options.redactor?.redact(mediatedResult) ?? mediatedResult;
    if (effect) {
      try {
        const record = await effect.store.complete({ ...transition(effect), result });
        effect.expectedVersion = record.version;
        effect.completed = true;
        completedResult = record.result ?? result;
      } catch {
        return finishUnknownEffect(effect, mediatedCall, context, options, startedAt);
      }
    }
    completedResult ??= result;
    const finishedAt = new Date().toISOString();
    const metadata = toolExecutionMetadata(startedAt, "finished");
    await options.emit?.({
      type: "tool.completed",
      sessionId: context.sessionId,
      runId: context.runId,
      toolCallId: mediatedCall.id,
      name: mediatedCall.name,
      result: completedResult,
      metadata,
      status: "finished",
    });
    await appendToolCallRecord(options, "finished", mediatedCall, startedAt, { finishedAt, result: completedResult });
    return completedResult;
  } catch (error) {
    if (completedResult) return completedResult;
    // Nested-run suspensions must propagate to the run loop, never become tool errors.
    if (isDelegationSuspended(error)) {
      if (effect && (effect.dispatched || dispatchAttempted)) await unknownEffectResult(effect, mediatedCall);
      else await failBeforeEffect(effect, "failed_retryable");
      throw error;
    }
    if (effect && (effect.dispatched || dispatchAttempted)) return finishUnknownEffect(effect, mediatedCall, context, options, startedAt);
    await failBeforeEffect(effect, error instanceof ToolInterruptedError ? "failed_retryable" : "failed_terminal");
    const info: ErrorInfo =
      error instanceof ToolInterruptedError
        ? { name: error.name, code: error.code, message: error.message }
        : errorToErrorInfo(error, secrets);
    const result = { toolCallId: mediatedCall.id, name: mediatedCall.name, error: info };
    const finishedAt = new Date().toISOString();
    const metadata = toolExecutionMetadata(startedAt, "error");
    await options.emit?.({
      type: "tool.completed",
      sessionId: context.sessionId,
      runId: context.runId,
      toolCallId: mediatedCall.id,
      name: mediatedCall.name,
      result,
      metadata,
      status: "error",
      error: info,
    });
    await appendToolCallRecord(options, "error", mediatedCall, startedAt, { finishedAt, result });
    return result;
  }
}

interface ClaimedToolEffect {
  readonly store: ToolEffectStore;
  readonly key: ToolEffectKey;
  readonly claimToken: string;
  expectedVersion: number;
  dispatched: boolean;
  completed: boolean;
}

type PreparedToolEffect =
  | { readonly context: ToolExecutionContext; readonly effect?: ClaimedToolEffect; readonly result?: undefined }
  | { readonly context: ToolExecutionContext; readonly result: ToolResult };

async function prepareToolEffect(
  tool: ToolDefinition,
  call: ToolCallContent,
  context: ToolExecutionContext,
  options: DispatchToolCallOptions,
): Promise<PreparedToolEffect> {
  const ownership = options.ownership;
  const declaration = resolveToolEffectDeclaration(tool, call.arguments, context);
  if (!declaration || declaration.kind === "none" || declaration.idempotency === "none") return { context };
  if (!ownership && declaration.idempotency === "unsupported") return { context };
  if (!ownership) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "ownership is required for a durable tool effect");
  const argumentsHash = toolEffectArgumentsHash(call.arguments);
  const base = {
    ownership,
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: call.id,
    toolName: call.name,
    argumentsHash,
  };
  const key: ToolEffectKey = { ...base, key: deriveToolEffectKey(base), signal: context.signal };
  const keyedContext = { ...context, idempotencyKey: key.key };
  if (declaration.idempotency === "tool_managed" || declaration.idempotency === "unsupported") return { context: keyedContext };
  const store = options.effectStore;
  if (!store) {
    if (declaration.idempotency === "required")
      throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_REQUIRED", "durable tool effect store is required");
    return { context: keyedContext };
  }
  let begun: Awaited<ReturnType<ToolEffectStore["begin"]>>;
  try {
    begun = await store.begin(key);
  } catch (error) {
    if (error instanceof ToolEffectError) throw error;
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_UNKNOWN", "tool effect claim outcome is unknown");
  }
  if (begun.outcome === "existing") return { context: keyedContext, result: replayEffectResult(begun.record) };
  if (!begun.record.claimToken) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_UNKNOWN", "tool effect claim outcome is unknown");
  return {
    context: keyedContext,
    effect: {
      store,
      key,
      claimToken: begun.record.claimToken,
      expectedVersion: begun.record.version,
      dispatched: false,
      completed: false,
    },
  };
}

export function resolveToolEffectDeclaration(
  tool: ToolDefinition,
  args: JsonObject,
  context: ToolExecutionContext,
): ToolEffectDeclaration | undefined {
  const classifierContext: ToolExecutionContext = Object.freeze({
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    signal: context.signal,
    metadata: context.metadata,
  });
  const declaration = typeof tool.effect === "function" ? tool.effect(args, classifierContext) : tool.effect;
  if (!declaration) return undefined;
  if (
    !["none", "local_mutation", "external_mutation"].includes(declaration.kind) ||
    !["none", "optional", "required", "tool_managed", "unsupported"].includes(declaration.idempotency) ||
    (declaration.kind === "none" && declaration.idempotency !== "none")
  ) {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_LIMIT", "tool effect declaration is invalid");
  }
  return declaration;
}

function replayEffectResult(record: import("./contracts.js").ToolEffectRecord): ToolResult {
  if (record.status === "completed") {
    if (record.result) return record.result;
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_COMPLETED", "tool effect already completed without replayable result");
  }
  if (record.status === "dispatched" || record.status === "unknown") {
    throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_UNKNOWN", "tool effect outcome requires reconciliation");
  }
  throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "tool effect is not dispatchable");
}

function transition(effect: ClaimedToolEffect): ToolEffectKey & { readonly claimToken: string; readonly expectedVersion: number } {
  return { ...effect.key, claimToken: effect.claimToken, expectedVersion: effect.expectedVersion };
}

async function failBeforeEffect(effect: ClaimedToolEffect | undefined, status: "failed_retryable" | "failed_terminal"): Promise<void> {
  if (!effect || effect.dispatched || effect.completed) return;
  try {
    await effect.store.fail({
      ...transition(effect),
      status,
      failure: { code: "ERR_PRISM_TOOL_EFFECT_PRE_DISPATCH" },
    });
  } catch {
    // No effect was invoked. A stale/failed pre-dispatch transition only delays a later safe retry.
  }
}

async function unknownEffectResult(effect: ClaimedToolEffect, call: ToolCallContent): Promise<ToolResult> {
  try {
    let claim: { readonly claimToken: string; readonly version: number } | undefined = effect.dispatched
      ? { claimToken: effect.claimToken, version: effect.expectedVersion }
      : undefined;
    if (!claim) {
      const current = await effect.store.get(effect.key);
      if (current?.status === "dispatched" && current.claimToken) claim = { claimToken: current.claimToken, version: current.version };
    }
    if (claim) {
      await effect.store.markUnknown({
        ...effect.key,
        claimToken: claim.claimToken,
        expectedVersion: claim.version,
        failure: { code: "ERR_PRISM_TOOL_EFFECT_UNKNOWN" },
      });
    }
  } catch {
    // A post-dispatch persistence error is itself ambiguous; never expose or retry it.
  }
  return effectErrorResult(call, "ERR_PRISM_TOOL_EFFECT_UNKNOWN", "tool effect outcome requires reconciliation");
}

async function finishUnknownEffect(
  effect: ClaimedToolEffect,
  call: ToolCallContent,
  context: ToolExecutionContext,
  options: DispatchToolCallOptions,
  startedAt: string,
): Promise<ToolResult> {
  const result = await unknownEffectResult(effect, call);
  const error = result.error!;
  const finishedAt = new Date().toISOString();
  const metadata = toolExecutionMetadata(startedAt, "error");
  try {
    await options.emit?.({
      type: "tool.completed",
      sessionId: context.sessionId,
      runId: context.runId,
      toolCallId: call.id,
      name: call.name,
      result,
      metadata,
      status: "error",
      error,
    });
    await appendToolCallRecord(options, "error", call, startedAt, { finishedAt, result });
  } catch {
    // The effect is already ambiguous; exposure/ledger failures cannot make it safe to retry.
  }
  return result;
}

function effectErrorResult(call: ToolCallContent, code: import("./tool-effects.js").ToolEffectErrorCode, message: string): ToolResult {
  const error = new ToolEffectError(code, message);
  return { toolCallId: call.id, name: call.name, error: errorToErrorInfo(error) };
}

function isSuspended(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "ERR_PRISM_AGENT_RUN_SUSPENDED";
}

function isLoopStateError(error: unknown): boolean {
  return typeof (error as { code?: unknown })?.code === "string" && (error as { code: string }).code.startsWith("ERR_PRISM_LOOP_");
}

function isDelegationSuspended(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ERR_PRISM_DELEGATION_SUSPENDED";
}

async function checkCall(call: ToolCallContent, options: DispatchToolCallOptions, startedAt: string): Promise<ToolResult | undefined> {
  const context = options.context;
  const tool = options.registry.get(call.name);
  if (!tool) return blocked(call, context, "unknown_tool", { message: `Unknown tool: ${call.name}` }, options, startedAt);
  if (filterTools([tool], options.filter).length === 0)
    return blocked(call, context, "tool_denied", { message: `Tool denied: ${call.name}` }, options, startedAt);
  if (call.argumentsError) return blocked(call, context, "invalid_arguments", call.argumentsError, options, startedAt);
  if (!isJsonObject(call.arguments))
    return blocked(
      call,
      context,
      "invalid_arguments",
      { code: "invalid_arguments", message: "Tool arguments must be a JSON object" },
      options,
      startedAt,
    );
  return undefined;
}

async function blocked(
  call: ToolCallContent,
  context: ToolExecutionContext,
  reason: string,
  error: ErrorInfo,
  options: DispatchToolCallOptions,
  startedAt: string,
): Promise<ToolResult> {
  const metadata = toolExecutionMetadata(startedAt, "blocked");
  const finishedAt = new Date().toISOString();
  const result = { toolCallId: call.id, name: call.name, error };
  await options.emit?.({
    type: "tool.completed",
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: call.id,
    name: call.name,
    result,
    metadata,
    status: "blocked",
    reason,
    error,
  });
  await appendToolCallRecord(options, "blocked", call, startedAt, { reason, finishedAt, result });
  return result;
}

function toErrorInfo(value: string | ErrorInfo, secrets: readonly (string | undefined)[]): ErrorInfo {
  return typeof value === "string" ? errorToErrorInfo(value, secrets) : redactSecrets(value, secrets);
}

const randomId = createId;

function appendToolCallRecord(
  options: DispatchToolCallOptions,
  status: ToolCallRecord["status"],
  call: ToolCallContent,
  startedAt: string,
  fields: Partial<ToolCallRecord>,
): Promise<void> | void {
  if (!options.ledger) return undefined;
  const record: ToolCallRecord = {
    id: randomId("toolcall"),
    sessionId: options.context.sessionId,
    runId: options.context.runId,
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
    status,
    startedAt,
    redacted: Boolean(options.redactor),
    ...options.ownership,
    ...fields,
  };
  return options.ledger.appendToolCall(redactRunLedgerRecord(record, options.redactor));
}
