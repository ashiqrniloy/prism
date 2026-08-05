import { isJsonObject } from "./config.js";
import type {
  AgentEvent,
  ErrorInfo,
  Guardrails,
  JsonObject,
  OwnershipScope,
  RunLedger,
  ToolCallContent,
  ToolCallRecord,
  ToolCallStatus,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionMetadata,
  ToolEffectDeclaration,
  ToolEffectKey,
  ToolEffectStore,
  ToolRegistry,
  ToolResult,
} from "./contracts.js";
import { GuardrailError, runGuardrails } from "./guardrails.js";
import { assertIdentityActive, assertIdentityMatchesOwnership, ownershipFromIdentity } from "./identity.js";
import { createId } from "./ids.js";
import type { MiddlewareRegistry } from "./middleware.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets, type SecretRedactor } from "./redaction.js";
import { assertCanRegister, type DuplicateRegistrationOptions } from "./registry-options.js";
import type { RunLimitTracker } from "./run-limits.js";
import { assertPermission, assertTrusted, type PermissionPolicy, type TrustPolicy } from "./security.js";
import { deriveToolEffectKey, toolEffectArgumentsHash, ToolEffectError } from "./tool-effects.js";

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

function formatToolArgumentValidationErrors(toolName: string, errors?: readonly ToolArgumentValidationError[]): string {
  if (!errors?.length) return `Tool arguments failed validation: ${toolName}`;
  return errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join("; ");
}

export interface DispatchToolCallOptions {
  readonly call: ToolCallContent;
  readonly registry: ToolRegistry;
  readonly context: ToolExecutionContext;
  readonly filter?: ToolFilterInput;
  readonly middleware?: MiddlewareRegistry;
  readonly validate?: ToolValidator;
  /** Adapter-specific policy check immediately before the tool side effect. */
  readonly beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
  readonly secrets?: readonly (string | undefined)[];
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
  readonly redactor?: SecretRedactor;
  readonly ledger?: RunLedger;
  /** Optional shared recovery store. Only declared optional/required effects use it. */
  readonly effectStore?: ToolEffectStore;
  readonly ownership?: OwnershipScope;
  /** Host-verified identity; asserted active before tool side effects when present. */
  readonly identity?: import("./identity.js").AgentIdentity;
  /** Tool stages run after middleware normalization and before side effects/exposure. */
  readonly guardrails?: Guardrails;
  /** Shared run tracker; direct hosts may supply one for their call scope. */
  readonly limitTracker?: RunLimitTracker;
}

export interface ToolRegistryOptions extends DuplicateRegistrationOptions {}

export function createToolRegistry(tools: readonly ToolDefinition[] = [], options: ToolRegistryOptions = {}): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    register(tool) {
      assertCanRegister(byName, tool.name, "tool", tool.name, options.duplicate);
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

function toolExecutionMetadata(startedAt: string, status: ToolCallStatus): ToolExecutionMetadata {
  return { durationMs: Math.max(0, Date.now() - Date.parse(startedAt)), status };
}

export async function dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult> {
  const secrets = options.secrets ?? [];
  const startedAt = new Date().toISOString();
  options.limitTracker?.charge("maxToolCalls");
  const mediatedCall = await (options.middleware?.run<ToolCallContent>("tool_call", options.call) ?? options.call);
  const inputGuards = await runGuardrails({
    stage: "tool_input",
    guardrails: options.guardrails,
    value: mediatedCall,
    context: {
      sessionId: options.context.sessionId,
      runId: options.context.runId,
      toolCallId: mediatedCall.id,
      toolName: mediatedCall.name,
      metadata: options.context.metadata ?? {},
      signal: options.context.signal,
    },
    redactor: options.redactor,
    emit: options.emit,
  });
  if (inputGuards.terminal) {
    if (inputGuards.terminal.action !== "block") throw new GuardrailError(inputGuards.terminal);
    return blocked(mediatedCall, options.context, "guardrail_blocked", { message: "Tool call blocked by guardrail" }, options, startedAt);
  }
  const tool = options.registry.get(mediatedCall.name);
  const postcheck = await checkCall(mediatedCall, options, startedAt);
  if (postcheck) return postcheck;

  const { idempotencyKey: _untrustedKey, ...baseContext } = options.context;
  let context: ToolExecutionContext = {
    ...baseContext,
    toolCallId: mediatedCall.id,
    identity: options.identity ?? options.context.identity,
    progress: async (progress, metadata) => {
      await options.context.progress?.(progress, metadata);
      await options.emit?.({
        type: "tool_execution_progress",
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
    if (context.identity) {
      assertIdentityActive(context.identity);
      assertIdentityMatchesOwnership(context.identity, options.ownership);
    }
    await assertTrusted(options.trust, {
      kind: "tool",
      target: mediatedCall.name,
      capability: "execute",
      metadata: options.context.metadata,
    });
    await assertPermission(options.permission, {
      kind: "tool",
      action: "execute",
      target: mediatedCall.name,
      metadata: options.context.metadata,
    });
  } catch (error) {
    return blocked(mediatedCall, context, "permission_denied", errorToErrorInfo(error, secrets), options, startedAt);
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
    await options.emit?.({ type: "tool_execution_started", sessionId: context.sessionId, runId: context.runId, call: mediatedCall });
    await appendToolCallRecord(options, "started", mediatedCall, startedAt, {});
    if (effect) {
      dispatchAttempted = true;
      const record = await effect.store.markDispatched(transition(effect));
      effect.expectedVersion = record.version;
      effect.dispatched = true;
    }
    const raw = await tool!.execute(mediatedCall.arguments, context);
    const mediatedResult = await (options.middleware?.run<ToolResult>("tool_result", raw) ?? raw);
    const outputGuards = await runGuardrails({
      stage: "tool_output",
      guardrails: options.guardrails,
      value: mediatedResult,
      context: {
        sessionId: context.sessionId,
        runId: context.runId,
        toolCallId: mediatedCall.id,
        toolName: mediatedCall.name,
        metadata: context.metadata ?? {},
        signal: context.signal,
      },
      redactor: options.redactor,
      emit: options.emit,
    });
    if (outputGuards.terminal) {
      if (outputGuards.terminal.action !== "block") throw new GuardrailError(outputGuards.terminal);
      if (effect) return finishUnknownEffect(effect, mediatedCall, context, options, startedAt);
      return blocked(mediatedCall, context, "guardrail_blocked", { message: "Tool result blocked by guardrail" }, options, startedAt);
    }
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
      type: "tool_execution_finished",
      sessionId: context.sessionId,
      runId: context.runId,
      result: completedResult,
      metadata,
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
    await failBeforeEffect(effect, "failed_terminal");
    if (error instanceof GuardrailError) throw error;
    const info = errorToErrorInfo(error, secrets);
    const result = { toolCallId: mediatedCall.id, name: mediatedCall.name, error: info };
    const finishedAt = new Date().toISOString();
    const metadata = toolExecutionMetadata(startedAt, "error");
    await options.emit?.({
      type: "tool_execution_error",
      sessionId: context.sessionId,
      runId: context.runId,
      call: mediatedCall,
      error: info,
      metadata,
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
  const identity = context.identity;
  const declaration = resolveToolEffectDeclaration(tool, call.arguments, context);
  if (!declaration || declaration.kind === "none" || declaration.idempotency === "none") return { context };
  if (!identity && declaration.idempotency === "unsupported") return { context };
  if (!identity) throw new ToolEffectError("ERR_PRISM_TOOL_EFFECT_CONFLICT", "verified identity is required for a durable tool effect");
  const ownership = ownershipFromIdentity(identity);
  const argumentsHash = toolEffectArgumentsHash(call.arguments);
  const base = {
    identity,
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
    await options.emit?.({ type: "tool_execution_error", sessionId: context.sessionId, runId: context.runId, call, error, metadata });
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
    return blocked(call, context, "invalid_arguments", { message: "Tool arguments must be a JSON object" }, options, startedAt);
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
  await options.emit?.({
    type: "tool_execution_blocked",
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: call.id,
    name: call.name,
    reason,
    error,
    metadata,
  });
  const finishedAt = new Date().toISOString();
  const result = { toolCallId: call.id, name: call.name, error };
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
