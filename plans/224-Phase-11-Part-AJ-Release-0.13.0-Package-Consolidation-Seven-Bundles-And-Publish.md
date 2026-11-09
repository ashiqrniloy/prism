# Phase 11 Part AJ — release 0.13.0: package consolidation into seven bundles, and publish

## Objectives

- Publish 0.13.0 as **seven npm packages instead of 52** (owner decision 2026-11-09). Prism's flexibility does not change: each former package becomes a **subpath** of a bundle (`@arnilo/prism-tools/web`). A host still lists, configures and loads every Prism package on its own, and a subpath the host does not list is never imported.
- Teach the kernel's package system and manifest that a Prism package name is a **module specifier**: an npm name, optionally followed by a subpath. `prism add @arnilo/prism-tools/web` installs the npm package once and records one manifest entry per subpath. A third-party package that is one whole npm package works exactly as before.
- Move the tree to the seven bundles with no alias, no re-export shim and no compatibility package. Each former name is a retired name enforced by the standing sweep.
- Carry plan 215's remaining publishing work (Task 39, plus the owner-side setup that Task 38 left open) over to the seven-name world and publish 0.13.0.

## Expected Outcome

- `scripts/bundles.json` is the single source for the bundle map: bundle name, directory, version line, and each subpath with its former package name. A gate fails when a workspace, an `exports` key, a `files` entry or a package definition's `name` disagrees with it.
- The root `workspaces` is `["packages/*", "apps/*"]`, and `packages/` holds exactly six bundle directories (`providers`, `tools`, `extensions`, `hosts`, `memory`, `knowledge`) and nothing else; the kernel is the seventh npm package, at the root. `bun scripts/release.mjs pack` produces **seven** tarballs: the kernel plus the six bundles.
- `definePackage`, the manifest schema, `prism add` / `prism remove`, integrity verification and `loadManifest` accept `<npm-name>/<subpath>` names, and each one fails closed on malformed or unexported subpaths.
- The 50 former workspace names are in `scripts/retired-names.json`, and `no_retired_name_in_live_tree` is green.
- Compat baselines exist per bundle, with each line prefixed by its subpath. The per-package baseline files of the former names are deleted, and the diff is attributed to this plan.
- The trusted-publisher bootstrap that plan 215 Task 38 left to the owner covers **six** never-published names instead of 51.
- `@arnilo/prism` 0.13.0, the four stable bundles on `latest`, and the two experimental bundles on `experimental` are published; deprecations are confirmed; versioning is per bundle; and the Phase 11 Done record is written.

**Plan shape.** This plan is release step 17l. It replaces plan 215 Task 39, which moves here as Task 10 with its criteria intact except where the bundle map changes a name or a count. Plan 215 is closed at Task 38 (owner decision 2026-11-09). The plan **changes a kernel contract** (the package name rule in `definePackage`, the manifest schema, `prism add` / `prism remove`) **and moves every package**, so Task 1 is a read-only phase review. Task 2 amends the roadmap and `PRODUCT.md` before any code moves, because the roadmap currently defines a package as one npm package (`roadmap.md:444`). The version stays 0.13.0: nothing has been published at 0.13.0 for any of the former names (plan 215 Task 38 note: 51 of 52 names have no registry record), so no deprecation, redirect or registry cleanup is needed for them. `/docs` pages and package READMEs are edited in the task that changes them.

**Concurrency.** The memory track (plans 217–223) works on `main` in `packages/memory` and `packages/knowledge`. Tasks 4–8 rename imports and move directories across the whole tree, so each one lands as its own commit, and the owner pauses memory-track execution while Tasks 5–8 run, or the memory session rebases onto each commit. No task here changes memory behaviour. Plan 208 Task 8 and every precondition plan 215 Task 39 listed still apply to Task 10.

**Owner gates (outward-facing):** Task 10 only (the tag push, the six bootstrap first publishes, the trusted-publisher setup, the deprecation confirmation). Live work stays on the providers and scope plan 215 Task 34 recorded, never `openrouter/free` or `openrouter/auto`. Keys stay in `~/.config/prism/live.env`. Memory stays non-RAG: no task adds embeddings.

## The bundle map (owner decisions 2026-11-09)

Decisions: **seven** npm packages, with memory and knowledge kept apart because the wiki is knowledge outside memory (owner, 2026-11-08); the plumbing bundle is called `@arnilo/prism-extensions`; Command Code and Ollama Cloud **ship at 0.13.0** inside the providers bundle, which reverses the 2026-10-25 deferral; and the 0.12-era names `@arnilo/prism-providers` and `@arnilo/prism-memory` are **not reused**: the bundles take fresh names. `@arnilo/prism-model-providers` is the executor's proposed fresh name for the providers bundle, and Task 1 confirms it with the owner before Task 4 uses it.

| Bundle (npm name) | Directory | Line at 0.13.0 | Subpaths (former package → subpath) |
| --- | --- | --- | --- |
| `@arnilo/prism` | `.` | stable, `latest` | unchanged (kernel) |
| `@arnilo/prism-model-providers` | `packages/providers` | stable, `latest`, independent after 0.13.0 | `provider-commandcode` → `./commandcode`, `provider-hyper` → `./hyper`, `provider-kilo` → `./kilo`, `provider-laya` → `./laya`, `provider-liquid` → `./liquid`, `provider-litellm` → `./litellm`, `provider-ollama-cloud` → `./ollama-cloud`, `provider-openai-codex` → `./openai-codex`, `provider-opencode-go` → `./opencode-go`, `provider-openrouter` → `./openrouter`, `provider-typesafe` → `./typesafe` |
| `@arnilo/prism-tools` | `packages/tools` | stable, `latest`, independent | `tools-coding` → `./coding`, `tools-web` → `./web`, `tools-browser` → `./browser`, `tools-research` → `./research`, `tools-openapi` → `./openapi`, `tools-computer-use` → `./computer-use`, `tools-work` → `./work` plus its twelve subpaths as `./work/<subpath>` |
| `@arnilo/prism-extensions` | `packages/extensions` (new) | stable, `latest`, independent | `context-engineering` → `./context-engineering`, `context-files` → `./context-files`, `memory-compaction` → `./compaction`, `credentials-keyring` → `./keyring`, `advisor` → `./advisor`, `delegate` → `./delegate`, `hooks-json` → `./hooks-json`, `mcp` → `./mcp`, `observability` → `./observability`, `workflows` → `./workflows` (+ `./workflows/testing`), `approval` → `./approval`, `governance` → `./governance`, `guardrail-packs` → `./guardrail-packs`, `model-router` → `./model-router`, `store-codecs` → `./store-codecs`, `store-jsonl` → `./store-jsonl`, `store-sqlite` → `./store-sqlite`, `store-postgres` → `./store-postgres` |
| `@arnilo/prism-hosts` | `packages/hosts` | stable, `latest`, **lockstep with the kernel** (it carries the host-builder kit, whose indexes describe exactly one kernel version, plan 215 Task 14) | `acp` → `./acp`, `ag-ui` → `./ag-ui` (+ `./ag-ui/renderer`), `channels` → `./channels` (+ `./channels/telegram`, `./channels/signal`), `devtools` → `./devtools` (bin `prism-devtools`), `evals` → `./evals`, `headless` → `./headless`, `host-builder` → `./host-builder` (bin `prism-host-builder`), `mcp-server` → `./mcp-server`, `remote` → `./remote` (+ `./remote/testing`), `driver-process` → `./driver-process` (+ `./driver-process/testing`) |
| `@arnilo/prism-memory-system` | `packages/memory` | **experimental**, `0.13.0-experimental.N`, dist-tag `experimental` | `memory-system` → `.` (the root), `memory-core` → `./core` (+ `./core/fabric`, `./core/postgres`, `./core/sqlite`) |
| `@arnilo/prism-knowledge` | `packages/knowledge` | **experimental**, pins `@arnilo/prism-memory-system` exactly | `wiki` → `./wiki`, `rag` → `./rag` |

Former names are written without the `@arnilo/prism-` prefix above, so `tools-web` means `@arnilo/prism-tools-web`. Directory moves: `packages/{context,credentials,integrations,policy,stores}/*` and `packages/memory/compaction` move to `packages/extensions/<subpath>`, and `packages/drivers/process` moves to `packages/hosts/driver-process`. Every other subfolder keeps its path, so `import.meta.url`-relative assets (`packages/tools/web/src/index.ts:181` skills, `packages/hosts/host-builder/src/indexes.ts:96` data) resolve unchanged.

Dependencies between bundles point one way, with no cycle: `model-providers → prism`; `extensions → prism`; `tools → extensions` (`./coding` needs `./workflows`; `./web` and `./computer-use` take `./mcp` optionally); `hosts → extensions` (`./mcp`, `./workflows`, `./store-codecs`, `./observability`); `memory-system → prism`; `knowledge → memory-system` (exact pin), with `@arnilo/prism-tools` as an optional peer for `./rag`'s web ingestion.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The review inventories every contract the bundle move touches, with `file:line`:
      - **Name rules:** `NPM_NAME` in `src/packages/define.ts:17` (checked at `:33`); `NAME` and `REGISTRY_SPEC` in `src/manifest/install.ts:37-38`; `NAME_PATTERN` in `src/manifest/schema.ts:6` (published as `@arnilo/prism/manifest/schema.json`); `PACKAGE_NAME` in `src/cli-manifest.ts:269` (the scaffolder: it names a new npm package and stays a bare-name rule); and the `not_a_package` name check in `src/manifest/definition.ts:32`.
      - **Install unit vs. package name:** `resolveSpec` (`src/manifest/install.ts:147`), `changedDependency` (`:184`), `install` (`:193`), `remove` (`:243`), `installedPackageDir` / `hashPackageClosure` / `verifyInstalled` (`src/manifest/integrity.ts:123,182,309`), `importDefinition` (`src/manifest/definition.ts:56`, which already resolves `entry.name` through `createRequire().resolve`, so an exports-mapped subpath resolves), `loadManifest` (`src/manifest/load.ts:80`) and `src/manifest/maintain.ts`.
      - **Where a package name is a key:** `packageConfig`, `duplicate_package` (`src/packages/loader.ts:272`), slot owners in the manifest, event and status `package` fields, `inspect()`, the host-builder indexes, package skills and `requiresTools`.
    - Functional: The review classifies each change as *expressible with what exists* or *needs a kernel addition*. Expected verdict, to be confirmed or refuted: no new hook, slot, `PackageAPI` member or primitive. The change is a widened name rule plus an install-unit derivation inside the manifest code, which is kernel-owned (`references/prism.md` §1: "the package system, the manifest").
    - Functional: The review records, per subpath in the bundle map, whether its default export is a `definePackage` (a Prism package the manifest can install) or a library (host libraries, `./core`, `./store-codecs`, `testing` subpaths). It also records each subpath's external dependencies, required or optional, and its assets (`skills`, `data`, `bin`, `vendor`, `docling`, `sandbox`, `vendor-lock.json`, `THIRD_PARTY_NOTICES`). The note keeps the table that Tasks 4–8 copy into each bundle's `exports` and `files`.
    - Functional: The review checks five assumptions and records a finding for each one that fails:
      - (a) **Self-reference.** A subpath that imports a sibling through the bundle's own name (`@arnilo/prism-extensions/store-codecs` from `./store-postgres`) resolves under Bun 1.4.4 through the bundle's `exports` map, both in the workspace and from a packed tarball installed into a temp project.
      - (b) **Prompt bytes.** Whether any package `name` reaches model-visible prompt bytes: the skills catalog, tool descriptions, status notes in the prompt. If it does, Tasks 4–8 re-pin `prefix-stability-conformance` and the cache-parity fixtures, and the note says which.
      - (c) **Memory-bench pins.** Which memory-bench product hashes and pins fingerprint the paths or bytes Tasks 5 and 8 change: `scripts/memory-bench/audit/readiness.mjs:438`, `scripts/memory-bench/replay.mjs:1137`, and the plan 202 cache-stability pin.
      - (d) **Registry names.** The six new bundle names return 404 from an anonymous registry `GET`, and none is in `scripts/retired-names.json` or `scripts/deprecations-0.13.json`.
      - (e) **Plans 205 and 206.** Plan 205's index row says "in progress" while every task in it is checked. Record the status to set in Task 2.
    - Functional: **The executor stops and asks the owner to confirm** the providers bundle's fresh name (`@arnilo/prism-model-providers` proposed; alternatives considered: `@arnilo/prism-models`, which reads as the kernel's model core). The note records the answer. If the owner picks another name, the bundle map section of this plan is amended in the same commit as the note.
    - Performance: n/a — read-only.
    - Code Quality: n/a — no code.
    - Security: The review confirms that `install` still runs `bun add --ignore-scripts` and that a subpath name cannot widen what is imported. Resolution goes only through the bundle's `exports` map, and segments `.` / `..` or an empty segment are rejected before `bun add` runs.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md:444` (package definition), `roadmap.md:1594-1610` (Part 3 version targets), the Part 2 package catalog (`roadmap.md:612-613` and neighbours), `PRODUCT.md` (principles "The kernel knows no package names", "Installed means active", "Packages are trusted code")
      - `src/manifest/*.ts`, `src/packages/define.ts`, `scripts/release.mjs:18-45` (`loadRelease` already accepts a family directory with its own `package.json`)
      - Node.js "Packages: self-referencing a package using its name" and "subpath exports", and Bun's module resolution (find-docs, current versions)
    - Options Considered:
      - Skip the review because the change "only renames". Rejected: it widens a kernel name rule and the install path that is the user's trust decision.
    - Chosen Approach:
      - Read-only inventory plus the five verifications, then the owner's name confirmation.
    - API Notes and Examples:
      ```sh
      graft callers toPackageDefinition --depth all
      graft callers install --depth all
      graft grep "NPM_NAME"
      ```
    - Files to Create/Edit:
      - this plan (Task 1 note only)
    - References:
      - plan 215 Tasks 37–38 notes (registry state, bootstrap), plan 216 Task 1 (name decisions for memory), `references/prism.md` §2
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review only)
    - Docs pages to create/edit: none, review only
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Roadmap, product and planning-reference amendment (docs only)
  - Acceptance Criteria:
    - Functional: `roadmap.md` records the owner decision of 2026-11-09:
      - The `Updated:` line and the Phase 11 bullets name the decision.
      - `:444` defines a package as a module specifier (an npm package or one of its exported subpaths) whose default export is `definePackage(...)`.
      - The Part 2 package catalog gives each package its bundle subpath, its directory, and the bundle it ships in.
      - Part 3's version targets list the seven npm packages with their lines: kernel; four stable bundles, of which `hosts` is lockstep and the other three are independent after 0.13.0; two experimental bundles.
      - The 0.12 deprecation rows stay as history.
      - Command Code and Ollama Cloud move from "after 0.13.0" to "in 0.13.0, in `@arnilo/prism-model-providers`".
    - Functional: `PRODUCT.md`:
      - Its native-packages table names each bundle and its subpaths.
      - "Installing a package is the trust decision" is restated for bundles: installing a bundle trusts its code, while loading stays per subpath and per host listing, so "Nothing loads unless the host lists it" is unchanged.
      - The experimental paragraph names `@arnilo/prism-memory-system` and `@arnilo/prism-knowledge` with the `@experimental` install line.
    - Functional: The planning and execution references agree with the roadmap:
      - `.agents/skills/create-plan/references/prism.md` §1 placement table, §4 "New native package" layout (a new package is a subpath folder in a bundle plus a `scripts/bundles.json` row; a new bundle is an owner decision) and §5 standing gates; mirrored in `.claude/skills/create-plan/references/prism.md`.
      - `.agents/skills/prism-execution/references/release.md` and its `.claude` mirror, for the seven-name publish.
    - Functional: `plans/README.md` (release step 17l, this plan's row and plan 215's `closed at Task 38` status were added when the plan was created, 2026-11-09):
      - Records plans 205 and 206 as shipping in 0.13.0, and fixes plan 205's status per Task 1 (e).
      - Adds a dated amendment line to the rows of plans 217–223 saying their package names follow the bundle map (`@arnilo/prism-memory-system/core`, `@arnilo/prism-knowledge/wiki`, `@arnilo/prism-knowledge/rag`).
    - Functional: `docs.test.ts` stays green: kernel pages carry no plan narrative, and the plan index validates.
    - Performance: n/a — docs only.
    - Code Quality: The decision is stated once in the roadmap and referenced elsewhere. No restated release narrative goes into `/docs` pages.
    - Security: The trust sentence names what a bundle install implies, rather than weakening the existing rule.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Parts 1–3, `PRODUCT.md`, both `references/prism.md` copies, `plans/README.md` rows 17k, 205, 206, 216–223
    - Options Considered:
      - Amend the roadmap at the end, after the code moves. Rejected: the plan implements the roadmap, and Tasks 3–8 would contradict `roadmap.md:444` while they run.
    - Chosen Approach:
      - One docs commit before any code moves.
    - API Notes and Examples:
      ```md
      A package is a module specifier — an npm package, or one subpath its `exports` map lists — whose default export is `definePackage(...)`.
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `PRODUCT.md`, `plans/README.md`
      - `.agents/skills/create-plan/references/prism.md`, `.claude/skills/create-plan/references/prism.md`
      - `.agents/skills/prism-execution/references/release.md` and its `.claude` mirror (tentative: only if it names per-package publish counts)
      - `plans/217-…` through `plans/223-…` (header amendment line only; task bodies are not rewritten)
    - References:
      - plan 215 header (release facts), memory model decision 2026-11-08
  - Test Cases to Write:
    - n/a — the existing `docs.test.ts` plan-index and kernel-page checks cover the edits; run them.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no code; the product definition of a package changes
    - Docs pages to create/edit: `roadmap.md`, `PRODUCT.md`, `plans/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Kernel — a package name is a module specifier
  - Acceptance Criteria:
    - Functional: **One name rule, in one place.**
      - `src/packages/define.ts` exports a module-specifier rule that the manifest code reuses. The four copies at `define.ts:17`, `install.ts:37-38` and `schema.ts:6` are replaced by imports of it.
      - The rule is `<npm-name>(/<segment>)*`: each segment is `[a-z0-9][a-z0-9._~-]*`, `.` and `..` are rejected, the name is at most 214 characters, and there is no trailing slash.
      - `src/cli-manifest.ts:269` keeps the bare npm-name rule, because it names a new npm package.
    - Functional: **`definePackage`** accepts `@arnilo/prism-tools/web` and keeps rejecting every malformed name with its existing error.
    - Functional: **`toPackageDefinition`** (`definition.ts:32`) requires the exported `name` to equal the manifest entry's name, which is the full specifier. The message changes from "differs from the installed package" to "differs from the specifier it was installed as".
    - Functional: **`prism add <spec>`** / `install`:
      - It splits the spec into the npm root and an optional subpath.
      - It runs `bun add --ignore-scripts <root>[@range]` once.
      - It hashes the **root's** closure.
      - It imports the specifier through the exports map and records an entry whose `name` is the specifier.
      - It fails closed in three cases, each rolled back:
        - an unexported subpath: `import_failed`, naming the specifier;
        - a bundle root or subpath whose default export is not a package: `not_a_package`, and the message lists the bundle's subpaths that do export packages, read from the installed `package.json` `exports`;
        - a malformed specifier: `install_failed`.
    - Functional: **Siblings share a root.**
      - Installing a second subpath of an installed root reuses or upgrades the root.
      - It refreshes `integrity` (and `version` when the root moved) on **every** manifest entry with that root, so `verifyInstalled` never reports drift on a sibling.
      - Two entries with the same root never carry different versions: the manifest format validator rejects that as `invalid_manifest`, with the existing code family.
    - Functional: **`prism remove <spec>`** removes the entry and its slot assignments. It runs `bun remove <root>` only when no other entry in that scope has the same root.
    - Functional: **`loadManifest`**, `verify` and `list` work per specifier. `capabilities_drift` is reported per specifier. A missing root with `optional: true` yields the existing `missingStub` for each of its entries.
    - Functional: The published `@arnilo/prism/manifest/schema.json` carries the new pattern.
    - Functional: No hook, slot, `PackageAPI` member, event or loader behaviour changes. `duplicate_package` and `packageConfig` keys keep using the definition name, which is now the specifier.
    - Performance: Installing *n* subpaths of one root runs `bun add` once per install call and hashes the root closure once per call. No extra registry requests.
    - Code Quality:
      - The root/subpath split is one exported pure function (`splitSpecifier`), tested on its own.
      - No alias accepts the old error message.
      - No second name regex remains in `src/` except the scaffolder's.
    - Security:
      - Resolution stays inside the root's `exports` map: no deep file path, no `..`, no URL, git or alias spec (the existing `REGISTRY_SPEC` limits stay).
      - `--ignore-scripts` stays.
      - Integrity still covers the whole root closure, so a sibling's code cannot change unseen.
      - The trust prompt (`review`) shows the specifier **and** the bundle root being trusted.
  - Approach:
    - Documentation Reviewed:
      - Task 1 note; `src/manifest/install.ts:147-275`, `src/manifest/integrity.ts:123-340`, `src/manifest/definition.ts:20-75`, `src/manifest/load.ts:80-155`, `src/manifest/maintain.ts:116-240`, `src/manifest/schema.ts:6-10`
      - `docs/manifest.md`, `docs/packages.md:31` (name rule)
    - Options Considered:
      - **Keep one npm package per Prism package and publish 52 names.** Rejected by the owner (2026-11-09).
      - **A `prism.packages` field in the bundle `package.json` that lists package subpaths.** Rejected: it duplicates the `exports` map. The `not_a_package` hint reads `exports` directly.
      - **Give the manifest entry a separate `install` field (the npm root).** Rejected: the root is derivable from the name, and a second field could disagree with it.
      - **Keep definition names as the former npm names (`@arnilo/prism-tools-web`) and map them.** Rejected: a name that looks installable but is not is a trap, and it needs a lookup table in the kernel. The kernel must not know package names.
    - Chosen Approach:
      - The specifier is the name. The npm root is derived. The exports map is the only resolver.
    - API Notes and Examples:
      ```ts
      // src/packages/define.ts
      export const MODULE_SPECIFIER: RegExp;            // <npm-name>(/<segment>)*
      export function splitSpecifier(spec: string): { readonly root: string; readonly subpath?: string };
      ```
      ```sh
      prism add @arnilo/prism-tools/web        # bun add @arnilo/prism-tools; entry "@arnilo/prism-tools/web"
      prism add @arnilo/prism-tools/coding     # same root, refreshes both entries' integrity
      prism remove @arnilo/prism-tools/web     # root stays: /coding still listed
      ```
    - Files to Create/Edit:
      - `src/packages/define.ts`, `src/manifest/install.ts`, `src/manifest/definition.ts`, `src/manifest/integrity.ts`, `src/manifest/load.ts`, `src/manifest/maintain.ts`, `src/manifest/schema.ts`, `src/manifest/format.ts` (sibling-version rule)
      - `src/__tests__/manifest-install.test.ts`, `manifest-load.test.ts`, `manifest-integrity.test.ts`, `manifest-format.test.ts`, `manifest-maintain.test.ts`, `cli-manifest.test.ts`, `package-loader.test.ts` (name rule cases), `public-export-contract.test.ts` (only if `splitSpecifier` is exported from a public subpath; tentative)
      - `docs/manifest.md`, `docs/packages.md`, `CHANGELOG.md`
      - `packages/hosts/host-builder` indexes and skill text (`bun scripts/host-builder-index.mjs`), because `host_builder_kit_matches_surface` pins the manifest docs and error messages (plan 215 standing rule)
      - `scripts/compat-baseline/arnilo__prism.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 215 Task 28 (shape freeze: a widened pattern is an addition, not a shape change; the note says so), Task 1 of this plan
  - Test Cases to Write:
    - `module_specifier_accepts_root_and_subpaths`: bare, scoped, one-segment and nested subpaths.
    - `module_specifier_rejects_dot_segments_and_trailing_slash`: `@a/b/..`, `@a/b/./c`, `@a/b/`, uppercase, and 215 characters. Fails if the regex loosens.
    - `define_package_accepts_subpath_name` and `define_package_rejects_malformed_subpath`.
    - `install_subpath_adds_root_once_and_records_specifier`: a fake bundle (temp `file:` dir) with two package subpaths.
    - `install_second_subpath_refreshes_sibling_integrity`: then `verify` reports no drift. Fails if siblings keep the old hash.
    - `install_bundle_root_lists_package_subpaths_in_not_a_package`.
    - `install_unexported_subpath_fails_import_failed_and_rolls_back`.
    - `remove_subpath_keeps_root_while_sibling_listed` and `remove_last_subpath_removes_root`.
    - `manifest_rejects_sibling_entries_with_different_versions`.
    - `load_manifest_resolves_subpath_through_exports_map`.
    - `definition_name_must_equal_specifier`.
    - `manifest_schema_json_name_pattern_matches_runtime_rule`: the published JSON pattern and the runtime regex agree on a shared case table.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. The package name rule, the manifest name field, and `prism add` / `prism remove` semantics change.
    - Docs pages to create/edit:
      - `docs/manifest.md`: entry name, bundle roots, the shared-root integrity and removal rules, the new failure messages.
      - `docs/packages.md`: the name rule and the subpath package layout.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no (scope sentences unchanged)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The bundle map, bundle-aware release tooling, and the first bundle (`@arnilo/prism-model-providers`)
  - Acceptance Criteria:
    - Functional: **`scripts/bundles.json`** (new) holds the bundle map from this plan's table:
      - per bundle: `name`, `dir`, `line` (`independent` | `lockstep` | `experimental`), `subpaths`;
      - per subpath: `path`, `dir`, `formerName`, `kind` (`package` | `library`).
      - Every gate below reads it, and nothing else restates it.
    - Functional: **Bundle-aware tooling.** These read bundles from `scripts/bundles.json` and stay correct while the tree is mixed: some groups bundled, others still per package until Task 8.
      - `scripts/release.mjs` `loadRelease` (`:18`): a bundle directory with a `package.json` is one release unit, and its subfolders are not.
      - `scripts/package-truth.mjs` counts and its generated docs line.
      - `src/__tests__/packaging.test.ts`'s package list (`:74` onward).
      - `scripts/independent-packages.json`.
      - `scripts/budgets.json` (packed and unpacked rows per release unit).
      - `scripts/coverage-thresholds.json` (keyed by directory, not package name).
      - `scripts/host-builder-index.mjs`.
      - `scripts/package-skills-conformance.mjs`.
      - `src/__tests__/experimental-boundary.test.ts`.
      - the `docs.test.ts` "every package README is linked" check, which now iterates subpath READMEs.
      - The CI `--filter` lists in `.github/workflows/*.yml`.
    - Functional: **Compat baselines per bundle.**
      - The compat gate writes `scripts/compat-baseline/arnilo__prism-model-providers.txt`, with every line prefixed by its subpath, as the kernel's `.` prefix already is.
      - The eleven `arnilo__prism-provider-<name>.txt` files of shipped providers are deleted.
      - The 0.12-era retired provider baselines stay, because they feed the retired-name ledger.
      - The task note carries the regeneration diff, attributed to this plan: export names unchanged, subpath moved.
    - Functional: **Retired names.**
      - `scripts/retired-names.mjs --generate` also reads `formerName` from `scripts/bundles.json` once its subpath is bundled.
      - The eleven `@arnilo/prism-provider-*` working names enter `scripts/retired-names.json` with the successor specifier.
      - `no_retired_name_in_live_tree` is green.
    - Functional: **The providers bundle.**
      - `packages/providers/package.json` is `@arnilo/prism-model-providers`, 0.13.0, with eleven `exports` entries (`./<vendor>` → `./<vendor>/src/index.ts`) and a `files` list covering every subfolder's `src` (tests excluded), `README.md` and the bundle-level `CHANGELOG.md` and `LICENSE`.
      - It has one `test`/`typecheck` script over all subfolders and peer `@arnilo/prism` `>=0.13.0 <1.0.0`.
      - The eleven per-provider `package.json` files are deleted. Their `CHANGELOG.md` content is folded under per-subpath headings in the bundle's `CHANGELOG.md`.
      - Each provider's `definePackage({ name })` is its specifier (`@arnilo/prism-model-providers/hyper`).
      - Every caller is updated in this task: `apps/prism-agent` (its `package.json` and `src/host`), `examples/`, `scripts/` (live matrix rows, cache-parity drivers, `canary-providers.yml`), tests, and docs.
      - `bun.lock` is regenerated.
    - Functional: **Command Code and Ollama Cloud ship.**
      - `providers/commandcode` and `providers/ollama-cloud` are in the bundle's `exports`, `files` and baseline.
      - They are in the freeze set.
      - Their live rows stay non-gating for 0.13.0, as recorded by plan 215 Task 34 and the owner scope; this task records that.
    - Functional: The bundle `README.md` (new) lists each subpath with a one-line description and its install line. The eleven provider READMEs stay as the subpaths' package pages, with install lines and manifest names rewritten to specifiers.
    - Performance:
      - Importing `@arnilo/prism-model-providers/hyper` loads no sibling provider. A test spawns `bun` and checks the loaded module paths.
      - The packed size is recorded against a new `model-providers` budget row.
    - Code Quality:
      - No provider imports a sibling (existing provider rule).
      - No re-export index at the bundle root, which has no `.` export.
      - No compatibility package under the former names.
    - Security:
      - The secret-handling tests of each provider (`SecretSource`, plan 215 Task 27) pass unchanged.
      - No new dependency.
  - Approach:
    - Documentation Reviewed:
      - Task 1 note (subpath table, self-reference, prompt bytes); `scripts/release.mjs:18-60`; `scripts/package-truth.mjs:85-180`; `scripts/retired-names.mjs:6-160`; `src/__tests__/packaging.test.ts`; `scripts/independent-packages.json`
    - Options Considered:
      - **Assemble bundles at pack time from per-package workspaces.** Rejected: the published names would differ from what tests import, so the packed consumer test would be the only place the real import paths run.
      - **Move every group in one task.** Rejected: one task with 13k occurrences across about 1,500 files cannot stay reviewable. The providers bundle has zero external dependencies and no dependents except the host, scripts and examples, so it proves the tooling first.
    - Chosen Approach:
      - Tooling plus the simplest bundle, then one bundle per task in dependency order.
    - API Notes and Examples:
      ```jsonc
      // scripts/bundles.json (excerpt)
      { "bundles": [ { "name": "@arnilo/prism-model-providers", "dir": "packages/providers", "line": "independent",
          "subpaths": [ { "path": "./hyper", "dir": "hyper", "formerName": "@arnilo/prism-provider-hyper", "kind": "package" } ] } ] }
      ```
      ```ts
      import hyper from "@arnilo/prism-model-providers/hyper";
      createAgent({ model: "hyper/…", packages: [hyper()] });
      ```
    - Files to Create/Edit:
      - `scripts/bundles.json`, `scripts/bundles.test.mjs` (new)
      - `scripts/release.mjs`, `scripts/package-truth.mjs`, `scripts/retired-names.mjs`, `scripts/retired-names.json`, `scripts/independent-packages.json`, `scripts/budgets.json`, `scripts/coverage-thresholds.json`, `scripts/host-builder-index.mjs`, `scripts/package-skills-conformance.mjs`, `scripts/compat-baseline/*`
      - `packages/providers/package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json` (new); `packages/providers/*/package.json` (deleted); `packages/providers/*/src/index.ts` (definition names); `packages/providers/*/README.md`
      - root `package.json` (`workspaces`: `packages/providers/*` becomes `packages/providers`), `bun.lock`
      - `apps/prism-agent/package.json` and `src/host/*`, `examples/*`, `scripts/live-*`, `scripts/cache-parity/*`, `.github/workflows/canary-providers.yml`, `src/__tests__/{packaging,docs,experimental-boundary,release}.test.ts`, `scripts/release-gate.test.mjs`
      - `docs/index.md` (links), `docs/models.md` / `docs/provider-kit.md` (install lines; tentative, per grep), `docs/migrate-to-0.13.md` (successors of the 0.12 provider names), `docs/_evidence/phase54-package-map.md` (live map only; dated evidence is not rewritten), `CHANGELOG.md`
      - `packages/hosts/host-builder` indexes and skill text
    - References:
      - plan 215 Tasks 2 (experimental tooling), 27 (`SecretSource`), 34 (live scope); `references/prism.md` §3 probes 6, 7, 11
  - Test Cases to Write:
    - `bundle_map_covers_every_workspace_subpath`: every subfolder with a `src/index.ts` under a bundle directory is in the map, and vice versa.
    - `bundle_exports_match_map` and `bundle_files_ship_every_subpath_asset`: these fail when a `skills/`, `data/`, `bin/` or `vendor/` folder is not in `files`.
    - `package_definition_name_equals_specifier`: imports each `kind: "package"` subpath and checks `default.name`.
    - `former_names_are_retired_once_bundled`.
    - `load_release_treats_bundle_dir_as_one_unit`.
    - `provider_subpath_import_loads_no_sibling`.
    - Plus the existing provider conformance suites, now run by `bun run --filter @arnilo/prism-model-providers test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Provider install names and import paths change.
    - Docs pages to create/edit: `packages/providers/README.md` (new bundle page), the eleven provider READMEs, `docs/index.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes. A bundle entry links the bundle README, and each provider link points at its subpath README.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: The extensions bundle (`@arnilo/prism-extensions`)
  - Acceptance Criteria:
    - Functional: `git mv` moves `packages/{context/engineering,context/files,credentials/keyring,integrations/*,policy/*,stores/*}` and `packages/memory/compaction` to `packages/extensions/<subpath>` per the bundle map. The emptied group directories are removed.
    - Functional: `packages/extensions/package.json` is `@arnilo/prism-extensions` 0.13.0. It has one `exports` entry per subpath, including `./workflows/testing`, and a `files` list including `delegate/skills`. Each `kind: "package"` definition is named by its specifier. The eighteen per-package manifests are deleted, and their CHANGELOGs are folded in.
    - Functional: **Intra-bundle imports use self-reference**, for example `@arnilo/prism-extensions/store-codecs` inside `./store-postgres` and `@arnilo/prism-extensions/governance` inside `./mcp`. Task 1 (a) proved this resolves from the packed tarball. Cross-bundle callers are updated in this task:
      - `packages/tools/coding` → `./workflows`;
      - `packages/tools/{web,computer-use}` → `./mcp`, optional peer;
      - `packages/hosts/*` → `./mcp`, `./workflows`, `./store-codecs`, `./observability`;
      - `packages/hosts/evals`;
      - `apps/prism-agent`, `examples/`, `scripts/`, tests, docs.
    - Functional: **Dependencies.** The union of the subpaths' external dependencies is split three ways:
      - **Required:** only dependencies that are pure JavaScript and small, as measured in Task 1.
      - **Optional peers, named in the subpath README:** native or heavy dependencies used by one subpath, namely `@napi-rs/keyring` (native, `./keyring`), `pg` (`./store-postgres`), `@opentelemetry/api` (`./observability`), and `@modelcontextprotocol/client` with `zod` if Task 1 shows they are heavy.
      - **Missing optional peer at load:** the subpath reports `status.note(...)` and registers nothing, per the existing package rule; it never throws an unhandled import error.
    - Functional: **Compat baselines and retired names.** `arnilo__prism-extensions.txt` is created by `bun scripts/release.mjs gate --update-baseline`, and the eighteen per-package baselines that existed only as 0.13 working names are deleted. The 0.12-era files for `mcp`, `workflows`, `evals` and `model-router` stay for the ledger. The diff is attributed in the note. The former names are retired, and the sweep is green.
    - Functional: **Memory-bench pins.** If Task 1 (c) found that `memory/compaction`'s path or bytes are fingerprinted, the note records the hash change, and the plan 202 cache-stability pin is re-attested as plan 216 Task 8 did. A new pin is accepted only where the provider requests are byte-identical.
    - Performance: Importing `@arnilo/prism-extensions/approval` loads none of `pg`, `@napi-rs/keyring`, `@opentelemetry/api` or the MCP SDK (spawned-process module check). Each optional peer is imported only inside its subpath.
    - Code Quality: No relative import crosses a subpath boundary (`../../mcp/src`). Self-reference is the only way in, and an import-hygiene test enforces it.
    - Security: Store conformance, credential (`keyring`) tests and governance deny-wins tests pass unchanged. No secret-bearing field changes shape.
  - Approach:
    - Documentation Reviewed:
      - Task 1 dependency table; `scripts/import-hygiene.test.mjs`; the store and credentials conformance suites
    - Options Considered:
      - **Stores as a separate bundle.** Rejected by the owner (seven names, with stores inside extensions).
      - **Relative imports between subpaths.** Rejected: they bypass the subpath's public entry and couple folder layouts.
    - Chosen Approach:
      - One move commit, self-reference imports, and optional peers for the heavy or native dependencies.
    - API Notes and Examples:
      ```ts
      import { createSqliteStore } from "@arnilo/prism-extensions/store-sqlite";
      import approval from "@arnilo/prism-extensions/approval";
      ```
    - Files to Create/Edit:
      - `packages/extensions/**` (moved), `packages/extensions/{package.json,README.md,CHANGELOG.md,LICENSE,tsconfig.json}` (new)
      - every caller listed above; `scripts/bundles.json`, `scripts/retired-names.json`, `scripts/compat-baseline/*`, `scripts/budgets.json`, `scripts/coverage-thresholds.json`, `scripts/import-hygiene.test.mjs`, `bun.lock`, root `package.json`
      - CI workflows that filter these packages (`integration-postgres.yml`, `security.yml`, `release.yml`; tentative per grep)
      - `docs/index.md`, `docs/migrate-to-0.13.md`, the eighteen subpath READMEs, `docs/credentials-and-redaction.md`, `docs/host-security.md` (install lines; tentative per grep), `CHANGELOG.md`
      - `packages/hosts/host-builder` indexes and skill text
    - References:
      - Task 4 tooling; plan 216 Task 8 (pin re-attestation commands)
  - Test Cases to Write:
    - `extensions_subpath_import_loads_no_optional_peer`.
    - `no_relative_import_crosses_a_subpath`.
    - `keyring_without_native_peer_reports_status_note`: fails if a missing `@napi-rs/keyring` throws at load.
    - Plus the existing store conformance (jsonl, sqlite, and postgres under `PRISM_TEST_POSTGRES_URL`), governance and workflow suites, now under `bun run --filter @arnilo/prism-extensions test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Install names and import paths change, and some dependencies become optional peers.
    - Docs pages to create/edit: `packages/extensions/README.md` (new), the subpath READMEs (install, manifest name, optional peer), `docs/index.md`, `docs/migrate-to-0.13.md`, `docs/peer-dependencies.md` (optional peers per subpath), `CHANGELOG.md`
    - `docs/index.md` update: yes. Bundle entry plus moved README links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The tools bundle (`@arnilo/prism-tools`)
  - Acceptance Criteria:
    - Functional: `packages/tools/package.json` is `@arnilo/prism-tools` 0.13.0:
      - `exports` has `./coding`, `./web`, `./browser`, `./research`, `./openapi`, `./computer-use`, `./work` and `./work/<each of its twelve subpaths>`.
      - `files` covers `src` and `skills` per subfolder, plus `work/{docling,sandbox,vendor,vendor-lock.json,THIRD_PARTY_NOTICES}`.
      - Each definition is named by its specifier.
      - The seven per-package manifests are deleted.
    - Functional: **Dependencies.**
      - `./coding` requires `@arnilo/prism-extensions` (workflows).
      - `./web` and `./computer-use` take it as an optional peer (mcp).
      - Dependencies used by only one subpath become optional peers when Task 1 measured them as heavy: the `@office-open/*` set, `ajv` and `fast-xml-parser` (`./work`); `@mozilla/readability`, `linkedom` and `turndown` (`./web`); `diff` (`./coding`). They stay required when they are light.
      - The existing optional peers (`playwright-core`, `e2b`, `@firecrawl/anydoc`, `mammoth`, `pdf-parse`) keep their missing-peer behaviour.
      - The note records the decision per dependency, with sizes.
    - Functional: Package skills (`web-research`, `coding`, `browser-automation`, `delegating-work` per plan 215 Task 11) still load from `<subfolder>/skills`. `package_skills_conform` and the `requiresTools` gate pass. `bun scripts/skill-evals/run.mjs --offline` passes.
    - Functional: Former names retired; `arnilo__prism-tools.txt` baseline created and the per-package files removed (the 0.12-era `coding-tools`, `web-tools`, `work-tools`, `openapi-tools` files stay); diff attributed; every caller updated (`apps/prism-agent` coding and research workers, `packages/knowledge/rag` optional web peer, `scripts/e2e-*`, `scripts/document-ingestion-packed.test.mjs`, `scripts/fixtures/*`, `.github/workflows/{coding-journey,sandbox-browser}.yml`, examples, docs).
    - Functional: If Task 1 (b) found that package names reach the prompt, the reference host's default coding worker prefix is re-pinned (`prefix-stability-conformance`), with the before/after bytes attributed to the rename alone, and the cache-parity fixtures are updated.
    - Performance: Importing `@arnilo/prism-tools/web` loads no office, Playwright or E2B module (spawned-process module check). The `bun add @arnilo/prism-tools` install footprint (packed and on disk, without optional peers) is recorded against a new budget row.
    - Code Quality: No subpath imports another tools subpath except through self-reference, and only where it did as a package before.
    - Security: Tool `effects`, the coding sandbox and approval tests, and the web domain policy tests pass unchanged. The `--ignore-scripts` install of the tarball succeeds (no postinstall needed for `work/vendor`).
  - Approach:
    - Documentation Reviewed:
      - Task 1 dependency table; `packages/tools/*/package.json`; `scripts/package-skills-conformance.mjs`; `scripts/document-ingestion-packed.test.mjs`
    - Options Considered:
      - **Keep `tools-work` as its own npm package because of its dependency weight.** Rejected for now: it would make eight names. Optional peers address the weight, and the note records the footprint so the owner can revisit it.
    - Chosen Approach:
      - Same pattern as Tasks 4–5, with a dependency decision recorded per dependency.
    - API Notes and Examples:
      ```ts
      import coding from "@arnilo/prism-tools/coding";
      import { readDocument } from "@arnilo/prism-tools/work/document-reader";
      ```
    - Files to Create/Edit:
      - `packages/tools/{package.json,README.md,CHANGELOG.md,LICENSE,tsconfig.json}`, `packages/tools/*/package.json` (deleted), `packages/tools/*/src/index.ts`, `packages/tools/*/README.md`
      - callers listed above; `scripts/bundles.json`, `scripts/retired-names.json`, `scripts/compat-baseline/*`, `scripts/budgets.json`, `scripts/coverage-thresholds.json`, `bun.lock`, root `package.json`
      - `docs/index.md`, `docs/tools.md`, `docs/coding-security.md` (install lines; tentative per grep), `docs/migrate-to-0.13.md`, `CHANGELOG.md`; host-builder indexes and skill text
    - References:
      - plan 215 Tasks 7–11 (package skills), Task 24 (parity fixtures)
  - Test Cases to Write:
    - `tools_web_import_loads_no_office_or_playwright`.
    - `tools_work_missing_optional_peer_reports_status_note`, for each dependency moved to an optional peer.
    - `packed_tools_tarball_installs_with_ignore_scripts`.
    - Plus the existing tool suites and `package_skills_conform`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Install names, import paths, and dependencies that become optional peers.
    - Docs pages to create/edit: `packages/tools/README.md` (new, with the footprint table), the seven subpath READMEs, `docs/index.md`, `docs/peer-dependencies.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: The hosts bundle (`@arnilo/prism-hosts`)
  - Acceptance Criteria:
    - Functional: `git mv packages/drivers/process packages/hosts/driver-process`, and `packages/drivers` is removed.
    - Functional: `packages/hosts/package.json` is `@arnilo/prism-hosts` 0.13.0:
      - `exports` has every subpath in the map, including `./ag-ui/renderer`, `./channels/{telegram,signal}`, `./remote/testing` and `./driver-process/testing`.
      - `bin` has `prism-devtools` and `prism-host-builder`, pointing into their subfolders.
      - `files` includes `host-builder/{bin,data,skills}` and `devtools/bin`.
      - Host libraries keep their library exports, and any `definePackage` they export is named by its specifier.
    - Functional: **Lockstep.** `scripts/bundles.json` marks `hosts` as `lockstep`, and `scripts/independent-packages.json` leaves it out (plan 215 Task 14's reason, now per bundle).
    - Functional: The host-builder kit is regenerated: `bun scripts/host-builder-index.mjs` and the skill text name bundle specifiers, its installer writes specifier entries, and `host_builder_kit_matches_surface`, `bun scripts/host-builder-index.mjs --check` and `bun scripts/host-builder-evals/run.mjs --offline` pass. The hidden eval solutions and workspaces under `scripts/host-builder-evals/` import the new specifiers.
    - Functional: Former names are retired, and the 0.12-era `ag-ui`, `channels`, `evals`, `acp-agent` and `mcp` baselines stay for the ledger. `arnilo__prism-hosts.txt` is created, and the diff is attributed. Every caller is updated: `apps/prism-agent`, `scripts/mcp-client-smoke.mjs`, examples, docs.
    - Performance: Importing `@arnilo/prism-hosts/headless` loads neither the ACP SDK, `@ag-ui/core` nor the MCP server SDK (spawned-process module check). Dependencies used by one subpath (`@agentclientprotocol/sdk`, `@ag-ui/core`, `@modelcontextprotocol/server`, `zod`) follow Task 5's rule for required versus optional peer, and the note records each decision.
    - Code Quality: Host libraries still import only the public `@arnilo/prism` API and published bundle subpaths (`references/prism.md` §4 "Host library").
    - Security: `driver-process` sandbox and bounded-child tests, remote auth tests and channel token-literal tests (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`) pass unchanged. A bin of the bundle runs without a postinstall.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/*/package.json`, `packages/drivers/process/package.json`, plan 215 Tasks 14–19 (kit, installer), `scripts/host-builder-evals/*`
    - Options Considered:
      - **Keep `host-builder` as its own npm package so `hosts` could version independently.** Rejected: it would make eight names, and the host libraries release with the kernel in practice.
    - Chosen Approach:
      - One lockstep hosts bundle, with the kit regenerated in the same task.
    - API Notes and Examples:
      ```ts
      import { serveAcp } from "@arnilo/prism-hosts/acp";
      ```
      ```sh
      bunx --package @arnilo/prism-hosts prism-host-builder install
      ```
    - Files to Create/Edit:
      - `packages/hosts/**`, `packages/hosts/driver-process/**` (moved), bundle files (new), per-package manifests (deleted)
      - `scripts/host-builder-index.mjs`, `scripts/host-builder-evals/**`, `scripts/bundles.json`, `scripts/independent-packages.json`, `scripts/retired-names.json`, `scripts/compat-baseline/*`, `scripts/budgets.json`, `scripts/coverage-thresholds.json`, `bun.lock`, root `package.json`
      - `docs/index.md`, `docs/drivers.md`, `docs/agent-adapters.md`, `docs/host.md` (install lines; tentative per grep), `docs/migrate-to-0.13.md`, the subpath READMEs, `CHANGELOG.md`
    - References:
      - plan 215 Tasks 13–20
  - Test Cases to Write:
    - `hosts_headless_import_loads_no_protocol_sdk`.
    - `hosts_bundle_bins_resolve_from_packed_tarball`.
    - `independent_packages_exclude_lockstep_bundles`.
    - Plus the existing host-library suites, the kit drift gate and offline builder evals.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Install names, import paths, and the bin package.
    - Docs pages to create/edit: `packages/hosts/README.md` (new), the subpath READMEs, the host-builder skill text, `docs/index.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: The experimental bundles (`@arnilo/prism-memory-system`, `@arnilo/prism-knowledge`)
  - Acceptance Criteria:
    - Functional: `packages/memory/package.json` is `@arnilo/prism-memory-system` `0.13.0-experimental.0`:
      - `.` → `./system/src/index.ts`, plus `./core`, `./core/fabric`, `./core/postgres`, `./core/sqlite`;
      - `files` excludes fixtures and build output as the two former manifests did;
      - the memory system's definition stays named `@arnilo/prism-memory-system`, its specifier, so that name does not change.
    - Functional: `packages/knowledge/package.json` is `@arnilo/prism-knowledge` `0.13.0-experimental.0` with `./wiki` and `./rag`:
      - it pins `@arnilo/prism-memory-system` exactly;
      - it takes `@arnilo/prism-tools` as an optional peer;
      - the definitions are named `@arnilo/prism-knowledge/wiki` and `@arnilo/prism-knowledge/rag`.
    - Functional: `scripts/independent-packages.json` `experimental` lists exactly the two bundles. `bun scripts/release.mjs pack` packs them at `0.13.0-experimental.0`, and `publishArgs` gives them `--tag experimental`. `stable_packages_never_depend_on_experimental` passes with bundles as the unit: no stable bundle depends on either experimental bundle, required or optional.
    - Functional: The reference host's `memory` opt-in and the memory-bench scripts (`scripts/memory-bench/**`) import the new specifiers. The memory-bench product hashes Task 1 (c) named are updated. The plan 202 cache-stability pin is re-attested with byte-identical provider requests (plan 216 Task 8 commands), and the note records the result.
    - Functional: Plans 217–223 carry the header amendment line from Task 2. No task body is rewritten. The memory track's `docs/_evidence/` records are not edited.
    - Functional: Former names are retired: `@arnilo/prism-memory-core`, `@arnilo/prism-wiki`, `@arnilo/prism-rag`. `@arnilo/prism-memory-system` is not retired, because it is the bundle. The 0.12-era `wiki` and `rag` baselines stay for the ledger. Bundle baselines are created, and the experimental classification keeps their diffs non-failing (plan 215 Task 2).
    - Performance: Importing `@arnilo/prism-knowledge/wiki` does not load `./rag`'s web ingestion unless configured (existing behaviour, now checked by a spawned-process module check).
    - Code Quality: No stable package gains a memory import. The reference host's default agents still load no experimental bundle (plan 215 Task 3 test).
    - Security: Memory deletion, redaction and the wiki's read-only `memory.ltm` port tests pass unchanged.
  - Approach:
    - Documentation Reviewed:
      - plan 216 Tasks 1–8 (names, moves, pin re-attestation); `scripts/memory-bench/audit/readiness.mjs:438`; `scripts/memory-bench/replay.mjs:1137`; plan 215 Tasks 2–3
    - Options Considered:
      - **One experimental bundle.** Rejected by the owner: the wiki is knowledge outside memory.
      - **Reuse `@arnilo/prism-memory`.** Rejected by the owner: fresh names.
    - Chosen Approach:
      - Two experimental bundles, with the memory system's own name kept as the bundle name.
    - API Notes and Examples:
      ```sh
      bun add @arnilo/prism-memory-system@experimental @arnilo/prism-knowledge@experimental
      ```
      ```ts
      import memory from "@arnilo/prism-memory-system";
      import wiki from "@arnilo/prism-knowledge/wiki";
      ```
    - Files to Create/Edit:
      - `packages/memory/{package.json,README.md,CHANGELOG.md,LICENSE,tsconfig.json}`, `packages/knowledge/{…}` (new); per-package manifests (deleted)
      - `apps/prism-agent/src/host/*` (memory opt-in, ontology), `scripts/memory-bench/**`, `scripts/independent-packages.json`, `scripts/bundles.json`, `scripts/retired-names.json`, `scripts/compat-baseline/*`, `scripts/budgets.json`, `bun.lock`, root `package.json`
      - `docs/_evidence/memory-bench/202/cache-stability/{equivalence,record}.json`, `README.md` (re-attestation)
      - `docs/index.md`, `docs/migrate-to-0.13.md`, the four subpath READMEs, `PRODUCT.md` (install line, if not already in Task 2), `CHANGELOG.md`
    - References:
      - memory model decision 2026-11-08; plan 216 Task 8
  - Test Cases to Write:
    - `experimental_bundles_are_exactly_memory_system_and_knowledge`.
    - `knowledge_pins_memory_system_exactly`.
    - `stable_packages_never_depend_on_experimental` (existing, now per bundle).
    - Plus the existing memory and wiki suites under `bun run --filter @arnilo/prism-memory-system --filter @arnilo/prism-knowledge test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Experimental install names and import paths.
    - Docs pages to create/edit: `packages/memory/README.md`, `packages/knowledge/README.md` (new bundle pages carrying the experimental notice), the subpath READMEs, `docs/index.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Whole-tree proof and the seven-name release pipeline
  - Acceptance Criteria:
    - Functional: `packages/` holds exactly the six bundle directories. Root `workspaces` is `["packages/*", "apps/*"]`. `loadRelease` returns seven units, and `bun scripts/package-truth.mjs --emit-docs` regenerates the counts line (seven publishable manifests).
    - Functional: **Sweep.**
      - `bun scripts/retired-names.mjs --generate` followed by `bun test scripts/retired-names.test.mjs` is green: none of the 50 former names appears in `src/ packages/ apps/ scripts/ examples/ docs/` outside the sweep's exclusions.
      - `git grep` for `@arnilo/prism-(provider|tools|store|memory-core)-` in live paths returns only retirement sentences.
    - Functional: **Packed consumers.** `scripts/fixtures/packed-consumer.mjs`, or a new `scripts/bundles-packed.test.mjs`:
      - installs each of the seven tarballs into a temp project with `--ignore-scripts`;
      - imports one `kind: "package"` subpath per bundle and runs it on the mock provider through `createAgent`;
      - runs `prism add <bundle>/<subpath>` against the packed tarball (`file:`) for one stable and one experimental bundle;
      - checks that the manifest entry name is the specifier.
    - Functional: **Release pipeline at seven names.**
      - `scripts/registry-cleanup.mjs --trusted-publishers` prints the seven names and marks the six never published.
      - `docs/release.md`'s owner checklist and bootstrap paragraph name six first publishes instead of 51.
      - `scripts/post-publish-smoke.mjs` installs `@arnilo/prism@0.13.0` with one stable bundle subpath, and `@arnilo/prism-memory-system@experimental` for the experimental leg (plan 215 Task 39 inputs 2–3).
      - `.github/workflows/release.yml` filters and the `publish` dependency order follow `scripts/bundles.json`: kernel, extensions, model-providers, tools, hosts, memory-system, knowledge.
      - `scripts/registry-deprecate.mjs --generate && --dry-run` reports nothing to apply for the 50 former names, since they were never published at 0.13.
    - Functional: `scripts/deprecations-0.13.json` and `docs/migrate-to-0.13.md` map each 0.12 name to its bundle specifier. The ledger keeps the retired 0.12 names, as plan 215 Task 37's note requires.
    - Functional: `bun scripts/release.mjs gate` exits 0 after any baseline or budget update this task makes, with the diff attributed.
    - Performance: The note records each tarball's packed and unpacked size, and the on-disk install footprint per bundle without optional peers, against the budget rows Tasks 4–8 added. Release pack time is recorded and does not regress against plan 215 Task 38's run by more than the budget tolerance.
    - Code Quality: One bundle map (`scripts/bundles.json`). No script keeps a hand-written list of former names. `workflow-liveness` CI-integrity checks pass.
    - Security: `workflows_reference_no_npm_token` still passes. `--ignore-scripts` installs of every tarball succeed. Attestation and `SHA256SUMS` steps cover seven tarballs.
  - Approach:
    - Documentation Reviewed:
      - plan 215 Task 38 note (owner checklist, bootstrap), Task 39 inputs; `scripts/post-publish-smoke.mjs`; `scripts/registry-cleanup.mjs`; `.github/workflows/release.yml`; `docs/release.md`
    - Options Considered:
      - **Fold the pipeline edits into Task 10.** Rejected: Task 10 is owner-gated and must start from a green tree with a dry run already proven.
    - Chosen Approach:
      - A whole-tree proof plus pipeline edits, ending in a dry run of the seven-tarball release.
    - API Notes and Examples:
      ```sh
      timeout 900 bun scripts/release.mjs pack --destination release-artifacts   # seven tarballs
      timeout 60 bun scripts/registry-cleanup.mjs --trusted-publishers
      ```
    - Files to Create/Edit:
      - `scripts/bundles-packed.test.mjs` (new) or `scripts/fixtures/packed-consumer.mjs`
      - `scripts/registry-cleanup.mjs` and its test, `scripts/post-publish-smoke.mjs`, `scripts/registry-deprecate.mjs` (tentative: only if its `--generate` reads workspace names), `scripts/deprecations-0.13.json`
      - `.github/workflows/release.yml`, `scripts/workflow-liveness.test.mjs`, `src/__tests__/release.test.ts`, `scripts/release-gate.test.mjs`
      - `docs/release.md`, `docs/migrate-to-0.13.md`, `docs/index.md` (package-truth line), `README.md` (quickstart install lines), `CHANGELOG.md`
    - References:
      - plan 215 Tasks 36–38
  - Test Cases to Write:
    - `seven_release_units`.
    - `every_bundle_installs_and_runs_from_its_tarball`.
    - `prism_add_subpath_from_packed_bundle`.
    - `trusted_publishers_lists_seven_names`.
    - `post_publish_smoke_specs_follow_bundle_map`.
    - `release_publish_order_follows_bundle_dependencies`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. The published package set.
    - Docs pages to create/edit: `docs/release.md`, `docs/migrate-to-0.13.md`, `README.md`, `docs/index.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes (package-truth line, generated)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Publish 0.13.0, apply the deprecations, switch to per-bundle versioning, and record Phase 11 Done (owner-gated) (was plan 215 Task 39, was plan 187 Task 2)
  - Acceptance Criteria:
    - Prerequisites carried from plan 215 Task 39, unchanged unless a bundle name or count changes:
      - plans 176 and 177 complete (satisfied);
      - Task 36's tag path: any `v*` tag takes the lockstep branch, pinned by `release_publish_path_for_v0_13_0`;
      - plan 208 Task 8 landed;
      - the live amendments of 2026-11-09 from plan 215 Task 34:
        - Hyper, Kilo and OpenCode Go need credit or quota;
        - the scoped-out rows are provided or carried with the recorded owner scope;
        - the Ollama Cloud cache-parity `behind` verdict has the owner's decision before the run.
    - Functional: **Pre-flight**, on a clean tree at the release commit:
      - `bun run sdk:ready` exits 0.
      - `PRISM_TEST_POSTGRES_URL=… bun run release:gate` exits 0.
      - `bun scripts/release.mjs pack --destination release-artifacts` packs the **seven** units, and the note records the list.
      - `bun scripts/registry-deprecate.mjs --generate && --dry-run` prints the planned deprecations.
      - `plans/README.md` shows:
        - plans 176–183, 188–207, 213 and 214 `complete` or `closed`;
        - plans 184–187, 211 and 212 `superseded by 215`;
        - plan 215 `closed at Task 38`;
        - plans 209–210 and 216–223 on the memory track;
        - Tasks 1–9 of this plan checked.
      - The two experimental bundles pack at `0.13.0-experimental.0` with `--tag experimental` (dry run output recorded).
      - `bun scripts/live-preflight.mjs --suite providers/ --probe` and `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe` pass.
      - Then the strict runs of `providers/`, `release/journey-` and `release/cache-parity` pass on the release commit, and `docs/_evidence/live-release-acceptance-0.13.0.md` records them. With Command Code and Ollama Cloud now shipping, their rows are recorded too; whether they gate is the owner's call, recorded in the note. The owner signs the evidence file in this task's note.

      **The executor stops here and asks the owner to confirm** pushing the `v0.13.0` tag.
    - Functional: **Bootstrap (plan 215 Task 38 finding 4)**, after confirmation and before the tag push:
      - the owner publishes the **six** never-published bundle names locally with 2FA from the CI-packed tarballs, after checking `SHA256SUMS`;
      - then the owner configures each trusted publisher (`release.yml`, environment `npm-publish`, `npm publish` and `npm dist-tag`) and "Require two-factor authentication and disallow tokens";
      - the trusted publisher for `@arnilo/prism` is created close to the publish, because of its 2-day expiry;
      - the `NPM_TOKEN` secret is deleted and the token revoked, if not done already;
      - the note records which versions carry the GitHub attestation without an npm provenance statement.
    - Functional: The tag push runs `.github/workflows/release.yml`: verify, the Postgres, office, CodeQL and supply-chain gates, pack, attest, then the OIDC publish in bundle dependency order after the owner approves `npm-publish`. Units the bootstrap already published are skipped by `--resume`. The note records the run URL and every name's dist-tags from an anonymous registry `GET`, including whether `latest` also points at an experimental prerelease because no stable version exists. `bun scripts/post-publish-smoke.mjs --version 0.13.0` passes against the registry, experimental leg included. A stable install without the tag resolves no experimental bundle.
    - Functional: **The executor stops again and asks the owner to confirm** the remaining deprecations: the names plan 215 Task 37 left in `scripts/deprecations-0.13.json`, and its finding 2, whether `@arnilo/prism@<0.13.0` gets a `reused` entry. The owner runs the commands `bun scripts/registry-deprecate.mjs --dry-run` prints, locally with 2FA. The note records each `deprecated` field (anonymous `GET`), and `--dry-run` reports nothing left. If nothing is left, the note says so.
    - Functional: **Per-bundle versioning.**
      - `scripts/independent-packages.json` lists `@arnilo/prism-model-providers`, `@arnilo/prism-tools` and `@arnilo/prism-extensions` as independent.
      - `@arnilo/prism-hosts` stays on the kernel line.
      - `experimental` keeps the two experimental bundles until they graduate (plan 223).
      - The `$comment` records the Phase 11 cut.
      - `release.test.ts` and `release-gate.test.mjs` pin the shape.
    - Functional: **The Phase 11 Done record** in this task's Notes lists each Done criterion with its proof:
      - `@arnilo/prism` 0.13.0 and the bundles are published, including the subpaths the roadmap names: `driver-kit` (kernel subpath), `@arnilo/prism-hosts/driver-process`, `@arnilo/prism-extensions/workflows`, `serveTools` in `@arnilo/prism-hosts/mcp-server`, `@arnilo/prism-hosts/remote`, `@arnilo/prism-hosts/headless`, and `@arnilo/prism-tools/research`; registry versions recorded.
      - A new reader builds an agent from `README.md` alone (`readme_quickstart_runs_on_mock_provider` plus the smoke).
      - `release:gate` is green.
      - The experimental bundles are published with their dist-tags recorded, and graduation is assigned to plan 223.
    - Functional: `plans/README.md` marks plans 174 and 175 complete and this plan complete. After the registry `GET`s succeed, the roadmap's "Shipped baseline" line flips to 0.13.0.
    - Functional: **Plan end for plans 215 and 224** (SKILL.md, "Plan end"): fill `Compromises Made` and `Further Actions` in both plans, including plan 215's existing `HostUi.kinds` item, and hand both off to `plans/backlog.md`.
    - Performance: Record the publish wall time and each tarball's size against its budget row.
    - Code Quality: No manual publish except the six-name bootstrap. Every later publish is the attested OIDC CI path.
    - Security: No long-lived npm token. `workflows_reference_no_npm_token` passes on the release commit. `gh attestation verify` passes for `@arnilo/prism`. Published tarball bytes match `SHA256SUMS`.
  - Approach:
    - Documentation Reviewed:
      - plan 215 Task 39 (criteria carried), Task 38 note (bootstrap, owner checklist), Task 37 findings; roadmap Phase 11 Done and Part 3; `docs/release.md`; `.github/workflows/release.yml`; `scripts/post-publish-smoke.mjs`; `scripts/release.mjs` (`runRelease`, `--resume`)
    - Options Considered:
      - **Publish and deprecate in one unattended step.** Rejected: both are one-way registry operations, and the owner confirms each (system rule for outward-facing actions).
      - **Deprecate before publishing.** Rejected: names reused from 0.12 need 0.13.0 published first (plan 175 Task 8 fails closed on this).
    - Chosen Approach:
      - Pre-flight, then confirmation, bootstrap, tag, publish and smoke; then a second confirmation for the deprecations; then the versioning switch, the Done record and plan end.
    - API Notes and Examples:
      ```bash
      git tag v0.13.0 && git push origin v0.13.0        # after owner confirmation only
      gh run watch
      bun scripts/post-publish-smoke.mjs --version 0.13.0
      bun scripts/registry-deprecate.mjs --dry-run       # prints the npm deprecate commands; the owner runs them with 2FA
      ```
    - Files to Create/Edit:
      - `scripts/independent-packages.json`, `src/__tests__/release.test.ts`, `scripts/release-gate.test.mjs`
      - `docs/_evidence/live-release-acceptance-0.13.0.md`, `roadmap.md` (Shipped baseline), `CHANGELOG.md` (publish date on `## [0.13.0]`)
      - `plans/README.md`, this plan and plan 215 (Done record, plan end), `plans/backlog.md`
    - References:
      - plan 215 Tasks 37–39; plan 164 Task 8.4; plan 140 Task 6
  - Test Cases to Write:
    - `independent_packages_after_0_13`: every bundle except the kernel and `@arnilo/prism-hosts` is listed, and `experimental` is a subset. It fails when a bundle is added without a versioning decision.
    - The post-publish smoke (existing script, run against the registry).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. The release itself.
    - Docs pages to create/edit: `CHANGELOG.md` (publish date), `roadmap.md` (Shipped baseline)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 300 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun test --timeout=0 src/__tests__/manifest-install.test.ts src/__tests__/manifest-load.test.ts src/__tests__/manifest-integrity.test.ts src/__tests__/manifest-format.test.ts src/__tests__/manifest-maintain.test.ts src/__tests__/cli-manifest.test.ts src/__tests__/package-loader.test.ts src/__tests__/packaging.test.ts src/__tests__/experimental-boundary.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/release.test.ts src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/bundles.test.mjs scripts/bundles-packed.test.mjs scripts/retired-names.test.mjs scripts/import-hygiene.test.mjs scripts/package-truth.test.mjs scripts/release-gate.test.mjs scripts/registry-cleanup.test.mjs scripts/registry-deprecate.test.mjs scripts/workflow-liveness.test.mjs scripts/host-builder-index.test.mjs`
- `timeout 900 bun run --filter @arnilo/prism-model-providers --filter @arnilo/prism-tools --filter @arnilo/prism-extensions --filter @arnilo/prism-hosts --filter @arnilo/prism-memory-system --filter @arnilo/prism-knowledge --filter @arnilo/prism-agent test`
- `timeout 300 bun scripts/package-skills-conformance.mjs --json` and `timeout 120 bun scripts/host-builder-index.mjs --check`
- `timeout 300 bun scripts/skill-evals/run.mjs --offline` and `timeout 600 bun scripts/host-builder-evals/run.mjs --offline`
- `timeout 1800 bun run test`
- `timeout 1800 bun scripts/release.mjs gate` (with `--update-baseline` only inside the tasks that name it)
- `timeout 900 bun scripts/release.mjs pack --destination release-artifacts` (seven tarballs)
- Owner-run live legs and the publish, in Task 10's order; after publish, `bun scripts/post-publish-smoke.mjs --version 0.13.0` and `bun scripts/registry-deprecate.mjs --dry-run`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
