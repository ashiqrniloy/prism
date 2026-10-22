/**
 * `@arnilo/prism-governance` — the policy engine, OPA adapter, approvals, and audit ledger, as one
 * package over `tool.call` (and opt-in `run.input` / `model.request`).
 *
 * Deny by default (roadmap §2.9). An unreachable OPA endpoint, a timeout, a malformed decision, or a
 * required audit append failure is a deny — never an allow. A handler that throws is a deny.
 *
 * ```ts
 * import governance from "@arnilo/prism-governance";
 *
 * packages: [
 *   mockProvider(),
 *   codingTools({ root }),
 *   governance({ default: "deny", rules: [{ tools: ["read_file"], outcome: "allow" }], audit: { store: "memory" } }),
 * ];
 * ```
 *
 * The moved `./policy` modules stay available as library exports (evaluator, OPA adapter, ledger,
 * approvals, audit export) alongside the package surface.
 */

import manifest from "../package.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import {
  definePackage,
  type HookContext,
  type PackageAPI,
  type ProviderRequest,
  type ToolCallDecision,
} from "@arnilo/prism";

import { createAudit, type GovernanceAudit } from "./audit.js";
import { type GovernanceConfig, type GovernanceSecretRef, governanceConfigSchema } from "./config.js";
import { createRuleEvaluator, sessionIdentity, toolCallDecision, toolCallRequest } from "./hooks.js";
import { createGovernanceIdentity, type GovernanceIdentityRuntime, identityServiceName } from "./identity-hooks.js";
import { type AgentIdentity, type IdentityVerifier } from "./identity/index.js";
import {
  createOpaPolicyEvaluator,
  evaluateAndAppend,
  exportPolicyDecisions,
  type PolicyEvaluateRequest,
  type PolicyEvaluateResult,
  type PolicyEvaluator,
} from "./policy/index.js";
import { unmetRequirement } from "./require.js";

export { describeStorage } from "./storage-describe.js";
export type { GovernanceAudit } from "./audit.js";
export { createAudit } from "./audit.js";
// Plan 159 Task 7: the moved governance-adjacent modules stay available as library exports. Field
// evidence and claim grounding are wired by the host through `tool.call` / `model.response` (their
// evidence source and tool-results supplier are host functions, which JSON config cannot carry);
// `readiness` is the `inspectHostComposition` / `assertHostCompositionReadiness` report.
export * from "./claim-grounding.js";
export type {
  GovernanceAuditConfig,
  GovernanceAuditExportConfig,
  GovernanceConfig,
  GovernanceDefault,
  GovernanceHooksConfig,
  GovernanceIdentityConfig,
  GovernanceOpaConfig,
  GovernanceOutcome,
  GovernanceRule,
  GovernanceSecretRef,
} from "./config.js";
export { governanceConfigSchema } from "./config.js";
export * from "./field-evidence.js";
export * from "./field-policy.js";
export type { GovernanceCallContext } from "./hooks.js";
export { createRuleEvaluator, requiredScopes, sessionIdentity, toolCallDecision, toolCallRequest } from "./hooks.js";
export type { GovernanceIdentityService } from "./identity-hooks.js";
export {
  createGovernanceIdentity,
  DEFAULT_IDENTITY_SERVICE,
  identityDenialReason,
  identityServiceName,
  identityVerificationInput,
  OIDC_IDENTITY_SERVICE,
} from "./identity-hooks.js";
// Plan 159 Task 8: the moved kernel identity module. `Principal` stays a kernel type (re-exported here
// for callers that already depend on this package for identity work).
export * from "./identity/index.js";
export * from "./policy/index.js";
export * from "./readiness.js";
export type { GovernanceRequireConfig } from "./require.js";
export { GOVERNANCE_REQUIREMENT_CODE, GovernanceRequirementError, unmetRequirement } from "./require.js";

const PACKAGE = "@arnilo/prism-governance";

/** OPA failure reasons the moved adapter returns as denials, mapped back to their frozen codes. */
const OPA_FAILURE_CODES: Readonly<Record<string, string>> = {
  "OPA decision timed out": "ERR_PRISM_OPA_TIMEOUT",
  "OPA endpoint unavailable": "ERR_PRISM_OPA_TRANSPORT",
  "OPA response malformed": "ERR_PRISM_OPA_RESPONSE_PARSE",
  "OPA response exceeded bounds": "ERR_PRISM_OPA_RESPONSE_BOUNDS",
  "OPA policy version mismatch": "ERR_PRISM_OPA_VERSION_MISMATCH",
  "OPA decision could not be mapped": "ERR_PRISM_OPA_DECISION_MAPPING",
};

/** An audit append failed while `audit.required` is set; the call is denied. */
export class GovernanceAuditUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`governance audit unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "GovernanceAuditUnavailableError";
  }
}

function opaDecisionUrl(config: { readonly url: string; readonly path?: string }): string {
  if (!config.path?.trim()) return config.url;
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  return new URL(config.path.replace(/^\//, ""), base).toString();
}

async function resolveHeaders(
  prism: PackageAPI<GovernanceConfig>,
  headers: Readonly<Record<string, GovernanceSecretRef>> | undefined,
): Promise<Record<string, string> | undefined> {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  const resolved: Record<string, string> = {};
  for (const [name, header] of Object.entries(headers)) {
    const secret = await prism.credentials.resolve(header.ref);
    if (secret === undefined) throw new Error(`OPA header ${name} ref ${header.ref} is unavailable`);
    resolved[name] = `${header.prefix ?? ""}${secret.value}`;
  }
  return resolved;
}

/** Build the one evaluator this instance uses: OPA when configured, else inline rules. */
async function buildEvaluator(prism: PackageAPI<GovernanceConfig>): Promise<PolicyEvaluator> {
  const opa = prism.config.opa;
  if (!opa) return createRuleEvaluator(prism.config);
  const headers = await resolveHeaders(prism, opa.headers);
  const base = createOpaPolicyEvaluator({
    url: opaDecisionUrl(opa),
    policyId: opa.policyId ?? "governance.opa",
    policyVersion: opa.policyVersion ?? "1",
    ...(opa.timeoutMs !== undefined ? { timeoutMs: opa.timeoutMs } : {}),
    ...(headers
      ? {
          fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...headers } }),
        }
      : {}),
  });
  return {
    policyId: base.policyId,
    policyVersion: base.policyVersion,
    async evaluate(request) {
      const result = await base.evaluate(request);
      const code = result.outcome === "deny" && result.reason ? OPA_FAILURE_CODES[result.reason] : undefined;
      return code ? { ...result, reason: `${code}: ${result.reason}` } : result;
    },
  };
}

function onceEvaluator(base: PolicyEvaluator, result: PolicyEvaluateResult): PolicyEvaluator {
  return { policyId: base.policyId, policyVersion: base.policyVersion, evaluate: () => result };
}

/** Evaluate once, then append the decision when `audit` is set. A required append failure denies. */
async function evaluateWithAudit(
  prism: PackageAPI<GovernanceConfig>,
  evaluator: PolicyEvaluator,
  audit: GovernanceAudit | undefined,
  request: PolicyEvaluateRequest,
  id: string,
): Promise<PolicyEvaluateResult> {
  const result = await evaluator.evaluate(request);
  if (!audit) return result;
  try {
    await evaluateAndAppend(request, { store: audit.store, evaluator: onceEvaluator(evaluator, result), id });
  } catch (error) {
    if (audit.required) throw new GovernanceAuditUnavailableError(error);
    prism.status.note("warn", `governance audit append failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

function boundedId(callId: string): string {
  return callId.length > 110 ? `${callId.slice(0, 110)}:resolved` : `${callId}:resolved`;
}

async function closeApproval(
  prism: PackageAPI<GovernanceConfig>,
  audit: GovernanceAudit | undefined,
  evaluator: PolicyEvaluator,
  callId: string,
  outcome: "allow" | "deny",
  _context: HookContext,
  reason: string,
  actor: AgentIdentity,
): Promise<void> {
  if (!audit) return;
  try {
    await audit.store.append({
      id: boundedId(callId),
      policyId: evaluator.policyId,
      policyVersion: evaluator.policyVersion,
      outcome,
      identity: actor,
      target: { kind: "tool_approval", id: callId },
      reason,
      evidenceRefs: [`tool_call:${callId}`],
    });
  } catch (error) {
    if (audit.required) throw new GovernanceAuditUnavailableError(error);
    prism.status.note("warn", `governance audit close failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function install(
  prism: PackageAPI<GovernanceConfig>,
  evaluator: PolicyEvaluator,
  audit: GovernanceAudit | undefined,
  identity: GovernanceIdentityRuntime | undefined,
): void {
  prism.services.provide("governance.policy", evaluator);

  // Plan 159 Task 8: verify the session principal before each run. Registered first, so an unverified
  // principal is rejected long before the provider round.
  if (identity) {
    prism.services.provide("governance.identity", identity.service);
    prism.hooks.on("run.input", async (_messages, context) => identity.verify(context));
  }

  // Plan 159 Task 7: `require` replaces `createSecureAgent`'s build-time guarantees. A package cannot
  // read `AgentConfig`, so the check runs at the run boundary and fails closed.
  const require = prism.config.require;
  if (require) {
    prism.hooks.on("run.input", (_messages, context) => {
      const unmet = unmetRequirement(require, context.session);
      return unmet ? context.reject(unmet) : undefined;
    });
  }
  if (audit) {
    prism.services.provide("governance.audit", {
      store: audit.store,
      export: (options: Omit<Parameters<typeof exportPolicyDecisions>[0], "store">) =>
        exportPolicyDecisions({ ...options, store: audit.store, ...(audit.pageSize !== undefined ? { limit: audit.pageSize } : {}) }),
    });
  }

  const pending = prism.state.agent<Record<string, string>>("pendingApprovals", {});

  /** The verified identity when `identity` is configured, else the local placeholder the evaluator needs. */
  const actorFor = (context: HookContext): AgentIdentity =>
    identity?.active(context.sessionId, context.session?.principal?.id) ?? sessionIdentity(context.session);

  prism.hooks.on("tool.call", async (payload, context): Promise<ToolCallDecision | undefined> => {
    const unmet = unmetRequirement(require, context.session);
    if (unmet) return { deny: unmet };
    if (identity) {
      const denial = identity.gate(payload.name, payload.effects, context);
      if (denial) return { deny: denial };
    }
    const request = toolCallRequest(actorFor(context), payload, context.session?.principal, context.signal);
    let result: PolicyEvaluateResult;
    try {
      result = await evaluateWithAudit(prism, evaluator, audit, request, payload.callId);
    } catch {
      return { deny: `${payload.name} denied: policy evaluation failed` };
    }
    const decision = toolCallDecision(result, payload.name);
    if (decision !== "allow" && "ask" in decision) {
      pending.set({ ...pending.get(), [payload.callId]: payload.callId });
    }
    return decision === "allow" ? undefined : decision;
  });

  prism.hooks.on("decision.resolved", async (payload, context) => {
    const tracked = pending.get();
    const settled = payload.decisions.filter((decision) => tracked[decision.toolCallId] !== undefined);
    if (settled.length === 0) return;
    const next = { ...tracked };
    for (const decision of settled) {
      delete next[decision.toolCallId];
      await closeApproval(
        prism,
        audit,
        evaluator,
        decision.toolCallId,
        decision.outcome,
        context,
        `approval resolved: ${decision.outcome}`,
        actorFor(context),
      );
    }
    pending.set(next);
  });

  prism.hooks.on("tool.completed", async (payload, context) => {
    const callId = payload.toolCallId ?? payload.result.toolCallId;
    if (callId === undefined || pending.get()[callId] === undefined) return;
    if (payload.status !== "blocked") return;
    const next = { ...pending.get() };
    delete next[callId];
    await closeApproval(prism, audit, evaluator, callId, "deny", context, payload.reason ?? "blocked before dispatch", actorFor(context));
    pending.set(next);
  });

  if (prism.config.hooks?.runInput) {
    prism.hooks.on("run.input", async (_messages, context) => {
      const request: PolicyEvaluateRequest = {
        identity: actorFor(context),
        action: "run.input",
        resource: { kind: "run", id: context.runId || "run" },
        signal: context.signal,
      };
      const result = await evaluateWithAudit(prism, evaluator, audit, request, randomUUID());
      if (result.outcome === "allow") return undefined;
      return context.reject(result.reason ?? "run input denied by policy");
    });
  }

  if (prism.config.hooks?.modelRequest) {
    prism.hooks.on("model.request", async (request: ProviderRequest, context) => {
      const evaluateRequest: PolicyEvaluateRequest = {
        identity: actorFor(context),
        action: "model.request",
        resource: { kind: "model", id: request.model.model || "model" },
        signal: context.signal,
      };
      const result = await evaluateWithAudit(prism, evaluator, audit, evaluateRequest, randomUUID());
      if (result.outcome === "allow") return undefined;
      return context.reject(result.reason ?? "model request denied by policy");
    });
  }
}

function createDefinition() {
  return definePackage<GovernanceConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "Deny-by-default policy engine, OPA adapter, approvals, and audit ledger.",
    requires: { api: 1 },
    capabilities: ["credentials"],
    config: governanceConfigSchema,
    async setup(prism) {
      // Fail closed before anything else: a configured verifier that no package provides is
      // `missing_service` at `createAgent`, never a silently unverified run.
      const identityConfig = prism.config.identity;
      const identity = identityConfig
        ? createGovernanceIdentity(
            prism,
            identityConfig,
            prism.services.require<IdentityVerifier>(identityServiceName(identityConfig)),
          )
        : undefined;
      const evaluator = await buildEvaluator(prism);
      const audit = prism.config.audit ? createAudit(prism.config.audit) : undefined;
      install(prism, evaluator, audit, identity);
    },
  });
}

/** Bare definition: schema defaults, deny by default, no audit. `governance({ … })` is an instance. */
export default createDefinition();

/** Explicit factory, for callers that prefer a named function over the default export.
 *  @deprecated No replacement: nothing reads it since the 0.13 split. Removed at the next breaking
 *  cut (docs/_evidence/dead-export-verification-2026-09-03.md). */
export function governancePackage(config?: GovernanceConfig) {
  return createDefinition()(config);
}
