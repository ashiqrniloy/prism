# Host security guide

## What it does

This guide is a fail-closed checklist for apps embedding Prism. It maps host security responsibilities to existing Prism APIs for credentials, settings, redaction, trust roots, permission policies, session and ledger persistence, extension loading, and tool validation.

Prism supplies seams and checks. The host owns policy decisions, secret sources, durable storage, approval UI, sandboxing, and which contributed capabilities become active.

## When to use it

Use this guide before exposing an agent to users, third-party extensions, durable storage, or real provider credentials.

Do not use it as a replacement for product threat modeling, process/container sandboxing, secret management, database access control, or provider-side policy. Prism does not sandbox tools/extensions and does not detect arbitrary secrets.

## Inputs / request

Start from explicit host inputs. Do not let runtime code discover security state implicitly.

| Security input | Host-owned source | Prism API / page |
| --- | --- | --- |
| Settings | app config object or caller-named files | `createStaticSettingsProvider`, `loadSettingsFiles()` |
| Credentials | runtime override, memory store, vault/env object | `createExplicitCredentialResolver`, `createEnvCredentialResolver`, `resolveCredentialValue()` |
| Redaction values | exact known credential strings | `createSecretRedactor`, `redactSecrets()` |
| Trust roots | app-selected directories/resources | `createPathTrustPolicy`, `assertTrusted()` |
| Permission decisions | allow/deny rules or approval UI result | `createStaticPermissionPolicy`, `assertPermission()` |
| Tool allow-list | active tools for this agent/session/run | `createToolRegistry`, `filterTools()`, `dispatchToolCall()` |
| Tool argument rules | host validator | `AgentConfig.validator`, `RunOptions.validate`, `ToolValidator` |
| Coding execution policy | path/command approval adapter | `ExecutionPolicy`, `@arnilo/prism-coding-security` |
| Durable history | host database adapter | `SessionStore`, `assertSessionStoreConforms()` |
| Durable audit | host ledger adapter | `RunLedger`, `redactRunLedgerRecord()` |
| Extensions | explicit package imports only | `createExtensionKernel`, `ExtensionAPI` |

## Outputs / response / events

Security controls fail closed before side effects when wired at the guarded edge:

- trust denial blocks resource/extension reads before load/use
- permission denial blocks extension setup, resource loading, and tool execution
- unknown or denied tools emit `tool_execution_blocked`
- validator failures emit `tool_execution_blocked` with `validation_failed`
- configured redactors scrub provider requests, agent events, session entries, ledger records, tool errors, extension errors, and injector context

These checks are explicit function calls during load, assembly, dispatch, append, or run handling. Prism adds no background watchers, filesystem scanners, network probes, credential polling, or automatic extension discovery.

## Request/response example

```json
{
  "credentialSource": "caller-owned env object",
  "trustedRoots": ["/workspace/app"],
  "allowedActions": ["tool:notes/read:execute", "extension:acme:setup"],
  "activeTools": ["notes/read"],
  "toolValidation": "host ToolValidator",
  "persistence": "redacted SessionStore + RunLedger"
}
```

The JSON above is an app security plan, not a Prism config format. Hosts translate each field into the explicit APIs listed in this guide.

## Implementation example

```ts
import {
  createEnvCredentialResolver,
  createSecretRedactor,
  createStaticPermissionPolicy,
  createToolRegistry,
  filterTools,
  resolveCredentialValue,
  type ToolDefinition,
  type ToolValidator,
} from "@arnilo/prism";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

const workspaceRoot = "/workspace/app";
const env = { DEMO_API_KEY: "fake-demo-key" }; // docs-only placeholder
const credentials = createEnvCredentialResolver(env, { demo: "DEMO_API_KEY" });
const apiKey = await resolveCredentialValue(credentials, { provider: "demo", name: "apiKey" });

const redactor = createSecretRedactor([apiKey]);
const permission = createStaticPermissionPolicy({
  allow: ["tool:notes/read:execute", "extension:acme:setup"],
});
const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });

const readNotes: ToolDefinition = {
  name: "notes/read",
  parameters: { type: "object", properties: { id: { type: "string" } } },
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "notes/read", value: { id: args.id } };
  },
};

const validate: ToolValidator = (_tool, args) =>
  typeof args.id === "string" && args.id.length <= 100
    ? undefined
    : "id must be a short string";

const tools = createToolRegistry(filterTools([readNotes], { allow: ["notes/read"] }), { duplicate: "error" });

void { apiKey, redactor, permission, trust, tools, validate };
```

Wire those values where they matter: provider adapters receive the resolved credential, agents/runs receive `redactor`, tool dispatch receives `permission` and `validate`, resource/extension loaders receive `trust` and `permission`, and durable adapters receive already-redacted entries/records.

## Extension and configuration notes

- Keep security state explicit. `AgentConfig.settings` and `AgentConfig.credentials` are host-owned metadata; `createAgent()` and `session.run()` do not automatically call `settings.get()` or `credentials.resolve()`.
- Resolve credentials at the provider/request edge, as late as possible. Do not put resolved credentials in configs, manifests, registries, prompts, messages, events, session entries, run ledgers, idempotency keys, cache keys, or logs.
- Use `createExplicitCredentialResolver()` to document source order such as runtime override → stored credential → caller-supplied env object → fallback.
- Use `createEnvCredentialResolver()` only with an object the host passes in. Prism does not read `process.env` for credentials.
- Use `createPathTrustPolicy()` for workspace/resource roots and fail closed on symlink escapes.
- Use `createContributionRegistries({ duplicate: "error" })` and prefixed names for third-party packages to prevent silent shadowing.
- Extension contributions are inert until selected. Loading an extension package runs its `setup(api)` code, so hosts should load only trusted packages or isolate untrusted code outside Prism.
- Skills and instruction injectors grant no tools, permissions, validators, or resource access. Host-active tools and permission policies still decide execution.
- For production persistence, implement a database-backed `SessionStore`/`RunLedger`, run `assertSessionStoreConforms()` against the store, and follow the database schema guidance. Do not ship provider instances, credential resolvers, or secrets into durable rows.

## Security and performance notes

- Fail closed: unknown providers, unknown tools, denied tools, invalid tool arguments, missing skill tool dependencies, trust failures, permission failures, append conflicts, and validator failures should stop the unsafe action.
- Prism does not sandbox host tools, extensions, provider adapters, credential resolvers, or custom middleware. Use OS/container/process isolation when code is untrusted.
- Redaction is exact known-secret replacement only. It is not arbitrary secret detection, entropy scanning, or DLP.
- Known secrets must be passed into redactors before data is emitted or persisted. Redact again in host adapters if they transform records after Prism redaction.
- Tool `parameters` metadata is not validated by default. Add a `ToolValidator`, use `createToolParameterValidator()` with a schema adapter, or install `@arnilo/prism-tool-validator-json-schema` before side effects.
- MCP tools from `@arnilo/prism-mcp` are untrusted remote servers. Configure stdio commands and HTTP URLs explicitly; bound output with `maxResultBytes`; register prefixed tools only after trust review. See [MCP client bridge](mcp-tools.md).
- Coding tools from `@arnilo/prism-coding-agent` accept an optional `ExecutionPolicy` checked inside each tool before side effects. Use `@arnilo/prism-coding-security` for path roots, command rules, and approval caching. Prism does not provide OS sandboxing unless the host supplies a sandbox adapter.
- Permission checks happen before tool validation and before `tool.execute()`. Middleware cannot grant permission by renaming a tool.
- Session stores and ledgers receive redacted values when a redactor is active, but durable storage remains host-owned. Enforce tenant/account/user ownership and retention in the database layer.
- Provider-owned auth/content/session/cache/security headers win over caller headers in adapters that merge headers.
- Security checks are bounded explicit calls on the active path. Prism adds no hidden global middleware, background workers, watchers, network calls, or filesystem scans.

### 0.0.4 release security audit (2026-07-14)

- `npm audit --audit-level=high`: 0 vulnerabilities at every severity.
- Lockfile: 162 registry dependency records, all with `resolved` provenance URL and integrity hash; `npm ls --all` reports a clean graph.
- License inventory: 160 locked third-party packages; all declare permissive MIT, ISC, BSD, Apache-2.0, or compatible dual licenses. No GPL, AGPL, SSPL, or missing lockfile license metadata.
- Install scripts: only `better-sqlite3@12.11.1` runs an install script (`prebuild-install || node-gyp rebuild --release`), required by the explicitly installed SQLite adapter. Core and other optional packages add no install hook.
- Secret scan: source, tests, docs, workflow files, package metadata, built tests, packed-install canary, and tarball deny-list checks found no private-key block or common live-token prefix. Runtime redaction fixtures cover requests, events, ledgers, stores, checkpoints, provider/OAuth errors, and credential ciphertext.
- Threat suites pass for parameterized SQL/tenant isolation, HTTP URL/SSRF rejection, realpath/symlink containment, shell-metacharacter approval, schema prototype-pollution/remote-reference bounds, OAuth polling/abort/redaction, credential tamper/wrong-key/KDF floors, MCP result bounds/timeouts, and coding approval/path policy.

PostgreSQL TLS/network policy, MCP endpoint allow-listing, provider base URLs, OS keychain availability, process sandboxing, workflow tenant identity, and ANSI/control-sequence sanitization in any host terminal renderer remain host boundaries. Prism 0.0.4 ships JSON-line RPC, not an interactive TUI; hosts must render untrusted model/tool text safely. Credential-gated PostgreSQL/provider/keychain tests are separate operator/CI gates, not silently replaced by mocks.

## Related APIs

- [Settings, auth, trust, and security controls](settings-auth-trust-security.md): low-level helpers and boundary hardening table.
- [Credentials and redaction](credentials-and-redaction.md): credential resolver order, caller-supplied env objects, OAuth refresh, exact redaction, and no persistent secret store.
- [Tools](tools.md): active tool registry, allow/deny filters, permission order, validator order, blocked events, and no sandbox.
- [Extension authoring guide](extension-authoring.md): inert contribution package boundary and extension loading security notes.
- [Extension kernel and event bus](extensions.md): `createExtensionKernel`, setup error redaction/rethrow, and permission-gated extension setup.
- [Contribution discovery](contribution-discovery.md): opt-in realpath-contained scanner that imports nothing and activates nothing.
- [Instruction injection](instruction-injection.md): redacted injector context and no capability grants.
- [Session stores](session-stores.md): durable session store contract and secret/persistence boundaries.
- [Runs and usage ledger](runs-and-usage.md): redacted run/event/tool/usage ledger records.
- [Database persistence](database-persistence.md): production schema, ownership, indexes, retention, and adapter readiness checklist.
- [Provider caching](provider-caching.md): cache keys and provider-owned header safety rules.
