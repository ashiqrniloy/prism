# LLM compaction package

## What it does
`@arnilo/prism-compaction-llm` is an optional provider-backed compaction package. It prepares branch history, calls an explicit summary provider/model, and returns a standard Prism `CompactionStrategy`. The core default compaction remains local and conservative.

## When to use it
Use it when a host wants model-generated summaries while preserving raw append-only session history. Do not use it as a core default, provider SDK loader, hidden credential discovery layer, vector memory, or store rewrite.

## Inputs / request
Key exports:

| Export | Purpose |
| --- | --- |
| `createLlmCompactionStrategy(options)` | Returns a provider-backed `CompactionStrategy`. |
| `createLlmCompactionExtension(options)` | Registers the strategy into an explicit extension kernel compaction registry. |
| `prepareLlmCompaction(context, options?)` | Splits branch entries into summary input, kept suffix, optional split-turn prefix, file details, and compaction data. |
| `findLlmCompactionCutPoint(entries, options?)` | Finds the last entry covered by a summary using approximate token budgets. |
| `serializeCompactionConversation(entries, options?)` | Serializes entries with role labels and tool-result truncation, then redacts known secrets. |
| `collectFileOperations(messages)` / `formatFileOperations(details)` | Extracts and formats `read`, `write`, and `edit` tool-call paths. |
| `estimateTextTokens`, `estimateMessageTokens`, `estimateEntryTokens` | Cheap chars/4 token estimates. |
| prompt constants | Structured markdown summary prompts for host override/reference. |

`LlmCompactionStrategyOptions`:

| Field | Purpose |
| --- | --- |
| `provider` / `summaryProvider` | Explicit `AIProvider`, or factory receiving a resolved credential. |
| `model` / `summaryModel` | Summary `ModelConfig`. `summaryModel` wins; `model` is the session/host fallback via `resolveUseCaseModel`. See [Use-case model selection](use-case-model-selection.md). |
| `credential`, `credentialRequest` | Optional per-call credential resolution for provider factories. |
| `providerOptions` | Generic `ProviderRequest.options`, including cache fields. |
| `providerRequestPolicies` | Optional Prism provider request policies applied before the summary call. |
| `customInstructions` | Additional summary focus appended to prompts. |
| `thinkingLevel` | Mapped into `ProviderRequest.options.compat` via `applyThinkingLevel` / `thinkingFamilyForModel` (not inert `extra.thinkingLevel`). See [Thinking and reasoning](thinking-and-reasoning.md). |
| `reserveTokens` | Output budget basis; defaults to `16384`, hard cap `131072`. |
| `keepRecentTokens` | Approximate recent-token budget; defaults to `20000`. |
| `maxSummaryTokens` / `maxOutputTokens` | Summary retention/request ceiling; default `16384`, hard cap `131072`. `maxSummaryTokens` wins over the compatibility alias. The finite value is written to `model.parameters.maxTokens`; first-party providers map it to their wire field. |
| `maxErrorBytes` | Retained provider/factory/policy error detail; default `1024`, hard cap `8192`, UTF-8-safe and known-secret redacted. |
| `maxToolResultChars` | Tool-result JSON truncation limit; defaults to `2000`. |
| `trackFileOperations`, `includeFileOperations` | Control file path extraction and final summary blocks. |
| `secrets` | Exact strings to redact from serialized prompts and final summaries. |

## Outputs / response / events
`createLlmCompactionStrategy().compact(context)` returns a `CompactionResult` with `summary` and one `kind: "compaction"` entry. The entry data includes core `CompactionEntryData` plus `firstKeptEntryId`, token estimates, optional split-turn flag, and optional `readFiles`/`modifiedFiles` lists.

Provider `error` events, empty summaries, or abort signals throw before returning a result, so the runtime appends no compaction entry.

## Request/response example
```json
{
  "throughEntryId": "entry_10",
  "keepEntryIds": ["entry_11", "entry_12"],
  "strategy": "llm-compaction",
  "firstKeptEntryId": "entry_11",
  "estimatedTokensBefore": 12000,
  "estimatedTokensAfter": 1900
}
```

## Implementation example
```ts
import { createLlmCompactionStrategy } from "@arnilo/prism-compaction-llm";

const strategy = createLlmCompactionStrategy({
  provider: summaryProvider,
  model: { provider: "openai", model: "gpt-4.1-mini" },
  keepRecentTokens: 20_000,
  reserveTokens: 16_384,
  maxSummaryTokens: 800,
  maxErrorBytes: 1_024,
  providerOptions: { cacheRetention: "short" },
  customInstructions: "Focus on current files and failing tests.",
});
// Provider request model includes: { parameters: { maxTokens: 800 } }.
// First-party serializers map it to max_output_tokens/max_tokens on the wire.

await session.compact({ strategy, secrets: [apiKey] });
```

Credential factory example:

```ts
const strategy = createLlmCompactionStrategy({
  summaryProvider: (apiKey) => createProvider({ apiKey }),
  credential: credentials,
  credentialRequest: { provider: "example", name: "apiKey" },
  summaryModel: { provider: "example", model: "cheap-summary" },
});
```

## Extension and configuration notes
This package is inert until imported. Direct strategy use works with `session.compact({ strategy })` and opt-in auto-compaction through existing `thresholdEntries` when the host selects the strategy.

```ts
import { createAgent, createExtensionKernel } from "@arnilo/prism";
import { createLlmCompactionExtension } from "@arnilo/prism-compaction-llm";

const kernel = createExtensionKernel();
await kernel.load([createLlmCompactionExtension({ provider: summaryProvider, model: summaryModel })]);
const strategy = kernel.registries.compactionStrategies.resolve("llm-compaction");

const agent = createAgent({ model, provider, compaction: { strategy, thresholdEntries: 40 } });
```

Registration only contributes an inert strategy. The host must resolve and pass it to runtime config.

## Security and performance notes
Preparation is O(n) over branch entries and uses only arrays, strings, and JSON serialization. Limit options must be positive safe integers at or below their hard caps and reject during strategy creation. Missing output options use a 16,384-token summary ceiling; reserve ratio/model metadata may narrow the provider request, never remove its finite `maxTokens`. A request policy that replaces `maxTokens` with NaN, Infinity, zero, an unsafe integer, or above-hard-cap input fails before provider generation.

Provider deltas are redacted while retained and stop at `maxSummaryTokens * 4` UTF-16 code units without splitting a surrogate pair. Provider iteration is closed/aborted on overflow. A derived finite event ceiling also stops endless empty/non-text deltas. Final history/turn/file composition receives the same cap. Provider error events, generator throws, provider-factory failures, and policy failures expose only bounded redacted detail; host abort remains authoritative.

The strategy makes only the needed provider call(s): one history summary plus one split-turn prefix summary when needed. It does not discover credentials, read files, start background jobs, or add provider SDK dependencies. Redaction is exact-string only; pass every known secret that may appear in history or provider output.

## Related APIs

- [Use-case model selection](use-case-model-selection.md): `summaryModel` vs session `model` fallback.
- [Thinking and reasoning](thinking-and-reasoning.md): `thinkingLevel` → `compat`.
- [Compaction and retry policies](compaction-and-retry.md): replaceable compaction strategy boundary and core compaction strategy surface.
- [Observational memory compaction package](compaction-observational-memory.md): source-backed memory workers with the same use-case binding pattern.
- [Agent/session runtime](agent-session-runtime.md): `AgentSession.compact()` and opt-in auto-compaction.
- [Provider layer](provider-layer.md): mock providers and provider request contracts.
- [Credentials and redaction](credentials-and-redaction.md): exact known-secret redaction behavior.
