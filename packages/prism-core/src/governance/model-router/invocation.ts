import { randomUUID } from "node:crypto";
import type { AgentIdentity, AIProvider, ModelConfig, ProviderEvent, ProviderRequest, Usage } from "@arnilo/prism";
import { ModelRouterError } from "./errors.js";
import type { ModelRouter, ModelRouterReservation, ModelRouterResolveResult, PaidWorkKind } from "./types.js";

export interface GovernedProviderOptions {
  readonly router: ModelRouter;
  readonly identity?: AgentIdentity;
  readonly id?: string;
  readonly model?: ModelConfig;
  readonly fallbacks?: readonly ModelConfig[];
  readonly residency?: string;
  readonly region?: string;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
  readonly taskId?: string;
  readonly kind?: PaidWorkKind;
  readonly onSettlement?: (settlement: GovernedInvocationSettlement) => void | Promise<void>;
}

export interface GovernedInvocationSettlement {
  readonly attemptId: string;
  readonly identity: AgentIdentity;
  readonly model: ModelConfig;
  readonly outcome: "success" | "error" | "abort" | "early_close";
  readonly durationMs: number;
  readonly usage?: Usage;
  readonly error?: unknown;
  readonly budgetCommitted?: boolean;
  readonly budgetReleased?: boolean;
  readonly unknownUsage?: boolean;
  readonly taskId?: string;
  readonly kind?: PaidWorkKind;
}

export interface GovernedProvider extends AIProvider {
  readonly router: ModelRouter;
  readonly identity?: AgentIdentity;
  readonly model?: ModelConfig;
  readonly isGoverned: true;
  readonly taskId?: string;
  readonly kind?: PaidWorkKind;
  renewBudget?(input: {
    identity?: AgentIdentity;
    budgetReservation: ModelRouterReservation;
    extendTtlMs?: number;
  }): Promise<ModelRouterReservation>;
}

export function isGovernedProvider(provider: unknown): provider is GovernedProvider {
  return typeof provider === "object" && provider !== null && (provider as GovernedProvider).isGoverned === true;
}

function isOutputEvent(event: ProviderEvent): boolean {
  return (
    event.type === "content_delta" ||
    event.type === "tool_call_delta" ||
    event.type === "tool_call" ||
    event.type === "message_start" ||
    event.type === "continuation_required"
  );
}

function mergeUsage(existing: Usage | undefined, delta: Usage | undefined): Usage {
  if (!delta) return existing ?? {};
  if (!existing) return delta;
  const inputTokens = (existing.inputTokens ?? 0) > (delta.inputTokens ?? 0) ? existing.inputTokens : delta.inputTokens;
  const outputTokens = (existing.outputTokens ?? 0) > (delta.outputTokens ?? 0) ? existing.outputTokens : delta.outputTokens;
  const totalTokens = (existing.totalTokens ?? 0) > (delta.totalTokens ?? 0) ? existing.totalTokens : delta.totalTokens;
  const cost = delta.cost !== undefined ? delta.cost : existing.cost;
  return {
    ...delta,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

function extractRequest(result: ProviderRequest | { readonly request: ProviderRequest }): ProviderRequest {
  if (result && typeof result === "object" && "request" in result && result.request) {
    return result.request;
  }
  return result as ProviderRequest;
}

export function createGovernedProvider(options: GovernedProviderOptions): GovernedProvider {
  if (!options.router || typeof options.router.resolve !== "function") {
    throw new ModelRouterError("createGovernedProvider requires a valid ModelRouter instance", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
  }

  const id = options.id ?? options.model?.provider ?? "governed-provider";

  return {
    id,
    router: options.router,
    identity: options.identity,
    model: options.model,
    isGoverned: true,
    taskId: options.taskId,
    kind: options.kind,
    async renewBudget(input) {
      const ident = input.identity ?? options.identity;
      if (!ident) {
        throw new ModelRouterError("identity is required to renew budget", "ERR_PRISM_MODEL_ROUTER_IDENTITY");
      }
      const currentModel = options.model;
      if (!currentModel) {
        throw new ModelRouterError("model is required to renew budget", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
      }
      return await options.router.renewBudget({
        identity: ident,
        provider: currentModel.provider,
        model: currentModel.model,
        budgetReservation: input.budgetReservation,
        extendTtlMs: input.extendTtlMs,
        taskId: options.taskId,
        kind: options.kind,
      });
    },

    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      request.signal?.throwIfAborted();

      const identity = (request.metadata?.identity as AgentIdentity | undefined) ?? options.identity;
      if (!identity) {
        throw new ModelRouterError("identity is required for governed provider calls", "ERR_PRISM_MODEL_ROUTER_IDENTITY");
      }

      const taskId = (typeof request.metadata?.taskId === "string" ? request.metadata.taskId : undefined) ?? options.taskId;
      const kind = (request.metadata?.kind as PaidWorkKind | undefined) ?? options.kind;

      const initialModel = request.model ?? options.model;
      if (!initialModel) {
        throw new ModelRouterError("Model must be specified on request or governed provider options", "ERR_PRISM_MODEL_ROUTER_VALIDATION");
      }

      const rawFallbacks = (request.options?.extra?.fallbacks as readonly ModelConfig[] | undefined) ?? options.fallbacks ?? [];

      const candidateList: ModelConfig[] = [initialModel];
      for (const fb of rawFallbacks) {
        if (!candidateList.some((c) => c.provider === fb.provider && c.model === fb.model)) {
          candidateList.push(fb);
        }
      }

      let attemptIndex = 0;
      let lastAttemptError: unknown;

      while (attemptIndex < candidateList.length) {
        const primaryCandidate = candidateList[attemptIndex]!;
        const remainingFallbacks = candidateList.slice(attemptIndex + 1);
        attemptIndex++;

        const attemptId = randomUUID();
        request.signal?.throwIfAborted();

        let selection: ModelRouterResolveResult;
        try {
          selection = await options.router.resolve({
            model: primaryCandidate,
            identity,
            fallbacks: remainingFallbacks.length > 0 ? remainingFallbacks : undefined,
            residency: options.residency,
            region: options.region,
            maxCostUsd: options.maxCostUsd,
            maxTokens: options.maxTokens,
            taskId,
            kind,
            attemptId,
            signal: request.signal,
          });
        } catch (resolveError) {
          lastAttemptError = resolveError;
          if (attemptIndex < candidateList.length) {
            continue;
          }
          throw resolveError;
        }

        const selectedModel = selection.model;
        const selectedIdx = candidateList.findIndex((c) => c.provider === selectedModel.provider && c.model === selectedModel.model);
        if (selectedIdx >= attemptIndex) {
          attemptIndex = selectedIdx + 1;
        }

        const start = Date.now();
        let hasEmittedOutput = false;
        let accumulatedUsage: Usage | undefined;
        let invocationError: unknown;
        let streamAborted = false;
        let settled = false;

        const settle = async (outcome: "success" | "error" | "abort" | "early_close", err?: unknown) => {
          if (settled) return;
          settled = true;
          const durationMs = Math.max(0, Date.now() - start);
          let budgetCommitted = false;
          let budgetReleased = false;
          let unknownUsage = false;

          try {
            await options.router.recordOutcome({
              identity,
              provider: selectedModel.provider,
              model: selectedModel.model,
              success: outcome === "success",
              ...(selection.circuitProbeToken ? { circuitProbeToken: selection.circuitProbeToken } : {}),
              latencyMs: durationMs,
            });
          } catch {
            // Outcome recording failure should not mask primary failure
          }

          if (selection.budgetReservation) {
            if (!hasEmittedOutput && (outcome === "abort" || outcome === "error" || outcome === "early_close")) {
              try {
                if (typeof options.router.releaseBudget === "function") {
                  await options.router.releaseBudget({
                    identity,
                    provider: selectedModel.provider,
                    model: selectedModel.model,
                    budgetReservation: selection.budgetReservation,
                    taskId,
                    kind,
                  });
                  budgetReleased = true;
                } else {
                  await options.router.recordUsage({
                    identity,
                    provider: selectedModel.provider,
                    model: selectedModel.model,
                    tokens: 0,
                    costUsd: 0,
                    budgetReservation: selection.budgetReservation,
                    taskId,
                    kind,
                    attemptId,
                  });
                  budgetCommitted = true;
                }
              } catch {
                // best effort release
              }
            } else {
              const tokens =
                accumulatedUsage?.totalTokens ??
                (accumulatedUsage && (accumulatedUsage.inputTokens !== undefined || accumulatedUsage.outputTokens !== undefined)
                  ? (accumulatedUsage.inputTokens ?? 0) + (accumulatedUsage.outputTokens ?? 0)
                  : undefined);
              const costUsd = accumulatedUsage?.cost;

              if (tokens === undefined && costUsd === undefined) {
                unknownUsage = true;
              }

              try {
                await options.router.recordUsage({
                  identity,
                  provider: selectedModel.provider,
                  model: selectedModel.model,
                  tokens,
                  costUsd,
                  budgetReservation: selection.budgetReservation,
                  taskId,
                  kind,
                  attemptId,
                });
                budgetCommitted = true;
              } catch (usageErr) {
                if (outcome === "success") {
                  throw usageErr;
                }
              }
            }
          } else if (outcome === "success" || hasEmittedOutput) {
            const tokens =
              accumulatedUsage?.totalTokens ??
              (accumulatedUsage && (accumulatedUsage.inputTokens !== undefined || accumulatedUsage.outputTokens !== undefined)
                ? (accumulatedUsage.inputTokens ?? 0) + (accumulatedUsage.outputTokens ?? 0)
                : undefined);
            const costUsd = accumulatedUsage?.cost;
            if (tokens !== undefined || costUsd !== undefined) {
              try {
                await options.router.recordUsage({
                  identity,
                  provider: selectedModel.provider,
                  model: selectedModel.model,
                  tokens,
                  costUsd,
                  taskId,
                  kind,
                  attemptId,
                });
                budgetCommitted = true;
              } catch (usageErr) {
                if (outcome === "success") {
                  throw usageErr;
                }
              }
            }
          }

          try {
            await options.onSettlement?.({
              attemptId,
              identity,
              model: selectedModel,
              outcome,
              durationMs,
              usage: accumulatedUsage,
              error: err,
              budgetCommitted,
              budgetReleased,
              unknownUsage,
              taskId,
              kind,
            });
          } catch {
            // observer failure ignored
          }
        };

        const adaptedRequest: ProviderRequest = {
          ...request,
          model: selectedModel,
        };

        const finalRequest = selection.providerRequestPolicy
          ? extractRequest(await selection.providerRequestPolicy.apply({ request: adaptedRequest }))
          : adaptedRequest;

        const innerStream = selection.provider.generate(finalRequest);
        const iterator = innerStream[Symbol.asyncIterator]();

        let shouldFallback = false;

        try {
          while (true) {
            if (request.signal?.aborted) {
              streamAborted = true;
              throw request.signal.reason ?? new Error("aborted");
            }

            let nextResult: IteratorResult<ProviderEvent>;
            try {
              nextResult = await iterator.next();
            } catch (nextErr) {
              invocationError = nextErr;
              if (!hasEmittedOutput && attemptIndex < candidateList.length) {
                shouldFallback = true;
                break;
              }
              throw nextErr;
            }

            if (request.signal?.aborted) {
              streamAborted = true;
              throw request.signal.reason ?? new Error("aborted");
            }

            if (nextResult.done) {
              break;
            }

            const event = nextResult.value;

            if (event.type === "error") {
              invocationError = event.error;
              if (!hasEmittedOutput && attemptIndex < candidateList.length) {
                shouldFallback = true;
                break;
              }
              yield event;
              break;
            }

            if (event.type === "usage") {
              accumulatedUsage = mergeUsage(accumulatedUsage, event.usage);
            } else if (event.type === "done" && event.usage) {
              accumulatedUsage = mergeUsage(accumulatedUsage, event.usage);
            }

            if (isOutputEvent(event)) {
              hasEmittedOutput = true;
            }

            yield event;
          }

          if (shouldFallback) {
            await settle("error", invocationError);
            continue;
          }

          if (invocationError) {
            await settle("error", invocationError);
          } else {
            await settle("success");
          }
          return;
        } catch (iterErr) {
          if (streamAborted || (request.signal?.aborted && iterErr === request.signal.reason)) {
            await settle("abort", iterErr);
          } else if (shouldFallback) {
            await settle("error", invocationError);
            continue;
          } else {
            await settle("error", iterErr);
          }
          throw iterErr;
        } finally {
          if (!settled) {
            await settle("early_close");
          }
          try {
            await iterator.return?.();
          } catch {
            // ignore iterator close error
          }
        }
      }

      if (lastAttemptError) {
        throw lastAttemptError;
      }
    },
  };
}
