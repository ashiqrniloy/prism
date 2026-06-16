# Phase 3 — Configuration, Manifests, and Resource Loading

## Objectives
- Add data-only package manifests and configuration contracts so packages can describe contributions/config without Prism executing package code.
- Provide deterministic in-memory config layering and validation behavior with no hidden globals.
- Add an explicit optional Node filesystem config loader for CLI/hosts, not core auto-discovery.
- Integrate existing `ResourceLoader` contracts with manifests, prompts, skills, and package resources through small reusable helpers.
- Document every new public config, manifest, resource, package export, and loader surface under `/docs`.

## Expected Outcome
- Root exports include in-memory manifest/config types and helpers for data-only manifests, config providers, and ordered config merging.
- An optional `prism/node/config` subpath loads JSON config files and computes the default user config path such as `~/.config/prism/config.json` only when a host imports/calls it.
- Resource helpers can load text/JSON/manifest resources through a host-provided `ResourceLoader` without adding filesystem, network, or package discovery behavior to core.
- Core still runs fully in memory with no filesystem access, no dynamic imports, no package execution, no provider/tool execution, and no credential resolution during manifest/config parsing.
- `npm run build`, `npm run typecheck`, and `command npm test` pass without network or new dependencies.

## Tasks

- [x] Inventory existing primitives and lock the minimal Phase 3 public surface
  - Acceptance Criteria:
    - Functional: Existing contracts, registries, extension kernel, middleware, resource/settings/credential primitives, docs, tests, and roadmap Phase 3 deliverables are inventoried; the task records which primitives are reused and which generic additions are required.
    - Performance: Inventory adds no runtime code, dependency, network call, filesystem discovery, dynamic import, provider call, tool call, or test slowdown.
    - Code Quality: The chosen surface rejects a DI container, schema dependency, package activation graph, app-specific config model, and mode-specific resource loader; it plans only reusable data contracts/helpers.
    - Security: The design keeps filesystem loading explicit, manifests data-only, credentials unresolved, and resource loading host-controlled; validation rejects non-JSON config/default values at trust boundaries.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3, target architecture "Configuration and manifests", and non-negotiable host-controlled/secrets/docs boundaries.
      - `plans/005-extension-kernel-and-contribution-registries.md` closeout: explicit registries/kernel/middleware, no manifest parsing/package discovery/config loading yet.
      - `docs/index.md`, `docs/public-contracts.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/credentials-and-redaction.md`, and `docs/api-page-template.md`.
      - `src/contracts.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/middleware.ts`, `src/index.ts`, and existing `src/__tests__/*.test.ts` patterns.
      - `package.json` exports/scripts and `tsconfig.json` strict `NodeNext`/declaration settings.
      - Node.js docs via Context7 `/nodejs/node` on 2026-06-16: `node:fs/promises` ESM import, `fs.mkdir({ recursive })`, and `url.fileURLToPath()` context for optional Node loaders.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
    - Options Considered:
      - Full JSON Schema validator dependency and generated schemas: rejected; Phase 3 needs a small JSON/data validator and TypeScript contracts first.
      - Manifest loader that dynamically imports package modules: rejected; acceptance requires manifests describe contributions without executing code until the host chooses to load the package.
      - Global config discovery at import time: rejected; violates host-controlled filesystem loading.
      - Reuse `JsonObject`, `ResourceLoader`, `SettingsProvider`, `ContributionRegistries`, and `ExtensionAPI`: preferred; they already cover most primitives.
    - Chosen Approach:
      - Add small in-memory config helpers: `ConfigProvider`, `ConfigLayer`, `ConfigLoadContext`, `mergeConfigLayers()`, and JSON-object validation.
      - Add data-only manifest contracts and helpers: `PrismManifest`, contribution/resource declarations, `definePrismManifest()`, and `parsePrismManifest()`.
      - Add optional Node filesystem config only under a new explicit subpath, tentatively `prism/node/config`.
      - Add resource helper functions that operate on a caller-provided `ResourceLoader`; do not add filesystem/network loaders in core.
    - API Notes and Examples:
      ```ts
      import { mergeConfigLayers, parsePrismManifest } from "prism";

      const manifest = parsePrismManifest(rawJson);
      const config = mergeConfigLayers([
        { name: "built-in", config: {} },
        { name: "manifest", config: manifest.configDefaults ?? {} },
        { name: "host", config: { model: { provider: "mock" } } },
      ]);
      ```
    - Files to Create/Edit:
      - `plans/006-configuration-manifests-and-resource-loading.md`: record primitive inventory decisions during execution.
      - `src/config.ts`, `src/manifests.ts`, `src/resources.ts`, `src/node/config.ts`, `src/index.ts`, `package.json`, and docs/tests in later tasks after inventory confirms names.
    - References:
      - `roadmap.md` Phase 3 deliverables and acceptance.
      - `plans/005-extension-kernel-and-contribution-registries.md` further action for Phase 3.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run typecheck`: proves inventory-only edits did not break exported types if the task updates source/docs.
    - `command npm test`: only needed if the inventory task changes docs/source beyond this plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; yes if execution changes public surface, which later implementation tasks must document.
    - Docs pages to create/edit:
      - `none`: inventory notes live in this plan until public APIs are implemented.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Inventory: `src/contracts.ts` already provides `JsonObject`/`JsonValue`, `Resource`/`ResourceLoader`, `SettingsProvider`, `CredentialResolver`, extension contracts, and resource/session primitives. Reuse these instead of adding a parallel config/resource type system.
    - Inventory: `src/contributions.ts` already has explicit registries for providers, models, tools, context providers, skills, commands, agents, builders, compaction, stores, resource loaders, settings providers, and credential resolvers. Phase 3 manifests should describe these categories as data; they must not register or execute contributions by themselves.
    - Inventory: `src/extensions.ts` and `src/middleware.ts` are host-explicit and in-memory. Keep config/manifest loading separate from kernel construction; no auto extension discovery, activation graph, dynamic import, or hidden global config/kernel.
    - Decision: add `src/config.ts` for `ConfigProvider`, `ConfigLayer`, `ConfigLoadContext`, optional `loadConfigLayers()` only if implementation stays tiny, `mergeConfigLayers()`, and JSON object guard helpers. Merge order is caller-provided and documented as `built-in -> manifest defaults -> host app -> optional user/global -> runtime overrides`; later layers win, nested plain objects merge, arrays/primitives replace.
    - Decision: add `src/manifests.ts` for data-only `PrismManifest`, `ManifestContributionDeclaration`, `ManifestResourceDeclaration`, `definePrismManifest()`, and `parsePrismManifest()`. Manifest declarations are strings/JSON only, likely `kind`, `name`, optional `module`, `exportName`, `configKey`, `resource`, and `metadata`; they describe package contributions without importing modules or touching registries.
    - Decision: add optional Node filesystem loading only in `src/node/config.ts` and package subpath `./node/config`. It may compute `~/.config/prism/config.json` and read explicit JSON files with `node:fs/promises`, but must not scan directories, watch files, discover packages, or run at root import time.
    - Decision: add `src/resources.ts` with helper functions over a caller-provided `ResourceLoader`, such as text, JSON, and manifest loading. Core will not add built-in `file:`, `http:`, package, URI router, or trust policy loaders in Phase 3.
    - Security decision: config/defaults/manifests must be JSON-compatible data; validation errors name fields/paths but not file contents or credential values. Credentials remain resolver objects and are not resolved during config merge, manifest parse, or resource helper calls.
    - Rejected: JSON Schema dependency, generated schemas, DI container/service locator, package activation/dependency graph, dynamic import manifest loader, global config singleton, YAML/TOML/JSON5 support, built-in file/network resource loaders, URI scheme registry, and caching/scanning behavior.
    - Docs impact: no `/docs` changes in this inventory task. Tasks 2-5 remain responsible for documenting every public API, package subpath, config surface, manifest field, and resource helper before final verification.
    - Ran `npm run typecheck`; it passed. No source/docs changes were made, so `command npm test` was not needed for this task.

- [x] Add in-memory manifest/config contracts and deterministic merge helpers
  - Acceptance Criteria:
    - Functional: Public APIs define data-only manifests, manifest contribution/resource declarations, config providers/layers, and deterministic merge order; later config layers override earlier layers, nested plain objects merge, and arrays/primitives replace.
    - Performance: Merge/validation are synchronous, dependency-free, O(total JSON fields), and perform no filesystem, network, dynamic import, provider, tool, credential, or resource work.
    - Code Quality: Use existing `JsonObject`/`JsonValue` contracts; keep manifests generic and package-friendly; no package-specific contribution classes, no global config singleton, no schema dependency.
    - Security: Manifest/config parsing accepts JSON-compatible data only, rejects invalid manifest shapes with non-secret error messages, and never resolves credentials or executes package code.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3 deliverables: manifest schema/types, config defaults, deterministic merge order, and manifests describing contributions without execution.
      - `src/contracts.ts` `JsonObject`, `JsonValue`, `ResourceLoader`, `SettingsProvider`, `CredentialResolver`, and contribution contracts.
      - `src/contributions.ts` registry category names for manifest contribution declarations.
      - `docs/contribution-registries.md` registry keys and manifest/config later-phase notes.
      - `docs/credentials-and-redaction.md` rules for not storing/resolving secrets in config docs/tests.
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
    - Options Considered:
      - Strongly type every possible package contribution as separate manifest arrays: rejected; a generic declaration list is smaller and avoids rework as registries evolve.
      - Deep merge arrays element-by-element: rejected; array merge policy is surprising and slow to reason about.
      - Later-wins object merge with array/primitive replacement: chosen; deterministic and easy for hosts to explain.
    - Chosen Approach:
      - Create `src/config.ts` with `ConfigProvider`, `ConfigLayer`, `ConfigLoadContext`, `loadConfigLayers()` if useful, `mergeConfigLayers()`, and small JSON-object guard helpers.
      - Create `src/manifests.ts` with `PrismManifest`, `ManifestContributionDeclaration`, `ManifestResourceDeclaration`, `definePrismManifest()`, and `parsePrismManifest()`.
      - Root-export new APIs from `src/index.ts`; update public contract docs and docs checks in the same task or the docs task if the implementation is split.
      - Keep config merge helper caller-driven: hosts pass layers in the documented order `built-in -> manifest defaults -> host app -> optional user/global -> runtime overrides`.
    - API Notes and Examples:
      ```ts
      import { definePrismManifest, mergeConfigLayers } from "prism";

      const manifest = definePrismManifest({
        name: "demo-package",
        configDefaults: { demo: { enabled: true } },
        contributions: [{ kind: "tool", name: "demo.echo", module: "./tool.js", exportName: "tool" }],
      });

      const config = mergeConfigLayers([
        { name: "manifest", config: manifest.configDefaults ?? {} },
        { name: "runtime", config: { demo: { enabled: false } } },
      ]);
      ```
    - Files to Create/Edit:
      - `src/config.ts`: config provider/layer types, merge helper, JSON guard helpers.
      - `src/manifests.ts`: data-only manifest types and validation helpers.
      - `src/index.ts`: root exports for config/manifest APIs.
      - `src/__tests__/config-manifests.test.ts`: config merge and manifest validation tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for new public types.
      - `docs/configuration-and-manifests.md`: public docs for config/manifest APIs.
      - `docs/public-contracts.md`: add config/manifest contract inventory.
      - `docs/index.md`: add Configuration/manifests navigation entry.
      - `src/__tests__/docs.test.ts`: include the new API page and export checks.
    - References:
      - `roadmap.md` Phase 3 acceptance.
      - `plans/005-extension-kernel-and-contribution-registries.md` explicit registry/kernel decisions.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `config_layers_merge_in_documented_order`: validates later layer override, nested object merge, and array/primitive replacement.
    - `config_layers_do_not_mutate_inputs`: validates callers can reuse defaults safely.
    - `manifest_validation_accepts_data_only_contributions_and_defaults`: validates contribution declarations and `configDefaults` parse without executing anything.
    - `manifest_validation_rejects_invalid_name_or_non_json_defaults`: validates fail-closed trust-boundary behavior.
    - `new_config_manifest_types_import_from_root`: compile coverage for public exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public config/manifest contracts, helpers, and root exports.
    - Docs pages to create/edit:
      - `docs/configuration-and-manifests.md`: create detailed API page.
      - `docs/public-contracts.md`: update contract inventory and examples.
      - `docs/index.md`: add Configuration/manifests group entry.
    - `docs/index.md` update: Yes; add `Configuration/manifests - Configuration and manifests` navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/config.ts` with `ConfigLoadContext`, `ConfigProvider`, `ConfigLayer`, `isJsonObject()`, `assertJsonObject()`, `loadConfigLayers()`, and `mergeConfigLayers()`.
    - Config merging is caller-ordered and deterministic: later layers override earlier layers, nested plain objects merge recursively, arrays/primitives replace, and inputs are cloned rather than mutated.
    - Added `src/manifests.ts` with `ManifestContributionKind`, `ManifestContributionDeclaration`, `ManifestResourceDeclaration`, `PrismManifest`, `definePrismManifest()`, and `parsePrismManifest()`.
    - Manifest parsing validates data-only fields: non-empty manifest name, known contribution kinds matching Phase 2 registry categories, optional module/export/config/resource strings, JSON object defaults/metadata, and resource URI declarations.
    - Root-exported config/manifest helpers and types through `src/index.ts`; no package subpath or global config singleton was added.
    - Added `src/__tests__/config-manifests.test.ts` for documented merge order, input immutability, provider layer loading, valid data-only manifests, and invalid manifest/default rejection.
    - Updated `src/__tests__/public-contracts.test.ts` with compile coverage for `ConfigProvider`, `ConfigLayer`, `PrismManifest`, `ManifestContributionDeclaration`, and `ManifestResourceDeclaration`.
    - Created `docs/configuration-and-manifests.md`, updated `docs/public-contracts.md`, updated `docs/index.md`, and added the page/export checks to `src/__tests__/docs.test.ts`.
    - Security decision: manifest parsing and config merging never import modules, mutate registries, execute package code, read resources, call providers/tools, or resolve credentials. Validation errors name fields but do not include config contents.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 55 tests in 15 suites. Test duration reported by Node was 313.780586ms.

- [x] Add explicit optional Node filesystem config loader subpath
  - Acceptance Criteria:
    - Functional: A host can import an optional Node loader subpath to compute the default Prism user config path, read JSON config files, and return named config layers for `mergeConfigLayers()`.
    - Performance: Loader uses async `node:fs/promises`, reads only caller-specified files, does no directory scan, no package discovery, no watchers, no polling, and no network.
    - Code Quality: Node filesystem code stays out of core root implementation paths; errors include the config path and reason without leaking file contents; no new dependency or build tool.
    - Security: Loading is caller-controlled, missing optional files can be skipped deliberately, invalid JSON fails closed, paths are not auto-trusted as executable resources, and credentials are not read/resolved specially.
  - Approach:
    - Documentation Reviewed:
      - Node.js docs via Context7 `/nodejs/node` on 2026-06-16: ESM `import * as fs from 'node:fs/promises'`, recursive `fs.mkdir` behavior, and file URL/path context.
      - `package.json` existing `exports` shape and `files: ["dist"]` packaging.
      - `tsconfig.json` `NodeNext` and current subpath pattern for `prism/providers/openai-compatible`.
      - `roadmap.md` Phase 3: optional user/global config such as `~/.config/prism` only through explicit filesystem config loader.
      - `docs/credentials-and-redaction.md` secret-handling docs.
    - Options Considered:
      - Root-export filesystem loader from `prism`: rejected unless inventory proves it is harmless; a subpath makes the Node/filesystem boundary explicit.
      - Auto-load `~/.config/prism` during kernel creation: rejected; hidden globals and hidden filesystem access.
      - Support YAML/TOML/JSON5 now: rejected; JSON is enough and uses stdlib `JSON.parse`.
    - Chosen Approach:
      - Create `src/node/config.ts` with small helpers such as `defaultUserConfigPath(appName = "prism")`, `readConfigFile(path, options?)`, and `loadConfigFiles(files)` returning `ConfigLayer[]`.
      - Add `./node/config` to `package.json` exports with emitted types/default JS.
      - Tests create temporary JSON files with Node built-ins and verify missing optional files, invalid JSON, and explicit read behavior.
    - API Notes and Examples:
      ```ts
      import { mergeConfigLayers } from "prism";
      import { defaultUserConfigPath, loadConfigFiles } from "prism/node/config";

      const layers = await loadConfigFiles([
        { name: "user", path: defaultUserConfigPath(), optional: true },
        { name: "runtime", path: "./runtime.prism.json" },
      ]);
      const config = mergeConfigLayers(layers);
      ```
    - Files to Create/Edit:
      - `src/node/config.ts`: optional Node filesystem config loader helpers.
      - `package.json`: add `./node/config` export.
      - `src/__tests__/node-config.test.ts`: explicit filesystem loader tests.
      - `src/__tests__/index.test.ts`: package export coverage if needed.
      - `docs/node-filesystem-config.md`: public docs for the optional subpath.
      - `docs/index.md`: add Configuration/manifests navigation entry for Node config loader.
      - `src/__tests__/docs.test.ts`: include docs page and export/subpath checks.
    - References:
      - `roadmap.md` Phase 3 filesystem loader acceptance.
      - Node.js API docs from Context7 `/nodejs/node`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `default_user_config_path_uses_config_prism_config_json`: validates `~/.config/prism/config.json` style path without reading it.
    - `load_config_files_reads_only_explicit_paths`: validates caller-controlled file reads.
    - `load_config_files_skips_optional_missing_file`: validates optional user config behavior.
    - `load_config_files_rejects_invalid_json_or_non_object`: validates fail-closed parsing.
    - `node_config_subpath_exports_types_and_runtime`: validates package export/build output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds optional public package subpath and filesystem loader behavior.
    - Docs pages to create/edit:
      - `docs/node-filesystem-config.md`: create detailed API page.
      - `docs/index.md`: add Configuration/manifests entry for optional Node config loader.
      - `docs/configuration-and-manifests.md`: link to optional loader if useful.
    - `docs/index.md` update: Yes; add `Configuration/manifests - Node filesystem config loader` navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/node/config.ts` with `NodeConfigFile`, `defaultUserConfigPath(appName = "prism")`, `readConfigFile(path)`, and `loadConfigFiles(files)`.
    - Added package export `./node/config` pointing to `./dist/node/config.js` and `./dist/node/config.d.ts`.
    - The loader uses `node:fs/promises.readFile`, `node:os.homedir`, and `node:path.join`; it reads only caller-provided files and performs no directory scan, package discovery, watcher, polling, network call, dynamic import, or root-import side effect.
    - `loadConfigFiles()` preserves caller order, returns `ConfigLayer[]`, and skips missing files only when the caller marks that file `optional: true`.
    - Invalid JSON and non-object JSON fail closed. Read/parse errors include the path and reason, not file contents.
    - Added `src/__tests__/node-config.test.ts` covering default user config path, explicit file loading, optional missing files, invalid JSON/non-object rejection, and package subpath export declaration.
    - Created `docs/node-filesystem-config.md`, linked it from `docs/index.md`, linked it from `docs/configuration-and-manifests.md`, and added docs/subpath checks in `src/__tests__/docs.test.ts`.
    - Security decision: the Node loader treats JSON config as data only; it does not resolve credentials, trust executable resources, import package modules, or merge config automatically.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 61 tests in 16 suites. Test duration reported by Node was 314.567659ms.

- [x] Add resource loading helpers for manifests, prompts, skills, and package resources
  - Acceptance Criteria:
    - Functional: Public helpers load text resources, JSON resources, and Prism manifests through a caller-provided `ResourceLoader`; manifest/resource declarations can reference prompts, skills, manifests, and package resources by URI.
    - Performance: Helpers do no I/O by themselves beyond calling the provided loader once per requested URI, decode data with platform primitives, and do not cache or scan unless a host-provided loader does.
    - Code Quality: Reuse the existing `ResourceLoader` contract and `Resource` shape; do not add a filesystem/network/package loader, URI scheme registry, bundle resolver, or dynamic import behavior.
    - Security: Unknown URI trust is delegated to the host loader; helpers validate JSON at the boundary, preserve abort signals/context metadata, and never treat loaded resources as executable code.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `Resource`, `ResourceLoader`, and `ResourceLoadContext`.
      - `src/contributions.ts` `resourceLoaders` registry and `docs/contribution-registries.md` resource loader notes.
      - `roadmap.md` Phase 3 resource loader integration and Phase 10 trust deferral.
      - `docs/public-contracts.md` resource/security notes and `docs/credentials-and-redaction.md` no-secret examples.
      - `.agents/skills/create-plan/references/prism-wiki.md` API page requirements.
    - Options Considered:
      - Add built-in `file:`/`http:` resource loaders: rejected; Phase 10 trust and host permissions own filesystem/network resource loading.
      - Add a URI scheme router now: rejected; contribution registries already store loaders and no current runtime needs routing policy.
      - Add tiny helpers over caller-provided loader: chosen; enough for manifests/prompts/skills/package resources and keeps host control.
    - Chosen Approach:
      - Create `src/resources.ts` with helpers such as `loadTextResource(loader, uri, context?)`, `loadJsonResource(loader, uri, context?)`, and `loadManifestResource(loader, uri, context?)`.
      - Add `ManifestResourceDeclaration` fields for URI, media type, and purpose if not already added in Task 2.
      - Root-export helpers from `src/index.ts` and document that hosts/extensions decide which loader handles each URI.
    - API Notes and Examples:
      ```ts
      import { loadManifestResource, type ResourceLoader } from "prism";

      const loader: ResourceLoader = {
        async load(uri) {
          return { uri, mediaType: "application/json", text: '{"name":"demo"}' };
        },
      };

      const manifest = await loadManifestResource(loader, "package://demo/prism.manifest.json");
      ```
    - Files to Create/Edit:
      - `src/resources.ts`: resource decoding and manifest-loading helpers.
      - `src/manifests.ts`: resource declaration type updates if needed.
      - `src/index.ts`: root exports for resource helpers.
      - `src/__tests__/resources.test.ts`: resource helper tests.
      - `src/__tests__/public-contracts.test.ts`: compile coverage for resource declaration/types.
      - `docs/resource-loading.md`: public docs for resource helper APIs.
      - `docs/configuration-and-manifests.md`: link manifest resource loading.
      - `docs/public-contracts.md`: update resource contract summary if needed.
      - `docs/index.md`: add Configuration/manifests or Context/resources navigation entry.
      - `src/__tests__/docs.test.ts`: include the new API page/export checks.
    - References:
      - `roadmap.md` Phase 3 resource loading deliverable.
      - `plans/005-extension-kernel-and-contribution-registries.md` `resourceLoaders` registry decision.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `load_text_resource_prefers_text_and_decodes_data`: validates text/data handling with `TextDecoder`.
    - `load_json_resource_requires_json_object_for_config`: validates boundary parsing and fail-closed errors.
    - `load_manifest_resource_uses_manifest_validator`: validates integration with `parsePrismManifest()`.
    - `resource_helpers_forward_context_and_signal`: validates abort/context propagation to host loader.
    - `resource_helpers_do_not_call_loader_more_than_once_per_uri`: validates no hidden scan/cache behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds public resource helper APIs and manifest resource declaration behavior.
    - Docs pages to create/edit:
      - `docs/resource-loading.md`: create detailed API page.
      - `docs/configuration-and-manifests.md`: link manifest resource loading.
      - `docs/public-contracts.md`: update resource/manifest contract inventory if needed.
      - `docs/index.md`: add `Configuration/manifests - Resource loading` or equivalent entry.
    - `docs/index.md` update: Yes; link the new resource-loading API page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Added `src/resources.ts` with `loadTextResource()`, `loadJsonResource()`, and `loadManifestResource()` over a caller-provided `ResourceLoader`.
    - Root-exported the helpers from `src/index.ts`; no filesystem, network, package, URI router, cache, scan, or trust-policy loader was added.
    - `loadTextResource()` calls `loader.load()` once and returns `resource.text` or decodes `resource.data` with `TextDecoder`.
    - `loadJsonResource()` parses the loaded text as JSON and requires a JSON object at the boundary.
    - `loadManifestResource()` validates the JSON object with `parsePrismManifest()` and does not register contributions or execute package code.
    - Resource helper calls forward `ResourceLoadContext`, including abort signals and metadata, unchanged to the host loader.
    - Added `src/__tests__/resources.test.ts` covering text/data decoding, JSON object parsing, invalid JSON/non-object rejection, manifest validation integration, context forwarding, and one loader call per helper call.
    - Created `docs/resource-loading.md`, linked it from `docs/index.md`, `docs/configuration-and-manifests.md`, and `docs/public-contracts.md`, and added docs/export checks in `src/__tests__/docs.test.ts`.
    - Security decision: URI trust and I/O permissions remain entirely host-owned; helpers treat loaded resources as data and never import modules, resolve credentials, or mutate registries.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 66 tests in 17 suites. Test duration reported by Node was 354.59097ms.

- [x] Update public docs and docs consistency checks for Phase 3 APIs
  - Acceptance Criteria:
    - Functional: Docs pages cover configuration/manifests, optional Node filesystem config loading, and resource loading using the Prism API page structure; `docs/index.md` links every new public surface.
    - Performance: Docs checks remain static file checks with no site generator, network, package execution, or new dependency.
    - Code Quality: Docs examples import actual root exports or the explicit `prism/node/config` subpath; docs clearly state what is not implemented yet, including package discovery, dynamic imports, trust policy, and agent/session runtime use.
    - Security: Docs include no real-looking secret examples and explain that config/manifests/resources must not contain resolved credential values or executable code.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` required API page sections.
      - `docs/api-page-template.md`.
      - `src/__tests__/docs.test.ts` required headings, index link, root export, and secret-example checks.
      - New source/test files from Phase 3 implementation tasks.
    - Options Considered:
      - Let each implementation task update docs only: useful but easy to miss final navigation/export consistency.
      - Add a dedicated docs consistency task after public APIs exist: chosen; implementation tasks still plan docs, this task verifies everything together.
    - Chosen Approach:
      - Create/update `docs/configuration-and-manifests.md`, `docs/node-filesystem-config.md`, `docs/resource-loading.md`, `docs/public-contracts.md`, and `docs/index.md`.
      - Extend `src/__tests__/docs.test.ts` `apiPages` and export/subpath checks for new Phase 3 docs.
      - Keep docs in `/docs`; do not add a site generator.
    - API Notes and Examples:
      ```ts
      import { definePrismManifest, loadManifestResource, mergeConfigLayers } from "prism";
      import { loadConfigFiles } from "prism/node/config";
      ```
    - Files to Create/Edit:
      - `docs/configuration-and-manifests.md`: detailed config/manifest API page.
      - `docs/node-filesystem-config.md`: detailed optional Node loader API page.
      - `docs/resource-loading.md`: detailed resource helper API page.
      - `docs/public-contracts.md`: update public contract inventory/examples.
      - `docs/index.md`: navigation updates.
      - `src/__tests__/docs.test.ts`: include new pages and export/subpath checks.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `roadmap.md` non-negotiable boundary: docs ship with APIs.
  - Test Cases to Write:
    - `docs_index_links_phase_3_pages`: verifies all new local links exist.
    - `phase_3_api_pages_include_required_headings`: extends required-heading checks to new pages.
    - `phase_3_docs_reference_existing_exports_and_subpaths`: verifies documented root exports and `./node/config` export exist.
    - `docs_avoid_real_looking_secret_examples`: existing check still passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; this task publishes/validates docs for all Phase 3 public APIs.
    - Docs pages to create/edit:
      - `docs/configuration-and-manifests.md`: create/update.
      - `docs/node-filesystem-config.md`: create/update.
      - `docs/resource-loading.md`: create/update.
      - `docs/public-contracts.md`: update.
      - `docs/index.md`: update.
    - `docs/index.md` update: Yes; add links for configuration/manifests, Node filesystem config loader, and resource loading under a Configuration/manifests group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Confirmed Phase 3 API docs exist for `docs/configuration-and-manifests.md`, `docs/node-filesystem-config.md`, and `docs/resource-loading.md`, each using the required API page headings.
    - Confirmed `docs/index.md` links all Phase 3 pages under Configuration/manifests.
    - Updated docs to explicitly name non-goals including package discovery, dynamic imports, trust policy, and agent/session runtime startup.
    - Extended `src/__tests__/docs.test.ts` with checks that Phase 3 pages are linked from `docs/index.md`, documented root exports exist in `src/index.ts`, the `prism/node/config` subpath exists in `package.json`, and Phase 3 docs state explicit non-goals.
    - Kept docs checks as static file checks only; no site generator, network call, package execution, or new dependency was added.
    - Existing secret-example check still scans all docs and passed.
    - Ran `npm run build`, `npm run typecheck`, and `command npm test`; all passed with 68 tests in 17 suites. Test duration reported by Node was 417.092872ms.

- [x] Final verification and Phase 3 closeout
  - Acceptance Criteria:
    - Functional: All Phase 3 tasks are complete; config merge, manifest validation, explicit Node config loading, resource helper behavior, docs, and public exports/subpaths are covered by tests.
    - Performance: `command npm test` stays under 10 seconds and uses no network, provider SDKs, package discovery, dynamic import, watchers, or hidden filesystem access beyond explicit temp-file tests and static docs/source reads.
    - Code Quality: `npm run build`, `npm run typecheck`, and `command npm test` pass; emitted declarations, package exports, docs examples, and tests agree.
    - Security: Final review confirms no hidden globals, no auto filesystem discovery, no package execution during manifest parsing, no credential values in config/manifests/docs/tests, and no built-in file/network resource trust bypass.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts and exports after edits.
      - `docs/index.md` and all Phase 3 API pages after docs updates.
      - `src/index.ts`, `src/node/config.ts`, and emitted `dist/*.d.ts` / `dist/node/config.d.ts` after build.
      - Node.js Test runner usage already established in existing tests.
    - Options Considered:
      - Add lint/API-extractor tooling: rejected for now; strict TypeScript, export tests, docs checks, and runtime tests are enough.
      - Run existing scripts and record closeout notes: chosen.
    - Chosen Approach:
      - Run `npm run build`, `npm run typecheck`, and `command npm test` after all source/docs changes.
      - Update this plan's checkboxes, execution notes, `Compromises Made`, and `Further Actions` only after checks pass.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      ```
    - Files to Create/Edit:
      - `plans/006-configuration-manifests-and-resource-loading.md`: mark tasks complete and fill closeout sections during execution.
      - Any touched Phase 3 source/docs/test file: final consistency fixes only.
    - References:
      - `roadmap.md` Phase 3 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - `npm run build`: emits JavaScript and declaration files, including any optional Node subpath.
    - `npm run typecheck`: validates strict TypeScript types.
    - `command npm test`: runs runtime, public-boundary, config/manifest, Node config, resource, package export, and docs checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by verification itself; it confirms docs for prior public API changes.
    - Docs pages to create/edit:
      - `none`: verification does not add API docs by itself.
    - `docs/index.md` update: No unless final verification reveals a missing navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution Notes:
    - Verified all Phase 3 tasks are checked complete in this plan.
    - Reviewed `package.json` exports, `src/index.ts` root exports, and emitted declarations for config, manifests, resources, and `dist/node/config.d.ts`.
    - Confirmed Phase 3 behavior is covered by tests for config merging, manifest validation, explicit Node config files, resource helpers, docs links/headings/non-goals, root exports, and package subpath exports.
    - Confirmed no hidden global config, no root-import filesystem access, no automatic package discovery, no manifest-time package execution, no built-in file/network resource loader, and no credential resolution during config/manifest/resource helper work.
    - Ran `npm run build`; it passed.
    - Ran `npm run typecheck`; it passed.
    - Verified emitted declaration files exist for `dist/config.d.ts`, `dist/manifests.d.ts`, `dist/resources.d.ts`, and `dist/node/config.d.ts`.
    - Ran `command npm test`; all 68 tests in 17 suites passed. Test duration reported by Node was 358.704192ms, under the 10 second acceptance target.
    - Ran `git status --short`; it shows Phase 3 files plus pre-existing/prior phase changes still uncommitted. No extra cleanup was required for this plan task.

## Compromises Made
- No JSON Schema, YAML/TOML/JSON5, package discovery, URI router, built-in file/network resource loader, dynamic import loader, cache, watcher, or global config singleton was added. JSON-only host-explicit helpers satisfy Phase 3 with less surface area.
- Node filesystem config loading is limited to the explicit `prism/node/config` subpath and caller-named files. Hosts that need richer search paths or policy can add that outside core later.
- Resource helpers decode data only and delegate all URI trust/routing/I/O to the host `ResourceLoader`. This keeps Phase 10 trust policy out of Phase 3.

## Further Actions
- Phase 4+ can wire these data-only manifests/config layers into runtime/CLI loading once host activation rules exist.
- Add package discovery, URI routing, schema generation, or trust policy only when a host/runtime feature proves it needs them.
