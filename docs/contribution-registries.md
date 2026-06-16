# Contribution registries

## What it does

Contribution registries are explicit, host-owned maps for extension/package contributions. They let hosts register and resolve providers, models, tools, context providers, skills, commands, agents, input builders, prompt builders, compaction strategies, store factories, resource loaders, settings providers, and credential resolvers without hidden globals.

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

`ContributionRegistries` includes existing `providers` and `models` registries plus generic registries for `tools`, `contextProviders`, `skills`, `commands`, `agents`, `inputBuilders`, `promptBuilders`, `compactionStrategies`, `storeFactories`, `resourceLoaders`, `settingsProviders`, and `credentialResolvers`.

## Outputs / response / events

Registry calls return plain contribution objects. Unknown `resolve()` calls throw before provider, model, tool, credential, resource, or session behavior can run.

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
import { createContributionRegistries, type ToolDefinition } from "prism";

const tool: ToolDefinition = {
  name: "echo",
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "echo", value: args };
  },
};

const registries = createContributionRegistries();
registries.tools.register(tool.name, tool);

const resolved = registries.tools.resolve("echo");
console.log(resolved.name); // contributed only, not active for dispatch yet
```

## Extension and configuration notes

- Hosts can use contribution registries directly and skip extension loading entirely.
- Extension packages should register contributions through the host-provided extension API once the extension kernel is in use.
- Registry keys are explicit strings. Prefer stable ids/names such as `provider.id`, `tool.name`, `skill.name`, or package-qualified names when collisions matter.
- Manifest and configuration loading are separate APIs; this page only covers in-memory registration.
- Tool contributions are inert. They are not executable until the host registers selected definitions in an active tool registry and passes that registry to `dispatchToolCall()`.
- Input builders, prompt builders, and context providers are inert until the host resolves them and calls or passes them to the Phase 5 assembly helpers.

## Security and performance notes

- Generic registries are `Map`-backed with O(1) lookup.
- Registries are explicit objects returned by factories. Prism does not create hidden global contribution registries.
- Registries must not store resolved credential values, tokens, headers, or secret-bearing settings.
- `credentialResolvers` may store resolver objects, but resolved credentials must stay at the edge that needs them.
- Registry operations do not perform network, filesystem, provider, credential, tool, or resource work.
- Resolving a tool contribution returns data/code supplied by the host or extension; it does not grant allow-list permission or execute the tool.

## Related APIs

- [Provider layer](provider-layer.md): existing provider/model registries reused by `ContributionRegistries`.
- [Input and prompt assembly](input-and-prompt-assembly.md): default builders and provider-input assembly for selected contributions.
- [Context and skills](context-and-skills.md): ordered resolution for selected context providers.
- [Tools](tools.md): active host tool registry, filtering, and dispatch for selected tool definitions.
- [Public contracts](public-contracts.md): contribution contract types stored in these registries.
- [Credentials and redaction](credentials-and-redaction.md): credential resolver and secret-redaction rules.
