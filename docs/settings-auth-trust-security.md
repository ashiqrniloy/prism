# Settings, auth, trust, and security controls

## What it does
Prism exposes small host-owned helpers for settings, in-memory credentials, trust checks, permission checks, and exact known-secret redaction. It adds no hidden settings discovery, no hidden credential loading, no persistent secret store, does not auto-load project-local code, and no sandbox.

## When to use it
Use these APIs when a host wants one explicit place to compose settings, resolve caller-supplied credentials, deny untrusted resources/extensions/tools, or redact known secret strings before runtime serialization.

## Inputs / request
- `createStaticSettingsProvider(settings)` reads dotted keys from an in-memory JSON object.
- `createChainedSettingsProvider(providers)` returns the first defined setting.
- `AgentConfig.slots.credentials` (a `CredentialResolver`) resolves `env:`/`keyring:` refs; `createEnvRefCredentialResolver(env?)` is the kernel default for `env:` refs.
- `SecretSource` / `refSource()` / `optionalRefSource()` (`@arnilo/prism/provider-kit`) hand a ref-resolved credential to a low-level provider factory; a literal string does not type-check.
- `assertTrusted(policy, request)` and `assertPermission(policy, request)` fail closed on denial.
- `createSecretRedactor(secrets)` redacts exact known strings.
- Node-only subpaths: `@arnilo/prism/node/settings` for caller-named JSON settings files and `@arnilo/prism/node/trust` for explicit trusted path roots with symlink-aware realpath checks.

## Outputs / response / events
Settings and credential helpers return existing `SettingsProvider` and `CredentialResolver` contracts. These seams are host-owned outside `AgentConfig`; `createAgent()` / `session.run()` do not call `settings.get()` or `credentials.resolve()`. Permission denial blocks tool execution, extension setup, and resource loader calls before side effects. A configured `AgentConfig.redactor` or `RunOptions.redactor` redacts provider requests, emitted `AgentEvent` payloads, stored `SessionEntry` values, and runtime `InstructionContext` input/history seen by instruction injectors.

## Request/response example
```ts
import { createSecretRedactor, createStaticPermissionPolicy, createStaticSettingsProvider } from "@arnilo/prism";

const settings = createStaticSettingsProvider({ demo: { enabled: true } });
const permission = createStaticPermissionPolicy({ allow: ["tool:echo:execute"] });
const redactor = createSecretRedactor(["token-value"]);

console.log(await settings.get("demo.enabled"));
```

## Implementation example
```ts
import { createAgent, createEnvRefCredentialResolver } from "@arnilo/prism";
import { loadSettingsFiles } from "@arnilo/prism/node/settings";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import { homedir } from "node:os";
import { join } from "node:path";

const settings = await loadSettingsFiles([
  { name: "user", path: join(homedir(), ".config", "prism", "settings.json"), optional: true },
]);
// The credentials slot resolves `env:`/`keyring:` refs; packages ask it per request, and every value it
// returns joins the agent's secret set for redaction.
const credentials = createEnvRefCredentialResolver({ DEMO_API_KEY: "token-value" });
const trust = createPathTrustPolicy({ trustedRoots: [process.cwd()] });

const agent = createAgent({
  model: { provider: "demo", model: "model" },
  slots: { credentials },
});
void settings;
void trust;
void agent;
```

## Extension and configuration notes
Root imports stay filesystem-free. Node settings files are caller-named and read once; optional missing files are skipped. Trust storage, prompts, approval UI, OAuth token storage, environment-variable selection, and persistent credentials belong in the host or an extension package. For Node.js hosts, [`@arnilo/prism-credentials-keyring`](../packages/credentials/keyring/README.md) provides encrypted-file and system-keychain backends. Pass concrete settings values or credential resolvers to the provider/request edge that needs them; do not place them on `AgentConfig`.

## Security and performance notes
Prism does not sandbox host tools or extensions. Prism does not read environment variables, keychains, user config files, package manifests, resources, settings providers, credential resolvers, or project-local extensions unless the host explicitly wires those operations. Redaction is exact known-secret replacement only; it is not secret detection. Permission and trust checks are one operation per guarded call and add no workers, watchers, retries, network, or filesystem scans.

Boundary hardening summary:

| Boundary | Fail-closed rule |
| --- | --- |
| Contribution files | `SKILL.md` and `manifest.json` are realpath-checked inside the contribution directory before read. |
| Instruction resources | Markdown resources are realpath-contained unless host passes explicit `resourceTrust`; `permission` still gates reads. |
| Injector context | `InstructionContext.input` and `history` are redacted before injector `apply`; injectors grant no tools, skills, permissions, or validators. |
| System prompt sources | Unknown custom sources rank below app/run layers, so caller `run` policy cannot be overridden by sorting after it. |
| Config/manifest JSON | `__proto__`, `prototype`, and `constructor` keys are rejected at every depth before merge/clone. |
| Provider headers | Adapters merge caller headers first, then provider-owned auth/content/session/cache/security/attribution headers last. |

`@arnilo/prism/node/trust` resolves symlinks on both the trusted root and the target path. A path that is lexically inside a trusted root but escapes it through a symlink is rejected, and realpath failures (missing root, permission error) fail closed. Contribution discovery and discovered instruction resources reuse this check before reading entry/resource files.

## Related APIs
- [Host security guide](host-security.md): fail-closed checklist for wiring credentials, redaction, trust, permissions, persistence, extension loading, and tool validation in an embedding app.
- `createStaticSettingsProvider`, `createChainedSettingsProvider`
- `AgentConfig.slots.credentials`, `createEnvRefCredentialResolver`, `SecretSource` / `refSource` / `optionalRefSource` from `@arnilo/prism/provider-kit` — see [Credentials and redaction](credentials-and-redaction.md)
- `createStaticTrustPolicy`, `assertTrusted`, `isTrusted`, `TrustDeniedError`
- `createStaticPermissionPolicy`, `assertPermission`, `checkPermission`, `PermissionDeniedError`
- `ExecutionPolicy`, `assertExecutionAllowed`, `checkExecution`, `ExecutionDeniedError` (core); `@arnilo/prism-tools-coding` for coding-tool approval adapters — see [Coding execution approval and sandboxing](coding-security.md)
- `createSecretRedactor`, `redactMessage`, `redactAgentEvent`, `redactSessionEntry`, `redactProviderRequest`
- `@arnilo/prism/node/settings`: `readSettingsFile`, `loadSettingsFiles` (`defaultUserSettingsPath` was removed in 0.5.0 — build the path with `node:os`/`node:path`)
- `@arnilo/prism/node/trust`: `createPathTrustPolicy`, `isPathInside`, `isPathInsideReal`
- [Contribution discovery (workspace)](manifest.md): `createPathTrustPolicy` + `isPathInsideReal` gate workspace contribution roots fail-closed.
