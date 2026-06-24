# System prompts

## What it does

Layered system prompts let hosts compose caller-supplied prompt contributions before the default input builder turns them into system messages.

Public helpers:

- `composeSystemPrompt(contributions, { base })`
- `mergeSystemPromptConfig(config, override)`
- `SystemPromptContribution`, `SystemPromptMode`, `SystemPromptSource`, `SystemPromptConfig`

`AgentConfig.instructions` stays the simple base prompt path. `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` add explicit layers on top.

## When to use it

Use this API when an app wants deterministic package/app/user/run prompt layers without filesystem discovery or package loading.

Do not use it for prompt template expansion, resource loading, settings discovery, credential lookup, provider calls, or hidden global prompts.

## Inputs / request

```ts
composeSystemPrompt([
  { id: "pkg", source: "package", mode: "append", text: "Package rule." },
  { id: "app", source: "app", mode: "replace", text: "App rule." },
  { id: "run", source: "run", mode: "append", text: "Run rule." },
], { base: "Base instruction." });
```

`source` order is deterministic for known sources: `package`, `app`, `user`, then `run`. Unknown sources keep input order after known sources.

`mode` behavior:

| Mode | Behavior |
| --- | --- |
| `append` or omitted | Add text after earlier prompt text. |
| `prepend` | Add text before current prompt text. |
| `replace` | Clear earlier prompt text and use this text. |
| `disable` | Clear earlier prompt text and add no text. Later layers may still add text. |

`RunOptions.systemPrompt: false` disables configured prompt layers for that run while keeping `AgentConfig.instructions` as the base prompt.

## Outputs / response / events

`composeSystemPrompt()` returns the composed prompt string or `undefined` when no prompt text remains. The agent/session runtime passes that string to `assembleProviderInput()` as `systemInstructions`; it does not emit a separate event or store prompt layers.

## Request/response example

```json
{
  "base": "Base",
  "layers": [
    { "id": "app", "source": "app", "mode": "replace", "text": "App" },
    { "id": "run", "source": "run", "mode": "append", "text": "Run" }
  ],
  "composed": "App\n\nRun"
}
```

## Implementation example

```ts
import { composeSystemPrompt, createAgent } from "@arnilo/prism";

const prompt = composeSystemPrompt([
  { id: "app", source: "app", mode: "replace", text: "You are concise." },
  { id: "user", source: "user", mode: "append", text: "Prefer bullet points." },
], { base: "Base instruction." });

const agent = createAgent({
  model,
  provider,
  instructions: "Base instruction.",
  systemPrompt: { id: "app", source: "app", mode: "append", text: "Use safe JSON." },
});

await agent.createSession().run("Hi", {
  systemPrompt: { id: "run", source: "run", mode: "append", text: "Answer briefly." },
});
```

## Extension and configuration notes

Extensions and provider packages can register `SystemPromptContribution` values, but registration is inert. Hosts must select contributions and pass them to `AgentConfig.systemPrompt` or `RunOptions.systemPrompt`.

Manifests can declare `systemPromptContribution` kinds as data-only references:

```ts
import { definePrismManifest } from "@arnilo/prism";

export default definePrismManifest({
  name: "demo-prompts",
  contributions: [
    { kind: "systemPromptContribution", name: "demo.prompt", metadata: { id: "demo-prompt", source: "package", mode: "append" } },
  ],
});
```

The manifest entry does not load or apply the prompt. The host must still select it and pass the `SystemPromptContribution` to the runtime.

No `SYSTEM.md`, `APPEND_SYSTEM.md`, prompt template, settings, or manifest discovery happens in core.

## Security and performance notes

- Composition is a single in-memory pass plus deterministic ordering; no dependency, watcher, filesystem read, provider call, or tokenizer is added.
- Prompt text is caller-supplied content. Do not put secrets in prompts, settings, manifests, session entries, package metadata, or docs examples.
- `replace`/`disable` make prompt policy explicit; they are not permission or sandbox controls.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): default input builder receives the composed system instruction string.
- [Agent/session runtime](agent-session-runtime.md): runtime fields `AgentConfig.systemPrompt` and `RunOptions.systemPrompt`.
- [Contribution registries](contribution-registries.md): inert system prompt contribution registry.
- [Extensions](extensions.md): `registerSystemPromptContribution()`.
- [Public contracts](public-contracts.md): exported prompt contribution contracts.
