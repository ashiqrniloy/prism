import { applyThinkingLevel, createProviderRequestPolicyChain, createSessionEntry, redactSecrets, resolveCredentialValue, resolveUseCaseModel, thinkingFamilyForModel, type AIProvider, type CompactionContext, type CompactionResult, type CompactionStrategy, type CredentialRequest, type CredentialValueSource, type Message, type ModelConfig, type ProviderRequest, type ProviderRequestOptions, type ProviderRequestPolicy } from "@arnilo/prism";
import { formatFileOperations } from "./file-ops.js";
import {
  DEFAULT_MAX_SUMMARY_ERROR_BYTES,
  DEFAULT_MAX_SUMMARY_TOKENS,
  DEFAULT_RESERVE_TOKENS,
  HARD_MAX_SUMMARY_ERROR_BYTES,
  HARD_MAX_SUMMARY_TOKENS,
  HARD_RESERVE_TOKENS,
  truncateUtf8,
  validateCompactionLimit,
} from "./limits.js";
import { prepareLlmCompaction, type LlmCompactionPreparation, type PrepareLlmCompactionOptions } from "./prepare.js";
import { SUMMARIZATION_SYSTEM_PROMPT, TURN_PREFIX_SYSTEM_PROMPT } from "./prompts.js";
import { serializeCompactionConversation, type SerializeCompactionConversationOptions } from "./serialize.js";

export interface LlmCompactionStrategyOptions extends PrepareLlmCompactionOptions, SerializeCompactionConversationOptions {
  readonly name?: string;
  readonly provider?: AIProvider;
  readonly summaryProvider?: AIProvider | ((credential: string | undefined) => AIProvider | Promise<AIProvider>);
  readonly model?: ModelConfig;
  /** Explicit summary model. When omitted, falls back to {@link model} (session / host fallback slot). */
  readonly summaryModel?: ModelConfig;
  readonly providerOptions?: ProviderRequestOptions;
  readonly providerRequestPolicies?: ProviderRequestPolicy | readonly ProviderRequestPolicy[];
  readonly credential?: CredentialValueSource;
  readonly credentialRequest?: CredentialRequest;
  readonly customInstructions?: string;
  readonly thinkingLevel?: string;
  readonly reserveTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxSummaryTokens?: number;
  readonly maxErrorBytes?: number;
  readonly includeFileOperations?: boolean;
}

interface ResolvedSummaryLimits {
  readonly maxSummaryTokens: number;
  readonly reserveTokens: number;
  readonly maxErrorBytes: number;
}

export function createLlmCompactionStrategy(options: LlmCompactionStrategyOptions): CompactionStrategy {
  const name = options.name ?? "llm-compaction";
  const limits = resolveSummaryLimits(options);
  return {
    name,
    async compact(context) {
      throwIfAborted(context.signal);
      const prep = prepareLlmCompaction(context, options);
      const credential = await resolveCredentialValue(options.credential, options.credentialRequest ?? { provider: options.summaryModel?.provider ?? options.model?.provider ?? "compaction", name: "apiKey" });
      const secrets = [...(context.secrets ?? []), ...(options.secrets ?? []), credential];
      let provider: AIProvider;
      try {
        provider = await resolveSummaryProvider(options, credential);
      } catch (error) {
        throw new Error(`Summarization failed: ${safeError(error, secrets, limits.maxErrorBytes)}`);
      }
      const summary = await summarizeHistory(context, prep, options, provider, secrets, limits);
      const turnPrefix = prep.turnPrefixEntries.length ? await summarizeTurnPrefix(context, prep, options, provider, secrets, limits) : "";
      const fileOps = options.includeFileOperations === false ? "" : formatFileOperations(prep.fileOperations);
      const combined = capSummary(redactSecrets([summary, turnPrefix && `**Turn Context (split turn):**\n\n${turnPrefix}`, fileOps].filter(Boolean).join("\n\n"), secrets), limits.maxSummaryTokens);
      const parentId = context.entries.at(-1)?.id;

      return {
        summary: combined,
        entries: [createSessionEntry({ sessionId: context.sessionId, parentId, kind: "compaction", summary: combined, data: redactedCompactionData({ ...prep.data, strategy: name }, secrets) })],
      } satisfies CompactionResult;
    },
  };
}

async function summarizeHistory(
  context: CompactionContext,
  prep: LlmCompactionPreparation,
  options: LlmCompactionStrategyOptions,
  provider: AIProvider,
  secrets: readonly (string | undefined)[],
  limits: ResolvedSummaryLimits,
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.entriesToSummarize, { ...options, secrets });
  const sections = [
    prep.previousSummary && `<previous-summary>\n${prep.previousSummary}\n</previous-summary>`,
    `<conversation>\n${conversation}\n</conversation>`,
    options.customInstructions && `Additional focus: ${redactSecrets(options.customInstructions, secrets)}`,
  ].filter(Boolean).join("\n\n");

  return runSummaryProvider(context, options, provider, SUMMARIZATION_SYSTEM_PROMPT, sections, 0.8, secrets, limits);
}

async function summarizeTurnPrefix(
  context: CompactionContext,
  prep: LlmCompactionPreparation,
  options: LlmCompactionStrategyOptions,
  provider: AIProvider,
  secrets: readonly (string | undefined)[],
  limits: ResolvedSummaryLimits,
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.turnPrefixEntries, { ...options, secrets });
  const prompt = [`<conversation>\n${conversation}\n</conversation>`, options.customInstructions && `Additional focus: ${redactSecrets(options.customInstructions, secrets)}`].filter(Boolean).join("\n\n");
  return runSummaryProvider(context, options, provider, TURN_PREFIX_SYSTEM_PROMPT, prompt, 0.5, secrets, limits);
}

async function runSummaryProvider(
  context: CompactionContext,
  options: LlmCompactionStrategyOptions,
  provider: AIProvider,
  systemPrompt: string,
  prompt: string,
  reserveRatio: number,
  secrets: readonly (string | undefined)[],
  limits: ResolvedSummaryLimits,
): Promise<string> {
  throwIfAborted(context.signal);
  const text: string[] = [];
  const maxChars = limits.maxSummaryTokens * 4;
  const providerAbort = new AbortController();
  let retainedChars = 0;
  let truncated = false;
  let eventCount = 0;
  const model = summaryRequestModel(options, reserveRatio, limits);
  const thinkingFamily = thinkingFamilyForModel(model);
  const providerSignal = context.signal ? AbortSignal.any([context.signal, providerAbort.signal]) : providerAbort.signal;
  let request: ProviderRequest = {
    model,
    messages: [
      { role: "system", content: [{ type: "text", text: systemPrompt }] },
      { role: "user", content: [{ type: "text", text: prompt }] },
    ] satisfies readonly Message[],
    options: options.thinkingLevel
      ? applyThinkingLevel(
          options.providerOptions,
          options.thinkingLevel,
          // Explicit host thinkingLevel must not become inert: unknown/non-reasoning
          // models fall back to the portable reasoning_effort compat field.
          thinkingFamily === "noop" ? "reasoning_effort" : thinkingFamily,
        )
      : options.providerOptions,
    signal: providerSignal,
  };

  const policy = normalizePolicies(options.providerRequestPolicies);
  if (policy) {
    try {
      const result = await createProviderRequestPolicyChain(policy).apply({ request, sessionId: context.sessionId, metadata: context.metadata, signal: context.signal });
      request = "request" in result ? result.request : result;
      secrets = [...secrets, ...("request" in result ? result.secrets ?? [] : [])];
    } catch (error) {
      throw new Error(`Summarization failed: ${safeError(error, secrets, limits.maxErrorBytes)}`);
    }
  }
  request = { ...request, model: requireFiniteRequestBudget(request.model, limits), signal: providerSignal };

  try {
    for await (const event of provider.generate(request)) {
      throwIfAborted(context.signal);
      eventCount += 1;
      if (eventCount > maxChars + 1024) throw new Error("Summarization failed: provider event limit exceeded");
      if (event.type === "error") {
        providerAbort.abort();
        throw new Error(`Summarization failed: ${safeError(event.error, secrets, limits.maxErrorBytes)}`);
      }
      if (event.type !== "content_delta" || event.content.type !== "text") continue;
      const safe = redactSecrets(event.content.text, secrets);
      const remaining = maxChars - retainedChars;
      if (safe.length > remaining) {
        if (remaining > 0) text.push(safeSlice(safe, remaining));
        retainedChars = maxChars;
        truncated = true;
        providerAbort.abort();
        break;
      }
      if (safe) {
        text.push(safe);
        retainedChars += safe.length;
      }
    }
  } catch (error) {
    throwIfAborted(context.signal);
    if (error instanceof Error && error.message.startsWith("Summarization failed:")) throw error;
    throw new Error(`Summarization failed: ${safeError(error, secrets, limits.maxErrorBytes)}`);
  }

  const summary = capSummary(text.join("").trim(), limits.maxSummaryTokens, truncated);
  if (!summary) throw new Error("Summarization failed: empty response");
  return summary;
}

function summaryRequestModel(options: LlmCompactionStrategyOptions, reserveRatio: number, limits: ResolvedSummaryLimits): ModelConfig {
  return withMaxTokens(summaryModel(options), outputBudget(options, reserveRatio, limits));
}

function outputBudget(options: LlmCompactionStrategyOptions, reserveRatio: number, limits: ResolvedSummaryLimits): number {
  if (options.maxSummaryTokens !== undefined || options.maxOutputTokens !== undefined) return limits.maxSummaryTokens;
  const modelLimit = summaryModel(options).limits?.maxOutputTokens;
  const finiteModelLimit = Number.isSafeInteger(modelLimit) && (modelLimit as number) > 0 ? modelLimit as number : limits.maxSummaryTokens;
  return Math.min(Math.max(1, Math.floor(limits.reserveTokens * reserveRatio)), finiteModelLimit, limits.maxSummaryTokens);
}

function withMaxTokens(model: ModelConfig, maxTokens: number): ModelConfig {
  return { ...model, parameters: { ...model.parameters, maxTokens } };
}

function requireFiniteRequestBudget(model: ModelConfig, limits: ResolvedSummaryLimits): ModelConfig {
  const maxTokens = model.parameters?.maxTokens;
  if (!Number.isSafeInteger(maxTokens) || (maxTokens as number) < 1 || (maxTokens as number) > HARD_MAX_SUMMARY_TOKENS) {
    throw new RangeError(`provider request maxTokens must be a positive safe integer at most ${HARD_MAX_SUMMARY_TOKENS}`);
  }
  return withMaxTokens(model, Math.min(maxTokens as number, limits.maxSummaryTokens));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Compaction aborted");
}

function summaryModel(options: LlmCompactionStrategyOptions): ModelConfig {
  const resolved = resolveUseCaseModel({
    configured: options.summaryModel,
    sessionModel: options.model,
  });
  if (!resolved) throw new Error("LLM compaction requires summaryModel or model");
  return resolved.model;
}

async function resolveSummaryProvider(options: LlmCompactionStrategyOptions, credential: string | undefined): Promise<AIProvider> {
  const provider = options.summaryProvider ?? options.provider;
  if (!provider) throw new Error("LLM compaction requires summaryProvider or provider");
  return typeof provider === "function" ? provider(credential) : provider;
}

function normalizePolicies(policy: ProviderRequestPolicy | readonly ProviderRequestPolicy[] | undefined): readonly ProviderRequestPolicy[] | undefined {
  if (!policy) return undefined;
  return Array.isArray(policy) ? policy : [policy as ProviderRequestPolicy];
}

function resolveSummaryLimits(options: LlmCompactionStrategyOptions): ResolvedSummaryLimits {
  if (options.maxOutputTokens !== undefined) validateCompactionLimit("maxOutputTokens", options.maxOutputTokens, HARD_MAX_SUMMARY_TOKENS);
  if (options.maxSummaryTokens !== undefined) validateCompactionLimit("maxSummaryTokens", options.maxSummaryTokens, HARD_MAX_SUMMARY_TOKENS);
  return {
    maxSummaryTokens: options.maxSummaryTokens ?? options.maxOutputTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
    reserveTokens: validateCompactionLimit("reserveTokens", options.reserveTokens ?? DEFAULT_RESERVE_TOKENS, HARD_RESERVE_TOKENS),
    maxErrorBytes: validateCompactionLimit("maxErrorBytes", options.maxErrorBytes ?? DEFAULT_MAX_SUMMARY_ERROR_BYTES, HARD_MAX_SUMMARY_ERROR_BYTES),
  };
}

function redactedCompactionData(data: LlmCompactionPreparation["data"], secrets: readonly (string | undefined)[]): LlmCompactionPreparation["data"] {
  return {
    ...data,
    readFiles: data.readFiles?.map((path) => redactSecrets(path, secrets)),
    modifiedFiles: data.modifiedFiles?.map((path) => redactSecrets(path, secrets)),
  };
}

function safeError(error: unknown, secrets: readonly (string | undefined)[], maxBytes: number): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "Provider failed";
  return truncateUtf8(redactSecrets(message, secrets), maxBytes) || "Provider failed";
}

function safeSlice(text: string, maxChars: number): string {
  let end = Math.min(text.length, maxChars);
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

function capSummary(summary: string, maxTokens: number, truncated = false): string {
  const maxChars = maxTokens * 4;
  if (!truncated && summary.length <= maxChars) return summary;
  const marker = "\n[..., characters truncated]";
  if (marker.length >= maxChars) return safeSlice(summary, maxChars);
  return `${safeSlice(summary, maxChars - marker.length)}${marker}`;
}
