# Public contracts

## What it does

The root `prism` export provides TypeScript contracts for host-owned agent systems. These contracts describe data shapes and extension points; they do not create providers, agents, sessions, stores, credentials, tools, or network calls by themselves.

Current contract groups:

- JSON/data: `JsonPrimitive`, `JsonValue`, `JsonObject`, `ErrorInfo`
- Content/messages: `ContentBlock`, `TextContent`, `ImageContent`, `ThinkingContent`, `ToolCallContent`, `ToolResultContent`, `Message`
- Providers/models: `ModelConfig`, `Usage`, `ProviderRequest`, `ProviderEvent`, `AIProvider`
- Agents/sessions: `AgentConfig`, `AgentDefinition`, `Agent`, `AgentSessionConfig`, `AgentSession`, `RunOptions`, `AgentEvent`
- Tools/commands: `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`, `CommandDefinition`, `CommandExecutionContext`, `CommandResult`
- Input/prompt/context/skills: `InputBuilder`, `InputBuildContext`, `AgentInput`, `DefaultInputBuilder`, `DefaultInputBuildContext`, `InputAttachment`, `PromptInstruction`, `PromptBuilder`, `PromptBuildRequest`, `ContextBlock`, `ContextProvider`, `ContextResolutionContext`, `Skill`, `SkillRegistry`
- Extensions/middleware: `ExtensionLifecycleEventName`, `ExtensionEvent`, `Extension`, `ExtensionAPI`, `MiddlewareHookName`, `Middleware`, `MiddlewareNext`, `MiddlewareRegistry`
- Configuration/manifests: `ConfigProvider`, `ConfigLayer`, `ConfigLoadContext`, `PrismManifest`, `ManifestContributionDeclaration`, `ManifestResourceDeclaration`, `ManifestContributionKind`
- Stores/resources/settings/credentials/compaction: `SessionEntry`, `SessionStore`, `StoreFactory`, `Resource`, `ResourceLoader`, `ResourceLoadContext`, `SettingsProvider`, `CredentialRequest`, `Credential`, `CredentialResolver`, `CompactionStrategy`, `CompactionContext`, `CompactionResult`

## When to use it

Use these contracts when a host app or external package needs to type Prism-compatible providers, tools, context providers, skills, extensions, sessions, stores, resources, settings, or credential resolvers.

Do not use these contracts as proof that runtime behavior exists. Agent/session loops, tool dispatch, persistence adapters, extension loading, and configuration loading are implemented in later phases.

## Inputs / request

Public contracts are imported from the root package:

```ts
import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  CommandDefinition,
  CompactionStrategy,
  ConfigLayer,
  ConfigProvider,
  ContextProvider,
  CredentialResolver,
  DefaultInputBuildContext,
  Extension,
  InputBuilder,
  ManifestContributionDeclaration,
  ManifestResourceDeclaration,
  Message,
  Middleware,
  ModelConfig,
  PrismManifest,
  PromptBuilder,
  ResourceLoader,
  SettingsProvider,
  Skill,
  StoreFactory,
  ToolDefinition,
} from "prism";
```

Important request shapes:

| Contract | Purpose |
| --- | --- |
| `ProviderRequest` | Normalized provider input: `model`, `messages`, optional `tools`, `context`, `metadata`, and `signal`. |
| `ToolRegistry` | Host active tool registry shape: `register()`, `get()`, `resolve()`, and `list()`. |
| `ToolExecutionContext` | Host tool execution context: session/run ids, tool call id, optional abort signal, metadata, and progress callback. |
| `ContextResolutionContext` | Context provider input: messages plus optional session/run ids, metadata, and signal. |
| `DefaultInputBuildContext` | Optional default input assembly context: instructions, history, summaries, attachments, explicit resources, tool results, middleware, ids, metadata, and signal. |
| `ResolveContextOptions` | Ordered context resolution input: selected providers, messages, ids, metadata, signal, and optional middleware. |
| `AssembleProviderInputOptions` | Provider input assembly input: model, input, optional builders, selected context providers/skills, active tools, metadata, and signal. |
| `CredentialRequest` | Credential lookup request: credential `name`, optional provider id, and metadata. |
| `RunOptions` | Per-run overrides: optional abort signal, model, max tool rounds, and metadata. |
| `ConfigLayer` | Named JSON config layer consumed by `mergeConfigLayers()`. |
| `PrismManifest` | Data-only package manifest with config defaults, contribution declarations, and resource declarations. |

## Outputs / response / events

Important output/event shapes:

| Contract | Output |
| --- | --- |
| `ProviderEvent` | Provider stream events: message start, content delta, tool-call delta, final tool call, usage, done, or error. |
| `AgentEvent` | Session/runtime events: agent/turn/message/tool/queue/compaction/retry/error events, including tool started/progress/finished/error/blocked. |
| `ToolResult` | Host tool output with optional content, value, error, and metadata. |
| `ContextBlock` | Context text or content blocks with optional title, priority, and metadata. |
| `SessionEntry` | Store entry for messages, events, summaries, or metadata. |
| `Resource` | Loaded resource with URI, media type, text, binary data, and metadata. |
| `Credential` | Host-resolved credential value returned only to the caller that requested it. |

## Request/response example

```json
{
  "model": { "provider": "mock", "model": "demo" },
  "messages": [
    {
      "role": "user",
      "content": [{ "type": "text", "text": "Hello" }]
    }
  ]
}
```

Example provider event:

```json
{
  "type": "content_delta",
  "content": { "type": "text", "text": "Hello" }
}
```

## Implementation example

```ts
import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  AssembleProviderInputOptions,
  CommandDefinition,
  CompactionStrategy,
  ConfigLayer,
  ConfigProvider,
  ContextProvider,
  CredentialResolver,
  DefaultInputBuildContext,
  Extension,
  InputBuilder,
  ManifestContributionDeclaration,
  ManifestResourceDeclaration,
  Middleware,
  PrismManifest,
  PromptBuilder,
  ResourceLoader,
  SettingsProvider,
  Skill,
  StoreFactory,
  ToolDefinition,
} from "prism";
import { assembleProviderInput, createDefaultInputBuilder, createDefaultPromptBuilder, resolveContextProviders } from "prism";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const context: ContextProvider = {
  name: "demo-context",
  resolve() {
    return [{ title: "Demo", content: "Public contract example." }];
  },
};

const tool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object" },
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

const skill: Skill = {
  name: "brief",
  instructions: "Answer briefly.",
  toolNames: ["echo"],
};

const command: CommandDefinition = {
  name: "say",
  execute() {
    return { name: "say", value: "ok" };
  },
};

const inputBuilder: InputBuilder = {
  name: "plain-text",
  build(input) {
    return typeof input === "string" ? [{ role: "user", content: [{ type: "text", text: input }] }] : [];
  },
};

const defaultInputContext: DefaultInputBuildContext = {
  systemInstructions: "Follow host policy.",
  attachments: [{ name: "notes.md", text: "notes" }],
  toolResults: [{ toolCallId: "call_1", name: "echo", value: "ok" }],
};

const defaultMessages = await createDefaultInputBuilder().build("Hello", defaultInputContext);

const assemblyOptions: AssembleProviderInputOptions = {
  model: { provider: "mock", model: "demo-model" },
  input: "Hello",
  contextProviders: [context],
  promptBuilder: createDefaultPromptBuilder(),
  tools: [tool],
  skills: [skill],
};

const resolvedContext = await resolveContextProviders({ providers: [context], messages: defaultMessages });
const providerInput = await assembleProviderInput(assemblyOptions);

const promptBuilder: PromptBuilder = {
  name: "default-prompt",
  build(request) {
    return request.messages;
  },
};

const providerRequestMiddleware: Middleware<{ metadata?: Record<string, unknown> }> = (request) => ({
  ...request,
  metadata: { ...request.metadata, source: "demo" },
});

const compaction: CompactionStrategy = {
  name: "simple-summary",
  compact() {
    return { summary: "Summary placeholder." };
  },
};

const configLayer: ConfigLayer = { name: "runtime", config: { demo: { enabled: true } } };
const configProvider: ConfigProvider = { name: "host", load: () => configLayer.config };
const manifestContribution: ManifestContributionDeclaration = {
  kind: "tool",
  name: "demo.echo",
  module: "./tool.js",
};
const manifestResource: ManifestResourceDeclaration = {
  uri: "package://demo/prompt.md",
  purpose: "prompt",
};
const manifest: PrismManifest = {
  name: "demo-package",
  configDefaults: configLayer.config,
  contributions: [manifestContribution],
  resources: [manifestResource],
};

const agentDefinition: AgentDefinition = {
  name: "demo-agent",
  create() {
    throw new Error("Agent runtime is implemented in a later phase.");
  },
};

const config: AgentConfig = {
  id: "demo-agent",
  model: { provider: "mock", model: "demo-model" },
  provider,
  context: [context],
  skills: [skill],
  tools: [tool],
};

const extension: Extension = {
  name: "demo-extension",
  setup(api) {
    api.registerProvider(provider);
    api.registerContextProvider(context);
    api.registerSkill(skill);
    api.registerTool(tool);
  },
};

const resources: ResourceLoader = {
  async load(uri) {
    return { uri, mediaType: "text/plain", text: "example" };
  },
};

const storeFactory: StoreFactory = {
  name: "memory",
  create() {
    return { append: async () => undefined, list: async () => [] };
  },
};

const settings: SettingsProvider = {
  get<T>(key: string) {
    return key === "demo.enabled" ? (true as T) : undefined;
  },
};

const credentials: CredentialResolver = {
  resolve() {
    return undefined;
  },
};

void config;
void command;
void inputBuilder;
void defaultMessages;
void resolvedContext;
void providerInput;
void promptBuilder;
void compaction;
void configProvider;
void manifest;
void providerRequestMiddleware;
void agentDefinition;
void extension;
void resources;
void storeFactory;
void settings;
void credentials;
```

## Extension and configuration notes

- Contracts are host-owned and package-friendly. External packages can implement `AIProvider`, `ToolDefinition`, `CommandDefinition`, `AgentDefinition`, `InputBuilder`, `PromptBuilder`, `Middleware`, `ContextProvider`, `Skill`, `Extension`, config providers, data-only manifests, compaction strategies, store factories, resource loaders, settings providers, and credential resolvers.
- `ExtensionAPI` is implemented by the extension kernel. It exposes explicit registries, ordered middleware registration, ordered event subscription/emission, and registration methods for Phase 2 contribution categories.
- `AgentConfig.provider` can hold a direct provider instance for simple host wiring. Hosts that need config-driven selection should use `ModelConfig.provider` with explicit `createProviderRegistry()` / `createModelRegistry()` objects; Prism does not create a hidden global provider registry.
- `SettingsProvider` and `CredentialResolver` are explicit dependencies. Prism must not hide global settings or credentials behind these contracts, and `CredentialResolver` should be passed only to the edge that needs a credential.
- `PrismManifest` is data-only. It can describe contribution modules/resources and config defaults, but parsing it does not import modules, execute package code, or mutate registries.
- Resource helper functions decode resources from a caller-provided `ResourceLoader`; Prism does not include filesystem, network, package, or URI router loaders.
- `createDefaultInputBuilder()` is a small default implementation of `InputBuilder`. It is replaceable and only loads explicit URI resources through a caller-provided `ResourceLoader`.
- `resolveContextProviders()`, `createDefaultPromptBuilder()`, and `assembleProviderInput()` are replaceable Phase 5 helpers. They do not start an agent/session runtime, call providers, execute tools, or grant tool permissions.

## Security and performance notes

- Type-only imports have no runtime side effects.
- Contracts do not create clients, stores, registries, background work, config discovery, package imports, or network calls.
- Host apps own credentials. Do not put secrets in messages, prompts, provider events, agent events, session entries, tool results, logs, or docs examples.
- Use `unknown`/metadata fields for host data, but validate at trust boundaries before executing tools or loading resources.
- App-specific tool categories and business domains do not belong in public contracts.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): default input builder for strings, messages, history, attachments, resources, summaries, and tool results.
- [Configuration and manifests](configuration-and-manifests.md): in-memory config merge helpers and data-only package manifest validation.
- [Resource loading](resource-loading.md): text, JSON, and manifest helpers over caller-provided resource loaders.
- [Extension kernel and event bus](extensions.md): runtime implementation of `ExtensionAPI`, ordered events, and extension error isolation.
- [Middleware hooks](middleware-hooks.md): ordered hook registry for runtime boundaries.
- [Contribution registries](contribution-registries.md): explicit registries for contribution contracts.
- [Tools](tools.md): active tool registry and exact allow/deny filtering built on `ToolDefinition`.
- [Provider layer](provider-layer.md): runtime registries, provider event helpers, and mock provider built on these contracts.
- [Credentials and redaction](credentials-and-redaction.md): helpers for resolving host-owned credentials and redacting known secret values.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter implementing `AIProvider`.
