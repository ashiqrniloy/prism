import type { CacheRetention, ProviderRequest, ProviderRequestOptions, ProviderRequestPolicy, ProviderRequestPolicyResult } from "./contracts.js";

export interface SessionCachePolicyOptions {
  readonly retention?: CacheRetention;
  readonly cacheKey?: string;
}

export function createProviderRequestPolicyChain(policies: readonly ProviderRequestPolicy[]): ProviderRequestPolicy {
  return {
    name: "provider-request-policy-chain",
    async apply(context) {
      let request = context.request;
      const secrets: (string | undefined)[] = [];
      for (const policy of policies) {
        const result = await policy.apply({ ...context, request });
        const normalized = normalizeProviderRequestPolicyResult(result);
        request = normalized.request;
        secrets.push(...(normalized.secrets ?? []));
      }
      return { request, secrets };
    },
  };
}

export function createSessionCachePolicy(options: SessionCachePolicyOptions = {}): ProviderRequestPolicy {
  return {
    name: "session-cache",
    apply(context) {
      const sessionId = context.request.options?.sessionId ?? context.sessionId;
      return {
        ...context.request,
        options: mergeProviderRequestOptions(context.request.options, {
          sessionId,
          cacheKey: options.cacheKey ?? sessionId,
          cacheRetention: options.retention ?? "short",
        }),
      };
    },
  };
}

export function mergeProviderRequestOptions(
  base: ProviderRequestOptions | undefined,
  patch: ProviderRequestOptions | undefined,
): ProviderRequestOptions | undefined {
  if (!base) return patch;
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    headers: patch.headers || base.headers ? { ...base.headers, ...patch.headers } : undefined,
    compat: patch.compat || base.compat ? { ...base.compat, ...patch.compat } : undefined,
    extra: patch.extra || base.extra ? { ...base.extra, ...patch.extra } : undefined,
  };
}

export function normalizeProviderRequestPolicyResult(result: ProviderRequest | ProviderRequestPolicyResult): ProviderRequestPolicyResult {
  return "request" in result ? result : { request: result };
}
