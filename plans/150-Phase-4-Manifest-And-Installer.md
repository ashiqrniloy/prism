# Phase 4 — Manifest and installer

## Objectives

- Ship manifest format v1 (roadmap §2.7) with a published JSON Schema:
  - user scope `~/.prism/packages.json` and project scope `.prism/packages.json`
  - user-then-project merge keyed by package name
  - `slots` assignments
  - `optional` and `enabled` entries
- Install packages with `bun add` into the Prism-managed directories (`.prism/packages/`, `~/.prism/packages/`). Record an integrity hash at install and verify it before every import.
- Load the project scope only after the host's `trustProject` callback approves it. With no callback, skip the project scope.
- Validate package config against the package's schema at `configure` time without running `setup`. Accept only `env:` / `keyring:` refs in secret fields.
- Ship the `@arnilo/prism/manifest` API (`loadManifest`, `install`, `remove`, `setEnabled`, `configure`, `assignSlot`, `list`, `verify`) and the `prism` CLI (`add`, `remove`, `list`, `enable`, `disable`, `config`, `slot`, `verify`).
- Replace `prism init` and `prism providers add` with `prism new package <name>`, which scaffolds a package with conformance tests.

## Expected Outcome

- `packages: await loadManifest({ root, trustProject })` loads every enabled, integrity-verified entry as a package. Each one is active with no host wiring.
- `agent.inspect()` reports a manifest-sourced package with its scope and the `manifest` config source, and never shows secret values.
- Each of these fails closed with a `ManifestError` and a stable `code`, and each code has a test:
  - a schema violation or unknown field
  - an unknown `version`
  - a literal secret in `config`
  - an integrity mismatch
  - an untrusted project manifest (the project scope is skipped, and a project-only package is not loaded)
  - a slot assigned to a package that is not listed
  - a missing installed package
  - drift between the recorded and the actual capabilities
- `examples/manifest.ts` meets the Phase 4 Done criteria under the execution gate. It installs a local fixture package, loads it through `loadManifest`, disables it, and reloads without it.
- `docs/next/manifest.md` documents the format, the scopes, trust, integrity, the API, and the CLI. The JSON Schema ships at `@arnilo/prism/manifest/schema.json`.
- `prism init`, `prism providers add`, `templates/init/`, and `templates/provider/` are gone, with a repo-wide sweep. `prism new package <name>` produces a skeleton whose own tests pass, including `packageConformance`.

This plan implements roadmap **Phase 4 — Manifest and installer**. Task 1 is the phase review. It is required because the plan adds a kernel contract (the manifest format), a published subpath (`@arnilo/prism/manifest`), and a kernel CLI.

Phases 4, 5 and 6 may run in parallel after Phase 3 (plans 148 and 149, complete). This plan shares a few files with plans 151–153: root `package.json` (`exports`, `files`), `scripts/compat-baseline/arnilo__prism.txt`, `CHANGELOG.md`, and the docs and examples gate lists. A task that lands after a sibling plan's task rebases those files and regenerates the baseline.

The manifest validates `keyring:` refs only by syntax. They resolve once the keyring credentials package ships (plan 152). Until then, a `keyring:` ref resolves to nothing under the kernel's `env:`-only default, and the asking package fails closed.

Lab impact (probe 12): no `packages/prism-code` module becomes deletable. Prism Code adopts `loadManifest` in Phase 12. It may try `next` builds earlier, but this plan does not change the lab.

This plan does not ship a version bump, a publish, a `/docs` change, a package registry or marketplace, URL-based installs, or the `prism` runner modes (`--prompt`, `--mode rpc`, `dev`). Those runner modes stay untouched, and the Phase 11 sweep decides their fate.

## Tasks

- [ ] Task 1: Phase 4 review — manifest contract and installer (read-only)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract the phase touches, each citing roadmap §2.7, §2.6, or §1.4 and the current code at `file:line`:
      - the package config manifest layer (`src/packages/config.ts:12-17`, `resolvePackageConfig` at `:84`). The loader feeds `PackageInstance.config` into that layer today (`src/packages/loader.ts:233`).
      - `PackageInstance` / `PackageInput` (`src/packages/api.ts:161-180`) and `PackageInstanceOptions.optional`
      - `SlotAssignments` (`src/slots/types.ts:20-29`) and conflict resolution
      - the `SECRET_REF` pattern and the `x-prism-secret` rule (`src/packages/schema.ts:61,306`)
      - `agent.inspect()` config sources (`src/agent/inspect.ts`)
      - the CLI dispatch (`src/cli-runner.ts:301-319`), `src/cli-init.ts`, `src/cli-provider-add.ts`, `templates/init/`, `templates/provider/`
      - the Prism Code home layout (`packages/prism-code/src/home.ts:34`, `~/.prism`), checked for collisions with `~/.prism/packages.json` and `~/.prism/packages/`
    - Functional: Classify each Scope bullet of roadmap Phase 4 as *expressible with what exists* or *needs a kernel addition*, and record these decisions:
      - **(a) Output shape of `loadManifest`.** §2.3 types `packages` as `readonly PackageInput[]`, and `loadManifest() output` is one of its members. Decide how the manifest's `slots` and provenance (scope, path) reach the loader. Default: `loadManifest` returns `PackageInstance[]`, and each instance carries an optional `source: { kind: "manifest"; scope: "user" | "project"; assigns?: readonly SlotName[] }`. The loader treats a manifest `assigns` as a slot assignment that `AgentConfig.slots` overrides. Rejected alternative: a separate `AgentConfig.manifest` field, because §2.3 has none.
      - **(b) Instance config is the manifest layer.** A code instance's config (`coding({ root })`) feeds the `manifest` layer today. Decide whether a manifest-sourced instance keeps that layer and reports the source `manifest`, while a code instance reports a new source `code`, or whether both stay `manifest`. Default: add `code` to `PackageConfigSource`, so `inspect()` can tell them apart. This is a one-member addition to a frozen type, so `package-api-freeze.test.ts` must be updated on purpose.
      - **(c) Integrity.** Default: an SRI `sha512-<base64>` over a canonical tree of the installed package directory (sorted relative paths plus bytes, symlinks refused), recomputed before `import()`. Rejected alternative: the `bun.lock` tarball integrity, because it cannot be checked against the installed tree without the tarball, so an edit inside `node_modules` would pass. Decide whether transitive dependencies are covered by the managed directory's `bun.lock` with `--frozen-lockfile`, or are out of scope. Record the per-load hashing cost on a measured fixture.
      - **(d) Trust input without importing.** The trust callback receives names, versions, and capabilities *before* any project code runs. Default: `install` imports the definition once, records its `capabilities` in the entry, and the loader fails closed (`capabilities_drift`) when the imported definition's capabilities differ from the recorded ones. This adds a `capabilities` field to the v1 entry that the §2.7 sample does not show. Record it as a roadmap amendment.
      - **(e) Configure-time validation without `setup`.** Default: import the installed definition (after integrity), read `definition.config`, and run `resolvePackageConfig` with the new layer. `setup` never runs.
      - **(f) CLI runtime.** `src/cli.ts` runs under `#!/usr/bin/env node`, and `bun add` needs Bun. Decide whether the shebang becomes `bun` (the roadmap targets Bun only, §1.4) or the manifest commands fail closed with `bun_required` under another runtime. Check `packaging.test.ts` and the bin smoke for shebang assertions.
      - **(g) Retirement inventory.** Count every caller and reference of `prism init`, `prism providers add`, `runInitCommand`, `createInitProject`, `listInitTemplates`, `runProviderAddCommand`, `createProviderProject`, `loadProvidersCatalog` (still imported by `src/cli-runner.ts:7`), and `templates/{init,provider}`. Today that is 17 files mentioning `prism init` and 15 mentioning `providers add`. Decide the fate of the gallery templates `templates/{business-worker,deep-research,personal-assistant}`, which only `prism init --template` reads. Released `/docs` pages stay untouched.
      - **(h) Managed directory shape.** One `package.json` and `bun.lock` per scope directory, with `bun add <spec>` run there. Import resolution goes from `<dir>/node_modules/<name>`, never through the host's own `node_modules`. Confirm a `file:` spec works for a local fixture package (the example needs it).
    - Functional: Record the current failing-test set of `bun test src packages` (36 failures at plan 149 close) as this plan's baseline. Every later task proves "no new failures" against it.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the `graft` or `rg` command that produced it.
    - Security: List every point where untrusted bytes are read or code is imported: the manifest JSON, the installed package tree, the definition import, and `bun add`'s child process (env, cwd, and arguments, with no shell). Name the test each later task adds for each point.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.3, §2.6 Lifecycle, §2.7, Phase 4; `PRODUCT.md` (the manifest paragraph)
      - plan 146 Task 3 (config merge), plan 147 Task 6 (package freeze), plan 148 Task 1 (review precedent)
      - Bun `bun add` docs (`--cwd`, `--frozen-lockfile`, and `file:` specs), checked with the find-docs skill
    - Options Considered:
      - Skip the review because the manifest is "just a file". Rejected: decisions (a), (b), and (d) change the frozen `PackageInstance` and config-source types.
    - Chosen Approach:
      - Run graft and rg per symbol, read the cited spans, and run the `bun add` and `file:` probes in the scratchpad.
    - API Notes and Examples:
      ```bash
      graft callers resolvePackageConfig --depth all
      graft grep "PackageConfigSource"
      rg -l "prism init|providers add" src packages scripts examples docs templates
      ```
    - Files to Create/Edit:
      - `plans/150-Phase-4-Manifest-And-Installer.md`: Notes and amendments only.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Manifest format v1, JSON Schema, scopes and merge
  - Acceptance Criteria:
    - Functional: `src/manifest/format.ts` defines `PrismManifestV1`:
      - `version: 1`
      - `packages: ManifestEntry[]`, where each entry has `name`, `version` (a semver range), `integrity`, optional `config`, optional `enabled` (default `true`), optional `optional` (default `false`), and `capabilities` per Task 1(d)
      - optional `slots: Partial<Record<SlotName, string>>`

      The name `PrismManifest` was retired in plan 147 for the old contribution manifest. Task 1 confirms the new type name does not collide with that retired name in the sweep allow-list.
    - Functional: `schemas/packages.v1.schema.json` is the published JSON Schema, exported as `@arnilo/prism/manifest/schema.json`. `parseManifest(json, { scope, path })` validates against it with the kernel validator (`src/packages/schema.ts`). The schema file and the validator agree: a test validates every fixture through both.
    - Functional: `mergeManifestScopes(user, project)` is keyed by package name:
      - a project entry overrides the user entry's `version`, `config` (deep-merged like `resolvePackageConfig`), and `enabled`
      - array order is load order: user entries first, then project-only entries
      - project `slots` override user `slots` per slot
    - Functional: These fail closed as `ManifestError` with a `code`:
      - unknown top-level or entry field → `manifest_unknown_field`
      - `version` other than `1` → `manifest_version`
      - duplicate name within one scope → `manifest_duplicate`
      - a `slots` owner that is not a listed, enabled entry → `manifest_slot_owner`
      - a malformed name or range → `manifest_invalid`

      Literal secrets are checked against each package's schema in Task 5. Task 2 rejects only a top-level non-object `config`.
    - Performance: Parsing reads each scope file once. No package is imported in this task.
    - Code Quality: Placement is the kernel `src/manifest/`. The manifest is listed in roadmap §2.1 and §2.2 and is required by the package system (`prism.md` §1). It adds no runtime dependency. The `kernel-imports-no-package` gate stays green.
    - Security: An error message names the scope, the path, and the field, never a `config` value. A test feeds a literal-looking secret through an invalid entry and asserts it is absent from the error.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.7 (sample, Scopes, Secret fields), §2.2 (`manifest/`)
      - `src/packages/schema.ts` (validator, `SECRET_REF`), `src/packages/config.ts:50-57` (the `merge` rule to reuse)
    - Options Considered:
      - Use a third-party JSON Schema validator (ajv). Rejected: §1.4 says the kernel has no runtime dependencies, and plan 146 already ships a validator.
      - Use the schema file as the only validator. Rejected: the kernel validator is the one the loader uses, so both must agree, and a test pins it.
    - Chosen Approach:
      - Hand-written TypeScript types, a JSON Schema file, and a parse function on the existing validator. The merge reuses the package-config merge rule.
    - API Notes and Examples:
      ```ts
      import { parseManifest, mergeManifestScopes } from "@arnilo/prism/manifest";
      const user = parseManifest(await Bun.file(userPath).json(), { scope: "user", path: userPath });
      ```
    - Files to Create/Edit:
      - `src/manifest/format.ts`, `src/manifest/errors.ts`, `src/manifest/merge.ts`, `src/manifest/index.ts`: new.
      - `schemas/packages.v1.schema.json`: new.
      - `package.json`: `exports["./manifest"]`, `exports["./manifest/schema.json"]`, and `files` gains `schemas` (tentative: Task 1 confirms the root `files` list).
      - `scripts/compat-baseline/arnilo__prism-manifest.txt` (new subpath), produced by `node scripts/release.mjs gate --update-baseline`, with the diff in the task note.
      - `src/__tests__/manifest-format.test.ts`: new.
      - `docs/next/manifest.md`: new, with the format and scopes sections. `CHANGELOG.md`.
    - References:
      - plan 146 Task 3 (validator), plan 147 Task 6 (`PrismManifest` retirement)
  - Test Cases to Write:
    - `manifest_v1_fixture_validates_through_schema_file_and_kernel_validator`
    - `unknown_field_fails_closed_naming_scope_and_path`
    - `unsupported_version_fails_closed`
    - `duplicate_name_in_one_scope_fails_closed`
    - `project_entry_overrides_user_version_config_and_enabled`
    - `merge_keeps_user_order_then_project_only_entries`
    - `slot_owner_must_be_a_listed_enabled_entry`
    - `manifest_error_never_contains_config_values`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new subpath and a new file format.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: new (API page structure), covering the format, scopes, and merge.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Managed install directory, `install` / `remove`, and integrity
  - Acceptance Criteria:
    - Functional: `install(spec, { scope, root?, home?, version? })`:
      1. Runs `bun add <spec>` in the scope's managed directory (`<root>/.prism/packages/` or `<home>/.prism/packages/`), creating the directory with a private `package.json` on first use.
      2. Imports the installed definition once and checks that its default export is a `PackageDefinition`.
      3. Records the entry with `name`, the resolved `version` range, `integrity` (Task 1(c)), and `capabilities` (Task 1(d)).
      4. Writes the manifest atomically: temp file, then rename.

      A `file:` spec installs a local package.
    - Functional: `remove(name, { scope })` runs `bun remove`, deletes the entry, and drops any `slots` assignment that pointed at it. It does not touch the other scope.
    - Functional: `verifyInstalled(entry, dir)` recomputes the tree hash. A mismatch fails closed as `ManifestError("integrity_mismatch")`, naming the package and scope, before any `import()`.
    - Functional: These fail closed:
      - a default export that is not a package → `not_a_package`, and the install is rolled back with `bun remove`
      - `bun` missing or exiting non-zero → `install_failed`, with redacted stderr
      - a symlink inside the package tree pointing outside it → `integrity_mismatch`
    - Performance: `bun add` runs once per install. Load-time verification reads each package file once. The task note records a measured per-load cost for a 50-file fixture, and `docs/next/manifest.md` states the cost.
    - Code Quality: The `bun` child is spawned with an argument array (no shell) and an explicit `cwd`. The installer lives in `src/manifest/install.ts`, separate from parsing, so `loadManifest` never pulls in spawn code.
    - Security:
      - Installing is the trust decision (§1.4): `install` imports the package, but only at the user's request.
      - The spawn passes the parent environment minus nothing. Task 1 records whether to strip `NPM_TOKEN`-like variables; default: pass through, because `bun add` needs registry auth.
      - The manifest never records a resolved secret.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.7 Storage; Task 1(c), (d), (h)
      - Bun `bun add` / `bun remove` docs (find-docs), `Bun.spawn`, `Bun.CryptoHasher("sha512")`
    - Options Considered:
      - Install into the host's `node_modules`. Rejected: §2.7 names Prism-managed directories, and host dependencies must not shadow a managed package.
      - Shell out through `sh -c`. Rejected: spec injection.
    - Chosen Approach:
      - A per-scope Bun project directory, a canonical tree hash, and atomic manifest writes.
    - API Notes and Examples:
      ```ts
      import { install, remove } from "@arnilo/prism/manifest";
      await install("file:./fixtures/hello-package", { scope: "project", root: cwd });
      await remove("@acme/hello", { scope: "project", root: cwd });
      ```
    - Files to Create/Edit:
      - `src/manifest/install.ts`, `src/manifest/integrity.ts`, `src/manifest/store.ts` (atomic read and write): new.
      - `src/__tests__/fixtures/manifest/hello-package/`: a fixture package with `package.json`, `src/index.ts` (`definePackage`), and a config schema with one `x-prism-secret` field.
      - `src/__tests__/manifest-install.test.ts`: new.
      - `docs/next/manifest.md`: install, integrity, and the cost note. `CHANGELOG.md`.
      - `scripts/compat-baseline/arnilo__prism-manifest.txt`: regenerate, with the diff in the task note.
    - References:
      - `src/cli-provider-add.ts:336-342` (`assertNoSymlinkEscape`, reused for the tree walk)
  - Test Cases to Write:
    - `install_file_spec_records_name_range_integrity_and_capabilities`
    - `tampered_file_fails_closed_before_import`: edits one byte in the installed tree, then asserts `integrity_mismatch` and that a module-level side effect never ran.
    - `symlink_escape_in_package_tree_fails_closed`
    - `non_package_default_export_is_rejected_and_rolled_back`
    - `remove_drops_entry_and_its_slot_assignment_only_in_that_scope`
    - `manifest_write_is_atomic` (a crash between temp and rename leaves the old file)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `install`, `remove`, integrity.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: install and integrity sections, plus the per-load hashing cost.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: `loadManifest`, project trust, and loader provenance
  - Acceptance Criteria:
    - Functional: `loadManifest({ root?, home?, scopes?, trustProject? })` returns the `PackageInput[]` shape Task 1(a) fixed. It reads the scopes, merges them (Task 2), drops `enabled: false` entries, verifies integrity (Task 3), imports each definition from its managed directory, and binds the entry `config` and `optional` flag.
    - Functional: The project scope loads only when `trustProject` resolves `true`. The callback receives `{ path, packages: [{ name, version, capabilities }] }` and nothing is imported before it answers. With no callback, or an answer of `false`, the project scope is skipped. A project-only package is then not loaded, and a user entry stays at its user values.
    - Functional: The loader honours the manifest's slot assignments as Task 1(a) fixed. `AgentConfig.slots` still wins over them, and a direct implementation always wins.
    - Functional: A recorded-versus-actual capability difference fails closed as `capabilities_drift` (Task 1(d)). A manifest entry whose package is not installed fails closed as `package_missing`, unless it is `optional: true`, in which case it is skipped with a status note.
    - Functional: `agent.inspect()` reports, per package, `source` (`code` | `manifest:user` | `manifest:project`) and the config sources per Task 1(b). `package-api-freeze.test.ts` and `agent-surface-freeze.test.ts` are updated on purpose and cite this task.
    - Performance: `loadManifest` performs one directory read per scope, one tree hash per enabled entry, and one `import()` per enabled entry. A disabled entry costs nothing beyond parsing.
    - Code Quality: `loadManifest` does not depend on `install.ts`, so a host that only loads never imports spawn code. A test asserts this through the module graph.
    - Security:
      - An untrusted project manifest never causes an `import()`. A test uses a module-level side effect to prove it.
      - The trust callback receives no config values.
      - A thrown trust callback fails closed as `trust_failed`, and the project scope is not loaded.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.7 Project trust, §2.6 Lifecycle step 1, §2.11 "Prism Code"
      - `src/packages/loader.ts:206-260` (input normalization), `src/agent/inspect.ts`, `src/slots/registry.ts`
      - plan 138 (repo MCP trust prompt precedent)
    - Options Considered:
      - Trust by path allow-list in the kernel (`createPathTrustPolicy`, `src/node/trust.ts:48`). Rejected: §2.7 makes trust a host callback, and a path policy can be one implementation a host passes.
    - Chosen Approach:
      - Verify, then trust, then import. Provenance travels on the instance and is surfaced by `inspect()`.
    - API Notes and Examples:
      ```ts
      import { createAgent } from "@arnilo/prism";
      import { loadManifest } from "@arnilo/prism/manifest";
      const agent = await createAgent({
        model,
        packages: await loadManifest({ root: process.cwd(), trustProject: async (m) => ui.confirm(m) }),
      });
      ```
    - Files to Create/Edit:
      - `src/manifest/load.ts`: new.
      - `src/packages/api.ts`: `PackageInstance.source` per Task 1(a). `src/packages/config.ts`: the `code` source per Task 1(b).
      - `src/packages/loader.ts`: slot assignments and provenance from instances. `src/agent/inspect.ts`: `source`.
      - `src/__tests__/package-api-freeze.test.ts`, `src/__tests__/agent-surface-freeze.test.ts`, `src/__tests__/public-export-contract.test.ts`: deliberate updates.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-manifest.txt`: regenerate, with the diff and its attribution in the task note.
      - `src/__tests__/manifest-load.test.ts`: new.
      - `docs/next/manifest.md` (load and trust), `docs/next/packages.md` (instance `source`, the `code` config source). `CHANGELOG.md`.
    - References:
      - plan 146 Task 8 (`inspect()`), plan 144 Task 3 (slot conflicts)
  - Test Cases to Write:
    - `untrusted_project_manifest_never_imports_project_code`
    - `no_trust_callback_skips_project_scope_keeps_user_values`
    - `trust_callback_receives_names_versions_capabilities_only`
    - `throwing_trust_callback_fails_closed`
    - `disabled_entry_is_not_imported`
    - `manifest_slot_assignment_resolves_conflict_and_host_slots_win`
    - `capabilities_drift_fails_closed`
    - `missing_installed_package_fails_closed_unless_optional`
    - `inspect_reports_manifest_scope_and_config_sources_without_values`
    - `load_manifest_does_not_import_installer_module`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `loadManifest`, trust, and `inspect()` provenance.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: load and trust.
      - `docs/next/packages.md`: instance `source`, config source `code`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: `configure`, `setEnabled`, `assignSlot`, `list`, and `verify`
  - Acceptance Criteria:
    - Functional: `configure(name, patch, { scope })` imports the installed, integrity-verified definition and merges `patch` into the entry's `config`. It validates the result with `resolvePackageConfig` against `definition.config` (Task 1(e)) without running `setup`, then writes atomically. These fail closed:
      - an unknown key → `config_unknown_key`
      - a schema violation → `config_invalid`
      - a literal in an `x-prism-secret` field → `secret_literal`

      These are the same codes as the loader's `PackageLoadError` (`src/packages/config.ts:31-43`). A rejected `configure` leaves the file unchanged.
    - Functional: `setEnabled(name, enabled, { scope })` writes an override in the given scope. Disabling in project scope a package that exists only in user scope writes a project entry `{ name, enabled: false }`, which is legal by the merge rule.
    - Functional: `assignSlot(slot, owner | null, { scope })` validates `slot` against `SlotName` and requires `owner` to be a listed entry.
    - Functional: `list({ root?, home? })` returns the merged view: name, version, scope of origin, enabled, optional, capabilities, and slot ownership. Config keys are listed, but values are never included.
    - Functional: `verify({ root?, home? })` re-checks integrity and config for every entry and returns per-entry results. It does not stop at the first failure.
    - Performance: `configure` imports one definition. `list` imports nothing. `verify` hashes every entry once.
    - Code Quality: One `ManifestError` code table, shared with Task 2. The package-config error codes are reused, not duplicated.
    - Security: `configure` refuses a literal secret before writing, so a literal never reaches disk. A test reads the file back. `list` and `verify` output contains no config values.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.7 API, Phase 4 ("install-time validation needs no setup run")
      - `src/packages/config.ts:84-131`, `src/packages/schema.ts:306`
    - Options Considered:
      - Validate config only at load. Rejected: the roadmap requires `configure`-time validation, and a literal secret must never be written.
    - Chosen Approach:
      - Import the definition for its schema, validate, then write.
    - API Notes and Examples:
      ```ts
      await configure("@acme/hello", { apiKey: "env:HELLO_KEY" }, { scope: "user" });
      await configure("@acme/hello", { apiKey: "sk-live-123" }, { scope: "user" }); // ManifestError secret_literal; file unchanged
      ```
    - Files to Create/Edit:
      - `src/manifest/maintain.ts`: new.
      - `src/manifest/index.ts`: exports.
      - `scripts/compat-baseline/arnilo__prism-manifest.txt`: regenerate, with the diff in the task note.
      - `src/__tests__/manifest-maintain.test.ts`: new.
      - `docs/next/manifest.md`: API reference table. `CHANGELOG.md`.
    - References:
      - plan 146 Task 3
  - Test Cases to Write:
    - `configure_validates_against_package_schema_without_setup`: the fixture's `setup` throws, and `configure` still succeeds.
    - `configure_rejects_literal_secret_and_leaves_file_unchanged`
    - `configure_rejects_unknown_key`
    - `project_disable_of_user_package_overrides_without_copying_config`
    - `assign_slot_requires_listed_owner_and_known_slot`
    - `list_shows_keys_never_values`
    - `verify_reports_every_entry_including_failures`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — manifest maintenance API.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: API section.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The `prism` manifest CLI, `prism new package`, and retirement of `init` / `providers add`
  - Acceptance Criteria:
    - Functional: `prism add <spec> [--user|--project]` (default `--project`), `remove`, `list [--json]`, `enable`, `disable`, `config <name> <key>=<value>…`, `slot <slot> <owner|--clear>`, and `verify` are thin wrappers over the Task 3–5 API. Exit codes: `0` ok, `1` a `ManifestError`, `2` usage. `prism add` prints the declared capabilities before writing (§2.6 Capabilities: "shown by `prism add`").
    - Functional: `prism new package <name> [--dir]` scaffolds the roadmap §2.10 package shape:
      - `package.json` with `"exports": { ".": "./src/index.ts" }`
      - `src/index.ts` with `definePackage`, `requires.prism`, an empty config schema, and no capabilities
      - `src/__tests__/package.test.ts` running `packageConformance` from `@arnilo/prism/testing`
      - `README.md` in the package page structure

      The generated skeleton's tests pass when run in a temp directory.
    - Functional: `prism init`, `prism providers add`, `src/cli-init.ts`, `src/cli-provider-add.ts`, `templates/init/`, and `templates/provider/` are deleted, along with the gallery templates per Task 1(g). Their tests are deleted or rewritten: `src/__tests__/cli-init.test.ts`, `src/__tests__/cli-provider-add.test.ts`, the `scripts/e2e-cli-live.test.mjs` legs, and `packages/prism-coding-tools/src/dev/cli.ts` mentions. No alias command is added.
    - Functional: A repo-wide grep for `prism init`, `providers add`, `runInitCommand`, `createInitProject`, `listInitTemplates`, `runProviderAddCommand`, `createProviderProject`, `loadProvidersCatalog`, and `templates/init`/`templates/provider` over `src/ packages/ apps/ scripts/ examples/ docs/` returns only the residue Task 1 allowed. Exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, the frozen `scripts/phase*-freeze-manifest.json` history, and the released `/docs` pages, which stay on 0.12.1 until Phase 11.
    - Functional: The CLI runtime follows Task 1(f).
    - Performance: `prism list` and `prism verify` do not spawn `bun`. Only `add` and `remove` do.
    - Code Quality: Argument parsing lives in `src/cli-manifest.ts`, separate from the runner modes. `src/cli-runner.ts` only dispatches the subcommand.
    - Security: `prism config` refuses a literal for a secret field with a message naming the field and the accepted ref forms, never echoing the value. Errors printed to stderr are redacted.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.7 CLI, Phase 4 (replacement of `init` / `providers add`), §2.10 package shape
      - `src/cli-runner.ts:290-330`, `src/cli-init.ts`, `src/cli-provider-add.ts`, `templates/`
      - `src/testing/package-conformance.ts`
    - Options Considered:
      - Keep `prism init` as a host-project scaffolder beside `new package`. Rejected: the roadmap says both are replaced, and the init templates generate 0.12 `createAgent` code.
    - Chosen Approach:
      - Wrap the API one-to-one, add one scaffold template under `templates/package/`, and delete the old commands with a sweep.
    - API Notes and Examples:
      ```bash
      prism add @arnilo/prism-hooks-json --project
      prism config @arnilo/prism-hooks-json file=.claude/hooks.json
      prism disable @arnilo/prism-hooks-json
      prism new package @acme/prism-audit
      ```
    - Files to Create/Edit:
      - `src/cli-manifest.ts`: new. `src/cli-runner.ts`: dispatch, with the `init` / `providers add` branches and the `loadProvidersCatalog` import removed. `src/cli.ts`: shebang per Task 1(f).
      - `templates/package/`: new scaffold. `templates/init/`, `templates/provider/`, and the gallery templates per Task 1(g): deleted. `templates/README.md`.
      - `src/cli-init.ts`, `src/cli-provider-add.ts`, `src/__tests__/cli-init.test.ts`, `src/__tests__/cli-provider-add.test.ts`: deleted.
      - `src/__tests__/cli-manifest.test.ts`, `src/__tests__/cli-new-package.test.ts`: new.
      - `scripts/e2e-cli-live.test.mjs`, `packages/prism-coding-tools/src/dev/cli.ts`, and any other Task 1(g) caller: updated.
      - `src/__tests__/packaging.test.ts`: `templates` contents, if it pins them.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate (the exports of `cli-init` and `cli-provider-add` leave), with the diff in the task note.
      - `docs/next/manifest.md`: CLI section. `CHANGELOG.md`: removal of `prism init` / `prism providers add`.
    - References:
      - plan 147 Task 5 (grouped package layout), plan 125 (Bun-only contract)
  - Test Cases to Write:
    - `cli_add_prints_capabilities_then_records_entry`
    - `cli_config_rejects_literal_secret_without_echoing_it`
    - `cli_exit_codes_distinguish_usage_and_manifest_errors`
    - `cli_list_and_verify_never_spawn_bun`
    - `new_package_skeleton_passes_its_own_conformance_test`
    - `init_and_providers_add_are_unknown_subcommands`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the `prism` CLI changes commands.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: CLI reference.
      - `CHANGELOG.md`: Unreleased (removals and additions).
      - Released `/docs` pages (`docs/cli-rpc.md`, `docs/provider-packages.md`, `docs/release-and-install.md`): none — they describe 0.12.1 until Phase 11.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Example, enforcement rows, and the Phase 4 close
  - Acceptance Criteria:
    - Functional: `examples/manifest.ts` works in a temp root:
      1. `install` the local fixture package from `examples/fixtures/hello-package/` with `file:`.
      2. `createAgent({ packages: await loadManifest({ root }) })` on the mock provider runs one turn that uses the package's tool.
      3. `setEnabled(name, false)`, reload, and show the tool is absent.
      4. Corrupt one installed byte and show `integrity_mismatch`.
      5. Show an untrusted project manifest being skipped.
      6. Show `configure` rejecting a literal secret.

      It prints one JSON line. It imports only `@arnilo/prism`, `@arnilo/prism/manifest`, and `@arnilo/prism/testing`.
    - Functional: The example is added to the demo list of `examples_demos_run_to_completion_and_emit_no_secret` (`src/__tests__/docs.test.ts:3397`), to `examples/README.md`, and to `scripts/e2e-coverage.json`.
    - Functional: The task note records each Phase 4 Done criterion with its proof:
      - the install, load, disable, and reload cycle (this example)
      - tampered integrity and an untrusted project both fail closed (Task 3 and Task 4 tests, and the example)
      - a literal secret is rejected (Task 5 test, and the example)
    - Functional: `docs/next/manifest.md` is complete in the API page structure, with an implementation example taken from `examples/manifest.ts`.
    - Performance: The example finishes in under 5 s with `bun add` of a `file:` spec. If CI shows it slower, the task note records the measured time.
    - Code Quality: No internal seam is imported, and the example uses no deprecated export.
    - Security: The demo gate's no-secret check covers the example. The fixture uses `env:` refs only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 4 Done; `examples/define-package.ts`, `examples/approval.ts` (precedents)
    - Options Considered:
      - Fake `bun add` in the example. Rejected: Done requires a real install of a local fixture package.
    - Chosen Approach:
      - Run one real example under the execution gate, then record the Done criteria with their proof.
    - API Notes and Examples:
      ```ts
      const root = await mkdtemp(join(tmpdir(), "prism-manifest-"));
      await install(`file:${fixture}`, { scope: "project", root });
      ```
    - Files to Create/Edit:
      - `examples/manifest.ts`, `examples/fixtures/hello-package/`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts`: demo list.
      - `docs/next/manifest.md`: implementation example. `CHANGELOG.md`.
      - `plans/README.md`: status.
    - References:
      - plan 149 Task 7
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret`: extended with `examples/manifest.ts`.
    - `manifest_example_imports_only_prism_manifest_and_testing`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API — an example and docs.
    - Docs pages to create/edit:
      - `docs/next/manifest.md`: implementation example.
      - `examples/README.md`: entry.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/manifest-format.test.ts src/__tests__/manifest-install.test.ts src/__tests__/manifest-load.test.ts src/__tests__/manifest-maintain.test.ts src/__tests__/cli-manifest.test.ts src/__tests__/cli-new-package.test.ts`
- `bun test --timeout=0 src/__tests__/package-api-freeze.test.ts src/__tests__/agent-surface-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/manifest.ts`
- `bun test src packages`: no failure outside the Task 1 baseline set.
- The Task 6 `rg` sweep, which returns only the Task 1 residue.
- `node scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
