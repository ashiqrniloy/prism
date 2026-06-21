# @prism/compaction-llm

Optional LLM-backed compaction strategy package for Prism. It is inert until a host imports it and passes a strategy to `session.compact()` or `AgentConfig.compaction`.

```ts
import { createLlmCompactionStrategy } from "@prism/compaction-llm";

const strategy = createLlmCompactionStrategy({
  provider: summaryProvider,
  model: { provider: "mock", model: "cheap-summary" },
  keepRecentTokens: 20_000,
  reserveTokens: 16_384,
  providerOptions: { cacheRetention: "short" },
  customInstructions: "Focus on current files and failing tests.",
});

await session.compact({ strategy, secrets: [apiKey] });
```

Extension registration is optional and inert until the host selects the contribution:

```ts
import { createExtensionKernel } from "prism";
import { createLlmCompactionExtension } from "@prism/compaction-llm";

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

No provider SDKs, credentials, network calls, or filesystem discovery run at import/setup time.
