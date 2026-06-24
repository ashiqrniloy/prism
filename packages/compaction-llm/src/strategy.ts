import { createProviderRequestPolicyChain, createSessionEntry, mergeProviderRequestOptions, redactSecrets, resolveCredentialValue, type AIProvider, type CompactionContext, type CompactionResult, type CompactionStrategy, type CredentialRequest, type CredentialValueSource, type Message, type ModelConfig, type ProviderEvent, type ProviderRequest, type ProviderRequestOptions, type ProviderRequestPolicy } from "@arnilo/prism";
import { formatFileOperations } from "./file-ops.js";
import { prepareLlmCompaction, type LlmCompactionPreparation, type PrepareLlmCompactionOptions } from "./prepare.js";
import { SUMMARIZATION_SYSTEM_PROMPT, TURN_PREFIX_SYSTEM_PROMPT } from "./prompts.js";
import { serializeCompactionConversation, type SerializeCompactionConversationOptions } from "./serialize.js";

export interface LlmCompactionStrategyOptions extends PrepareLlmCompactionOptions, SerializeCompactionConversationOptions {
  readonly name?: string;
  readonly provider?: AIProvider;
  readonly summaryProvider?: AIProvider | ((credential: string | undefined) => AIProvider | Promise<AIProvider>);
  readonly model?: ModelConfig;
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
  readonly includeFileOperations?: boolean;
}

const DEFAULT_RESERVE_TOKENS = 16_384;

export function createLlmCompactionStrategy(options: LlmCompactionStrategyOptions): CompactionStrategy {
  const name = options.name ?? "llm-compaction";
  return {
    name,
    async compact(context) {
      throwIfAborted(context.signal);
      const prep = prepareLlmCompaction(context, options);
      const credential = await resolveCredentialValue(options.credential, options.credentialRequest ?? { provider: options.summaryModel?.provider ?? options.model?.provider ?? "compaction", name: "apiKey" });
      const provider = await resolveSummaryProvider(options, credential);
      const secrets = [...(context.secrets ?? options.secrets ?? []), credential];
      const summary = await summarizeHistory(context, prep, options, provider, secrets);
      const turnPrefix = prep.turnPrefixEntries.length ? await summarizeTurnPrefix(context, prep, options, provider, secrets) : "";
      const fileOps = options.includeFileOperations === false ? "" : formatFileOperations(prep.fileOperations);
      const combined = capSummary(redactSecrets([summary, turnPrefix && `**Turn Context (split turn):**\n\n${turnPrefix}`, fileOps].filter(Boolean).join("\n\n"), secrets), options.maxSummaryTokens ?? options.maxOutputTokens);
      const parentId = context.entries.at(-1)?.id;

      return {
        summary: combined,
        entries: [createSessionEntry({ sessionId: context.sessionId, parentId, kind: "compaction", summary: combined, data: { ...prep.data, strategy: name } })],
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
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.entriesToSummarize, { ...options, secrets });
  const sections = [
    prep.previousSummary && `<previous-summary>\n${prep.previousSummary}\n</previous-summary>`,
    `<conversation>\n${conversation}\n</conversation>`,
    options.customInstructions && `Additional focus: ${options.customInstructions}`,
  ].filter(Boolean).join("\n\n");

  return runSummaryProvider(context, options, provider, SUMMARIZATION_SYSTEM_PROMPT, sections, 0.8, secrets);
}

async function summarizeTurnPrefix(
  context: CompactionContext,
  prep: LlmCompactionPreparation,
  options: LlmCompactionStrategyOptions,
  provider: AIProvider,
  secrets: readonly (string | undefined)[],
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.turnPrefixEntries, { ...options, secrets });
  const prompt = [`<conversation>\n${conversation}\n</conversation>`, options.customInstructions && `Additional focus: ${options.customInstructions}`].filter(Boolean).join("\n\n");
  return runSummaryProvider(context, options, provider, TURN_PREFIX_SYSTEM_PROMPT, prompt, 0.5, secrets);
}

async function runSummaryProvider(
  context: CompactionContext,
  options: LlmCompactionStrategyOptions,
  provider: AIProvider,
  systemPrompt: string,
  prompt: string,
  reserveRatio: number,
  secrets: readonly (string | undefined)[],
): Promise<string> {
  throwIfAborted(context.signal);
  const text: string[] = [];
  const errors: string[] = [];
  let request: ProviderRequest = {
    model: withMaxTokens(summaryModel(options), outputBudget(options, reserveRatio)),
    messages: [
      { role: "system", content: [{ type: "text", text: systemPrompt }] },
      { role: "user", content: [{ type: "text", text: prompt }] },
    ] satisfies readonly Message[],
    options: mergeProviderRequestOptions(options.providerOptions, options.thinkingLevel ? { extra: { thinkingLevel: options.thinkingLevel } } : undefined),
    signal: context.signal,
  };

  const policy = normalizePolicies(options.providerRequestPolicies);
  if (policy) {
    const result = await createProviderRequestPolicyChain(policy).apply({ request, sessionId: context.sessionId, metadata: context.metadata, signal: context.signal });
    request = "request" in result ? result.request : result;
    secrets = [...secrets, ...("request" in result ? result.secrets ?? [] : [])];
  }

  for await (const event of provider.generate(request)) {
    throwIfAborted(context.signal);
    collectSummaryEvent(event, text, errors);
  }

  if (errors.length) throw new Error(`Summarization failed: ${redactSecrets(errors.join("; "), secrets)}`);
  const summary = capSummary(text.join("").trim(), options.maxSummaryTokens ?? options.maxOutputTokens);
  if (!summary) throw new Error("Summarization failed: empty response");
  return summary;
}

function collectSummaryEvent(event: ProviderEvent, text: string[], errors: string[]): void {
  if (event.type === "content_delta" && event.content.type === "text") text.push(event.content.text);
  if (event.type === "error") errors.push(event.error.message);
}

function outputBudget(options: LlmCompactionStrategyOptions, reserveRatio: number): number {
  const reserve = options.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  return options.maxSummaryTokens ?? options.maxOutputTokens ?? Math.min(Math.floor(reserve * reserveRatio), summaryModel(options).limits?.maxOutputTokens ?? Number.POSITIVE_INFINITY);
}

function withMaxTokens(model: ModelConfig, maxTokens: number): ModelConfig {
  return Number.isFinite(maxTokens) ? { ...model, parameters: { ...model.parameters, maxTokens } } : model;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Compaction aborted");
}

function summaryModel(options: LlmCompactionStrategyOptions): ModelConfig {
  const model = options.summaryModel ?? options.model;
  if (!model) throw new Error("LLM compaction requires summaryModel or model");
  return model;
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

function capSummary(summary: string, maxTokens: number | undefined): string {
  const maxChars = maxTokens ? maxTokens * 4 : undefined;
  if (!maxChars || summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars)}\n[..., ${summary.length - maxChars} characters truncated]`;
}
