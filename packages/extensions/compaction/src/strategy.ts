import {
  type CompactionContext,
  type CompactionResult,
  type Compactor,
  createSessionEntry,
  type Message,
  type ModelClient,
  type ProviderRequest,
  redactSecrets,
} from "@arnilo/prism";
import { applyDefaultProviderRequestOptions } from "@arnilo/prism/provider-kit";
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
import { type LlmCompactionPreparation, type PrepareLlmCompactionOptions, prepareLlmCompaction } from "./prepare.js";
import { SUMMARIZATION_SYSTEM_PROMPT, TURN_PREFIX_SYSTEM_PROMPT } from "./prompts.js";
import { type SerializeCompactionConversationOptions, serializeCompactionConversation } from "./serialize.js";

/** A synchronous or asynchronous rewrite of the summarization request. */
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split, no compat baseline tracks it,
 * and no package subpath exports it. Removed at the next breaking cut
 * (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export type ProviderRequestTransform = (request: ProviderRequest) => ProviderRequest | Promise<ProviderRequest>;

/**
 * The summary model call for one compaction. `maxTokens` is the output budget the compactor computed for
 * this call; return a client whose model carries at most that budget, clamped to the model's own limit.
 * The package wires this to `prism.models.client`, a test to a scripted provider.
 */
export type SummaryClientFor = (maxTokens: number, context: CompactionContext) => ModelClient;

export interface LlmCompactorOptions extends PrepareLlmCompactionOptions, SerializeCompactionConversationOptions {
  readonly clientFor: SummaryClientFor;
  readonly name?: string;
  readonly summaryPrompt?: string;
  readonly customInstructions?: string;
  readonly reserveTokens?: number;
  readonly maxSummaryTokens?: number;
  readonly maxErrorBytes?: number;
  readonly includeFileOperations?: boolean;
}

interface ResolvedSummaryLimits {
  readonly maxSummaryTokens: number;
  readonly reserveTokens: number;
  readonly maxErrorBytes: number;
}

export function createLlmCompactor(options: LlmCompactorOptions): Compactor {
  const name = options.name ?? "llm-compaction";
  const limits = resolveSummaryLimits(options);
  return {
    name,
    async compact(context) {
      throwIfAborted(context.signal);
      const prep = prepareLlmCompaction(context, options);
      const secrets = context.secrets ?? [];
      const summary = await summarizeHistory(context, prep, options, secrets, limits);
      const turnPrefix = prep.turnPrefixEntries.length ? await summarizeTurnPrefix(context, prep, options, secrets, limits) : "";
      const fileOps = options.includeFileOperations === false ? "" : formatFileOperations(prep.fileOperations);
      const combined = capSummary(
        redactSecrets(
          [summary, turnPrefix && `**Turn Context (split turn):**\n\n${turnPrefix}`, fileOps].filter(Boolean).join("\n\n"),
          secrets,
        ),
        limits.maxSummaryTokens,
      );
      const parentId = context.entries.at(-1)?.id;

      return {
        summary: combined,
        entries: [
          createSessionEntry({
            sessionId: context.sessionId,
            parentId,
            kind: "compaction",
            summary: combined,
            data: redactedCompactionData(
              { ...prep.data, strategy: name, ...(context.trigger ? { trigger: context.trigger } : {}) },
              secrets,
            ),
          }),
        ],
      } satisfies CompactionResult;
    },
  };
}

async function summarizeHistory(
  context: CompactionContext,
  prep: LlmCompactionPreparation,
  options: LlmCompactorOptions,
  secrets: readonly (string | undefined)[],
  limits: ResolvedSummaryLimits,
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.entriesToSummarize, { ...options, secrets });
  const sections = [
    prep.previousSummary && `<previous-summary>\n${prep.previousSummary}\n</previous-summary>`,
    `<conversation>\n${conversation}\n</conversation>`,
    options.customInstructions && `Additional focus: ${redactSecrets(options.customInstructions, secrets)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return runSummaryProvider(context, options, options.summaryPrompt ?? SUMMARIZATION_SYSTEM_PROMPT, sections, 0.8, secrets, limits);
}

async function summarizeTurnPrefix(
  context: CompactionContext,
  prep: LlmCompactionPreparation,
  options: LlmCompactorOptions,
  secrets: readonly (string | undefined)[],
  limits: ResolvedSummaryLimits,
): Promise<string> {
  const conversation = serializeCompactionConversation(prep.turnPrefixEntries, { ...options, secrets });
  const prompt = [
    `<conversation>\n${conversation}\n</conversation>`,
    options.customInstructions && `Additional focus: ${redactSecrets(options.customInstructions, secrets)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return runSummaryProvider(context, options, TURN_PREFIX_SYSTEM_PROMPT, prompt, 0.5, secrets, limits);
}

async function runSummaryProvider(
  context: CompactionContext,
  options: LlmCompactorOptions,
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
  const client = options.clientFor(outputBudget(options, reserveRatio, limits), context);
  const providerSignal = context.signal ? AbortSignal.any([context.signal, providerAbort.signal]) : providerAbort.signal;
  let request: ProviderRequest = {
    model: client.model,
    messages: [
      { role: "system", content: [{ type: "text", text: systemPrompt }] },
      { role: "user", content: [{ type: "text", text: prompt }] },
    ] satisfies readonly Message[],
    signal: providerSignal,
  };
  request = applyDefaultProviderRequestOptions(request, { sessionId: context.sessionId });

  try {
    for await (const event of client.generate({ messages: request.messages, options: request.options, signal: providerSignal })) {
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

/**
 * Output budget for one summary call: the configured cap when set, else the reserve budget's share for
 * this call's ratio, never above the cap. The caller's `clientFor` clamps it to the model's own limit.
 */
function outputBudget(options: LlmCompactorOptions, reserveRatio: number, limits: ResolvedSummaryLimits): number {
  if (options.maxSummaryTokens !== undefined) return limits.maxSummaryTokens;
  return Math.min(Math.max(1, Math.floor(limits.reserveTokens * reserveRatio)), limits.maxSummaryTokens);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Compaction aborted");
}

function resolveSummaryLimits(options: LlmCompactorOptions): ResolvedSummaryLimits {
  if (options.maxSummaryTokens !== undefined)
    validateCompactionLimit("maxSummaryTokens", options.maxSummaryTokens, HARD_MAX_SUMMARY_TOKENS);
  return {
    maxSummaryTokens: options.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
    reserveTokens: validateCompactionLimit("reserveTokens", options.reserveTokens ?? DEFAULT_RESERVE_TOKENS, HARD_RESERVE_TOKENS),
    maxErrorBytes: validateCompactionLimit(
      "maxErrorBytes",
      options.maxErrorBytes ?? DEFAULT_MAX_SUMMARY_ERROR_BYTES,
      HARD_MAX_SUMMARY_ERROR_BYTES,
    ),
  };
}

function redactedCompactionData(
  data: LlmCompactionPreparation["data"],
  secrets: readonly (string | undefined)[],
): LlmCompactionPreparation["data"] {
  return {
    ...data,
    readFiles: data.readFiles?.map((path) => redactSecrets(path, secrets)),
    modifiedFiles: data.modifiedFiles?.map((path) => redactSecrets(path, secrets)),
  };
}

function safeError(error: unknown, secrets: readonly (string | undefined)[], maxBytes: number): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Provider failed";
  return truncateUtf8(redactSecrets(message, secrets), maxBytes) || "Provider failed";
}

/** The reason one `compaction.fallback` event carries: redacted and bounded, never the raw error. */
export function fallbackReason(
  error: unknown,
  secrets: readonly (string | undefined)[],
  maxBytes = DEFAULT_MAX_SUMMARY_ERROR_BYTES,
): string {
  return safeError(error, secrets, validateCompactionLimit("maxErrorBytes", maxBytes, HARD_MAX_SUMMARY_ERROR_BYTES));
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
