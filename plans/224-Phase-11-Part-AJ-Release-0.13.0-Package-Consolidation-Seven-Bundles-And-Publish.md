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
- The 49 former workspace names are in `scripts/retired-names.json` (`@arnilo/prism-memory-system` stays as the bundle), and `no_retired_name_in_live_tree` is green.
- Compat baselines exist per bundle, with each line prefixed by its subpath. The per-package baseline files of the former names are deleted, and the diff is attributed to this plan.
- The trusted-publisher bootstrap that plan 215 Task 38 left to the owner covers **six** never-published names instead of 51.
- `@arnilo/prism` 0.13.0, the four stable bundles on `latest`, and the two experimental bundles on `experimental` are published; deprecations are confirmed; versioning is per bundle; and the Phase 11 Done record is written.

**Plan shape.** This plan is release step 17l. It replaces plan 215 Task 39, which moves here as Task 10 with its criteria intact except where the bundle map changes a name or a count. Plan 215 is closed at Task 38 (owner decision 2026-11-09). The plan **changes a kernel contract** (the package name rule in `definePackage`, the manifest schema, `prism add` / `prism remove`) **and moves every package**, so Task 1 is a read-only phase review. Task 2 amends the roadmap and `PRODUCT.md` before any code moves, because the roadmap currently defines a package as one npm package (`roadmap.md:444`). The version stays 0.13.0: nothing has been published at 0.13.0 for any of the former names (plan 215 Task 38 note, re-checked in Task 1: every one of the 50 former workspace names returns 404, so 50 of the 51 publishable names have no registry record; only `@arnilo/prism` is published), so no deprecation, redirect or registry cleanup is needed for them. `/docs` pages and package READMEs are edited in the task that changes them.

**Concurrency.** The memory track (plans 217–223) works on `main` in `packages/memory` and `packages/knowledge`. Tasks 4–8 rename imports and move directories across the whole tree, so each one lands as its own commit, and the owner pauses memory-track execution while Tasks 5–8 run, or the memory session rebases onto each commit. No task here changes memory behaviour. Plan 208 Task 8 and every precondition plan 215 Task 39 listed still apply to Task 10.

**Owner gates (outward-facing):** Task 10 only (the tag push, the six bootstrap first publishes, the trusted-publisher setup, the deprecation confirmation). Live work stays on the providers and scope plan 215 Task 34 recorded, never `openrouter/free` or `openrouter/auto`. Keys stay in `~/.config/prism/live.env`. Memory stays non-RAG: no task adds embeddings.

## The bundle map (owner decisions 2026-11-09)

Decisions: **seven** npm packages, with memory and knowledge kept apart because the wiki is knowledge outside memory (owner, 2026-11-08); the plumbing bundle is called `@arnilo/prism-extensions`; Command Code and Ollama Cloud **ship at 0.13.0** inside the providers bundle, which reverses the 2026-10-25 deferral; and the 0.12-era names `@arnilo/prism-providers` and `@arnilo/prism-memory` are **not reused**: the bundles take fresh names. `@arnilo/prism-ai` is the executor's proposed fresh name for the providers bundle, and Task 1 confirms it with the owner before Task 4 uses it.

| Bundle (npm name) | Directory | Line at 0.13.0 | Subpaths (former package → subpath) |
| --- | --- | --- | --- |
| `@arnilo/prism` | `.` | stable, `latest` | unchanged (kernel) |
| `@arnilo/prism-ai` | `packages/providers` | stable, `latest`, independent after 0.13.0 | `provider-commandcode` → `./commandcode`, `provider-hyper` → `./hyper`, `provider-kilo` → `./kilo`, `provider-laya` → `./laya`, `provider-liquid` → `./liquid`, `provider-litellm` → `./litellm`, `provider-ollama-cloud` → `./ollama-cloud`, `provider-openai-codex` → `./openai-codex`, `provider-opencode-go` → `./opencode-go`, `provider-openrouter` → `./openrouter`, `provider-typesafe` → `./typesafe` |
| `@arnilo/prism-tools` | `packages/tools` | stable, `latest`, independent | `tools-coding` → `./coding`, `tools-web` → `./web`, `tools-browser` → `./browser`, `tools-research` → `./research`, `tools-openapi` → `./openapi`, `tools-computer-use` → `./computer-use`, `tools-work` → `./work` plus its twelve subpaths as `./work/<subpath>` |
| `@arnilo/prism-extensions` | `packages/extensions` (new) | stable, `latest`, independent | `context-engineering` → `./context-engineering`, `context-files` → `./context-files`, `memory-compaction` → `./compaction`, `credentials-keyring` → `./keyring`, `advisor` → `./advisor`, `delegate` → `./delegate`, `hooks-json` → `./hooks-json`, `mcp` → `./mcp`, `observability` → `./observability`, `workflows` → `./workflows` (+ `./workflows/testing`), `approval` → `./approval`, `governance` → `./governance`, `guardrail-packs` → `./guardrail-packs`, `model-router` → `./model-router`, `store-codecs` → `./store-codecs`, `store-jsonl` → `./store-jsonl`, `store-sqlite` → `./store-sqlite`, `store-postgres` → `./store-postgres` |
| `@arnilo/prism-hosts` | `packages/hosts` | stable, `latest`, **lockstep with the kernel** (it carries the host-builder kit, whose indexes describe exactly one kernel version, plan 215 Task 14) | `acp` → `./acp`, `ag-ui` → `./ag-ui` (+ `./ag-ui/renderer`), `channels` → `./channels` (+ `./channels/telegram`, `./channels/signal`), `devtools` → `./devtools` (bin `prism-devtools`), `evals` → `./evals`, `headless` → `./headless`, `host-builder` → `./host-builder` (bin `prism-host-builder`), `mcp-server` → `./mcp-server`, `remote` → `./remote` (+ `./remote/testing`), `driver-process` → `./driver-process` (+ `./driver-process/testing`) |
| `@arnilo/prism-memory-system` | `packages/memory` | **experimental**, `0.13.0-experimental.N`, dist-tag `experimental` | `memory-system` → `.` (the root), `memory-core` → `./core` (+ `./core/fabric`, `./core/postgres`, `./core/sqlite`) |
| `@arnilo/prism-knowledge` | `packages/knowledge` | **experimental**, pins `@arnilo/prism-memory-system` exactly | `wiki` → `./wiki`, `rag` → `./rag` |

Former names are written without the `@arnilo/prism-` prefix above, so `tools-web` means `@arnilo/prism-tools-web`. Directory moves: `packages/{context,credentials,integrations,policy,stores}/*` and `packages/memory/compaction` move to `packages/extensions/<subpath>`, and `packages/drivers/process` moves to `packages/hosts/driver-process`. Every other subfolder keeps its path, so `import.meta.url`-relative assets (`packages/tools/web/src/index.ts:181` skills, `packages/hosts/host-builder/src/indexes.ts:96` data) resolve unchanged.

Dependencies between bundles point one way, with no cycle: `ai → prism`; `extensions → prism`; `tools → extensions` (`./coding` needs `./workflows`; `./web` and `./computer-use` take `./mcp` optionally); `hosts → extensions` (`./mcp`, `./workflows`, `./store-codecs`, `./observability`); `memory-system → prism`; `knowledge → memory-system` (exact pin), with `@arnilo/prism-tools` as an optional peer for `./rag`'s web ingestion.

## Tasks

- [x] Task 1: Phase review (read-only)
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
    - Functional: **The executor stops and asks the owner to confirm** the providers bundle's fresh name (`@arnilo/prism-ai` proposed; alternatives considered: `@arnilo/prism-models`, which reads as the kernel's model core). The note records the answer. If the owner picks another name, the bundle map section of this plan is amended in the same commit as the note.
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
  - Notes (executed 2026-11-10):
    - **Verdict: no kernel addition. Confirmed** — every contract the move touches is expressible with what exists. The change is exactly what the plan expected: one widened name rule in `definePackage`, reused by the manifest code, plus an install-unit (npm root) derivation inside `src/manifest/`. No new hook, slot, `PackageAPI` member, event or primitive. Five findings re-cut acceptance lines rather than the plan: **F1** a `file:` spec cannot name a subpath (Task 3 seam, Task 9 leg), **F2** a bundle root is rehashed once per manifest entry on every load (Task 3), **F3** the retired former-name count is **49**, not 50 (Task 9's sweep wording), **F4** a deleted 0.13 baseline would silently leave the retirement ledger, so the `formerName` read is required not optional (Task 4), **F5** the providers bundle has no `.` export, so its `prism add` failure must be the `not_a_package` hint (Task 3).
    - **Owner gate — providers bundle name: RESOLVED 2026-11-10 — `@arnilo/prism-ai`.** The executor had proposed `@arnilo/prism-model-providers`; the owner picked `@arnilo/prism-ai` instead, and this commit renames it in all 43 occurrences (bundle map here, `roadmap.md`, `PRODUCT.md`, `plans/README.md`, both skill references, and the derived compat baseline filename `arnilo__prism-ai.txt`). Evidence re-checked for the chosen name: `@arnilo/prism-ai` is 404 anonymously, absent from `scripts/retired-names.json` (57 names) and `scripts/deprecations-0.13.json` (33 entries), and appeared nowhere in the tree before this rename. The directory stays `packages/providers` — it names the content, and `packages/memory` already diverges from `prism-memory-system` the same way.
    - **Inventory (real `file:line`; the plan's `duplicate_package` line was off by 13):**

      | Contract | Where |
      |---|---|
      | `NPM_NAME` (definition name, and `requires.packages` keys) | `src/packages/define.ts:17`; check `:33`; `MAX_NAME_LENGTH = 214` `:18`; `requires.packages` keys `:63` |
      | `NAME` (install/remove) and `REGISTRY_SPEC` | `src/manifest/install.ts:37`, `:38`; `MAX_OUTPUT`/`SECRET_ENV` follow at `:39-40` |
      | `NAME_PATTERN` (published schema) | `src/manifest/schema.ts:6`; `NAME` object `:10`; published as `@arnilo/prism/manifest/schema.json` (`package.json` `exports`) |
      | `PACKAGE_NAME` (scaffolder, stays a bare npm name) | `src/cli-manifest.ts:269`; check `:294`; `__PACKAGE_NAME__` `:327` |
      | `not_a_package` name check | `src/manifest/definition.ts:32`; `bad()` `:27`; `toPackageDefinition` `:20` |
      | Spec → `bun add` | `resolveSpec` `src/manifest/install.ts:147`; `file:` branch `:152-172`; registry branch `:173-181` |
      | What `bun add` changed | `changedDependency` `:184`; used at `:203` |
      | Install | `install` `:193`; `bun add --ignore-scripts` `:201`; name fallback `:203-205`; `rollback` `:208`; `installedPackageDir` `:212`; `hashPackageClosure` `:213`; `importDefinition` `:216`; entry/merge/write `:219-231` |
      | Remove | `remove` `:243`; name check `:246`; `dependencies?.[name]` `:251`; `bun remove` `:252`; slot unassignment `:254` |
      | Installed dir / closure hash / verify | `installedPackageDir` `src/manifest/integrity.ts:123` (`name.split("/")`); `hashPackageClosure` `:182` (root dir `:190`); `verifyInstalled` `:309`; `MAX_TREE_FILES = 20_000` `:8`; `MAX_CLOSURE_PACKAGES = 512` `:10` |
      | Import through the exports map | `importDefinition` `src/manifest/definition.ts:56`; `createRequire().resolve(entry.name)` `:63`; `import_failed` `:66` |
      | Load | `loadManifest` `src/manifest/load.ts:80`; per-entry `verifyInstalled` `:134`; `importDefinition` `:144`; `capabilities_drift` `:147`; `missingStub` `:58`; `trustRequest` `:43` |
      | Maintain / list / verify | `configure` `src/manifest/maintain.ts:145`, `setEnabled` `:171`, `assignSlot` `:183`, `list` `:201`, `verify` `:229` — none validates a name, so all are name-agnostic |
      | Sibling-version rule seam | `parseManifest` per-record loop `src/manifest/format.ts:100-127`; existing code family `manifest_invalid`; `manifest_duplicate` `:106` |
      | `packageConfig` keys | `src/packages/loader.ts:46` (option), `:288-299` (unknown key), `:299` (per-entry lookup) |
      | `duplicate_package` | `src/packages/loader.ts:285` (not `:272`) |
      | Slot owners | `src/slots/registry.ts:25,42,45,54`; manifest `slots` validated by `assertSlotOwners` `src/manifest/format.ts:133` |
      | `requires.packages` ordering | `src/packages/loader.ts:216`; keys validated `src/packages/define.ts:63` |
      | Event / status `package` field | `src/contracts-protocol.ts:373` (`package.event`), `:401` (`package.status`), `:411` (background) |
      | `inspect()` | `src/agent/inspect.ts:42-51` (packages, slots owner), `:64` (`statusNotes.package`) |
      | Host-builder indexes | `packages/hosts/host-builder/src/indexes.ts:18` (`ApiPackage.name`), `:47`, `:53` (error `package`); data in `packages/hosts/host-builder/data/{api,errors,examples}.json` (≈900 specifier occurrences) |
      | Package skills, `requiresTools` | skills carry `name`/`path`/`instructions` only (`src/skills.ts:19-21`), `requiresTools` holds **tool** names (`src/skill-disclosure.ts:64`) — neither carries a package name |
      | Retirement sweep source | `scripts/retired-names.mjs:91` (`loadRelease`), `:140-152` (candidates from **compat-baseline filenames** + deprecations), `:158-173` (live subpaths) |
      | Baseline filename | `baselineName` `scripts/release-gates.mjs:30` — `@arnilo/prism-ai` → `arnilo__prism-ai.txt` |
      | Docs name rule | `docs/packages.md:31`; `docs/manifest.md:45` (`packages[].name`), `:80` (`manifest_invalid`) |

    - **Classification:**

      | Change | Verdict |
      |---|---|
      | `definePackage` accepts `<npm-name>(/<segment>)*` | expressible: one regex (and its `MAX_NAME_LENGTH`) replaces the four copies; `requires.packages` keys follow free (`define.ts:63`) |
      | Definition name must equal the specifier | expressible: `definition.ts:32` compares strings; message text only |
      | Install records the specifier, hashes the root | expressible: internal `splitSpecifier` + root passed to `integrity.ts:123,182`; no API change |
      | Sibling entries share a root and a version | expressible: `format.ts` per-record rule with the existing `manifest_invalid` family |
      | `not_a_package` hint lists exported package subpaths | expressible: read `node_modules/<root>/package.json` `exports` inside the manifest module; the kernel still names no package |
      | `remove` runs `bun remove` only when the last sibling goes | expressible: `install.ts:251` compares against the root instead of the entry name |
      | Trust prompt shows the specifier and the root | expressible: `prism add`'s `review` callback derives the root from the name (`cli-manifest.ts:174-177`); **no `ManifestTrustRequest` shape change** |
      | Per-load rehash of a bundle root | expressible, but memoize: see F2 |

    - **Per-subpath map (the table Tasks 4–8 copy).** `kind` is the default export's kind. `R` = required dependency today, `O` = optional peer today, `→O` = the review's recommendation to make it an optional peer (size on disk, hoisted `node_modules`). Every subpath also has peer `@arnilo/prism >=0.13.0 <1.0.0` (not repeated), its own `README.md`, and the bundle's `CHANGELOG.md` and `LICENSE` — **`files` must list `*/README.md` per subpath, which the plan's Task 4 wording omits**.

      | `@arnilo/prism-ai` (`packages/providers`) — 11 packages, 298 files |
      |---|
      | all eleven: `kind=package` (`defineProviderPackage` → `definePackage`, `src/provider-kit/provider-package.ts:112`), no external deps, no assets, `./<vendor>` → `./<vendor>/src/index.ts` |

      | `@arnilo/prism-extensions` (`packages/extensions`, new) — 454 files |
      |---|
      | `./context-engineering` package, no deps |
      | `./context-files` package, no deps |
      | `./compaction` package (moved from `packages/memory/compaction`), no deps; keeps `!**/*.js`, `!**/*.js.map`, `!**/*.d.ts` exclusions |
      | `./keyring` package, `@napi-rs/keyring` **R → O** (64 K + 3.1 M platform binary, native) |
      | `./advisor` package, no deps |
      | `./delegate` package, no deps, **asset `skills/`** |
      | `./hooks-json` package, no deps |
      | `./mcp` package, `@arnilo/prism-extensions/governance` (self-reference), `@modelcontextprotocol/client` 7.3 M **R → O**, `zod` 8.1 M **R → O** |
      | `./observability` package, `@opentelemetry/api` **O** (2.9 M) |
      | `./workflows` package, no deps, extra export `./workflows/testing` → `./workflows/src/testing.ts` |
      | `./approval`, `./governance`, `./guardrail-packs`, `./model-router` packages, no deps |
      | `./store-codecs` **library** (no default export), no deps |
      | `./store-jsonl` package, no deps; `!src/**/*.js` exclusion |
      | `./store-sqlite` package, `./store-codecs` (self-reference) |
      | `./store-postgres` package, `./store-codecs` (self-reference), `pg` 144 K **R → O** (only `./store-postgres` uses it) |

      | `@arnilo/prism-tools` (`packages/tools`) — 559 files |
      |---|
      | `./coding` package, `diff` 968 K stays **R** (light); `@arnilo/prism-extensions` **R** (workflows); `e2b` **O** |
      | `./web` package, `@mozilla/readability` 188 K + `linkedom` 2.7 M + `turndown` 208 K **R**; `@arnilo/prism-extensions` **O** (mcp); `playwright-core` 14 M **O**; **asset `web/skills/`** |
      | `./browser` package, `playwright-core` **O**; **asset `browser/skills/`** |
      | `./research` package, no deps; **asset `research/skills/`** (4 skills) |
      | `./openapi` package, no deps |
      | `./computer-use` package, `@arnilo/prism-extensions` **O** (mcp); **asset `computer-use/skills/`** |
      | `./work` package, `@office-open/{docx,pptx,xlsx,xml}` 5.5 M **R → O**, `ajv` 2.4 M **R → O**, `fast-xml-parser` 1.4 M **R → O**; `@firecrawl/anydoc` 72 K, `mammoth` 1.9 M, `pdf-parse` 21 M **O** (unchanged); **assets `work/{docling,sandbox,vendor,vendor-lock.json,THIRD_PARTY_NOTICES}`** |
      | `./work/{connectors,connectors/drafts,connectors/google-workspace,connectors/microsoft365,diagrams,document-extraction,document-reader,documents,sandbox,sheets,skills,tools}` → `./work/src/<subpath>/index.ts` (12, as today) |

      | `@arnilo/prism-hosts` (`packages/hosts`) — 484 files |
      |---|
      | `./acp` **library**, `@agentclientprotocol/sdk` 5.8 M **R → O** |
      | `./ag-ui` **library**, `@ag-ui/core` 6.4 M **R → O**; `@arnilo/prism-extensions` **O** (mcp); extra export `./ag-ui/renderer` → `./ag-ui/src/renderer/index.ts` |
      | `./channels` **library**, no deps; `./channels/telegram` → `./channels/src/telegram.ts`, `./channels/signal` → `./channels/src/signal.ts` |
      | `./devtools` **library**, no deps; **bin `prism-devtools`** → `./devtools/bin/prism-devtools.ts`; asset `devtools/bin` |
      | `./evals` **library**, `@arnilo/prism-extensions` **R** (store-codecs); `@arnilo/prism-extensions/observability` **O** |
      | `./headless` **library**, `@arnilo/prism-extensions` **R** (workflows) |
      | `./host-builder` **library**, `./mcp-server` (self-reference), `@modelcontextprotocol/server` 7.0 M **R → O**, `zod` 8.1 M **R → O**; **bin `prism-host-builder`**; **assets `host-builder/{bin,data,skills}`** |
      | `./mcp-server` **library**, `./mcp` (self-reference → `@arnilo/prism-extensions/mcp`), `@modelcontextprotocol/server` 7.0 M **R → O**, `zod` 8.1 M **R → O** |
      | `./remote` **library**, no deps; `./remote/testing` → `./remote/src/testing.ts` |
      | `./driver-process` **library** (moved from `packages/drivers/process`), `./mcp-server` (self-reference); `./driver-process/testing` → `./driver-process/src/testing.ts` |

      | `@arnilo/prism-memory-system` (`packages/memory`) — 266 files |
      |---|
      | `.` (`./system/src/index.ts`) package, `./core` (self-reference, exact pin `0.13.0-experimental.0`); `pg` **O**; keeps `!**/fixtures`, `!**/*.js*`, `!**/*.d.ts` exclusions |
      | `./core` **library**, `pg` **O**; `./core/fabric` → `./core/src/fabric/index.ts`, `./core/postgres`, `./core/sqlite`; `!src/**/*.js` exclusion |

      | `@arnilo/prism-knowledge` (`packages/knowledge`) — 97 files |
      |---|
      | `./wiki` package, `./core` (→ `@arnilo/prism-memory-system/core`) **R** exact pin, `./rag` (self-reference) **R**; `@arnilo/prism-tools/web` **O** |
      | `./rag` package, `./core` **R** exact pin; `@arnilo/prism-tools/web` **O**, `pg` **O** |

      Fifteen intra-tree dependency edges exist today and each becomes either a self-reference or a bundle dependency: `driver-process→mcp-server`, `ag-ui→mcp(O)`, `evals→{store-codecs,observability(O)}`, `headless→workflows`, `host-builder→mcp-server`, `mcp-server→mcp`, `mcp→governance`, `rag→{memory-core,tools-web(O)}`, `wiki→{memory-core,rag,tools-web(O)}`, `memory-system→memory-core`, `store-{postgres,sqlite}→store-codecs`, `coding→workflows`, `computer-use→mcp(O)`, `web→mcp(O)`. Bundle edges: `tools→extensions` (R via `./coding`, O via `./web`, `./computer-use`), `hosts→extensions` (**R** via `./mcp-server`, `./host-builder`, `./driver-process`, `./headless`, `./evals`; O via `./ag-ui`), `knowledge→memory-system` (R, exact), `knowledge→tools` (O).
    - **Assumption findings:**
      - **(a) Self-reference: HOLDS**, proven under Bun 1.4.4 both ways. Workspace: a workspace bundle with `exports` `./a`,`./b`, where `./a` imports `@tmp/wsbundle/b` by name, resolves through the root `node_modules/@tmp/wsbundle` symlink (`RESULT a+b`). Packed tarball: the same bundle packed with `bun pm pack` and installed with `bun add --ignore-scripts file:<tgz>` into a temp project resolves and runs identically. **Caveat to keep:** Bun only creates the `node_modules` symlink for a workspace that something depends on (a workspace with no dependents gets no link), so Task 5's self-reference works because `apps/prism-agent` depends on each bundle — nothing new, the tree already relies on it. Second half proven too: `createRequire().resolve("@tmp/bundle/a")` → `node_modules/@tmp/bundle/src/a/index.ts`, while `@tmp/bundle` (no `.` export), `@tmp/bundle/src/b/index.ts`, `@tmp/bundle/../bundle/...` and `@tmp/bundle/` all fail `MODULE_NOT_FOUND` — so `importDefinition` resolves subpaths and nothing else.
      - **(b) Prompt bytes: NO re-pin needed.** A definition `name` reaches no prompt path: the skills catalog renders `skill.name`/`description` (`src/skill-disclosure.ts:107-112`, `:114`), tool descriptions are tool-owned, and `statusNotes` are only read by `inspect()` (`src/agent/inspect.ts:129`) and the conformance JSON — never by `src/input.ts`, `src/context-build.ts` or `src/system-prompts.ts`. The cache-parity fixture carries synthetic tools only (`scripts/cache-parity/fixtures/three-turn-coding.json`), and `prefix-stability-conformance` builds its own skills (`src/testing/prefix-stability-conformance.ts:198`). One real occurrence: the **host-builder skill bodies** name packages (`skills/prism-host-builder/references/{layout,security,upgrading}.md`), and its `SKILL.md` description names `@arnilo/prism` (kernel, unchanged) — Task 7 regenerates that kit anyway, and no prefix or parity fixture loads it. Tasks 6 and 8 do not re-pin.
      - **(c) Memory-bench pins: YES, Task 8 changes them; Task 5 does not.** Pinned path lists: `PREFIX_PRODUCT_PATHS` = `["packages/memory/system/src/ltm"]` and `WRITE_SIDE_PATHS` (same) plus `fileFingerprint` on `.../ltm/consolidation/prompts.ts` (`scripts/memory-bench/acceptance.mjs:181,372,427`); `ONTOLOGY_PRODUCT_PATHS` = those plus `packages/knowledge/wiki/src` (`scripts/memory-bench/audit/readiness.mjs:437`, hash at `:427`, `:490-491`); `cleanup-campaign.mjs:668` adds `packages/memory/core/src`; and `ontologySources()` hashes **paths and bytes** of `packages/memory/core/src`, `packages/memory/system/src/ltm` and `packages/knowledge/wiki/src` (`scripts/memory-bench/replay.mjs:1115-1124`) into the ontology store key (`:1126`). Those trees hold **260** `@arnilo/prism-{memory-core,memory-system,wiki,rag,tools-web}` references, 205 of them `memory-core`, inside `ltm` non-test sources (`types.ts`, `tools.ts`, `create.ts`, `index.ts`, `search.ts`, `exchanges.ts`, `okf-bundle.ts`, `consolidation/extract.ts`, `scope/recall.ts`, `delivery/team.ts`), so Task 8's specifier rewrite changes the bytes and **invalidates** `docs/_evidence/memory-bench/202/cache-stability/record.json` `productHash` (`4fb60791…`) and the four warm ontology stores under `.cache/memory-bench/ontology-stores` (244 MB, `sourceHash`+product key). Re-attest exactly as plan 216 Task 8 did (`bun scripts/memory-bench/audit/readiness.mjs --cache-stability`, offline, 27 pass) and record the new product hash; re-keying the four stores is a directory rename, not a paid run. **Task 5's `packages/memory/compaction` move touches no pinned path** (`compaction` appears only in `packages/memory/system/src/__tests__/components.test.ts`, outside every pinned tree) and the memory-bench harness imports `packages/memory/{system,core}` by relative path, which neither task moves — 41 harness files keep working.
      - **(d) Registry names: HOLDS for all six.** Anonymous `GET https://registry.npmjs.org/@arnilo%2F<name>` returns **404** for `prism-ai`, `prism-tools`, `prism-extensions`, `prism-hosts`, `prism-memory-system` and `prism-knowledge`; `prism` returns 200. None of the six is in `scripts/retired-names.json` `packages` (57 names) or `scripts/deprecations-0.13.json` `names` (33 entries). The same sweep of all 50 workspace names returns **404 for every one**, so no former name has a 0.13 record and Task 10's deprecations list nothing for them; the plan header's “51 of 52” is corrected to 50 of 51 in this commit.
      - **(e) Plans 205 and 206: both are task-complete.** `plans/205-…` is 6/6 checked, `plans/206-…` 5/5 checked, yet `plans/README.md:275` still says `in progress (Tasks 1–3 done)`. **Set both rows to `complete` in Task 2**, and drop their `Post-0.13.0 — off the release path` preamble, which the 2026-11-09 decision reverses (both ship in `@arnilo/prism-ai` at 0.13.0); 205's Further Action 4 (“Publish after 0.13.0”) is superseded by Task 10.
    - **Findings:**
      - **F1 — a `file:` spec carries no root, so a subpath cannot be installed from a tarball.** `resolveSpec` returns `{ add: "file:<tgz>", name: undefined }` for `file:` (`install.ts:152-172`), so `changedDependency` supplies the root, `importDefinition(root)` runs, and a bundle with no `.` export fails `import_failed`. Task 9's “`prism add <bundle>/<subpath>` against the packed tarball (`file:`)” is therefore not expressible today. **Amendment (Task 3):** add one `InstallOptions` test seam `readonly packFrom?: string` (the tarball or directory that supplies the root) and keep the CLI grammar `<name>[/<subpath>][@range]` unchanged; Task 9 drives the subpath leg through `install(spec, { packFrom })`. Reject the alternative (a CLI flag) — it widens the user-facing grammar for a test.
      - **F2 — a bundle root is rehashed once per manifest entry on every load.** `loadManifest` calls `verifyInstalled` per entry (`load.ts:134`), and each call rehashes the whole root closure (`hashPackageClosure` `integrity.ts:182`, hashing every file, ~20 K cap at `:8`). Today one package is ~50 files; the bundle roots are 97–559 files, so a host listing five `@arnilo/prism-tools/*` subpaths hashes 559 files five times per agent start. **Amendment (Task 3):** memoize `(packagesDir, root) → integrity` for the duration of one `loadManifest` call (one `Map`), and assert the rehash count in `load_manifest_hashes_a_bundle_root_once`.
      - **F3 — 49 former names, not 50.** `packages/` holds 50 workspaces; `@arnilo/prism-memory-system` stays as the bundle name (Task 8), so 49 names retire (11 providers + 18 extensions + 7 tools + 10 hosts + 3 memory/knowledge). **Amendment (Task 9):** the sweep sentence says 49; `scripts/package-truth.mjs` counts 51 publishable manifests today, so “52” appears nowhere in the tree and needs no correction.
      - **F4 — retired `formerName`s would silently drop out of the ledger.** `scripts/retired-names.mjs --generate` derives candidates from **compat-baseline filenames** (at the tag and in the live tree) plus deprecation entries (`:140-152`). Task 4 deletes the eleven `arnilo__prism-provider-*.txt` baselines and none of those names is a 0.12 baseline nor a deprecation entry, so without the `formerName` read Task 4 plans, all eleven would leave the sweep silently — a fail-open. Task 4's `bundles.json` read is **required**, and its test must prove a deleted baseline's name still lands in `retired-names.json`.
      - **F5 — three acceptance lines name a count, path or failure code that changed:** Task 4's `files` list must carry `*/README.md` (per-subpath pages stay, per its own wording); Task 5's `keyring` peer is confirmed native (3.1 M platform binary); and the providers bundle has **no** `.` export, so `prism add @arnilo/prism-ai` must fail with the `not_a_package` subpath hint rather than `import_failed` — the hint path has to cover “the root exports no `.`” as well as “the default export is not a package” (Task 3).
    - **Security confirmation.** `install` still runs `bun add --ignore-scripts` (`install.ts:201`) and `remove` `bun remove --ignore-scripts` (`:252`). A subpath name cannot widen what is imported: `createRequire().resolve` goes only through the root's `exports` map, and a deep file path, `..`, a trailing slash or an unexported segment all fail `MODULE_NOT_FOUND` (proven above), which `definition.ts:66` maps to `import_failed`. The existing `REGISTRY_SPEC` still refuses URLs, git and aliases, and the `-` prefix guard (`:154`) still blocks flag injection before `bun add` runs. Integrity keeps covering the whole root closure, so a sibling cannot change unseen. No new secret path; `envSecrets`/`redactOutput` (`:72-86`) are untouched.

- [x] Task 2: Roadmap, product and planning-reference amendment (docs only)
  - Acceptance Criteria:
    - Functional: `roadmap.md` records the owner decision of 2026-11-09:
      - The `Updated:` line and the Phase 11 bullets name the decision.
      - `:444` defines a package as a module specifier (an npm package or one of its exported subpaths) whose default export is `definePackage(...)`.
      - The Part 2 package catalog gives each package its bundle subpath, its directory, and the bundle it ships in.
      - Part 3's version targets list the seven npm packages with their lines: kernel; four stable bundles, of which `hosts` is lockstep and the other three are independent after 0.13.0; two experimental bundles.
      - The 0.12 deprecation rows stay as history.
      - Command Code and Ollama Cloud move from "after 0.13.0" to "in 0.13.0, in `@arnilo/prism-ai`".
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
      - `src/__tests__/docs.test.ts` (`readme_and_product_describe_0_13`, for the renamed host libraries)
    - References:
      - plan 215 header (release facts), memory model decision 2026-11-08
  - Test Cases to Write:
    - n/a — the existing `docs.test.ts` plan-index and kernel-page checks cover the edits; run them.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no code; the product definition of a package changes
    - Docs pages to create/edit: `roadmap.md`, `PRODUCT.md`, `plans/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-10):
    - **The decision is stated once, in `roadmap.md`, and referenced everywhere else.** §2.6 defines a package as a module specifier (an npm package, or one subpath its `exports` map lists) whose default export is `definePackage(...)`; §2.9's catalog is one row per subpath, with the six bundle directories named once above the table; Part 3 lists the seven npm packages with their directory, subpath count and line; Phase 11's Goal and Release bullet name the decision. `PRODUCT.md` says it in one sentence, and its native table is now a bundle table with the "seven npm packages, not one per package" line.
    - **49 former names, 7 published names.** 50 workspaces exist today and `@arnilo/prism-memory-system` survives as a bundle, so 49 retire (Task 1 F3). "52" remains only inside the owner's decision sentence, which is quoted as the decision made, not as a tree count.
    - **Name sweep:** every `@arnilo/prism-<former-name>` in `roadmap.md` and `PRODUCT.md` became its specifier (106 occurrences in the roadmap, 90 outside the history line), with three classes left alone deliberately: the `Updated:` decision history, the retired `@arnilo/prism-{agent-sdk, code}` names, and §1.4's wildcard "`src/` never imports an `@arnilo/prism-*` package". Two prose lists that named files rather than specifiers were rewritten by hand: the store and host-library shorthands in Phases 6 and 10, and the provider bullet in Phase 5, which also moved `commandcode` and `ollama-cloud` back into 0.13.0.
    - **`.claude` mirrors are symlinks.** `.claude/skills -> .agents/skills` (verified with `ls -ld`), so each reference has one file to edit and the plan's "and its `.claude` mirror" line is satisfied by the link; nothing was copied.
    - **Planning reference (`references/prism.md`):** §1's placement table now places a package as `@arnilo/<bundle>/<subpath>` in `packages/<bundle>/<subpath>` and adds the rule that a new subpath is a package while a new bundle is an owner decision; probe 11 splits "new subpath" from "new bundle"; §4's "New native package" checklist describes the subpath layout (one `package.json` at the bundle root, `exports` and `files` per subpath, a `scripts/bundles.json` row); §5's gate table gained a subpath row and retitled the package row as the bundle row.
    - **Execution reference (`release.md`):** "One publish" now names the seven npm packages, the six-bundle map and the hosts-lockstep rule (`prism-host-builder`'s indexes describe one kernel version, so its bundle versions with the kernel); the "new package" checklist splits into bundle and subpath; "Version lines" names the two experimental bundles and the three stable bundles that go independent after the cut.
    - **`plans/README.md`:** rows 205 and 206 are `complete` and drop the "Post-0.13.0 — off the release path" framing (Task 1 finding (e)); the release-path table's step-2 row no longer says `commandcode` and `ollama` stay out of 0.13.0; the historical sequencing paragraph records the 2026-11-09 supersession instead of contradicting it; rows 217–223 and 219.1 carry the dated bundle-map amendment.
    - **Plan headers:** plans 217, 218, 219, 219.1, 220, 221, 222 and 223 each gained one blockquote line under the title pointing at the bundle map. Task bodies are untouched; 205's and 206's own task boxes were already complete (6/6 and 5/5).
    - **`README.md` stays as it is, on purpose.** Its quickstart install line and its generated inventory table are gated against `scripts/package-truth.json`, whose `versions` come from the workspace manifests (`docs.test.ts:1290`, "install package, not subpath"), so `bun add @arnilo/prism-ai @arnilo/prism-tools` fails until Task 4 creates those workspaces. The front page therefore keeps the former names one more task; Task 9 flips it with `node scripts/package-truth.mjs --emit-docs` and the quickstart edit, when the names are true.
    - **One file beyond the plan's original list, forced by an acceptance criterion:**
      - `src/__tests__/docs.test.ts` `readme_and_product_describe_0_13` froze the three specifiers the product page must carry, so the literals became `@arnilo/prism-hosts/{driver-process, remote, headless}` — a name change to the new true values, not a widened or deleted freeze.
    - **Verification:** `bun test --timeout=0 src/__tests__/docs.test.ts` 69 pass; `bun test --timeout=0 scripts/plan-review-gate.test.mjs` 15 pass; `bun scripts/release.mjs gate` unaffected (no `src/` surface moved). Biome does not format Markdown (all edited pages are in its ignore list), so `format:check` needs no change.
    - **Pre-existing red, not caused here:** `bun test scripts/truth-current.test.mjs` fails "package-truth generated docs include current Phase 54 evidence" because the uncommitted memory-track work raises the `@arnilo/prism-memory-{core, system}` export counts against `docs/_evidence/phase54-package-map.md` (316 vs 314, 742 vs 691). No file this task edited participates; the memory task that lands those exports regenerates the evidence.
    - **Name gate: closed.** The owner chose `@arnilo/prism-ai` on 2026-11-10, and the rename landed with Task 1's note (43 occurrences, no other file mentions the old name). The five files this task names, plus the plan and the baseline filename, all carry the chosen name.

- [x] Task 3: Kernel — a package name is a module specifier
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
      - It hashes the **root's** closure, once per root per `loadManifest` call (Task 1 finding F2: `verifyInstalled` runs per entry, `load.ts:134`).
      - It imports the specifier through the exports map and records an entry whose `name` is the specifier.
      - It fails closed in three cases, each rolled back:
        - an unexported subpath: `import_failed`, naming the specifier;
        - a bundle root or subpath whose default export is not a package: `not_a_package`, and the message lists explicit exported subpaths as candidates, read from the installed `package.json` `exports`, without importing siblings to classify their default exports;
        - a malformed specifier: `install_failed`.
      - `install` takes a `packFrom?: string` test seam (a tarball or directory that supplies the root) so a specifier can be installed from a packed tarball without widening the CLI grammar (Task 1 finding F1).
    - Functional: **Siblings share a root.**
      - Installing a second subpath of an installed root reuses or upgrades the root.
      - It refreshes `integrity` (and `version` when the root moved) on **every** manifest entry with that root, so `verifyInstalled` never reports drift on a sibling.
      - Two entries with the same root never carry different versions: the manifest format validator rejects that as `manifest_invalid`, with the existing code family.
    - Functional: **`prism remove <spec>`** removes the entry and its slot assignments. It runs `bun remove <root>` only when no other entry in that scope has the same root.
    - Functional: **`loadManifest`**, `verify` and `list` work per specifier. `capabilities_drift` is reported per specifier. A missing root with `optional: true` yields the existing `missingStub` for each of its entries.
    - Functional: The published `@arnilo/prism/manifest/schema.json` carries the new pattern.
    - Functional: No hook, slot, `PackageAPI` member, event or loader behaviour changes. `duplicate_package` and `packageConfig` keys keep using the definition name, which is now the specifier.
    - Performance: Installing *n* subpaths of one root runs `bun add` once per install call, and one `loadManifest` pass hashes each bundle root once rather than once per listed entry. No extra registry requests.
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
      - `src/__tests__/module-specifier.test.ts` (new: consolidated rule, bundle lifecycle, rollback, exports and hash-count regressions), `src/__tests__/manifest-install.test.ts` (malformed subpaths); existing manifest, CLI, loader and public-export suites run unchanged.
      - `docs/manifest.md`, `docs/packages.md`, `CHANGELOG.md`
      - `packages/hosts/host-builder` indexes and skill text (`bun scripts/host-builder-index.mjs`), because `host_builder_kit_matches_surface` pins the manifest docs and error messages (plan 215 standing rule)
      - `scripts/budgets.json` (measured kernel growth, with rationale; no extra dependency or packed file)
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
    - `load_manifest_hashes_a_bundle_root_once`: two subpaths of one root cost one closure hash per load pass (Task 1 finding F2); fails if the memo is dropped.
    - `install_bundle_root_without_dot_export_lists_subpaths`: `not_a_package` names the exported package subpaths, not `import_failed` (Task 1 finding F5).
    - `manifest_schema_json_name_pattern_matches_runtime_rule`: the published JSON pattern and the runtime regex agree on a shared case table.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. The package name rule, the manifest name field, and `prism add` / `prism remove` semantics change.
    - Docs pages to create/edit:
      - `docs/manifest.md`: entry name, bundle roots, the shared-root integrity and removal rules, the new failure messages.
      - `docs/packages.md`: the name rule and the subpath package layout.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no (scope sentences unchanged)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-10):
    - **Implemented the specifier contract without a new kernel primitive.** `MODULE_SPECIFIER` and `splitSpecifier` live in `src/packages/define.ts`; the manifest schema, installer and integrity paths reuse them. Definitions, dependency keys, manifest entries, slot owners and configuration keep the full specifier. The scaffolder retains its bare npm-name rule. The build emits the matching published JSON schema. This widens the accepted name pattern; it does not change the manifest v1 shape or the public root exports (plan 215 Task 28).
    - **Install unit and identity are separate.** Registry specs pass only the root and requested range/tag to one `bun add --ignore-scripts`; the recorded identity stays the full specifier. `packFrom` supplies a local directory or tarball without a CLI flag. Installing another subpath refreshes every installed sibling's range and integrity while retaining its config, optional/enabled flags and capability record. Conflicting sibling ranges fail with the existing `manifest_invalid` code (the criterion's original `invalid_manifest` spelling was corrected). Removing a subpath drops its slot assignments and removes the root only after the last sibling in that scope.
    - **Rollback covers upgrades.** Failed imports, non-package exports, rejected reviews and failed writes restore the managed project and lockfile and reinstall the prior dependency graph. Regression tests assert that the original manifest, managed `package.json`, lockfile and sibling integrity survive an unsuccessful upgrade. Existing bare-name and `file:` installs still pass. Registry tags retain the previous behavior: Bun resolves the tag and the manifest records a semver range based on the installed version.
    - **One root hash per pass, with checks per specifier.** `loadManifest` and `verify` pass a fresh cache keyed by managed directory and npm root; `verifyInstalled` still compares each entry's recorded integrity separately and reports its specifier on failure. Tests count one actual hash for two subpaths, exercise mismatched sibling integrity, per-specifier capability drift and optional missing-root stubs.
    - **Exports enforcement needed an implementation addition.** Bun 1.4.4's `createRequire().resolve` can resolve an unexported `one.js` file through a fallback. The importer checks the selected exports target before importing, handles explicit keys, wildcard and conditional exports, rejects null/private targets, and requires the resolved file to stay inside the installed root. Resolution remains delegated to the runtime. Tests cover the private-file fallback, conditional null rejection, wildcard and conditional success, and no unlisted sibling import.
    - **Hint criterion amended to preserve the no-sibling-import invariant.** An exports map describes entry points, not their default-export types. `not_a_package` therefore lists explicit exported subpaths as candidates, which can include libraries, and instructs the user to choose a package definition. It does not import candidates to classify them. A root with no `.` export gets the same hint. No metadata field, alias, extra registry request or package-name lookup table was added. The CLI review names both the specifier and the npm root being trusted.
    - **Checks are consolidated** in the new `src/__tests__/module-specifier.test.ts` instead of duplicating fixtures across seven existing suites; `manifest-install.test.ts` adds malformed-subpath cases. `docs/manifest.md`, `docs/packages.md` and `CHANGELOG.md` describe the behavior. The host-builder generator refreshed its API index and synchronized the current example snapshots; those generated snapshots also reflect the concurrent memory-track source changes already in this shared tree. No memory source was edited here.
    - **Compat baseline regenerated with `bun scripts/release.mjs gate --update-baseline`.** Only `scripts/compat-baseline/arnilo__prism.txt` changed; no removed export or compatibility alias. The two additive signature changes are:
      ```diff
      -./manifest InstallOptions interface InstallOptions extends InstallLocation { readonly cwd?: string; readonly review?: (entry: ManifestEntry) => void | Promise<void>; readonly version?: string; }
      +./manifest InstallOptions interface InstallOptions extends InstallLocation { readonly cwd?: string; readonly packFrom?: string; readonly review?: (entry: ManifestEntry) => void | Promise<void>; readonly version?: string; }
      -./manifest verifyInstalled function verifyInstalled(entry: { readonly name: string; readonly integrity: string; }, packagesDir: string, scope: ManifestScope, options?: HashPackageClosureOptions): Promise<void>
      +./manifest verifyInstalled function verifyInstalled(entry: { readonly name: string; readonly integrity: string; }, packagesDir: string, scope: ManifestScope, options?: HashPackageClosureOptions & { readonly cache?: Map<string, Promise<string>>; }): Promise<void>
      ```
    - **Measured budget amendment:** the first release gate correctly rejected the added kernel source and shipped documentation. `scripts/budgets.json` now records 1,261,882 packed bytes, 4,092,311 unpacked bytes, 41,007 source lines and 1,530 counted exports, with the implementation rationale. Relative to the prior ceilings: +2,871 / +10,416 bytes, +145 lines, +2 internal counted exports (`MODULE_SPECIFIER`, `splitSpecifier`). Packed files remain 367; no runtime dependency or public root export was added.
    - **Final verification:** `bun run typecheck` passed; the combined manifest/specifier, CLI, package-loader, public-export, kernel-constraints, docs, host-builder, retirement and plan-review suites passed **266 tests across 15 files**; Biome checked all 11 touched TypeScript files; `git diff --check` passed; the final `bun scripts/release.mjs gate` passed for all **51** current publishable packages. No package name retires in Task 3; the standing retired-name test is green. Whole-plan checks and live/publish work remain in their later tasks.

- [x] Task 4: The bundle map, bundle-aware release tooling, and the first bundle (`@arnilo/prism-ai`)
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
      - The compat gate writes `scripts/compat-baseline/arnilo__prism-ai.txt`, with every line prefixed by its subpath, as the kernel's `.` prefix already is.
      - The eleven `arnilo__prism-provider-<name>.txt` files of shipped providers are deleted.
      - The 0.12-era retired provider baselines stay, because they feed the retired-name ledger.
      - The task note carries the regeneration diff, attributed to this plan: export names unchanged, subpath moved.
    - Functional: **Retired names.**
      - `scripts/retired-names.mjs --generate` also reads `formerName` from `scripts/bundles.json` once its subpath is bundled.
      - The eleven `@arnilo/prism-provider-*` working names enter `scripts/retired-names.json` with the successor specifier — through the `formerName` read, because their 0.13-era baselines are deleted here and none is a 0.12 baseline or a deprecation entry, so `--generate` would otherwise drop all eleven silently (Task 1 finding F4).
      - `no_retired_name_in_live_tree` is green.
    - Functional: **The providers bundle.**
      - `packages/providers/package.json` is `@arnilo/prism-ai`, 0.13.0, with eleven `exports` entries (`./<vendor>` → `./<vendor>/src/index.ts`) and a `files` list covering every subfolder's `src` (tests excluded) and `README.md`, plus the bundle-level `README.md`, `CHANGELOG.md` and `LICENSE`.
      - It has one `test`/`typecheck` script over all subfolders and peer `@arnilo/prism` `>=0.13.0 <1.0.0`.
      - The eleven per-provider `package.json` files are deleted. Their `CHANGELOG.md` content is folded under per-subpath headings in the bundle's `CHANGELOG.md`.
      - Each provider's `definePackage({ name })` is its specifier (`@arnilo/prism-ai/hyper`).
      - Every caller is updated in this task: `apps/prism-agent` (its `package.json` and `src/host`), `examples/`, `scripts/` (live matrix rows, cache-parity drivers, `canary-providers.yml`), tests, and docs.
      - `bun.lock` is regenerated.
    - Functional: **Command Code and Ollama Cloud ship.**
      - `providers/commandcode` and `providers/ollama-cloud` are in the bundle's `exports`, `files` and baseline.
      - They are in the freeze set.
      - Their live rows stay non-gating for 0.13.0, as recorded by plan 215 Task 34 and the owner scope; this task records that.
    - Functional: The bundle `README.md` (new) lists each subpath with a one-line description and its install line. The eleven provider READMEs stay as the subpaths' package pages, with install lines and manifest names rewritten to specifiers.
    - Performance:
      - Importing `@arnilo/prism-ai/hyper` loads no sibling provider. A test spawns `bun` and checks the loaded module paths.
      - The packed size is recorded against a new `ai` budget row.
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
      { "bundles": [ { "name": "@arnilo/prism-ai", "dir": "packages/providers", "line": "independent",
          "subpaths": [ { "path": "./hyper", "dir": "hyper", "formerName": "@arnilo/prism-provider-hyper", "kind": "package" } ] } ] }
      ```
      ```ts
      import hyper from "@arnilo/prism-ai/hyper";
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
    - `deleted_baseline_name_stays_retired`: a `formerName` whose 0.13-era compat baseline is deleted here is still in the generated list (Task 1 finding F4); fails if `--generate` relies on baseline filenames alone.
    - `load_release_treats_bundle_dir_as_one_unit`.
    - `provider_subpath_import_loads_no_sibling`.
    - Plus the existing provider conformance suites, now run by `bun run --filter @arnilo/prism-ai test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Provider install names and import paths change.
    - Docs pages to create/edit: `packages/providers/README.md` (new bundle page), the eleven provider READMEs, `docs/index.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes. A bundle entry links the bundle README, and each provider link points at its subpath README.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-10):
    - Implemented the six-bundle target map in `scripts/bundles.json` and the shared mixed-tree reader/validator in `scripts/bundles.mjs`. Active bundle names, exports, source folders and shipped assets are checked against the map. `loadRelease` stops at an active bundle; other groups retain their existing per-package discovery. The mixed tree now has **41 release units**, down from 51 (the earlier Task 4 approach inherited an outdated 52 count; plan 216 had already folded fabric into memory-system).
    - `@arnilo/prism-ai` is the first active bundle: eleven explicit provider exports, no root barrel or root export, source-only tarball, kernel peer `>=0.13.0 <1.0.0`, combined test/typecheck scripts, combined changelog, and separate provider README pages. Deleted the eleven provider manifests. Updated definitions, host dependencies, import/config callers, examples, live matrix/probes, cache-parity drivers, packed fixtures, CI import callers, host-builder skill/indexes and current docs. Regenerated `bun.lock`; no dependency added. npm installation uses the bundle name; imports and manifest entries use each subpath.
    - **Command Code and Ollama Cloud ship at 0.13.0**, including their exports and compat baselines. Their live rows remain **non-gating**, under plan 215 Task 34's existing owner scope. No paid/live run was performed here.
    - Tooling follows the mixed tree: package truth/generated inventory, packaging and install-smoke discovery, host-builder declaration emission, package-skill source/asset ownership, experimental source boundaries, E2E coverage annotations, independent-line classification and tarball budgets. Coverage thresholds are keyed by source directory, preserving every prior floor; the provider directories retain separate coverage rows and local filters. The AI bundle stays lockstep for this initial cut; Task 10 applies its independent line after publish. Existing CI filter lists contain no individual-provider filter to collapse; their remaining package names are for later tasks.
    - **Retirement:** generation now reads `formerName` from active bundles, independently of deleted compat files, and records successor specifiers. All eleven provider working names remain in the ledger. The bundle map itself is retirement metadata and is excluded like the existing retirement lists. `bun scripts/retired-names.mjs --generate` then the sweep: **0 hits**. The old OpenRouter npm-name deprecation now points to the bundle subpath instead of promising to republish that npm name; no registry mutation occurred.
    - **Baseline regeneration diff, attributed to this task:** removed the eleven `arnilo__prism-provider-<vendor>.txt` working baselines and added `arnilo__prism-ai.txt` (**298 lines**). Every old line is byte-identical after replacing its `.` prefix with its provider subpath: **zero export/signature changes**. Retired 0.12-era provider baselines remain. The kernel and memory-core baseline changes already in the working tree belong to earlier work, not this consolidation.
      ```diff
      - arnilo__prism-provider-<vendor>.txt: . <export>\t<signature>
      + arnilo__prism-ai.txt: ./<vendor> <export>\t<signature>
      ```
      Counts: commandcode 29; hyper 25; kilo 44; laya 12; liquid 17; litellm 32; ollama-cloud 38; openai-codex 49; opencode-go 23; openrouter 17; typesafe 12.
    - **Size/import proof:** AI tarball **108,051 packed / 393,257 unpacked bytes / 58 files**, recorded in the `ai` budget with 5% tolerance and enforced by the release gate. A spawned Bun process observes Hyper in `require.cache` and zero sibling provider modules. The kernel's byte ceilings were remeasured for the changed shipped docs, changelog and generated inventory; no runtime code was added to the kernel by this task.
    - **Verification:** `bun run typecheck`; provider suite (**298 pass, 14 credential/live skips**); packaging/docs/truth suites (**324 pass**); packed packaging/install consumers (**143 pass**); focused bundle/retirement/release/experimental/cache-probe/truth checks (**73 pass**, with the added negative bundle-drift test included); host-builder-index/package-skills suites (**27 pass**); E2E coverage/retired-provider checks (**11 pass**); coverage discovery/floors/fake-run failure controls (**6 pass**); import-hygiene checks; and `bun scripts/release.mjs gate --update-baseline` followed by `gate` (41 units). Focused formatting/lint and `git diff --check` were run. The plan's `scripts/package-truth.test.mjs` path does not exist; its current suites are `truth-current.test.mjs` and `phase24-truth.test.mjs`.
    - **Pre-existing broader-suite findings for Task 9:** release-gate's workflow assertion still forbids npm although plan 215 Task 38 deliberately uses npm OIDC, and its no-skips assertion catches the credential-gated live-provider journey; version-literal and phase30 checks still require literal append-only release tags although the workflow uses `v*`; phase54's historical whitelist omits host-builder; phase37's historical cache matrix points at deleted `opencode-go/src/cache.ts`; phase29's historical supersession map still names the removed provider umbrella. These failures are outside the provider consolidation; their assertions were not weakened here. Full `sdk:ready`, paid live tests and publishing remain for Tasks 9–10.

- [x] Task 5: The extensions bundle (`@arnilo/prism-extensions`)
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
      - **Missing optional peer at load:** the subpath reports `status.note(...)` and registers no integration; it never throws an unhandled import error. Preserve keyring's existing fail-closed resolver when its OS backend is unavailable: `keyring:` reads return undefined, writes refuse, and `env:` refs delegate. The encrypted-file backend needs no native peer; a supplied Postgres pool needs no `pg` peer.
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
    - `extensions_without_optional_peers_report_status_notes`: a fresh isolated consumer lacks all five optional peers; configured keyring, MCP, Postgres and observability load with status notes rather than import errors.
    - `packed_extensions_resolve_self_references_without_optional_peers`: packs and installs the kernel and extensions using `--ignore-scripts`, exercises SQLite and the public workflow testing export, and imports MCP/Postgres without their SDKs.
    - Plus the existing store conformance (jsonl, sqlite, and postgres under `PRISM_TEST_POSTGRES_URL`), governance and workflow suites, now under `bun run --filter @arnilo/prism-extensions test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Install names and import paths change, and some dependencies become optional peers.
    - Docs pages to create/edit: `packages/extensions/README.md` (new), the subpath READMEs (install, manifest name, optional peer), `docs/index.md`, `docs/migrate-to-0.13.md`, `docs/peer-dependencies.md` (optional peers per subpath), `CHANGELOG.md`
    - `docs/index.md` update: yes. Bundle entry plus moved README links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-10):
    - **Bundle complete.** Eighteen packages moved with `git mv` into `packages/extensions`; the emptied `context`, `credentials`, `integrations`, `policy` and `stores` groups are removed. One `@arnilo/prism-extensions` 0.13.0 manifest owns nineteen exports, source/README assets and `delegate/skills`; the eighteen leaf manifests are deleted and their CHANGELOGs folded into the bundle CHANGELOG. No root export, compatibility package or cross-subpath relative source import was added.
    - **Map correction.** Task 4's map had mistakenly shortened the four store subpaths to `./codecs`, `./jsonl`, `./postgres` and `./sqlite`. They now match this plan's approved names: `./store-codecs`, `./store-jsonl`, `./store-postgres`, `./store-sqlite`. All definitions and callers use those specifiers. Tools, host libraries, the reference host, examples, scripts, templates, CI filter consumers, host-builder skill text and indexes, docs and the lockfile were updated in this task. Release tooling now sees **24** units (41 minus 18 plus one).
    - **Dependencies and security.** The bundle has **zero required external runtime dependencies**. `@napi-rs/keyring`, `pg`, `@opentelemetry/api`, `@modelcontextprotocol/client` and `zod` are optional peers, documented in the bundle, owning README and peer matrix. Native keyring and Postgres dependencies are installed as development dependencies for verification only. MCP SDK value loads are lazy, including its synchronous transport/client factories; missing configured MCP peers register no tools or commands. Postgres checks its peer before resolving secrets or creating a pool. Existing keyring fail-closed slot behavior is preserved (clarified in acceptance above), rather than dropping the resolver. The native byte-array size check uses `.length`, valid for both native arrays and `Uint8Array`, and retains its hard cap. Two stale hooks-json test type/session calls were corrected; production hook behavior is unchanged.
    - **Consumer enforcement.** The packed-consumer helper resolves a requested subpath to its bundle once and installs with `--ignore-scripts`; version probes read the npm root manifest. Reference-host and host-builder allow-lists recognize bundle exports, skill tarball checks recognize the bundle manifest, the test-runner partition recognizes `<subpath>/src` directories, and PostgreSQL evidence parsing expects the `@arnilo/prism-extensions test:postgres` workspace prefix. Coverage keeps every existing subpath's numerical floor under its moved directory; no coverage threshold was lowered. The version-literal scan now includes bundle sources and package definition names, with a positive assertion for compaction.
    - **Compat baseline diff (attributed to plan 224 Task 5):**
      ```text
      + scripts/compat-baseline/arnilo__prism-extensions.txt: 1,213 declarations
      - 15 former working-name baseline files: 852 declarations moved
        retained ledger: arnilo__prism-{mcp,workflows,model-router}.txt (361 lines)
        retained ledger: arnilo__prism-evals.txt (host library, unchanged)
      ~ arnilo__prism-tools-coding.txt: 2 workflow module-specifier references
      ~ arnilo__prism-mcp-server.txt: McpBridgeError re-export module specifier
      ```
      Every old extension export key is present under its mapped subpath, and an explicit comparison against `HEAD` found **zero declaration signature differences beyond specifier rewrites**. The 1,213 lines are: advisor 29; approval 11; compaction 3; context-engineering 158; context-files 11; delegate 38; governance 187; guardrail-packs 26; hooks-json 33; keyring 74; mcp 120; model-router 38; observability 77; store-codecs 128; store-jsonl 11; store-postgres 37; store-sqlite 29; workflows 198; workflows/testing 5. The kernel's `InstallOptions.packFrom` / integrity-cache baseline differences and the memory-core baseline differences already present in the worktree belong to earlier work, not this task.
    - **Retirement.** Regenerated the ledger: **86 retired packages**, including all eighteen former extension names, with their bundle successors. `bun scripts/retired-names.mjs` reports **0 hits in 2,043 files**. Historical registry names stay historical; the MCP, workflows and model-router deprecation entries now point to their successors with `reused: false` and range `*`, because their former names are not being republished. No registry command was applied.
    - **Memory pins.** Task 1(c)'s finding still holds: moving compaction changes no pinned production path or prompt. The additional memory-system `ltm/__tests__/package.test.ts` caller now imports context engineering through its public specifier; no pinned production source or provider request changed. No memory-bench evidence, cache-stability pin or warm ontology store was rewritten or re-attested.
    - **Size.** The actual tarball is **484,222 packed bytes / 1,979,126 unpacked bytes / 239 files**. The `extensions` budget records the first measurement (483,889 / 1,977,383) with 5% headroom; the final measurement passes it. Tests prove importing approval loads none of the optional peers, and an installed packed consumer resolves sibling store/governance subpaths and `workflows/testing` with no optional peers installed.
    - **Passing verification.** `bun run typecheck`; `bun scripts/release.mjs gate --update-baseline` and the subsequent plain `gate` (`updated: false`, 24 units); extensions workspace **1,055 pass / 45 skip / 0 fail** across 126 files; combined packaging/docs/host-builder/inspect/bundle/retirement/runner/Postgres-parser/registry acceptance **296 pass**, plus isolated import-hygiene **4 pass / 0 fail**. The combined run's one hygiene failure compared git status while another worktree writer changed an untracked memory-bench directory; rerunning it alone passed without changing the test. Tool consumers also passed: coding **626**, web **196**, computer-use **31**, evals **246**. Package-skills conformance reports no failures, host-builder indexes are fresh, offline host-builder evals return `no-claims`, `git diff --check` is clean, and `graft build` refreshed the moved-source graph.
    - **Verification limits / Task 9 handoff.** `PRISM_TEST_POSTGRES_URL` is unset; durable PostgreSQL and live-provider legs were not run (the 45 extension skips include environment-gated tests). Whole-plan verification was not claimed. Broader checks still expose the historical phase54 classification/generated-evidence assertions, the release-workflow literal-tag assertions, and packed-journey cache-result-prefix / reserved-episode fixtures already assigned to Task 9. Reference-host evals additionally report three denied coding calls as executed effects in `approval_before_effect`; all task-success/state checks pass, including absence of the denied files, but the two aggregate host-eval tests remain red. Its trajectory scorer and production approval behavior were not changed here. Task 9 must reconcile that evidence before the whole-tree gate is called green. No publication, live run, commit of the pre-existing dirty worktree, or memory-behavior change was performed.

- [x] Task 6: The tools bundle (`@arnilo/prism-tools`)
  - Acceptance Criteria:
    - Functional: `packages/tools/package.json` is `@arnilo/prism-tools` 0.13.0:
      - `exports` has `./coding`, `./web`, `./browser`, `./research`, `./openapi`, `./computer-use`, `./work` and `./work/<each of its twelve subpaths>`.
      - `files` covers `src` and `skills` per subfolder, plus `work/{docling,sandbox,vendor,vendor-lock.json,THIRD_PARTY_NOTICES}`.
      - Each definition is named by its specifier.
      - The seven per-package manifests are deleted.
    - Functional: **Dependencies.**
      - `./coding` requires `@arnilo/prism-extensions` (workflows).
      - `./web` and `./computer-use` retain lazy MCP loading. npm peer metadata applies to the whole bundle, so the shared extensions peer is required by coding and cannot simultaneously be optional for these two subpaths.
      - Dependencies used by only one subpath become optional peers when Task 1 measured them as heavy: the `@office-open/*` set, `ajv` and `fast-xml-parser` (`./work`); `@mozilla/readability`, `linkedom` and `turndown` (`./web`); `diff` (`./coding`). They stay required when they are light.
      - The existing optional peers (`playwright-core`, `e2b`, `@firecrawl/anydoc`, `mammoth`, `pdf-parse`) keep their missing-peer behaviour.
      - The note records the decision per dependency, with sizes.
    - Functional: Existing shipped package skills still load from their subfolder assets: `web-research`, `browser-automation`, research and desktop skills, work vendored skills, and `delegating-work` from extensions. Plan 215 Task 11 removed `coding-workflow` by owner decision; its archived eval fixture remains archived. `package_skills_conform` and the `requiresTools` gate pass. `bun scripts/skill-evals/run.mjs --offline` passes.
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
      - Same pattern as Tasks 4–5, with a dependency decision recorded per dependency. Reuse the packed-consumer helper with explicit optional dependencies for Office-feature journeys, and teach host-builder error discovery to scan the bundle map's source subfolders.
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

  - Notes (executed 2026-11-10):
    - **Implemented `@arnilo/prism-tools` 0.13.0.** Seven package entries and twelve work library entries now share one workspace, manifest, version, changelog, license, test/typecheck scripts and compat baseline. There is no root barrel, alias or compatibility package. Removed the seven leaf manifests; definitions read the bundle manifest and identify themselves by their full specifiers. The mixed tree now contains **18 release units**, down from 24. Updated host workers/dependencies, knowledge optional peers, examples, packed consumers, CI commands, host-builder skill/indexes, current documentation and registry successor metadata; regenerated `bun.lock`. Coverage threshold rows remain keyed by the unchanged source directories, with their existing floors.
    - **Dependency decisions, using Task 1's installed-size measurements:** `diff` **968 K**, `@mozilla/readability` **188 K**, `linkedom` **2.7 M**, and `turndown` **208 K** stay required. `@office-open/{docx,pptx,xlsx,xml}` **5.5 M combined**, `ajv` **2.4 M**, and `fast-xml-parser` **1.4 M** become optional peers and remain development dependencies for their existing suites. Existing optional peers retain their pins and missing-peer behavior: `playwright-core` **14 M**, `@firecrawl/anydoc` **72 K**, `mammoth` **1.9 M**, `pdf-parse` **21 M**, and `e2b` (already optional; no new footprint decision). The extensions npm peer is required for coding workflows; npm metadata cannot also make that same peer optional per subpath. Web/computer-use MCP imports remain lazy. No dependency was added.
    - **Missing peers fail closed.** Work setup probes all six newly optional peers, reports missing names, and omits Office tools when any is absent. Office implementations load on execution, retaining schema validation, caps and error handling. Reader setup drops unavailable OOXML formats while retaining available PDF/DOCX parsers; connectors and vendored skills remain usable. A separate isolated fixture removes each newly optional peer and checks the status note and absent Office tools. Direct Office library imports require their peers. Feature-complete packed journeys explicitly install their Office peers; the minimal packed test verifies that none is installed automatically.
    - **Assets and size proof:** all seven source trees, shipped skill directories, and `work/{docling,sandbox,vendor,vendor-lock.json,THIRD_PARTY_NOTICES}` ship. Final measured tools tarball: **589,971 packed / 2,372,761 unpacked bytes / 331 files**. A clean `--ignore-scripts` install without optional peers measured **21,416,317 bytes** under `node_modules`, including the kernel, extensions and required transitive dependencies. `scripts/budgets.json` records the new tools packed/unpacked/install rows with 5% tolerance; tests enforce the install ceiling and the release gate enforces tarball size. The spawned web import observes no Office, Playwright or E2B module.
    - **Baseline diff, attributed to plan 224 Task 6:** deleted the seven `arnilo__prism-tools-<name>.txt` working baselines and generated `arnilo__prism-tools.txt` with **1,578 lines**. Every prior line is identical after the mapped subpath prefix and imported-specifier rewrites: **zero export/signature changes**. Counts: coding 728; web 151; browser 192; research 2; openapi 24; computer-use 41; work and its libraries 440. The 0.12-era coding-tools/web-tools/work-tools/openapi-tools baseline files remain.
      ```diff
      - arnilo__prism-tools-<name>.txt: . <export>\t<signature>
      + arnilo__prism-tools.txt: ./<name> <export>\t<signature>
      - arnilo__prism-tools-work.txt: ./<library> <export>\t<signature>
      + arnilo__prism-tools.txt: ./work/<library> <export>\t<signature>
      ```
    - **Retirement and prompts:** all seven former names remain in the generated ledger through `formerName`; the final sweep reports **0 hits**. Task 1(b) found no prompt-byte impact, so no prefix/hash fixture was re-pinned. Existing prefix-stability and cache-probe checks pass. Package-skills conformance and offline skill evals pass. `coding-workflow` stays removed under plan 215 Task 11's owner decision; its archived eval text is not restored.
    - **Small prerequisites found by installed-consumer checks:** host-builder error discovery now walks bundle-map source subfolders (with a regression assertion for the coding principal error), instead of looking only for `<bundle>/src`; its regenerated index contains **539 errors**. Updated package-count/manifest-path tests, npm-root CI/registry fixtures, and the workflow scan's literal-versus-concatenated-import handling. Packed journey fixtures now check the existing folded-result marker, obtain the evaluation store from store-codecs, assert the existing refusal of reserved episode writes, and omit a test of the already-retired fake model-discovery API. The historical OM-before harness keeps the same pre-216 dynamic import through a named variable so the current-workspace import scan does not mistake it for a current dependency. No memory behavior, eval baseline, coverage floor or performance ceiling was changed.
    - **Passing verification:** `bun run typecheck`; frozen-lockfile `bun install --ignore-scripts` (no changes); tools workspace **1,262 pass / 27 environment-gated skips / 0 fail**, run with `UV_THREADPOOL_SIZE=2` and unchanged test thresholds; bundle/retirement/skill/host-builder acceptance **38 pass**; packed full-surface, workflow, runner and registry checks **50 pass**; packaging/docs/experimental/release checks **209 pass** in the final combined run (the remaining 13 passing checks and 3 failures in that run belong to the separate coverage-artifact suite); packed install smoke **15 pass**, coding journey **3 pass**, and packed ingestion/golden tests pass. Host-builder indexes are fresh; offline host-builder evals report `no-claims`; offline skill evals report ship for their four archived/current fixtures. `bun scripts/release.mjs gate --update-baseline`, then the final plain `gate`, pass for **18 units** (`updated: false` on the final run). Formatting/lint ran over 150 affected code/config files (no errors; existing fixture warnings remain); `git diff --check` is clean.
    - **Broader checks are not an SDK-ready claim.** The reference-host suite has **64 pass / 1 live skip / 2 failures**: its approval-before-effect invariant reports blocked writes in the deny fixtures as effects without prior approval. The scorer and eval suite source are unchanged by this task. Three coverage checks reject the existing stale measured artifact, which still contains former extension names and lacks some provider rows; directory thresholds themselves match. A wider multi-agent benchmark also exceeded its existing context-history p95 ceiling under host load. Task 9 records these as required whole-tree verification work; no baseline, floor or timing threshold was weakened. Protected phase-26/Docker/browser/Postgres, live providers/OCR and publication were not run. Tasks 7–10 and whole-plan verification remain unchecked.

- [x] Task 7: The hosts bundle (`@arnilo/prism-hosts`)
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
      - One lockstep hosts bundle, with the kit regenerated in the same task. Keep heavy protocol SDKs as optional peers, supplied explicitly by protocol consumers. Make kit lookup/staging understand bundle subpaths and assets; preserve earlier paid eval evidence under its original registration.
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
      - host-builder lookup/staging and registered eval inputs; `src/__tests__/{packaging,public-export-contract,release,host-surface-gate,docs}.test.ts`, current release/packaging/truth/runner/version/CI/Postgres-evidence checks
      - `docs/index.md`, `docs/drivers.md`, `docs/agent-adapters.md`, `docs/host.md` (install lines; tentative per grep), `docs/migrate-to-0.13.md`, the subpath READMEs, `CHANGELOG.md`
    - References:
      - plan 215 Tasks 13–20
  - Test Cases to Write:
    - `hosts_headless_import_loads_no_protocol_sdk`.
    - `hosts_bundle_bins_resolve_from_packed_tarball`.
    - `independent_packages_exclude_lockstep_bundles`.
    - `hosts_protocol_subpaths_resolve_with_explicit_peers`, and packed minimal imports that reject protocol entries when peers are absent.
    - `blocked_tool_has_no_effect_but_unapproved_failed_execution_still_fails`: the prerequisite scorer correction must retain rejection of an unapproved executed tool.
    - Plus the existing host-library suites, the kit drift gate and offline builder evals.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. Install names, import paths, and the bin package.
    - Docs pages to create/edit: `packages/hosts/README.md` (new), the subpath READMEs, the host-builder skill text, `docs/index.md`, `docs/migrate-to-0.13.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-10):
    - **Implemented `@arnilo/prism-hosts` 0.13.0.** Ten former workspaces now share one manifest, version, license, changelog, test/typecheck scripts and fifteen public subpaths. Moved the process driver with `git mv` to `packages/hosts/driver-process` and removed `packages/drivers`. Both bins point into their owning subfolders and use Bun shebangs; sources, READMEs, devtools/bin and host-builder/{bin,data,skills} ship. Deleted the ten leaf manifests and tsconfigs; imports of package version metadata read the bundle manifest. No root barrel, alias, compatibility package or dependency was added. The mixed release graph now contains **9 units**, down from 18. `hosts` remains lockstep and absent from both independent lists. Corrected the bundle map's `driver-process` kind to **library**, matching Task 1's inventory: it exports named adapter factories, not a default Prism definition. Adapter-created package names retain their existing contract.
    - **Dependency decisions match Task 1's measurements.** `@agentclientprotocol/sdk` **5.8 M**, `@ag-ui/core` **6.4 M**, `@modelcontextprotocol/server` **7.0 M**, and `zod` **8.1 M** are optional peers, also development dependencies for verification. ACP/AG-UI/MCP consumers supply their peers explicitly; direct protocol entrypoints fail at import when a peer is missing. Headless and the host-builder installer/info/help and devtools entrypoints work without them. The extensions bundle stays required for workflows/codecs/observability. Spawned-process checks show no protocol SDK loaded by `headless`. Clean packed installs with `--ignore-scripts` verify absent optional peers, both executable links, all non-protocol subpaths, and shipped indexes; a separate consumer with explicit peers imports the protocol subpaths. Packed coding/full-surface journeys install their protocol peers explicitly. Final measured hosts pack: **860,648 packed / 3,898,036 unpacked bytes / 322 files**, recorded with a 5% budget band. `scripts/budgets.json` replaces the old hostBuilder row with the hosts tarball row; coverage floors remain keyed to unchanged source directories.
    - **Kit and callers.** Updated reference-host imports/dependencies, examples, hidden eval solutions/workspaces, public docs and README install commands, fixtures, release wiring and registry-successor metadata; regenerated `bun.lock` and package truth/docs. The installer writes a full-specifier skill stamp and invokes MCP with `bunx --package @arnilo/prism-hosts prism-host-builder mcp`. API lookup accepts a bundle or exact subpath and suggests subpaths on misses. Docs lookup discovers the shipped subfolder READMEs while retaining the existing real-path and byte boundaries. Eval staging copies bundle assets and omits only host-builder assets in the `none` arm. Regenerated the nine-unit API index (**539 error records / 110 examples**). Re-registered the seven-task offline eval inputs; earlier paid evidence remains unchanged under `docs/_evidence/host-builder/212`, and future evidence uses `224` so registrations cannot be mixed. Offline results remain **no-claims**; no paid eval or prompt/cache re-pin was needed.
    - **Baseline diff, attributed to plan 224 Task 7:** generated `arnilo__prism-hosts.txt`, **699 lines**. Compared every line to the ten former baselines after only mapped subpath prefixes and imported-specifier rewrites: **zero export/signature changes**. Counts: acp 30; ag-ui 163 + renderer 18; channels 87 + telegram 10 + signal 9; devtools 20; evals 201; headless 24; host-builder 15; mcp-server 29; remote 56 + testing 7; driver-process 26 + testing 4. Deleted the seven 0.13-only leaf baseline files (acp, devtools, driver-process, headless, host-builder, mcp-server, remote); retained the 0.12 ag-ui/channels/evals/acp-agent/mcp baselines for the ledger. All ten former names remain retired through `formerName`; the standing sweep reports **0 hits**.
      ```diff
      - arnilo__prism-<host>.txt: . <export>\t<signature>
      + arnilo__prism-hosts.txt: ./<host> <export>\t<signature>
      - arnilo__prism-<host>.txt: ./<nested> <export>\t<signature>
      + arnilo__prism-hosts.txt: ./<host>/<nested> <export>\t<signature>
      ```
    - **Small prerequisites and regressions.** The combined typecheck uses the reference host's existing scoped Bun-module declaration pattern to avoid unrelated global fetch/SQLite overloads, retaining the Bun APIs used by host tests. Bundle-aware packaging, host-surface, manifest-count, generated-doc and version-claim assertions now check the owning manifest/assets; historical evidence expectations keep historical names. The public `Skill` type used by MCP resources is recorded in the host allow-list. PostgreSQL evidence parsing recognizes the hosts workspace prefix. Corrected two stale release-check assumptions (an npm command mentioned in a YAML comment is not executed; the explicitly opt-in live-provider suite is separate from hermetic no-skip scenarios). **Resolved Task 6's recorded reference-host eval failure:** the approval-before-effect scorer ignores a `blocked` tool outcome because no execution occurred. A failing-first regression covers both blocked and failed outcomes; failed/unapproved execution, execution after denial, and unknown tools still fail the invariant. No baseline, security gate, coverage floor or timing ceiling was weakened.
    - **Passing verification:** `bun run typecheck`; hosts **920 pass / 3 environment-gated skips / 0 fail** across 99 files; reference host **66 pass / 1 live-provider skip / 0 fail**; kit/index/offline-eval/packed-host acceptance **44 pass**; current truth/workflow/release/bundle/retirement/runner/Postgres-evidence tests **102 pass**; docs/version checks **74 pass**; packed full-surface and coding journeys and current packed-consumer checks pass; host public-surface/packaging/export/release checks pass. `host_builder_kit_matches_surface`, `host-builder-index --check`, package-skills conformance, real MCP modern+legacy/list/call/deny/malformed-frame smoke, adapter conformance and frozen-install idempotence pass. Ran `release.mjs gate --update-baseline`; subsequent plain `gate` passed for **9 units** (`updated: false`). Formatting and `git diff --check` pass.
    - **Release environment limit, not a publish claim.** A final `bun run release:gate` passed the reference host, hosts, adapter, kernel/kit/skill and frozen-install legs, then stopped at the protected release-evidence check because **`PRISM_TEST_POSTGRES_URL` is unset**. PostgreSQL/channel live services, live providers, paid evals and publishing were not run; the protected service evidence is still required before release. Task 9 retains its existing broader coverage-artifact and benchmark obligations; Task 6's two reference-host eval failures are now resolved by the scorer regression above. Tasks 8–10 and whole-plan verification remain unchecked.

- [x] Task 8: The experimental bundles (`@arnilo/prism-memory-system`, `@arnilo/prism-knowledge`)
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
    - Functional: The reference host's `memory` opt-in and the memory-bench scripts (`scripts/memory-bench/**`) import the new specifiers. The memory-bench product hashes Task 1 (c) named are updated. The plan 202 cache-stability pin is re-attested with byte-identical provider requests. Capture the actual pre-edit working tree twice and the final tree twice with `prefix-probe.mjs --capture-answers` and `equivalence-preload.mjs`, compare with `compareAnswerCaptures`, record both source fingerprints and the snapshot method, then run `readiness.mjs --cache-stability`. Tasks 4–7 and concurrent memory work are uncommitted, so an older committed worktree would not represent this task’s base. The note records the result.
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
      - `docs/index.md`, `docs/release.md`, `docs/peer-dependencies.md`, `docs/migrate-to-0.13.md`, the four subpath READMEs, `PRODUCT.md` (install line, if not already in Task 2), `CHANGELOG.md`
      - bundle/packaging/docs/version/retirement/manifest regression tests, packed-consumer fixtures, host-builder generated indexes; `src/manifest/definition.ts` (the existing import-failure boundary must also cover metadata reads)
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

  - Notes (executed 2026-11-10):
    - **Implemented the two experimental bundles.** `packages/memory/package.json` is `@arnilo/prism-memory-system` `0.13.0-experimental.0`, exporting the unchanged system definition at `.` and four core library entries. `packages/knowledge/package.json` is `@arnilo/prism-knowledge` at the same version, exporting `/rag` and `/wiki`, whose definitions use their full specifiers. Knowledge pins memory-system exactly; tools and `pg` remain optional peers. Removed the four leaf manifests and tsconfigs, added bundle manifests/configs/READMEs/changelogs/licenses, and preserved source directories and historical leaf changelogs. No root knowledge barrel, alias, dependency or memory behavior was added. Root workspaces are now `["packages/*", "apps/*"]`; the experimental list contains exactly the two bundles; the release graph contains **seven** units.
    - **Callers and boundaries.** Updated reference-host opt-ins, examples, benchmark imports, current documentation/install commands, packed consumers, development dependencies and host-builder indexes. Regenerated `bun.lock`, package truth and the seven-unit kit. Existing coverage floors remain on the unchanged source directories. Bundle-aware boundary tests classify a subpath by its owning npm bundle and retain rejection of experimental imports/dependencies from stable bundles. The packed experimental consumer installs with `--ignore-scripts`, resolves all seven experimental entrypoints without `pg`, and observes no web ingestion/tool stack when importing the wiki. The reference-host default remains free of experimental packages. Plans **217–223 already carry all seven Task 2 header amendments**; their bodies and memory-track evidence were left unchanged, apart from the explicitly required plan 202 cache-pin files and README.
    - **Baseline diff, attributed to plan 224 Task 8:** memory-system now has **374 lines**: root 183; core 164; core/fabric 8; core/postgres 14; core/sqlite 5. Knowledge has **216 lines**: rag 168; wiki 48. Removed `arnilo__prism-memory-core.txt`; retained the 0.12 wiki/rag baselines for the ledger. After mapped subpath prefixes and import rewrites, knowledge is identical and memory has one inherited additive difference: `MemoryWorkerLoopOptions.endAfterCleanTurn?: boolean` was already present in the pre-task working tree but absent from HEAD’s baseline. This task does not implement that memory change. No export was removed. All three former names remain retired through `formerName`; memory-system remains live; the standing sweep reports **0 hits**.
      ```diff
      - arnilo__prism-memory-core.txt: . <export>\t<signature>
      + arnilo__prism-memory-system.txt: ./core <export>\t<signature>
      - arnilo__prism-memory-core.txt: ./<store> <export>\t<signature>
      + arnilo__prism-memory-system.txt: ./core/<store> <export>\t<signature>
      - arnilo__prism-{rag,wiki}.txt: . <export>\t<signature>
      + arnilo__prism-knowledge.txt: ./{rag,wiki} <export>\t<signature>
      ```
    - **Cache pin re-attested.** Two isolated captures of the actual dirty working tree before these edits and two of the final product are deterministic. **54/54 provider requests are byte-identical**, for both `preset-r1` and `passive-only`; no arm requires rerun for this consolidation. The report explicitly records same-checkout snapshots, source/harness/supporting fingerprints and the unchanged HEAD, rather than claiming a committed pre-task base. `readiness.mjs --cache-stability` reports **27 pass / 0 fail**, and `assertCacheStabilityPin()` accepts the final source. This does not supersede the historical plan 202/216 behavioral differences, refresh paid runs, or permit mixing historical screen evidence. Fingerprints in readiness/replay continue to derive from the unchanged source directories and invalidate naturally when their bytes change; no historical manifest hash was rewritten.
    - **Small prerequisites found by regression checks.** Missing package metadata introduced in Task 3 was outside `importDefinition`’s error boundary and leaked `ENOENT` instead of `ManifestError("import_failed")`. Extended the existing boundary around metadata and resolution while preserving intentional manifest errors; the three retired-package failures and manifest load/install/maintain tests pass. Kernel source remains **41,007 lines**, at its unchanged ceiling. Updated package counts, historical-versus-current docs expectations and leaf-manifest assertions. Retirement guards exempt the canonical retirement ledger and exact historical replay/negative-control fixtures, retaining live-import checks. The post-publish smoke now names npm roots and uses experimental versions for experimental bundles; Task 9 still owns its complete registry/local pipeline proof.
    - **Packing and verification.** The new failing-first bundle checks failed **3/3** before implementation and now pass. Final memory pack: **402,826 packed / 1,490,187 unpacked bytes / 124 files**; knowledge: **127,086 / 464,919 / 66 files**, within their new measured 5% budget bands. `release.mjs pack` emits exactly seven tarballs, with both experimental versions; `publishArgs` selects `experimental`. Passing: root typecheck; frozen-lockfile install (no changes); memory **758 pass / 29 environment-gated skips**; knowledge **186 pass / 4 skips**; reference host **66 pass / 1 live skip**; bundle/packaging/exports/release/truth/version/retirement acceptance **182 pass**; connected docs/kit/release/manifest regressions **167 pass**, plus **39 pass** after the final error-boundary refactor; benchmark checks **164 pass** and readiness **11 pass**; full packed-surface/host-completeness journey **5 pass**. The regenerated host-builder index is fresh and offline kit evals report `no-claims`. Formatting covered 239 affected code/config files; lint exits 0 with existing warnings; `git diff --check` is clean. The final direct `runGates({ release: loadRelease(), version: "0.13.0" })` passes all seven package gates with **`updated: false`**, without changing a kernel budget or compatibility threshold.
    - **Release limitation and handoff.** The official `bun scripts/release.mjs gate --update-baseline` was attempted and stops before package gates because existing release evidence lacks `PRISM_TEST_POSTGRES_URL` durable-conformance proof. Its package-gate implementation was run directly for baseline generation and the final plain check; the evidence requirement was not bypassed in the release CLI or changed. Full SDK readiness, PostgreSQL/protected/live-provider legs, registry smoke and publication are not claimed. Tasks 9–10 remain unchecked.

- [x] Task 9: Whole-tree proof and the seven-name release pipeline
  - Acceptance Criteria:
    - Functional: Resolve the Task 6 broader-check findings before claiming SDK readiness: stale coverage artifact names/missing provider rows (regenerate measurements while preserving directory floors), and the unchanged context-history timing ceiling under an isolated run. Task 7 resolved the reference-host denied-write approval invariant with a blocked-versus-executed regression test. Do not rewrite eval baselines or weaken thresholds to hide failures.
    - Functional: `packages/` holds exactly the six bundle directories. Root `workspaces` is `["packages/*", "apps/*"]`. `loadRelease` returns seven units, and `bun scripts/package-truth.mjs --emit-docs` regenerates the counts line (seven publishable manifests).
    - Functional: **Sweep.**
      - `bun scripts/retired-names.mjs --generate` followed by `bun test scripts/retired-names.test.mjs` is green: none of the 49 former names appears in `src/ packages/ apps/ scripts/ examples/ docs/` outside the sweep's exclusions.
      - Audit `git grep` for `@arnilo/prism-(provider|tools|store|memory-core)-` against the standing sweep’s live corpus and exclusions; historical evidence, negative controls, compatibility baselines and retirement metadata retain their old names. No live import remains.
    - Functional: **Packed consumers.** `scripts/fixtures/packed-consumer.mjs`, or a new `scripts/bundles-packed.test.mjs`:
      - installs each of the seven tarballs into a temp project with `--ignore-scripts`;
      - imports one `kind: "package"` subpath per capability bundle and runs it on the mock provider through `createAgent`; the kernel supplies the agent and the library-only hosts bundle composes its headless UI with a mock agent;
      - runs `prism add <bundle>/<subpath>` against the packed tarball (`file:`, through Task 3's `packFrom` seam) for one stable and one experimental bundle;
      - checks that the manifest entry name is the specifier.
    - Functional: Repair the inherited broader-suite findings recorded in Tasks 4–5 (workflow/tag assertions and historical package/cache and reserved-episode fixtures; the reference-host approval scorer finding was resolved in Task 7) before treating the whole-tree verification as green. Preserve the OIDC publishing decision from plan 215 Task 38 when reconciling pipeline tests.
    - Functional: Task 8 proved the seven package gates and local full-surface packed journey, but the release CLI still requires current PostgreSQL durable-conformance evidence. Re-run the official gate with that evidence. Finish the post-publish smoke’s local tarball dependency closure and remaining Office-manifest paths, then prove local mode and the registry code path against a read-only loopback registry serving the current tarballs. The public npm registry smoke belongs to Task 10 after publication; Task 8 only corrected the npm-root list and experimental version selection.
    - Functional: **Release pipeline at seven names.**
      - `scripts/registry-cleanup.mjs --trusted-publishers` prints the seven names and marks the six never published.
      - `docs/release.md`'s owner checklist and bootstrap paragraph name six first publishes instead of 51.
      - `scripts/post-publish-smoke.mjs` installs `@arnilo/prism@0.13.0` with one stable bundle subpath, and `@arnilo/prism-memory-system@experimental` for the experimental leg (plan 215 Task 39 inputs 2–3).
      - `.github/workflows/release.yml` filters and the `publish` dependency order follow `scripts/bundles.json`: kernel, extensions, ai, tools, hosts, memory-system, knowledge.
      - `scripts/registry-deprecate.mjs --generate && --dry-run` reports nothing to apply for the 50 former names, since they were never published at 0.13.
    - Functional: `scripts/deprecations-0.13.json` and `docs/migrate-to-0.13.md` map each 0.12 name to its bundle specifier. The ledger keeps the retired 0.12 names, as plan 215 Task 37's note requires.
    - Functional: `bun scripts/release.mjs gate` exits 0 after any baseline or budget update this task makes, with the diff attributed.
    - Performance: The note records each tarball's packed and unpacked size, and the on-disk install footprint per bundle without optional peers, against the budget rows Tasks 4–8 added. Release pack time is recorded against the existing 900-second pack deadline. Plan 215 Task 38 contains no isolated pack-time measurement or pack-time budget row, so record the first seven-bundle timing without claiming a retrospective relative comparison.
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
      - `scripts/bundles-packed.test.mjs` and `scripts/post-publish-smoke.test.mjs` (new), reusing `scripts/fixtures/packed-consumer.mjs`
      - `scripts/run-all-tests.mjs` and its test (serial timing benchmarks); coverage measurements, bundle export/non-null ownership budgets, affected boundary/fixture assertions and formatting/lint repairs; regenerated host-builder indexes and source-bound cache attestation
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

  - Notes (executed 2026-11-11):
    - **Seven-name pipeline implemented.** Bundle-map `publishOrder` metadata drives the dependency-respecting release order: kernel → extensions → ai → tools → hosts → memory-system → knowledge. The existing workflow filters already name bundle roots; its attestation and checksum globs cover the seven outputs from a fresh staging directory. npm OIDC remains the publisher; no token or Bun-publish fallback was introduced. The trusted-publisher CLI now reports the Set’s size correctly and its anonymous inventory lists **seven names, six never published**. The owner checklist names all seven and the six manual bootstrap publishes.
    - **Packed consumers and smoke.** New `bundles-packed.test.mjs` installs all seven tarballs with `--ignore-scripts`, runs a package from each capability bundle on the mock provider, composes the library-only hosts bundle with an agent, and uses `install(..., { packFrom })` for stable approval and experimental wiki entries, checking their complete specifier names. The hosts bundle has no `kind: "package"` entry; the acceptance text now reflects its library contract. The post-publish smoke reuses the existing packed dependency-closure helper, reads assets and peer declarations from the tools bundle root, explicitly installs the Office peers needed by direct library imports, leaves anydoc absent for its negative control, then verifies the opt-in ODT conversion. Registry specs use `@experimental` for both experimental bundles. Both local mode and the real registry-install branch pass; the latter downloads current tarballs from a read-only loopback npm fixture. Public npm smoke remains Task 10, after these versions exist. The mock run must complete with the exact expected text. Subcommands have finite timeouts; the registry test watchdog terminates the whole child process group, including installers and output pipes. Review reproduced the previous timeout leak and verified the fix.
    - **Inherited whole-tree repairs.** Updated leaf-manifest/count/peer assertions, bundle surface coverage annotations, historical cache-source mappings, legacy-registry negative controls, template package names, retired-shape discovery, migration fixture exclusions and historical evidence-path reconciliation. Old evidence results and eval scores were not rewritten. The dead-export verifier now reads subpath-prefixed compat baselines and explicitly classifies the ten newly observed retained candidates. No API was removed. Whole-tree formatting and lint cleanup resolve the existing style/unused-binding diagnostics; the deliberate hostile HTML sanitizer fixture has two narrowly scoped lint exceptions, preserving its attack bytes and sanitizer tests.
    - **Fixed limits retained.** The pre-task HEAD measured **2,700** non-null assertions against the inherited **2,225** cap; after explicit existence checks and narrowed locals the final tree measures **2,201**, with zero sites outside the allowlist. The cap and existing root/provider/examples ceilings were kept; obsolete directory rows were replaced with current ownership measurements. Bundle export-count budgets now cover exactly the seven npm units, using aggregate source exports rather than stale leaf keys. The kernel’s physical source-line ceiling changes **41,007 → 41,113** for formatter line wrapping and lint cleanup, with no new kernel capability or public export. No declaration baseline changed in Task 9. Coverage floors, statistical/eval rules and timing ceilings were not relaxed.
    - **Timing-test isolation.** Existing benchmark files and the memory harness checks now run exactly once in a serial timing stage, outside concurrent gate workers. This fixes host-contention failures of the unchanged context-history and session-turn growth ceilings. A separate TTL regression used a 1 ms wall-clock window; an explicit mocked monotonic clock now proves expiry and renewal deterministically, preserving all store-read assertions. The runner has a regression check for exactly-once inclusion and absence of a parallel flag.
    - **Cache attestation.** Two captures before whole-tree formatting and two of the final product are deterministic: **54/54 answer-phase provider requests are byte-identical**, for `preset-r1` and `passive-only`. The same-checkout report records actual source/harness/supporting fingerprints and the unchanged HEAD; it does not substitute a committed baseline, refresh paid runs or merge historical screen cells. The refreshed cache pin reports **27 pass / 0 fail**. Host-builder indexes and their input lock were regenerated; the criteria hash and evaluation thresholds are unchanged.
    - **Retirement/registry proof.** Regenerated the standing ledger and passed all six sweep tests. Anonymous GETs returned **404 for all 50 former workspace names**. Registry deprecation generation/dry-run reports **33 unpublished entries, zero problems and nothing to apply**; no registry mutation occurred. Raw `git grep` has 1,063 hits across the broad paths, all accounted for by the standing sweep’s historical evidence, tests, baselines, retirement metadata and retirement prose exclusions; it is not falsely reported as a zero-hit raw search. The live-tree sweep remains the authority.
    - **Coverage/evidence complete.** Regenerated the core and all **50 source-unit coverage rows**, including every provider; `belowThreshold` is empty. Core: **93.28% lines / 94.13% functions**, above unchanged 91.48/92.21 floors. Added meaningful missing-behavior regressions for context-file limit/orphan/move handling (**96.05% ≥ 95.99%**), credential-slot-backed Codex discovery/error redaction (**96.50% ≥ 93.50%**), MCP resource boundaries and permissions (**95.98% ≥ 94.68%**), wiki human edits/quarantine/path validation (**95.99% ≥ 90.12%**), and browser scrolling/snapshot invalidation (**81.80% ≥ 80.04%**). The coverage negative control’s stale AG-UI npm-name regex was corrected. Coverage/skip-manifest guards pass **25/25**, retaining below-floor and missing-evidence failure controls.
    - **Release evidence no longer loses bundle subpaths.** The old npm-root discovery silently omitted source suite rows and wrappers using the shared provider live registrar. The emitter now reuses `packagePages` from the bundle map, requires source-unit coverage even when an artifact row is absent, and names every provider’s protected live legs. Its **74 surfaces / 50 suite rows / 11 provider live-leg rows** have `blocked: false` with actual current PostgreSQL evidence. Tests compare every public coverage unit and provider against the map, delete a subpath’s artifact row, and prove the gate blocks. Live rows remain protected declarations, never fabricated live passes. The stale CodeQL guard reads the published TypeScript primitive instead of the retired `dist/` file; its unchanged one-million-slash/250 ms and no-regex checks pass. Updated the release skill reference and test wording to preserve npm OIDC provenance.
    - **Final verification.** The whole-tree test runner passed **all nine stages** (build, performance budget, serial timing benchmarks, root, gates, build-race, workspaces, examples and branch-coverage audit); later test-only additions passed their owning suites and full coverage measurement. Final root typecheck, lint (**zero diagnostics**), format check and `git diff --check` pass. The final focused bundle/packed/registry/coverage/workflow/release checks pass **84 tests**; the coverage evidence guards additionally pass **25/25** after the emitter fix; budget guards pass **20/20** and threat suites **52/52**. Local post-publish smoke and the loopback registry smoke pass, including optional ODT extraction. Package truth and the retirement ledger are regenerated; the sweep passes. Offline skill evals report ship; offline host-builder evals report `no-claims`; indexes are fresh and the current cache pin is accepted. Isolated 10,000-entry context-history p95 is **437.521 ms**, below the unchanged **1,000 ms** ceiling. Fresh local PostgreSQL durable conformance: **57 pass / 0 fail**. Both `bun run release:gate` and the plain official `bun scripts/release.mjs gate` exit **0**, reporting **seven packages / `updated: false`**. Pack dry-run succeeds; every one of the seven packed tarballs also passes the actual npm `publish --dry-run` path with its proper tag.
    - **Measured artifacts (bytes).** Fresh staging contains exactly seven tarballs and seven checksum entries. Every clean consumer uses `--ignore-scripts`; optional third-party peers are explicitly absent. Install sizes include required first-party peers and external dependencies. Existing bundle packed/unpacked budget bands and the tools install ceiling pass; the kernel passes its explicit ceilings. Final seven-unit pack wall time: **623.274 ms**, within the existing 900-second command limit. Task 38 has no isolated pack-time baseline, so no retrospective speed comparison is claimed.

      | npm unit | Packed | Unpacked | Minimal install |
      | --- | ---: | ---: | ---: |
      | `@arnilo/prism` | 1,259,789 | 4,086,699 | 4,086,821 |
      | `@arnilo/prism-extensions` | 484,222 | 1,979,041 | 6,065,957 |
      | `@arnilo/prism-ai` | 107,992 | 393,129 | 4,480,045 |
      | `@arnilo/prism-tools` | 589,721 | 2,372,828 | 21,417,702 |
      | `@arnilo/prism-hosts` | 859,766 | 3,890,291 | 9,956,457 |
      | `@arnilo/prism-memory-system` | 402,828 | 1,490,378 | 5,577,294 |
      | `@arnilo/prism-knowledge` | 127,086 | 464,919 | 6,042,308 |

    - **Task 10 handoff / verification limits.** No commit, tag, publication, deprecation, paid-provider run or scored live evaluation was performed. Proof uses the existing dirty checkout; Task 10 must repeat preflight on its clean release commit. SDK readiness was checked in the CI phase arrangement, keeping PostgreSQL scoped to the durable/release legs. An earlier `sdk:ready` attempt with PostgreSQL ambient also selected experimental vector tests against a server without pgvector; that unsuccessful attempt is not claimed as a pass. Declared native/OS/live/experimental-vector exceptions remain explicit; no threshold was lowered to absorb them. Use a **fresh release-artifact staging directory** for Task 10: this checkout already contained tarballs from older releases, which were left intact. The real npm registry smoke, GitHub attestation/provenance verification, six bootstrap publishes and owner approvals remain Task 10; memory/ontology source fingerprints continue to invalidate naturally when tests or source change, without rewriting historical screening manifests.

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
      - SDK readiness exits 0 using `release.yml`'s phase arrangement: typecheck, lint, format, test, coverage and pack dry-run without ambient PostgreSQL, then `release:gate` with the durable URL/evidence. This is the same readiness chain as `bun run sdk:ready`, with PostgreSQL scoped as the existing CI workflow requires; no test, threshold or phase is omitted.
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
      - `scripts/independent-packages.json` lists `@arnilo/prism-ai`, `@arnilo/prism-tools` and `@arnilo/prism-extensions` as independent.
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

  - Notes (execution started 2026-11-11; release pending):
    - **Owner decisions in this session:** use the entire current checkout, including memory-track changes, as the release snapshot; keep the existing cache-parity gate and require a pass. The historical Ollama Cloud `behind` result is not waived. These decisions do not assert live acceptance, bootstrap, trusted-publisher configuration, or publication succeeded.
    - **Preflight repairs:** restored the OpenRouter deprecation message's required migration anchor. Split two synthetic secret-shaped test literals without changing their values; the tracked/untracked candidate scan then passed (5,543 files, zero findings). Refreshed the skill-eval registration after confirming the criteria diff changes only bundle specifiers and the delegate directory; decision thresholds are unchanged and historical scored results are not reclassified.
    - **Initial checks:** root/workspace/examples typecheck, lint, format check, diff whitespace check, and 81 release/workflow/deprecation tests pass. Anonymous trusted-publisher inventory still lists six never-published bundles. Deprecation generation finds all 33 listed names unpublished and emits zero entries; the subsequent dry-run reports zero problems and nothing to apply. No registry mutation occurred.
    - **Live prerequisites:** providers preflight exits 2 for missing TypeSafe, Laya, Liquid, local Liquid and Codex credentials/flags and the unstarted LiteLLM pool; the prior owner scope remains recorded in the acceptance report. With `PRISM_LIVE_RELEASE_JOURNEY=1 PRISM_LIVE_CACHE_PARITY=1`, the journey/cache preflight with probes exits 0 (Command Code: 97 models; Ollama Cloud: 23 models; pi and both extensions ready). Strict live results on the release candidate remain to be recorded.
    - **Status:** Task 10 remains unchecked. Keep the initial-cut versioning configuration, shipped baseline and Phase 11 status until publication and registry verification succeed; no Phase 11 Done proof is claimed.
    - **Owner scope amendment and successful live follow-ups:** the owner permits ignoring Hyper's credit-blocked tests, requests a free Kilo model, and explicitly requires OpenCode Go to pass. After the owner reset OpenCode Go's quota, all **12** tests pass with catalog models `mimo-v2.6-flash` / `qwen3.7-plus`. Kilo passes **20 tests / 3 separate warm-prefix-probe skips / 0 failures** on `nvidia/nemotron-3.5-super-vl:free` across Chat, Responses and Messages plus kernel smoke sessions. Existing model overrides were used; defaults were not rewritten. Command Code, Ollama Cloud and OpenRouter passed in the initial candidate run. All four cache-parity cells pass on their first attempt (**176 requests**, unchanged gate), and both strict release journeys pass. The six earlier scope exclusions remain recorded. Reports and both failed and successful attempts are retained in `docs/_evidence/live-release-acceptance-0.13.0/`; the acceptance document distinguishes the historical unscoped failure from the scoped pass. Owner signature remains pending.
    - **Further preflight repairs:** two PostgreSQL navigation tests still expected keyword enrichment retired by plan 210 Task 7; their assertions now prove keyword absence, content/session persistence and unmatched-term feedback (**5/5 pass**). The retirement sweep now excludes only the host-builder's generated `examples/.host-builder-kit-*` scratch directories, with a regression proving ordinary source remains covered (**18 tests pass** with the host-builder suite). The governance performance file passes in isolation (**25/25**) and now runs once in the existing serial timing stage, excluded from the concurrent extensions leaf; runner checks pass **19/19**. No product API, baseline, timing ceiling or coverage floor changed.
    - **Readiness execution profile:** ambient PostgreSQL enabled optional integrations during ordinary workspace tests and exposed timing failures; the full command is not claimed as green. The final check uses `release.yml`'s existing phase arrangement: typecheck, lint, format, test, coverage and pack dry-run without ambient PostgreSQL; actual PostgreSQL evidence and the real URL are scoped to durable verification and `release:gate`. Durable conformance is **57 pass / 0 fail**, recorded on candidate `2cd2b553`. Earlier failed readiness attempts remain failures, including the markdown ratio and hard-deny timing observations; thresholds were not relaxed.
    - **Bootstrap preparation gap fixed:** previously a manual `release.yml` run skipped both security and the artifact-producing job, so it could not supply the CI-packed tarballs required before the tag. Manual runs now execute all prerequisites and the existing protected pack/attest/upload job, while the registry-write step has its own tag-only guard. Tests prove a manual branch run prepares artifacts and cannot publish (**56 workflow/release tests pass**). The owner bootstrap instructions now use `npm publish <tarball>` with the correct tag and 2FA, rather than the release CLI that requires an existing release tag. Current GitHub Actions docs were verified with Context7. No token fallback or extra publishing path was introduced.
    - **Artifact preview:** `/tmp/prism-task10-2cd2b553-5kiwd8hf` contains seven tarballs plus `SHA256SUMS`; pack wall time **0.669 seconds**. All seven pass npm's actual publish dry-run, stable names on `latest` and both `0.13.0-experimental.0` bundles on `experimental`. Packed bytes in bundle dependency order: kernel **1,259,789**, extensions **484,222**, ai **107,991**, tools **589,721**, hosts **859,766**, memory-system **402,828**, knowledge **127,086**. These are local previews, not CI attestations or published artifacts. Anonymous registry checks still report kernel `latest: 0.12.1`, no kernel 0.13.0, and 404 for all six bundles.
    - **Index reconciliation:** sixteen prerequisite rows still said `planned` despite completed task records; they now say complete. Plan 180 is recorded as closed through supersession by 186, then 215. Plan 188 stays closed at Task 13; its dropped Task 14 is not falsely checked. Plans 198/200 still require their recorded broad-verification closure. Repository `NPM_TOKEN` is absent; registry-side revocation and trusted-publisher setup are not inferred from that check.
    - **Readiness proof complete:** all eight CI-profile phases exit 0, including all nine full-test runner stages, freshly measured coverage with unchanged floors, pack dry-run, the official release gate (**seven packages / `updated: false`**) and **52/52** threat-suite tests. The field-policy benchmark runs exactly once. This resolves plans 198 and 200's broad-verification handoffs using the current bundle equivalents of their historical leaf-name commands; their plan notes, index rows and four existing backlog entries record the closure without deleting historical findings. All thirty prerequisite index rows now read complete or closed; the six superseded rows and plan 215's Task 38 closure are retained. Logs: `/tmp/prism-task10-ci-profile.log`; earlier failed attempts remain in the other `/tmp/prism-task10-sdk-ready*.log` captures. Final clean-commit CI execution, owner live-evidence sign-off, six bootstrap publishes, trusted-publisher setup and the tag/publish sequence are next.
    - **First remote preparation attempt:** candidate `3101dfac` is pushed on `upgrade/packages`. Manual run <https://github.com/ashiqrniloy/prism/actions/runs/43011606680> fails at workflow validation before creating jobs: the reusable security workflow's dependency-review leaf requests `pull-requests: read`, missing from its caller's permission ceiling even when that leaf is skipped. Added only that read permission to the caller, documented the reason, and added a regression for the exact startup error. Fresh durable conformance on `3101dfac` is **57/57**; the plain official release gate again reports **seven packages / `updated: false`**. No CI artifacts, bootstrap, tag or registry mutation resulted from the failed run.

## Verification (whole plan)

- `timeout 300 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun test --timeout=0 src/__tests__/manifest-install.test.ts src/__tests__/manifest-load.test.ts src/__tests__/manifest-integrity.test.ts src/__tests__/manifest-format.test.ts src/__tests__/manifest-maintain.test.ts src/__tests__/cli-manifest.test.ts src/__tests__/package-loader.test.ts src/__tests__/packaging.test.ts src/__tests__/experimental-boundary.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/release.test.ts src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/bundles.test.mjs scripts/bundles-packed.test.mjs scripts/retired-names.test.mjs scripts/import-hygiene.test.mjs scripts/package-truth.test.mjs scripts/release-gate.test.mjs scripts/registry-cleanup.test.mjs scripts/registry-deprecate.test.mjs scripts/workflow-liveness.test.mjs scripts/host-builder-index.test.mjs`
- `timeout 900 bun run --filter @arnilo/prism-ai --filter @arnilo/prism-tools --filter @arnilo/prism-extensions --filter @arnilo/prism-hosts --filter @arnilo/prism-memory-system --filter @arnilo/prism-knowledge --filter @arnilo/prism-agent test`
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
