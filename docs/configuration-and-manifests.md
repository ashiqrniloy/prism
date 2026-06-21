# Configuration and manifests

## What it does

Configuration helpers merge host-provided JSON config layers in a deterministic order. Manifest helpers validate data-only package manifests that describe contribution/resource declarations and config defaults without importing or executing package code.

APIs:

- `mergeConfigLayers()` / `ConfigLayer`
- `loadConfigLayers()` / `ConfigProvider`
- `isJsonObject()` / `assertJsonObject()`
- `definePrismManifest()` / `parsePrismManifest()`
- `PrismManifest`, `ManifestContributionDeclaration`, `ManifestResourceDeclaration`

## When to use it

Use these APIs when a host or package needs an in-memory config merge or wants to publish a data-only Prism manifest.

Do not use them for package discovery, dynamic imports, executable plugin loading, credential storage, filesystem config loading, resource fetching, or agent/session runtime startup. Those are explicit host or later-phase choices.

## Inputs / request

```ts
mergeConfigLayers(layers: readonly ConfigLayer[]): JsonObject
loadConfigLayers(providers: readonly ConfigProvider[], context?: ConfigLoadContext): Promise<ConfigLayer[]>
definePrismManifest(manifest: PrismManifest): PrismManifest
parsePrismManifest(value: unknown): PrismManifest
```

`ConfigLayer`:

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | `string` | Layer name used for diagnostics. |
| `config` | `JsonObject` | JSON config values for that layer. |

`PrismManifest`:

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | `string` | Package/manifest name. |
| `version` | `string` | Optional package/manifest version. |
| `description` | `string` | Optional description. |
| `configDefaults` | `JsonObject` | Optional JSON defaults contributed by the manifest. |
| `contributions` | `ManifestContributionDeclaration[]` | Optional data-only contribution declarations. |
| `resources` | `ManifestResourceDeclaration[]` | Optional prompt/skill/package resource declarations by URI. |
| `metadata` | `JsonObject` | Optional JSON metadata. |

`ManifestContributionKind` values match `createContributionRegistries()` categories:

| Kind | Registry | Notes |
| --- | --- | --- |
| `provider` | `providers` | Provider adapter declaration. |
| `model` | `models` | Model metadata declaration. |
| `tool` | `tools` | Tool definition declaration. |
| `contextProvider` | `contextProviders` | Context provider declaration. |
| `skill` | `skills` | Skill declaration. |
| `command` | `commands` | RPC command declaration. |
| `agent` | `agents` | Agent definition declaration. |
| `inputBuilder` | `inputBuilders` | Input builder declaration. |
| `promptBuilder` | `promptBuilders` | Prompt builder declaration. |
| `compactionStrategy` | `compactionStrategies` | Compaction strategy declaration. |
| `retryPolicy` | `retryPolicies` | Retry policy declaration. |
| `storeFactory` | `storeFactories` | Session store factory declaration. |
| `resourceLoader` | `resourceLoaders` | Resource loader declaration. |
| `settingsProvider` | `settingsProviders` | Settings provider declaration. |
| `credentialResolver` | `credentialResolvers` | Credential resolver declaration. |
| `providerPackage` | `providerPackages` | Provider package declaration. |
| `authMethod` | `authMethods` | Auth method descriptor; uses `credentialName`, never a resolved credential value. |
| `providerRequestPolicy` | `providerRequestPolicies` | Provider request policy declaration. |
| `systemPromptContribution` | `systemPromptContributions` | System prompt contribution declaration. |

## Outputs / response / events

- `mergeConfigLayers()` returns a new JSON object and does not mutate inputs.
- Later config layers override earlier layers.
- Nested plain objects merge recursively.
- Arrays and primitives replace previous values.
- `parsePrismManifest()` returns a validated manifest or throws a field-specific validation error.
- No events are emitted and no registries are modified by these helpers.

## Request/response example

```json
{
  "layers": ["built-in", "manifest", "host", "user", "runtime"],
  "manifest": {
    "name": "demo-package",
    "configDefaults": { "demo": { "enabled": true } }
  }
}
```

## Implementation example

```ts
import { definePrismManifest, mergeConfigLayers } from "prism";

const manifest = definePrismManifest({
  name: "demo-package",
  configDefaults: { demo: { enabled: true, tools: ["echo"] } },
  contributions: [
    { kind: "tool", name: "demo.echo", module: "./tool.js", exportName: "tool" },
    { kind: "retryPolicy", name: "demo.retry", module: "./retry.js", exportName: "retry" },
    { kind: "providerPackage", name: "demo-provider" },
    { kind: "authMethod", name: "demo.api-key", metadata: { credentialName: "apiKey" } },
    { kind: "providerRequestPolicy", name: "demo.cache" },
    { kind: "systemPromptContribution", name: "demo.prompt" },
  ],
  resources: [{ uri: "package://demo/prompt.md", purpose: "prompt" }],
});

const config = mergeConfigLayers([
  { name: "built-in", config: {} },
  { name: "manifest", config: manifest.configDefaults ?? {} },
  { name: "runtime", config: { demo: { enabled: false } } },
]);

console.log(config.demo);
```

## Extension and configuration notes

- Hosts choose the layer order. Prism documents `built-in -> manifest defaults -> host app -> optional user/global -> runtime overrides` but does not load those layers automatically.
- Manifest contribution declarations are data. Hosts may later choose to import the declared module/export and register it, but parsing the manifest never does that.
- Contribution `kind` values match `createContributionRegistries()` categories, including the Phase 14 provider primitives `providerPackage`, `authMethod`, `providerRequestPolicy`, and `systemPromptContribution`.
- Filesystem config loading is intentionally outside the root API and belongs to the optional [`prism/node/config`](node-filesystem-config.md) subpath.
- Manifest `resources` entries are URI declarations; use [resource loading](resource-loading.md) helpers with a host-provided loader to fetch them.

## Security and performance notes

- Config and manifest values must be JSON-compatible data.
- Do not put resolved credential values, tokens, headers, or executable code in config defaults, manifests, or metadata.
- Manifest parsing does not execute package code, dynamically import modules, resolve credentials, call providers/tools, or read resources.
- Config merging is dependency-free and proportional to the total number of JSON fields.

## Related APIs

- [Contribution registries](contribution-registries.md): manifest contribution `kind` values describe registry categories.
- [Extension kernel and event bus](extensions.md): hosts can load extensions after they decide to execute package code.
- [Resource loading](resource-loading.md): load manifest, prompt, skill, and package resources through host-provided loaders.
- [Credentials and redaction](credentials-and-redaction.md): credential values stay out of manifests and config layers.
