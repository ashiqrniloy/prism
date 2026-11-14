# Phase 19 Part N — runtime portability: Node.js support with a built distribution

## Objectives

- Let a Node.js host use Prism. Today the kernel and every bundle publish TypeScript source that only Bun can run from `node_modules`:
  - every `exports` entry points at a `.ts` file (`package.json`: `".": "./src/index.ts"`; the same in each `packages/*/package.json`)
  - `engines` names Bun only (`package.json:77-79`), and the `prism` bin starts with `#!/usr/bin/env bun` (`src/cli.ts:1`)
  - a few subpaths import Bun modules directly: `@arnilo/prism-extensions/store-sqlite` (`bun:sqlite`), `hooks-json`, `@arnilo/prism-hosts/devtools`, and one kernel testing helper (`src/testing/provider-live-scenarios.ts`)
- The 2026-11-13 evaluation listed "Bun only, published as raw TypeScript" as an architectural limit on adoption.

**This plan reverses a standing rule and must not start without the owner's confirmation in Task 2.** `roadmap.md` §1.4 says "Bun-native … Node.js is not a target", and "Out of scope" lists "Node.js as a supported runtime". The owner's instruction of 2026-11-13 was to plan every evaluation finding except first-party providers; this plan is that coverage for the runtime finding. Task 1 measures the cost, Task 2 puts the decision to the owner with the numbers, and Tasks 3–6 run only on a yes. On a no, the plan is closed at Task 2 and the finding is recorded as a deliberate product position.

## Expected Outcome

- `@arnilo/prism` and the four stable bundles load on Node.js 22 LTS and later through compiled JavaScript with declaration files. Bun keeps resolving the TypeScript source through a `bun` export condition, with no build step, exactly as today.
- A published support table says, per subpath, whether it runs on Bun, on Node, or on Bun only, and why.
- CI runs a Node leg: the kernel's runtime-neutral conformance kits and a smoke agent on the mock provider.
- `prism add` and the manifest loader work under Node with npm.

This plan implements roadmap **Phase 19 Part N**, which Task 2 writes (plan 225 Task 2 deliberately leaves it out). It changes the published package shape, so **Task 1 is the phase review**. It is the last plan of Phase 19 and depends on none of plans 226–237 in code, but runs after them so the surface it compiles is settled. The experimental memory and knowledge bundles are outside this plan: the memory track decides their Node support when they graduate. No version bump or publish; the first release that carries the built distribution is cut by a later release plan.

Cost knobs: none at run time. The cost is in the pipeline: a compile step at pack time, larger tarballs (source plus `dist`), and a second CI leg. Task 1 measures all three.

## Tasks

- [ ] Task 1: Phase review and cost measurement (read-only, plus one throwaway spike)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Every Bun-only dependency** in `src/` and the four stable bundles: `bun:*` imports, `Bun.*` globals, `import.meta.dir` and other Bun-only `import.meta` fields, JSON imports with attributes, reliance on running `.ts` from `node_modules`, `bun:test` in anything exported from `@arnilo/prism/testing`, and child-process or file APIs that differ. Grouped by subpath, with the Node equivalent or "none".
      - (b) **Every gate that asserts the current shape**: "ships TypeScript source and no `dist/`" (`src/__tests__/public-export-contract.test.ts`, `packaging.test.ts`), the tarball deny list and kernel size budget (`scripts/release.mjs gate`, `docs/release.md` "The kernel size budget"), `docs.test.ts` freeze pins on `PRODUCT.md`, `scripts/package-truth.mjs`, the compat baseline's declaration emit into `.types/`, and `scripts/bundles.json`'s export map.
      - (c) **The installer.** How `prism add` installs and hashes a package (`src/manifest/install.ts`, `integrity.ts`), which package manager it shells out to, and how `importDefinition` loads a subpath (`src/manifest/definition.ts:138`).
      - (d) **Import resolution on Node**: the minimum Node version that supports everything in (a) without flags (import attributes, `node:sqlite`, `AbortSignal.any`, web streams, `fetch` with streaming bodies), read through the find-docs skill; and whether Node will strip types for files under `node_modules` (if not, a compiled build is required).
      - (e) **A spike**, in the scratch directory and not committed: `tsc` emit of the kernel to JavaScript, one `createAgent` run on the mock provider under Node, and the list of what failed.
    - Performance: Measured and recorded: compile time for the kernel and each bundle, tarball size before and after, and the added CI minutes.
    - Code Quality: The note ends with a per-subpath table: runs on Node as is, runs with an adapter (named), or stays Bun-only (reason).
    - Security: Records that provenance and trusted publishing cover the compiled files (they are built in the release workflow from the tagged source), and whether `prism verify` must hash `dist`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4 ("Bun-native"), §2.6–2.7 (packages, manifest), "Out of scope"; `PRODUCT.md` ("What Prism is", "A package is one module specifier … that Bun runs as-is")
      - `docs/release.md`, `docs/packages.md`, `docs/manifest.md`
      - `bunfig.toml`, `tsconfig.json`, `tsconfig.packages.json`, `scripts/with-build-lock.mjs`
    - Options Considered:
      - Decide without measuring — rejected: the owner's decision in Task 2 needs the cost.
    - Chosen Approach:
      - Inventory, a throwaway spike, and a cost table.
    - API Notes and Examples:
      ```bash
      graft grep "bun:"
      graft grep "Bun."
      npx ctx7@latest library "Node.js" "type stripping node_modules, import attributes, node:sqlite"
      ```
    - Files to Create/Edit:
      - `plans/238-…md`: the task note (the spike lives in a scratch directory and is deleted)
    - References:
      - Evaluation: "Bun only, published as raw TypeScript"
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Owner decision, then the roadmap and product amendment (docs only, owner-gated)
  - Acceptance Criteria:
    - Functional:
      - The owner is shown Task 1's table and costs and answers yes or no. The answer and its date are recorded in this task's note.
      - **On no:** Tasks 3–6 are marked `Dropped by plan 238 (<date>): owner keeps Prism Bun-only`, `plans/README.md` shows `closed at Task 2`, and `docs/compatibility.md` gains one sentence stating the position. Nothing else changes.
      - **On yes:**
        - `roadmap.md` §1.4's "Bun-native" rule is rewritten: Bun runs the published TypeScript source with no build step; Node.js 22 LTS and later is supported through a compiled distribution built at release.
        - "Out of scope" loses "Node.js as a supported runtime" and gains what stays out: Deno, edge runtimes, browsers, CommonJS consumers.
        - Phase 19 gains Part N, with its Done criteria.
        - `PRODUCT.md`'s opening and its package definition are updated to match, and the `docs.test.ts` pins on those sentences are updated deliberately in the same task.
        - `.agents/skills/create-plan/references/prism.md` §5 ("ships TypeScript source with no `dist/`") and `prism-execution/references/release.md` are corrected.
    - Performance: n/a — docs only.
    - Code Quality: The amendment states one rule; no "Bun-first, Node-maybe" wording.
    - Security: n/a — docs only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, "Out of scope"; `PRODUCT.md`; `src/__tests__/docs.test.ts` (the pins); plan 224 Task 2 (the last product amendment)
    - Options Considered:
      - Amend the roadmap in plan 225 Task 2 with the other parts — rejected: this part reverses a rule and needs its own recorded decision.
    - Chosen Approach:
      - A gate with a recorded answer, then either a close-out or the amendment.
    - API Notes and Examples:
      ```markdown
      - **Bun-native, Node-supported.** Bun runs the published TypeScript source directly. Node.js 22 LTS and later runs the compiled distribution in the same package.
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `PRODUCT.md`, `src/__tests__/docs.test.ts`
      - `.agents/skills/create-plan/references/prism.md`, `.agents/skills/prism-execution/references/release.md` (and their `.claude/skills` copies)
      - `plans/README.md`
      - `docs/compatibility.md` (on no)
    - References:
      - Task 1's table
  - Test Cases to Write:
    - none new; `bun test --timeout=0 src/__tests__/docs.test.ts` and `scripts/phase24-truth.test.mjs` pass with the updated pins
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes on a yes — the supported runtimes
    - Docs pages to create/edit:
      - `roadmap.md`, `PRODUCT.md` as above
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The kernel builds to JavaScript and loads on Node
  - Acceptance Criteria:
    - Functional:
      - `bun run build:dist` compiles `src/` to `dist/` (ES modules, declaration files, source maps off). `dist/` is git-ignored and built in `prepack`, so a tarball always carries it.
      - Each `exports` entry becomes conditional: `"bun"` → the `.ts` source, `"types"` → the declaration file, `"import"` / `"default"` → the compiled file. Bun's resolution is unchanged; `./manifest/schema.json` stays as is.
      - `engines` adds `node: ">=22"` (the exact floor from Task 1(d)).
      - The kernel has no Bun-only import outside a file that is only reachable under the `bun` condition; `src/testing/provider-live-scenarios.ts` is fixed or split accordingly.
      - `bin/prism` works under both runtimes: a small launcher picks the source under Bun and `dist/cli.js` under Node.
      - The "no `dist/`" assertions become "the tarball carries `src/` and a `dist/` built from it": `packaging.test.ts` compiles and compares.
      - The kernel still has no runtime dependencies.
    - Performance: Bun start-up and the kernel size budget are unchanged for the `src` tree; the budget gains a separate ceiling for `dist`. Compile time is recorded.
    - Code Quality: One `tsconfig.dist.json`; no hand-maintained second entry list — the export map is generated or checked from one table.
    - Security: The tarball deny list covers `dist` (no tests, no fixtures, no maps). Provenance is unchanged: the files are built in the release job from the tagged commit.
  - Approach:
    - Documentation Reviewed:
      - `package.json` (`exports`, `files`, `bin`, `scripts`), `tsconfig.json`, `scripts/release.mjs` (`pack`, `gate`), `docs/release.md` ("What a tarball contains")
      - Node package entry-point conditions and Bun's `bun` condition, through the find-docs skill
      - Task 1(a), (b), (d)
    - Options Considered:
      - Publish compiled JavaScript only — rejected: Bun hosts would lose source-level stack traces and the "no build step" property the product states.
      - A separate `@arnilo/prism-node` package — rejected: two names for one kernel, and every bundle would need a twin.
      - Rely on Node's type stripping — rejected if Task 1(d) confirms Node does not strip types under `node_modules`.
    - Chosen Approach:
      - One package, two export conditions.
    - API Notes and Examples:
      ```jsonc
      "exports": { ".": { "bun": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
      ```
    - Files to Create/Edit:
      - `package.json`, `tsconfig.dist.json` (new), `.gitignore`, `bin/prism` (new launcher) and `src/cli.ts`
      - `scripts/release.mjs`, `scripts/package-truth.mjs`, `scripts/emit-manifest-schema.mjs` (if paths change)
      - `src/__tests__/packaging.test.ts`, `public-export-contract.test.ts`, `install-smoke.test.ts`
      - `src/testing/provider-live-scenarios.ts`
      - `scripts/node-smoke.mjs`: new — runs under `node`, builds an agent on the mock provider, runs the runtime-neutral conformance kits
      - `.github/workflows/*.yml`: a Node leg
      - `scripts/compat-baseline/*.txt`: regenerated only if the declaration surface changes; the task note records "no change" or the diff
    - References:
      - `docs/release.md`
  - Test Cases to Write:
    - `packed_tarball_contains_src_and_matching_dist`.
    - `bun_resolves_the_typescript_source`: a packed install under Bun imports `src`.
    - `node_resolves_the_compiled_entry`: a packed install under Node imports `dist` and runs one mock turn (`scripts/node-smoke.mjs`, invoked from a test that skips with a manifest entry when `node` is absent).
    - `every_export_has_all_three_conditions`.
    - `kernel_has_no_unconditional_bun_import`: a static scan.
    - `prism_bin_runs_under_node`: `prism list` on an empty manifest.
    - `dist_passes_the_tarball_deny_list`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package shape and supported runtimes
    - Docs pages to create/edit:
      - `docs/release.md`: the build step, tarball contents, the Node CI leg
      - `docs/compatibility.md`: supported runtimes and versions
      - `README.md`: install with npm under Node
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The stable bundles build the same way, with a per-subpath support table
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-ai`, `@arnilo/prism-extensions`, `@arnilo/prism-tools`, and `@arnilo/prism-hosts` get the same conditional exports and `prepack` build for every subpath.
      - Each subpath Task 1 marked "adapter" works on Node:
        - `store-sqlite` selects `bun:sqlite` under Bun and `node:sqlite` under Node behind one internal interface, and passes store conformance on both
        - host libraries that return web handlers are unchanged; the README shows serving one with `node:http`
        - `hooks-json`, `devtools`, and any other subpath from Task 1(a) use a runtime-neutral API or a conditional file
      - A subpath Task 1 marked Bun-only throws a typed `UnsupportedRuntimeError` at import under Node, naming the subpath and the reason. It does not fail later with a missing module.
      - `scripts/bundles.json` gains a `runtimes` field per subpath, and the support table in `docs/compatibility.md` is generated from it.
      - Peer dependencies that are native (`pg`, `playwright-core`, `@napi-rs/keyring`) are documented per runtime.
    - Performance: No change under Bun. Compile time and tarball growth per bundle are recorded against Task 1's estimate.
    - Code Quality: Runtime selection is by export condition or one `runtime.ts` per subpath, never by scattered `typeof Bun` checks.
    - Security: The coding sandbox backends and the process tools are verified on Node or marked Bun-only; a sandbox that behaves differently is not silently enabled.
  - Approach:
    - Documentation Reviewed:
      - `packages/*/package.json`, `scripts/bundles.json`, `packages/extensions/store-sqlite/src/{bun-runtime.ts,bun-sqlite.d.ts,persistence.ts}`
      - `packages/hosts/devtools/src/`, `packages/extensions/hooks-json/src/`
      - Node's `node:sqlite` API at the pinned floor, through the find-docs skill
      - Task 1's table
    - Options Considered:
      - Support every subpath on Node — rejected where Task 1 shows a Bun-only dependency with no equivalent; an honest table is better than a partial port.
    - Chosen Approach:
      - Same packaging for all; adapters where cheap; a typed refusal elsewhere.
    - API Notes and Examples:
      ```jsonc
      { "path": "./store-sqlite", "dir": "store-sqlite", "kind": "package", "runtimes": ["bun", "node"] }
      ```
    - Files to Create/Edit:
      - `packages/{providers,extensions,tools,hosts}/package.json`, per-bundle `tsconfig.dist.json`
      - `scripts/bundles.json`, `scripts/bundles.test.mjs`, `scripts/bundles-packed.test.mjs`, `scripts/package-truth.mjs`
      - `packages/extensions/store-sqlite/src/…`, `hooks-json/src/…`, `packages/hosts/devtools/src/…`, others from Task 1(a)
      - `scripts/node-smoke.mjs`: one import per Node-supported subpath, plus store conformance on `node:sqlite`
      - `docs/compatibility.md`: the generated table
      - `scripts/compat-baseline/*.txt`: regenerated if declarations change, diff in the task note
    - References:
      - Task 3's export shape
  - Test Cases to Write:
    - `every_stable_subpath_has_conditional_exports`.
    - `node_imports_every_subpath_marked_node`.
    - `bun_only_subpath_refuses_at_import_under_node`.
    - `store_sqlite_conformance_on_node_sqlite`.
    - `support_table_matches_bundles_json`.
    - `packed_bundles_carry_src_and_matching_dist`.
    - All four bundles' own suites pass under Bun unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package shape, a support table, one error class
    - Docs pages to create/edit:
      - `docs/compatibility.md`: the table
      - each affected subpath's `README.md`: a "Runtimes" line
      - `docs/peer-dependencies.md`: per-runtime notes
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: The manifest and `prism add` work under Node
  - Acceptance Criteria:
    - Functional:
      - `prism add`, `remove`, `verify`, and `loadManifest()` run under Node. The installer uses the package manager that matches the runtime (Bun under Bun; npm under Node), or the one `--pm` names.
      - Integrity hashing covers what the runtime will load: `src` under Bun, `dist` under Node. A manifest records which tree was hashed, and `verify` under the other runtime re-hashes that tree instead of reporting a mismatch.
      - `importDefinition` resolves a subpath through the package's export conditions, not through a hard-coded source path.
      - A project manifest written under one runtime loads under the other.
    - Performance: Hashing time is unchanged per tree; the task note records it for the largest bundle.
    - Code Quality: One "resolve the entry the runtime loads" function shared by hashing and import.
    - Security: The trust rules are unchanged: an untrusted project manifest still fails closed, a symlinked package is still refused, and an integrity mismatch still stops the load on either runtime.
  - Approach:
    - Documentation Reviewed:
      - `src/manifest/{install,integrity,definition,load,format}.ts`, `src/cli-manifest.ts`, `docs/manifest.md`
      - Task 1(c)
    - Options Considered:
      - Hash both trees always — rejected: it doubles install time for a tree the runtime never loads.
    - Chosen Approach:
      - Hash the tree in use and record which.
    - API Notes and Examples:
      ```bash
      node node_modules/.bin/prism add @arnilo/prism-tools/coding --project
      ```
    - Files to Create/Edit:
      - `src/manifest/{install,integrity,definition,format,load}.ts`, `src/cli-manifest.ts`
      - `manifest/schema.json` via `bun scripts/emit-manifest-schema.mjs` (the recorded tree field)
      - `src/__tests__/manifest-*.test.ts`, `scripts/install-idempotence.test.mjs`
      - `docs/manifest.md`
    - References:
      - `src/manifest/integrity.ts:178-345`
  - Test Cases to Write:
    - `prism_add_under_node_installs_and_records_dist_integrity`.
    - `manifest_written_under_bun_loads_under_node`.
    - `integrity_mismatch_still_fails_closed_on_node`.
    - `untrusted_project_manifest_still_fails_closed_on_node`.
    - `import_definition_follows_export_conditions`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI behavior and a manifest field
    - Docs pages to create/edit:
      - `docs/manifest.md`: the recorded tree, per-runtime install
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: A Node host example and the reader path
  - Acceptance Criteria:
    - Functional:
      - `examples/node-host/` holds a minimal Node project (its own `package.json`, plain `.mjs`): an agent on the mock provider with `@arnilo/prism-tools/coding` in read-only mode, served over `node:http` with the AG-UI handler.
      - A test packs the kernel and the bundles, installs them into a temporary copy of the example with npm, and runs it under Node to completion.
      - `README.md` gains a Node quick start beside the Bun one; `docs/index.md` links the example.
      - The host-builder indexes (`bun scripts/host-builder-index.mjs`) list the supported runtimes per subpath.
    - Performance: The packed-install test runs in the release gate, not in `bun run test`, and its time is recorded.
    - Code Quality: The example uses only documented public API and no TypeScript, so it proves the compiled path.
    - Security: The example passes the execution gate's secret scan.
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`, `scripts/e2e-coverage.json`, `scripts/post-publish-smoke.mjs` (packed-install pattern), `packages/hosts/ag-ui/README.md`
    - Options Considered:
      - Reuse a Bun example under Node — rejected: the examples are TypeScript run by Bun; a Node reader needs a Node project.
    - Chosen Approach:
      - One small Node project, proven from packed tarballs.
    - API Notes and Examples:
      ```js
      import { createAgent } from "@arnilo/prism";
      import { createAgUiHandler } from "@arnilo/prism-hosts/ag-ui";
      ```
    - Files to Create/Edit:
      - `examples/node-host/{package.json,server.mjs,README.md}`: new
      - `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/node-host-packed.test.mjs`: new; `scripts/run-all-tests.mjs` or the release gate list
      - `README.md`, `docs/index.md`
      - `packages/hosts/host-builder/data/` regenerated
    - References:
      - Task 3's `scripts/node-smoke.mjs`
  - Test Cases to Write:
    - `node_host_example_runs_from_packed_tarballs`.
    - `node_host_example_emits_no_secret`.
    - `host_builder_index_lists_runtimes`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; a new example and reader path
    - Docs pages to create/edit:
      - `README.md`: Node quick start
      - `examples/README.md`, `docs/index.md`: the example
      - `CHANGELOG.md`: `## [Unreleased]`, Documentation
    - `docs/index.md` update: yes — the example link
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run build:dist` (Task 3)
- `bun run typecheck`
- `bun run test`
- `node scripts/node-smoke.mjs`
- `bun test --timeout=0 scripts/node-host-packed.test.mjs`
- `bun run pack:dry-run`
- `bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
