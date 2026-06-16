# Input and prompt assembly

## What it does

`createDefaultInputBuilder()` turns common host input into Prism `Message[]` without starting an agent loop or calling a provider. It accepts strings, `Message`, or `Message[]`, and can add host-supplied instructions, history, summaries, attachments, explicit text resources, tool results, metadata, and optional `input_assembly` middleware.

`createDefaultPromptBuilder()` composes messages, context blocks, selected skills, and host-supplied active tools into provider-ready messages. `assembleProviderInput()` wires input assembly, ordered context resolution, prompt middleware, and prompt composition into a `ProviderRequest` without calling a provider.

## When to use it

Use it when a host wants the boring default shape before a later prompt builder or provider request step. Use a custom `InputBuilder` or `PromptBuilder` when an app has its own message or prompt policy.

Do not use it for tool execution, provider calls, file discovery, credential lookup, package activation, or an agent/session runtime.

## Inputs / request

```ts
import { createDefaultInputBuilder } from "prism";

const messages = await createDefaultInputBuilder().build("Summarize", {
  systemInstructions: "Be accurate.",
  developerInstructions: "Cite supplied context only.",
  history,
  attachments: [{ name: "notes.md", text: "# Notes" }],
  toolResults: [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }],
  metadata: { requestId: "r1" },
});
```

Prompt/provider assembly:

```ts
import { assembleProviderInput, createDefaultPromptBuilder } from "prism";

const request = await assembleProviderInput({
  model: { provider: "mock", model: "demo" },
  input: "Explain this file",
  contextProviders: [projectContext],
  promptBuilder: createDefaultPromptBuilder(),
  tools: activeTools,
});
```

Useful exported types:

- `AgentInput`: `string | Message | readonly Message[]`.
- `DefaultInputBuilder`: the default `InputBuilder` with typed default context.
- `DefaultInputBuildContext`: optional instructions, history, summaries, attachments, resource loader/URIs, tool results, middleware, ids, metadata, and abort signal.
- `InputAttachment`: already-loaded text/content or an explicit URI loaded through a caller-provided `ResourceLoader`.
- `PromptInstruction`: labeled system instruction text.
- `DefaultPromptBuilder`: the default `PromptBuilder`.
- `AssembleProviderInputOptions`: model, input, optional builders, context providers, selected skills, active tools, metadata, and signal.

## Outputs / response / events

The builder returns `readonly Message[]`.

- String input becomes one user text message.
- `Message` and `Message[]` input are preserved.
- History is prepended before current input.
- Instructions and summaries are system messages.
- Text attachments and explicit text resources are user messages.
- Tool results are tool messages containing `tool_result` content.
- Middleware runs only when `middleware` is supplied in the context.
- `assembleProviderInput()` returns a `ProviderRequest` with the caller's model/tools/metadata/signal and composed messages/context.

## Request/response example

```json
{
  "input": "Hello",
  "context": {
    "systemInstructions": "Answer briefly.",
    "attachments": [{ "name": "notes.md", "text": "Remember the release date." }]
  }
}
```

```json
[
  { "role": "system", "content": [{ "type": "text", "text": "System instruction:\nAnswer briefly." }] },
  { "role": "user", "content": [{ "type": "text", "text": "Hello" }] },
  { "role": "user", "content": [{ "type": "text", "text": "Attachment notes.md:\nRemember the release date." }] }
]
```

## Implementation example

```ts
import { createDefaultInputBuilder, createMiddlewareRegistry } from "prism";

const middleware = createMiddlewareRegistry();
middleware.use("input_assembly", (messages) => messages);

const messages = await createDefaultInputBuilder().build("Review this", {
  resourceUris: ["package://demo/prompt.md"],
  resourceLoader: {
    async load(uri) {
      return { uri, text: "Host-loaded resource text." };
    },
  },
  middleware,
});
```

## Extension and configuration notes

Extensions can contribute `InputBuilder`, `PromptBuilder`, and `ContextProvider` objects through the extension API, but contributions stay inert until the host resolves and calls or passes them. Defaults are built-ins; hosts can replace them with compatible builders.

`input_assembly`, `context`, and `prompt_build` middleware are not global. They run only for helper calls that receive a `MiddlewareRegistry`. `assembleProviderInput()` keeps provider `tools` equal to the host-supplied active tool list after prompt middleware.

## Security and performance notes

- The builder is linear in supplied messages, attachments, resources, and tool results.
- It performs no provider calls, tool execution, credential resolution, package discovery, filesystem scan, network access, timers, or watchers.
- URI attachments/resources load only through the caller-provided `ResourceLoader`.
- Do not place secrets in instructions, messages, attachments, tool results, metadata, middleware payloads, or docs examples.
- Active tools are passed through from the host; prompt middleware cannot grant additional provider tools.
- Skill selection is handled by the host/skill registry path; this builder only includes selected skills passed by the caller.

## Related APIs

- [Public contracts](public-contracts.md): `Message`, `ContentBlock`, `InputBuilder`, `InputBuildContext`, `ToolResult`, and `ResourceLoader` shapes.
- [Context and skills](context-and-skills.md): ordered context resolution feeding prompt composition.
- [Resource loading](resource-loading.md): `loadTextResource()` behavior used for explicit URI resources.
- [Middleware hooks](middleware-hooks.md): ordered middleware registry and `input_assembly`, `context`, and `prompt_build` hooks.
- [Contribution registries](contribution-registries.md): inert input builder contributions.
- [Tools](tools.md): host-owned tool registry and tool result boundary.
