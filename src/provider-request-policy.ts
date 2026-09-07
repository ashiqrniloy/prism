import type {
  CacheRetention,
  PromptCacheBreakpoint,
  ProviderRequest,
  ProviderRequestOptions,
  ProviderRequestPolicy,
  ProviderRequestPolicyResult,
} from "./contracts.js";
import { applyThinkingLevelForModel } from "./thinking.js";

export interface SessionCachePolicyOptions {
  readonly retention?: CacheRetention;
  readonly cacheKey?: string;
}

export interface ApplyDefaultProviderRequestOptionsContext {
  readonly sessionId?: string;
  readonly thinkingLevel?: string;
}

export class ProviderRequirementError extends Error {
  readonly code = "ERR_PRISM_PROVIDER_REQUIREMENT" as const;
  readonly requirement: string;
  readonly providerId?: string;

  constructor(message: string, options: { readonly requirement: string; readonly providerId?: string }) {
    super(message);
    this.name = "ProviderRequirementError";
    this.requirement = options.requirement;
    this.providerId = options.providerId;
  }
}

function present(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

const DEFAULT_CACHE_BREAKPOINTS = [
  { location: "system_prompt" },
  { location: "last_stable_message" },
] as const satisfies readonly PromptCacheBreakpoint[];

function defaultCacheOptions(request: ProviderRequest): ProviderRequestOptions | undefined {
  const cache = request.model.cache;
  if (!cache || (cache.kind !== "cache_control" && cache.explicitBreakpoints !== true)) return undefined;
  const options = request.options;
  if (options?.cache?.mode === "off" || options?.cacheRetention === "none" || options?.cache?.breakpoints?.length) {
    return undefined;
  }
  return {
    ...(options?.cacheRetention ? {} : { cacheRetention: "short" as const }),
    cache: { breakpoints: DEFAULT_CACHE_BREAKPOINTS },
  };
}

/** Fill-if-missing `sessionId` / `cacheKey` / cache defaults from `model.cache`. Host values win. Thinking intent patches after. */
export function applyDefaultProviderRequestOptions(
  request: ProviderRequest,
  ctx: ApplyDefaultProviderRequestOptionsContext = {},
): ProviderRequest {
  const sessionId = present(request.options?.sessionId) ?? present(ctx.sessionId);
  const cacheKey = present(request.options?.cacheKey) ?? sessionId;
  const cachePatch = defaultCacheOptions(request);
  const thinkingLevel = present(ctx.thinkingLevel);
  if (
    sessionId === present(request.options?.sessionId) &&
    cacheKey === present(request.options?.cacheKey) &&
    !cachePatch &&
    !thinkingLevel
  ) {
    return request;
  }
  const merged = mergeProviderRequestOptions(request.options, {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(cacheKey !== undefined ? { cacheKey } : {}),
    ...cachePatch,
  });
  const options = thinkingLevel ? applyThinkingLevelForModel(merged, thinkingLevel, request.model) : merged;
  return { ...request, options };
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

// Legacy cacheKey/cacheRetention policy; structured cache hints are merged separately.
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
  const merged = {
    ...base,
    ...patch,
    headers: patch.headers || base.headers ? { ...base.headers, ...patch.headers } : undefined,
    compat: patch.compat || base.compat ? { ...base.compat, ...patch.compat } : undefined,
    extra: patch.extra || base.extra ? { ...base.extra, ...patch.extra } : undefined,
  };
  if (!patch.cache && !base.cache) return merged;
  return {
    ...merged,
    cache: {
      ...base.cache,
      ...patch.cache,
      breakpoints:
        base.cache?.breakpoints || patch.cache?.breakpoints
          ? [...(base.cache?.breakpoints ?? []), ...(patch.cache?.breakpoints ?? [])]
          : undefined,
    },
  };
}

export function normalizeProviderRequestPolicyResult(result: ProviderRequest | ProviderRequestPolicyResult): ProviderRequestPolicyResult {
  return "request" in result ? result : { request: result };
}
