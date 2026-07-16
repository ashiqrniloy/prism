import {
  AgentRunError,
  createAgent,
  createEventMultiplexer,
  type AgentRunResult,
  type PermissionPolicy,
  type PermissionRequest,
} from "@arnilo/prism";
import { SupervisorDeniedError, SupervisorError, SupervisorLimitError, SupervisorValidationError } from "./errors.js";
import { narrowSupervisorLimits, resolveSupervisorLimits } from "./limits.js";
import type { CreateSupervisorOptions, DelegationCompletion, DelegationRequest, Supervisor, SupervisorEvent } from "./types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
interface ChainContext { readonly path: readonly string[]; readonly signal?: AbortSignal }

export function createSupervisor(options: CreateSupervisorOptions): Supervisor {
  requireOwnership(options.ownership);
  const id = options.id ?? "supervisor";
  if (!ID.test(id)) throw new SupervisorValidationError("Supervisor id is invalid");
  const children = Object.entries(options.children);
  if (children.length === 0) throw new SupervisorValidationError("At least one child is required");
  for (const [childId] of children) if (!ID.test(childId)) throw new SupervisorValidationError(`Invalid child id: ${childId}`);
  const baseLimits = resolveSupervisorLimits(options.limits);
  const events = createEventMultiplexer<SupervisorEvent>({ maxQueuedEvents: baseLimits.maxQueuedEvents, overflow: "drop_oldest" });
  let activeChildren = 0;
  let sequence = 0;

  async function delegate(request: DelegationRequest, chain: ChainContext = { path: [] }): Promise<AgentRunResult> {
    const child = options.children[request.childId];
    if (!child) throw new SupervisorDeniedError("Child is not allow-listed");
    if (chain.path.includes(request.childId)) throw new SupervisorLimitError("Delegation cycle detected");
    const depth = chain.path.length + 1;
    let limits = narrowSupervisorLimits(narrowSupervisorLimits(baseLimits, child.limits), request.limits);
    if (depth > limits.maxDepth) throw new SupervisorLimitError("Delegation depth exceeded");
    let input = options.redactor?.redact(request.input) ?? request.input;
    assertBytes(input, limits.maxMessageBytes, "Delegation input");
    if (activeChildren >= limits.maxActiveChildren) throw new SupervisorLimitError("Active child limit exceeded");

    activeChildren += 1;
    const delegationId = `${id}-${++sequence}`;
    const path = Object.freeze([...chain.path, request.childId]);
    const controller = new AbortController();
    const disposeSignals = linkSignals(controller, request.signal, chain.signal);
    let timer = setTimeout(() => controller.abort(new SupervisorLimitError("Delegation timeout exceeded")), limits.timeoutMs);
    let completionSent = false;

    try {
      let hookPermission: PermissionPolicy | undefined;
      if (options.hooks?.before) {
        const decision = await abortable(Promise.resolve(options.hooks.before(Object.freeze({
          childId: request.childId,
          delegationId,
          depth,
          path,
          input,
          limits,
          metadata: options.redactor?.redact(request.metadata) ?? request.metadata,
          signal: controller.signal,
        }))), controller.signal);
        if (decision.allowed === false) {
          const reason = safeError(decision.reason ?? "Delegation denied", options);
          events.publish({ type: "delegation_rejected", childId: request.childId, delegationId, depth, reason });
          await complete({ childId: request.childId, delegationId, depth, status: "rejected", text: "", error: reason });
          completionSent = true;
          throw new SupervisorDeniedError(reason);
        }
        limits = narrowSupervisorLimits(limits, decision.limits);
        if (depth > limits.maxDepth) throw new SupervisorLimitError("Delegation depth exceeded");
        if (activeChildren > limits.maxActiveChildren) throw new SupervisorLimitError("Active child limit exceeded");
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new SupervisorLimitError("Delegation timeout exceeded")), limits.timeoutMs);
        hookPermission = decision.permission;
        if (decision.input !== undefined) input = options.redactor?.redact(decision.input) ?? decision.input;
        assertBytes(input, limits.maxMessageBytes, "Delegation input");
      }

      const resourceId = `${id}/${delegationId}/${request.childId}`;
      const threadId = `${resourceId}/${encodeURIComponent(request.threadId ?? "default")}`;
      const preliminaryPermission = intersectPolicies(options.permission, child.permission, hookPermission, toolBudgetPolicy(limits.maxToolCalls));
      events.publish({ type: "delegation_started", childId: request.childId, delegationId, depth, resourceId, threadId });
      const childAgent = await abortable(Promise.resolve(child.createAgent(Object.freeze({
        childId: request.childId,
        delegationId,
        depth,
        path,
        ownership: options.ownership,
        resourceId,
        threadId,
        permission: preliminaryPermission,
        signal: controller.signal,
        delegate: (nested: DelegationRequest) => delegate(nested, { path, signal: controller.signal }),
      }))), controller.signal);
      const agent = createAgent({
        ...childAgent.config,
        permission: intersectPolicies(preliminaryPermission, childAgent.config.permission),
        ownership: options.ownership,
        redactor: options.redactor ?? childAgent.config.redactor,
      });
      const session = agent.createSession({ id: `${delegationId}-session`, metadata: { supervisorId: id, delegationId, resourceId, threadId } });
      const result = await abortable(session.run(input, {
        signal: controller.signal,
        maxToolRounds: limits.maxSteps,
        ownership: options.ownership,
        redactor: options.redactor,
        metadata: { ...request.metadata, supervisorId: id, delegationId, resourceId, threadId, depth },
      }), controller.signal);
      const totalTokens = result.usage?.totalTokens ?? ((result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0));
      if (totalTokens > limits.maxTokens) throw new SupervisorLimitError("Delegation token limit exceeded");
      events.publish({ type: "delegation_finished", childId: request.childId, delegationId, depth, status: result.status, totalTokens });
      await complete(toCompletion(result, request.childId, delegationId, depth, options));
      completionSent = true;
      return result;
    } catch (error) {
      if (!(error instanceof SupervisorDeniedError && completionSent)) {
        const result = error instanceof AgentRunError ? error.result : undefined;
        const message = safeError(error, options);
        events.publish({ type: "delegation_error", childId: request.childId, delegationId, depth, error: message });
        await complete(result ? toCompletion(result, request.childId, delegationId, depth, options) : {
          childId: request.childId,
          delegationId,
          depth,
          status: controller.signal.aborted ? "aborted" : "rejected",
          text: "",
          error: message,
        });
      }
      if (error instanceof AgentRunError || error instanceof SupervisorError) throw error;
      throw new SupervisorError(safeError(error, options));
    } finally {
      clearTimeout(timer);
      disposeSignals();
      activeChildren -= 1;
    }
  }

  async function complete(value: DelegationCompletion): Promise<void> {
    if (!options.hooks?.after) return;
    try { await options.hooks.after(Object.freeze(value)); } catch (error) {
      events.publish({ type: "delegation_error", childId: value.childId, delegationId: value.delegationId, depth: value.depth, error: safeError(error, options) });
    }
  }

  return { delegate: (request) => delegate(request), subscribe: () => events.subscribe(), get activeChildren() { return activeChildren; } };
}

function toCompletion(result: AgentRunResult, childId: string, delegationId: string, depth: number, options: CreateSupervisorOptions): DelegationCompletion {
  return Object.freeze({
    childId,
    delegationId,
    depth,
    status: result.status,
    text: options.redactor?.redact(result.text) ?? result.text,
    usage: result.usage,
    error: result.error ? safeError(result.error.message, options) : undefined,
  });
}

function intersectPolicies(...policies: readonly (PermissionPolicy | undefined)[]): PermissionPolicy {
  const active = policies.filter((policy): policy is PermissionPolicy => policy !== undefined);
  return { async check(request: PermissionRequest) {
    for (const policy of active) {
      const decision = await policy.check(request);
      if (!decision.allowed) return decision;
    }
    return { allowed: true };
  } };
}

function toolBudgetPolicy(max: number): PermissionPolicy {
  let count = 0;
  return { check(request) {
    if (request.kind !== "tool" || request.action !== "execute") return { allowed: true };
    count += 1;
    return count <= max ? { allowed: true } : { allowed: false, reason: "Delegation tool-call limit exceeded" };
  } };
}

function linkSignals(controller: AbortController, ...signals: readonly (AbortSignal | undefined)[]): () => void {
  const removers: (() => void)[] = [];
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) controller.abort(signal.reason);
    else {
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      removers.push(() => signal.removeEventListener("abort", abort));
    }
  }
  return () => { for (const remove of removers) remove(); };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function assertBytes(value: string, max: number, label: string): void {
  if (new TextEncoder().encode(value).byteLength > max) throw new SupervisorLimitError(`${label} exceeds max bytes`);
}

function requireOwnership(ownership: CreateSupervisorOptions["ownership"]): void {
  if (!ownership.tenantId?.trim()
    || (ownership.accountId !== undefined && !ownership.accountId.trim())
    || (ownership.userId !== undefined && !ownership.userId.trim())
    || (!ownership.accountId && !ownership.userId)) throw new SupervisorValidationError("tenantId and non-empty accountId or userId are required");
}

function safeError(error: unknown, options: CreateSupervisorOptions): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Delegation failed";
  return options.redactor?.redact(message) ?? message;
}
