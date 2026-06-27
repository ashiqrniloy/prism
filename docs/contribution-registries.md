# Contribution registries

## What it does

Contribution registries are explicit, host-owned maps for extension/package contributions. They let hosts register and resolve providers, models, provider packages, auth methods, provider request policies, system prompt contributions, tools, context providers, skills, commands, agents, input builders, prompt builders, compaction strategies, retry policies, store factories, resource loaders, settings providers, and credential resolvers without hidden globals.

APIs:

- `createContributionRegistry<T>()` / `ContributionRegistry<T>`: generic string-keyed registry.
- `createContributionRegistries()` / `ContributionRegistries`: typed bundle for Phase 2 contribution categories.

## When to use it

Use these registries when a host app or extension kernel needs direct registration and fail-closed lookup before runtime behavior executes.

Do not use them as a dependency injection container, manifest loader, settings loader, credential store, active tool registry, tool dispatcher, or agent/session runtime. For tools, copy selected `registries.tools` entries into `createToolRegistry()` before dispatch.

## Inputs / request

```ts
createContributionRegistry<T>(options?: { label?: string }): ContributionRegistry<T>
createContributionRegistries(): ContributionRegistries
```

`ContributionRegistry<T>` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(key, contribution)` | string key and contribution | Stores or replaces the contribution for that key. |
| `get(key)` | string key | Returns the contribution or `undefined`. |
| `resolve(key)` | string key | Returns the contribution or throws `Unknown <label>: <key>`. |
| `list()` | none | Returns contributions in insertion order. |

`ContributionRegistries` includes existing `providers` and `models` registries plus generic registries for `providerPackages`, `authMethods`, `providerRequestPolicies`, `systemPromptContributions`, `tools`, `contextProviders`, `skills`, `commands`, `agents`, `inputBuilders`, `promptBuilders`, `compactionStrategies`, `retryPolicies`, `storeFactories`, `resourceLoaders`, `settingsProviders`, and `credentialResolvers`.

## Outputs / response / events

Registry calls return plain contribution objects. Unknown `resolve()` calls throw before provider, model, tool, credential, prompt, resource, or session behavior can run. `systemPromptContributions` are inert until a host passes selected values to `AgentConfig.systemPrompt` or `RunOptions.systemPrompt`.

Registering the same key replaces the contribution deterministically. Registries do not emit events by themselves; the extension kernel may emit events when it uses them.

## Request/response example

```json
{
  "registered": "echo",
  "resolved": "echo"
}
```

## Implementation example

```ts
import { createAgent, createContributionRegistries, type ToolDefinition } from "@arnilo/prism";

const tool: ToolDefinition = {
  name: "echo",
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "echo", value: args };
  },
};

const registries = createContributionRegistries();
registries.tools.register(tool.name, tool);
registries.agents.register("demo", {
  name: "demo",
  create: () => createAgent({ model, provider, tools: [tool] }),
});

const resolved = registries.tools.resolve("echo");
console.log(resolved.name); // contributed only, not active for dispatch yet

const inputBuilder = registries.inputBuilders.get("custom-input");
const contextProviders = registries.contextProviders.get("project") ? [registries.contextProviders.resolve("project")] : [];
const promptBuilder = registries.promptBuilders.get("custom-prompt");
const skill = registries.skills.get("brief");
const agent = await registries.agents.resolve("demo").create();
void agent;
void inputBuilder;
void contextProviders;
void promptBuilder;
void skill;
```

## Extension and configuration notes

- Hosts can use contribution registries directly and skip extension loading entirely.
- Extension packages should register contributions through the host-provided extension API once the extension kernel is in use.
- Registry keys are explicit strings. Prefer stable ids/names such as `provider.id`, `tool.name`, `skill.name`, or package-qualified names when collisions matter.
- Manifest contribution `kind` values match these registry keys. For example, `authMethods` accepts `authMethod` manifest declarations, `providerPackages` accepts `providerPackage`, `providerRequestPolicies` accepts `providerRequestPolicy`, and `systemPromptContributions` accepts `systemPromptContribution`.
- Manifest and configuration loading are separate APIs; this page only covers in-memory registration.
- Tool contributions are inert. They are not executable until the host registers selected definitions in an active tool registry and passes that registry to `dispatchToolCall()`.
- Provider packages, auth methods, provider request policies, and system prompt contributions are inert until the host resolves them and explicitly calls setup or passes them to a runtime/helper that documents the call site.
- Input builders, prompt builders, context providers, skills, compaction strategies, and retry policies are inert until the host resolves them and calls, passes, registers, or selects them for runtime helpers.
- Agent definitions are inert until the host resolves one and calls `create()`. A definition may call `createAgent()` with explicit provider/tools/context/skills; registries are not hidden globals for the runtime.

## Security and performance notes

- Generic registries are `Map`-backed with O(1) lookup.
- Registries are explicit objects returned by factories. Prism does not create hidden global contribution registries.
- Registries must not store resolved credential values, tokens, headers, or secret-bearing settings.
- `credentialResolvers` may store resolver objects, but resolved credentials must stay at the edge that needs them.
- Registry operations do not perform network, filesystem, provider, credential, tool, or resource work.
- Resolving a tool contribution returns data/code supplied by the host or extension; it does not grant allow-list permission or execute the tool.
- Resolving Phase 5 builder/context/skill contributions only returns data/code. The host still chooses which builder, provider, or skill to pass into input/prompt assembly.

## Related APIs

- [Provider packages](provider-packages.md): provider package and model metadata contribution primitives.
- [Provider layer](provider-layer.md): existing provider/model registries reused by `ContributionRegistries`.
- [Agent/session runtime](agent-session-runtime.md): selected `AgentDefinition` values can create runtime agents with explicit config.
- [Input and prompt assembly](input-and-prompt-assembly.md): default builders and provider-input assembly for selected contributions.
- [System prompts](system-prompts.md): composing selected system prompt contributions.
- [Context and skills](context-and-skills.md): ordered resolution for selected context providers and progressive disclosure for selected skills.
- [Tools](tools.md): active host tool registry, filtering, and dispatch for selected tool definitions.
- [Compaction and retry policies](compaction-and-retry.md): selected compaction strategy and retry policy behavior.
- [Public contracts](public-contracts.md): contribution contract types stored in these registries.
- [Credentials and redaction](credentials-and-redaction.md): credential resolver and secret-redaction rules.
- [Contribution discovery (workspace & global)](contribution-discovery.md): opt-in directory scanner that fills these registries from `SKILL.md`/`AGENT.md`/`manifest.json`.
