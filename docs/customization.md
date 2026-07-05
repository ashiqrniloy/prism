# SDK customization guide

## What it does

This guide maps every supported Prism customization seam to the existing public API. Use it when an embedding app wants to replace provider resolution, middleware, context, input/prompt builders, instruction injectors, agent loops, compaction, retry, session stores, or skill selection without forking the runtime.

Prism customization is explicit wiring. There is no hidden global middleware, package auto-activation, provider discovery, tool grant, or background runtime.

## When to use it

Use this guide when the default agent/session runtime is close enough, but your host app needs one or more custom policies:

- route models to providers dynamically
- add middleware at documented runtime boundaries
- resolve host context or selected skills
- replace input/prompt assembly
- add inert instruction injectors
- choose a built-in or custom agent loop
- configure compaction/retry strategies
- use a durable session store

Do not use customization hooks as a sandbox, permission system, credential manager, package loader, workflow engine, vector memory, or hidden tool activator. Host policy and activation stay outside the hook.

## Inputs / request

Most seams are fields on `AgentConfig` or per-run `RunOptions`. Per-run options win where both exist.

| Customize | Entry point | Detailed page |
| --- | --- | --- |
| Provider resolution | `provider`, `providerSource`, `createProviderResolver()` | [Provider layer](provider-layer.md) |
| Middleware | `middleware`, `createMiddlewareRegistry()` | [Middleware hooks](middleware-hooks.md) |
| Context | `context`, `resolveContextProviders()` | [Context and skills](context-and-skills.md) |
| Skills | `skills`, `activeSkills`, `createSkillRegistry()`, `resolveActiveSkills()` | [Context and skills](context-and-skills.md) |
| Input builder | `inputBuilder`, `createDefaultInputBuilder()` | [Input and prompt assembly](input-and-prompt-assembly.md) |
| Prompt builder | `promptBuilder`, `createDefaultPromptBuilder()` | [Input and prompt assembly](input-and-prompt-assembly.md) |
| Instruction injectors | `instructionInjectors`, `resolveInstructionInjectors()` | [Instruction injection](instruction-injection.md) |
| Agent loops | `loop`, `singleShotLoop`, `generateValidateReviseLoop()` | [Agent loops](agent-loops.md) |
| Compaction | `compaction`, `createDefaultCompactionStrategy()` | [Compaction and retry](compaction-and-retry.md) |
| Retry | `retry`, `createDefaultRetryPolicy()` | [Compaction and retry](compaction-and-retry.md) |
| Session store | `store`, `SessionStore`, `createMemorySessionStore()` | [Session stores](session-stores.md) |

## Outputs / response / events

Customization changes what the existing runtime calls. It does not create new runtime phases.

- provider resolution happens once per run before any provider turn
- input/prompt builders run during provider-request assembly
- context providers and skills are resolved only when passed to the agent/run
- middleware runs only for documented hook call sites when a registry is supplied
- instruction injectors contribute only instructions/context blocks during assembly
- loops orchestrate shared runtime primitives and return usage
- compaction/retry run only when configured and triggered
- session stores receive redacted `SessionEntry` values when a redactor is active

Events remain the normal `AgentEvent` stream for runs, tools, compaction, retry, and artifact validation.

## Request/response example

```json
{
  "agent": {
    "providerSource": "host resolver",
    "middleware": "host registry",
    "inputBuilder": "custom input builder",
    "promptBuilder": "custom prompt builder",
    "context": ["project"],
    "skills": ["brief"],
    "instructionInjectors": ["json"],
    "loop": "generate-validate-revise",
    "compaction": "host strategy",
    "retry": "host policy",
    "store": "host session store"
  }
}
```

The JSON is a map of seams, not a Prism config format. Hosts wire concrete public API objects into `createAgent()` or `session.run()`.

## Implementation example

```ts
import {
  createAgent,
  createDefaultCompactionStrategy,
  createDefaultRetryPolicy,
  createMemorySessionStore,
  createMiddlewareRegistry,
  createMockProvider,
  createProviderResolver,
  createProviderRegistry,
  createSkillRegistry,
  createToolRegistry,
  generateValidateReviseLoop,
  providerDone,
  type ArtifactValidator,
  type ContextProvider,
  type InputBuilder,
  type PromptBuilder,
} from "@arnilo/prism";

const provider = createMockProvider([providerDone()]);
const providerSource = createProviderResolver(createProviderRegistry([provider]));
const middleware = createMiddlewareRegistry();
middleware.use("provider_request", (request, next) => next(request));

const context: ContextProvider = {
  name: "project",
  resolve: () => [{ title: "Project", content: "Host-selected context." }],
};

const inputBuilder: InputBuilder = {
  name: "custom-input",
  build: async (input) => [{ role: "user", content: [{ type: "text", text: String(input) }] }],
};

const promptBuilder: PromptBuilder = {
  name: "custom-prompt",
  build: async (request) => request.messages,
};

const validator: ArtifactValidator<unknown> = (value) =>
  typeof value === "string" && value.length > 0
    ? { ok: true }
    : { ok: false, errors: [{ message: "empty output" }] };

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  providerSource,
  middleware,
  context: [context],
  skills: createSkillRegistry([{ name: "brief", instructions: "Be brief." }]),
  tools: createToolRegistry([], { duplicate: "error" }),
  inputBuilder,
  promptBuilder,
  instructionInjectors: [{ name: "json", apply: () => ({ when: "every_turn", instructions: "Use JSON." }) }],
  loop: generateValidateReviseLoop({ validator }),
  compaction: { strategy: createDefaultCompactionStrategy(), thresholdEntries: 40 },
  retry: { policy: createDefaultRetryPolicy({ maxAttempts: 3 }) },
  store: createMemorySessionStore(),
});

await agent.createSession().run("Hello", { activeSkills: ["brief"] });
```

### Per-run override examples

```ts
await session.run("Use a different provider just this run", { providerSource: otherResolver });
await session.run("No auto compaction here", { compaction: false });
await session.run("No retry here", { retry: false });
await session.run("Use only this skill", { activeSkills: ["brief"] });
await session.run("Use a different loop", { loop: { strategy: "single-shot" } });
```

## Extension and configuration notes

- Direct `AgentConfig.provider` takes first precedence and bypasses `providerSource`. Without a direct provider, `RunOptions.providerSource` wins over `AgentConfig.providerSource`.
- A custom `ProviderResolver` returns an `AIProvider | undefined`; `undefined` fails closed before the provider turn.
- Middleware is not global. It runs only when the host passes a `MiddlewareRegistry` to `createAgent()`, `assembleProviderInput()`, `dispatchToolCall()`, compaction, or retry paths that document a hook.
- Context providers are host-selected arrays. Extension-contributed providers remain inert until resolved from registries and passed into config.
- Skills are selected by the host. `toolNames` only require active tools; they never register, allow, permit, or execute tools.
- Input and prompt builders are replaceable objects. Default builders remain available when omitted.
- Instruction injectors can add instructions and context blocks only. They grant no tools, skills, permissions, validators, credentials, resource access, or provider options.
- Agent loops should use `LoopContext` primitives instead of reimplementing provider calls, retry, abort, store appends, redaction, or event emission.
- Compaction and retry strategies are inert until selected on `AgentConfig` or `RunOptions`. `RunOptions.compaction: false` and `RunOptions.retry: false` disable configured defaults for one run.
- Session stores are explicit. `AgentSessionConfig.store` wins over `AgentConfig.store`; otherwise the session uses a private in-memory store.
- Extension packages can register builders, strategies, policies, providers, tools, context, skills, and injectors, but host code still chooses which contributions become active.

## Security and performance notes

- Customization cannot grant tools or permissions unless the host explicitly activates tools and permission policies at the tool-dispatch boundary.
- Middleware, skills, context providers, prompt builders, and instruction injectors cannot bypass tool lookup, allow/deny filters, object-argument checks, permission checks, or `ToolValidator`.
- Do not put credentials in models, prompts, context, skills, instruction injectors, middleware payloads, cache keys, session entries, ledgers, or examples.
- Use `createSecretRedactor()` on agent/run config when custom components may handle known secret values.
- Replaceable hooks are in-process calls on the active path. Prism adds no hidden global middleware, background workers, watchers, package scans, provider calls, resource loads, tool execution, or credential resolution unless the host wires that operation.
- Custom providers, stores, tools, middleware, loops, and extensions are host code. Prism does not sandbox them.
- Strict duplicate registries (`{ duplicate: "error" }`) prevent silent shadowing when loading third-party contributions.

## Related APIs

- [Provider layer](provider-layer.md): provider registries/resolvers and model routing.
- [Middleware hooks](middleware-hooks.md): hook names and runtime call sites.
- [Input and prompt assembly](input-and-prompt-assembly.md): default/custom builders, templates, context, and tools in provider requests.
- [Instruction injection](instruction-injection.md): inert package instructions/context blocks.
- [Agent loops](agent-loops.md): `singleShotLoop`, `generateValidateReviseLoop`, custom `AgentLoopStrategy`, and `LoopContext`.
- [Compaction and retry](compaction-and-retry.md): compaction/retry options, strategies, middleware, and disabling per run.
- [Context and skills](context-and-skills.md): ordered context providers, skill registries, active-skill selection, and `toolNames` fail-closed behavior.
- [Session stores](session-stores.md): store selection, branch reads, and conformance.
- [Tools](tools.md): active tool registry, filtering, permission, validation, and no sandbox.
- [Extension authoring guide](extension-authoring.md): publishing inert contributions for hosts to select.
- [Host security guide](host-security.md): fail-closed security checklist for embedding apps.
