import type { ErrorInfo } from "./contracts.js";

export interface TrustRequest {
  readonly kind: "project" | "resource" | "extension" | string;
  readonly target: string;
  readonly capability?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TrustDecision {
  readonly trusted: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TrustPolicy {
  check(request: TrustRequest): TrustDecision | Promise<TrustDecision>;
}

export interface PermissionRequest {
  readonly kind: "tool" | "extension" | "resource" | string;
  readonly action: string;
  readonly target: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PermissionPolicy {
  check(request: PermissionRequest): PermissionDecision | Promise<PermissionDecision>;
}

export class TrustDeniedError extends Error {
  readonly code = "ERR_PRISM_UNTRUSTED";
  constructor(readonly request: TrustRequest, readonly decision: TrustDecision) {
    super(decision.reason ?? `Untrusted ${request.kind}: ${request.target}`);
    this.name = "TrustDeniedError";
  }
}

export class PermissionDeniedError extends Error {
  readonly code = "ERR_PRISM_PERMISSION_DENIED";
  constructor(readonly request: PermissionRequest, readonly decision: PermissionDecision) {
    super(decision.reason ?? `Permission denied for ${request.kind}:${request.target}:${request.action}`);
    this.name = "PermissionDeniedError";
  }
}

export async function isTrusted(policy: TrustPolicy | undefined, request: TrustRequest): Promise<boolean> {
  return policy ? (await policy.check(request)).trusted : true;
}

export async function assertTrusted(policy: TrustPolicy | undefined, request: TrustRequest): Promise<void> {
  const decision = policy ? await policy.check(request) : { trusted: true };
  if (!decision.trusted) throw new TrustDeniedError(request, decision);
}

export function createStaticTrustPolicy(decision: boolean | TrustDecision): TrustPolicy {
  const resolved = typeof decision === "boolean" ? { trusted: decision } : decision;
  return { check: () => resolved };
}

export async function checkPermission(policy: PermissionPolicy | undefined, request: PermissionRequest): Promise<PermissionDecision> {
  return policy ? policy.check(request) : { allowed: true };
}

export async function assertPermission(policy: PermissionPolicy | undefined, request: PermissionRequest): Promise<void> {
  const decision = await checkPermission(policy, request);
  if (!decision.allowed) throw new PermissionDeniedError(request, decision);
}

export function createStaticPermissionPolicy(options: { readonly allow?: readonly string[]; readonly deny?: readonly string[] } | boolean): PermissionPolicy {
  if (typeof options === "boolean") return { check: () => ({ allowed: options }) };
  const allow = new Set(options.allow ?? []);
  const deny = new Set(options.deny ?? []);
  return {
    check(request) {
      const key = `${request.kind}:${request.target}:${request.action}`;
      if (deny.has(key)) return { allowed: false, reason: `Permission denied: ${key}` };
      return { allowed: allow.size === 0 || allow.has(key), reason: allow.size && !allow.has(key) ? `Permission not allowed: ${key}` : undefined };
    },
  };
}

export function denialToErrorInfo(error: unknown): ErrorInfo {
  return error instanceof Error ? { name: error.name, message: error.message, code: (error as { code?: string }).code } : { message: String(error) };
}
