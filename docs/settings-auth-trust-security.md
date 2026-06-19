# Settings, auth, trust, and security controls

## What it does
Prism exposes small host-owned helpers for settings, in-memory credentials, trust checks, permission checks, and exact known-secret redaction. It adds no hidden settings discovery, no hidden credential loading, no persistent secret store, does not auto-load project-local code, and no sandbox.

## When to use it
Use these APIs when a host wants one explicit place to compose settings, resolve caller-supplied credentials, deny untrusted resources/extensions/tools, or redact known secret strings before runtime serialization.

## Inputs / request
- `createStaticSettingsProvider(settings)` reads dotted keys from an in-memory JSON object.
- `createChainedSettingsProvider(providers)` returns the first defined setting.
- `createMemoryCredentialStore(initial?)` stores explicit credentials in memory only.
- `createChainedCredentialResolver(resolvers)` returns the first credential found.
- `createExplicitCredentialResolver(sources)` documents and applies named source order such as runtime override → stored → host env object → fallback.
- `createEnvCredentialResolver(env, map)` reads only the caller-supplied object; it does not read `process.env`.
- `assertTrusted(policy, request)` and `assertPermission(policy, request)` fail closed on denial.
- `createSecretRedactor(secrets)` redacts exact known strings.
- Node-only subpaths: `prism/node/settings` for caller-named JSON settings files and `prism/node/trust` for explicit trusted path roots.

## Outputs / response / events
Settings and credential helpers return existing `SettingsProvider` and `CredentialResolver` contracts. Permission denial blocks tool execution, extension setup, and resource loader calls before side effects. A configured `AgentConfig.redactor` or `RunOptions.redactor` redacts provider requests, emitted `AgentEvent` payloads, and stored `SessionEntry` values.

## Request/response example
```ts
import { createSecretRedactor, createStaticPermissionPolicy, createStaticSettingsProvider } from "prism";

const settings = createStaticSettingsProvider({ demo: { enabled: true } });
const permission = createStaticPermissionPolicy({ allow: ["tool:echo:execute"] });
const redactor = createSecretRedactor(["token-value"]);

console.log(await settings.get("demo.enabled"));
```

## Implementation example
```ts
import { createAgent, createMemoryCredentialStore, createSecretRedactor, resolveCredentialValue } from "prism";
import { loadSettingsFiles, defaultUserSettingsPath } from "prism/node/settings";
import { createPathTrustPolicy } from "prism/node/trust";

const settings = await loadSettingsFiles([
  { name: "user", path: defaultUserSettingsPath(), optional: true },
]);
const credentials = createMemoryCredentialStore();
credentials.set({ name: "api", provider: "demo", credential: { type: "api_key", value: "token-value" } });
const trust = createPathTrustPolicy({ trustedRoots: [process.cwd()] });
const apiKey = await resolveCredentialValue(credentials, { name: "api", provider: "demo" });

const agent = createAgent({
  model: { provider: "demo", model: "model" },
  settings,
  credentials,
  redactor: apiKey ? createSecretRedactor([apiKey]) : undefined,
});
void trust;
void agent;
```

## Extension and configuration notes
Root imports stay filesystem-free. Node settings files are caller-named and read once; optional missing files are skipped. Trust storage, prompts, approval UI, OAuth token storage, environment-variable selection, and persistent credentials belong in the host or an extension package.

## Security and performance notes
Prism does not sandbox host tools or extensions. Prism does not read environment variables, keychains, user config files, package manifests, resources, or project-local extensions unless the host explicitly wires those operations. Redaction is exact known-secret replacement only; it is not secret detection. Permission and trust checks are one operation per guarded call and add no workers, watchers, retries, network, or filesystem scans.

## Related APIs
- `createStaticSettingsProvider`, `createChainedSettingsProvider`
- `createMemoryCredentialStore`, `createChainedCredentialResolver`, `createExplicitCredentialResolver`, `createEnvCredentialResolver`, `refreshOAuthCredential`, `resolveCredentialValue`
- `createStaticTrustPolicy`, `assertTrusted`, `isTrusted`, `TrustDeniedError`
- `createStaticPermissionPolicy`, `assertPermission`, `checkPermission`, `PermissionDeniedError`
- `createSecretRedactor`, `redactMessage`, `redactAgentEvent`, `redactSessionEntry`, `redactProviderRequest`
- `prism/node/settings`: `defaultUserSettingsPath`, `readSettingsFile`, `loadSettingsFiles`
- `prism/node/trust`: `createPathTrustPolicy`, `isPathInside`
