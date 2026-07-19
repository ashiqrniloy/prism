# @arnilo/prism-compaction-llm

Optional LLM-backed compaction strategy package for Prism. It is inert until a host imports it and passes a strategy to `session.compact()` or `AgentConfig.compaction`.

```ts
import { createLlmCompactionStrategy } from "@arnilo/prism-compaction-llm";

const strategy = createLlmCompactionStrategy({
  provider: summaryProvider,
  model: { provider: "mock", model: "cheap-summary" },
  keepRecentTokens: 20_000,
  reserveTokens: 16_384,
  maxSummaryTokens: 4_096,
  maxErrorBytes: 1_024,
  providerOptions: { cacheRetention: "short" },
  customInstructions: "Focus on current files and failing tests.",
});

await session.compact({ strategy, secrets: [apiKey] });
```

Extension registration is optional and inert until the host selects the contribution:

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createLlmCompactionExtension } from "@arnilo/prism-compaction-llm";

const kernel = createExtensionKernel();
await kernel.load([createLlmCompactionExtension({ provider: summaryProvider, model: summaryModel })]);
const selected = kernel.registries.compactionStrategies.resolve("llm-compaction");
```

Use `summaryProvider` plus `credential` when the provider must be built from a per-call credential:

```ts
const strategy = createLlmCompactionStrategy({
  summaryProvider: (apiKey) => createProvider({ apiKey }),
  credential: credentials,
  credentialRequest: { provider: "example", name: "apiKey" },
  summaryModel: { provider: "example", model: "cheap-summary" },
});
```

Summary retention defaults to 16,384 approximate tokens (131,072 hard), reserve defaults to 16,384 (131,072 hard), and provider error detail defaults to 1 KiB (8 KiB hard). Limits reject invalid values at strategy creation. Every request keeps finite `model.parameters.maxTokens`; streamed text/event retention stops at the configured budget and provider errors are bounded/redacted.

No provider SDKs, credentials, network calls, or filesystem discovery run at import/setup time.
