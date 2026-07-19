import type { ModelConfig, ProviderRequestOptions } from "./contracts.js";

/**
 * Host binding for a non-session LLM job (observational memory, LLM compaction,
 * declarative agents, evals, etc.). Omitting `model` means "use the session model"
 * when a session fallback is supplied to {@link resolveUseCaseModel}.
 *
 * Workers must not write `model_change` session entries; they resolve a model for
 * their own provider calls only.
 */
export interface UseCaseModelBinding {
  /** Explicit use-case model. When omitted, {@link resolveUseCaseModel} falls back to `sessionModel`. */
  readonly model?: ModelConfig;
  /**
   * Optional provider id hint for docs / credential routing.
   * When `model` is set, `model.provider` is authoritative.
   */
  readonly provider?: string;
  readonly providerOptions?: ProviderRequestOptions;
  /** Portable thinking level; packages map via `applyThinkingLevel` into `compat`. */
  readonly thinkingLevel?: string;
  /**
   * When true, do not fall back to `sessionModel` — leave resolution empty if
   * `model` is omitted (preserves historical explicit-worker `missing_model` behavior).
   */
  readonly requireExplicitModel?: boolean;
}

export interface ResolveUseCaseModelInput {
  /** Explicit use-case model (or `binding.model`). */
  readonly configured?: ModelConfig;
  /** Active session / agent model used when `configured` is omitted. */
  readonly sessionModel?: ModelConfig;
  /** When true, skip session fallback (OM `missing_model` escape hatch). */
  readonly requireExplicitModel?: boolean;
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
}

export interface ResolvedUseCaseModel {
  readonly model: ModelConfig;
  /** Whether the model came from the use-case binding or session fallback. */
  readonly source: "configured" | "session";
  readonly providerOptions?: ProviderRequestOptions;
  readonly thinkingLevel?: string;
}

/**
 * Resolve the model for a non-session LLM job.
 *
 * Precedence:
 * 1. `configured` → `source: "configured"`
 * 2. Else `sessionModel` when `requireExplicitModel` is not set → `source: "session"`
 * 3. Else `undefined` (caller skips / throws per package policy)
 *
 * O(1); no network. Does not mutate session history.
 */
export function resolveUseCaseModel(input: ResolveUseCaseModelInput): ResolvedUseCaseModel | undefined {
  const { providerOptions, thinkingLevel } = input;

  if (input.configured) {
    return {
      model: input.configured,
      source: "configured",
      providerOptions,
      thinkingLevel,
    };
  }

  if (input.requireExplicitModel) return undefined;

  if (input.sessionModel) {
    return {
      model: input.sessionModel,
      source: "session",
      providerOptions,
      thinkingLevel,
    };
  }

  return undefined;
}

/**
 * Resolve from a {@link UseCaseModelBinding} plus optional session fallback.
 */
export function resolveUseCaseModelBinding(
  binding: UseCaseModelBinding | undefined,
  sessionModel?: ModelConfig,
): ResolvedUseCaseModel | undefined {
  return resolveUseCaseModel({
    configured: binding?.model,
    sessionModel,
    requireExplicitModel: binding?.requireExplicitModel,
    providerOptions: binding?.providerOptions,
    thinkingLevel: binding?.thinkingLevel,
  });
}

/**
 * Provider id for credential requests: always the **resolved** model's provider.
 * Optional `binding.provider` is only a hint when no model resolved yet.
 */
export function useCaseCredentialProviderId(
  resolved: ResolvedUseCaseModel | undefined,
  binding?: Pick<UseCaseModelBinding, "provider">,
): string | undefined {
  return resolved?.model.provider ?? binding?.provider;
}
