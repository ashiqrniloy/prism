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
| `AgentConfig` | The reusable agent: provider, model, tools, skills, stores, retry, compaction, prompts, limits | [Agent/session runtime](agent.md) |
| `RunOptions` | One run's overrides: model, limits, thinking level, skills, middleware, metadata, signal | [Agent/session runtime](agent.md) |
| `AgentSessionConfig` | Session creation: id, agent, store, branch leaf, snapshot cache TTL, guardrail packs | [Agent/session runtime](agent.md) |
| `ModelConfig` | A registered model record: capabilities, limits, cost, cache and thinking metadata | [Model registry](models.md) |
| `ProviderRequestOptions` | Per-request provider hints: session/cache/header/compat/extra, applied after host policies | [Provider layer](provider-kit.md) |

## How options behave

- **Fixed defaults, host overrides.** Every option is optional; the value it replaces is the documented default, and an omitted option is exactly equivalent to passing the default explicitly.
- **Two-tier caps.** Tunable limits follow the repo convention `DEFAULT_*` (used when the host sets nothing) and `HARD_*` (the ceiling a host value is validated against), exported next to the option that accepts them. A value outside `1..HARD` (or `0..HARD` where zero means "disabled") fails closed with a `TypeError` at construction or assembly — never a silent clamp.
- **Request-time overrides narrow, never widen.** `RunOptions.limits` can only tighten `AgentConfig.limits`; a configured finite ceiling wins over `null`.
- **Byte caps are not estimator-dependent.** Token-budget options that accept a host estimator (`tokenEstimator`) affect eviction accounting only; byte caps and redaction stay authoritative.

## Durable runs

**Agent run state** — [`durable-runs.md`](loop.md)
`AgentRunStateOptions`

`AgentRunStateOptions.checkpointPolicy` (`"decision"` | `"every-turn"`) writes turn-boundary checkpoints so a crashed worker resumes with `decision: "continue"`; that action stays host-only and is never reachable from AG-UI or the server boundary.

## Host stop, snapshot, and honesty surfaces

| Surface | What it controls | Owning page |
| --- | --- | --- |
| `RunOptions.turnPolicy` (`TurnPolicyOptions`) | Synchronous host stop at a turn boundary; a stop lands as `stopReason: "host_policy"` and stays resumable | [Agent loops](loop.md) |
| `CreateAgUiHandlerOptions.inputPolicy` (`AgUiInputPolicyOptions`) | `clientState: "honor"` \| `"ignore"` — whether the server honors client-supplied AG-UI state and tools | [Frontend interoperability](../packages/hosts/ag-ui/README.md) |
| `SubscribeOptions.acrossRuns` | `true` keeps one live subscriber open across runs of the same session until the host ends it, session teardown, or an overflow (bounded queue, default 1024, no background work); default `false` closes it at run end | [Agent events](events.md) |
| `snapshotRunBundle(...)` → `RunBundleSnapshot` | Inspectable digest projection of the effective run bundle (prompt/skill/tool/guardrail digests, limits, storage kinds) | [Run bundle](run-bundle.md) |
| `createClaimGroundingGuardrail` (`ClaimGroundingGuardrailOptions`) | `"output"`-stage guardrail that blocks or flags numeric claims no tool result or host evidence supports | [Guardrails](../packages/policy/guardrail-packs/README.md) |
| `ErrorInfo.failureClass` (`ProviderFailureClass`) | Typed provider failure on run outcomes, ledger rows, and tool results (`quota`, `rate_limited`, `auth`, `transient`, `permanent`) | [Runs and usage](events.md) |
| `AgentConfig.usageEstimation` | `"fallback"` (default) records a labeled estimate when a provider reports no usage; `"off"` leaves usage absent; `"strict"` refuses the turn instead (`code: "usage_missing"`); estimates are never priced | [Runs and usage](events.md) |
| `AgentConfig.contextBudget` | Session-turn eviction budget forwarded to every assembly (`maxInputTokens`/`maxInputBytes`, `reportOmissions`, `tokenEstimator`); the usage fallback prefers its measurement | [Input and prompt assembly](loop.md) |
| `ModelConfig.capabilities.toolCallStrictness` | Advisory tool-call reliability (`"strict"` \| `"lenient"` \| `"legacy"`); catalog conformance, not a promise | [Model registry](models.md) |

## Agent/session runtime

**Agent definitions** — [`agent-definitions.md`](agent.md)  
`DiscoverAgentBundlesOptions`, `ResolveAgentBundleOptions`

**Agent events** — [`agent-events.md`](events.md)  
`SubscribeOptions`

**Agent loops** — [`agent-loops.md`](loop.md)  
`AgentLoopOptions`, `TurnPolicyOptions`

**Guardrails** — [`guardrails.md`](../packages/policy/guardrail-packs/README.md)
`ClaimGroundingGuardrailOptions`

**Agent/session runtime** — [`agent-session-runtime.md`](agent.md)  
`AgentConfig`, `AgentRunResumeOptions`, `AgentRunResumeStreamOptions`, `AgentSessionCloneOptions`, `AgentSessionConfig`, `AgentSessionForkOptions`, `RunOptions`, `SteerOptions`

**Evaluations** — [`evaluations.md`](../packages/hosts/evals/README.md)  
`ScoreRunOptions`

**Runs and usage ledger** — [`runs-and-usage.md`](events.md)  
`RunLimits`

**Structured output** — [`structured-output.md`](provider-kit.md)  
`StructuredOutputOptions`

## Compaction and session memory

**Compaction and retry policies** — [`compaction-and-retry.md`](loop.md)  
`CompactionOptions`, `DefaultCompactionStrategyOptions`, `DefaultRetryPolicyOptions`, `RetryOptions`

**LLM compaction package** — [`compaction-llm.md`](../packages/memory/compaction/README.md)  
`LlmCompactionStrategyOptions`

**Conversations** — [`conversations.md`](agent.md)  
`ConversationLimits`

**Node JSONL session store** — [`node-jsonl-session-store.md`](../packages/stores/jsonl/README.md)  
`JsonlSessionStoreOptions`

**PostgreSQL persistence** — [`postgres-persistence.md`](../packages/stores/postgres/README.md)  
`AgentEventSourceOptions`, `PostgresPersistenceOptions`

**Session stores** — [`session-stores.md`](../packages/stores/jsonl/README.md)  
`CreateMemorySessionStoreOptions`, `SessionAppendOptions`

**SQLite persistence** — [`sqlite-persistence.md`](../packages/stores/sqlite/README.md)  
`SqlitePersistenceOptions`

**Working and semantic memory** — [`working-and-semantic-memory.md`](../packages/memory/fabric/README.md)  
`PostgresVectorStoreOptions`, `RecallScoringOptions`

**Memory fabric** — [`memory-fabric.md`](../packages/memory/fabric/README.md)  
`CreateMemoryFabricOptions`, `MemoryFabricAttachOptions`, `MemoryFabricToolsOptions`, `MemoryFabricWriteOptions`, `MemoryFabricRecallOptions`, `MemoryFabricConsolidationOptions`, `MemoryFabricLinkerOptions`, `MemoryFabricEvolutionOptions`, `MemoryFabricConversationSearchOptions`, `CreateFabricFileJailOptions`

**Observational memory** — [`compaction-observational-memory.md`](../packages/memory/observational/README.md)  
`ObservationalMemoryAppendOptions`, `WorkScopeControllerOptions`

## Provider and model connection

**Model registry** — [`model-registry.md`](models.md)  
`ModelConfig`, `ModelLimits`

**Provider layer** — [`provider-layer.md`](provider-kit.md)  
`MockProviderOptions`, `ProviderRequestOptions`

**Provider primitives** — [`provider-primitives.md`](provider-kit.md)  
`BoundedStreamLimits`

**Alibaba Cloud provider package** — [`providers/alibaba.md`](../packages/providers/alibaba/README.md)  
`AlibabaEmbedderOptions`, `AlibabaModelConfig`, `AlibabaProviderOptions`, `AlibabaProviderPackageOptions`, `ListAlibabaModelsOptions`

**Anthropic provider package** — [`providers/anthropic.md`](../packages/providers/anthropic/README.md)  
`AnthropicProviderPackageOptions`, `ListAnthropicModelsOptions`

**ClinePass provider package** — [`providers/clinepass.md`](../packages/providers/clinepass/README.md)  
`ClinePassProviderPackageOptions`

**Command Code provider package** — [`providers/commandcode.md`](../packages/providers/commandcode/README.md)  
`CommandCodeProviderPackageOptions`

**DeepSeek provider package** — [`providers/deepseek.md`](../packages/providers/deepseek/README.md)  
`DeepSeekModelConfig`, `DeepSeekProviderPackageOptions`, `ListDeepSeekModelsOptions`

**Google provider package** — [`providers/google.md`](../packages/providers/google/README.md)  
`GoogleProviderPackageOptions`, `ListGoogleModelsOptions`

**Hyper provider package** — [`providers/hyper.md`](../packages/providers/hyper/README.md)  
`HyperProviderPackageOptions`

**Kimi provider package** — [`providers/kimi.md`](../packages/providers/kimi/README.md)  
`KimiModelConfig`, `KimiProviderPackageOptions`, `ListKimiModelsOptions`

**NeuralWatt provider package** — [`providers/neuralwatt.md`](../packages/providers/neuralwatt/README.md)  
`GetNeuralWattQuotaOptions`, `ListNeuralWattModelsOptions`, `NeuralWattModelConfig`, `NeuralWattProviderPackageOptions`

**Ollama Cloud provider package** — [`providers/ollama.md`](../packages/providers/ollama/README.md)  
`ListOllamaModelsOptions`, `OllamaModelConfig`, `OllamaProviderOptions`, `OllamaProviderPackageOptions`

**OpenAI-compatible provider** — `providers/openai-compatible.md`  
`OpenAICompatibleProviderOptions`

**OpenAI provider package** — [`providers/openai.md`](../packages/providers/openai/README.md)  
`OpenAICodexOAuthOptions`, `OpenAIProviderPackageOptions`

**OpenCode Go provider package** — [`providers/opencode-go.md`](../packages/providers/opencode-go/README.md)  
`OpenCodeGoProviderPackageOptions`

**OpenRouter provider package** — [`providers/openrouter.md`](../packages/providers/openrouter/README.md)  
`ListOpenRouterModelsOptions`, `OpenRouterModelConfig`, `OpenRouterProviderPackageOptions`

**xAI provider package** — [`providers/xai.md`](../packages/providers/xai/README.md)  
`ListXaiModelsOptions`, `XaiOAuthOptions`, `XaiProviderPackageOptions`

**Z.AI provider package** — [`providers/zai.md`](../packages/providers/zai/README.md)  
`ListZaiModelsOptions`, `ZaiModelConfig`, `ZaiProviderPackageOptions`

## Input, prompt, and context assembly

**Context and skills** — [`context-and-skills.md`](../packages/context/files/README.md)  
`ResolveActiveSkillsOptions`, `ResolveContextOptions`

**Attention compiler** — [`attention-compiler.md`](../packages/context/engineering/README.md)  
`AttentionCompilerOptions`, `AttentionInputCapOptions`, `AttentionCompileOptions`, `AttentionTruncationTriggerOptions`

**Input and prompt assembly** — [`input-and-prompt-assembly.md`](loop.md)  
`AssembleProviderInputOptions`, `PromptTemplateOptions`

**Multimodal content** — [`multimodal-content.md`](provider-kit.md)  
`ResolveMediaContentOptions`

**Retrieval-augmented generation (RAG)** — [`rag.md`](../packages/memory/rag/README.md)  
`CreateTeiRerankerOptions`

**System prompts** — [`system-prompts.md`](../packages/context/files/README.md)  
`SystemPromptConfig`

## Tools

**Browser automation** — [`browser-automation.md`](../packages/tools/browser/README.md)  
`BrowserCdpOptions`

**Coding agent tools (first-party package)** — [`coding-agent-tools.md`](../packages/tools/coding/README.md)  
`EditToolOptions`, `ReadTextOptions`, `ReadToolOptions`, `RepositoryLimitOptions`, `ShellToolOptions`, `ToolsOptions`, `WriteToolOptions`

**Coding execution approval and sandboxing** — [`coding-security.md`](coding-security.md)  
`DockerNetworkConfig`

**Device adapters** — [`device-adapters.md`](../packages/tools/computer-use/README.md)  
`DevicePolicyOptions`

**GitHub forge integration** — [`forge-integration.md`](../packages/tools/coding/README.md)  
`CreateGitRunnerOptions`, `ForgeLimits`

**Language intelligence** — [`language-intelligence.md`](../packages/tools/coding/README.md)  
`LanguageIntelligenceLimits`

**MCP client bridge and server exposure** — [`mcp-tools.md`](../packages/integrations/mcp/README.md)  
`CreatePrismMcpServerOptions`

**Process sessions** — [`process-sessions.md`](../packages/tools/coding/README.md)  
`ProcessSessionLimits`

**Tools** — [`tools.md`](tools.md)  
`DispatchToolCallOptions`

## Documents, sheets, and diagrams

**Diagramming, draw.io embed client, and mxGraph XML validation** — [`diagrams.md`](../packages/tools/work/README.md)  
`DrawioCanonicalizeOptions`, `DrawioEmbedOptions`, `DrawioExportOptions`, `DrawioLoadOptions`, `DrawioXmlOptions`

**Documents, spreadsheets, and presentations** — [`documents.md`](../packages/tools/work/README.md)  
`GenerateDocumentOptions`, `ParseDocumentOptions`, `PatchDocumentOptions`, `PreviewBlocksOptions`, `PreviewHtmlOptions`

**Spreadsheets, CSV parsing, and typed schema inference** — [`sheets.md`](../packages/tools/work/README.md)  
`ParseCsvOptions`, `ParseWorkbookOptions`

## Extensions and plugins

**Contribution discovery (workspace)** — [`contribution-discovery.md`](manifest.md)  
`DiscoveryOptions`

**Extension kernel and event bus** — [`extensions.md`](manifest.md)  
`ExtensionKernelOptions`

**Middleware hooks** — [`middleware-hooks.md`](hooks.md)  
`MiddlewareRegistryOptions`

## Configuration and manifests

**Resource loading** — [`resource-loading.md`](resource-loading.md)  
`LoadBinaryResourceOptions`

## Server/API

**Web-standard server handler** — [`server.md`](host.md)  
`PrismServerLimits`

## Multi-agent and interoperability

**Agent Client Protocol (ACP) coding-host interop** — [`acp.md`](../packages/hosts/acp/README.md)  
`AcpCapabilitiesOptions`, `CreatePrismAcpAgentOptions`

**Frontend interoperability (AG-UI and ACP)** — [`ag-ui.md`](../packages/hosts/ag-ui/README.md)  
`AgUiInputPolicyOptions`, `AgUiLimitOptions`

**Supervisors and subagents** — [`supervisors.md`](../packages/integrations/delegate/README.md)  
`CreateSupervisorOptions`, `SupervisorLimits`, `ResolvedSupervisorLimits`, `DelegationWaitOptions`, `CreateSpawnAgentToolOptions`, `CreateDelegationControlToolOptions`, `WorktreeChildFactoryOptions`, `ObserveSupervisorLifecycleOptions`

## CLI/RPC

**Workflows** — [`workflows.md`](../packages/integrations/workflows/README.md)  
`RunWorkflowOptions`

## Third-party integrations

**Messaging channels** — [`messaging-channels.md`](../packages/hosts/channels/README.md)
`MessagingRuntimeOptions`, `ChannelLimits`, `ChannelDeliveryJournalOptions`, `ChannelPairingStoreOptions`, `ChannelStateStoreOptions`

**Telegram channel** — [`telegram-channel.md`](../packages/hosts/channels/README.md)
`TelegramAdapterOptions`, `TelegramWebhookHandlerOptions`

**Signal channel (experimental)** — [`signal-channel.md`](../packages/hosts/channels/README.md)
`SignalAdapterOptions`

## Conformance harnesses

These option objects configure the shipped test doubles a host runs against its own adapters (provider, store, run ledger, compaction, tool, extension). They are host-facing, but only in test code.

**Compaction conformance** — [`compaction-conformance.md`](testing.md)  
`CompactionConformanceOptions`

**Extension conformance** — [`extension-conformance.md`](packages.md)  
`ExtensionConformanceOptions`

**Run ledger conformance** — [`run-ledger-conformance.md`](testing.md)  
`RunLedgerConformanceOptions`

**Session store conformance** — [`session-store-conformance.md`](testing.md)  
`SessionStoreConformanceOptions`

**Tool conformance** — [`tool-conformance.md`](testing.md)  
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
- Layered JSON configuration (`mergeConfigLayers`) resolves to the same option shapes; see [Configuration and manifests](manifest.md).
- This index is checked against the source tree: every surface named here must exist as a declared `*Options`/`*Limits`/`*Config` type, and every link must resolve. See `scripts/live-doc-check.test.mjs`.

## Security and performance notes

- Credentials never appear in these option objects; secrets resolve through credential providers and are redacted before they reach requests, logs, or events. See [Credentials and redaction](credentials-and-redaction.md).
- Trust boundaries are options too (`trust`, permission policies, sandbox and egress config). Tightening them is always allowed; loosening one requires the host to pass it explicitly. See [Host security guide](host-security.md).
- Raising a cap raises resource use. Caps exist to bound memory, sockets, subprocesses, and provider spend; prefer narrowing per run over raising an agent-wide ceiling.

## Related APIs

- [Public contracts](packages.md): the shapes these options produce and the store/tool/provider interfaces they configure.
- [Optional peer dependencies](peer-dependencies.md): which surfaces need an extra install before their options are reachable.
- [SDK customization guide](hooks.md): a seam-by-seam walkthrough of replacing Prism primitives.
