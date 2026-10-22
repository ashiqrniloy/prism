/**
 * Decision glue: build the policy evaluator from inline rules, project a session principal onto the
 * identity the evaluator requires, and map a policy outcome onto a `tool.call` decision.
 *
 * The inline matcher is the only new policy logic; the evaluator, OPA adapter, ledger, and bounds are
 * the moved `./policy` modules.
 */
import type { AgentIdentity } from "./identity/index.js";
import type { GovernanceConfig, GovernanceRule } from "./config.js";
import { createPolicyEvaluator, type PolicyEvaluateRequest, type PolicyEvaluateResult, type PolicyEvaluator } from "./policy/index.js";

/** Per-call facts a rule matches on. Never persisted: `PolicyEvaluateRequest.context` is evaluator-only. */
export interface GovernanceCallContext {
  readonly effects: readonly string[];
  readonly principalKind?: string;
  readonly principalId?: string;
}

function matchesFields(rule: GovernanceRule, toolName: string, context: GovernanceCallContext): boolean {
  if (rule.tools && !rule.tools.includes(toolName)) return false;
  if (rule.effects && !rule.effects.some((effect) => context.effects.includes(effect))) return false;
  if (rule.principalKinds && (context.principalKind === undefined || !rule.principalKinds.includes(context.principalKind))) {
    return false;
  }
  if (rule.principalIds && (context.principalId === undefined || !rule.principalIds.includes(context.principalId))) {
    return false;
  }
  return true;
}

/**
 * Scopes the verified identity must hold for a call: the first rule whose fields match the call and
 * that declares `scopes`. Empty when no matching rule requires any. Enforced separately from
 * `outcome` (and therefore also when OPA supplies the outcome), so a missing scope is always a deny.
 */
export function requiredScopes(
  rules: readonly GovernanceRule[],
  toolName: string,
  context: GovernanceCallContext,
): readonly string[] {
  for (const rule of rules) {
    if (!rule.scopes || rule.scopes.length === 0) continue;
    if (matchesFields(rule, toolName, context)) return rule.scopes;
  }
  return [];
}

/** Inline-rule evaluator: first matching rule wins, else `config.default` (roadmap §2.9 deny by default). */
export function createRuleEvaluator(config: GovernanceConfig): PolicyEvaluator {
  const rules = config.rules ?? [];
  const fallback = config.default ?? "deny";
  return createPolicyEvaluator({
    policyId: "governance.inline",
    policyVersion: "1",
    evaluate: (request) => {
      const context = (request.context ?? {}) as unknown as GovernanceCallContext;
      for (const rule of rules) {
        if (matchesFields(rule, request.resource.id, context)) {
          return { outcome: rule.outcome, ...(rule.reason !== undefined ? { reason: rule.reason } : {}) };
        }
      }
      return { outcome: fallback };
    },
  });
}

/**
 * The identity a policy request is evaluated against when no `identity` verifier is configured.
 *
 * An agent without a host principal is evaluated as a local `agent` principal so inline rules and
 * OPA still run; with `identity` configured, `identity-hooks.ts` supplies the verified identity
 * instead. The kernel itself never synthesizes an identity (roadmap Phase 3).
 */
export function sessionIdentity(
  session: { readonly id: string; readonly principal?: { readonly kind: string; readonly id: string } } | undefined,
  now = Date.now(),
): AgentIdentity {
  const principal = session?.principal;
  const id = principal?.id ?? session?.id ?? "session";
  const kind = principal?.kind ?? "agent";
  return {
    tenantId: "local",
    userId: id,
    principal: { kind, id },
    scopes: ["prism.session"],
    issuedAt: new Date(now).toISOString(),
    verified: true,
  };
}

/**
 * @deprecated No replacement: nothing reads it since the 0.13 split, no compat baseline tracks it,
 * and no package subpath exports it. Removed at the next breaking cut
 * (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export interface GovernanceEvaluation {
  readonly result: PolicyEvaluateResult;
  readonly context: GovernanceCallContext;
}

export function toolCallRequest(
  identity: AgentIdentity,
  payload: { readonly name: string; readonly effects: readonly string[]; readonly callId: string },
  principal: { readonly kind: string; readonly id: string } | undefined,
  signal?: AbortSignal,
): PolicyEvaluateRequest {
  return {
    identity,
    action: payload.name,
    resource: { kind: "tool", id: payload.name },
    context: { effects: payload.effects, principalKind: principal?.kind, principalId: principal?.id },
    signal,
  };
}

/** `allow` → nothing; `deny` → `{ deny }`; `approval` → `{ ask }`; `modify` is unsupported and fails closed. */
export function toolCallDecision(
  result: PolicyEvaluateResult,
  toolName: string,
): "allow" | { readonly deny: string } | { readonly ask: string } {
  if (result.outcome === "allow") return "allow";
  if (result.outcome === "approval") return { ask: result.reason ?? `${toolName} requires approval` };
  if (result.outcome === "deny") return { deny: result.reason ?? `${toolName} denied by policy` };
  return { deny: `${toolName} denied: policy outcome "modify" is not supported` };
}
