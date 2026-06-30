# Context and skills

## What it does

`resolveContextProviders()` runs host-selected `ContextProvider` objects in caller order and returns explicit `ContextBlock[]`. `createSkillRegistry()` stores host-selected `Skill` objects, and `resolveActiveSkills()` discloses only requested skills after checking their `toolNames` against host-active tools.

## When to use it

Use context resolution when a host wants project/session/context blocks resolved before prompt composition. Use the skill registry when a host wants explicit progressive skill disclosure.

Do not use these helpers as an agent loop, package discovery mechanism, context cache, token budgeter, retrier, credential resolver, semantic skill ranker, tool activator, or permission system.

## Inputs / request

```ts
import { resolveContextProviders } from "@arnilo/prism";

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
import { createSkillRegistry, resolveActiveSkills } from "@arnilo/prism";

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
import { assembleProviderInput, createDefaultPromptBuilder, resolveActiveSkills, resolveContextProviders } from "@arnilo/prism";

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

## Runtime skill selection and activation

The agent/session runtime resolves skills per run and wires each active skill's `context` into the assembled provider input. Selection precedence mirrors the other `RunOptions` overrides (`redactor`, `validate`):

1. `AgentConfig.skills` is a `SkillRegistry` and `RunOptions.activeSkills: readonly string[]` (names) is set → the runtime calls `resolveActiveSkills({ registry, names, tools })`.
2. `RunOptions.skills: readonly Skill[]` is set → that array replaces `AgentConfig.skills` for the run. This override exists for the case where `AgentConfig.skills` is a plain `Skill[]` (no registry), so name resolution is impossible.
3. Neither set → all configured skills are active (current behavior; `SkillRegistry.list()` or the plain array as-is).

names win when a registry exists. `RunOptions.activeSkills` cannot be used against a plain-array `AgentConfig.skills` — use `RunOptions.skills` instead.

Each active skill contributes two things the runtime now wires together:

- `Skill.instructions` → rendered as system messages by `skillMessages()` (active set only).
- `Skill.context: ContextProvider[]` → collected across active skills (`activeSkills.flatMap(s => s.context ?? [])`), resolved through the existing `resolveContextProviders(...)`, and merged into the request's `context` **after** host `AgentConfig.context` blocks. Inactive skills contribute neither instructions nor context.

`toolNames` enforcement is live: because selection routes through `resolveActiveSkills()`, a skill demanding a host-inactive tool throws with `Skill ${name} requires inactive tool: ${missing}` **before the first provider turn** — no provider call, no store write, no partial side effect. This is the fail-fast contract the docs already claimed; the runtime now honors it.

```ts
import { createAgent, createSkillRegistry, type ContextProvider } from "@arnilo/prism";

const schema: ContextProvider = { name: "schema", resolve: () => [{ title: "Schema", content: "selected schema" }] };
const skills = createSkillRegistry([
  { name: "summarize", instructions: "Summarize.", context: [schema], toolNames: ["echo"] },
  { name: "translate", instructions: "Translate." },
]);

const agent = createAgent({ model, provider, skills, tools: [echo] });

// Only summarize this run: its instructions render and schema context resolves;
// translate stays inactive and contributes neither. If `echo` were not in the
// active tool set, this run would throw before the first provider turn.
await agent.createSession().run(input, { activeSkills: ["summarize"] });

// Same config, different active skills on the next run:
await agent.createSession().run(input, { activeSkills: ["translate"] });

// Plain-array override (no registry on AgentConfig.skills):
await session.run(input, { skills: [{ name: "verbose", instructions: "Be verbose." }] });
```

Skill selection grants no tool access and cannot bypass permissions — a skill's `toolNames` can only *require* host-active tools, never activate or grant them. Per-skill token budgeting is deferred; the merge order (host context, then skill context) is the only priority knob today.

## Security and performance notes

- Context providers run sequentially and deterministically in caller order.
- Skill registry lookup is `Map`-backed, and selection is linear in requested skills plus active tools.
- These helpers perform no provider calls, tool execution, resource loading, package discovery, filesystem/network access, retries, timers, or watchers by themselves.
- Context and skill output is host/extension data. Do not include secrets unless the host explicitly accepts that prompt exposure.
- Active tools remain host-supplied; skills and middleware do not activate tools or grant permissions.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): consumes host-selected context providers and skills from explicit agent config.
- [Input and prompt assembly](input-and-prompt-assembly.md): default prompt builder and provider-input assembly helper.
- [Instruction injection](instruction-injection.md): package injectors contribute `contextBlocks` that merge after host+skill provider blocks.
- [Public contracts](public-contracts.md): `ContextProvider`, `ContextResolutionContext`, `ContextBlock`, `Skill`, `SkillRegistry`, `PromptBuilder`, and `PromptBuildRequest`.
- [Middleware hooks](middleware-hooks.md): `context` and `prompt_build` hooks.
- [Contribution registries](contribution-registries.md): inert context provider and skill contributions.
- [Contribution discovery (workspace)](contribution-discovery.md): opt-in filesystem scanner that turns `SKILL.md`/`manifest.json` into registered skills and descriptor stubs. (Per-agent `AGENT.md` bundles live under an app-controlled `configRoot`; see [Agent definitions](agent-definitions.md).)
- [Tools](tools.md): host-owned active tools and permissions.
