# Public contracts

## What it does

The root `prism` export provides TypeScript contracts for host-owned agent systems. These contracts describe data shapes and extension points; they do not create providers, agents, sessions, stores, credentials, tools, or network calls by themselves.

Current contract groups:

- JSON/data: `JsonPrimitive`, `JsonValue`, `JsonObject`, `ErrorInfo`
- Content/messages: `ContentBlock`, `TextContent`, `ImageContent`, `ThinkingContent`, `ToolCallContent`, `ToolResultContent`, `Message`
- Providers/models: `ModelConfig`, `Usage`, `ProviderRequest`, `ProviderEvent`, `AIProvider`
- Agents/sessions: `AgentConfig`, `Agent`, `AgentSessionConfig`, `AgentSession`, `RunOptions`, `AgentEvent`
- Tools: `ToolDefinition`, `ToolRegistry`, `ToolExecutionContext`, `ToolResult`
- Context/skills: `ContextBlock`, `ContextProvider`, `ContextResolutionContext`, `Skill`, `SkillRegistry`
- Extensions: `ExtensionLifecycleEventName`, `ExtensionEvent`, `Extension`, `ExtensionAPI`
- Stores/resources/settings/credentials: `SessionEntry`, `SessionStore`, `Resource`, `ResourceLoader`, `ResourceLoadContext`, `SettingsProvider`, `CredentialRequest`, `Credential`, `CredentialResolver`

## When to use it

Use these contracts when a host app or external package needs to type Prism-compatible providers, tools, context providers, skills, extensions, sessions, stores, resources, settings, or credential resolvers.

Do not use these contracts as proof that runtime behavior exists. Agent/session loops, tool dispatch, persistence adapters, extension loading, and configuration loading are implemented in later phases.

## Inputs / request

Public contracts are imported from the root package:

```ts
import type {
  AgentConfig,
  AIProvider,
  ContextProvider,
  CredentialResolver,
  Extension,
  Message,
  ModelConfig,
  ResourceLoader,
  SettingsProvider,
  Skill,
  ToolDefinition,
} from "prism";
```

Important request shapes:

| Contract | Purpose |
| --- | --- |
| `ProviderRequest` | Normalized provider input: `model`, `messages`, optional `tools`, `context`, `metadata`, and `signal`. |
| `ToolExecutionContext` | Host tool execution context: session/run ids, tool call id, optional abort signal, and metadata. |
| `ContextResolutionContext` | Context provider input: messages plus optional session/run ids, metadata, and signal. |
| `CredentialRequest` | Credential lookup request: credential `name`, optional provider id, and metadata. |
| `RunOptions` | Per-run overrides: optional abort signal, model, max tool rounds, and metadata. |

## Outputs / response / events

Important output/event shapes:

| Contract | Output |
| --- | --- |
| `ProviderEvent` | Provider stream events: message start, content delta, tool-call delta, final tool call, usage, done, or error. |
| `AgentEvent` | Session/runtime events: agent/turn/message/tool/queue/compaction/retry/error events. |
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
  AIProvider,
  ContextProvider,
  CredentialResolver,
  Extension,
  ResourceLoader,
  SettingsProvider,
  Skill,
  ToolDefinition,
} from "prism";

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
void extension;
void resources;
void settings;
void credentials;
```

## Extension and configuration notes

- Contracts are host-owned and package-friendly. External packages can implement `AIProvider`, `ToolDefinition`, `ContextProvider`, `Skill`, `Extension`, stores, resource loaders, settings providers, and credential resolvers.
- `ExtensionAPI` is a contract only in this phase. The runtime extension bus is planned separately.
- `AgentConfig.provider` can hold a direct provider instance today; later runtime phases may also resolve providers through registries and configuration.
- `SettingsProvider` and `CredentialResolver` are explicit dependencies. Prism must not hide global settings or credentials behind these contracts.

## Security and performance notes

- Type-only imports have no runtime side effects.
- Contracts do not create clients, stores, registries, background work, or network calls.
- Host apps own credentials. Do not put secrets in messages, prompts, provider events, agent events, session entries, tool results, logs, or docs examples.
- Use `unknown`/metadata fields for host data, but validate at trust boundaries before executing tools or loading resources.
- App-specific tool categories and business domains do not belong in public contracts.

## Related APIs

- [Provider layer](provider-layer.md): runtime registries, provider event helpers, and mock provider built on these contracts.
- [Credentials and redaction](credentials-and-redaction.md): helpers for resolving host-owned credentials and redacting known secret values.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter implementing `AIProvider`.
