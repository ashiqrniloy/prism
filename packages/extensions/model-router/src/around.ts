import { randomUUID } from "node:crypto";
import {
  HookError,
  type HookContext,
  type ModelConfig,
  type PackageAPI,
  type ProviderEvent,
  type ProviderRequest,
  type Usage,
} from "@arnilo/prism";
import type { AgentIdentity } from "@arnilo/prism-extensions/governance";
import type { ModelRouterConfig } from "./config.js";
import { ModelRouterError } from "./router/errors.js";
import type { ModelRouter, ModelRouterResolveResult, PaidWorkKind } from "./router/types.js";

const PACKAGE_NAME = "@arnilo/prism-extensions/model-router";

export function isOutputEvent(event: ProviderEvent): boolean {
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

export function createModelCallAroundHandler(
  prism: PackageAPI<ModelRouterConfig>,
  router: ModelRouter,
  candidateConfigs: readonly ModelConfig[],
) {
  return async (
    request: ProviderRequest,
    next: (req: ProviderRequest) => Promise<AsyncIterable<ProviderEvent>>,
    context: HookContext,
  ): Promise<AsyncIterable<ProviderEvent>> => {
    request.signal?.throwIfAborted();

    const governanceIdentity = prism.services.consume<{ get(sessionId: string): AgentIdentity | undefined }>("governance.identity");
    const verifiedIdentity = governanceIdentity?.get(context.sessionId);
    const identity: AgentIdentity = verifiedIdentity ?? {
      tenantId: context.session?.principal?.id ?? "__default__",
      principal: {
        id: context.session?.principal?.id ?? "__default__",
        kind: context.session?.principal?.kind ?? "agent",
      },
      scopes: ["model:route"],
      verified: true,
      issuedAt: new Date().toISOString(),
    };

    const candidateList: ModelConfig[] = [...candidateConfigs];
    const rawFallbacks = request.options?.extra?.fallbacks as readonly ModelConfig[] | undefined;
    if (rawFallbacks) {
      for (const fb of rawFallbacks) {
        if (!candidateList.some((c) => c.provider === fb.provider && c.model === fb.model)) {
          candidateList.push(fb);
        }
      }
    }

    return (async function* generateRoutedTurn(): AsyncIterable<ProviderEvent> {
      let attemptIndex = 0;
      let lastAttemptError: unknown;
      let calledNext = false;
      let attemptCount = 0;

      while (attemptIndex < candidateList.length) {
        const primaryCandidate = candidateList[attemptIndex]!;
        const remainingFallbacks = candidateList.slice(attemptIndex + 1);
        attemptIndex++;
        attemptCount++;
        const attemptId = randomUUID();
        request.signal?.throwIfAborted();

        let selection: ModelRouterResolveResult;
        try {
          selection = await router.resolve({
            model: primaryCandidate,
            identity,
            fallbacks: remainingFallbacks.length > 0 ? remainingFallbacks : undefined,
            residency: prism.config.residency,
            maxTokens: (request.options?.extra?.maxTokens as number | undefined) ?? primaryCandidate.limits?.maxOutputTokens,
            maxCostUsd: request.options?.extra?.maxCostUsd as number | undefined,
            taskId: typeof request.metadata?.taskId === "string" ? request.metadata.taskId : undefined,
            kind: request.metadata?.kind as PaidWorkKind | undefined,
            attemptId,
            signal: request.signal,
          });
        } catch (resolveError) {
          lastAttemptError = resolveError;
          context.emit("router.decision", {
            candidate: { provider: primaryCandidate.provider, model: primaryCandidate.model },
            outcome: "denied",
            reason: resolveError instanceof ModelRouterError ? resolveError.code : String(resolveError),
            attempt: attemptCount,
            attemptId,
          });
          if (attemptIndex < candidateList.length) {
            continue;
          }
          if (resolveError instanceof ModelRouterError) {
            throw new HookError(resolveError.message, { owner: PACKAGE_NAME, hook: "model.call", code: resolveError.code });
          }
          throw resolveError;
        }

        const selectedModel = selection.model;
        const selectedIdx = candidateList.findIndex((c) => c.provider === selectedModel.provider && c.model === selectedModel.model);
        if (selectedIdx >= attemptIndex) {
          attemptIndex = selectedIdx + 1;
        }

        context.emit("router.decision", {
          candidate: { provider: selectedModel.provider, model: selectedModel.model },
          outcome: "selected",
          attempt: attemptCount,
          attemptId,
        });

        const start = Date.now();
        let hasEmittedOutput = false;
        let accumulatedUsage: Usage | undefined;
        let invocationError: unknown;
        let streamAborted = false;
        let settled = false;

        const settle = async (outcome: "success" | "error" | "abort" | "early_close", _err?: unknown) => {
          if (settled) return;
          settled = true;
          const durationMs = Math.max(0, Date.now() - start);

          try {
            await router.recordOutcome({
              identity,
              provider: selectedModel.provider,
              model: selectedModel.model,
              success: outcome === "success",
              ...(selection.circuitProbeToken ? { circuitProbeToken: selection.circuitProbeToken } : {}),
              latencyMs: durationMs,
            });
          } catch {
            // best-effort outcome recording
          }

          if (selection.budgetReservation) {
            if (!hasEmittedOutput && (outcome === "abort" || outcome === "error" || outcome === "early_close")) {
              try {
                await router.releaseBudget({
                  identity,
                  provider: selectedModel.provider,
                  model: selectedModel.model,
                  budgetReservation: selection.budgetReservation,
                  taskId: typeof request.metadata?.taskId === "string" ? request.metadata.taskId : undefined,
                  kind: request.metadata?.kind as PaidWorkKind | undefined,
                });
              } catch {
                // best-effort budget release
              }
            } else {
              const tokens =
                accumulatedUsage?.totalTokens ??
                (accumulatedUsage && (accumulatedUsage.inputTokens !== undefined || accumulatedUsage.outputTokens !== undefined)
                  ? (accumulatedUsage.inputTokens ?? 0) + (accumulatedUsage.outputTokens ?? 0)
                  : undefined);
              const costUsd = accumulatedUsage?.cost;
              try {
                await router.recordUsage({
                  identity,
                  provider: selectedModel.provider,
                  model: selectedModel.model,
                  tokens,
                  costUsd,
                  budgetReservation: selection.budgetReservation,
                  taskId: typeof request.metadata?.taskId === "string" ? request.metadata.taskId : undefined,
                  kind: request.metadata?.kind as PaidWorkKind | undefined,
                  attemptId,
                });
              } catch (usageErr) {
                if (outcome === "success") throw usageErr;
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
                await router.recordUsage({
                  identity,
                  provider: selectedModel.provider,
                  model: selectedModel.model,
                  tokens,
                  costUsd,
                  taskId: typeof request.metadata?.taskId === "string" ? request.metadata.taskId : undefined,
                  kind: request.metadata?.kind as PaidWorkKind | undefined,
                  attemptId,
                });
              } catch (usageErr) {
                if (outcome === "success") throw usageErr;
              }
            }
          }
        };

        const isSameProvider = selectedModel.provider === request.model.provider;
        let innerStream: AsyncIterable<ProviderEvent>;
        const adaptedRequest: ProviderRequest = {
          ...request,
          model: selectedModel,
        };
        const finalRequest = selection.modelRequestTransform ? await selection.modelRequestTransform(adaptedRequest) : adaptedRequest;

        try {
          if (isSameProvider && !calledNext) {
            calledNext = true;
            innerStream = await next(finalRequest);
          } else {
            innerStream = prism.models.client(selectedModel).generate(finalRequest);
          }
        } catch (callErr) {
          invocationError = callErr;
          await settle("error", callErr);
          context.emit("router.decision", {
            candidate: { provider: selectedModel.provider, model: selectedModel.model },
            outcome: "error",
            reason: String(callErr),
            attempt: attemptCount,
            attemptId,
          });
          lastAttemptError = callErr;
          if (attemptIndex < candidateList.length) {
            continue;
          }
          throw callErr;
        }

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
            } else if (event.type === "done") {
              if (event.usage) accumulatedUsage = mergeUsage(accumulatedUsage, event.usage);
              await settle("success");
            }

            if (isOutputEvent(event)) {
              hasEmittedOutput = true;
            }

            yield event;
          }

          if (shouldFallback) {
            await settle("error", invocationError);
            context.emit("router.decision", {
              candidate: { provider: selectedModel.provider, model: selectedModel.model },
              outcome: "error",
              reason: String(invocationError),
              attempt: attemptCount,
              attemptId,
            });
            lastAttemptError = invocationError;
            continue;
          }

          if (invocationError) {
            await settle("error", invocationError);
          } else if (!settled) {
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
        if (lastAttemptError instanceof ModelRouterError) {
          throw new HookError(lastAttemptError.message, { owner: PACKAGE_NAME, hook: "model.call", code: lastAttemptError.code });
        }
        throw lastAttemptError;
      }
    })();
  };
}
