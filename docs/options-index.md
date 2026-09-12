# Configuration options index

## What it does

Maps every public configuration surface — the `*Options`, `*Limits`, and `*Config` types a host passes into Prism — to the doc page that owns its fields. Prism has one options object per seam rather than a global config tree, so "where do I set this?" is the recurring onboarding question; this page answers it in one hop.

## When to use it

- Wiring a host for the first time and looking for the right seam (`AgentConfig`, `RunOptions`, `ModelConfig`, …).
- Reviewing which surfaces a run, session, or adapter can override before writing an override.
- Checking whether a knob is host-tunable at all before assuming a limit is hardcoded.

Field-level detail (defaults, bounds, failure modes) lives on the owning page — this index only routes you there.

## Start here: the surfaces most hosts set

| Surface | Configures | Owning page |
| --- | --- | --- |
| `AgentConfig` | The reusable agent: provider, model, tools, skills, stores, retry, compaction, prompts, limits | [Agent/session runtime](agent-session-runtime.md) |
| `RunOptions` | One run's overrides: model, limits, thinking level, skills, middleware, metadata, signal | [Agent/session runtime](agent-session-runtime.md) |
| `AgentSessionConfig` | Session creation: id, agent, store, branch leaf, snapshot cache TTL | [Agent/session runtime](agent-session-runtime.md) |
| `ModelConfig` | A registered model record: capabilities, limits, cost, cache and thinking metadata | [Model registry](model-registry.md) |
| `ProviderRequestOptions` | Per-request provider hints: session/cache/header/compat/extra, applied after host policies | [Provider layer](provider-layer.md) |

## How options behave

- **Fixed defaults, host overrides.** Every option is optional; the value it replaces is the documented default, and an omitted option is exactly equivalent to passing the default explicitly.
- **Two-tier caps.** Tunable limits follow the repo convention `DEFAULT_*` (used when the host sets nothing) and `HARD_*` (the ceiling a host value is validated against), exported next to the option that accepts them. A value outside `1..HARD` (or `0..HARD` where zero means "disabled") fails closed with a `TypeError` at construction or assembly — never a silent clamp.
- **Request-time overrides narrow, never widen.** `RunOptions.limits` can only tighten `AgentConfig.limits`; a configured finite ceiling wins over `null`.
- **Byte caps are not estimator-dependent.** Token-budget options that accept a host estimator (`tokenEstimator`) affect eviction accounting only; byte caps and redaction stay authoritative.

## Agent/session runtime

**Agent definitions** — [`agent-definitions.md`](agent-definitions.md)  
`DiscoverAgentBundlesOptions`, `ResolveAgentBundleOptions`

**Agent events** — [`agent-events.md`](agent-events.md)  
`SubscribeOptions`

**Agent loops** — [`agent-loops.md`](agent-loops.md)  
`AgentLoopOptions`

**Agent/session runtime** — [`agent-session-runtime.md`](agent-session-runtime.md)  
`AgentConfig`, `AgentRunResumeStreamOptions`, `AgentSessionCloneOptions`, `AgentSessionConfig`, `AgentSessionForkOptions`, `RunOptions`, `SteerOptions`

**Evaluations** — [`evaluations.md`](evaluations.md)  
`ScoreRunOptions`

**Runs and usage ledger** — [`runs-and-usage.md`](runs-and-usage.md)  
`RunLimits`

**Structured output** — [`structured-output.md`](structured-output.md)  
`StructuredOutputOptions`

## Compaction and session memory

**Compaction and retry policies** — [`compaction-and-retry.md`](compaction-and-retry.md)  
`CompactionOptions`, `DefaultCompactionStrategyOptions`, `DefaultRetryPolicyOptions`, `RetryOptions`

**LLM compaction package** — [`compaction-llm.md`](compaction-llm.md)  
`LlmCompactionStrategyOptions`

**Conversations** — [`conversations.md`](conversations.md)  
`ConversationLimits`

**Node JSONL session store** — [`node-jsonl-session-store.md`](node-jsonl-session-store.md)  
`JsonlSessionStoreOptions`

**PostgreSQL persistence** — [`postgres-persistence.md`](postgres-persistence.md)  
`AgentEventSourceOptions`, `PostgresPersistenceOptions`

**Session stores** — [`session-stores.md`](session-stores.md)  
`CreateMemorySessionStoreOptions`, `SessionAppendOptions`

**SQLite persistence** — [`sqlite-persistence.md`](sqlite-persistence.md)  
`SqlitePersistenceOptions`

**Working and semantic memory** — [`working-and-semantic-memory.md`](working-and-semantic-memory.md)  
`PostgresVectorStoreOptions`, `RecallScoringOptions`

## Provider and model connection

**Model registry** — [`model-registry.md`](model-registry.md)  
`ModelConfig`, `ModelLimits`

**Provider layer** — [`provider-layer.md`](provider-layer.md)  
`MockProviderOptions`, `ProviderRequestOptions`

**Provider primitives** — [`provider-primitives.md`](provider-primitives.md)  
`BoundedStreamLimits`

**Alibaba Cloud provider package** — [`providers/alibaba.md`](providers/alibaba.md)  
`AlibabaEmbedderOptions`, `AlibabaModelConfig`, `AlibabaProviderOptions`, `AlibabaProviderPackageOptions`, `ListAlibabaModelsOptions`

**Anthropic provider package** — [`providers/anthropic.md`](providers/anthropic.md)  
`AnthropicProviderPackageOptions`, `ListAnthropicModelsOptions`

**ClinePass provider package** — [`providers/clinepass.md`](providers/clinepass.md)  
`ClinePassProviderPackageOptions`

**Command Code provider package** — [`providers/commandcode.md`](providers/commandcode.md)  
`CommandCodeProviderPackageOptions`

**DeepSeek provider package** — [`providers/deepseek.md`](providers/deepseek.md)  
`DeepSeekModelConfig`, `DeepSeekProviderPackageOptions`, `ListDeepSeekModelsOptions`

**Google provider package** — [`providers/google.md`](providers/google.md)  
`GoogleProviderPackageOptions`, `ListGoogleModelsOptions`

**Hyper provider package** — [`providers/hyper.md`](providers/hyper.md)  
`HyperProviderPackageOptions`

**Kimi provider package** — [`providers/kimi.md`](providers/kimi.md)  
`KimiModelConfig`, `KimiProviderPackageOptions`, `ListKimiModelsOptions`

**NeuralWatt provider package** — [`providers/neuralwatt.md`](providers/neuralwatt.md)  
`GetNeuralWattQuotaOptions`, `ListNeuralWattModelsOptions`, `NeuralWattModelConfig`, `NeuralWattProviderPackageOptions`

**Ollama Cloud provider package** — [`providers/ollama.md`](providers/ollama.md)  
`ListOllamaModelsOptions`, `OllamaModelConfig`, `OllamaProviderOptions`, `OllamaProviderPackageOptions`

**OpenAI-compatible provider** — [`providers/openai-compatible.md`](providers/openai-compatible.md)  
`OpenAICompatibleProviderOptions`

**OpenAI provider package** — [`providers/openai.md`](providers/openai.md)  
`OpenAICodexOAuthOptions`, `OpenAIProviderPackageOptions`

**OpenCode Go provider package** — [`providers/opencode-go.md`](providers/opencode-go.md)  
`OpenCodeGoProviderPackageOptions`

**OpenRouter provider package** — [`providers/openrouter.md`](providers/openrouter.md)  
`ListOpenRouterModelsOptions`, `OpenRouterModelConfig`, `OpenRouterProviderPackageOptions`

**xAI provider package** — [`providers/xai.md`](providers/xai.md)  
`ListXaiModelsOptions`, `XaiOAuthOptions`, `XaiProviderPackageOptions`

**Z.AI provider package** — [`providers/zai.md`](providers/zai.md)  
`ListZaiModelsOptions`, `ZaiModelConfig`, `ZaiProviderPackageOptions`

## Input, prompt, and context assembly

**Context and skills** — [`context-and-skills.md`](context-and-skills.md)  
`ResolveActiveSkillsOptions`, `ResolveContextOptions`

**Input and prompt assembly** — [`input-and-prompt-assembly.md`](input-and-prompt-assembly.md)  
`AssembleProviderInputOptions`, `PromptTemplateOptions`

**Multimodal content** — [`multimodal-content.md`](multimodal-content.md)  
`ResolveMediaContentOptions`

**Retrieval-augmented generation (RAG)** — [`rag.md`](rag.md)  
`CreateTeiRerankerOptions`

**System prompts** — [`system-prompts.md`](system-prompts.md)  
`SystemPromptConfig`

## Tools

**Browser automation** — [`browser-automation.md`](browser-automation.md)  
`BrowserCdpOptions`

**Coding agent tools (first-party package)** — [`coding-agent-tools.md`](coding-agent-tools.md)  
`EditToolOptions`, `ReadTextOptions`, `ReadToolOptions`, `RepositoryLimitOptions`, `ShellToolOptions`, `ToolsOptions`, `WriteToolOptions`

**Coding execution approval and sandboxing** — [`coding-security.md`](coding-security.md)  
`DockerNetworkConfig`

**Device adapters** — [`device-adapters.md`](device-adapters.md)  
`DevicePolicyOptions`

**GitHub forge integration** — [`forge-integration.md`](forge-integration.md)  
`CreateGitRunnerOptions`, `ForgeLimits`

**Language intelligence** — [`language-intelligence.md`](language-intelligence.md)  
`LanguageIntelligenceLimits`

**MCP client bridge and server exposure** — [`mcp-tools.md`](mcp-tools.md)  
`CreatePrismMcpServerOptions`

**Process sessions** — [`process-sessions.md`](process-sessions.md)  
`ProcessSessionLimits`

**Tools** — [`tools.md`](tools.md)  
`DispatchToolCallOptions`

## Documents, sheets, and diagrams

**Diagramming, draw.io embed client, and mxGraph XML validation** — [`diagrams.md`](diagrams.md)  
`DrawioCanonicalizeOptions`, `DrawioEmbedOptions`, `DrawioExportOptions`, `DrawioLoadOptions`, `DrawioXmlOptions`

**Documents, spreadsheets, and presentations** — [`documents.md`](documents.md)  
`GenerateDocumentOptions`, `ParseDocumentOptions`, `PatchDocumentOptions`, `PreviewBlocksOptions`, `PreviewHtmlOptions`

**Spreadsheets, CSV parsing, and typed schema inference** — [`sheets.md`](sheets.md)  
`ParseCsvOptions`, `ParseWorkbookOptions`

## Extensions and plugins

**Contribution discovery (workspace)** — [`contribution-discovery.md`](contribution-discovery.md)  
`DiscoveryOptions`

**Extension kernel and event bus** — [`extensions.md`](extensions.md)  
`ExtensionKernelOptions`

**Middleware hooks** — [`middleware-hooks.md`](middleware-hooks.md)  
`MiddlewareRegistryOptions`

## Configuration and manifests

**Resource loading** — [`resource-loading.md`](resource-loading.md)  
`LoadBinaryResourceOptions`

## Server/API

**Web-standard server handler** — [`server.md`](server.md)  
`PrismServerLimits`

## Multi-agent and interoperability

**Agent Client Protocol (ACP) coding-host interop** — [`acp.md`](acp.md)  
`AcpCapabilitiesOptions`, `CreatePrismAcpAgentOptions`

**Frontend interoperability (AG-UI and ACP)** — [`ag-ui.md`](ag-ui.md)  
`AgUiLimitOptions`

## CLI/RPC

**Workflows** — [`workflows.md`](workflows.md)  
`RunWorkflowOptions`

## Conformance harnesses

These option objects configure the shipped test doubles a host runs against its own adapters (provider, store, run ledger, compaction, tool, extension). They are host-facing, but only in test code.

**Compaction conformance** — [`compaction-conformance.md`](compaction-conformance.md)  
`CompactionConformanceOptions`

**Extension conformance** — [`extension-conformance.md`](extension-conformance.md)  
`ExtensionConformanceOptions`

**Run ledger conformance** — [`run-ledger-conformance.md`](run-ledger-conformance.md)  
`RunLedgerConformanceOptions`

**Session store conformance** — [`session-store-conformance.md`](session-store-conformance.md)  
`SessionStoreConformanceOptions`

**Tool conformance** — [`tool-conformance.md`](tool-conformance.md)  
`ToolConformanceOptions`, `ToolDisclosureConformanceOptions`, `ToolDispatchProbeOptions`

## Implementation example

```ts
import { createAgent, createMemorySessionStore } from "@arnilo/prism";

// Agent-level: the long-lived defaults.
const agent = createAgent({
  provider,
  model: { id: "gpt-4o", provider: "openai" },
  limits: { maxTurns: 12, maxToolRounds: 8 },   // AgentConfig.limits
  store: createMemorySessionStore([], { search: { maxLinearSessions: 5_000 } }),
});

// Session-level: identity, branch, and snapshot cache.
const session = agent.createSession({ leafId: "leaf-1", snapshotCacheTtlMs: 0 });

// Run-level: only narrows what the agent configured.
await session.run("hi", { limits: { maxToolRounds: 2 }, thinkingLevel: "low" });
```

## Extension and configuration notes

- Options are plain data. A host overrides behavior by passing a *different implementation* to the seam (`store`, `providerSource`, `loop`, policies), not by mutating a shared config object.
- Layered JSON configuration (`mergeConfigLayers`) resolves to the same option shapes; see [Configuration and manifests](configuration-and-manifests.md).
- This index is checked against the source tree: every surface named here must exist as a declared `*Options`/`*Limits`/`*Config` type, and every link must resolve. See `scripts/live-doc-check.test.mjs`.

## Security and performance notes

- Credentials never appear in these option objects; secrets resolve through credential providers and are redacted before they reach requests, logs, or events. See [Credentials and redaction](credentials-and-redaction.md).
- Trust boundaries are options too (`trust`, permission policies, sandbox and egress config). Tightening them is always allowed; loosening one requires the host to pass it explicitly. See [Host security guide](host-security.md).
- Raising a cap raises resource use. Caps exist to bound memory, sockets, subprocesses, and provider spend; prefer narrowing per run over raising an agent-wide ceiling.

## Related APIs

- [Public contracts](public-contracts.md): the shapes these options produce and the store/tool/provider interfaces they configure.
- [Optional peer dependencies](peer-dependencies.md): which surfaces need an extra install before their options are reachable.
- [SDK customization guide](customization.md): a seam-by-seam walkthrough of replacing Prism primitives.
