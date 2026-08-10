# Context and skills

## What it does

`resolveContextProviders()` runs host-selected `ContextProvider` objects in caller order and returns explicit `ContextBlock[]`. `createSkillRegistry()` stores host-selected `Skill` objects, and `resolveActiveSkills()` discloses only requested skills after checking their `toolNames` against host-active tools.

## When to use it

Use context resolution when a host wants project/session/context blocks resolved before prompt composition. Use the skill registry when a host wants explicit progressive skill disclosure: catalog `name` + `description` every turn by default, full `instructions` only after `load_skill` or when the host opts into eager mode. Declarative `AgentDefinition.skills` are inactive unless listed; omitted skills means none unless the host uses the migration-only `activateAllCapabilities: true` option.

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

const registry = createSkillRegistry(
  [{ name: "brief", instructions: "Answer briefly.", toolNames: ["echo"] }],
  { duplicate: "error" },
);
const active = resolveActiveSkills({
  registry,
  names: ["brief"],
  tools: activeTools,
});
```

`createSkillRegistry(skills?, options?)` stores skills by `skill.name`. Duplicate names replace deterministically by default for compatibility. Pass `{ duplicate: "error" }` to throw `Duplicate skill: <name>` and prevent silent shadowing.

`ResolveActiveSkillsOptions` accepts a `SkillRegistry`, requested skill names, and host-active `ToolDefinition[]`.

## Outputs / response / events

`resolveContextProviders()` returns `readonly ContextBlock[]` in provider order. If a middleware registry is supplied, the `context` hook can transform the final block array.

`resolveActiveSkills()` returns requested skills in requested order. Unknown skills, duplicate skill registrations in strict mode, and skills that reference inactive tools throw before prompt composition.

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

Extensions can contribute context providers and skills with `registerContextProvider()` and `registerSkill()`, but those contributions stay inert until the host selects providers or registers/selects skills. `resolveAgentDefinition()` only selects skills named in `AgentDefinition.skills` by default; omitted declarative skills activate none. The agent/session runtime uses the `context` and selected `skills` arrays passed on `AgentConfig`; it does not auto-select contributions.

```ts
const providers = [kernel.registries.contextProviders.resolve("project")];
const skillRegistry = createSkillRegistry([kernel.registries.skills.resolve("brief")]);
const skills = resolveActiveSkills({ registry: skillRegistry, names: ["brief"], tools: activeTools });
```

`context` middleware runs only when a middleware registry is supplied to the helper. Middleware transforms context data; it does not grant tool access. Skills can reference tool names, but only host-active tools satisfy those references.

## Runtime skill selection and activation

The agent/session runtime resolves skills per run and wires each active skill's `context` into the assembled provider input. Runtime `AgentConfig.skills` and declarative `AgentDefinition.skills` have different defaults:

| Surface | Config shape | Run override | Active skills |
| --- | --- | --- | --- |
| Runtime agent | `AgentConfig.skills: SkillRegistry` | `RunOptions.activeSkills: ["brief"]` | Named skills only, resolved with `resolveActiveSkills({ registry, names, tools })`. |
| Runtime agent | `AgentConfig.skills: SkillRegistry` | no `activeSkills` / no `skills` / no `activateAllSkills` | No skills active (fail-closed default). |
| Runtime agent | `AgentConfig.skills: SkillRegistry` | `activateAllSkills: true` (run or agent) | All registry skills (`SkillRegistry.list()`), migration opt-in. |
| Runtime agent | `AgentConfig.skills: Skill[]` | `RunOptions.skills: [...]` | Override array only. |
| Runtime agent | `AgentConfig.skills: Skill[]` | no `RunOptions.skills` | All configured array skills. |
| Declarative definition | `AgentDefinition.skills: ["brief"]` | later runtime `activeSkills` optional | Listed names only. |
| Declarative definition | omitted `AgentDefinition.skills` | `activateAllCapabilities` false/default | No skills active. |
| Declarative definition | omitted `AgentDefinition.skills` | `activateAllCapabilities: true` | All registry skills, migration-only. |

Runtime selection precedence mirrors the other `RunOptions` overrides (`redactor`, `validate`):

1. `AgentConfig.skills` is a `SkillRegistry` and `RunOptions.activeSkills: readonly string[]` (names) is set → the runtime calls `resolveActiveSkills({ registry, names, tools })`.
2. `RunOptions.skills: readonly Skill[]` is set → that array replaces `AgentConfig.skills` for the run. This override exists for the case where `AgentConfig.skills` is a plain `Skill[]` (no registry), so name resolution is impossible.
3. Neither set → no skills active when `AgentConfig.skills` is a `SkillRegistry` (fail-closed). Use `activateAllSkills: true` on the run or agent to restore prior list-all behavior (`SkillRegistry.list()`). Plain `Skill[]` configs still activate every configured array skill. This is not the declarative default.

names win when a registry exists. `RunOptions.activeSkills` cannot be used against a plain-array `AgentConfig.skills` — use `RunOptions.skills` instead. Use `RunOptions.skills: []` for an explicit no-skills runtime run.

Each active skill contributes two things the runtime wires together:

- `Skill` prompt text → rendered as system messages by `skillMessages()` / `skillPromptText()` (active set only). Default `skillsDisclosure: "progressive"` sends `Skill <name>: <description>`; full `instructions` appear only when the skill is in the session `LoadedSkillSet` or disclosure is `"eager"`.
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
await session.run(input, { skills: [] }); // explicit no skills for this run
```

Skill selection grants no tool access and cannot bypass permissions — a skill's `toolNames` can only *require* host-active tools, never activate or grant them. Declarative skills also do not activate themselves by presence in a registry; list names on `AgentDefinition.skills` (or pass runtime `activeSkills`) when wanted.

### Progressive skill disclosure

`skillsDisclosure` on `AgentConfig` / `RunOptions` (`"progressive"` default, `"eager"` opt-in; run wins) controls how active skills render in provider input:

| Mode | Provider view per active skill |
| --- | --- |
| `"progressive"` (default) | `Skill <name>: <description>` (or `(no description)` when empty) |
| `"eager"` | `Skill <name>:\n<instructions>` every turn (pre-0.0.20 behavior) |

Catalog caps: **64** entries default / **256** hard; descriptions **512 B** default / **4 KiB** hard; instruction bodies **32 KiB** default / **256 KiB** hard on load/eager render. Oversize catalog/description/instruction payloads fail closed (`SkillDisclosureError` / `SkillLoadError`).

```ts
import { assembleProviderInput, createLoadedSkillSet } from "@arnilo/prism";

const loaded = createLoadedSkillSet(); // session-owned; opt-in checkpoint-persisted via runState.persistSessionState (names only) since 0.1.3
const request = await assembleProviderInput({
  model,
  input: "Hi",
  skills: active,
  skillsDisclosure: "progressive",
  loadedSkills: loaded,
});
```

### On-demand skill load (`load_skill`)

Hosts opt in by registering `createLoadSkillTool({ registry, loaded })` on the active tool set. The model calls `load_skill { name }` with an exact registry name; success adds the name to the session `LoadedSkillSet` so later turns include `instructions` under progressive mode. The tool does **not** activate tools, widen permissions, or load skills that were not active for the run.

Fail-closed cases: unknown name, inactive skill for the run, inactive required `toolNames`, oversize body, duplicate load, missing session loaded-set wiring. Tool output and errors are size-capped; skill text is untrusted host/extension data.

```ts
import { createAgent, createLoadSkillTool, createSkillRegistry } from "@arnilo/prism";

const registry = createSkillRegistry([ponytail, brief]);
const loadSkill = createLoadSkillTool({ registry }); // session injects loadedSkills at dispatch
const agent = createAgent({ model, provider, skills: registry, tools: [loadSkill, /* host */] });
await agent.createSession().run("…", { activeSkills: ["ponytail"] });
// Turn 1: catalog only. After load_skill({ name: "ponytail" }), later turns include instructions.
```

### Third-party behavior packages (Caveman, Ponytail)

`@arnilo/prism-caveman` and `@arnilo/prism-ponytail` register upstream skills into the extension kernel skill registry. Hosts should:

1. `kernel.load([createCavemanExtension(...), createPonytailExtension(...)])` with session `appendEntry` / `getEntries` callbacks.
2. Build `createSkillRegistry(kernel.registries.skills.list())` and pass `activeSkills` / `resolveActiveSkills` names.
3. Keep `skillsDisclosure: "progressive"` and register `createLoadSkillTool` — full `SKILL.md` bodies stay catalog-only until `load_skill`.
4. Select `instructionInjectors: ["caveman-mode", "ponytail-mode"]` (or subset) for mode/level slices **without** forcing `skillsDisclosure: "eager"`.

Mode slices and skill bodies are independent: the injector can add `PONYTAIL MODE ACTIVE` while `ponytail-audit` remains catalog-only until loaded. See [Caveman](caveman.md), [Ponytail](ponytail.md), and `examples/caveman-ponytail.ts`.

Pure validation without the tool: `resolveSkillLoad({ registry, name, tools, loaded, activeSkillNames })`.

### Context budget priority and skill demotion

When `assembleProviderInput` runs with `contextBudget`, `applyContextBudget` evicts droppable sections in layout order. Within `context` blocks and skills, victims sort by ascending `ContextBlock.priority` (missing = **0**), then LIFO within the same priority.

Under pressure on a skill with a loaded body, eviction may demote to catalog-only first (`ContextBudgetOmissionKind: "skill_body"`), then remove the skill entirely (`"skills"`). Demoted bodies render as description-only even when the name remains in `LoadedSkillSet`. See [Input and prompt assembly](input-and-prompt-assembly.md).

### Optional tool-result fold

`toolResultFold` on `AgentConfig` / `RunOptions` (run wins) is **off** unless the host supplies a `summarize` callback. When enabled, aged large tool-result messages in the **provider view** become a one-line header plus bounded summary text; session store entries stay raw. Defaults: `minAgeTurns` **2**, `minBytes` **4096**, `maxSummaryBytes` **512** (hard **4096**). Summarizer failure keeps the raw tool result (fail closed). Not a second memory system — use observational memory / compaction for durable recall.

```ts
await session.run("…", {
  toolResultFold: {
    minAgeTurns: 2,
    minBytes: 4_096,
    summarize: async ({ toolCallId, text }) => `ref:${toolCallId} ${text.slice(0, 80)}`,
  },
});
```

### Migration note

For declarative agents, old configs that omitted `skills` should now add explicit names:

```ts
// New safe default: no skill activates by omission.
resolveAgentDefinition({ name: "doc", model, skills: ["brief"] }, context);
```

Runtime hosts that relied on `SkillRegistry.list()` when `activeSkills` was omitted must opt in explicitly:

```ts
// Restore pre-0.0.20 list-all activation (still subject to progressive disclosure):
await session.run("Hi", { activateAllSkills: true });

// Or restore full instruction bodies every turn:
const agent = createAgent({ model, provider, skills: registry, skillsDisclosure: "eager" });
```

Use `activateAllCapabilities: true` only as a temporary all-skills/all-tools compatibility opt-in during migration for **declarative** definitions. Runtime `RunOptions.activeSkills` remains the per-run narrowing tool after an agent has a skill registry configured.

## Security and performance notes

- Context providers run sequentially and deterministically in caller order.
- Skill registry lookup is `Map`-backed, and selection is linear in requested skills plus active tools. Strict duplicate mode adds one O(1) `Map.has()` check during registration only.
- Progressive catalog render is O(active skills) with byte/count caps; `load_skill` lookup is O(1). Budget eviction over context/skills is O(n log n) worst case.
- `load_skill` cannot grant tools; loaded instructions are untrusted text bounded by hard caps. `toolResultFold` summarizer output is untrusted and capped; failures keep raw tool results.
- Loaded-skill names are session-scoped. Since 0.1.3 (plan 015 Task 4) a durable run may opt in to persistence with `runState.persistSessionState: true` (and the same flag on resume options): the name catalog rides the run-state checkpoint (≤64 names, ≤256 chars each, charged against `maxStateBytes`) and is restored into the session `LoadedSkillSet` on resume, so progressive disclosure survives restart. **Bodies are never persisted** — they re-resolve from the live skill registry the next time the model loads the skill. Default off: checkpoint shape is identical to 0.1.2.
- These helpers perform no provider calls, tool execution, resource loading, package discovery, filesystem/network access, retries, timers, or watchers by themselves.
- Context and skill output is host/extension data. Do not include secrets unless the host explicitly accepts that prompt exposure.
- Active tools remain host-supplied; skills and middleware do not activate tools or grant permissions. Use `duplicate: "error"` when loading third-party skills to prevent silent name shadowing.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): consumes host-selected context providers and skills from explicit agent config.
- [Input and prompt assembly](input-and-prompt-assembly.md): default prompt builder and provider-input assembly helper.
- [Instruction injection](instruction-injection.md): package injectors contribute `contextBlocks` that merge after host+skill provider blocks.
- [Retrieval-augmented generation](rag.md): optional retrieved citations contribute through the same explicit inert context seam.
- [Public contracts](public-contracts.md): `ContextProvider`, `ContextResolutionContext`, `ContextBlock`, `Skill`, `SkillRegistry`, `PromptBuilder`, and `PromptBuildRequest`.
- [Middleware hooks](middleware-hooks.md): `context` and `prompt_build` hooks.
- [Contribution registries](contribution-registries.md): inert context provider and skill contributions.
- [Contribution discovery (workspace)](contribution-discovery.md): opt-in filesystem scanner that turns `SKILL.md`/`manifest.json` into registered skills and descriptor stubs. (Per-agent `AGENT.md` bundles live under an app-controlled `configRoot`; see [Agent definitions](agent-definitions.md).)
- [Tools](tools.md): host-owned active tools and permissions.
