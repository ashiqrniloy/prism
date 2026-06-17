# Context and skills

## What it does

`resolveContextProviders()` runs host-selected `ContextProvider` objects in caller order and returns explicit `ContextBlock[]`. `createSkillRegistry()` stores host-selected `Skill` objects, and `resolveActiveSkills()` discloses only requested skills after checking their `toolNames` against host-active tools.

## When to use it

Use context resolution when a host wants project/session/context blocks resolved before prompt composition. Use the skill registry when a host wants explicit progressive skill disclosure.

Do not use these helpers as an agent loop, package discovery mechanism, context cache, token budgeter, retrier, credential resolver, semantic skill ranker, tool activator, or permission system.

## Inputs / request

```ts
import { resolveContextProviders } from "prism";

const context = await resolveContextProviders({
  providers: [projectContext],
  messages,
  sessionId: "s1",
  runId: "r1",
  metadata: { requestId: "r1" },
  signal,
});
```

`ResolveContextOptions` accepts `providers`, `messages`, optional session/run ids, metadata, abort signal, and optional middleware.

Skill selection:

```ts
import { createSkillRegistry, resolveActiveSkills } from "prism";

const registry = createSkillRegistry([{ name: "brief", instructions: "Answer briefly.", toolNames: ["echo"] }]);
const active = resolveActiveSkills({
  registry,
  names: ["brief"],
  tools: activeTools,
});
```

`ResolveActiveSkillsOptions` accepts a `SkillRegistry`, requested skill names, and host-active `ToolDefinition[]`.

## Outputs / response / events

`resolveContextProviders()` returns `readonly ContextBlock[]` in provider order. If a middleware registry is supplied, the `context` hook can transform the final block array.

`resolveActiveSkills()` returns requested skills in requested order. Unknown skills and skills that reference inactive tools throw before prompt composition.

## Request/response example

```json
{
  "providers": ["project"],
  "skills": ["brief"],
  "activeTools": ["echo"],
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Explain" }] }]
}
```

```json
[
  { "title": "Project", "content": "Project context" }
]
```

## Implementation example

```ts
import { assembleProviderInput, createDefaultPromptBuilder, resolveActiveSkills, resolveContextProviders } from "prism";

const blocks = await resolveContextProviders({ providers, messages });

const activeSkills = resolveActiveSkills({ registry: skills, names: ["brief"], tools: activeTools });
const request = await assembleProviderInput({
  model: { provider: "mock", model: "demo" },
  input: "Explain this file",
  contextProviders: providers,
  promptBuilder: createDefaultPromptBuilder(),
  skills: activeSkills,
  tools: activeTools,
});
```

## Extension and configuration notes

Extensions can contribute context providers and skills with `registerContextProvider()` and `registerSkill()`, but those contributions stay inert until the host selects providers or registers/selects skills. The agent/session runtime uses the `context` and selected `skills` arrays passed on `AgentConfig`; it does not auto-select contributions.

```ts
const providers = [kernel.registries.contextProviders.resolve("project")];
const skillRegistry = createSkillRegistry([kernel.registries.skills.resolve("brief")]);
const skills = resolveActiveSkills({ registry: skillRegistry, names: ["brief"], tools: activeTools });
```

`context` middleware runs only when a middleware registry is supplied to the helper. Middleware transforms context data; it does not grant tool access. Skills can reference tool names, but only host-active tools satisfy those references.

## Security and performance notes

- Context providers run sequentially and deterministically in caller order.
- Skill registry lookup is `Map`-backed, and selection is linear in requested skills plus active tools.
- These helpers perform no provider calls, tool execution, resource loading, package discovery, filesystem/network access, retries, timers, or watchers by themselves.
- Context and skill output is host/extension data. Do not include secrets unless the host explicitly accepts that prompt exposure.
- Active tools remain host-supplied; skills and middleware do not activate tools or grant permissions.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): consumes host-selected context providers and skills from explicit agent config.
- [Input and prompt assembly](input-and-prompt-assembly.md): default prompt builder and provider-input assembly helper.
- [Public contracts](public-contracts.md): `ContextProvider`, `ContextResolutionContext`, `ContextBlock`, `Skill`, `SkillRegistry`, `PromptBuilder`, and `PromptBuildRequest`.
- [Middleware hooks](middleware-hooks.md): `context` and `prompt_build` hooks.
- [Contribution registries](contribution-registries.md): inert context provider and skill contributions.
- [Tools](tools.md): host-owned active tools and permissions.
