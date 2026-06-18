# Phase 10 — Settings, Auth, Trust, and Security Controls

## Objectives
- Add small, explicit settings, credential, trust, permission, and redaction primitives for safe host embedding.
- Keep Prism fully usable in memory with no hidden filesystem, credential, extension, resource, provider, or tool globals.
- Make CLI/project resource loading fail closed unless a host has made an explicit trust decision.
- Document every public security/auth/trust surface under `/docs` as it lands.

## Expected Outcome
- Hosts can compose settings providers and optional caller-named Node settings files without automatic discovery.
- Hosts can use opt-in in-memory credential storage/resolver utilities without Prism adding a persistent secret store.
- Hosts can check project/resource trust and tool/extension/resource permissions through reusable policies.
- Known secrets can be redacted from provider input, events, compaction summaries, and session entries when a host supplies a redactor.
- `npm run build`, `npm run typecheck`, and `command npm test` pass with no network, no new dependency, and no built-in app tools.

## Tasks

- [x] Inventory existing primitives and lock the minimal security surface
  - Acceptance Criteria:
    - Functional: Existing settings, credential, redaction, config, resource, extension, tool, runtime, CLI/RPC, docs, and roadmap boundaries are inventoried; the task records the smallest generic additions needed for Phase 10.
    - Performance: Inventory adds no runtime path, dependency, filesystem scan, network call, provider call, watcher, worker, queue, or test slowdown.
    - Code Quality: Locked surface rejects service-locator globals, automatic project/package discovery, built-in app tools, a sandbox claim, a keychain clone, and one-off mode/package-specific logic.
    - Security: Design keeps hosts in control of all I/O, credentials, trust decisions, and permission prompts; persistent credential storage is deferred unless a host-owned package supplies real key management.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 10 and non-negotiable boundaries: host controlled, no built-in app tools, no hidden globals, secrets never enter history/events, docs ship with APIs.
      - `plans/012-cli-json-rpc.md` closeout: Phase 10 should add trust/auth controls before CLI imports project extensions, resources, tools, or config automatically.
      - `src/contracts.ts`: existing `SettingsProvider`, `CredentialResolver`, `ResourceLoader`, `AgentConfig.settings`, `AgentConfig.credentials`, `ToolExecutionContext`, `ExtensionAPI`, `RunOptions`, `SessionEntry`, and `AgentEvent` shapes.
      - `src/credentials.ts`, `src/redaction.ts`, `src/config.ts`, `src/resources.ts`, `src/tools.ts`, `src/extensions.ts`, `src/agents.ts`, `src/cli-runner.ts`, and `src/node/config.ts`.
      - `docs/credentials-and-redaction.md`, `docs/configuration-and-manifests.md`, `docs/node-filesystem-config.md`, `docs/resource-loading.md`, `docs/tools.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/agent-session-runtime.md`, `docs/cli-rpc.md`, and `docs/index.md`.
      - Node.js v22 API docs via Context7 `/websites/nodejs_latest-v22_x_api`: `node:fs/promises` `readFile()`/`mkdir()`, file open constants such as `O_EXCL`, `node:os` `homedir()`, `node:path` `resolve()`/`relative()`, and `node:crypto` `scrypt()`/`createCipheriv()` examples.
      - `package.json`: ESM exports, Node `>=20`, `@types/node` v22, `npm run build`, `npm run typecheck`, and `npm test` scripts.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Options Considered:
      - Add an OS keychain or encrypted credential database: rejected for core v1; Node crypto docs show low-level primitives, but secure cross-platform key management belongs in a host or extension package.
      - Auto-load project settings, extensions, resources, or tools from the CLI: rejected; trust prompts and host UX are outside the core adapter.
      - Add a sandbox abstraction for tools/extensions: rejected; roadmap says safe controls without pretending to sandbox host code.
      - Add one generic permission/trust policy surface: chosen over separate bespoke checks for tools, extensions, and resources.
    - Chosen Approach:
      - Reuse existing config/resource/tool/extension/runtime primitives where they already satisfy Phase 10.
      - Add only generic reusable primitives: static/chained settings providers, an in-memory credential store/resolver, trust and permission policies, Node path/settings helpers, and redaction helpers.
      - Wire permission/redaction at existing call sites instead of adding a new runtime framework.
      - Reject mode-specific or Rust-side logic; this repository is a TypeScript/Node package and Phase 10 must stay package-neutral.
    - API Notes and Examples:
      ```ts
      // Target shape after inventory, exact names may be adjusted during implementation.
      const settings = createStaticSettingsProvider({ demo: { enabled: true } });
      const credentials = createMemoryCredentialStore();
      const permissions = createPermissionPolicy({ allow: ["tool:echo"] });
      const redactor = createSecretRedactor(["token-value"]);
      ```
    - Files to Create/Edit:
      - `plans/013-settings-auth-trust-security.md`: record inventory and locked design before implementation.
      - Expected later files: `src/contracts.ts`, `src/settings.ts`, `src/credentials.ts`, `src/redaction.ts`, `src/trust.ts` or `src/security.ts`, `src/tools.ts`, `src/extensions.ts`, `src/resources.ts`, `src/agents.ts`, `src/cli-runner.ts` if trust flags/errors are needed, `src/index.ts`, `src/node/settings.ts`, `src/node/trust.ts`, `package.json`, `src/__tests__/settings.test.ts`, `src/__tests__/credentials-redaction.test.ts`, `src/__tests__/security.test.ts`, `src/__tests__/tools.test.ts`, `src/__tests__/extensions.test.ts`, `src/__tests__/resources.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/cli.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`, `docs/settings-auth-trust-security.md`, `docs/credentials-and-redaction.md`, `docs/tools.md`, `docs/extensions.md`, `docs/resource-loading.md`, `docs/agent-session-runtime.md`, `docs/cli-rpc.md`, `docs/public-contracts.md`, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 10 deliverables and acceptance.
      - `plans/012-cli-json-rpc.md` Further Actions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - None for this inventory-only plan edit; no source or docs API files change until later tasks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later implementation tasks must document any public settings/auth/trust/security behavior.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public behavior is implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add settings providers and optional Node settings loader
  - Acceptance Criteria:
    - Functional: Hosts can create a `SettingsProvider` from an in-memory JSON object, compose providers deterministically, and optionally load caller-named JSON settings files from a Node subpath.
    - Performance: Static lookup is proportional to key depth, chained lookup is proportional to provider count, and file loading reads each explicit file once with no watching, scanning, polling, or network.
    - Code Quality: Settings helpers reuse existing JSON object validation and config merge behavior where practical; root imports remain filesystem-free.
    - Security: Settings files are explicit, optional files can be skipped, invalid/non-object JSON fails closed, errors exclude file contents, and docs warn not to store resolved credential values in settings.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `SettingsProvider` and `AgentConfig.settings`.
      - `src/config.ts` `isJsonObject()`, `assertJsonObject()`, `mergeConfigLayers()`, and `loadConfigLayers()`.
      - `src/node/config.ts` explicit JSON file loader pattern.
      - `docs/node-filesystem-config.md`: caller-named files only; no discovery or automatic runtime behavior.
      - Node.js v22 API docs via Context7: `fs/promises.readFile()`, `fs/promises.mkdir()`, `os.homedir()`, and `path.join()`/`path.resolve()` patterns.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Make settings aliases over config layers only: rejected; `SettingsProvider.get()` already exists and needs concrete implementations.
      - Add schema validation: rejected; Prism config currently keeps JSON validation only and hosts own schemas.
      - Auto-read `~/.config/prism/settings.json`: rejected; expose `defaultUserSettingsPath()` and let hosts/CLI choose.
    - Chosen Approach:
      - Add `createStaticSettingsProvider(settings)` for dotted-key reads over a JSON object.
      - Add `createChainedSettingsProvider(providers)` where earlier providers win on first defined value.
      - Add `prism/node/settings` with `defaultUserSettingsPath()`, `readSettingsFile()`, and `loadSettingsFiles()` that returns a settings provider backed by merged explicit files.
      - Reuse `readConfigFile()`/`mergeConfigLayers()` internally if it keeps the implementation shorter and behavior aligned.
    - API Notes and Examples:
      ```ts
      import { createStaticSettingsProvider } from "prism";
      import { defaultUserSettingsPath, loadSettingsFiles } from "prism/node/settings";

      const memory = createStaticSettingsProvider({ demo: { enabled: true } });
      console.log(await memory.get<boolean>("demo.enabled"));

      const settings = await loadSettingsFiles([
        { name: "user", path: defaultUserSettingsPath(), optional: true },
      ]);
      ```
    - Files to Create/Edit:
      - `src/settings.ts`: static/chained settings provider helpers.
      - `src/node/settings.ts`: explicit Node settings file loader.
      - `src/index.ts`: export root settings helpers and types.
      - `package.json`: add `./node/settings` export.
      - `src/__tests__/settings.test.ts`: root settings helper tests.
      - `src/__tests__/node-settings.test.ts`: explicit file loader and package export tests.
      - `src/__tests__/public-contracts.test.ts`: compile/use new settings exports.
      - `docs/settings-auth-trust-security.md`: document root settings APIs and node subpath.
      - `docs/public-contracts.md`: list new settings helpers if exported.
      - `docs/index.md`: add Security/auth/trust link if not already present.
    - References:
      - `roadmap.md` Phase 10 deliverable: settings provider implementations and optional filesystem settings loader.
      - `docs/configuration-and-manifests.md` documented merge order.
      - `docs/node-filesystem-config.md` explicit loader non-goals.
  - Test Cases to Write:
    - `static_settings_provider_reads_nested_dotted_keys`: validates JSON-backed `SettingsProvider.get()`.
    - `chained_settings_provider_uses_first_defined_value`: validates deterministic provider precedence.
    - `node_settings_loader_reads_explicit_optional_files`: validates explicit file load and optional missing skip.
    - `node_settings_loader_rejects_invalid_or_non_object_json`: validates fail-closed parsing.
    - `node_settings_subpath_is_declared_in_package_exports`: validates package export.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds settings helper functions and a public `prism/node/settings` subpath.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: document settings provider helpers, Node settings loader, examples, non-goals, and security notes.
      - `docs/public-contracts.md`: update settings exports list and examples if root exports change.
    - `docs/index.md` update: Yes; replace Future API placeholder with `Security/auth/trust - Settings providers, credential helpers, trust/permission policies, and redaction controls` linking to `settings-auth-trust-security.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add opt-in credential/auth store and resolver utilities
  - Acceptance Criteria:
    - Functional: Hosts can store credentials in an explicit in-memory credential store, resolve by `{ name, provider? }`, delete entries, and chain credential resolvers without Prism reading env vars or files.
    - Performance: Credential lookup is O(1) for the memory store and O(n) over resolver chains; helpers add no timers, network, filesystem I/O, encryption work, or dependencies.
    - Code Quality: Existing `resolveCredentialValue()` remains compatible; new utilities are small, typed, and exported from the root only when intentionally public.
    - Security: Resolved credential values stay at the caller edge, are never registered globally, and are not written to settings/config/manifests/docs/session entries/events by these helpers.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `CredentialRequest`, `Credential`, `CredentialResolver`, and `AgentConfig.credentials`.
      - `src/credentials.ts` `resolveCredentialValue()`.
      - `src/redaction.ts` `redactSecrets()` and `errorToErrorInfo()`.
      - `docs/credentials-and-redaction.md`: current storage-free credential boundary.
      - `docs/contribution-registries.md` credential resolver contribution storage, with resolved values kept out of registries.
      - Node.js v22 crypto docs via Context7: `scrypt()`/`createCipheriv()` examples reviewed for the rejected persistent encrypted-store option.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add persistent JSON credential files: rejected; plaintext secrets on disk are unsafe as a default and OS-specific secure storage belongs outside core.
      - Add encrypted credential files with passphrases: rejected for v1 core; getting key management wrong is worse than not pretending.
      - Add env var scanning: rejected; hidden env discovery conflicts with host-controlled credentials.
      - Add an in-memory store plus resolver chaining: chosen; it satisfies opt-in auth storage/resolution without I/O.
    - Chosen Approach:
      - Extend `src/credentials.ts` with `createMemoryCredentialStore(initial?)` and `createChainedCredentialResolver(resolvers)`.
      - Define minimal helper types in `src/credentials.ts` if needed, for example `CredentialRecord` and `MemoryCredentialStore`.
      - Match records by exact `name` and optional exact `provider`; provider-specific credentials win when both provider-specific and provider-agnostic records exist.
      - Keep `resolveCredentialValue()` unchanged except for tests proving it works with the new store.
    - API Notes and Examples:
      ```ts
      import { createMemoryCredentialStore, resolveCredentialValue } from "prism";

      const store = createMemoryCredentialStore();
      store.set({
        name: "apiKey",
        provider: "demo",
        credential: { type: "api_key", value: "token-value" },
      });

      const apiKey = await resolveCredentialValue(store, { name: "apiKey", provider: "demo" });
      ```
    - Files to Create/Edit:
      - `src/credentials.ts`: memory credential store and resolver-chain helpers.
      - `src/index.ts`: export new auth helpers/types.
      - `src/__tests__/credentials-redaction.test.ts`: memory store, resolver chain, and no-global-env tests.
      - `src/__tests__/public-contracts.test.ts`: compile/use new credential helper types.
      - `docs/credentials-and-redaction.md`: update with opt-in in-memory store/resolver utilities and persistent-store non-goal.
      - `docs/settings-auth-trust-security.md`: summarize auth storage/resolution controls.
      - `docs/public-contracts.md`: update root export examples if needed.
      - `docs/index.md`: ensure Security/auth/trust entry links the docs.
    - References:
      - `roadmap.md` Phase 10 deliverable: auth storage/resolution utilities as opt-in modules.
      - `roadmap.md` boundary: secrets never enter history/events.
      - `docs/credentials-and-redaction.md` current helper contract.
  - Test Cases to Write:
    - `memory_credential_store_resolves_exact_provider_records`: validates exact `{ name, provider }` lookup.
    - `memory_credential_store_deletes_records`: validates delete stops resolution.
    - `chained_credential_resolver_uses_first_defined_credential`: validates deterministic resolver order.
    - `credential_helpers_do_not_read_environment_by_default`: preserves no hidden env lookup.
    - `credential_docs_do_not_show_real_looking_tokens`: extends docs secret-example guard if needed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public auth/credential helper APIs and changes credential docs from storage-free to opt-in in-memory storage.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: update API list, examples, non-goals, and security notes.
      - `docs/settings-auth-trust-security.md`: include concise auth utilities section.
      - `docs/public-contracts.md`: update credential helper inventory if root exports change.
    - `docs/index.md` update: Yes if not already done; ensure Security/auth/trust link replaces the future placeholder.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add trust policies and Node path trust helpers
  - Acceptance Criteria:
    - Functional: Hosts can ask a trust policy whether a project/resource/extension target is trusted, assert trust with a typed error, and use a Node path policy that allows only explicit trusted roots.
    - Performance: Trust checks are synchronous or promise-based O(n) over trusted roots, use path normalization only, and add no file scanning, stat walks, watchers, network, or package imports.
    - Code Quality: Trust primitives are generic and reusable; Node path helpers live under an explicit Node subpath and do not leak filesystem behavior into root imports.
    - Security: Default examples deny unknown local executable resources, path traversal is normalized before checks, and the CLI/core still does not auto-load project-local executable resources.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 10 project/resource trust acceptance.
      - `docs/cli-rpc.md`: CLI flags are recorded, not auto-loaded/imported.
      - `docs/resource-loading.md`: host-provided loader owns URI trust and permissions.
      - `docs/extensions.md`: extension loading is host-provided and explicit.
      - Node.js v22 API docs via Context7: `path.resolve()` and `path.relative()` behavior.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Persist a trust database under the user config dir: rejected; storage/UX should be host-owned and can be layered through settings later.
      - Automatically trust the current working directory: rejected; project-local code should not execute by accident.
      - Check trust by string prefix: rejected; use `path.resolve()`/`path.relative()` to avoid simple traversal mistakes.
    - Chosen Approach:
      - Add root `TrustPolicy`, `TrustRequest`, `TrustDecision`, and `assertTrusted()`/`isTrusted()` helpers.
      - Add `createStaticTrustPolicy(decision)` for tests and in-memory hosts.
      - Add `prism/node/trust` with `createPathTrustPolicy({ trustedRoots })` and `isPathInside(root, target)`.
      - Keep CLI behavior fail-closed by not loading local resources/extensions; optionally use trust helpers only if CLI later gets explicit loading hooks.
    - API Notes and Examples:
      ```ts
      import { assertTrusted } from "prism";
      import { createPathTrustPolicy } from "prism/node/trust";

      const trust = createPathTrustPolicy({ trustedRoots: [process.cwd()] });
      await assertTrusted(trust, { kind: "resource", target: "./prompt.md", capability: "read" });
      ```
    - Files to Create/Edit:
      - `src/trust.ts` or `src/security.ts`: root trust contracts/helpers.
      - `src/node/trust.ts`: Node path trust policy.
      - `src/index.ts`: export root trust helpers/types.
      - `package.json`: add `./node/trust` export.
      - `src/__tests__/security.test.ts`: generic trust helper tests.
      - `src/__tests__/node-trust.test.ts`: trusted-root/path traversal tests and package export check.
      - `src/__tests__/cli.test.ts`: assert CLI still records but does not load project-local extensions/resources without explicit host wiring.
      - `docs/settings-auth-trust-security.md`: document trust APIs and Node path helper.
      - `docs/cli-rpc.md`: mention trust requirement before any future project-local loading.
      - `docs/resource-loading.md` and `docs/extensions.md`: link trust policy guidance.
      - `docs/public-contracts.md` and `docs/index.md`: update public API inventory/navigation.
    - References:
      - `roadmap.md` Phase 10 deliverable: project/resource trust model for CLI filesystem loading.
      - `docs/resource-loading.md` current trust non-goal.
      - `plans/012-cli-json-rpc.md` Phase 10 follow-up.
  - Test Cases to Write:
    - `static_trust_policy_allows_or_denies_requests`: validates generic trust helper behavior.
    - `assert_trusted_throws_redactable_error_on_denial`: validates fail-closed denial shape.
    - `node_path_trust_policy_allows_paths_inside_trusted_roots`: validates positive root check.
    - `node_path_trust_policy_denies_sibling_and_traversal_paths`: validates normalized path safety.
    - `cli_does_not_load_project_resources_or_extensions_without_host_trust`: validates Phase 10 CLI acceptance at the current adapter boundary.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public trust contracts/helpers and a `prism/node/trust` subpath; clarifies CLI/resource/extension trust behavior.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: document trust APIs, Node path trust examples, non-goals, and security notes.
      - `docs/cli-rpc.md`: add trust note for project-local resources/extensions.
      - `docs/resource-loading.md`: replace trust-model future note with related API link.
      - `docs/extensions.md`: add related trust API link for extension loading.
      - `docs/public-contracts.md`: update trust type/helper inventory if root exports change.
    - `docs/index.md` update: Yes if not already done; ensure Security/auth/trust group links the trust docs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add permission hooks for tools, extensions, and resources
  - Acceptance Criteria:
    - Functional: Hosts can supply a permission policy for tool dispatch, extension loading, and resource helper calls; denied permissions fail closed before tool execution, extension setup, or resource loader invocation.
    - Performance: Permission checks run once per selected operation, add no queues/workers/retries, and do not affect paths where no policy is supplied beyond a small conditional.
    - Code Quality: Permission requests use one typed shape with explicit `kind`, `action`, and `target`; existing tool filters/validators remain intact and still run at the documented points.
    - Security: Denied tool/extension/resource requests do not execute or load; denial errors/events are redacted with existing helpers where secrets are known.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md`: active registry, exact allow/deny filters, validator, middleware order, fail-closed unknown/denied calls.
      - `src/tools.ts`: `DispatchToolCallOptions`, blocked event emission, and `secrets` redaction.
      - `docs/extensions.md` and `src/extensions.ts`: extension setup order and error isolation.
      - `docs/resource-loading.md` and `src/resources.ts`: resource helpers call host loader once and do not own trust decisions.
      - `docs/middleware-hooks.md`: middleware cannot bypass host tool permissions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Treat permissions as middleware only: rejected; middleware can transform payloads but should not be the only fail-closed guard.
      - Replace existing tool filters with permissions: rejected; exact allow/deny filters are already simple and useful.
      - Build a prompt/approval UI: rejected; hosts own UI, Prism only defines hooks.
    - Chosen Approach:
      - Add `PermissionPolicy`, `PermissionRequest`, `PermissionDecision`, `checkPermission()`, `assertPermission()`, and a tiny static allow/deny policy helper.
      - Add optional `permission` fields to `DispatchToolCallOptions`, `ExtensionKernelOptions`, and `ResourceLoadContext` or helper options with default allow only because the host already explicitly called the operation.
      - In `dispatchToolCall()`, check permission after registry/filter/object-argument checks and before validator/tool execution.
      - In `createExtensionKernel().load()`, check permission before each extension `setup()`.
      - In resource helpers, check permission before calling `loader.load()`.
    - API Notes and Examples:
      ```ts
      import { createStaticPermissionPolicy, dispatchToolCall } from "prism";

      const permission = createStaticPermissionPolicy({ allow: ["tool:echo:execute"] });
      await dispatchToolCall({ call, registry, context, permission });
      ```
    - Files to Create/Edit:
      - `src/trust.ts` or `src/security.ts`: permission contracts/helpers beside trust helpers.
      - `src/tools.ts`: optional permission check before tool execution.
      - `src/extensions.ts`: optional permission check before extension setup.
      - `src/resources.ts`: optional permission check before `loader.load()`.
      - `src/contracts.ts`: add optional permission field types where public contracts live.
      - `src/index.ts`: export permission helpers/types.
      - `src/__tests__/tools.test.ts`: denied tool permission emits blocked result and does not execute.
      - `src/__tests__/extensions.test.ts`: denied extension setup does not run.
      - `src/__tests__/resources.test.ts`: denied resource load does not call loader.
      - `src/__tests__/public-contracts.test.ts`: compile/use permission APIs.
      - `docs/settings-auth-trust-security.md`, `docs/tools.md`, `docs/extensions.md`, `docs/resource-loading.md`, `docs/middleware-hooks.md`, `docs/public-contracts.md`, and `docs/index.md`.
    - References:
      - `roadmap.md` Phase 10 deliverable: host permission hooks for tools/extensions/resources.
      - `docs/tools.md` permission boundary: Prism does not sandbox host tools.
      - `docs/resource-loading.md` current host-owned trust/permission note.
  - Test Cases to Write:
    - `tool_permission_denial_blocks_before_validator_and_execute`: validates fail-closed order.
    - `extension_permission_denial_skips_setup_and_emits_redacted_error`: validates extension hook behavior.
    - `resource_permission_denial_skips_loader_load`: validates no I/O after denial.
    - `permission_policy_defaults_preserve_explicit_existing_calls`: validates no policy keeps current behavior.
    - `middleware_cannot_bypass_denied_tool_permission`: validates permission remains a hard guard.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds permission policy APIs and changes tool/extension/resource helper behavior when a policy is supplied.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: document permission policy APIs and examples.
      - `docs/tools.md`: document `DispatchToolCallOptions.permission` order and blocked events.
      - `docs/extensions.md`: document extension load permission checks.
      - `docs/resource-loading.md`: document resource permission checks.
      - `docs/middleware-hooks.md`: update middleware cannot bypass permission guard.
      - `docs/public-contracts.md`: update permission type/helper inventory.
    - `docs/index.md` update: Yes if not already done; ensure Security/auth/trust group links permission docs.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Apply redaction controls to runtime serialization boundaries
  - Acceptance Criteria:
    - Functional: Hosts can create a redactor for known secrets and pass it to agent/session runs so known secret strings are redacted before provider prompts, emitted events, compaction summaries, tool results, and session entries are serialized.
    - Performance: Redaction only walks values at existing serialization boundaries, skips work when no redactor is supplied, and avoids extra provider/tool/store calls.
    - Code Quality: Redaction helpers are small wrappers around existing `redactSecrets()` semantics; runtime redaction is centralized to avoid scattered string replacement.
    - Security: Known secrets from opt-in auth utilities do not appear in provider requests, `AgentEvent` payloads, compaction entries, tool-result entries, or session stores when a host supplies the redactor.
  - Approach:
    - Documentation Reviewed:
      - `src/redaction.ts` exact known-secret redaction behavior.
      - `src/agents.ts` provider request assembly, `emit()`, `appendEntry()`, tool result appends, compaction summary appends, and retry error redaction.
      - `src/session-stores.ts` and `src/node/session-store-jsonl.ts`: stores persist caller/runtime session entries only.
      - `docs/credentials-and-redaction.md`: known-secret exact-value limitations.
      - `docs/agent-session-runtime.md`: store/event security notes.
      - `docs/compaction-and-retry.md`: compaction/retry secret options.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Automatically scan for secret-looking strings: rejected; false positives/negatives are security theater and can break prompts.
      - Store secret arrays directly on durable session/config data: rejected; use an in-memory redactor object or run option.
      - Redact only errors: rejected; Phase 10 acceptance includes events, prompts, compaction, and sessions.
    - Chosen Approach:
      - Add `SecretRedactor` or equivalent with `redact<T>(value)` plus `createSecretRedactor(secrets)` convenience helper.
      - Add `redactMessage()`, `redactAgentEvent()`, `redactSessionEntry()`, and possibly `redactProviderRequest()` helpers.
      - Add optional redactor fields to `AgentConfig` and `RunOptions`, preferring run-level redactor when supplied.
      - In runtime, redact input before provider assembly, redact emitted events in one `emit()` path, redact entries in one `appendEntry()` path, pass redaction to tool dispatch, and keep existing compaction/retry secret handling compatible.
    - API Notes and Examples:
      ```ts
      import { createAgent, createSecretRedactor } from "prism";

      const redactor = createSecretRedactor(["token-value"]);
      const agent = createAgent({ model, provider, redactor });
      await agent.createSession().run("token-value should not be serialized");
      ```
    - Files to Create/Edit:
      - `src/redaction.ts`: redactor interface/factory and message/event/session-entry helpers.
      - `src/contracts.ts`: optional redactor fields on `AgentConfig`/`RunOptions` if chosen.
      - `src/agents.ts`: apply redaction at provider input, event, store, tool, and compaction boundaries.
      - `src/tools.ts`: accept redactor or keep using `secrets` if runtime adapts to existing option.
      - `src/index.ts`: export redaction helpers/types.
      - `src/__tests__/credentials-redaction.test.ts`: redaction helper coverage.
      - `src/__tests__/agents.test.ts`: runtime event/store/provider-request redaction tests.
      - `src/__tests__/node-session-store-jsonl.test.ts`: ensure redacted entries persist if redactor is configured.
      - `src/__tests__/public-contracts.test.ts`: compile/use redactor public API.
      - `docs/credentials-and-redaction.md`, `docs/agent-session-runtime.md`, `docs/compaction-and-retry.md`, `docs/session-stores-and-branching.md`, `docs/settings-auth-trust-security.md`, and `docs/public-contracts.md`.
    - References:
      - `roadmap.md` Phase 10 acceptance: secrets are not serialized into events, prompts, compaction, or sessions.
      - `docs/credentials-and-redaction.md` known-secret helper limits.
      - `docs/agent-session-runtime.md` store/event boundaries.
  - Test Cases to Write:
    - `secret_redactor_redacts_messages_events_and_session_entries`: validates helper shapes.
    - `agent_redactor_removes_known_secret_from_provider_request_events_and_store`: validates runtime boundaries with a mock provider and memory store.
    - `tool_result_secret_is_redacted_before_event_and_session_entry`: validates tool loop boundary.
    - `compaction_summary_secret_is_redacted_before_event_and_entry`: validates compaction boundary.
    - `redaction_is_noop_when_no_redactor_is_configured`: validates existing behavior/performance path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public redactor helpers and optional runtime redaction behavior.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: document redactor factory/helpers, exact known-secret limit, and runtime usage.
      - `docs/agent-session-runtime.md`: document `AgentConfig`/`RunOptions` redaction behavior if added.
      - `docs/compaction-and-retry.md`: align with central redactor behavior.
      - `docs/session-stores-and-branching.md`: document redacted store-entry expectations.
      - `docs/settings-auth-trust-security.md`: include security controls overview.
      - `docs/public-contracts.md`: update redactor API inventory.
    - `docs/index.md` update: Yes if not already done; ensure Security/auth/trust link exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Write security/auth/trust docs and update documentation checks
  - Acceptance Criteria:
    - Functional: New and changed docs follow the Prism API page structure, docs index links all public Phase 10 surfaces, and docs tests assert critical security boundaries.
    - Performance: Documentation checks remain simple file-read assertions and keep the test suite under the project target.
    - Code Quality: Docs examples compile conceptually with actual exported names and do not document future behavior as implemented.
    - Security: Docs state no sandbox, no hidden credential loading, no auto project-local extension/resource execution, no persistent secret store in core, and exact known-secret redaction limits.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md` and `.agents/skills/create-plan/references/prism-wiki.md` API page requirements.
      - `docs/index.md` grouping style and Future API placeholder.
      - `src/__tests__/docs.test.ts` required headings, index-link checks, export/docs consistency checks, and secret-example guard.
      - All docs pages touched by Phase 10 implementation tasks.
    - Options Considered:
      - Split every small helper into its own docs page: rejected; one Security/auth/trust page plus targeted updates keeps navigation shorter.
      - Put docs only in README: rejected; roadmap requires `/docs` pages linked from `docs/index.md`.
      - Include realistic token formats in examples: rejected; docs tests should keep blocking real-looking secrets.
    - Chosen Approach:
      - Create `docs/settings-auth-trust-security.md` as the main API page for settings, credential helpers, trust policies, permission policies, Node subpaths, and redaction controls.
      - Update existing pages where behavior changes: credentials/redaction, tools, extensions, resource loading, agent runtime, compaction/session memory, CLI/RPC, public contracts.
      - Extend `docs.test.ts` with Phase 10 link/export/safety assertions and package subpath assertions for new Node subpaths.
    - API Notes and Examples:
      ```md
      ## Security and performance notes
      Prism does not sandbox host tools or auto-load project-local code. Hosts must pass trust and permission policies explicitly.
      ```
    - Files to Create/Edit:
      - `docs/settings-auth-trust-security.md`: new API page following required headings.
      - `docs/index.md`: Security/auth/trust navigation entry and removal of Future API placeholder.
      - `docs/credentials-and-redaction.md`, `docs/tools.md`, `docs/extensions.md`, `docs/resource-loading.md`, `docs/agent-session-runtime.md`, `docs/compaction-and-retry.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, and `docs/public-contracts.md`: targeted updates.
      - `src/__tests__/docs.test.ts`: docs structure, navigation, export, subpath, and security-boundary checks.
    - References:
      - `roadmap.md` boundary: docs ship with APIs.
      - `.agents/skills/create-plan/references/prism-wiki.md` required docs structure.
      - Existing docs pages listed above.
  - Test Cases to Write:
    - `docs_index_links_settings_auth_trust_security_page`: validates navigation.
    - `settings_auth_trust_docs_include_required_headings`: covered by API pages list.
    - `phase_10_docs_cover_security_boundaries`: asserts no sandbox/auto-load/persistent-store claims.
    - `phase_10_docs_reference_public_exports_and_node_subpaths`: validates docs match exports/package exports.
    - `docs_avoid_real_looking_secret_examples`: keep/extend existing guard.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; documentation task publishes the public Phase 10 API surface and security behavior.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: create main Phase 10 API page.
      - `docs/index.md`: add Security/auth/trust entry.
      - Existing API docs listed in Files to Create/Edit: update related API and behavior notes.
    - `docs/index.md` update: Yes; add `Security/auth/trust - Settings providers, credential helpers, trust/permission policies, and redaction controls`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Run final verification and close Phase 10 plan
  - Acceptance Criteria:
    - Functional: All Phase 10 roadmap acceptance criteria are met or explicitly recorded as compromises after implementation.
    - Performance: Full tests run with no network and no new dependency; any added checks remain below the roadmap target.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; public exports and package subpaths match docs.
    - Security: Verification confirms no built-in app tools, no hidden credential/settings/resource/extension globals, no automatic project-local code loading, and no known-secret serialization in configured redaction paths.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts and exports.
      - `roadmap.md` Phase 10 acceptance.
      - This plan's task acceptance criteria.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Run only targeted tests: rejected for closeout; Phase 10 touches contracts, docs, runtime, package exports, node subpaths, and security behavior.
      - Fill compromises before implementation: rejected; fill only actual deviations after checks pass.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test`.
      - Update task checkboxes only after implementation and checks pass.
      - Fill `Compromises Made` and `Further Actions` with actual results, deferred work, and priority.
    - API Notes and Examples:
      ```sh
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/013-settings-auth-trust-security.md`: mark completed tasks and fill closeout sections after verification.
    - References:
      - `roadmap.md` Phase 10 acceptance.
      - `package.json` scripts.
  - Test Cases to Write:
    - `npm run build`: validates emitted ESM/declarations/subpaths.
    - `npm run typecheck`: validates strict TypeScript.
    - `command npm test`: validates full suite including docs and security regression tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new behavior by verification alone; plan closeout records actual state.
    - Docs pages to create/edit:
      - `none`: unless verification finds docs drift that must be fixed before closeout.
    - `docs/index.md` update: No for verification alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Kept credential storage in memory only; persistent/encrypted stores remain host-owned as planned.
- Kept redaction exact-match only; no heuristic secret scanning or sandbox claims were added.
- Kept CLI/project loading fail-closed; no automatic project-local extensions, resources, config, tools, or trust prompts were added.

## Further Actions
- Medium: add host-owned persistent credential/trust packages later if a real keychain/approval UX exists.
- Low: add richer docs examples for app-specific permission prompts once a host integration needs them.
- Verification passed: `npm run build`, `npm run typecheck`, and `command npm test`.
