# Extension kernel and event bus

## What it does

The extension kernel loads host-provided `Extension` objects in order and gives each extension a runtime `ExtensionAPI`. The API can register contributions into explicit registries, register middleware, subscribe to lifecycle events, and emit events.

APIs:

- `createExtensionKernel()` / `ExtensionKernel`
- `createExtensionEventBus()` / `ExtensionEventBus`
- `ExtensionAPI`, `ExtensionEvent`, and `extension_error` events
- Shared `MiddlewareRegistry` access and `api.use()` registration

## When to use it

Use the extension kernel when a host wants packages to contribute providers, models, tools, context providers, skills, commands, agents, builders, strategies, stores, resources, settings providers, or credential resolvers without editing Prism internals.

Skip the kernel and use contribution registries directly when the host does not need extension setup lifecycle or events.

## Inputs / request

```ts
createExtensionKernel(options?: ExtensionKernelOptions): ExtensionKernel
createExtensionEventBus(options?: { errorPolicy?: "event" | "throw"; secrets?: readonly string[] }): ExtensionEventBus
```

`ExtensionKernelOptions`:

| Field | Type | Purpose |
| --- | --- | --- |
| `registries` | `ContributionRegistries` | Optional host-created registry bundle. |
| `middleware` | `MiddlewareRegistry` | Optional host-created middleware registry. |
| `errorPolicy` | `"event" | "throw"` | Defaults to `"event"`; use `"throw"` for fail-fast setup/listener/middleware errors. |
| `secrets` | readonly strings | Known secret values to redact from extension error events. |

`ExtensionAPI` includes `registries`, `middleware`, `on()`, `emit()`, `use()`, and registration methods for all Phase 2 contribution categories.

## Outputs / response / events

- `kernel.load(extensions)` calls each extension's `setup(api)` in host-provided order.
- `kernel.registries` exposes the explicit contribution registry bundle.
- `kernel.events.on(type, handler)` registers ordered event handlers and returns an unsubscribe function.
- `kernel.events.emit(event)` calls matching handlers in registration order.
- `kernel.middleware.run(hook, value)` runs matching middleware in registration order.
- With default `errorPolicy: "event"`, setup/listener/middleware errors become `extension_error` events with redacted `ErrorInfo`.
- With `errorPolicy: "throw"`, setup/listener/middleware errors reject/throw.

## Request/response example

```json
{
  "loaded": ["demo-extension"],
  "events": [{ "type": "extension_error", "extension": "demo-extension" }]
}
```

## Implementation example

```ts
import { createAgent, createExtensionKernel, type Extension } from "prism";

const extension: Extension = {
  name: "demo-extension",
  setup(api) {
    api.registerModel({ provider: "mock", model: "demo" });
    api.registerTool({ name: "echo", execute: (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo", value: args }) });
    api.registerContextProvider({ name: "project", resolve: () => [{ title: "Project", content: "Context" }] });
    api.registerInputBuilder({ name: "input", build: async () => [{ role: "user", content: [{ type: "text", text: "Hello" }] }] });
    api.registerPromptBuilder({ name: "prompt", build: async (request) => request.messages });
    api.registerSkill({ name: "brief", instructions: "Answer briefly.", toolNames: ["echo"] });
    api.registerAgent({ name: "demo", create: () => createAgent({ model, provider }) });
    api.on("session_start", (event) => {
      console.log(event.type);
    });
    api.use("provider_request", (request) => request);
  },
};

const kernel = createExtensionKernel({ errorPolicy: "event" });
await kernel.load([extension]);

console.log(kernel.registries.models.resolve("mock", "demo").model);
console.log(kernel.registries.tools.resolve("echo").name); // contributed only; host must activate before dispatch
console.log(kernel.registries.contextProviders.resolve("project").name); // contributed only; host must select before context resolution
console.log(kernel.registries.inputBuilders.resolve("input").name); // contributed only; host must pass it to assembly
console.log(kernel.registries.promptBuilders.resolve("prompt").name); // contributed only; host must pass it to assembly
console.log(kernel.registries.skills.resolve("brief").name); // contributed only; host must select before prompt use
console.log(kernel.registries.agents.resolve("demo").name); // contributed only; host must create/select before runtime use
await kernel.middleware.run("provider_request", { metadata: {} });
```

## Extension and configuration notes

- Extension loading is explicit. Prism does not discover packages, read manifests, or load filesystem config in the kernel.
- Setup order is the order provided by the host.
- The kernel writes only to explicit registries returned by `createContributionRegistries()` or provided by the host.
- `api.registerTool()` contributes an inert `ToolDefinition` to `registries.tools`; it does not add the tool to an active tool registry, allow list, or dispatch loop.
- `api.registerInputBuilder()`, `api.registerPromptBuilder()`, and `api.registerContextProvider()` contribute inert builders/providers; they do not replace defaults or run until the host passes selected entries to Phase 5 helpers.
- `api.registerSkill()` contributes an inert `Skill` to `registries.skills`; it does not disclose instructions, activate referenced tools, or grant permissions until the host selects it.
- `api.registerAgent()` contributes an inert `AgentDefinition`; its `create()` can call `createAgent()`, but the runtime is not started until host code resolves the definition and creates/runs a session.
- The kernel registers middleware only into the explicit registry returned by `createMiddlewareRegistry()` or provided by the host.
- Manifest and configuration APIs are later-phase work.

## Security and performance notes

- No hidden global extension kernel, provider registry, credential resolver, settings provider, store, or resource loader is created.
- Error events use `ErrorInfo` and redact only known secret values passed in `secrets`.
- Do not put resolved credential values in extension events, registry metadata, docs, logs, prompts, or session stores.
- Event and middleware dispatch are ordered and dependency-free. They use no timers, background workers, filesystem discovery, network calls, provider calls, or tool execution.
- Extension middleware cannot bypass host tool permissions: tool dispatch re-checks active registry lookup, filters, and object arguments after `tool_call` middleware. Skills that reference `toolNames` are checked against host-active tools by `resolveActiveSkills()`.

## Related APIs

- [Middleware hooks](middleware-hooks.md): ordered hook registry populated by `ExtensionAPI.use()`.
- [Contribution registries](contribution-registries.md): registry bundle populated by `ExtensionAPI`.
- [Tools](tools.md): host activation, filtering, and dispatch for contributed tool definitions.
- [Input and prompt assembly](input-and-prompt-assembly.md): host selection for contributed input/prompt builders.
- [Context and skills](context-and-skills.md): host selection and tool checks for contributed context providers and skills.
- [Agent/session runtime](agent-session-runtime.md): `AgentDefinition.create()` can return agents built with `createAgent()` from explicit host-selected config.
- [Public contracts](public-contracts.md): `Extension`, `ExtensionAPI`, and contribution contract types.
- [Credentials and redaction](credentials-and-redaction.md): secret-redaction behavior used for extension errors.
