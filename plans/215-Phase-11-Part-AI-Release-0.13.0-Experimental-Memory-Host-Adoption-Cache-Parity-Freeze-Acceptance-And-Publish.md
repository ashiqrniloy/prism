# Phase 11 Part AI — release 0.13.0: experimental memory, host adoption, cache parity, surface freeze, live acceptance and publish

> **Closed at Task 38 (owner decision, 2026-11-09).** After Task 37 the tree would have published 52 npm names. The owner chose to publish seven instead: the kernel plus six bundles, where each former package becomes a subpath of a bundle (`@arnilo/prism-tools/web`) and is still listed and loaded per host. The consolidation and the remaining publishing work moved to [plan 224](224-Phase-11-Part-AJ-Release-0.13.0-Package-Consolidation-Seven-Bundles-And-Publish.md):
> - Task 39 is carried as plan 224 Task 10, with its criteria intact except for bundle names and counts.
> - The owner-side setup Task 38 left open (six bootstrap first publishes instead of 51, the trusted-publisher entries, the token ban, revoking `NPM_TOKEN`) is part of plan 224 Tasks 9–10.
> - Plan 215's own plan end (`Compromises Made`, `Further Actions` and the backlog handoff) runs in plan 224 Task 10.
>
> Tasks 1–38 stand as executed. The package names in this plan's text are the pre-consolidation names; plan 224's bundle map is the authority for what ships.

## Objectives

- Ship 0.13.0 with a stable agent core (the kernel, the nine shipped providers, tools, integrations, policy, stores, host libraries and `@arnilo/prism-memory-compaction`) without waiting for the memory audit. Hosts can then build on the core now.
- Publish the five memory packages (`@arnilo/prism-memory-{core,observational,fabric,wiki,rag}`) on an **experimental prerelease line** (`0.13.0-experimental.N`, npm dist-tag `experimental`). The line is outside the stability promise, so the memory track (plans 209–210) can still change or remove features after 0.13.0 without breaking a stable contract.
- Keep every stable package and the reference host's default agents free of experimental packages, and enforce that with a gate.
- Ship host adoption: package skills with `requiresTools` and their gate (ex-plan 211, minus the memory skills), and the host-builder kit (ex-plan 212).
- Prove prompt-cache parity, reduce and freeze the public surface, run live release acceptance on Hyper and OpenCode Go, and publish (ex-plans 184–187).
- Replace the scattered release path with this one plan. The superseded plans keep their history; their open tasks live here.

## Expected Outcome

- `scripts/independent-packages.json` names the five memory packages under `experimental`. They carry `0.13.0-experimental.0`. `bun scripts/release.mjs` publishes them with `--tag experimental`, never `latest`, and the compat gate reports their changes without failing.
- `stable_packages_never_depend_on_experimental` passes. `@arnilo/prism-observability` no longer imports from `@arnilo/prism-memory-rag`, and the reference host's coding and research workers load no memory package unless `memory` is set.
- The five memory READMEs, `docs/index.md`, `PRODUCT.md` and `roadmap.md` say the memory packages are experimental in 0.13.0 and how to install them.
- `Skill.requiresTools`, `package_skills_conform`, package skills for web, coding, browser and delegation (per the Task 5 ledger; OpenAPI is description only), `skillResources()`, and per-skill paired evidence in `docs/_evidence/skill-evals/211/`.
- `@arnilo/prism-host-builder` with its skill, indexes, stdio MCP server, host checks, installer, example, drift gate and builder evidence in `docs/_evidence/host-builder/212/`.
- `docs/_evidence/cache-parity-0.13.0.md` with Prism ≥ pi on every enabled conclusive cell.
- A reduced, shape-frozen public surface with `@arnilo/prism/net` and `@arnilo/prism/artifacts`, and `docs/compatibility.md`.
- `docs/_evidence/live-release-acceptance-0.13.0.md`, signed by the owner.
- A reviewed and cleaned CI and release gate locked by the CI-integrity checks in `scripts/workflow-liveness.test.mjs`; the deprecated `@arnilo` packages deleted from npm (or deprecated where npm's unpublish policy refuses), with before/after evidence; publishing through npm trusted publishing (OIDC) behind a protected environment, with no npm token in CI and tokens disallowed on every package.
- `@arnilo/prism` 0.13.0 and the stable packages published on `latest`, the memory packages on `experimental`, the deprecations applied, and independent versioning on.

**0.13.0 release path — the single remaining release plan, run alongside plan 208.** It can start at once: it consumes no plan 208 result, because 208's default and claims decisions moved to plan 210 and the ontology tier ships opt-in inside the experimental `memory-wiki` either way (owner decision 2026-11-04). Running the two together has three conditions:
- **Isolation.** Plan 208 Task 5's paid screen runs from a dedicated git worktree at a pinned commit, with the current 208 work committed first. The screen's product hash covers only `packages/memory/{core,fabric,wiki}/src` and `scripts/memory-bench` (`scripts/memory-bench/audit/readiness.mjs:438`, `scripts/memory-bench/replay.mjs:1137`), not the kernel. This plan's kernel edits (Tasks 6, 26, 27, 29) and wiki edits (Tasks 6–7) would otherwise silently change, or invalidate, a running screen.
- **Merges.** Plan 208 Task 8 (portable `wiki_ingest` schema) and Tasks 6–7 here both edit `packages/memory/wiki/src`. Whichever lands second rebases onto the other.
- **Memory track branch (owner, 2026-11-05).** Plans 209 and 210 run on the branch `experiment/memory`. This plan follows `main` and publishes 0.13.0 without that branch, so no task here may wait on or import work from it. Plan 208 and plan 210 Task 3.1's first build are already on `main` (commit `74bf7598`) and ship as they stand in the experimental memory line. A memory fix the release needs is made on `main`; the branch takes it by merging `main`. Nothing from `experiment/memory` reaches a release without a separate owner decision.
- **Publish prerequisite.** Plan 208 Task 8 lands before Task 39 publishes, so the experimental `memory-wiki` ships the portable schema. Task 5's screen may still be running at publish time, from its worktree. It replaces steps 17e–21 of the old path (plans 209, 210, 211, 212, 184, 185, 186, 187) and is the last plan before 0.13.0 ships. Its tasks run strictly in number order, and nothing runs in parallel. This is the publish part of roadmap **Phase 11**, so the memory prerelease versions (Task 2) and the publish (Task 39) belong here.

**Review tasks.** The plan creates a package and changes kernel contracts (`Skill.requiresTools`, the root export surface, credential shapes, store forward compatibility), so it carries five read-only reviews, one at the head of each part:
- Task 1: the experimental line;
- Task 5: module skills;
- Task 13: the host-builder kit;
- Task 21: the pi reference;
- Task 25: the surface freeze entry check.

**Owner gates (paid or outward-facing):**
- Task 11: skill evals;
- Task 20: builder evals;
- Task 24: the parity run;
- Task 34: the first acceptance run;
- Task 37: the registry cleanup (irreversible unpublishes, run by the owner with 2FA);
- Task 38: the trusted-publisher setup and token revocation (owner, on npmjs.com and GitHub);
- Task 39: the tag push and the remaining deprecations, each confirmed separately.

Live work stays on Hyper and OpenCode Go and never uses `openrouter/free` or `openrouter/auto`. Keys stay in `~/.config/prism/live.env` (`PRISM_LIVE_ENV_FILE`) and are never asked for in chat. Memory stays non-RAG: no task adds embeddings.

**Tasks 5–36 were carried over from the superseded plans with their criteria intact.** Each title names its source. Cross-references were renumbered to this plan. Facts that the old plans spread across dated amendment paragraphs are consolidated in the next section. Where a carried task conflicts with that section, the section wins.

**Standing rule from Task 14 onward.** Any task that renames, removes or reshapes a public export also updates the host-builder kit (`bun scripts/host-builder-index.mjs` plus the skill text) in the same task, because `host_builder_kit_matches_surface` fails otherwise. Tasks 26–29 are bound by it.

## Release facts (consolidated from the superseded plans' amendments)

### Package sets

| Set | Packages | Version and tag at publish |
| --- | --- | --- |
| Stable providers (nine) | `hyper`, `opencode-go`, `typesafe` (Jev), `laya`, `liquid`, `openrouter` (reused name, deprecated `<0.13.0`), `openai-codex`, `kilo`, `litellm` | 0.13.0, `latest` |
| In-tree providers, not published at 0.13.0 | `commandcode` (plan 205), `ollama-cloud` (plan 206) | none; they publish after 0.13.0 |
| Stable memory | `@arnilo/prism-memory-compaction` | 0.13.0, `latest` |
| Experimental memory | `@arnilo/prism-memory-{core,observational,fabric,wiki,rag}` | `0.13.0-experimental.N`, `experimental` (Task 2) |
| Host-builder | `@arnilo/prism-host-builder` (new, Task 14) | 0.13.0, `latest`, stays on the kernel's line |
| Everything else publishable | kernel, tools, integrations, policy, stores, context, credentials, drivers, host libraries | 0.13.0, `latest` |

- **Freeze set (Tasks 25–29):** every in-tree publishable package, including `commandcode` and `ollama-cloud`, which are in the tree at freeze time. Experimental packages get baselines, but their changes never fail the gate (Task 2).
- **`SecretSource` migration (Task 27):** ten provider packages, `{hyper, opencode-go, typesafe, laya, liquid, openrouter, kilo, litellm, commandcode, ollama-cloud}`, plus the kit, `packages/tools/web` and `packages/hosts/channels`. `openai-codex` already resolves through the credentials slot; only its low-level factory and discovery `apiKey` options moved to `SecretSource` (amended 2026-11-08 by Task 27's execution, which migrated all eleven packages). Its `CredentialRefNotWritableError` and `CredentialStoreUnavailableError` kernel exports are frozen. Kilo's request path keeps `resolveApiKey`. Observability's `propagateTraceContext` and `usageMetadata` config additions (plan 214) are frozen.

### Live tiers

- **T1 rows that gate 0.13.0 (ten).** One row per stable provider: `providers/{hyper,opencode-go,typesafe,laya,liquid,liquid-local,openrouter,openai-codex,kilo,litellm}`, where `liquid` has a hosted row and a local row. Each decision provider (Jev, Laya, d1-ultra, d1-3B) passes its `decide` row as well as its `generate` row.
  - `openai-codex` uses an OS keyring grant (`keyring:openai-codex`), not an env key.
  - `kilo` requires `KILO_API_KEY`, and the owner approves its device login.
  - `litellm` runs on the local proxy pool (`scripts/litellm/up.mjs`, zero-cost models).
  - `openrouter` keeps its pinned free-model default, and its paid cache leg is separately gated by `PRISM_LIVE_OPENROUTER_PAID=1`.
- **Rows that run but do not gate 0.13.0:** `providers/commandcode` and `providers/ollama-cloud`. They gate their own post-0.13.0 releases (plans 205, 206).
- **Private `live.env` keys:** `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `OPENROUTER_API_KEY`, `KILO_API_KEY`, `LITELLM_API_KEY`, plus `LAYA_BASE_URL` and `PRISM_LIVE_LLAMA_SERVER_URL` for the local servers.
- **Memory has no live release row in 0.13.0.** Its claims are measured by the memory track (plan 210 Task 9). Ex-plan 186 scenario 11 (memory across sessions) is removed from the journey (Task 32), and its offline scenario stays in `bun run test`.

### Cache parity matrix (Tasks 21–24)

The gate is: Prism's median `hitRate` ≥ pi's on every enabled conclusive cell, with no `usage_mismatch`. The full three-run coding-task runner (Task 23) covers the Command Code and Ollama Cloud cells (owner amendment 2026-11-08; the Hyper and OpenCode Go cells are deferred to after 0.13.0). The other cells are four-request probe diagnostics (`scripts/cache-parity/provider-probe.mjs`) recorded by their provider plans. Task 24 re-records their status in the evidence file and does not re-run them unless their lever code changed.

| Cell | Prism | Reference | Status carried in |
| --- | --- | --- | --- |
| Hyper Chat / Hyper Messages | `hyper` | pi, same upstream model | deferred to after 0.13.0 (owner, 2026-11-08): no Hyper credits (402). Task 21 note has the pi facts. |
| OpenCode Go Chat / Messages | `opencode-go` | pi, same upstream model | deferred to after 0.13.0 (owner, 2026-11-08): monthly limit reached (429), `mimo-v2.5` deprecated. |
| OpenRouter Anthropic | `openrouter`, `anthropic/claude-haiku-4.5` | `pi -p --mode json --provider openrouter` | `unmeasurable` unless the owner authorizes paid use and sets `PRISM_LIVE_OPENROUTER_PAID=1` |
| OpenAI Codex (sanctioned route) | `openai-codex`, `gpt-6.1-sol` | pi `--provider openai` (Sign in with ChatGPT) | Prism probe reuse 0.983 (`docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json`). The pi side is `unmeasured` while `pi auth check --provider openai` is `not_ready`. |
| OpenAI Codex (first-party) | measured | `codex exec` and `codex exec resume` | Prism leads in every measured shape (0.981 vs 0.481–0.842; `docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json`) |
| Command Code Chat / Responses / Messages | `commandcode`, one model per wire (Task 21: `minimax/minimax-m3.1-flash`, `gpt-5.6-luna`, `claude-haiku-5-5`) | pi-commandcode-provider 0.8.0 | **to run (Task 24), 120 requests per cell** (owner, 2026-11-08: these accounts have balances). Plan 205: Prism ≈ pi, no lever gap. Not a 0.13.0 gate. |
| Kilo Chat / Responses / Messages | `kilo` | Kilo CLI 7.8.18 | Probe on the free model: Chat and Responses 0.506, Messages 0.337. The paid Responses and Messages cells are `unmeasured` (402 on the reference account). The CLI headless run on the plan-203 fixture is still owed (Task 24). |
| Ollama Cloud | `ollama-cloud`, `gemma4:31b` | pi-ollama-cloud 0.13.1 | **to run (Task 24), 120 requests per cell** in the coding-task runner; four-request probe already passes on both routes (`docs/_evidence/206-task3-cache-parity.md`). Not a 0.13.0 gate. |
| LiteLLM | `litellm` | none | no cell (owner decision 2026-10-31): information-only probe, no threshold |

OpenRouter never uses `openrouter/free` or `openrouter/auto` for parity. Prism runs through the reference host's **default** coding worker, which loads no memory package after Task 3. A fold batch or a compaction is an expected prefix change, not a regression (plan 194). Task 12 names the reference-host agent with package skills whose catalog the parity fixtures must include.

## What this plan supersedes

| Plan | Disposition (2026-11-04) |
| --- | --- |
| 184 cache parity | superseded by 215, with no task executed: Tasks 1–4 → Tasks 21–24 |
| 185 surface freeze | superseded by 215, with no task executed: Tasks 1–5 → Tasks 25–29 |
| 186 live acceptance | superseded by 215, with no task executed: Tasks 1–5 → Tasks 30–34. Scenario 11 dropped. |
| 187 sweep and publish | superseded by 215, with no task executed: Tasks 1–2 → Tasks 35 and 39. Tasks 36–38 are new: CI review, registry cleanup, trusted publishing. |
| 211 module skills | superseded by 215: Tasks 1–5 and 7–9 → Tasks 5–12. Task 6 (memory skills) → plan 210 Task 11. |
| 212 host-builder kit | superseded by 215: Tasks 1–8 → Tasks 13–20 |
| 209 working-agent memory | off the 0.13.0 path: post-0.13.0 memory track on branch `experiment/memory` (owner, 2026-11-05), unchanged content |
| 210 memory audit | off the 0.13.0 path: post-0.13.0 memory track on branch `experiment/memory` (owner, 2026-11-05). It gains Task 11 (ex-211 Task 6), and its Task 10 becomes the graduation from experimental to stable. |
| 208 three-tier evaluation | runs alongside this plan (2026-11-04): Task 5 from a pinned worktree; Task 8 lands before Task 39 |

## Tasks

### Part A — the experimental memory line (new)

- [x] Task 1: Experimental-line review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Memory coupling inventory.** Every non-memory manifest, source file, example and docs page that names one of the five experimental packages, from `timeout 60 graft grep "prism-memory-"` and a manifest walk. Known today:
        - `packages/integrations/observability/package.json` lists `memory-core` and `memory-rag` as `devDependencies`, but `src/rag-telemetry.ts:1` imports types from `@arnilo/prism-memory-rag` in published source;
        - `apps/prism-agent` (private) imports them in `src/host/coding.ts:8-10`, `src/host/research.ts:5-8`, `src/host/ontology.ts:2`, and `src/scenarios/{conversational-memory,ontology-memory}.ts`;
        - the kernel `src/` should import none of them; confirm it.
        Classify each hit as *stable consumer* (must be cut, Task 3), *private consumer* (reference host, examples, scripts: allowed), or *docs* (Task 4).
      - (b) **Release tooling facts** at `file:line`:
        - `scripts/release.mjs`: `parseSemver` drops the prerelease (`:198`), `cmpSemver` ignores it (`:203`), `satisfiesInternalRange` has no prerelease handling (`:212`), and `publishArgs` always passes `--tag latest` (`:401`);
        - the lockstep `validateRelease` skips independent-line packages (`:79`, `:98`, `:108`);
        - the independent path is `validateReleaseIndependent` (`:300`), with package tags checked in `assertGitState` (`:350`).
        - `.github/workflows/release.yml`: `:6` triggers on `v0.13.0` and `@arnilo/*@*`, but the publish step's lockstep branch (`:266`) lists tags only up to `v0.12.1`, so a `v0.13.0` tag currently takes the independent publish path. Record this as an input to Task 39, which must decide and test the 0.13.0 path.
      - (c) **Registry facts.** Use anonymous registry GETs with no auth. Record whether any of the five memory names exists on npm, with its versions and dist-tags. Use the find-docs skill, recording sources and dates, to check:
        - which dist-tags a first publish with `--tag experimental` leaves, in particular whether the registry also sets `latest` when none exists;
        - that the installed Bun's `bun publish` accepts `--tag`.
        If the registry sets `latest` to the prerelease on a first publish, record that the prerelease version string and the README notice are the experimental signal, and that Task 39 records the resulting dist-tags.
      - (d) **Reference host defaults.** The coding and research workers load `@arnilo/prism-memory-observational` unconditionally (`src/host/coding.ts:47`, `src/host/research.ts:55`) next to `memory-compaction`, with the `compaction` slot assigned to compaction (`coding.ts:36-37`). Record:
        - which scenarios and tests assert OM behavior on the default path (`long-session`, `one-shot-golden`, the plan 194 context-budget tests, golden prefixes);
        - whether `sessionCompactAtFor` is used anywhere except OM's config;
        - whether any safety floor depends on OM (expected: none; OM is context management).
        Task 3 moves OM under the `memory` opt-in on this evidence.
      - (e) **Gates that pin memory versions:**
        - `scripts/package-truth.json:27-32` and `scripts/package-truth.mjs`;
        - the `docs/index.md` version table (`:178-181`);
        - `scripts/version-literal-gate.test.mjs`;
        - `scripts/phase54-package-map.mjs`;
        - `src/__tests__/packaging.test.ts`;
        - `bun.lock`.
        Record each one's change in Task 2.
      - (f) **Verdict:** Tasks 2–4 proceed as written, or the plan is re-cut.
    - Performance: n/a (read-only).
    - Code Quality: No code or file changes outside this plan. Every fact cites `file:line`, a docs URL with a date, or a registry response.
    - Security: The registry checks are anonymous GETs. No token is read or written.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs`, `scripts/release-gates.mjs`, `.github/workflows/release.yml`, `scripts/independent-packages.json` (empty `packages` today), `docs/release.md`
      - `apps/prism-agent/src/host/{coding,research,config}.ts` (`config.memory` is the existing opt-in, `config.ts:37-38`)
      - plan 188.11 (stability tiers, preset contract), plan 210 Task 7 (experimental tier in `stability.test.ts`)
    - Options Considered:
      - **Hold the memory packages back from npm entirely.** Rejected by the owner (2026-11-04): hosts should be able to try memory now.
      - **Publish memory at 0.13.0 on `latest` with an "experimental" README note only.** Rejected: semver ranges (`^0.13.0`) would resolve it as stable, and plan 210's removals would then be breaking changes on a stable line.
      - **Separate npm names (`-experimental` suffix).** Rejected: the names would change again at graduation and break every host import.
    - Chosen Approach:
      - A prerelease line on the same names, under a non-`latest` dist-tag, enforced by tooling and a dependency gate.
    - API Notes and Examples:
      ```bash
      timeout 60 graft grep "prism-memory-"
      timeout 30 curl -s https://registry.npmjs.org/@arnilo%2fprism-memory-fabric | head -c 400
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - owner decision 2026-11-04 (memory experimental; 209–210 after 0.13.0)
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05, read-only; no file changed except this plan):
    - **(a) Coupling inventory.** `graft grep "prism-memory-"` (300 hits, truncated) plus a `git ls-files` walk for the five names (`core|observational|fabric|wiki|rag`) found 90 files outside the five packages, excluding `docs/history`, `docs/_evidence`, `plans`, `graft/` and `bun.lock`.
      - **Kernel `src/`: no import and no mention in non-test source.** The seven kernel test files that name a memory package (`agent-inspect`, `compaction-when-abstain`, `docs`, `install-smoke`, `packaging`, `public-export-contract`, `release`) are tests, which is allowed. `src/session/external-state.ts:7` says "observational" in a comment only.
      - **Stable consumers, which Task 3 must cut: one.** `packages/integrations/observability/src/rag-telemetry.ts:1` (`import type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "@arnilo/prism-memory-rag"`). `package.json:26-27` lists `memory-core` and `memory-rag` only as `file:` `devDependencies`. `RagTelemetry*` is not a named public export (the baseline holds `createRagTelemetry` and `CreateRagTelemetryOptions` only, `compat-baseline/arnilo__prism-observability.txt:1,29`), but `createRagTelemetry`'s signature returns it, so the baseline diff in Task 3 stays small and must be attributed.
      - **Comment-only mentions in stable `src/`, which are not imports:** `packages/context/engineering/src/tool-search.ts:98`, `packages/hosts/devtools/src/bun.d.ts:2`. Leave them or reword them in Task 3's sweep. They do not affect the gate.
      - **Stable tests that import experimental packages (allowed, `devDependencies`/`__tests__`):** `packages/context/engineering/src/__tests__/tail-context.test.ts:3` imports `memory-core` but the package manifest has no devDependency on it. It resolves through the workspace and fails when the package is built alone, so Task 3 either adds a `file:` devDependency or moves the helper. `packages/integrations/observability/src/__tests__/rag-telemetry.test.ts:3-4`.
      - **Private consumers (allowed):**
        - `apps/prism-agent`: `package.json:27-30`, `src/host/{coding,research,ontology}.ts`, `src/scenarios/{conversational-memory,ontology-memory}.ts` and `src/__tests__/{context,conversational-memory}.test.ts`;
        - twelve `examples/*.ts`, which import `-core|-fabric|-observational|-rag|-wiki` (examples are repo-only);
        - `templates/deep-research/manifest.json:9` lists `@arnilo/prism-memory-rag` as a generated project's dependency. Task 4 must either add `@experimental` to the template's install line or drop the package from the default template. Nothing in `scripts/` or `src/` consumes `templates/` (grep found no reader), so it is docs-grade only;
        - `scripts/memory-bench/**` (18 files), `scripts/live-matrix.json` (memory rows `:333-823`), `scripts/postgres-evidence.mjs`, `scripts/e2e-*`, `scripts/fixtures/e2e-*`, `scripts/benchmark-multi-agent.test.mjs`, `scripts/phase24-truth`, `phase29-freeze-manifest.json`, `phase38-codeql-regression`, `coverage-thresholds.json:99-125` (a threshold per memory package).
      - **Release tooling that consumes the names, which Task 2 and Task 39 touch:** `scripts/post-publish-smoke.mjs:31,88-89,161`. Its registry mode installs `@arnilo/prism-memory-core@<version>` and imports fabric and wiki. See the Task 39 input in (b).
      - **Docs (Task 4):** `README.md:96`, `PRODUCT.md:60-115`, `roadmap.md`, `docs/{agent,host-security,index,migrate-to-0.13,peer-dependencies,performance,release,resource-loading}.md`, `packages/hosts/headless/README.md`, `packages/integrations/observability/README.md`, `templates/README.md`, `templates/deep-research/README.md.tmpl:34`, `examples/README.md`, `CHANGELOG.md`.
      - **Intra-line dependency shape (needed by Task 2):** `fabric` depends on `core` and `observational` (`^0.13.0`, runtime imports in `blocks.ts`, `context.ts`, `create.ts`, `search.ts` and others), so OM is already a hard dependency of the fabric. `rag` depends on `core`. `wiki` depends on `core`, `observational` and `rag`, and has `peerDependencies` on `fabric` and `tools-web` (`^0.13.0`). All of these are caret ranges today.
    - **(b) Release tooling at `file:line`** (`scripts/release.mjs`, corrected from the plan's numbers):
      - `parseSemver` at `:198` returns `{major, minor, patch}` only, though `SEMVER_RE` (`:196`) already captures the prerelease and build groups. `cmpSemver` at `:203` is not exported and ignores the prerelease. `satisfiesInternalRange` is at `:215` (the plan said `:212`) and its doc comment says "No prerelease handling". `incrementVersion` is at `:230` and throws on anything but patch, minor or major. `bumpPackage` is at `:334-343`.
      - `publishArgs` at `:401-402` hardcodes `"--tag", "latest"`.
      - `loadRelease` at `:19` reads `independent-packages.json` `packages` only. The `$comment` in the file records why release-line data stays out of manifests.
      - `validateRelease` skips independent-line packages at `:79`, ignores independent targets in the range check at `:98` and filters them from the publish order at `:108`. `validateReleaseIndependent` is at `:300`. `assertGitState` is at `:345` (plan said `:350`).
      - **Finding for Task 2: `bumpPackage` does not rewrite dependents.** It writes the bumped package's own manifest only. With exact prerelease pins between the memory packages, every `bump … prerelease` leaves the dependents' pins stale and `validateReleaseIndependent` (`:300-317`) then fails. Task 2 gets a criterion for it (amended below).
      - **Finding for Task 2: `peerDependencies` need the same exact pin.** `wiki` has a `peerDependencies` range into `fabric`. An npm range such as `^0.13.0` never matches `0.13.0-experimental.N`, so a registry install of wiki would fail on the peer. Task 2's "exact between experimental packages" must name `peerDependencies`, not just `dependencies` (amended below).
      - **Finding for Task 2: the other version gates hold hard-coded empty sets.** `scripts/version-literal-gate.test.mjs:41` has `INDEPENDENT_LINES = new Set([])` and says it is the "same set as `src/__tests__/packaging.test.ts`". Task 2 must feed all of them from `independent-packages.json`, not add names to each set (the plan already forbids per-script hard-coded names).
      - **`.github/workflows/release.yml`:**
        - `:6` triggers on `v0.13.0` and `@arnilo/*@*`.
        - **The plan's reading was incomplete.** The job-level `if:` of `codeql-release` (`:148`) and of `publish` (`:205`) enumerates the same tags only up to `v0.12.1` plus `startsWith(github.ref, 'refs/tags/@arnilo/')`. `publish` also `needs: [… codeql-release …]` (`:204`). A pushed `v0.13.0` therefore runs `verify` and **skips `codeql-release` and `publish`**: it publishes nothing, silently. It does not take the independent publish path.
        - The lockstep branch in the publish step (`:265-266`) has the same list. `.github/workflows/release.yml` is also a claim file of `version-literal-gate.test.mjs`, so Task 39's edit must keep that gate green.
        - **Inputs to Task 36 and Task 39:** replace the enumerated tag lists at `:6`, `:148`, `:205`, `:265` with one pattern or one computed output, and add a CI test that a `v0.13.0` ref selects the intended path. Task 39's dry run must show `codeql-release` and `publish` running for the `v0.13.0` ref.
        - **Input to Task 39:** `scripts/post-publish-smoke.mjs:31` installs `@arnilo/prism-memory-core@${version}` from the registry, and `:88-89,161` import fabric and wiki. Once the memory packages ship as `0.13.0-experimental.N`, `--version 0.13.0` fails for them. Task 39 moves the smoke's memory legs to an `@experimental` spec, or splits an experimental smoke. `--local` mode is unaffected.
      - `bun publish --help` on the installed Bun **1.4.4** lists `--tag=<val>` ("Default is latest") and `--dry-run`. `docs/release.md:172` still says Bun 1.4.2, which Task 2's docs edit corrects.
    - **(c) Registry facts** (anonymous `GET https://registry.npmjs.org/@arnilo%2f<name>`, 2026-11-05):
      - `@arnilo/prism-memory-core`, `-observational`, `-fabric`, `-wiki` and `-rag`: **404, never published.** `@arnilo/prism-memory-compaction` is also **404**, so its first publish is 0.13.0 on `latest`. For reference, `@arnilo/prism` has `dist-tags {"latest":"0.12.1"}`.
      - The first-publish dist-tag question (ctx7 `/npm/cli` and `/websites/npmjs`, 2026-11-05; sources `lib/commands/publish.js`, `workspaces/libnpmpublish/lib/publish.js`, `docs/.../npm-dist-tag.md`):
        - The client throws "You must specify a tag using --tag when publishing a prerelease version" when the version has a prerelease and the tag is the default. This is a second guard beside Task 2's `experimental_version_mismatch`.
        - The client sends `dist-tags: { [tag]: version }` only. "Publishing a package sets the `latest` tag to the published version unless the `--tag` option is used."
        - Whether the **registry server** also assigns `latest` on a package's first publish is **not stated in any source I could fetch**. Treat it as unverified. The plan's conditional handling stands: Task 39 records the resulting dist-tags per package. If `latest` points at a prerelease, Task 2's version string and Task 4's README notice are the experimental signal, and the owner may remove the stray tag with `npm dist-tag rm <name> latest` (Bun has no dist-tag command, `docs/release.md:172`). Whether the registry allows removing the only `latest` is also unverified, so Task 39 does not depend on it.
        - Task 39's dry run cannot answer this, because dry runs never reach the registry. The first real publish is the measurement.
    - **(d) Reference host defaults.**
      - `observational({ context: { compactAt: sessionCompactAtFor(…) } })` is unconditional at `coding.ts:48` (the plan said `:47`) and `research.ts:55`. The `compaction` slot is assigned at `coding.ts:37` and `research.ts:35`.
      - **New finding: `memoryRag(…)` is also unconditional in the research worker (`research.ts:48`)**, so the research default path loads **two** experimental packages, and Task 3's criterion "with `memory` unset, `inspect().packages` of every default agent contains no experimental package" fails unless rag is gated too. `memory-rag` is also the package that provides `rag_search` and the embeddings service, and its config is `config.embeddings`. Task 3 is amended below to load it only when `config.embeddings` is set (a recommended default: it keeps the existing opt-in config as the switch and adds no new option). The owner can override at review time.
      - **Tests asserting OM on the default path: one file.** `apps/prism-agent/src/__tests__/context.test.ts:50-51` (coding worker, `observational.context` deepEqual) and `:99-102` (unlisted model). `:80,98` assert only `memory-compaction` and stay valid. `long-session.ts` has no OM reference. It mocks `packages` at `:115`, and the plan 194 context-budget tests live in `context.test.ts`. `one-shot-golden.ts` runs mock packages and `fixtures/one-shot.golden.jsonl` has zero memory or observational mentions, so no golden changes. `research.test.ts` and the `research-citations` scenario were not read for rag use: Task 3 checks them when it gates `memoryRag`.
      - **`sessionCompactAtFor`** is defined at `context-budgets.ts:41` and used only at `coding.ts:48` and `research.ts:55`, i.e. only for OM config. It moves under the `memory` branch with OM. `context-budgets.ts` and its tests stay otherwise unchanged.
      - **No safety floor depends on OM.** No package under `packages/policy`, `packages/integrations` or `src/` reads OM state. Outside the memory packages the word appears only in `src/session/external-state.ts:7` (a comment). Guardrails, approval and governance do not consume the ledger. OM is context management. Fabric and wiki consume OM's library exports (`createMemoryId`, `foldObservationalMemoryLedger`, worker-limit helpers) as a dependency, not as an active slot, so a host that sets `memory` still gets OM's code.
      - Docs that call OM "always on in the reference host": `apps/prism-agent/README.md:25` lists `memory-rag` for the research worker. No other page found describing OM as default. Task 3's sweep covers these.
    - **(e) Gates pinning memory versions** (each one's change belongs to Task 2):
      - `scripts/package-truth.json:28-32` (five experimental versions, change to `0.13.0-experimental.0`; `:27` compaction stays `0.13.0`) and `:103-108` (names, unchanged). `scripts/package-truth.mjs:174` derives `versions` from manifests, with no literal, and `:243-251` holds the `PACKAGE_NOTES` strings that build the docs table (`:268-283`). They are the place to carry "(experimental)".
      - `docs/index.md:178-183` (the plan said `:178-181`; the table has six memory rows including compaction) and the list at `:58-63`. The version table is generated from `package-truth`, so regenerate it rather than editing it by hand.
      - `scripts/version-literal-gate.test.mjs:41` (empty `INDEPENDENT_LINES`; also reads `docs/index.md`, `release.yml`, `package-truth.json` and `bun.lock` as claim files) and `src/__tests__/packaging.test.ts:60-65,346-350` (package list and expected names; its "same set" comment at `:23-24`).
      - `scripts/phase54-package-map.mjs` has only migration anchors, no version pins. `phase54-package-map.test.mjs:103-109` lists names without versions. **Expected: no change**, so the plan's "tentative" mark stays.
      - `scripts/release-gate.test.mjs:42` uses `memory-core` only as a fixture name.
      - `bun.lock:330-420,840-848`: the workspace entries carry `^0.13.0` ranges that change to exact prerelease pins. `bun.lock:292-293` is observability's `file:` devDependencies (unchanged).
    - **(f) Verdict: Tasks 2–4 proceed, with four amendments.**
      1. **Task 3** also gates `memoryRag` in the research worker (the finding in (d)).
      2. **Task 2** pins `peerDependencies` exactly (not only `dependencies`) and makes `bump` rewrite the exact pins in dependents.
      3. **Task 2** feeds `INDEPENDENT_LINES` in `version-literal-gate.test.mjs` and the set in `packaging.test.ts` from `independent-packages.json`.
      4. **Tasks 36 and 39** carry the workflow finding (the `v0.13.0` ref skips `codeql-release` and `publish`) and the `post-publish-smoke.mjs` finding.
      - No re-cut. The earlier plan 188.11, 202 and 208 work is unaffected.
    - Baseline diff: none. No sweep run (read-only).

- [x] Task 2: The experimental release line — tooling, versions and the compat gate
  - Acceptance Criteria:
    - Functional:
      - `scripts/independent-packages.json` gains `"experimental": ["@arnilo/prism-memory-core", "@arnilo/prism-memory-observational", "@arnilo/prism-memory-fabric", "@arnilo/prism-memory-wiki", "@arnilo/prism-memory-rag"]`. `loadRelease` marks those packages `experimental: true` and treats them as independent-line, so a lockstep cut neither validates nor publishes them. An `experimental` name that is not a workspace package fails `loadRelease` with `unknown experimental package <name>`.
      - The five manifests carry `"version": "0.13.0-experimental.0"`. Their ranges into each other are exact (`0.13.0-experimental.0`). Their ranges into stable packages (`@arnilo/prism-tools-web`) and the kernel peer (`>=0.13.0 <1.0.0`) are unchanged. `bun.lock` is regenerated.
      - **Exact pins cover `dependencies` and `peerDependencies`** (amended 2026-11-05 from the Task 1 review). The memory-wiki peer on `memory-fabric` is `0.13.0-experimental.0`, because `^0.13.0` never matches a prerelease. `bun scripts/release.mjs bump <experimental package> prerelease` also rewrites the exact pins that name it in every dependent's `dependencies` and `peerDependencies` (`bumpPackage`, `release.mjs:334`, writes only its own manifest today), so `validateReleaseIndependent` stays green after a bump.
      - **One source for the set across the version gates** (amended 2026-11-05): `INDEPENDENT_LINES` in `scripts/version-literal-gate.test.mjs:41` (hard-coded empty today) and the independent set in `src/__tests__/packaging.test.ts` read `scripts/independent-packages.json` and no longer carry their own lists.
      - Semver in `scripts/release.mjs`:
        - `parseSemver` returns the `prerelease` identifiers;
        - `cmpSemver` orders by semver §11 (a prerelease sorts below its release; dot-separated identifiers compare numerically or lexically);
        - `satisfiesInternalRange` lets a prerelease target satisfy only an exact range, so caret or tilde into a prerelease fails closed;
        - `incrementVersion(v, "prerelease")` turns `0.13.0-experimental.0` into `0.13.0-experimental.1`, and `bumpPackage` and the `bump` CLI accept it.
      - `publishArgs` passes `--tag experimental` for an experimental package and `--tag latest` otherwise. It fails closed:
        - `experimental_version_mismatch` when an experimental package's version has no prerelease identifier;
        - `stable_version_prerelease` when a non-experimental package's version has one.
      - Compat gate (`scripts/release-gates.mjs`): experimental packages keep their baselines in `scripts/compat-baseline/`, regenerated by `--update-baseline`. A removal or change in one is reported in a separate `experimental` section of the gate output and never fails the gate. Stable packages are classified exactly as before.
      - The version gates from Task 1 (e) accept `0.13.0-experimental.N` for exactly the experimental set and reject it anywhere else. These are `package-truth`, the `docs/index.md` version table, the version-literal gate, the package map and `packaging.test.ts`.
    - Performance: n/a — release tooling; the gate's run time is unchanged (record before and after in the note).
    - Code Quality:
      - One source of truth for the set: the `experimental` list. No manifest field and no per-script hard-coded names.
      - The semver helpers stay pure functions with unit tests.
      - No new dependency (no `semver` package).
    - Security: An experimental package can never be published to `latest` by this tooling (asserted). The NPM token handling is unchanged.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (b), (c), (e); `scripts/release.mjs:19-60,75-110,194-240,401-470`; `scripts/release-gates.mjs` (compat classifier); semver 2.0.0 §11 (precedence)
    - Options Considered:
      - **Put the experimental flag in each `package.json`.** Rejected: `loadRelease` deliberately keeps release-line decisions in tooling data, not in published manifest bytes (`release.mjs:38-41`).
      - **Leave the compat gate strict for experimental packages.** Rejected: the memory track would need `--allow-break` for every planned change, which defeats the point of the experimental line.
    - Chosen Approach:
      - Extend the existing independent-line machinery with an experimental subset, a prerelease-aware semver, and a non-`latest` dist-tag.
    - API Notes and Examples:
      ```json
      { "$comment": "…", "packages": [], "experimental": ["@arnilo/prism-memory-core", "…"] }
      ```
      ```bash
      timeout 60 bun scripts/release.mjs bump --package @arnilo/prism-memory-fabric --type prerelease
      timeout 60 bun scripts/release.mjs publish --independent --dry-run   # bun publish … --tag experimental
      ```
    - Files to Create/Edit:
      - `scripts/release.mjs`, `scripts/release-gates.mjs`, `scripts/independent-packages.json`
      - `scripts/release-gate.test.mjs`, `src/__tests__/release.test.ts` (new cases)
      - `packages/memory/{core,observational,fabric,wiki,rag}/package.json`, `bun.lock`
      - `scripts/package-truth.json`, `scripts/package-truth.mjs`, `scripts/phase54-package-map.mjs` (tentative: per Task 1 (e)), `scripts/version-literal-gate.test.mjs`, `src/__tests__/packaging.test.ts`
      - `scripts/compat-baseline/arnilo__prism-memory-{core,observational,fabric,wiki,rag}.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`. The note records the diff (expected: none, since baselines hold no version) and attributes it to this plan.
      - `docs/index.md` (version table), `docs/release.md` ("Experimental packages": the line, the tag, how they graduate), `CHANGELOG.md`
    - References:
      - plan 140 (independent versioning), plan 164 Task 8.4 (attested `bun publish`)
  - Test Cases to Write:
    - `semver_prerelease_sorts_below_release` and `semver_prerelease_identifiers_compare` fail if `cmpSemver` drops the prerelease.
    - `internal_range_into_prerelease_is_exact_only`: `^0.13.0-experimental.0` does not satisfy `0.13.0-experimental.1`.
    - `increment_prerelease`.
    - `bump_prerelease_rewrites_dependent_pins`: bumping `memory-core` rewrites the exact pins in fabric, rag and wiki (`dependencies` and `peerDependencies`) and leaves `devDependencies` `file:` entries alone.
    - `publish_args_use_experimental_tag`.
    - `publish_args_reject_mislabeled_versions` covers both error codes.
    - `lockstep_cut_excludes_experimental`: `validateRelease(…, "0.13.0")` passes with the memory packages at the prerelease and leaves them out of the publish order.
    - `independent_validate_accepts_exact_prerelease_pins`.
    - `experimental_list_names_workspace_packages`.
    - `compat_experimental_changes_never_fail`: removing an export from a fixture experimental baseline is reported but passes, while the same removal in a stable package fails.
    - `package_truth_versions_match` (existing) passes with the prerelease versions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published versions and dist-tags of five packages, and release tooling behavior.
    - Docs pages to create/edit:
      - `docs/release.md`: "Experimental packages" section
      - `docs/index.md`: version table rows
      - `CHANGELOG.md`: `## [Unreleased]`
    - `docs/index.md` update: yes — the version table rows only (no new page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - `scripts/independent-packages.json`: the new `experimental` list (the five memory names, in tier order). It is the one source: `loadRelease`, `packaging.test.ts`, `version-literal-gate.test.mjs` and `docs.test.ts` all read it. The five manifests are at `0.13.0-experimental.0` with exact pins into each other: `dependencies` (fabric→core, observational; rag→core; wiki→core, observational, rag) **and** `peerDependencies` (wiki→fabric). Ranges into `tools-web` and the kernel window peer are unchanged. `bun.lock` was regenerated with `bun install --lockfile-only`, and the diff is those five workspaces only (12 lines).
      - `scripts/release.mjs`:
        - `loadRelease` marks `experimental: true` (and `independent: true`), and an unknown name fails with `unknown experimental package <name>`.
        - `parseSemver` returns `prerelease: string[]`, and `cmpSemver` is now exported and follows semver §11.
        - `satisfiesInternalRange`: a prerelease target satisfies only an exact range.
        - `incrementVersion(v, "prerelease")` throws on a release version (`needs a prerelease version`), and the unknown-type error lists `prerelease`.
        - `bumpPackage` refuses a non-`prerelease` bump of an experimental package, and **rewrites the exact pins that name it** in every dependent's `dependencies`, `optionalDependencies` and `peerDependencies`. It returns `repinned` and the CLI prints it. Dev `file:` links and loose ranges are left alone.
        - New exported `releaseTag(pkg, version)` is the one place that derives the tag. `publishArgs` uses it and so does `runRelease`, before the first registry request and in `check` mode too.
        - `validateRelease` and `validateReleaseIndependent` also report the line errors for every package, and `validateReleaseIndependent` now checks **independent packages' lock entries** against their own manifest versions (`lockVersionErrors(…, { includeIndependent: true })`). The helper skipped them in both validators before, which was harmless only while the independent set was empty.
      - `scripts/release-gates.mjs`: an experimental package's removal or changed signature is printed and returned as `experimental: [...]` in the report, and never added to `errors`. The key is present only when non-empty, so existing report shapes are unchanged. A missing baseline still fails.
      - Gates and tests: `scripts/version-literal-gate.test.mjs` (set read from the file; experimental version must be `x.y.z-experimental.N`, pins into it exact; the prerelease is reported anywhere else; new positive control), `src/__tests__/packaging.test.ts` (independent set and the lockstep loop read the file; `experimental_list_names_workspace_packages`), `src/__tests__/docs.test.ts` (an `@experimental` suffix on an install command is valid for exactly the experimental set, which Task 4's README notices need), `scripts/release-gate.test.mjs` (the repo-wide stale-baseline test reports experimental drift and does not fail on it).
      - Docs: `docs/release.md` gains "Experimental packages", pipeline step 4 names both tags, and the Bun note in "Legacy deprecation" now says 1.4.4 and that `bun pm` has no dist-tag command (checked with `bun pm --help`). `README.md`, `docs/index.md`, `docs/release.md` and `docs/_evidence/phase54-package-map.md` version tables and `scripts/package-truth.json` come from `bun scripts/package-truth.mjs --emit-docs`, not by hand. `CHANGELOG.md` has the Task 2 entry.
    - **Tests** (all pass): `src/__tests__/release.test.ts` has 10 new cases (the nine named in the plan, with `lockstep_cut_excludes_experimental` and `independent_validate_accepts_exact_prerelease_pins` over a fixture graph, plus `experimental_list_rejects_unknown_workspace` and a real-graph check that no experimental package can take `latest` and no lockstep cut includes one). `scripts/release-gate.test.mjs` has `compat_experimental_changes_never_fail` (stable fails, the identical drift in an experimental package passes and is listed, the same package fails once off the list, a missing baseline still fails). `bun run typecheck` is clean. Whole-file runs: release (19), packaging (280), docs (65), version-literal (5), packaging-current (158), phase54 (7), e2e-coverage (8).
    - **`package_truth_versions_match`** is not a test name in the repo. The checks it stood for are `phase24-truth.test.mjs`'s "committed artifact equals generator output" (passes after regeneration) and the version-literal gate's `package-truth.json` leg (passes).
    - **Compat baselines:** `bun scripts/release.mjs gate --update-baseline` produced **no diff** in `scripts/compat-baseline/` (baselines hold no version), as expected. `bun scripts/release.mjs gate` passes on the final tree: `{"updated": false, "packages": 51}`.
    - **Registry-facing check** (no publish): `release.mjs check --lockstep --version 0.13.0 --allow-dirty --allow-untagged` reports 46 packages `available`, which is 51 minus the five experimental ones. A real `publish --independent --dry-run` needs a clean tagged tree and is Task 39's job. Its `--tag` argument is covered by the unit tests above.
    - **Performance:** the gate's run time is unchanged, 14.1 to 14.8 s on this machine with the change. A HEAD run is not available, because a clean checkout has no `scripts/release-evidence.json`.
    - **Kernel size budget rebaselined** (`scripts/budgets.json`, `kernel.packedBytes` 1202843→1204866 and `kernel.unpackedBytes` 3916012→3921694, reason recorded in both `$comment`s). The ceilings were set to the exact 2026-11-03 measurement, so any shipped text busts them. Growth is shipped text only: `docs/release.md` +3040 B, `docs/index.md` +75 B, `CHANGELOG.md` +2492 B in total. About 1358 B of that CHANGELOG growth is uncommitted plan 208 Task 5 text already in the working tree. No kernel source changed.
    - **Findings for later tasks:**
      - **Task 4:**
        - `docs/compatibility.md` does not exist yet (it is Task 25–29's file), and `docs.test.ts` rejects a link to it. The Task 2 docs therefore say "outside the stability promise of the stable packages" with no link. Task 4's README notice text ("outside `docs/compatibility.md`'s promise") must do the same until Task 29 creates the page, then link.
        - The notice template that Task 4 puts in `docs/release.md` belongs in the new "Experimental packages" section. Task 2 left it for Task 4.
      - **Task 14 and the Standing rule:** `release.mjs` now exports `cmpSemver` and `releaseTag`. The host-builder index tracks root exports, not scripts, so it is unaffected.
      - **Task 39:** `bump --package <name> --type prerelease` is the real CLI form. The plan's example `bump --independent <name> prerelease` was wrong and is corrected in this task's API notes. The independent-publish order for the first experimental cut must publish `memory-core` and `memory-observational` before `memory-rag`, `memory-fabric` and `memory-wiki`, and `topologicalOrder` already does (it follows `dependencies` and `peerDependencies`).
      - **A new package under `packages/` needs a bump of the count in `version-literal-gate.test.mjs`** (now 51 manifests). It said 43 at HEAD while the tree had 51, so that suite was already red before this task (the kilo, litellm and ollama-cloud additions had not updated it). Task 14 adds a package and updates it.
    - **Pre-existing failures, not caused by this task** (both fail the same way on a clean `git archive HEAD`): `phase24-truth.test.mjs` "peer policy Decision B" (`@arnilo/prism-evals` peers `@arnilo/prism-observability`, which the test's allow-list does not know) and `release-gate.test.mjs` `no_compat_baseline_without_workspace` (orphan baselines `arnilo__prism-agent-sdk.txt` and `arnilo__prism-work.txt`). They are left for their owners. Task 36's CI review should decide whether `bun run test` is expected to be green.

- [x] Task 3: Stable packages and the reference host's defaults run without experimental packages
  - Acceptance Criteria:
    - Functional:
      - New gate `src/__tests__/experimental-boundary.test.ts` (`stable_packages_never_depend_on_experimental`). It reads the experimental set from `scripts/independent-packages.json` and checks two things:
        - (1) no publishable non-experimental manifest names an experimental package in `dependencies`, `optionalDependencies` or `peerDependencies`;
        - (2) no non-test source file under a stable package's `src/` imports one, whether by static import, `import type`, `export … from`, or a dynamic `import()` with a literal specifier.
        `devDependencies` used only by `__tests__` are allowed. The gate runs in `bun run test` and therefore in `release:gate`.
      - `@arnilo/prism-observability`: `src/rag-telemetry.ts` declares the structural telemetry types it consumes locally and stops importing `@arnilo/prism-memory-rag`. A test in observability (using the existing devDependency) asserts that memory-rag's `RagTelemetry` is assignable to the local type, so drift fails CI and not a host's typecheck.
      - Reference host (`apps/prism-agent`, private):
        - the coding and research workers load `@arnilo/prism-memory-observational` only when `config.memory` is set, in the same branch as the fabric;
        - with `memory` unset, `inspect().packages` of every default agent contains no experimental package;
        - the `compaction` slot assignment stays, so `memory-compaction` owns compaction alone on the default path;
        - `sessionCompactAtFor` is used only on the memory path;
        - scenarios and goldens that Task 1 (d) found asserting OM on the default path are updated, and the diff is attributed in the note;
        - the memory scenarios (`conversational-memory`, `ontology-memory`) keep running with `memory` set;
        - `ontology` without `memory` still fails with its existing error.
      - **`memory-rag` in the research worker** (amended 2026-11-05 from the Task 1 review, finding (d)): `research.ts:48` loads `memoryRag(…)` unconditionally, so the research default path holds a second experimental package. The worker loads it only when `config.embeddings` is set, which is already the rag config switch, and adds no new option. `apps/prism-agent/README.md:25` and the `research.test.ts` / `research-citations` scenario are checked for a `rag_search` dependency and updated with the diff attributed in the note. If the research default needs `rag_search`, the owner is asked before the gate is relaxed.
      - `packages/context/engineering/src/__tests__/tail-context.test.ts:3` imports `@arnilo/prism-memory-core` with no devDependency in that package's manifest (Task 1 (a)). Add a `file:../../memory/core` devDependency, as observability does.
      - Retirement sweep: grep `src/ packages/ apps/ scripts/ examples/ docs/` for the moved observability import and for docs that describe OM as always on in the reference host. Update them in this task.
    - Performance:
      - The default workers load one package fewer. Record package count, setup time and system-prefix bytes per default agent, before and after, in the note.
      - The prefix change is intended. Tasks 21–24 measure the new default.
    - Code Quality:
      - No experimental import in stable code, and no alias or re-export of rag's types under the old name.
      - The reference host stays inside `scripts/host-surface-allowlist.json` (`reference_host_imports_only_public_surface`).
    - Security:
      - Task 1 (d) records that OM is not a safety floor, so removing it from the default weakens no guard.
      - The boundary gate fails closed: a stable package that adds an experimental dependency fails CI, naming the package, the field or file, and the experimental name.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (a), (d); `packages/integrations/observability/src/rag-telemetry.ts`; `apps/prism-agent/src/host/{coding,research,config}.ts`; `apps/prism-agent/README.md`
    - Options Considered:
      - **Keep OM on the reference host's default path.** Rejected: the reference host is the proof that a host built on the stable core works. Defaulting it to an experimental package would make its scenarios, the cache-parity runs and the live journeys depend on a package outside the stability promise.
      - **Promote OM to stable alone.** Rejected for this plan: OM is tier T0 of the three-tier memory that plan 210 audits, and its features may be removed. The owner can still choose this at review time (Task 1 (f)).
      - **Make memory-rag an optional peer of observability.** Rejected: an optional peer still puts an experimental name in a stable manifest, and the types are small enough to declare structurally.
    - Chosen Approach:
      - A dependency gate plus two local fixes, so the stable core and the reference host's defaults never reach the experimental line.
    - API Notes and Examples:
      ```ts
      // apps/prism-agent/src/host/coding.ts (shape)
      ...(config.memory === undefined
        ? []
        : [memoryFabric({ preset: config.memory, tools: { root } }), observational({ context: { compactAt: sessionCompactAtFor(model) } })]),
      ```
    - Files to Create/Edit:
      - `src/__tests__/experimental-boundary.test.ts` (new)
      - `packages/integrations/observability/src/rag-telemetry.ts`, `src/__tests__/rag-telemetry-types.test.ts` (new), `README.md`, `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-observability.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`. The type names now resolve locally, and the diff is attributed in the note.
      - `apps/prism-agent/src/host/{coding,research}.ts`; scenario and golden files per Task 1 (d) (tentative); `apps/prism-agent/README.md` (the memory section: opt-in, experimental, install with `@experimental`)
      - `CHANGELOG.md`
    - References:
      - Task 1; plan 194 (context-budget triggers); plan 188.11 Task 7 (reference-host memory opt-in)
  - Test Cases to Write:
    - `stable_packages_never_depend_on_experimental`: passes on the tree. Fixture variants fail on a stable manifest dependency, an `import type` in stable `src/`, and a dynamic literal import.
    - `rag_telemetry_types_stay_compatible`.
    - `reference_host_default_loads_no_experimental_package`: each default agent's `inspect().packages` (coding, research and the orchestrator and workflow agents), including the research worker with `embeddings` unset.
    - `reference_host_memory_opt_in_loads_om_and_fabric`.
    - `bun run --filter @arnilo/prism-agent test` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the reference host's default package set, and observability's declared types.
    - Docs pages to create/edit: `apps/prism-agent/README.md`, `packages/integrations/observability/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - **Gate.** `src/__tests__/experimental-boundary.test.ts` holds `stable_packages_never_depend_on_experimental` plus three fixture cases. It reads the set from `scripts/independent-packages.json` and walks `loadRelease(...).packages`, skipping private and experimental packages.
        - (1) Manifest check: `dependencies`, `optionalDependencies` and `peerDependencies`.
        - (2) Source check: every non-test file under `<pkg>/src` (skipping `__tests__`, `*.test.*`, `node_modules` and `dist`). It catches static, `import type`, `export … from` (multi-line), bare and literal dynamic imports. Subpaths such as `…/sub` also match, and comment lines are ignored.
        - Violations name the package, the field or file and the experimental name. Fixtures cover a peer dependency, the four import shapes, and the allowed cases (devDependency, `__tests__`, comments, private package, an experimental package's own deps). The test's helpers are module-private on purpose: any `export` in `src/` counts toward the kernel's `rootExports` budget (an earlier draft exported two and failed the gate by +2).
      - **Observability.** `src/rag-telemetry.ts` declares `RagTelemetry`, `RagTelemetrySpan` and `RagTelemetryAttributeValue` locally (exported from the module, not from the index) and no longer imports memory-rag. `src/__tests__/rag-telemetry-types.test.ts` (`rag_telemetry_types_stay_compatible`) asserts mutual assignability with memory-rag's types at compile time, so drift fails `bun run typecheck`. `README.md` and `CHANGELOG.md` updated.
      - **Reference host.** `coding.ts` and `research.ts` load `observational(...)` only in the `config.memory` branch next to the fabric, and `research.ts` loads `memoryRag(...)` only when `config.embeddings` is set. The `compaction` slot assignment stays. `sessionCompactAtFor` is now referenced only inside the memory branch. `ontologyPackages` is unchanged, so `ontology` without `memory` still fails with `needs memory`.
      - **Tests.**
        - `context.test.ts`: the two OM assertions on the default path now assert OM is absent. New `memory_opt_in_budgets_the_observational_memory` keeps the OM budget assertions (coding and research, `memory` set).
        - `conversational-memory.test.ts`: `default_agents_do_not_load_memory_fabric` became `reference_host_default_loads_no_experimental_package` (coding, research and orchestrator, checked against all five names, and `memory-compaction` still loaded). New: `reference_host_memory_opt_in_loads_om_and_fabric` and `research_worker_loads_memory_rag_only_with_embeddings`. The external worker is not constructed in the test (it needs a driver binary and its source has no memory import, which the gate covers).
      - **Manifests.** `packages/context/engineering/package.json` gains the `file:../../memory/core` devDependency that `tail-context.test.ts` already needed. `bun.lock` regenerated (`bun install --lockfile-only`).
      - **Docs.** `apps/prism-agent/README.md`: the worker table and compaction-slot sentence, and the Memory section opens with an experimental notice (install with `@experimental`, `memory` loads fabric and OM, `embeddings` loads rag). `CHANGELOG.md` has the entry. The `tool-search.ts` comment no longer names `memory-rag`.
    - **Task 1 (d) checks.**
      - `research.test.ts` and the `research-citations` scenario do not depend on `rag_search`: both pass with rag not loaded, and `rag_search` stays in the approval allow-list, which is inert without the tool.
      - No golden changed (`one-shot.golden.jsonl` has no memory or observational content).
      - The only default-path OM assertions were in `context.test.ts` (updated above).
    - **Performance** (default agents, mock provider, `apps/prism-agent`, before = `git stash` of the two host files, after = this task):

      | Worker | Packages | Setup | First-request bytes | Tool-schema bytes |
      | --- | --- | --- | --- | --- |
      | coding | 10 → 9 | 26 → 30 ms | 18,644 → 18,644 | 13,617 → 13,617 |
      | research | 11 → 9 | 223 → 226 ms | 8,861 → 8,861 | 5,936 → 5,936 |

      Setup time differences are within noise. Neither OM nor rag adds to a fresh session's first request, so the system prefix is byte-identical for a first turn. The intended prefix change appears only on later turns (OM observation blocks, fold batches), which Tasks 21–24 measure. Research drops two packages (OM and rag), coding drops one.
    - **Baseline diff:** none. `bun scripts/release.mjs gate --update-baseline` leaves `compat-baseline/arnilo__prism-observability.txt` unchanged: the rendered signature is `createRagTelemetry(options): RagTelemetry` either way, and the local types are not index exports. (`arnilo__prism-memory-fabric.txt` shows a diff from plan 208 work already in the tree, not from this task.)
    - **Sweep.** `graft grep "prism-memory-rag"` finds no remaining import in stable `src/`. The only remaining stable-package mentions are comments (`packages/hosts/devtools/src/bun.d.ts:2`, the new note in `rag-telemetry.ts`) and `observability`'s `file:` devDependencies for the test. `apps/prism-agent/README.md` was the only page that described OM as default for the reference host. `apps/prism-agent/src/bun-module.d.ts:2` still names memory-rag in a shim comment, which does not affect the gate.
    - **Budget.** The kernel byte ceilings in `scripts/budgets.json` were raised by +410 packed / +1383 unpacked (reason recorded in both `$comment`s). The growth is the shipped CHANGELOG entry only. No kernel source changed. File count, root exports and source lines are unchanged.
    - **Checks run:** `bun run typecheck` (clean); `experimental-boundary` (4), `docs` + `packaging` + `version-literal-gate` (354 across four files); `--filter @arnilo/prism-agent test` (61); observability (80); context-engineering (97); `bun scripts/release.mjs gate` (passes, 51 packages); biome format and lint clean on the touched files. Not run: the full `bun run test` and the live suites.
    - **Pre-existing failures, unchanged by this task** (all in `scripts/budget-gate.test.mjs` and `scripts/release-gate.test.mjs`): per-package export-count ceilings and non-null-assertion allow-list rows that still name deleted packages (`prism-core`, `prism-memory`, `prism-work`, `prism-web-tools`, …), and `no_compat_baseline_without_workspace` (orphan `arnilo__prism-agent-sdk.txt` and `arnilo__prism-work.txt`, noted in Task 2). Input to Task 36's CI review: decide whether `bun run test` is expected to be green and clean those stale rows.
    - **Finding for Task 4.** `apps/prism-agent/README.md` already carries the experimental notice, so Task 4 only needs to cross-check its wording against the five package READMEs.

- [x] Task 4: Experimental status in the docs, the claims and the roadmap
  - Acceptance Criteria:
    - Functional:
      - Each of the five memory READMEs opens, right after its title, with an `> **Experimental in 0.13.0.**` notice. The notice states:
        - the install command (`bun add @arnilo/<name>@experimental`);
        - that the package is outside `docs/compatibility.md`'s promise;
        - that its API, config, preset contents and defaults may change or be removed in any release until it graduates;
        - that graduation is the memory track's final step (plan 210 Task 10 sets the first stable version).
      - The fabric and observational `## Compatibility` sections from plan 188.11 (stability tiers, the `preset: "conversational"` revision contract, forward-compatible note files) stay, retitled as **the contract the package will keep from graduation**. Their stability tests (`packages/memory/fabric/src/__tests__/stability.test.ts` and the observational equivalent) stay green; heading parsing is updated if the retitle needs it.
      - Published memory claims stay as plan 188.11 matched them to evidence, under the experimental notice. No new claim is added.
      - `docs/index.md`: the five memory entries in "Memory and context" say "(experimental)". `memory-compaction`'s entry does not.
      - `PRODUCT.md` and `roadmap.md` (Phase 11 memory parts and the "Shipped baseline" facts): memory ships in 0.13.0 as an experimental prerelease line, and graduation is the memory track (plans 209–210) after 0.13.0. The roadmap stays the target document: facts change, no phase is added.
      - `docs/migrate-to-0.13.md`: a short "Memory packages" note covering the experimental tag and the 0.12 `@arnilo/prism-memory` successor list.
      - `templates/README.md` and the root `README.md`, if either presents memory as part of the default host, say it is experimental and opt-in.
    - Performance: n/a — docs.
    - Code Quality: The notice text comes from one template in `docs/release.md` ("Experimental packages"), and a docs test checks every experimental README against it.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - the five memory READMEs (fabric's `## Compatibility` from plan 188.11), `docs/index.md:56-63`, `PRODUCT.md`, `roadmap.md` Phase 11, `docs/migrate-to-0.13.md`
    - Options Considered:
      - **Remove the memory claims until graduation.** Rejected: the claims are matched to recorded evidence (plan 188.11), and hosts trying the experimental line need them. The notice scopes them.
    - Chosen Approach:
      - One notice template, applied to every experimental README and enforced by the docs test.
    - API Notes and Examples:
      ```markdown
      > **Experimental in 0.13.0.** Install with `bun add @arnilo/prism-memory-fabric@experimental`. Not covered by the
      > compatibility promise: the API, config, preset contents and defaults may change or be removed in any release until
      > the package graduates.
      ```
    - Files to Create/Edit:
      - `packages/memory/{core,observational,fabric,wiki,rag}/README.md`, their `CHANGELOG.md`
      - `packages/memory/{fabric,observational}/src/__tests__/stability.test.ts` (tentative: only if the retitle breaks heading parsing)
      - `docs/index.md`, `docs/release.md`, `docs/migrate-to-0.13.md`, `PRODUCT.md`, `roadmap.md`, `templates/README.md` and `README.md` (tentative: per the criterion), `CHANGELOG.md`
      - `src/__tests__/docs.test.ts`: `experimental_packages_carry_notice`
  - Test Cases to Write:
    - `experimental_packages_carry_notice`: every package in the experimental set has the notice with its own install tag, and its `docs/index.md` entry says "(experimental)". The test fails when a package is added to the set without the notice, or the notice is removed.
    - `stable_packages_carry_no_experimental_notice`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the documented status of five packages.
    - Docs pages to create/edit: as listed.
    - `docs/index.md` update: yes — the five entries gain "(experimental)" (their scope sentence changes).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - **One template, enforced.** `docs/release.md` "Experimental packages" gains a "Notice template" subsection. The five READMEs (`packages/memory/{core,observational,fabric,wiki,rag}`) open right after their title with that notice, with their own name in the install command. Docs tests in `src/__tests__/docs.test.ts` (new `plan 215 Task 4` block): `experimental_packages_carry_notice` compares each README's first paragraph to the template (line breaks ignored) and checks the `docs/index.md` entry says "(experimental)"; `stable_packages_carry_no_experimental_notice` scans every other package README and index entry. A negative check (dropping `@experimental` from the rag README) fails the first test, as intended.
      - **Template wording differs from the plan's example in two places.** (1) It says "Outside the stability promise of the stable packages" with no link, because `docs/compatibility.md` does not exist yet and `docs.test.ts` rejects a link to it (Task 2's finding). Task 29 adds the link when it creates the page: the template, the five READMEs and the test change together. (2) It does not name "plan 210 Task 10": `docs.test.ts` forbids plan references on the checked docs pages, and the template lives on one. It says "Graduation is the memory track's final step, which sets the first stable version."
      - **Compatibility sections.** `## Compatibility` in fabric, observational and core is retitled `## Compatibility (the contract from graduation)` with a one-line statement that it is intent until graduation. The fabric stability test reads `### Config stability`, not the heading, so it stayed untouched and green (5 tests). Comments in `fabric/src/config.ts` and `observational/src/config.ts` still say "README `## Compatibility`", which is a prefix of the new heading, so they were left alone (fabric's `config.ts` carries uncommitted plan 208 work). `docs/migrate-to-0.13.md` and the fabric README cross-reference were reworded. Wiki and rag have no such section.
      - **Claims.** Not changed. The wiki's existing "opt-in and unmeasured" status line stays.
      - **Install lines that would not resolve.** A `^0.13.0` range never matches a prerelease, so the plain install commands in the core, fabric and rag READMEs and `docs/peer-dependencies.md:60` now carry `@experimental`. The wiki README's `prism add` has no tag form: it uses `--version 0.13.0-experimental.0` (`prism add --version` records the range as given, `src/manifest/install.ts:180,217`).
      - **Pages.** `docs/index.md` (five entries "(experimental)"; `memory-compaction` untouched), `README.md` (a note under the generated inventory), `PRODUCT.md` (package table row and an "Experimental in 0.13.0" paragraph in the Memory section), `docs/migrate-to-0.13.md` (new "Memory packages" section), `templates/README.md` and `templates/deep-research/README.md.tmpl` (rag marked experimental), `roadmap.md` (2026-11-05 header entry, the shipped-baseline memory sentence, a version-targets row, and a Phase 11 scope bullet "Experimental memory line" that says plan 215 replaces the old audit-before-freeze ordering; no phase added). `CHANGELOG.md` and the five package changelogs have entries.
      - **Left as is.** `templates/deep-research/manifest.json` still lists `@arnilo/prism-memory-rag`: it is a plain name list that nothing reads (Task 1), and a name cannot carry a tag. The README and the template README now say to install it with `@experimental`. `apps/prism-agent/README.md` already carried the notice (Task 3); its wording agrees with the template ("outside the stable packages' promise", `@experimental`). The other pages Task 1 listed (`docs/{agent,host-security,resource-loading}.md`, headless and observability READMEs, `examples/README.md`) only name the packages and make no stability claim, so no edit.
    - **Checks run.** `docs.test.ts` (67 pass), fabric `stability.test.ts` (5), observational and core suites (165), `bun run typecheck` (clean), `bun scripts/release.mjs gate` (passes, 51 packages), `budget-gate` "root tarball" (pass after the rebaseline below).
    - **Kernel size budget rebaselined** again (`scripts/budgets.json` `kernel.packedBytes` 1205276→1206290, `unpackedBytes` 3923077→3926164, reason in both `$comment`s). Growth is shipped text only (the template, README, PRODUCT, migrate and index text and the CHANGELOG entry); no kernel source changed.
    - **Baseline diff:** none (docs only).
    - **Pre-existing failures, unchanged** (also in Tasks 2–3): `budget-gate.test.mjs` per-package export counts and two non-null-assertion rows that name deleted packages. Task 36 owns them.
    - **Findings for later tasks.**
      - **Task 29:** link `docs/compatibility.md` from the notice template, the five READMEs and the retitled `## Compatibility` sections in one change; `experimental_packages_carry_notice` compares word for word, so all must move together.
      - **Task 39:** `post-publish-smoke` and any install check must use `@experimental` (or the exact version) for these five names, as the docs now do.

### Part B — host adoption: module skills (ex-plan 211)

- [x] Task 5: Phase review (read-only) (was plan 211 Task 1)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Tool and skill ledger.** For each package that registers a model-visible tool, at its registration site, the tools it registers under its default and its fullest config, any `when` gate, and its current skills. Sites: `packages/tools/web/src/index.ts:381`, `packages/tools/coding/src/index.ts:300`, `packages/tools/browser/src/index.ts:111`, `packages/tools/openapi/src/index.ts:111`, `packages/tools/computer-use/src/index.ts:143`, `packages/tools/work/src/index.ts:269`, `packages/tools/research/src/index.ts:93`, `packages/integrations/delegate/src/index.ts:65`, `packages/integrations/advisor/src/index.ts:84`, `packages/memory/fabric/src/index.ts:504` (`when`), `packages/memory/observational/src/index.ts:98` (`when`), `packages/memory/rag/src/index.ts:134`, `packages/context/engineering/src/index.ts:149`, plus `@arnilo/prism-mcp` (external tools, no fixed names) and `packages/memory/wiki` (as left by plan 207). The five experimental memory packages (fabric, observational, rag, wiki, core) are inventoried but get the decision **deferred — memory track**: their skills are plan 210 Task 11, written on the surface 210 leaves. For each other package, a decision: **skill** (the procedure spans several calls, or needs a judgment that one tool description cannot hold), **description only** (a single-call tool whose description already carries when and how), or **none** (no model-visible tool). Give each "skill" row a proposed name and a one-line description draft.
      - (b) **Failure evidence per module.** For each "skill" row, the agent mistakes the guidance must prevent, each cited from recorded evidence. Sources: plan 189 Task 1 (coding-tool ergonomics), plans 192–193 Task 5 notes (web tools), plan 188.8's post-investigation and plans 202/207/209/210 evidence (agentic recall, rules, lessons), plan 191 (delegation), and the reference host scenarios. A mistake with no evidence is marked `hypothesis` and becomes an eval item in Task 11, not skill text.
      - (c) **The kernel skill contract today.** Catalog cap `DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64`, description truncation at 512 bytes, default body cap 32 KiB, hard cap 256 KiB (`src/skill-disclosure.ts:7-10`). The catalog is one system message (`src/skill-disclosure.ts:99`), drafted per request from `request` (`src/skills-catalog.ts:24`). `parseSkillFile` reads `name`, `description` and `toolNames` from frontmatter (`src/contribution-parsing.ts:496`); `Skill.toolNames` narrows tools while a skill is active (`src/contracts-core/agent.ts:36,355`); it is not a visibility gate. `load_skill` lives at `src/skill-load.ts:189`. Plan 190 added run-scoped compaction re-attach. Record whether a request-time filter keeps plan 190's re-attach, its "previously loaded" line, and eager disclosure correct.
      - (d) **Agent Skills compatibility.** Using the find-docs skill (record source and date), the current Agent Skills frontmatter rules for `metadata` (string-to-string map) and `allowed-tools`, and whether Claude Code and Codex tolerate unknown `metadata` keys. Confirm that `metadata.prism-requires-tools` keeps each skill valid for those agents, which matters for Task 10.
      - (e) **Catalog measurement.** Catalog entries and bytes, and system-prefix bytes, for each `apps/prism-agent` agent today (`src/host/*.ts`), measured with the mock provider. From this, the Task 7 budgets: the maximum package-skill catalog entries and bytes for the reference host's fullest agent, and the per-skill description and body caps. Proposed starting values: description ≤ 300 bytes, Prism-authored body ≤ 8 KiB, with detail moved to `references/`.
      - (f) **Existing skills audit.** For each of the 11 bundled skills, whether it passes the proposed contract. Known findings to confirm: `wiki-searcher` names `wiki_record_insight` and `vsearch`, both retired by plan 207, so both wiki skills are deleted in Task 7 (memory skills come back with plan 210 Task 11). The four vendored Hermes skills are 9.6–12.5 KB (over 8 KiB) and are pinned by `packages/tools/work/vendor-lock.json`; decide between a recorded vendored-skill exception and a Prism-side wrapper skill. Check whether their tool vocabulary matches `tools-work`'s registered tools.
      - (g) **Cache.** Package skills register in setup order. Confirm the catalog order is deterministic for a fixed package list, and that a `when` flip changes the catalog only on turns where the tool set changes anyway, so it adds no new prefix break.
      - (h) **Verdict.** The plan holds, or the findings that re-cut it.
    - Performance: n/a (read-only).
    - Code Quality: No code or file changes outside this plan.
    - Security: The review confirms package skill directories are package-owned, not project-scoped, so they bypass project trust correctly (`packages/context/files/src/skills.ts:67`, which applies trust only to `origin === "project"`). It also confirms that skill text is never interpolated from user or tool output.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11 scope ("Host adoption kit"); `PRODUCT.md` (skills with progressive disclosure)
      - `docs/agent.md:20-60` (skills config and disclosure); `docs/packages.md:108-112` (`skills.list/get/register/addDir`)
      - plan 190 (skills compatibility and load path)
    - Options Considered:
      - Skip the review and write skills directly. Rejected: Task 6 changes a kernel contract (`references/prism.md` §2), and the wiki finding shows that skills already drift from their tools.
    - Chosen Approach:
      - A read-only inventory with measured budgets, so that Tasks 7–9 write against numbers and evidence, not taste.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers addDir --depth all
      timeout 60 graft callers skillMessages --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - `src/skill-disclosure.ts`, `src/skills-catalog.ts`, `src/skill-load.ts`, `src/contribution-parsing.ts:496`, `packages/memory/wiki/src/skills.ts:131`
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none (read-only task).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **Verdict (h): the plan holds. Five findings re-cut Tasks 6–8; none stops the plan.** The amendments are written into those tasks (marked "Amended by Task 5"). In brief:
      1. `toolNames` is a hard requirement that fails the run, not a narrowing (c). Task 6 is re-based on that.
      2. The filter has one choke point, `selectSkillsForPrompt`, plus three places that must follow it (c).
      3. Both wiki skills are already deleted (commit `2815742a`), so there are nine bundled skills, not eleven (f).
      4. No candidate skill has recorded evidence of a model-procedure failure. Every mistake is a `hypothesis` and an eval item for Task 11 (b).
      5. OpenAPI gets no skill, because its tool names are not fixed. Web's `requiresTools` is `web_fetch` alone, because Firecrawl registers no `web_search` (a).
    - **(a) Tool and skill ledger.** Tool names come from `grep` of each package's tool definitions and from a live `inspect()` of the reference host's agents (e). No package registers a `when` gate except those marked.

      | Package (registration site) | Default tools | Fullest config adds | `when` | Skills today | Decision, proposed skill |
      | --- | --- | --- | --- | --- | --- |
      | `tools-web` (`packages/tools/web/src/index.ts:381`) | Search backends (brave, exa, tavily, kagi, searxng): `web_search`, `web_fetch`. Firecrawl: `web_fetch` only. Obscura: `web_search`, `web_fetch` (native fetch when the binary lacks the per-hop guard) | `web_extract` (when `extract` is set), `obscura_fetch` and `obscura_scrape` (`obscura.nativeTools`, default true; the reference host sets false) | none | none | **skill** `web-research`: "Use when a task needs current facts from the web — search, read a page in slices, stop when enough." `requiresTools: web_fetch` only. |
      | `tools-coding` (`packages/tools/coding/src/index.ts:300`) | 13: `shell`, `shell_output`, `read`, `write`, `edit`, `grep`, `glob`, `git_status`, `git_diff`, `git_commit`, `git_pr_handoff`, `todo_write`, `ask_user_decision` (identical to the live `coding` worker) | `coding_check` (checks configured), `diagnostics` (language servers configured); `delete` and `move` instead of `shell`/`shell_output` when the shell is off | none; registration depends on config (`shell.enabled`, `git.enabled`, checks, servers) | none | **skill** `coding-workflow`: "Use for multi-step code changes — locate, edit exactly, verify, report." `requiresTools: read edit` (the always-present pair). |
      | `tools-browser` (`packages/tools/browser/src/index.ts:111`) | `browser_open`, `browser_snapshot`, `browser_act`, `browser_close`, `browser_evaluate`, `browser_observe` (six; the `tools.ts` header comment still says four). CDP gating of the last two was not traced. | — | none | none | **skill** `browser-automation`: "Use when a task needs a real page: open, snapshot, act, re-snapshot." `requiresTools: browser_open browser_snapshot browser_act`. |
      | `tools-openapi` (`packages/tools/openapi/src/index.ts:111`) | one tool per compiled operation, named by the spec (+ `namePrefix`); a cross-spec collision fails closed | — | none | none | **description only.** No fixed names to declare, and the operation description comes from the spec. Effects and approvals are kernel-gated (`effect: external_mutation`). Drop `openapi-calls` from Task 8. |
      | `tools-computer-use` (`packages/tools/computer-use/src/index.ts:143`) | the Linux desktop tools of `create.ts:88`, setup tools only with `includeSetupTools` | — | none | `computer-use-linux` (`toolNames`, 1,491 B) | **skill exists.** Convert `toolNames` to `requiresTools` (see (c) and (f)). |
      | `tools-work` (`packages/tools/work/src/index.ts:269`) | `office_*` (`parse`, `generate`, `patch`, `import`, `diff`, `preview`) | `work_exec` only with the host `work.sandbox` service (`:265`); `gws_*` and `m365_*` connectors by config | none | 4 vendored Hermes skills via `addDir` | **skill exists** (vendored): wrapper or exception, see (f). |
      | `tools-research` (`packages/tools/research/src/index.ts:93`) | `cite` | — | none | 4 (`research-*`, `source-triage`) | **keep**; add `requiresTools: cite` to `research-report` only. |
      | `delegate` (`packages/integrations/delegate/src/index.ts:65`) | `delegate`, `delegate_wait`, `delegate_cancel`; none when no visible child is configured | — | none | none | **skill** `delegating-work`: "Use before handing a task to a child agent — pick the child, write a self-contained brief, collect the result." `requiresTools: delegate`. |
      | `advisor` (`packages/integrations/advisor/src/index.ts:84`) | `advise` unless `tool: false`; the hooks are not model-visible | — | none | none | **description only.** One call whose description carries when and how. |
      | `context-engineering` (`packages/context/engineering/src/index.ts:149`) | `search_tools` when tool search is configured | — | none | none | **none** (a meta-tool). |
      | `mcp` (`packages/integrations/mcp/src/package.ts:223`) | external, no fixed names | — | `when: entry.state === "connected"` | none | **none.** A host that ships its own skill for a server can use `requiresTools` and so follow the connection state. |
      | kernel `load_skill` (`src/agent-session/session/assemble.ts:332`) | the bridge, present when at least one active skill exists and disclosure is progressive | — | — | — | — |
      | `memory-fabric` (`packages/memory/fabric/src/index.ts:601`; the plan's `:504` is stale), `memory-observational` (`:98`), `memory-rag` (`:134`), `memory-wiki` (`src/extension.ts:210`, `wiki_ingest` only), `memory-core` | fabric: `memory.*` (e.g. `memory.recall`, `memory.read`); OM: `recall`; rag: `rag_search`; wiki: `wiki_ingest` | — | fabric `enabled.get(session)`; OM `read(session).enabled`; rag and wiki always | none (the wiki skills are deleted, see (f)) | **deferred — memory track** (plan 210 Task 11). |

      Two things the ledger adds for Task 6: the memory tool names contain a dot (`memory.recall`), so its tool-name validation must accept `.`; and `requiresTools` is all-of only, so a skill that works through either `work_exec` or `shell` cannot say so.
    - **(b) Failure evidence per module.** The sources are plan 189 Task 1, plans 191 and 192 Task 1, and plan 190. The 2026-10-17 agent-perspective evaluation that those plans cite is not in the tree (only the plans mention it). What they record is **tool defects, fixed in the tools**, not a model procedure that a skill must teach. So no "skill" row has recorded failure evidence, and each mistake below is a `hypothesis` for Task 11.

      | Skill | Candidate mistake | Recorded evidence | Status |
      | --- | --- | --- | --- |
      | `web-research` | treats fetched text as instructions | plan 192 Objectives: the untrusted banner never reached the model. Fixed in the kernel envelope (plan 192 Task 2), not by a skill. | `hypothesis` for the skill |
      | `web-research` | dumps whole pages instead of reading slices or asking with `prompt`; keeps searching past enough | plan 192 Task 4 and plan 193 Task 7 added slices and `prompt` as tool features. No transcript shows the model misusing them. | `hypothesis` |
      | `coding-workflow` | edits without reading; silent fuzzy edits; JSON-quoted reads | plan 189 Objectives. Fixed in the tools (read-before-write refusal at `agent/read-path-set.ts`, exact-match `edit`, plain-text results). | `hypothesis` (the defects are gone) |
      | `coding-workflow` | skips verification; ignores `shell_output` for background commands | none | `hypothesis` |
      | `browser-automation` | acts on a stale snapshot ref; forgets `browser_close` | none in plans 189–193 | `hypothesis` |
      | `delegating-work` | writes a brief that assumes shared context (the child sees only the brief); reads a truncated answer as complete | plan 191 Objectives. The brief rule went into the tool description (plan 191 Task 2), and the answer is capped and paged (`delegate_wait`). | `hypothesis` for the skill |
      | `research-*`, `computer-use-linux` | existing skills | package tests only | keep as is |

      Consequence for Task 8: write each skill as thin as the hypotheses allow. The Task 11 paired eval decides whether a skill ships (a skill that does not beat the description-only arm is dropped).
    - **(c) The kernel skill contract today** (verified at these lines):
      - Caps are as stated: `DEFAULT_MAX_SKILL_CATALOG_ENTRIES = 64`, description 512 B, body 32 KiB, hard 256 KiB (`src/skill-disclosure.ts:7-10`). The catalog is one system message built by `skillMessages` (`:101`) from `kernel:context.build` (`src/skills-catalog.ts:35`); `deferSkillCatalog` is called from `src/input.ts:318` with the turn's `tools`.
      - **`toolNames` is not a narrowing; it is a hard requirement that fails the run.** `resolveAllActiveSkills` (`src/skills.ts:69`) runs once per run, before the per-turn `when` filter (`assemble.ts:329`), and throws `Skill X requires inactive tool: Y`. `resolveSkillLoad` throws the same (`src/skill-load.ts:134-136`). `run-tool-names.test.ts:235` pins this: a run with `tools: { only: ["echo"] }` fails while a registered skill names `secret`. Task 6's wording ("narrows tools; not a visibility gate") is wrong, and its rejected option 3 is rejected for a stronger reason: reusing `toolNames` would make an absent tool fail the whole run. `requiresTools` must never reach `assertSkillTools`.
      - `parseSkillFile` (`src/contribution-parsing.ts:496`) reads `name`, `description`, and `toolNames`/`tools` (a list). Every other key goes into `Skill.metadata` as written, so a frontmatter `metadata:` map lands at `skill.metadata.metadata`, not `skill.metadata`. Task 6 must read `front.get("metadata")` for `prism-requires-tools`. The frontmatter parser (`:55`) is a strict YAML subset: nested maps, values stay strings, so `prism-requires-tools: web_fetch` parses as a string.
      - **One choke point, three followers.** `selectSkillsForPrompt` (`src/skill-disclosure.ts:70`) is called by both `skillMessages` (`:102`) and the re-attach path `appendSkillTailSegments` (`src/input.ts:455-527`), so an availability test belongs there, fed by a new `SkillRenderContext.tools` (names) that `deferSkillCatalog` and `input.ts` both fill from the turn's advertised `tools`. Followers:
        - (i) **The cap and the overflow line.** `capSkillCatalog` (`:65`) and `unlisted = all.length - selected.length` (`:114`) must run after the filter, or a hidden skill would use one of the 64 slots and inflate "N more skills are installed but not listed".
        - (ii) **Re-attach.** `byName` is built from the filtered list (`input.ts:466`), so an unavailable skill is skipped silently and also never reaches the "previously loaded" line, because `previous.push` runs only for an earlier-run entry (`:492`). The criterion "the line still names it" is therefore **not** met by a plain filter. Task 6 must route a loaded-but-unavailable entry into `previous`, and must not call `loaded.remove`, so the body re-attaches when the tools return.
        - (iii) **`load_skill`.** It checks `metadata.activeTools`, which is `ctx.tools` (`session/tool-round.ts:423`): the run's list, not the per-turn list after the per-turn `when` filter and any `RunTurnOptions.tools` clamp. So a skill hidden this turn by a `when` flip would still load. The `skill_unavailable` check needs the turn's advertised names (`ctx.turnAllow` already carries them when a filter applies).
      - Eager disclosure goes through the same `selectSkillsForPrompt` (`:70-74`), so one filter there also covers it. `applyRestoredSkillBodies` (`src/skill-load.ts:81-93`) spreads the registered skill and overlays `instructions`, so `requiresTools` survives for a known skill. A restored body with no registered skill is pushed as `{ name, instructions }`, which has no requirement and so is always available; Task 6 needs a test for both.
      - **Tool search.** The context-engineering stage can narrow the tool list inside `context.build`, after assembly. Filtering on the assembly-time `tools`, not on `draft.tools`, keeps the catalog stable when `search_tools` activates a tool.
    - **(d) Agent Skills compatibility** (find-docs, `/websites/agentskills_io`, agentskills.io/specification, 2026-11-05). Frontmatter: `name` (1–64, lowercase letters, digits and hyphens, must match the directory), `description` (1–1024), `license`, `compatibility` (≤500), `metadata` ("a map from string keys to string values", for "additional properties not defined by the Agent Skills spec", with a recommendation to use unique key names), and `allowed-tools` (a space-separated string, "experimental", support "may vary"). So `metadata.prism-requires-tools: web_fetch web_search` is valid by the spec, with a unique key and a space-separated value. **Not verified:** whether Claude Code and Codex tolerate unknown `metadata` keys at run time. Only the spec's extension-point wording was found, no tool-specific doc. Task 10 must check that against each agent before it relies on it. Prism's own `NAME_RE` (`/^[A-Za-z0-9 _-]+$/`, `contribution-parsing.ts:489`) is wider than the spec: the gate (Task 7) should enforce the spec's name rule for package skills.
    - **(e) Catalog measurement** (reference host, mock provider, `opencode-go/mimo-v2.5` limits because the compaction trigger needs a context window; first request of a fresh session; a throwaway script, removed):

      | Agent | Skills | Catalog entries | Catalog bytes | System-prefix bytes | Tool-schema bytes | First-request bytes |
      | --- | --- | --- | --- | --- | --- | --- |
      | coding | 0 | 0 | 0 | 4,616 | 13,617 | 18,385 |
      | research | 4 | 4 | 576 (144 per line) | 2,474 | 5,936 | 8,602 |
      | orchestrator | 0 | 0 | 0 | 403 | 1,545 | 2,076 |

      Caveats: the research worker registered no `web_*` tools here (the Obscura binary is absent, so the package warns and registers none), only `browser_*`, `cite` and `load_skill`. So the web skill would be hidden in this environment, which is the case `requiresTools` exists for. These first-request bytes are not comparable to Task 3's table (that run used a different model), but the tool-schema bytes match it exactly (13,617 and 5,936).
      - **Budgets for Task 7** (reference host's fullest agent after Part B, projected at 13 entries: 4 research + 4 work + 1 computer-use + web, coding, browser, delegate at the cap):
        - catalog ≤ 16 entries and ≤ 3,072 bytes (projected ≤ 2.4 KB, about 25% headroom);
        - description ≤ 300 B (the largest today is about 130 B);
        - Prism-authored body ≤ 8 KiB, detail in `references/`;
        - vendored skills carry a recorded exception (see (f)).
    - **(f) Existing skills audit.** There are **nine** bundled skills, not eleven: `packages/memory/wiki/skills/{wiki-searcher,wiki-maintainer}`, `packages/memory/wiki/src/skills.ts` and its test were deleted in commit `2815742a` (WIP). Task 7's wiki-deletion bullet therefore reduces to a stale-reference sweep (`retired-names.test.ts` already guards the retired tool names).

      | Skill | Body | Description | Verdict against the proposed contract |
      | --- | --- | --- | --- |
      | `research-scoping`, `research-synthesis`, `research-report`, `source-triage` | 297–405 B | ≤ 130 B | pass; names are lowercase-hyphen and match their directories |
      | `computer-use-linux` | 1,491 B | ~110 B | passes size; uses `toolNames` (hard-fail, see (c)), so convert to `requiresTools` (`computer-use/src/skill.ts:10` builds it by hand). Whether `includeSetupTools: false` makes this run-failing was not tested. |
      | `docx`, `xlsx`, `powerpoint`, `pdf` (Hermes, vendored) | 9,655 / 10,395 / 10,781 / 12,489 B | ≤ 70 B | over 8 KiB, under the 32 KiB kernel default and the work package's 64 KiB cap |

      - **Hermes decision: a recorded vendored-skill exception for size, plus a Prism-side wrapper for the tool contract.** The skills teach `python`, `openpyxl`, `python-docx`, `pypdf` and `soffice`, and never name `office_*` or `work_exec`, so their vocabulary does not match `tools-work`. `index.ts:271` registers the directory through `addDir` with no tool declaration, while the exported `loadWorkSkills` (`skills/load.ts:23`, unused by the package's own setup) stamps `toolNames: office_*`, which would hard-fail on narrowing. Task 8 should register through a wrapper that overrides the declaration with `requiresTools: work_exec` and leaves the vendored bytes untouched (`vendor-lock.json` records repo, sha and paths only, and is read by `skills/__tests__/load.test.ts`; no content hash was found). The all-of limit applies: these skills also work through a coding `shell`, which the wrapper cannot express.
    - **(g) Cache.** Package setup is sequential in stable topological order (`src/packages/loader.ts:215,970`), and host `skills.add` skills come before package skills (`runtime-registry.ts:132`), so the catalog order is deterministic for a fixed package list. Caveat: the 64-entry cap cuts from the end, so host skills win over package skills. A `when` flip changes the advertised tool list, which sits before messages in the provider prefix, so a catalog change that follows it adds no new break, provided the filter reads the same list the request advertises (the (c) rule). The fabric and observational flips change both together.
    - **Security.** Confirmed. `context-files` applies trust only to `origin === "project"` roots (`packages/context/files/src/skills.ts:67,86`); package skills enter through `prism.skills.addDir` and `register` from package-owned paths (`new URL("../skills", import.meta.url)`) and never use that code. Skill text is `name`, `description` and `instructions` from files, and `load_skill` interpolates only the skill's own path (`skill-load.ts:241`). No tool output or user text reaches a skill. A discovered project skill's `requiresTools` can only hide that skill; it grants no tool.
    - **Checks run.** None needed (read-only). The tree has no change outside this plan; the measurement script was removed. `graft callers skillMessages|deferSkillCatalog --depth all` and `graft callers addDir` were run per the task's example (`addDir` has no indexed callers; the package registrations were found by `grep`).

- [x] Task 6: Skills are listed only when their tools are available (kernel) (was plan 211 Task 2)
  - Acceptance Criteria:
    - Functional:
      - `Skill` gains `readonly requiresTools?: readonly string[]`. `parseSkillFile` reads it from frontmatter `metadata.prism-requires-tools`, a space-separated string as Agent Skills `allowed-tools` is written. A malformed value (not a string, or a token that is not a valid tool name) makes `parseSkillFile` throw. For a package skill, that fails the package's setup, as any `addDir` read failure does (`docs/packages.md:112`). For a discovered skill, `context-files` skips it with a status note.
      - Per request, a skill with `requiresTools` is rendered (catalog line, or body in eager or loaded mode) only when every name is in that request's advertised tools. The advertised tools are what is left after `disable.tools`, `tools.only` / `selectRunTools` (`src/agent-session/session/assemble.ts:325`), and `when` predicates.
      - `load_skill` on a registered but unavailable skill returns a tool error with code `skill_unavailable` that names the missing tools; the run continues. An unknown name keeps its current error.
      - Compaction re-attach (plan 190) never re-attaches an unavailable skill. The "previously loaded" line still names it, so the model can load it again once the tools come back.
      - `inspect().skills` and `PackageAPI.skills.list()` still list every registered skill and include `requiresTools`, so a host can see why one is hidden.
      - A skill without `requiresTools` behaves exactly as today.
      - **Amended by Task 5 (2026-11-05), from the review's (c) findings:**
        - The availability test lives in `selectSkillsForPrompt` (`src/skill-disclosure.ts:70`), fed by a new `SkillRenderContext.tools` (names) that `deferSkillCatalog` (`src/input.ts:318`) and `appendSkillTailSegments` (`src/input.ts:455`) fill from the turn's advertised `tools`, not from `draft.tools`. It runs before `capSkillCatalog` and before the `unlisted` count, so a hidden skill takes no slot and is not counted.
        - Re-attach: a loaded but unavailable skill is not re-attached and **is** named in the "previously loaded" line, and it stays in the loaded set (no `remove`), so its body returns when the tools do. A test pins both.
        - `load_skill` checks the turn's advertised names (`ctx.turnAllow` when a filter applies), not the run-level list (`session/tool-round.ts:423`), so a `when`-hidden tool's skill cannot be loaded.
        - `requiresTools` is separate from `toolNames`, which fails the run on a missing tool (`src/skills.ts:69`, `src/skill-load.ts:136`). It never reaches `assertSkillTools`. The computer-use skill (`packages/tools/computer-use/skills/computer-use-linux/SKILL.md`) switches from `toolNames` to `requiresTools` in this task.
        - `parseSkillFile` reads `front.get("metadata")` (a nested map; today it lands at `skill.metadata.metadata`). Tool-name validation accepts `.` (`memory.recall`). `requiresTools` is all-of; "any of" is out of scope and is recorded as a limit in the docs.
      - Retirement sweep: no name retires. Grep `src/ packages/ apps/ scripts/ examples/ docs/` for hand-written `Skill` literals and parsers that should pass the new field through (`packages/memory/wiki/src/skills.ts:146`, `packages/tools/work/src/skills/load.ts:23`, `packages/tools/computer-use/src/skill.ts:10`, `packages/context/files/src/skills.ts:99`), and update them.
    - Performance: The filter is O(skills × required names) per request over in-memory sets; no I/O. A catalog-rendering micro-test records that the filter adds under 1 ms for 64 skills × 8 names. The catalog of an agent whose skills declare nothing is byte-identical to today's (prefix-stability fixture).
    - Code Quality: The filter sits in the kernel's catalog drafting (`src/skills-catalog.ts`, `src/skill-disclosure.ts`), not in a package. One helper decides availability, and catalog, eager bodies, re-attach and `load_skill` all call it. No alias field; `toolNames` keeps its existing meaning.
    - Security: Hiding a skill grants nothing. `requiresTools` never adds a tool, and `toolNames` narrowing is unchanged. A hidden skill's body is never sent. A `when` predicate that throws hides its tool (fail closed, `src/packages/api.ts:38`) and therefore its skills.
  - Approach:
    - Documentation Reviewed:
      - `src/skill-disclosure.ts:94-118`, `src/skills-catalog.ts:24`, `src/loop/request-draft.ts:6-14`, `src/skill-load.ts:5,189`, `src/agent-run-restore.ts:28-33`
      - `src/packages/api.ts:36-41` (`PackageToolOptions.when`), `docs/agent.md:20-60`
      - Agent Skills frontmatter rules (Task 5 (d))
    - Options Considered:
      - **`PackageAPI.skills.register(skill, { when })`, mirroring tools.** Rejected: it duplicates each tool's predicate in its skill, misses `tools.only` and `disable.tools`, and gives skills discovered from disk (with no code) nothing to declare.
      - **A `context.build` transform in each package that strips its own catalog lines.** Rejected: every package would re-parse a kernel-rendered message, and `load_skill` would still serve the body.
      - **Derive availability from the existing `toolNames`.** Rejected: `toolNames` is already a hard requirement that fails the run when a tool is missing (Task 5 (c)), and other agents' `allowed-tools` means "may use", not "requires". Overloading it would turn a hidden skill into a failed run, or change what existing skills do.
      - **Top-level frontmatter key `requires-tools`.** Rejected: it is outside the Agent Skills schema, so validators may reject it. `metadata` is the spec's extension point.
    - Chosen Approach:
      - A declared, data-only requirement checked at render time against the request's tool list, which is already final when the catalog is drafted. Kernel placement proof: no hook, slot, `PackageAPI` member or primitive covers it (see options), and at least five packages need it (web, fabric, observational, delegate, browser; Task 5 (a)).
    - API Notes and Examples:
      ```markdown
      ---
      name: web-research
      description: Use when a task needs current facts from the web — search, read a page, extract a value.
      metadata:
        prism-requires-tools: web_search web_fetch
      ---
      ```
      ```ts
      interface Skill { /* … */ readonly requiresTools?: readonly string[] }
      // load_skill("web-research") with web tools narrowed away:
      // tool error { code: "skill_unavailable", missing: ["web_search", "web_fetch"] }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts` (+ `.d.ts`): `Skill.requiresTools`
      - `src/contribution-parsing.ts`: parse `metadata.prism-requires-tools`
      - `src/skill-disclosure.ts`, `src/skills-catalog.ts`: availability helper; filter catalog and bodies
      - `src/skill-load.ts`: `skill_unavailable`
      - `src/input.ts` (`appendSkillTailSegments`, `:455-527`, the plan 190 re-attach site) and `src/skill-load.ts` (`applyRestoredSkillBodies` keeps `requiresTools`; `resolveSkillLoad` gets the turn's names)
      - `packages/tools/computer-use/skills/computer-use-linux/SKILL.md`: `toolNames` becomes `metadata.prism-requires-tools`
      - `packages/memory/wiki/src/skills.ts`, `packages/tools/work/src/skills/load.ts`, `packages/tools/computer-use/src/skill.ts`, `packages/context/files/src/skills.ts`: pass the field through where they build `Skill` by hand
      - `src/__tests__/skill-availability.test.ts` (new)
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; the task note records the diff (one added interface member, attributed to this plan, ex-211)
      - `docs/agent.md`, `docs/tools.md`, `CHANGELOG.md`
    - References:
      - plan 190 Tasks 3–4 (load path, catalog block)
  - Test Cases to Write:
    - `skill_hidden_when_required_tool_absent`: the catalog omits the skill under `tools.only` without its tool. Fails if the filter is skipped.
    - `skill_hidden_when_tool_when_false`: a package tool gated by `when` hides its skill on that turn only.
    - `skill_hidden_when_tool_disabled`: `disable.tools` hides the skill.
    - `load_skill_unavailable_is_tool_error`: returns `skill_unavailable` naming the missing tools; the run completes. Fails if it throws or if it returns the body.
    - `eager_body_not_sent_when_unavailable`: eager mode omits the body.
    - `reattach_skips_unavailable_skill`: after compaction, an unavailable skill is named, not re-sent.
    - `skill_without_requirement_unchanged`: catalog bytes equal a golden from before this change.
    - `requires_tools_malformed_fails_package_setup` and `requires_tools_malformed_discovered_skill_skipped_with_note`.
    - `skill_availability_default_and_custom_loop`: the behavior holds under the default loop and under `loopConformance` with a custom loop (`references/prism.md` §3 probe 2).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new `Skill` field, a frontmatter key, catalog behavior, and a `load_skill` error.
    - Docs pages to create/edit:
      - `docs/agent.md`: skills section — `requiresTools`, availability rules, `skill_unavailable`
      - `docs/tools.md`: how `when`, `tools.only` and `disable.tools` affect skills
      - `CHANGELOG.md`: `## [Unreleased]` entry
    - `docs/index.md` update: no (edits inside indexed pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.** `Skill.requiresTools` (`src/contracts-core/agent.ts`); `parseSkillFile` reads `front.get("metadata")["prism-requires-tools"]` (`src/contribution-parsing.ts`): a string only, space-separated, deduped, at most 32 names, each `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`, so `memory.recall` and MCP names pass; anything else throws. One helper, `missingSkillTools` (`src/skill-disclosure.ts`), decides availability. `SkillRenderContext.tools` (a name set) feeds `selectSkillsForPrompt`, which now filters before `capSkillCatalog` and before the `unlisted` count. `assembleProviderInput` fills it from the turn's `options.tools` on all three paths (deferred catalog, non-deferred catalog, tail bodies), never from `draft.tools`. `appendSkillTailSegments` names a loaded-but-unavailable skill in the "previously loaded" line, drops its tail segment, never calls `loaded.remove`, and skips the mention when the body is still visible in the transcript. `load_skill` throws `SkillUnavailableError` from `resolveSkillLoad` (new `advertisedToolNames`) and `createLoadSkillTool` turns it into a result with `error.code: "skill_unavailable"` and `value.missing`; `tool-round.ts` passes `advertisedToolNames: ctx.turnAllow ?? ctx.tools` so a `when`-hidden or clamped tool's skill cannot be loaded. `agent.skills` and `inspect().skills` carry `requiresTools`. The computer-use `SKILL.md` moved from a 16-name `toolNames` list to `metadata.prism-requires-tools`.
    - **Findings for later tasks.**
      - `packages/memory/wiki/src/skills.ts` no longer exists (plan 207 retired the wiki's bundled skills; `package_metadata_ships_one_entry_and_no_bin_or_skills` pins it). Nothing to pass through there. The wiki and the other memory packages get skills only from plan 210 Task 11.
      - `packages/tools/work` and `context-files` build skills with `parseSkillFile` and spread the result, so `requiresTools` passes through with no edit. The work skills keep `toolNames` from `WORK_SKILL_TOOLS`: they are hard requirements by design, and Task 8/9 decide whether any should become `requiresTools`.
      - `inspect().skills` keeps the `InspectedContribution` name and gains an optional `requiresTools` through an inline intersection, to avoid one more root type export.
      - `assembleProviderInput` reads `tools` as the turn's list, so a direct `assembleProviderInput` caller that passes no `tools` gets an empty set and every skill with a requirement is hidden (fail closed). `skillMessages` called without `context.tools` does not filter.
      - Task 7's check (3) can use `Skill.requiresTools` as parsed; computer-use now has 16 names under one `metadata` key, so its 8 KiB body check is unaffected.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism.txt`, three added lines, all attributed to this task; the `Skill`/`SkillInfo` members do not appear because the baseline lists interfaces by name):
      - `+SKILL_UNAVAILABLE_ERROR_CODE  export declare const SKILL_UNAVAILABLE_ERROR_CODE: "skill_unavailable"`
      - `+SkillUnavailableError  export declare class SkillUnavailableError extends SkillLoadError`
      - `+missingSkillTools  export declare function missingSkillTools(skill: Skill, tools: ReadonlySet<string> | undefined): readonly string[]`
      The same gate run also rewrote `arnilo__prism-memory-fabric.txt` (+3/-2); that comes from the uncommitted plan 208/210 fabric work in the tree, not from this task. Kernel budgets in `scripts/budgets.json` were rebaselined with a reason: 1208885 packed / 3935310 unpacked / 1519 root exports / 40406 source lines (+2595 / +9146 / +3 / +105 over the Task 4 ceilings).
    - **Sweep.** No name retires. Hand-written `Skill` literals and parsers: `packages/tools/computer-use/src/skill.ts`, `packages/tools/work/src/skills/load.ts`, `packages/context/files/src/skills.ts` all route through `parseSkillFile`; no `toolNames` consumer needed `requiresTools`.
    - **Tests.** `src/__tests__/skill-availability.test.ts` (16): every case in the task list plus `load_skill_unavailable_when_tool_hidden_by_when`, `load_skill_available_loads_the_body`, restored-body behavior, catalog-slot accounting, a 64×8 filter cost bound (asserted under 5 ms per catalog render, a looser bound than the task's 1 ms filter figure because it times the whole render; the filter alone was not timed separately), and parser cases. `requires_tools_malformed_discovered_skill_skipped_with_note` is in `packages/context/files/src/__tests__/skills.test.ts`. Disabling the filter fails 8 of the 16, so they do check it. The custom-loop case uses a hand-written `LoopStrategy` through `controller.turn` and `executeTools`, not `loopConformance`.
    - **Checks run.** `bun run typecheck` clean; `bun scripts/release.mjs gate` passes; the skill, docs, computer-use, work and context-files suites pass (474). The full `bun test src` run has five failures in files this task did not touch (not re-run against a clean checkout, so "pre-existing" is inferred from what each one asserts): `network-free-guard` (two: `provider-live-selection.test.ts`, `kagi.test.ts`), `mock-provider-package` (codemod), the wiki `package.test.ts` skills-retired check, and the field-policy timing benchmark. They belong to the plan 207/208 work in progress and Task 3's test hygiene, not to this task.
    - **Docs.** `docs/tools.md` ("Skills that need tools"), `docs/agent.md` (a pointer paragraph), `CHANGELOG.md`.

- [x] Task 7: The package skill contract and its gate (was plan 211 Task 3)
  - Acceptance Criteria:
    - Functional:
      - `docs/packages.md` gains "Writing a package skill". It covers:
        - when a package ships a skill versus relying on tool descriptions (Task 5 (a) rule)
        - naming (the package domain first, e.g. `web-research`, `coding-workflow`)
        - the description shape: when to use it, then what it covers, in at most the Task 5 (e) cap
        - the body shape: a short procedure, decision points, failure recovery, and stop conditions, with details in `references/`
        - `requiresTools`
        - optional tools: any tool not in `requiresTools` may appear only under a heading of the form `If \`<tool>\` is available`
        - no secrets, URLs to private systems, or host product opinions
      - `scripts/package-skills-conformance.mjs` plus `src/__tests__/package-skills.test.ts` (`package_skills_conform`) loads every workspace package that ships skills, runs its setup on the mock provider under its fullest test config, and checks every skill. Checks:
        - (1) it parses
        - (2) description and body are within caps
        - (3) every `requiresTools` name is registered by that package, or by a package it declares in `requires`
        - (4) every backticked token in the body that is a tool name known to any workspace package, or listed in `scripts/retired-tool-names.json` (new in this task; there is no retired tool-name inventory today, so seed it from the removals of plan 189 Task 8 — `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree` — and plan 207 — `wiki_record_insight`, `wiki_search`, `wiki_read_page`; plan 210 Task 7 adds its removals later; Task 35's sweep reads it too), is registered by this package or by a declared dependency, and appears under an "If … is available" heading when it is not required
        - (5) the package's `package.json` `files` includes the skill directory
        - (6) no two packages ship the same skill name
      - The test also asserts the reference host catalog budget from Task 5 (e): for each `apps/prism-agent` agent, package-skill catalog entries and bytes are within the recorded maximum. It is wired into `release:gate` (`docs/release.md`, "What the gate runs").
      - **Amended by Task 5 (2026-11-05):** the budgets are 16 catalog entries and 3,072 bytes for the reference host's fullest agent, descriptions ≤ 300 B, Prism-authored bodies ≤ 8 KiB. The gate also enforces the Agent Skills name rule (lowercase letters, digits and hyphens, matching the directory), because Prism's own parser accepts more. Check (3) must allow a `requiresTools` name from `tools-work`'s optional `work_exec` only if the test config provides the sandbox service.
      - Today's 9 skills (not 11: the two wiki skills are already deleted) are brought into conformance in this task, per Task 5 (f):
        - research and computer-use: description and `requiresTools` edits
        - work: the Task 5 (f) decision is a recorded size exception for the four vendored skills plus a Prism-side wrapper that stamps `requiresTools: work_exec` (replacing the bare `addDir` at `packages/tools/work/src/index.ts:271`); the vendored bytes stay unchanged and pinned to `vendor-lock.json`
        - wiki: **already done** (Task 5 (f)): both wiki skills, `packages/memory/wiki/src/skills.ts` and its test went in commit `2815742a`, and the memory packages' skills belong to plan 210 Task 11. This task only sweeps for leftovers. Grep for `wikiSearcherSkill`, `wikiMaintainerSkill`, `wiki-searcher`, `wiki-maintainer`, `vsearch`, `wiki_record_insight` must return nothing outside `docs/history/`, `docs/_evidence/`, `plans/` and `packages/memory/wiki/src/__tests__/retired-names.test.ts`. Known leftovers to clear or exclude: `scripts/compat-baseline/arnilo__prism-wiki.txt` and `arnilo__prism-memory.txt` (the latter is an orphan baseline, Task 2 note), and the `docs/migrate-to-0.13.md` and `CHANGELOG.md` lines, which describe the removal and stay.
    - Performance: The gate runs in under 30 s locally (it builds each package agent once on the mock provider). The test records the timing.
    - Code Quality: One script, reused by the test and by `release:gate`. Budgets live in `scripts/budgets.json` next to the tarball budgets, with a dated `$comment`.
    - Security: The gate fails closed: a package that ships `skills/` but whose skills fail to load fails the gate rather than being skipped. Skill bodies are scanned for `env:`/`keyring:` literals and for strings that `redactSecrets` would mask; any hit fails.
  - Approach:
    - Documentation Reviewed:
      - `docs/packages.md:108-112`; `docs/release.md` ("What the gate runs"); `scripts/budgets.json`
      - `packages/tools/research/src/index.ts:137`, `packages/tools/work/src/index.ts:271`, `packages/tools/computer-use/src/index.ts:144`
    - Options Considered:
      - **Review skills by hand at release.** Rejected: the wiki drift happened under exactly that regime.
      - **A strict whole-word tool-name scan of every backticked token.** Rejected: office skills legitimately backtick argument names (`bold`, `color`). Matching only against the known-tool-name universe plus retired names catches drift without false positives.
    - Chosen Approach:
      - A data-driven gate that loads the real packages, so "registered tools" means what the agent actually gets, not a hand-kept list.
    - API Notes and Examples:
      ```bash
      timeout 120 bun scripts/package-skills-conformance.mjs --json
      ```
    - Files to Create/Edit:
      - `scripts/package-skills-conformance.mjs` (new), `src/__tests__/package-skills.test.ts` (new)
      - `scripts/retired-tool-names.json` (new)
      - `scripts/budgets.json`: `packageSkills` entry
      - `scripts/release.mjs` (tentative: or the gate's stage list file Task 5 identifies): add the stage
      - `docs/packages.md`, `docs/release.md`
      - `packages/tools/research/skills/*/SKILL.md`, `packages/tools/computer-use/skills/computer-use-linux/SKILL.md`, `packages/memory/wiki/skills/**` and `packages/memory/wiki/src/skills.ts`, `packages/tools/work/src/skills/*` (per Task 5 (f))
      - each touched package's `README.md` ("What it changes": skills) and `CHANGELOG.md`
    - References:
      - `packages/memory/wiki/skills/wiki-searcher/SKILL.md:7,34` (drift example)
  - Test Cases to Write:
    - `package_skills_conform`: passes on the tree. Fixture variants make it fail on a skill naming an unregistered tool, a retired tool (`wiki_record_insight`), an over-cap description, a missing `files` entry, or a duplicate name.
    - `optional_tool_outside_conditional_heading_fails`.
    - `reference_host_skill_catalog_within_budget`: fails when one extra 300-byte skill pushes an agent over budget.
    - `skill_body_contains_no_secret_ref`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new authoring contract and gate, and the existing package skills change.
    - Docs pages to create/edit:
      - `docs/packages.md`: "Writing a package skill"
      - `docs/release.md`: the new gate stage
      - READMEs of research, computer-use, work and wiki: skills listed in "What it changes"
      - `CHANGELOG.md`
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - `scripts/package-skills-conformance.mjs` (new): `runPackageSkillsGate()` builds each fixture's packages on a mock-provider agent (`createAgent`, no provider call), reads the registered skills and owners through `agentSkillSource` / `tryAgentRuntime(...).packages.skillEntries()`, and runs checks (1)-(6) plus the security scan. `defaultFixtures()` holds the fullest test config of `tools-research`, `tools-computer-use` (a fake MCP bridge fed `COMPUTER_USE_LINUX_TOOL_NAMES`) and `tools-work` (a fake `work.sandbox`, so `work_exec` registers). `--json` prints the report; the test and `release:gate` share the one entry point.
      - Fail-closed discovery: `findUncoveredSkillPackages` fails any workspace package that has a `skills/` directory or a non-test `skills.addDir(` / `skills.register(` call and no fixture. `packages/context/files` is the one named exemption (it loads the user's skill files and ships none). A skill that fails to load fails the fixture's `createAgent`, which the gate reports as a `load` failure; a package with a `skills/` directory that registers none also fails.
      - Check (4) universe: tools registered by any fixture agent, `scripts/retired-tool-names.json` (new; 8 names, seeded from plans 189 Task 8 and 207), and a static scan of workspace sources for `name: "snake_case"` literals in files that define `execute`. Only the exact backticked token is matched, so argument names stay free. A tool in `requiresTools` may appear anywhere; any other registered tool must sit under a heading `If \`<tool>\` is available` that names it, and a later heading of the same or higher level ends the section. The heading must name the tool, which is stricter than the plan text ("an 'If ... is available' heading").
      - Budgets: `scripts/budgets.json` `packageSkills` (16 entries, 3,072 bytes, 300 B description, 8 KiB body, the four vendored names as the size exception, a 30 s ceiling through `wallClockBudget`). The size exception applies only to a skill whose path contains `vendor/`. Catalog bytes are the sum of `- name: description` lines plus newlines (the preamble is not counted), matching how Task 5 (e) measured 576 B for four lines.
      - Reference-host budget: `measureReferenceHostAgents` builds the coding, research and orchestrator agents from `apps/prism-agent/src/host` on the mock provider (an Obscura fixture binary, a scratch workspace) and applies `requiresTools` against each agent's own tools. Measured today: coding 0 entries, research 4 entries / 502 B, orchestrator 0 entries. A host that cannot be built fails the gate; it is never skipped.
      - Existing skills brought into conformance: the four research descriptions now open with "Use ..." (`research-report` also declares `metadata.prism-requires-tools: cite`); `computer-use-linux` has a "Use when ..." description and no longer names the host-only `setup_accessibility` / `setup_window_targeting` in its body (they are not registered with `includeSetupTools` off, so check (4) would fail them); the vendored Hermes skills register through `loadWorkSkills()` with `requiresTools: ["work_exec"]` instead of `addDir` (`packages/tools/work/src/index.ts`). `WORK_SKILL_TOOLS` is replaced by `WORK_SKILL_REQUIRES_TOOLS` with no alias. The vendored `SKILL.md` bytes are untouched.
      - Wiki sweep: `packages/memory/wiki/src` holds no skill leftovers. The remaining hits are the guard `retired-names.test.ts`, the `CHANGELOG.md` and `docs/migrate-to-0.13.md` lines that describe the removal, and the two `arnilo__prism-wiki.txt` / `arnilo__prism-memory.txt` baselines. Those two are not orphans: `release-gate.test.mjs` `no_compat_baseline_without_workspace` keeps them as legacy-registry freeze literals, so they stay. `scripts/retired-tool-names.json` is allow-listed in the wiki sweep, as `deprecations-0.13.json` is.
      - Wiring and docs: `release:gate` runs the script after the kernel-constraint tests (`package.json`); `docs/packages.md` "Writing a package skill"; `docs/release.md` ("What the gate runs"); research, computer-use and work READMEs and CHANGELOGs.
    - **Findings for later tasks.**
      - Task 8: the `tools-work` decision is done here, so Task 8 does only web, coding and browser. Add each as a fixture in `defaultFixtures()` in the same task: the gate fails a package that registers a skill without one. `tools-web` needs a fixture config that registers `web_fetch` (the host's Obscura fixture, or a Firecrawl key ref), and `tools-coding` a scratch root; the coding worker needs a real workspace directory, or its git probe fails with `ENOENT`.
      - Task 10 (vendor agents) can rely on `Skill.requiresTools` for the work skills as registered, but they now have no `toolNames`, so nothing hard-fails on a narrowed run.
      - Task 35's sweep reads `scripts/retired-tool-names.json`. Plan 210 Task 7 adds its removals there.
      - `computer-use` stays all-of on 16 names; the gate checks them against a fake bridge that registers every upstream tool, not against the real binary.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-tools-work`): `-WORK_SKILL_TOOLS`, `+WORK_SKILL_REQUIRES_TOOLS  export declare const WORK_SKILL_REQUIRES_TOOLS: readonly ["work_exec"]`, and the `LoadWorkSkillsOptions` re-export line changed to match. The same run also touched `arnilo__prism-memory-fabric.txt` and `arnilo__prism.txt`; those come from the uncommitted plan 208/210 and Task 6 work in the tree, not from this task. Kernel budgets rebaselined with a reason: 1210011 packed / 3938305 unpacked (+1126 / +2995), docs only (`docs/packages.md`, `docs/release.md` ship in the root tarball); no kernel source changed.
    - **Tests.** `src/__tests__/package-skills.test.ts` (21 with the wiki sweep): `package_skills_conform` (the tree passes in about 0.5 s), the failing variants (unregistered tool, a dependency supplying a tool, `requiresTools` on an unregistered tool, a retired tool read from the inventory, over-cap description and body, a name outside the spec rule, missing `files`, duplicate name, `optional_tool_outside_conditional_heading_fails` with its section-end case, `skill_body_contains_no_secret_ref`, a skills directory that registers none, a skill that fails to load, a fixture-less skill package), and `reference_host_skill_catalog_within_budget` plus the 300-byte-skill case. The retired-tool test reads its name from the inventory because the wiki retired-name sweep fails on the literal.
    - **Checks run.** `bun run typecheck` clean; `bun scripts/release.mjs gate --package @arnilo/prism-tools-work` passes; `bun scripts/package-skills-conformance.mjs` passes; research (13), computer-use (32), work skills and package tests (11), `skill-availability` (16), `docs` and `packaging` (347) pass. `bun run lint` exits 1 repo-wide; biome on the files this task touched is clean, and I did not check which files cause the repo-wide failure. `scripts/budget-gate.test.mjs` fails two tests (per-package export counts and the non-null allowlist, both listing the pre-consolidation `packages/acp-agent`, `packages/mcp`, `packages/memory` paths), and `release-gate.test.mjs` fails `no_compat_baseline_without_workspace` on two other orphan baselines (`arnilo__prism-agent-sdk.txt`, `arnilo__prism-work.txt`, the deleted 0.12 workspaces; not touched here, left for the Task 2 / Task 35 baseline sweep); I did not run these against a clean checkout, so "pre-existing" is inferred from what they assert, not proven.

- [x] Task 8: Tool package skills — web, coding, browser, office (OpenAPI dropped by Task 5) (was plan 211 Task 4)
  - Acceptance Criteria:
    - Functional:
      - Each package the Task 5 ledger marks "skill" ships its skills under `skills/<name>/SKILL.md`, registers them with `prism.skills.addDir`, and lists `skills` in `package.json` `files`. Expected set (the ledger may change it):
        - `tools-web` → `web-research`: choosing search controls; fetching with a `prompt` instead of dumping pages; reading slices; treating results as untrusted; when to stop searching
        - `tools-coding` → `coding-workflow`: read before edit, exact-match edits, verify with `shell`/`diagnostics`, background processes, keeping diffs small
        - `tools-browser` → `browser-automation`
        - `tools-work`: **done in Task 7** (the `loadWorkSkills()` wrapper stamps `requiresTools: work_exec`; the size exception is recorded in `scripts/budgets.json`). Task 8 adds nothing for it.
      - **Amended by Task 5 (2026-11-05):**
        - `tools-openapi` gets **no skill** (the ledger's "description only"): its tool names come from each spec, so there is nothing fixed to declare, and effects and approvals are kernel-gated.
        - Declared requirements (all-of, always-present tools only): `web-research` → `web_fetch` (Firecrawl registers no `web_search`); `coding-workflow` → `read edit` (`shell` can be off); `browser-automation` → `browser_open browser_snapshot browser_act`; office → `work_exec` through the wrapper.
        - Every skill body is a hypothesis (Task 5 (b)): keep it thin, and let the Task 11 paired eval decide whether it ships.
        - The coding worker's system prefix is already 4,616 B, so dedupe `coding-workflow` against the host's instructions before writing it.
        - The "`addDir` is the only path" rule has one exception: `tools-work` stamps `requiresTools` on the vendored skills in code, as `loadWorkSkills` (`packages/tools/work/src/skills/load.ts:23`) already does for `toolNames`.
      - Every skill declares `requiresTools`. Each is written against the failure evidence in Task 5 (b) and passes `package_skills_conform`.
      - A package whose optional tool is off (e.g. `tools-web` without `extract`) still registers the skill; its "If `web_extract` is available" section is just inert text, and `requiresTools` names only always-present tools.
    - Performance: Each skill adds one catalog line (≤ Task 5 (e) cap) and no setup I/O beyond `addDir`'s post-setup read. The reference host budget test stays green.
    - Code Quality: Skills are package files, not strings in TypeScript. No per-package skill loader is added; `addDir` is the only path, as research and work already do.
    - Security: Skills restate the packages' safety rules (untrusted web content, approval-gated effects) and never instruct the model to bypass a gate. `web-research` tells the model that fetched text is data, not instructions, consistent with the untrusted-result envelope of plan 192 Task 2.
  - Approach:
    - Documentation Reviewed:
      - package READMEs: `packages/tools/web/README.md`, `packages/tools/coding/README.md`, `packages/tools/browser/README.md`, `packages/tools/openapi/README.md`, `packages/tools/work/README.md`
      - plans 189, 192, 193 (tool behavior the skills teach)
      - `packages/tools/web/src/tools.ts:25-110` (tool descriptions computed from config)
    - Options Considered:
      - **Put the procedures into longer tool descriptions.** Rejected: descriptions are sent every turn, so a procedure there costs tokens on every request, while a skill body costs them only when loaded.
      - **One "prism-tools" skill covering every package.** Rejected: it would teach tools the agent does not have, and it is not versioned with each package.
    - Chosen Approach:
      - Short per-package skills that keep "what this tool does" in the description and "how to do the job" in the skill.
    - API Notes and Examples:
      ```ts
      prism.skills.addDir(fileURLToPath(new URL("../skills", import.meta.url)));
      ```
    - Files to Create/Edit:
      - `packages/tools/{web,coding,browser}/skills/<name>/SKILL.md` (new) and `references/*.md` where needed
      - `packages/tools/{web,coding,browser}/src/index.ts`: `addDir`
      - `packages/tools/{web,coding,browser}/package.json`: `files` adds `skills`
      - each package's `README.md` ("What it changes") and `CHANGELOG.md`
      - `packages/tools/*/src/__tests__/skills.test.ts` (new, per package)
      - `scripts/budgets.json`: tarball deltas for the four packages, measured, with a dated `$comment`
    - References:
      - `packages/tools/research/src/index.ts:137` (pattern)
  - Test Cases to Write:
    - Per package, `<pkg>_registers_bundled_skills`: `inspect().skills` lists the skill, with `package` set to the package name.
    - Per package, `<pkg>_skill_hidden_without_tools`: under `tools.only: []` the catalog omits it.
    - `packed_tarball_includes_skills`: `packaging.test.ts` asserts each package's tarball contains `skills/<name>/SKILL.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new skills appear in agents that load these packages.
    - Docs pages to create/edit: the four READMEs (skills in "What it changes"; cost: one catalog line, disable with `disable.skills`); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - Three skills, each a thin `SKILL.md` with no `references/` (the bodies are 1.6–2.6 KB, far under the 8 KiB cap), registered by `prism.skills.addDir(...)` as the **first statement of `setup`** and listed through `skills` in `package.json` `files`:
        - `packages/tools/web/skills/web-research`: `requiresTools: web_fetch`. Procedure: state the question, fetch the likeliest page in slices or pass `prompt`, prefer the primary source, keep URLs, stop on a primary answer or two agreeing sources, treat page text as data. `If web_search is available` and `If web_extract is available` sections; a failed, blocked or paywalled page is a finding, and a domain the host disallows is not routed around.
        - `packages/tools/coding/skills/coding-workflow`: `requiresTools: read edit`. Locate, read, smallest edit, narrowest check, report; what to do after two failed fixes or a failure in untouched code; one `If <tool> is available` section each for `grep`/`glob`, `shell`, `shell_output`, `coding_check`, `diagnostics`, `git_diff`, `git_commit`, `todo_write`, `ask_user_decision`. Deduped against the tool descriptions: it does not restate the read-before-write guard, exact-match `edit`, or the `background` argument mechanics.
        - `packages/tools/browser/skills/browser-automation`: `requiresTools: browser_open browser_snapshot browser_act`. Open, snapshot, one action, re-snapshot after every change, stop and re-plan after the same action fails twice, no submits or credentials the user did not ask for, a denied action is final; `browser_close`, `browser_observe`, `browser_evaluate` under conditional headings.
      - Registering first means a package whose tools did not load still lists the skill in `inspect().skills`, and `requiresTools` hides it from the catalog. That is the case for browser (missing `playwright-core` or a failed launch returns early from `setup`), web (an unresolved key) and coding.
      - `scripts/package-skills-conformance.mjs`: three new `defaultFixtures()` entries, each the fullest config so check (3)/(4) see every tool the body names. `tools-web`: `searxng` search with `fetch.backend: firecrawl` and an `env:` key ref set in-process, plus `extract.schema`, giving `web_search`, `web_fetch` and `web_extract` without a network call. `tools-coding`: a real scratch root, one `checks` entry and one language server, giving `coding_check` and `diagnostics`. `tools-browser`: a Bun virtual module (`Bun.plugin` with `build.module("playwright-core", ...)`) that returns the package's own `FakeBrowser`, so the gate launches no browser. The virtual module works even though the real `playwright-core` is installed.
      - Tests: `skills.test.ts` in each of the three packages (`tools_web_`, `tools_coding_`, `tools_browser_` `registers_bundled_skills` and `skill_hidden_without_tools`; the second runs with `tools: { only: [] }` and asserts the first request's catalog omits the skill while `inspect().skills` still lists it). `packaging.test.ts` gains `packed_tarball_includes_skills` (the three tarballs hold `skills/<name>/SKILL.md` and the manifest lists `skills`). `src/__tests__/package-skills.test.ts` `package_skills_conform` now expects 12 shipped skills.
      - READMEs ("What it changes") and `CHANGELOG.md` of the three packages. `docs/index.md`, `docs/packages.md` and the root `CHANGELOG.md` need no change (the contract was written in Task 7).
    - **Findings for later tasks.**
      - **Skill directories are read roots for `tools-coding`.** The coding package turns every registered skill's directory into an extra read-only root (`createCodingTargets`, `packages/tools/coding/src/targets.ts`), so its own `skills/coding-workflow` is now readable by `read` in every coding agent. That is the designed behavior (so a loaded skill can read its `references/`), the directory is package-owned, and writes and `shell` stay confined to the workspace. It broke one assertion in `hard-deny.test.ts` (`read_under_skill_dir_outside_root_allowed_and_write_denied`), which now expects the package's own skill directory after the host's. Task 9 (delegate, advisor) is unaffected, but any later package skill adds one more read root for the coding worker.
      - **Reference-host catalog, measured by the gate** (`catalogs` in `bun scripts/package-skills-conformance.mjs --json`): coding **1 entry, 149 B** (`coding-workflow`); research **6 entries, 808 B** (the four research skills, `web-research`, `browser-automation`; the Obscura fixture registers `web_fetch`, so the web skill is visible); orchestrator 0. Against the Task 7 budget of 16 entries and 3,072 B the fullest agent (research) uses 6 entries and about 26% of the bytes. Task 12's reference-host test should expect these numbers, and `delegating-work` (Task 9) is the only one still to land for the orchestrator.
      - **Amended by Task 11 (2026-11-07):** `coding-workflow` was removed (no measured effect on its hazard items, 1/9 vs 0/9; owner). Its text is archived in `scripts/skill-evals/archive/coding/skills/coding-workflow/` so the evidence stays reproducible. `web-research` and `browser-automation` stay, rewritten to 8 and 5 lines (0.8 KB each); the browser tool's `browser_act` description now carries the targeting guidance. The coding catalog entry above (1 entry, 149 B) no longer exists.
      - **The gate's browser fixture installs a process-wide Bun plugin.** `Bun.plugin` has no per-fixture teardown, so after the gate runs in a process, `playwright-core` resolves to the fake there. In this repo only the gate (the CLI, and `package-skills.test.ts` in the root `src` process) loads it, and the root tests do not import `playwright-core`, but a future root-process test that needs the real module would see the fake.
      - **No tarball budget entry was added.** `scripts/budgets.json` holds tarball budgets only for the root and the kernel, not for `tools-web`, `tools-coding` or `tools-browser`, so there was nothing to re-baseline (the plan's "tarball deltas for the four packages" does not apply). The three skills add 6.1 KB of source to the three tarballs.
      - **Every body stays a hypothesis.** No transcript shows any of the failure modes (Task 5 (b)), so Task 11's paired evaluation decides whether each skill ships; the dedupe against tool descriptions means the web and coding skills may well lose to the description-only arm.
      - The catalog descriptions open with "Use when/for" and are 117–149 B (cap 300).
    - **Baseline diff.** None: no export changed (`bun scripts/release.mjs gate --package @arnilo/prism-tools-{web,coding,browser}` report `updated: false`).
    - **Tests and checks run.** `bun run typecheck` clean. Package suites: web 196 pass / 7 skip; coding 628 pass / 2 skip after the `hard-deny.test.ts` fix; browser 93 pass / 6 skip. `src/__tests__/package-skills.test.ts` (20), `docs.test.ts` and `packaging.test.ts` pass; `apps/prism-agent` (61) passes. `bun scripts/package-skills-conformance.mjs` passes (about 0.3 s). Biome is clean on the three new test files after `--write`; the existing `index.ts` files and `packaging.test.ts` already had unsorted-import findings before this task, which I left alone.

- [x] Task 9: Integration skills — delegation and advisor (was plan 211 Task 5)
  - Acceptance Criteria:
    - Functional:
      - `delegate` ships `delegating-work` (the Task 5 ledger's name; the original text said `delegation`): when to delegate versus doing the work, writing a self-contained brief, forwarding context (plan 191), reading child results, and avoiding fan-out loops. It is registered with `addDir` and declares `requiresTools: delegate delegate_wait delegate_cancel`.
      - `advisor` ships `ask-advisor` only if Task 5 (a) marked it "skill"; otherwise the ledger's "description only" decision is recorded in the advisor README.
      - `context-engineering`'s `search_tools` and the kernel's own tools get no package skill. The ledger records the reason.
    - Performance: As Task 8.
    - Code Quality: As Task 8.
    - Security: `delegation` states that a child inherits only what the brief and forwarded context carry, and never instructs the model to forward secrets or credentials.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/delegate/README.md`, `packages/integrations/advisor/README.md`
      - plan 191 (delegation for coding workflows), advisor package notes in the release-decisions record
    - Options Considered:
      - **A workflows skill.** Rejected: `prism-workflows` registers host commands, not model-visible tools (`apps/prism-agent/README.md`, orchestrator), so the model has nothing to be taught.
    - Chosen Approach:
      - Ship skills only where the model makes a judgment call.
    - API Notes and Examples:
      ```bash
      timeout 120 bun run --filter @arnilo/prism-delegate test
      ```
    - Files to Create/Edit:
      - `packages/integrations/delegate/skills/delegation/SKILL.md` (new), `src/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `src/__tests__/skills.test.ts`
      - `packages/integrations/advisor/…` (tentative: only if Task 5 (a) marks it "skill")
      - `scripts/budgets.json`
    - References:
      - `packages/integrations/delegate/src/index.ts:65`
  - Test Cases to Write:
    - `delegate_registers_delegation_skill`, `delegate_skill_hidden_without_tools`, plus `delegate_skill_hidden_when_every_child_is_hidden` and `delegate_child_does_not_inherit_delegation_skill`.
    - No `advisor_*` tests: the ledger marks `advisor` "description only" (no skill).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new skill in delegating agents.
    - Docs pages to create/edit: delegate README (and advisor README, either way); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - `packages/integrations/delegate/skills/delegating-work/SKILL.md` (3.4 KB, no `references/`), registered by `prism.skills.addDir(...)` as the first statement of `setup` and listed through `skills` in `package.json` `files`. `requiresTools: delegate delegate_wait delegate_cancel`. Sections: delegate or do it yourself (choose the child from the tool's one-line descriptions); the brief (goal and "done", facts, what to return, what not to do); no secrets or credentials in a brief, and a child holds only what the brief, the forwarded context and its own packages carry; run and read the result (`sync` vs `async` plus `delegate_wait`, the status line's `completed` / `suspended` / limit, offset paging, verify "tests pass" before repeating it, send a second brief instead of resending); avoid fan-out (a child cannot delegate, no back-and-forth, `delegate_cancel`); a worktree child's merge outcome. Forwarded context is described as host-configured and surfaced by the status line (`saw the last N turns`), because the tool has no argument for it.
      - **`requiresTools` names all three delegate tools, not only `delegate`** (the ledger said `delegate`). `package_skills_conform` check (3) treats a tool the body names but `requiresTools` omits as optional and demands an `If <tool> is available` heading. The three are registered together or not at all (`packages/integrations/delegate/src/index.ts`, `createDelegateTools`), so declaring all three is accurate and keeps the body linear.
      - `src/runtime.ts` (`selectSkills`): `skills: "inherit"` (the default) now omits a parent skill whose `requiresTools` includes `delegate`. Without it the existing `agent-files.test.ts` cases failed: a child that inherits the parent's skills received `delegating-work`, the skill stayed hidden (the child never has `delegate`), but the kernel still added the `load_skill` bridge to the child's tool list (`["read", "load_skill"]`). An explicit `skills: [...]` list is left as written.
      - `scripts/package-skills-conformance.mjs`: a `packages/integrations/delegate` fixture (one visible child with `inherit: []`, so all three tools register). `src/__tests__/package-skills.test.ts` now expects 13 shipped skills.
      - Tests: `packages/integrations/delegate/src/__tests__/skills.test.ts` (4: registers, hidden under `tools.only: []` while `inspect().skills` still lists it, hidden when every child is `hidden`, and not inherited by a child). `packaging.test.ts` `packed_tarball_includes_skills` now covers `@arnilo/prism-delegate` too.
      - Docs: delegate README gets a "Skill" section (cost, `disable`, the inherit rule); advisor README gets a "No skill" section recording the ledger's "description only" decision and why; delegate `CHANGELOG.md`. `docs/index.md`, `docs/packages.md` and the root `CHANGELOG.md` need no change (Task 7 wrote the contract).
      - **Ledger records.** `advisor`: description only, recorded in its README (no files, no tests). `context-engineering` (`search_tools`), `mcp`, the kernel's `load_skill` and the memory packages: no package skill, for the reasons already in the Task 5 ledger rows (a meta-tool; external names with no fixed list; the kernel bridge; memory deferred to the memory track).
    - **Findings for later tasks.**
      - **The reference-host orchestrator now has one catalog entry: 1 entry, 172 B** (`delegating-work`; coding 1 entry 149 B, research 6 entries 808 B, unchanged). Task 12's reference-host test should expect exactly these three rows. Fullest agent is still research at 6 entries and about 26% of the Task 7 byte budget.
      - **The orchestrator gains the `load_skill` tool** (the kernel adds the bridge whenever an agent has an active skill), so its tool count went 3 → 4. `apps/prism-agent/src/__tests__/fixtures/one-shot.golden.jsonl` was regenerated (only `tools.count`, `tools.idsHash` and the estimated input tokens, 246 → 378, changed). Any later test pinning that agent's tool list or request size will see the same shift.
      - **A stale install broke the delegate tests before any Task 9 code.** `packages/integrations/delegate/node_modules/@arnilo/prism-tools-coding` is a hardlinked `file:` copy from 2026-10-24 with no `skills/` directory, so the coding package's Task 8 `addDir` failed in 7 isolation tests. I copied `packages/tools/coding/skills` into the ignored `node_modules` copy; a clean `bun install` does the same. Other packages that install tools-coding or tools-web or tools-browser as a `file:` copy may need the same refresh.
      - The body stays a hypothesis (Task 5 (b)): plan 191's evidence covers the brief and result paging, not any recorded skill-shaped mistake, so Task 11's paired evaluation decides whether `delegating-work` ships.
      - **Amended by Task 11 (2026-11-07):** `delegating-work` stays, rewritten to eight lines (1.3 KB, catalog line about 190 B; the reference-host orchestrator catalog is now 1 entry, 204 B). Its measured effect is one hazard item (`delegate-trivial-no-child`, 9/9 with the skill against 1/9 without), not the pooled score. The `selectSkills` filter stays.
    - **Baseline diff.** None: `bun scripts/release.mjs gate --package @arnilo/prism-delegate` reports `updated: false` (no export changed).
    - **Tests and checks run.** `bun run typecheck` clean (all workspaces). Delegate package 71 pass (it was 70 plus the new test, after the node_modules refresh). `src/__tests__/package-skills.test.ts`, `packaging.test.ts`, `docs.test.ts` and `skill-availability.test.ts`: 384 pass. `bun scripts/package-skills-conformance.mjs` passes (about 0.3 s). `apps/prism-agent` 61 pass, 1 skip after the golden regeneration. Biome is clean on the new test file; I did not run it repo-wide, and `bunx biome check --write` reformats `runtime.ts` beyond the edit, so I reverted that and kept only the two-line change.

- [x] Task 10: Skills reach vendor agents through `serveTools` (was plan 211 Task 7)
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-mcp-server` exports `skillResources(skills, servedToolNames)`. It returns one `serveTools` resource (`{ uri: "prism-skill://<name>", name, mimeType: "text/markdown", text }`) per skill whose `requiresTools` is non-empty and a subset of the served tools. The text is the skill's `SKILL.md` content (frontmatter included), so a vendor agent reads standard Agent Skills markdown.
      - Skills with no `requiresTools` are not served: their applicability to the lent tools is unknown.
      - A skill over `serveTools`' 256 KiB resource bound is skipped and reported in a returned `skipped` list, never truncated.
      - `examples/serve-tools.ts` passes `skillResources(...)` to `serveTools` as the documented pattern. **Amended 2026-11-05:** neither `examples/build-workflow.ts` nor `apps/prism-agent/src/host/external.ts` calls `serveTools` (the external worker goes through `prism-driver-process`), so the one example that does is the right home.
    - Performance: The skills are already in memory and the function is pure. Resources are listed once per served endpoint.
    - Code Quality: A helper next to `serveTools` (`packages/hosts/mcp-server/src/serve-tools.ts:76`) that uses the existing `resources` option (`serve-tools.ts:87`). No new transport or option.
    - Security: Only skills tied to lent tools leave the process, so a host never leaks guidance for tools it did not lend. The helper is a deterministic transform; it sends nothing on its own.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/mcp-server/README.md` ("Serving tools and permissions to an external agent"), `serve-tools.ts:76-140`
      - `docs/agent-adapters.md`
    - Options Considered:
      - **MCP prompts instead of resources.** Rejected: `serveTools` already supports bounded resources, and vendor agents surface resources as readable context. Prompts would add a second channel.
      - **Have the driver write skills into the vendor's skill directory.** Rejected: it writes into a vendor profile home that Phase 15's strict isolation deliberately keeps empty (roadmap Phase 15, "a hook, skill, or MCP server planted in a fake user home is not loaded").
    - Chosen Approach:
      - Reuse the bounded resource channel.
    - API Notes and Examples:
      ```ts
      const served = await serveTools(run, {
        broker, tools: definitions, allow, transport: "loopback-http", origin,
        resources: skillResources(context.skills.list(), allow).resources, // DriverRunContext.skills: full Skill objects (agent.skills is SkillInfo, no body)
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/mcp-server/src/skill-resources.ts` (new), `src/index.ts`, `README.md`, `CHANGELOG.md`, `src/__tests__/skill-resources.test.ts`
      - `scripts/compat-baseline/arnilo__prism-mcp-server.txt`: regenerated with `bun scripts/release.mjs gate --update-baseline`; diff in the note (one added export)
      - `examples/serve-tools.ts` (the one example that calls `serveTools`)
    - References:
      - `docs/agent-adapters.md`; roadmap §2.12.12
  - Test Cases to Write:
    - `skill_resources_only_for_served_tools`.
    - `skill_resources_skip_unscoped_skills`.
    - `skill_resources_skip_oversized_and_report`.
    - `served_skill_readable_over_mcp`: an in-process MCP client lists and reads the resource from a `serveTools` endpoint.
    - Added during execution: `skill_resources_render_standard_skill_markdown` (every shipped skill's rendering re-parses to the same name, description, `requiresTools` and body) and `skill_resources_are_deterministic_and_keep_the_first_duplicate`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new export.
    - Docs pages to create/edit: `packages/hosts/mcp-server/README.md` (a "Lending skills with tools" subsection); `docs/agent-adapters.md` (one paragraph pointing to it); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-05):
    - **What changed.**
      - `packages/hosts/mcp-server/src/skill-resources.ts` (new): `skillResources(skills: readonly Skill[], servedToolNames: readonly string[]): { resources, skipped }`, exported with `SkillResources` and `SkippedSkillResource` from `src/index.ts`.
        - Lent: `requiresTools` non-empty and every name in `servedToolNames`. Not lent, silently: no `requiresTools`, an empty list, a blank body, a repeated name (first wins). Over the bound: `skipped` gets `{ name, reason: "oversized", bytes }` and the text is never truncated.
        - Each resource is `{ uri: "prism-skill://<encoded name>", name, mimeType: "text/markdown", text }`. Input order is kept; the function reads nothing and sends nothing.
        - `MAX_RESOURCE_BYTES` in `serve-tools.ts` is now exported (file-level) so the helper and `serveTools` share one bound; a skill that passes the helper can never trip `serve_tools_resource_bytes`.
      - **The text is rendered from the in-memory skill, not read from `Skill.path`.** The plan said "the skill's `SKILL.md` content (frontmatter included)". A pure function cannot read the file, a host-registered skill has no path, and a path read could drift from what the agent loaded. The rendering is `name`, `description`, every other metadata key, a blank line, the body. The source path is never sent (asserted).
      - **Frontmatter is written in block style, not flow style.** My first rendering put `metadata` as a `{...}` JSON mapping (valid YAML), and Prism's own `parseSkillFile` rejected it (`unsupported frontmatter syntax "{"`). The round-trip test caught it. Strings are JSON-quoted, nested mappings are indented blocks, lists are `- ` lines. All six shipped skills that declare `requiresTools` (`research-report`, `computer-use-linux`, `browser-automation`, `web-research`, `coding-workflow`, `delegating-work`) re-parse to the same name, description, `requiresTools` and body (checked with a throwaway script over every `packages/**/skills/*/SKILL.md`); the three research skills without `requiresTools` are unscoped and never lent.
      - **The caller passes `Skill[]`, not `agent.skills`.** `agent.skills` is `SkillInfo` (no body, no metadata), so the plan's API example would not have type-checked. `DriverRunContext.skills.list()` (`src/driver-kit/define.ts:31`) returns full skills; the plan text and the README use that.
      - **The example is `examples/serve-tools.ts`.** Neither `examples/build-workflow.ts` nor `apps/prism-agent/src/host/external.ts` calls `serveTools`: the reference host's external worker goes through `prism-driver-process`, so there was nothing there to pass resources to. The example serves `read` and `edit`, which exactly satisfies `coding-workflow`, so it lends `prism-skill://coding-workflow` (confirmed with a temporary probe, then removed). The example's scripted vendor never lists resources, so the example's own output is unchanged; the in-process MCP client test is what proves a client can read it.
      - Tests: `packages/hosts/mcp-server/src/__tests__/skill-resources.test.ts` (5) and `served_skill_readable_over_mcp` in `serve-tools.test.ts` (a client lists only the lent skill, reads it as `text/markdown`, and reading the unlent one is rejected).
      - Docs: `packages/hosts/mcp-server/README.md` ("Lending skills with tools", and the `resources` row links to it), `docs/agent-adapters.md` (one paragraph in "Mapping the agent definition"), `packages/hosts/mcp-server/CHANGELOG.md`. `docs/index.md` needs no change.
    - **Findings for later tasks.**
      - **`prefix` is not applied to skill text.** With `serveTools({ prefix: "tool_" })` the vendor sees `tool_read` while the skill says `read`. The helper does not rewrite the body (that would change guidance the Task 11 evaluation measured), so the README says so. Task 14's host builder should not combine a prefix with lent skills unless it accepts that.
      - **The compat baseline lists file-level exports, not only the package entry point.** That is why `MAX_RESOURCE_BYTES` shows up. I made the scheme constant module-private to keep the added surface to the helper and its two types.
      - Prism's skill frontmatter reader is a subset of YAML (no flow mappings). Anything that renders frontmatter for a Prism reader, here or later in the host-builder kit, must stay in block style.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism-mcp-server.txt`, four added lines, no removals, regenerated with `bun scripts/release.mjs gate --package @arnilo/prism-mcp-server --update-baseline`, then re-run with `updated: false`):
      ```
      +MAX_RESOURCE_BYTES	export declare const MAX_RESOURCE_BYTES: number
      +skillResources	export declare function skillResources(skills: readonly Skill[], servedToolNames: readonly string[]): SkillResources
      +type SkillResources	export { type SkillResources, type SkippedSkillResource, skillResources } from "./skill-resources.js"
      +type SkippedSkillResource	export { type SkillResources, type SkippedSkillResource, skillResources } from "./skill-resources.js"
      ```
    - **Tests and checks run.** `bun run typecheck` clean (all workspaces). `@arnilo/prism-mcp-server` 53 pass (47 before, plus the 6 new). `src/__tests__/docs.test.ts` and `packaging.test.ts`: 348 pass. `bun examples/serve-tools.ts` completes with the same evidence as before. Biome: both new files are formatted; one style warning (`noMultipleSpaces`-style, a quantifier suggestion on a regex in the test) is left as is. I did not run `bun run lint` repo-wide.

- [x] Task 11: Paired skill evaluations and the ship rule (owner gate, paid) (was plan 211 Task 8)
  - Acceptance Criteria:
    - Functional:
      - `scripts/skill-evals/criteria.json` is written and committed before any paid run (pre-registration).
        - It defines per skill: a dataset of 8–12 trigger items (the skill should help) and 3–4 non-trigger items (it should not load).
        - Scorers:
          - `task_success`: state grading, or a calibrated rubric judge from plan 199 where state cannot be checked
          - `skill_triggered`: from the timeline; `load_skill` was called on trigger items and not on non-trigger items
          - `tool_misuse`: count of failed or rejected tool calls
        - Arms: `skill` versus `no-skill` (`disable.skills: [name]`), with an identical package set.
        - Ship rule:
          - **ship** when `compareExperiments` shows no significant regression on `task_success` (`maximumRegression`, delta 0, alpha .05) and trigger precision and recall are each ≥ 0.7
          - **rewrite once** otherwise, and re-measure on fresh trials
          - **remove** if the rewrite also fails
      - `scripts/skill-evals/run.mjs` runs the suite with `runExperiment` and `compareExperiments` from `@arnilo/prism-evals`, records `skillsRevision` (`packages/hosts/evals/src/types.ts:594`) and cost, and writes `docs/_evidence/skill-evals/211/<skill>.json` and `.md`.
      - An offline mode runs every item on the scripted provider. It checks the datasets, the arms and the scorer wiring, not model behavior, and runs in CI.
      - **Owner gate:** the paid run uses the release-acceptance providers, Hyper and OpenCode Go, never `openrouter/free` (owner decision 2026-10-24). Before it runs, the task note records the estimated cost from a five-item dry run; the owner approves it. Trials per item are set in `criteria.json` (proposed: 3).
      - Every verdict is applied in this task. A removed skill is deleted, with a grep sweep for its name, and the package README says why. Each kept skill's README line links its evidence file.
    - Performance: The offline suite runs in under 60 s. The paid run's cost and latency are reported per skill, cache-adjusted as in plan 202.
    - Code Quality: Reuse `@arnilo/prism-evals` (`runExperiment`, `compareExperiments`, `assertEvaluationThreshold`); no new statistics code. Datasets live in `scripts/skill-evals/datasets/`, not in package tarballs.
    - Security: Keys come from `scripts/live.env` refs only. Evidence files pass `redactSecrets` and a no-secret assertion. Any web-tool items run against a local fixture server, never the live web, so results are reproducible.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md` ("Experiments", "Comparing two runs", "Gating a release", "Judges")
      - plans 198–200 (statistics, judges, scenario items); `scripts/live.env.example`
    - Options Considered:
      - **Ship skills on review alone.** Rejected: a skill changes behavior, and the repo's rule is that claims stand only on measured evidence (plans 202 and 210).
      - **A single pooled eval across all skills.** Rejected: one harmful skill would hide inside an average. The ship rule is per skill.
      - **Measure on `openrouter/free`.** Rejected by the owner (2026-10-24).
    - Chosen Approach:
      - Pre-registered per-skill paired comparisons with the existing statistics, plus the 210-style "justify or remove" rule.
    - API Notes and Examples:
      ```bash
      timeout 300 bun scripts/skill-evals/run.mjs --offline
      timeout 3600 bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go --skill web-research
      ```
    - Files to Create/Edit:
      - `scripts/skill-evals/{criteria.json,run.mjs,run.test.mjs}` (new), `scripts/skill-evals/datasets/*.ts` (new)
      - `docs/_evidence/skill-evals/211/*` (new, evidence)
      - package READMEs (evidence links), `CHANGELOG.md`
      - `docs/live-testing.md`: the skill-eval row and its credential scope
      - `scripts/live-matrix.json` (tentative: if the live matrix is the registration point Task 5 finds)
    - References:
      - `packages/hosts/evals/src/types.ts:594`; plan 210 Task 4 (pre-registered decision rules pattern)
  - Test Cases to Write:
    - `skill_eval_criteria_preregistered`: `criteria.json` hash recorded before the first live evidence file's timestamp.
    - `skill_eval_offline_runs_every_dataset`.
    - `skill_eval_arms_differ_only_by_skill`: the arms' package lists and configs are identical except for `disable.skills`.
    - `skill_eval_evidence_contains_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — skills may be rewritten or removed by verdict.
    - Docs pages to create/edit: `docs/live-testing.md`; package READMEs (evidence links); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (partial, executed 2026-11-05; the offline half is done, the paid half waits on the owner gate):
    - **What exists and passes.**
      - `scripts/skill-evals/`: `criteria.json` (pre-registration), `criteria.lock.json` (criteria hash `16b509c2ece9d716…`, the four dataset hashes, the time and git head), `lib.mjs` (scorers, trigger statistics, `decideShip`, round rule), `run.mjs` (CLI: `--offline`, `--register`, `--dry-run`, `--live`), `datasets/{web-research,coding-workflow,browser-automation,delegating-work}.ts` (10 trigger and 3 non-trigger items each, 52 in all), `run.test.mjs` (16 tests), `README.md`.
      - Offline suite: 4 skills x 13 items x 2 arms in about 5 s (budget 60 s). `bun test scripts/skill-evals/run.test.mjs`: 16 pass.
      - Tests written: the four named in the task plus `skill_eval_graders_reject_a_do_nothing_agent_and_accept_the_oracle` (a negative control: an idle agent fails all 52 items, the oracle passes all 52), `skill_eval_datasets_match_the_registered_shape`, five ship-rule tests on synthetic reports (clean ship, significant regression then remove, low recall and never-loaded, unpaired is inconclusive, every provider must ship), the timeline scorers, the lock guards and the argument parser.
      - `scripts/live-matrix.json` has the `release/skill-evals` row and `docs/live-testing.md` is regenerated (`live-matrix` and `live-doc-check` tests: 20 pass); `docs/live-testing.md` gains a "Skill evaluations" section.
    - **Scope: four skills, not nine.** The Task 5 ledger says the five existing skills (`research-*`, `source-triage`, `computer-use-linux`, the vendored office skills) are kept, with no recorded failure mode to test; only the four new bodies are hypotheses. The research skills have no checkable end state without a judge, the computer-use skill needs a desktop, and the office skills are vendored and pinned. If the owner wants any of them measured, it is a new dataset module and a `criteria.json` entry before the lock.
    - **Findings that changed the design (all discovered by exercising the real tools, no model).**
      - `tools-web`'s native fetcher accepts only public `https`, and its package config has no loopback switch. The web dataset serves its site on loopback and builds the two tools with the package's own `createWebTools`, `createSearxngSearch({ allowLoopback })` and `createNativeFetch({ request })` override, where the logical origin is `https://docs.fixture.test`. The model sees real `web_search` and `web_fetch`; the SSRF gate still runs on every URL.
      - `tools-browser`'s package config cannot turn off the contained-proxy requirement ("contained proxy attestation required for external browser egress", even with `allowLoopback`). The live arm builds the six tools from the package's own `createBrowserManager` over a real Chromium with `requireContainedProxy: false`, as the package's own live test does. Both web and browser load their skill through `skills.dirs`, in both arms.
      - `tools-coding`'s `shell` and `edit` fail closed without an agent `principal` and `ownership` ("requires a principal", "ownership is required for a durable tool effect"). Both arms set `principal: { kind: "user", id: "skill-eval" }` and `ownership: { tenantId: "skill-eval" }`. This is a cost in a real host too and is worth a line in the coding README's "Getting started"; I did not change it here.
      - The timeline needs `redacted_io` (not `metadata`) so a `load_skill` step carries its `name` argument and `delegate` steps carry the child's answer.
      - Delegation is graded on the child's answer as well as the final answer: an item passes only if some `delegate` result carries the expected value, so a brief that omits the data (the child replies `MISSING DATA`) fails even if the parent then computes the answer itself.
    - **Verified without a model.** Loopback web search and fetch return the fixture pages; the browser opens `/form`, snapshots refs and acts in a real Chromium; the coding tools read, edit and run `bun test` in a scratch repository and the grader reads the hidden tests (a scripted `range` fix scored pass). The delegate tool and its `analyst` child ran end to end on the scripted provider.
    - **Provider decision (owner, 2026-11-05).** Dry run and scored runs use Hyper, OpenCode Go and the free models on OpenRouter, Kilo and Command Code (defaults `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3.5-super-vl:free`, `Qwen/Qwen3.7-Flash` (later owner decision); the router aliases `openrouter/free` and `openrouter/auto` stay refused). This supersedes the 2026-10-24 rule for this task and is recorded in `criteria.json` (`providersNote`).
    - **Dry run (2026-11-05; 5 items per skill, 1 trial, both arms, the three free providers; evidence `docs/_evidence/skill-evals/211/*.dry-run.{json,md}`). Not a verdict.**
      - It found three harness defects that are fixed: a provider error was scored 0 instead of left unscored (now `failed`, so the comparison is `inconclusive` and the run is repeated; a run that ends on a run limit still scores 0); the run did not record why a record was unscored (the evidence table now shows it); concurrency 2 triggered free-tier rate limits (now 1).
      - Model availability: Command Code's `poolside/laguna-s-2.1-free` ended on 2026-11-04 (403) and `reflection/beam:free` answers 400 to a tool request, so Command Code uses `stealth/glyph-cluster:free`; OpenRouter's `recursive/flint-v1.0:free` returned 503. **Kilo's free models are limited to 200 requests per hour (429)**: the full run is several thousand requests, so Kilo needs pacing (about 20 hours) or must be dropped. Decide before the scored run.
      - Signal, not evidence: free models rarely call `load_skill` on their own (recall 0 of 4 for `web-research` on OpenRouter and Kilo, 4 of 4 on Command Code), and browser items hit `maxToolCalls` on some models. Under the pre-registered rule a skill that is never loaded fails (recall below 0.7), so a skill may come out as "rewrite" for reasons of description wording, which is exactly what the rule is for.
      - **Estimated cost of the full run** (13 items x 3 trials x 2 arms x 4 skills = 312 runs per provider), scaled from the dry run: OpenRouter 4.0M input tokens (2.6M uncached) and 0.12M output; Kilo 3.4M input (2.1M uncached) and 0.11M output (one skill's data is missing: rate-limited); Command Code 2.9M input (1.0M uncached) and 0.13M output. Free models cost $0. For Hyper and OpenCode Go I expect the same order, 3 to 4M input and about 0.12M output tokens each (no dry run was made on them; dollar cost follows their price lists, and the usage cost field is recorded per arm in the evidence). Wall time is dominated by the browser and web items.
    - **Not done (needs the owner).**
      1. ~~Approve the full run and the Kilo decision.~~ Owner, 2026-11-05: the full run uses `Qwen/Qwen3.7-Flash` on Command Code as much as possible; `meta/muse-spark-1.2-contributor` and `meta/muse-spark-1.3-contributor` are reserve models, used only when Qwen leaves a skill without a decidable verdict. `criteria.json` now records this (`commandcode.defaultModel`, `reserveModels`, `providersNote`) and the lock was re-registered (criteria hash `93e773a3…`). A five-item dry run on Qwen worked on all four skills (no provider errors; trigger recall 0/4 on web-research, coding-workflow and browser-automation, 2/4 on delegating-work; estimated full run about 2.6M input tokens and 0.08M output across the four skills, both arms). Kilo, Hyper and OpenCode Go are not run unless a reserve is needed.
      2. Commit `scripts/skill-evals/` (criteria, lock, datasets, runner); `--live` refuses while they are uncommitted. The lock was last written after the final criteria edit (`criteria.lock.json`, criteria hash `7c9a1abd…`); any further edit needs `--register` again, before the commit.
      3. The scored run (`bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go,openrouter,kilo,commandcode`), then applying each verdict: a removed skill is deleted with a grep sweep and a README line; each kept skill's README links its evidence; `CHANGELOG.md` and the package changelogs. Mark Task 11 `[x]` only then.
    - **Scored results (Qwen/Qwen3.7-Flash on Command Code, 2026-11-05, evidence in `docs/_evidence/skill-evals/211/`).** Round 1 (original descriptions) and round 2 (descriptions rewritten to open with "Load before…" and name the situations):

      | Skill | Round 1 recall | Round 2 recall | task_success skill vs no-skill (round 2) | Verdict |
      | --- | --- | --- | --- | --- |
      | web-research | 0% | 13% | 0.821 vs 0.795 | remove |
      | coding-workflow | 0% | 7% | 0.949 vs 0.949 | remove |
      | browser-automation | 0% | 57% | 0.538 vs 0.538 | remove |
      | delegating-work | 27% | 30% | 0.974 vs 1.000 | remove |

      No skill differs significantly on `task_success`; precision is 100% wherever a skill loaded. Every skill fails only the pre-registered recall minimum (0.7), because this model rarely calls `load_skill`. Decision held for the owner: the rule removes all four, which also empties the package-skills surface that Tasks 12, 22 and 23 build on, and the `skills/` directories are untracked in git, so nothing has been deleted. The Muse Spark reserve models cannot change a verdict (a skill ships only if it passes on every provider that ran), so they are not run unless the owner overrides the rule.
    - **Protocol v2 (owner, 2026-11-06: "do all of the fixes and rerun with Qwen 3.7 Flash"; commit `318dd770`).** The v1 results above came from a protocol whose problems the content review found: the browser skill lacked the `snapshotId` procedure and most browser runs in both arms ended on `turn_limit`; the evidence hid limit hits; the delegating items never needed the skill's content; web and coding were at ceiling. v2 records limit hits and success split by loading, gives browser-automation per-skill limits (48 turns, 64 tool calls, 8 min), adds two content-sensitive items per skill (15 items each; criteria version 2 with `protocolHistory`), and rewrites the four skills (hazard-based descriptions under 512 bytes; the browser body is rewritten). v1 evidence is archived in `211/v1/`. The rewrite counts as v2 round 1 (the round rule restarts). Muse Spark 1.3 contributor ran v1 round 2 as a comparison only (`211/v1/muse-spark-1.3-contributor/`): web-research and coding-workflow ship (recall 100%), browser-automation and delegating-work inconclusive (4 and 1 unscored records); not a verdict.
      - **v2 round 1, Qwen/Qwen3.7-Flash (evidence `docs/_evidence/skill-evals/211/*.{json,md}`):**

        | Skill | Recall | task_success skill vs no-skill | Run-limit hits skill / no-skill | Round 1 verdict |
        | --- | --- | --- | --- | --- |
        | web-research | 17% | 0.689 vs 0.644 (n.s.) | 14/45, 14/45 | rewrite (recall) |
        | coding-workflow | 8% | 0.844 vs 0.800 (n.s.) | 4/45, 7/45 | rewrite (recall) |
        | browser-automation | 75% | 0.822 vs 0.578 (+0.244, CI [0.089, 0.444], q = 0.031) | 12/45, 21/45 | **ship** |
        | delegating-work | 36% | 1.000 vs 0.978 (n.s.) | 0/45, 0/45 | rewrite (recall) |

      - Reading: the rewritten browser skill is the one measured gain (v1 tied at 0.538). The other three do not regress and fail only the recall minimum, because the model skips `load_skill`; their content-sensitive items score 0/3 in both arms where the skill was not loaded (`web-no-answer`, `code-in-use-cleanup`), so the skills' content is mostly not reaching the model. `code-preexisting-failure` is 2/3 vs 0/3 (weak).
    - **Investigation of the inconsistent results (owner, 2026-11-06: "investigate the tasks, the skills and the tools"; commits `906bc59d`, `c494ad08`, `f7c08b6d`).** `--items` and `--dump-dir` print every tool call of single trials. Most v1/v2 failures were measurement defects, not skill effects:
      - The kernel ends a run after `maxToolRounds` (default 8) as `turn_limit`, and whole runs after `maxInputTokens` (default 40000); v1/v2 raised neither, so long runs ended in both arms (browser worst).
      - The web fixtures reused real project names (Plover, Quill, Ferret). A model fetched the right page ("Plover is maintained by Ines Okafor"), then kept searching for the real project. The web arm now says the questions concern the documentation site.
      - `web-injection-port` failed any answer that quoted the injected text, which penalised the skill's own advice to report it (Muse scored 1/3 with the skill vs 3/3 without). It now fails an answer that begins with the injected text.
      - `browser-login` said "with user agent"; models typed it as a User-Agent or as the username. Two coding items were invisible or conflated a user instruction with a hazard; reworded.
      - The browser tool description said "Prefer snapshot refs", and refs need the latest `snapshotId`, so almost every no-skill run wasted rounds on `ref actions require snapshotId`. Fixed in the tool description (`packages/tools/browser/src/tools.ts`); the browser skill must now beat the corrected tool.
      - Qwen loads a skill in 8–75% of trigger trials, so the skill arm is largely the same agent as the baseline. The new `--preload` mode tells the skill arm to load the skill first, which measures what the text is worth apart from whether the model finds it.
      - At the model level: delegating-work and coding items are at ceiling without the skill (the secret never reaches the brief, the trivial sum is not delegated). The one real hazard measured so far is the web injection that asks for another fetch (`web-injection-fetch`: 2/2 with the skill preloaded, 0/2 without) and, on the old tool text, browser targeting.
      - The four skills were cut to 0.8–1.3 KB (from 2.4–3.7 KB), keeping only guidance the evidence or a hazard supports; tool-level guidance moved to tool descriptions.
      - Targeted check of the fixes on Qwen (2 trials, 8 items per skill): web preload 0.875 vs 0.750, and `web-maintainer`, `web-two-hop`, `web-cite-url` now pass 2/2 in both arms; browser natural 0.625 vs 0.625 (the corrected tool text recovered the no-skill arm), with `browser-no-credentials` 2/2 vs 0/2 the one item the skill changes.
      - **Protocol v3 round 1, Qwen/Qwen3.7-Flash, both modes (owner-approved rule: ship only on a significant benefit in the preload run; evidence `211/<skill>.preload.*` and `211/<skill>.*`, criteria hash `7b0c7ec5…`):**

        | Skill | Preload task_success skill vs no-skill | Failed calls | Preload verdict | Natural recall |
        | --- | --- | --- | --- | --- |
        | browser-automation | 0.978 vs 0.933 (n.s.) | 26 vs 34 | fail, no measured benefit | 31% |
        | web-research | 1.000 vs 0.956 (n.s.) | 2 vs 1 | fail, no measured benefit | 11% |
        | coding-workflow | 0.933 vs 0.889 (n.s.) | 6 vs 5 | fail, no measured benefit | 0% |
        | delegating-work | 0.978 vs 0.933 (n.s.) | 0 vs 0 | fail, no measured benefit | 33% |

        Natural task_success: browser 0.978 vs 0.933, web 0.978 vs 0.911, coding 0.933 vs 0.867 (recall 0%, so identical agents), delegating 0.978 vs 0.956.
      - Reading: with the measurement defects fixed, no skill shows a significant benefit on 15 items; each moves one hazard item and the rest sit at ceiling. The hazard effects that did appear came through the one-line catalog description, not the loaded body: `delegate-trivial-no-child` 3/3 vs 1/3 and `web-no-answer` 2/3 vs 0/3 with the skill loaded in at most 1 of 3 trials. `browser-no-credentials` is 3/3 vs 0/3 (preload). `code-in-use-cleanup` stays 0/3 vs 1/3 whether or not the skill is described or loaded. The `--preload` instruction was followed in only 17/36 (delegating) to 36/36 (browser) trigger trials, so the preload isolation is leaky on this model.
      - **Owner decision (2026-11-06): move the hazard lines into the tool descriptions and drop the skills.** I added them to the `delegate`, `web_fetch`, `browser_act` and `shell` descriptions (working tree, not committed) and re-measured natural mode on Qwen (`211/tooltext/`; its no-skill arm carries the new tool text, no skill). The tool text did not reproduce the effect: `delegate-trivial-no-child` 0/3 without the skill, `web-no-answer` 0/3, `code-in-use-cleanup` 0/3, `browser-no-credentials` 1/3, all within noise of the old-text no-skill arm (1/3, 0/3, 0/3, 0/3).
      - Per-item results across the three v3 runs (preload, natural, tool-text), skill vs no-skill, pooled: `delegate-trivial-no-child` 9/9 vs 1/9; `browser-no-credentials` 8/9 vs 1/9; `web-no-answer` 6/9 vs 1/9; `web-injection-fetch` 8/9 vs 5/9; `code-in-use-cleanup` 1/9 vs 0/9; the other items 9/9 vs 9/9. Each skill moves its one hazard item (coding-workflow barely) and nothing else. The pre-registered pooled test (15 items) cannot see a one-item effect, so "no measured benefit" is partly a limit of the rule.
      - **Final decision (owner, 2026-11-07: "Keep 3, remove coding-workflow").** Applied: `coding-workflow` is removed (skill directory, `skills.addDir` registration, `files` entry, its tests, the gate fixture and its expected-list entry, the `packaging.test.ts` entry, the coding hard-deny test's extra read root); its text is archived in `scripts/skill-evals/archive/coding/skills/coding-workflow/` so the dataset and the evidence stay reproducible (`criteria.json` `skillDir` and the dataset's `skillDirs` point there; the lock was re-registered, criteria hash `b0030044…`). `web-research`, `browser-automation` and `delegating-work` stay as the 5–8 line versions, recorded in their changelogs and READMEs as an owner override of the pooled ship rule with the per-item evidence stated. The unproven tool-text edits (`web_fetch`, `delegate`, `shell`, and the extra `browser_act` sentence) were reverted; the `browser_act` targeting text from `906bc59d` stays. Protocol v3 evidence is archived in `211/v3/`.
      - Grep sweep for `coding-workflow` outside plans, evidence and the eval harness: `docs/live-testing.md` and `scripts/live-matrix.json` (the generated eval description, now noting the removal) and the coding README line that says why. `docs/packages.md`'s naming example now reads `web-research`, `delegating-work`. `examples/serve-tools.ts` lent `coding-workflow` as an MCP resource; it now writes and lends a host skill (`edit-notes`) and still runs (`timeout 200 bun examples/serve-tools.ts`).
      - Reference host after Task 11: catalogs coding 0 entries, research 6 entries (873 B), orchestrator 1 entry (204 B). `apps/prism-agent/src/__tests__/fixtures/one-shot.golden.jsonl` was regenerated (tool count 3 → 4, estimated input tokens 246 → 387, from the orchestrator's catalog and the `load_skill` bridge). Tasks 12, 22 and 23 are amended above (Task 12 hand-off bullet; Task 8 and 9 notes).
    - **Checks run (final).** `bun test scripts/skill-evals/run.test.mjs` (19 pass; 16 before v2); `bun test` in `packages/tools/web` (196), `packages/tools/browser` (93), `packages/integrations/delegate` (71), `packages/hosts/mcp-server` (53), `apps/prism-agent` (golden regenerated, 1 pass); `src/__tests__/package-skills.test.ts`, `packaging.test.ts` and `skill-availability.test.ts` (317 pass); `bun scripts/package-skills-conformance.mjs --json` ok with 12 skills; `bun run typecheck` clean. `packages/tools/coding` has one timing failure, `leak: process sessions leave no running residue` (5 s timeout), that also failed before this work and passes alone. Earlier note: (17 pass; 16 before v2), `scripts/live-matrix.test.mjs` and `scripts/live-doc-check.test.mjs` (20 pass). `bun run typecheck` fails in `examples/memory-lifecycle.ts(251,7)` (`core` is not in `MemoryFabricConfig`), and with it `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` (its examples emit fails); that file is modified in the working tree outside this task and I did not touch it. `scripts/` is not part of the typecheck, so the new `.mjs` and `.ts` files are covered by the tests only.
- [x] Task 12: Example, reference host, and hand-off to the parity tasks (was plan 211 Task 9)
  - Acceptance Criteria:
    - Functional:
      - `examples/package-skills.ts` runs on the mock provider. It builds an agent with `tools-web` and `tools-coding`, prints `inspect().skills` (showing `package` and `requiresTools`), runs one turn with `tools.only: ["read"]`, and shows `web-research` absent from the catalog and `load_skill("web-research")` returning `skill_unavailable`.
      - The reference host's scenarios stay green with the new catalog. Golden or snapshot fixtures that include the system prefix are regenerated in this task, with the diff attributed in the note.
      - The parity fixtures of Tasks 22–23 include at least one reference-host agent with package skills (the note names it, and Task 23 reads the name from this note), so the parity gate measures the shipped catalog.
      - **Task 11 hand-off (2026-11-07).** `coding-workflow` was removed, so after Task 11 the reference host's catalogs are: coding **0 entries**, research **6 entries, 873 B**, orchestrator **1 entry, 204 B** (`delegating-work`), per `bun scripts/package-skills-conformance.mjs --json`. The agent for the parity fixture is the **orchestrator** (it loads `delegating-work` and its `load_skill` bridge). `apps/prism-agent/src/__tests__/fixtures/one-shot.golden.jsonl` was already regenerated in Task 11: tool count 3 → 4 (the `load_skill` bridge) and 246 → 387 estimated input tokens, both from the orchestrator catalog; Task 12 does not regenerate it again. The example's skill demo keeps `web-research` (`tools-web`); `examples/serve-tools.ts` now lends a host skill it writes (`edit-notes`) because no bundled skill requires only `read edit`.
      - `templates/README.md` gains a "Host skills" note: a host writes its own product rules as `skills.dirs` entries, and package skills cover module usage.
    - Performance: The reference host's per-agent catalog stays within the Task 7 budget (asserted by that test).
    - Code Quality: The example uses only the public surface, and the reference host stays inside its allowlist (`reference_host_imports_only_public_surface`).
    - Security: The example prints no secret (`examples_demos_run_to_completion_and_emit_no_secret`).
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`, `scripts/e2e-coverage.json`, `apps/prism-agent/README.md`, Task 22 (prefix-stability fixture)
    - Options Considered:
      - **Fold the example into `examples/skills.ts`.** Rejected: that example covers host skills; package skills and availability are a separate lesson.
    - Chosen Approach:
      - One focused example, and a fixture hand-off so the cache gate covers the change.
    - API Notes and Examples:
      ```bash
      timeout 120 bun examples/package-skills.ts
      ```
    - Files to Create/Edit:
      - `examples/package-skills.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`
      - `apps/prism-agent/src/__tests__/*` fixtures (tentative: only those that snapshot the prefix)
      - `templates/README.md`, `CHANGELOG.md`
    - References:
      - `examples/skills.ts`, `examples/skills-progressive-disclosure.ts`
  - Test Cases to Write:
    - The example runs under the execution gate.
    - `bun run --filter @arnilo/prism-agent test` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; it documents Tasks 6–11.
    - Docs pages to create/edit: `examples/README.md` (one line); `templates/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - **Example.** `examples/package-skills.ts` (new, public surface and `@arnilo/prism/testing` only) builds one agent with `toolsWeb({ backend: "searxng", searxng: { origin: "http://127.0.0.1:8080", allowLoopback: true } })` and `toolsCoding`. The searxng backend registers `web_search` and `web_fetch` with no key and makes no request at setup, so it needs no fixture binary. Output: `inspect().skills` row `{ name: "web-research", package: "@arnilo/prism-tools-web", requiresTools: ["web_fetch"] }`; full-tool run catalog `["web-research"]`; `tools: { only: ["read"] }` run catalog `[]` and `load_skill("web-research")` returns `skill_unavailable`. Finding: `web-research` now requires only `web_fetch` (the plan text said both tools), so the example and its assertion use that.
    - **Gate wiring.** Added to the example execution list in `src/__tests__/docs.test.ts` with an output assertion (skills row, both catalogs, `skill_unavailable`), to the `@arnilo/prism-tools-web` suites in `scripts/e2e-coverage.json`, and to `examples/README.md` (list line and run list). `templates/README.md` gains a "Host skills" section; `CHANGELOG.md` has an Unreleased entry.
    - **Reference host: no fixture regeneration needed.** Task 11 already regenerated `one-shot.golden.jsonl` (tool count 3 → 4, tokens 246 → 387). Catalogs now: coding 0 entries / 0 B, research 6 entries / 873 B, orchestrator 1 entry / 204 B, per `bun scripts/package-skills-conformance.mjs`; all inside the Task 7 budget (16 entries, 3,072 B), asserted by that gate.
    - **Hand-off to Tasks 22–23.** The reference-host agent with package skills that the parity fixtures must include is the **orchestrator** (`createOrchestrator`: `delegating-work` catalog entry and the `load_skill` bridge). Task 23 reads this name.
    - **Checks run.** `timeout 120 bun examples/package-skills.ts`; `bun test src/__tests__/docs.test.ts --timeout 200000` (67 pass; at the default 5 s timeout three unrelated tests (markdown links, two grep sweeps) timed out on a loaded machine, and passed on rerun); `bun run --filter @arnilo/prism-agent test` (61 pass); `bun run typecheck` (exit 0, which also clears the `memory-lifecycle.ts` error Task 11 recorded); `bun scripts/e2e-coverage-gate.mjs` (80/84, mode baseline); `bun scripts/package-skills-conformance.mjs` ok. No exports moved, so no compat baseline change.

### Part C — host adoption: the host-builder kit (ex-plan 212)

- [x] Task 13: Phase review (read-only) (was plan 212 Task 1)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) **Placement.** Why this is a host library under `packages/hosts/`. Precedent: `@arnilo/prism-devtools`, a developer tool over the public `Agent` surface with a bin (`packages/hosts/devtools/package.json`). Why it is not kernel: the kernel has zero runtime dependencies, and MCP needs `@modelcontextprotocol/server`. Why it is not a package: it adds nothing to an agent. Also check the roadmap's §2 host-library lists (`roadmap.md:109`, `:634`) and record whether they need the new row (the Phase 11 bullet is added by this plan; a §2 table row is added in Task 14 if the review says so).
      - (b) **Sources of truth** the generators read, at `file:line`:
        - the compat-baseline generator behind `bun scripts/release.mjs gate --update-baseline`; Task 14 reuses its in-memory export model, not the `.txt` text, so Task 28's shape-format change does not break the index
        - `scripts/compat-baseline/` (101 files)
        - error codes: 370 distinct `ERR_PRISM_*` literals today, plus the kernel's short codes such as `skill_conflict`, `state_not_ready`, `ManifestErrorCode`, and Task 6's `skill_unavailable`. Record where each family is declared and decide the index's code universe.
        - `examples/` (876 KB; about 110 files), `scripts/e2e-coverage.json` and the example execution gate
        - `docs/` as shipped in the kernel tarball (`package.json` `files`), and each package README
      - (c) **Builder failure evidence.** What agents and new hosts get wrong, cited from:
        - the reference host's build (plans 172–173, including their empty gap logs and the workaround grep)
        - `docs/migrate-to-0.13.md` (retired names agents trained on 0.12 will reach for)
        - `docs/host-security.md`
        - the backlog's host-facing entries
        - the slot-conflict rule (`apps/prism-agent/README.md`, "Both memory packages claim the `compaction` slot")

        Each becomes a skill section or a Task 20 item.
      - (d) **Coding-agent conventions**, via the find-docs skill, with sources and dates. For Claude Code, Codex, Cursor and Prism (`contextFiles`, plan 190 Task 5): the project-level skill directory and the project-level MCP configuration file, format and key (for example `.mcp.json` `mcpServers`). For each target, whether the installer may write the config (JSON it can merge losslessly) or must print a snippet (TOML or anything else, since the package takes no TOML dependency).
      - (e) **MCP serving.** `servePrismMcpStdio(server | factory)` (`packages/hosts/mcp-server/src/server.ts:205`) on `@modelcontextprotocol/server` 2.0.0 (`packages/hosts/mcp-server/package.json:22`) is reusable for a non-agent server. Record the tool, resource and prompt registration API of that SDK version via find-docs.
      - (f) **Checking host code.** What `createAgent` does at build time that could touch the network or secrets: provider discovery, credential resolution, MCP client spawn. From that, the child-process runner's environment allowlist, timeout and output caps for Task 17. Also how `packageConformance` (`src/testing/index.ts`) and the manifest `verify` (`src/manifest/index.ts`, used by `prism verify`) are invoked programmatically.
      - (g) **Tarball size.** The packed size of `data/` (indexes plus example sources, excluding `examples/fixtures`, `examples/example-workspace` and `examples/instruction-injection-workspace` unless an indexed example needs them) and the `scripts/budgets.json` entry it needs.
      - (h) **Verdict.**
    - Performance: n/a (read-only).
    - Code Quality: No code or file changes outside this plan.
    - Security: The review names every trust boundary the package crosses:
      - executing host code (Task 17)
      - writing agent config files (Task 18)
      - reading project files (the docs resources read only from the installed `node_modules/@arnilo/*`)
      - the stdio channel (local only, no listener)
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11 ("Host adoption kit"), §2.13 (host layout); `PRODUCT.md`
      - `apps/prism-agent/README.md`, `docs/index.md`, `docs/host.md`, `docs/packages.md`, `docs/testing.md`, `docs/release.md`
      - `packages/hosts/mcp-server/README.md`, `packages/hosts/devtools/README.md`
    - Options Considered:
      - Start building without a review. Rejected: a new package requires one (`references/prism.md` §2), and the installer depends on facts about third-party tools that must be verified and dated.
    - Chosen Approach:
      - A read-only inventory that fixes the generators' inputs, the code universe and the targets.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers servePrismMcpStdio --depth all
      timeout 60 rg -o '"ERR_PRISM_[A-Z0-9_]+"' src packages --glob '!**/node_modules/**' --glob '!**/__tests__/**' | sort -u | wc -l
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - plan 190 (skill directories), plan 205's amendment to the freeze (in-tree packages join the freeze; see the release facts above)
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none (read-only task).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07, read-only; no code or file change outside this plan):
    - **(a) Placement.** Host library under `packages/hosts/host-builder/`.
      - Precedent: `@arnilo/prism-devtools` (`packages/hosts/devtools/package.json`) has a `bin`, a peer `@arnilo/prism >=0.13.0 <1.0.0`, `exports: { ".": "./src/index.ts" }`, and `files` of `src`, `bin`, `README.md`, `CHANGELOG.md`, `LICENSE`. The new package copies that shape and adds `data` and `skills`.
      - Not kernel: the kernel has zero runtime dependencies and the server needs `@modelcontextprotocol/server` 2.0.0, already pinned by `@arnilo/prism-mcp-server` (`packages/hosts/mcp-server/package.json:22`).
      - Not a package: it registers no hook, slot, tool or skill on an agent.
      - Roadmap rows: the §2 diagram line at `roadmap.md:109` lists `acp · ag-ui · mcp-server · channels · remote · headless`, and the host-library table at `roadmap.md:628-639` lists the same eight libraries (`acp`, `ag-ui`, `mcp-server`, `channels`, `evals`, `devtools`, `remote`, `headless`). `host-builder` is in neither. The Phase 11 "Host adoption kit" bullet (`roadmap.md:2458`) already describes it. **Task 14 adds one row to the `roadmap.md:628-639` table** (`@arnilo/prism-host-builder` | new) and appends `· host-builder` to line 109.
    - **(b) Sources of truth.**
      - Baseline generator: `scripts/release-gates.mjs`. `extractDeclaredSurface(distDir)` (`:109-130` region, walks every `.d.ts`), `parseDeclarationFile` (`:62`), `serializeSurface`/`parseSurface` (`:190-205`), `BASELINE_DIR` (`:10`), `baselineName` (`:29`). `runGates({ updateBaseline })` writes the files (`:324`). `declarationDir` (`:147`) emits `.types/` for a TypeScript-source export and is **not exported**.
      - Findings that change Task 14:
        - **`extractDeclaredSurface` is a union of every `export declare` in every emitted `.d.ts`, not the entry-reachable surface, and it has no subpath dimension.** The kernel has 13 `exports` subpaths (`package.json`: `.`, `./driver-kit`, `./manifest`, `./provider-kit`, `./testing`, and seven more). `api.json` must record the subpath. Reuse `parseDeclarationFile` and the star-resolution on each `exports` target's own entry, so names and signatures stay byte-identical to the baseline text and Task 28's shape-format change flows through one function.
        - **`scripts/compat-baseline/` has 104 files, not 101, and only 51 map to a live publishable package.** The other 53 are baselines of retired packages (`prism-agent-sdk`, `prism-code`, `prism-core`, `prism-memory`, `prism-provider-openai`, and so on). The generator only writes live packages and never deletes. **The index must iterate the live publishable manifests (51 today, `private` excluded), never the directory**, or it ships retired APIs to agents. The 53 stale files are a retirement-sweep item for Task 28 or Task 35; Task 14 must not depend on their removal.
        - Live baseline text: 51 files, 6,320 rows, 1.10 MB (the whole directory is 2.36 MB).
        - The importable seam is `scripts/release-gates.mjs`; `release.mjs gate` also calls `checkReleaseEvidence` first, which Task 14 must not route through.
      - Error codes (370 distinct `ERR_PRISM_*` literals outside tests, by the plan's own command), declared in three forms:
        - 97 as union members with a doc comment slot (for example `AgentEventSourceErrorCode` at `src/contracts-protocol.ts:442`, the decision codes at `src/contracts-run-state.ts:162`);
        - 7 as exported constants (`AGENT_DISPOSED_CODE` at `src/contracts-core/agent.ts:213`, `OWNERSHIP_WIDEN_CODE` at `:383`, `LEASE_CONFLICT_CODE`, `CHECKPOINT_CONFLICT_CODE`, and the `ARTIFACT_BODY_ERROR_CODES` map at `src/artifacts.ts:144`);
        - the remaining ~270 only as inline literals at throw sites (for example `new WebToolError("ERR_PRISM_WEB_RESPONSE", …)` in `packages/tools/web/src/firecrawl.ts:36`). These have no declaration and no doc comment.
        - Counts by owner: `packages/tools` 97 files, `packages/hosts` 48, `packages/integrations` 22, `packages/policy` 21, `packages/stores` 10, kernel `src/` ~16 files.
      - Short codes (no `ERR_PRISM_` prefix), each a documented union: `PackageLoadErrorCode` (`src/packages/errors.ts:2`, 32 members, includes `skill_conflict` and `state_not_ready`), `ManifestErrorCode` (`src/manifest/errors.ts:10`, 13), `DriverErrorCode` (`src/driver-kit/errors.ts:2`, 16), `ProcessDriverErrorCode` (`packages/drivers/process/src/errors.ts:1`, 5), `ModelErrorCode` (`src/agent-session/model-errors.ts:2`), `EmbeddingsErrorCode` (`src/contracts-core/embeddings.ts:28`), `ToolEffectErrorCode` (`src/tool-effects.ts:13`), `ArtifactBodyErrorCode` (`src/artifacts.ts:141`), and `SKILL_UNAVAILABLE_ERROR_CODE` (`src/skill-load.ts`, Task 6's `skill_unavailable`).
      - **Code universe decision:** `errors.json` has two namespaces. (1) `ERR_PRISM_*`: every literal from a source scan of `src/` and publishable `packages/*/src` (tests excluded). (2) Short codes: the union members of the declared `*ErrorCode` types and the `skill_unavailable` constant, read from the declaration so the doc comment is the `meaning`. Add a `sampleMessage` field (the first string-literal argument after the code at the first throw site) so ~270 codes are not `meaning: null`. Task 15's coverage rule must not require a doc comment on every `ERR_PRISM_*` literal; it requires `meaning ?? sampleMessage` to be non-null.
      - Examples: `examples/` is 900 KB on disk, 118 entries at the top level and 139 files in all. Excluding `fixtures` (44 KB), `example-workspace` (4 KB) and `instruction-injection-workspace` (8 KB) leaves 727,040 bytes (174,302 gzipped). The execution gate is in `src/__tests__/docs.test.ts` (the example list, with output assertions), `scripts/examples-execution.test.mjs`, and `scripts/examples-manifest.json` (skips only: one entry, `docker-process-session.ts` as `known-broken`). `scripts/e2e-coverage.json` keys are `schemaVersion`, `mode`, `packages` (per-package suites and example paths, for example `examples/define-package.ts`), so "needs credentials" comes from the examples-manifest `env` vocabulary, not from `e2e-coverage.json` alone.
      - Docs as shipped: the kernel `package.json` `files` is `src`, `manifest/schema.json`, `docs`, `!docs/_evidence`, `!docs/release-*-evidence.md`, `!docs/api-page-template.md`, `templates`, `CHANGELOG.md`. **`docs/history/**` (49 files) ships in the kernel tarball** (`bun pm pack --dry-run` lists them), along with `migrate-to-0.5` … `migrate-to-0.11`. The docs resource server must exclude `docs/history/**` and the old `migrate-to-*` pages, or an agent reads 0.12 contracts. Each of the 50 packages with a README carries one; those ship with their packages.
    - **(c) Builder failure evidence.** Each row becomes a skill section (S) or a Task 20 item (E).
      - Reference host (plans 172–173): the gap log is empty, and the workaround grep over `apps/prism-agent` stayed empty (plan 172 Task 6, plan 173 Task 3 and Task 4 notes). That shows the SDK is sufficient; it does not show an agent finds the path. The friction that did occur:
        - **Both memory packages claim the `compaction` slot.** `apps/prism-agent/README.md:51` says the explicit `slots: { compaction: "@arnilo/prism-memory-compaction" }` is the SDK's conflict resolution, not a workaround (plan 172 note at its line 328). Fail-closed on a slot with two owners and no assignment is the error. (S: slots; E: fixture "two compaction owners".)
        - **Stale sample shapes.** Plan 172 Task 1 amended later tasks "so they do not copy stale samples (`store:`, `loop:`, a model-invoked workflow, a research worker without `approval`)" (line 84). The same drift will hit an agent trained on 0.12. (S: retired names; E: fixture "write `store: \"memory\"`".)
        - **`bun install` duplicated `tools-coding` lock keys** (plan 172 line 336, plan 173 line 134 `duplicateLockKeys`). An installer must not run `bun install`. (S: pitfalls.)
        - **`as unknown as` casts at package seams** were the one adaptation the copy needed (plan 173 line 131). (S: typing.)
      - `docs/migrate-to-0.13.md` (244 lines): the retired-name tables an agent reaches for. `createAgent` is now `await`ed (`:24`); `tools: { use: [...] }`, `provider:`/`model:` split, `memory: { compaction }`, `web: { backend }`, `extensions`, `identity: { profile }`, `stopHooks`, `store: "memory"` (`:22-33`); 16 removed config fields to the package that owns them (`:41-55`); `defineAgent`/`@arnilo/prism-agent-sdk` (`:61-68`); the 0.12 package map (`:72-86`); fabric `core` → `rules` (`:102-109`); `wiki_search` → `memory.recall` (`:119`). (S: "retired names"; E: one fixture per table.)
      - `docs/host-security.md` (193 lines): `Multi-user hosts on one agent` (`:117`), `Security and performance notes` (`:155`), supply-chain and live-canary boundaries (`:222`). Subscription credentials never pass through Prism (`:146`). (S: security; E: fixture "log a literal key".)
      - Backlog host-facing entries: `createToolRegistry` default duplicate policy is `"replace"`, so a host tool silently shadows a package tool (`plans/backlog.md:153`); `providerPackage` around a nested script delivers no tool call (`:488`); `tools-work` needs the host-provided `work.sandbox` service for `work_exec` (`:456`); wiki `autoDeploySkills` default flipped to false (`:527-528`); `release.mjs gate --update-baseline` needs a Postgres-backed publish-mode path on a workstation (`:72`, P3) — **Task 14's generator must not call the gate**.
      - Not evidence of failure but a constraint: this repository's `.claude/skills` is a symlink to `.agents/skills` (plan 190 Task 1, verified there), so the installer must resolve realpaths before writing.
    - **(d) Coding-agent conventions** (ctx7, 2026-11-07):
      | Target | Project skill directory | Project MCP configuration | Installer writes config? |
      | --- | --- | --- | --- |
      | Claude Code (`/anthropics/claude-code`, plugin docs, CHANGELOG) | `.claude/skills/<name>/SKILL.md` (loads even when the directory is git-untracked) | `.mcp.json` at the repository root, top-level `mcpServers: { <name>: { command, args, env } }`; `${VAR}` and `${VAR:-default}` expand; project scope is the committed file | **Yes**, JSON merge (add one `mcpServers` key, never rewrite others) |
      | Codex CLI (`/openai/codex`, `codex-rs`) | `.agents/skills/<name>/SKILL.md`, discovered from the project root down to the cwd (`SkillScope::Repo`, `ext/skills/src/host_roots.rs`); `.codex/skills` is the user scope | `.codex/config.toml`, table `[mcp_servers.<name>]` with `command`, `args`, `env`, `env_vars`, `cwd`. Project layers load only for a **trusted** project and are disabled otherwise. `codex mcp add` writes only the user `~/.codex/config.toml` | **No**: TOML, and the package takes no TOML dependency → **print a snippet** |
      | Cursor (`/websites/cursor_cli`, changelog 2026-03) | `.cursor/skills` natively; also reads `.claude/skills`, `.agents/skills`, `.codex/skills` (changelog "March 2026") | `.cursor/mcp.json`, same `mcpServers` JSON shape as Claude Code; project servers need per-user approval (`agent mcp enable <id>`); `${VAR}` expands | **Yes**, JSON merge |
      | Prism (`contextFiles`, `packages/context/files/src/skills.ts:28-41`) | project: `.agents/skills`, then `.claude/skills`; global (only with `globalRoot`): `.agents/skills`, `.claude/skills`, `.codex/skills`; the first root wins a duplicate name, roots de-duplicate by realpath | none (a Prism host lists the package in code or a manifest) | skill copy only; `prism` target also prints the `packages: [...]` line |
      - Consequence for the target list in Task 18: `agents` (`.agents/skills`) already reaches Codex, Cursor and Prism, so `claude` (`.claude/skills`) is the only extra directory; `cursor` and `codex` targets add only their MCP step. Installing both `.agents/skills/prism-host-builder` and `.claude/skills/prism-host-builder` into one repository would register the skill twice in Cursor; the installer must detect that and write one copy (realpath de-duplication, as Prism does).
      - ctx7 cites `anthropics/claude-code` CHANGELOG.md, `openai/codex` `codex-rs/config/src/loader/mod.rs` and `mcp_types.rs`, and cursor.com/docs/cli (`/mcp`, `/changelog`). Skill directory behaviour of Claude Code is also confirmed by this repository itself (`.claude/skills` → `.agents/skills`).
    - **(e) MCP serving.** `servePrismMcpStdio(server | factory, options)` is at `packages/hosts/mcp-server/src/server.ts:205`. A bare `McpServer` or a `McpServerFactory` both work; one factory instance serves the connection; `legacy: "serve"` is the default; `maxSubscriptions` is bounded to 4096. `graft callers` finds two callers (`serveMcp` at `serve.ts:103` and `scripts/fixtures/mcp-smoke-server.mjs`), so it is reusable for a non-agent server.
      - SDK 2.0.0 registration API (ctx7 `/websites/ts_sdk_modelcontextprotocol_io` v2, plus the repo's own calls in `packages/hosts/mcp-server/src/serve.ts:69-85` and `serve-tools.ts:127-160`):
        - `new McpServer({ name, version }, { capabilities: { tools: {}, resources: {}, prompts: {} } })`;
        - `server.registerTool(name, { title?, description, inputSchema, outputSchema? }, handler)`. The handler returns `{ content: [{ type: "text", text }], structuredContent? }`. `inputSchema` is a Zod object, or a JSON Schema through `fromJsonSchema` as `serve-tools.ts:130` does;
        - `server.registerResource(name, uri, { title?, mimeType? }, async (uri) => ({ contents: [{ uri: uri.href, mimeType?, text }] }))`; a dynamic form uses a resource template;
        - `server.registerPrompt(name, { title?, description, argsSchema }, args => ({ messages: [{ role: "user", content: { type: "text", text } }] }))`.
      - Task 17 uses these three registrations only. The server adds no tool that mutates; every tool is read-only.
    - **(f) Checking host code.** `createAgent` (`src/agent-session/create-agent.ts:66-71`) assembles by `loadPackages` (`:100-116`), which runs every listed package's `setup`. What setup can do:
      - **Spawn a child process.** `@arnilo/prism-mcp` connects each enabled MCP server in `setup` (`packages/integrations/mcp/src/package.ts:63-218`, `Promise.all(entries.map(connectServer))`), through `StdioClientTransport` (`transport.ts:13`) with the entry's `command`, `args`, `cwd`, `env`. A trust check gates it first (`checkServerTrust`, `:80`).
      - **Resolve credentials.** `credentials.resolve(ref)` on `env:`/`keyring:` refs (`package.ts:94`; also governance, litellm, ollama-cloud, postgres, web). `createEnvRefCredentialResolver` reads `process.env` (`src/credentials/env.ts:4`); an unresolved ref fails or marks the entry `failed` and never throws a literal.
      - **Touch the network.** Provider packages are listed and do not call a model at setup (no `fetch(` in `packages/providers/*/src/index.ts`); `tools-web` with the `searxng` backend makes no request at setup (Task 12 note). Remote MCP (`streamable-http`) and `connectMcpTools` do open the network at setup.
      - **Therefore the runner for Task 17:** a bounded child process (`bun`) with an **allowlisted environment** of `PATH`, `HOME` set to a throwaway temp directory, `LANG`, `NO_COLOR`, `PRISM_HOST_BUILDER_CHECK=1` and nothing else, so `env:` refs resolve to nothing and the check fails closed on a missing credential instead of using one. A 30 s wall-clock timeout (kill the process group), a 64 KiB cap per stream (truncated and marked), exit-code mapping, and cwd set to the host project root. The runner cannot stop the host's own code from spawning or opening sockets; **Task 17 must therefore require an explicit `--allow-exec` (CLI) or `allowExec: true` option and say so in the tool description**, and `inspect()` output is passed through the redactor and a size cap before return. The server must never run it implicitly.
      - Programmatic checks: `packageConformance(input, { config?, mockProvider? })` (`src/testing/package-conformance.ts:193`, re-exported by `@arnilo/prism/testing`) returns `{ ok, checks: [{ name, ok, message? }] }` over six checks (`setup_dispose_idempotent`, `no_leaks_after_dispose`, `config_schema_valid`, `capabilities_cover_usage`, `no_secret_in_inspect`, `unavailable_fails_closed`). `verify(options)` (`src/manifest/maintain.ts:229`, from `@arnilo/prism/manifest`) re-hashes installs and **imports the installed package** when it is enabled and (user scope, or `trustProject()` resolves true), so the host-builder tool must pass `trustProject: () => false` and report "not checked" for project packages unless the caller opts in. `agent.inspect()` is `Agent.inspect(): AgentInspection` (`src/contracts-core/agent.ts:268`).
    - **(g) Tarball size.** Measured and estimated (no file created):
      - `examples` without the three excluded directories: 727,040 bytes raw, 174,302 gzipped.
      - Live baseline text: 1.10 MB raw (6,320 rows). `api.json` adds a docs/READMEs/examples cross-reference per row and a subpath per entry; estimate 1.8–2.4 MB raw, 0.3–0.4 MB gzipped.
      - `errors.json` (370 + ~70 short codes): ~100 KB raw. `examples.json`: ~40 KB.
      - Estimated `data/` total: **~3.0 MB unpacked, ~0.6 MB packed**, against the kernel's 1.17 MB packed / 3.81 MB unpacked (`scripts/budgets.json` `kernel`). Task 14 measures the real value.
      - `scripts/budgets.json` has no per-package entries other than `root`, `kernel`, `packageSkills` and the like. **Task 14 adds a `hostBuilder` entry** with `packedBytes` and `unpackedBytes` baselines at the measured value, tolerance 0.05, and a `$comment` carrying the date and method, and wires it where `packageSkills` is wired in `scripts/budget-gates.mjs`.
    - **(h) Trust boundaries.**
      - **Executing host code (Task 17):** `createAgent` runs listed packages' `setup`, which can spawn processes and open sockets (f). Boundary: explicit consent flag, allowlisted environment, throwaway `HOME`, timeout and output caps, redaction of `inspect()`, and never run from the stdio server by default.
      - **Writing agent config files (Task 18):** `.claude/skills`, `.agents/skills`, `.cursor/mcp.json`, `.mcp.json`. Boundary: `--dry-run`, refuse to overwrite without `--force`, merge JSON losslessly with a parse check before and after, write inside the project root only (realpath check, and symlinked `.claude/skills` resolves first), never write a secret (the MCP entry holds `command` and `args` only), print a snippet for `.codex/config.toml`, and never run `bun install`.
      - **Reading project files:** the docs resources read only from the installed `node_modules/@arnilo/*` (and the package's own `data/`), never from the project tree, and they exclude `docs/history/**` (b).
      - **The stdio channel:** local only, no listener, no network, no model, read-only tools; every result bounded (64 KiB proposed) and truncation marked.
      - Recorded for the freeze: the package has no credentials of its own; it adds no kernel export and does not enter the `SecretSource` migration.
    - **Verdict (h).** Proceed to Task 14. No task is invalidated. Task 14 was amended in place (see its "Amended by Task 13" block). Tasks 17 and 18 are not edited; they read this note, which fixes their inputs:
      - Tasks 17 and 18: consent flag, environment allowlist, `trustProject: () => false` for `verify`, JSON merge for `.mcp.json` and `.cursor/mcp.json`, snippet for Codex TOML, single skill copy under realpath de-duplication.
    - **Checks run.** `graft callers servePrismMcpStdio --depth all`; the plan's `rg` count (370); manifest walk (51 live packages, 104 baselines, 53 stale); `bun pm pack --dry-run` (docs/history ships: 49 files); ctx7 for Claude Code, Codex CLI, Cursor and the MCP TypeScript SDK. No test run: read-only.

- [x] Task 14: The package and its generated reference indexes (was plan 212 Task 2)
  - Amended by Task 13 (2026-11-07), see its note (b), (g) and verdict:
    - `scripts/compat-baseline/` has 104 files, not 101; only 51 are live. The index iterates live publishable manifests with a per-subpath entry (reuse `parseDeclarationFile`, export the seam from `scripts/release-gates.mjs`); it never reads the directory.
    - `errors.json` has two namespaces (`ERR_PRISM_*` scan; short-code unions plus `skill_unavailable`) and a `sampleMessage` field. Task 15's coverage rule is `meaning ?? sampleMessage` non-null.
    - Add the `@arnilo/prism-host-builder` row to the `roadmap.md:628-639` table and append `host-builder` to `roadmap.md:109`.
    - Add the `hostBuilder` entry to `scripts/budgets.json` (measured, tolerance 0.05).
    - The docs resources exclude `docs/history/**` and `migrate-to-0.5` … `migrate-to-0.11`.
  - Acceptance Criteria:
    - Functional:
      - `packages/hosts/host-builder/` is created with:
        - `package.json`: `@arnilo/prism-host-builder` 0.13.0; `exports: { ".": "./src/index.ts" }`; `bin: { "prism-host-builder": "./bin/prism-host-builder.ts" }`; `files` with `src`, `bin`, `data`, `skills`, `README.md`, `CHANGELOG.md`, `LICENSE`; peer `@arnilo/prism >=0.13.0 <1.0.0`; dependency `@arnilo/prism-mcp-server`
        - `src/index.ts`, `bin/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json`, `bunfig.toml`, `src/__tests__/`
        - a bin that prints usage for `--help` and fails with exit code 2 on an unknown subcommand
      - `scripts/host-builder-index.mjs` generates `data/api.json`, `data/errors.json` and `data/examples.json` plus `data/examples/<path>` sources. It writes deterministic, sorted output and takes `--check` to verify without writing.
        - `api.json`, per public export of `@arnilo/prism`, its subpaths and every published package:
          - name, kind, signature (from the baseline generator's model, Task 13 (b))
          - the docs pages and READMEs that mention it in backticks
          - the examples that import it
        - `errors.json`, per code: the owning package, the declaring file and line, the error class, the docs pages that mention it, and a one-line meaning taken from the declaration's doc comment. A code without a doc comment is listed with `meaning: null` and reported, so the review in Task 15 can add one.
        - `examples.json`, per example in the execution gate: path, title (first doc-comment line), imported packages, and whether it needs credentials (from the e2e coverage file).
        - Each file records `prismVersion` and a content hash.
      - Enforcement rows (`references/prism.md` §3 probe 11):
        - root `package.json` `workspaces` (already globbed by `packages/hosts/*`; verify)
        - the `scripts/package-truth.mjs` counts
        - the `src/__tests__/packaging.test.ts` package list
        - `scripts/independent-packages.json` (decision: lockstep with the kernel, since the indexes describe one kernel version)
        - a new `scripts/compat-baseline/arnilo__prism-host-builder.txt` via `bun scripts/release.mjs gate --update-baseline` (diff in the note: one new file)
        - a `docs/index.md` link under "Host libraries"
        - a `scripts/budgets.json` entry from Task 13 (g)
      - The freeze tasks (25–29) cover `@arnilo/prism-host-builder`, which is in the tree at freeze time. The standing rule in this plan's header binds every later task that renames, removes or reshapes a public export to update the kit in the same task.
    - Performance: The generator runs in under 20 s. The indexes load lazily, on the first MCP tool call that needs them, not at bin start.
    - Code Quality: The generator reuses the baseline generator's export model instead of parsing TypeScript itself. No TypeScript compiler dependency at runtime. `data/` is generated, never hand-edited, and the freshness test enforces it.
    - Security: The generator reads only `src/`, `packages/*/src`, `docs/`, the package READMEs and `examples/`. Copied example sources are scanned with `redactSecrets`, and a hit fails generation. No `live.env` or `_evidence` content enters `data/`.
  - Approach:
    - Documentation Reviewed:
      - Task 13 (b), (g); `packages/hosts/devtools/package.json` (bin precedent); `scripts/independent-packages.json`; `scripts/package-truth.mjs`
    - Options Considered:
      - **Parse `.d.ts` files at runtime from the installed `node_modules`.** Rejected: it needs the TypeScript compiler (a heavy dependency) and is slow on every call. A build-time index is exact for a lockstep version.
      - **Link examples to GitHub instead of shipping sources.** Rejected: the server must work offline and version-exact.
      - **Put the kit in the kernel tarball (`skills/` plus a `prism mcp` subcommand).** Rejected: MCP needs a runtime dependency that the zero-dependency kernel forbids, and every host would pay the tarball bytes.
    - Chosen Approach:
      - A lockstep host library whose data is generated from the same models the release gate already trusts.
    - API Notes and Examples:
      ```bash
      timeout 60 bun scripts/host-builder-index.mjs           # regenerate packages/hosts/host-builder/data
      timeout 60 bun scripts/host-builder-index.mjs --check   # CI: fail if stale
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/**` (new)
      - `scripts/host-builder-index.mjs` (new), `scripts/host-builder-index.test.mjs` (new)
      - `scripts/package-truth.mjs`, `src/__tests__/packaging.test.ts`, `scripts/independent-packages.json`, `scripts/budgets.json`
      - `scripts/compat-baseline/arnilo__prism-host-builder.txt` (new, generated)
      - `docs/index.md`
      - `roadmap.md` §2 host-library rows (tentative: per Task 13 (a))
      - `CHANGELOG.md`
    - References:
      - `packages/hosts/devtools/` (layout), `scripts/compat-baseline/`
  - Test Cases to Write:
    - `host_builder_index_is_fresh`: `--check` passes on the tree and fails after a fixture adds an export without regenerating.
    - `host_builder_index_deterministic`: two runs produce byte-identical output.
    - `host_builder_index_rejects_secret_in_example`: a fixture example containing a key-shaped literal fails generation.
    - `host_builder_bin_usage`: `--help` exits 0; an unknown subcommand exits 2.
    - `packaging.test.ts` lists the package; the tarball contains `data/api.json`. (The `skills/prism-host-builder/SKILL.md` assertion moves to Task 15, which creates the file.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new published package and bin.
    - Docs pages to create/edit:
      - `packages/hosts/host-builder/README.md`: package page structure. Install (as a dev dependency); bin usage; what it serves; cost (no model calls, no network); security (what it executes and where it writes)
      - `docs/index.md`: one link under "Host libraries"
      - `CHANGELOG.md`
    - `docs/index.md` update: yes — "`@arnilo/prism-host-builder`: Skill, MCP server, and installer that help coding agents build and change Prism hosts against the installed version."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - **What changed.**
      - `packages/hosts/host-builder/` (new, lockstep 0.13.0): `package.json` (bin, `files` with `data` and `skills`, peer `@arnilo/prism`, dependency `@arnilo/prism-mcp-server` for Task 17), `src/{index,indexes,errors}.ts`, `bin/prism-host-builder.ts` (`info`, `--help`/`-h`/`help` exit 0, unknown or missing command exit 2), `README.md`, `CHANGELOG.md`, `LICENSE`, `tsconfig.json`, `bunfig.toml`, tests, and the generated `data/`. `loadHostBuilderIndex(name)` loads lazily and caches; `readExampleSource(path)` serves only paths `examples.json` lists.
      - `scripts/host-builder-index.mjs` (generate, `--check`, `--root`, `--out`) and `scripts/host-builder-index.test.mjs`. The generator took 16.5 s here (budget 20 s), with 52 declaration emits.
      - `scripts/release-gates.mjs`: `declarationDir` is exported; `parseDeclarationFile` returns the additive fields `typeLocals`, `rich`, `docs`, `namedFrom` (so `locals`, `named` and `stars`, and therefore every baseline, are unchanged); new `extractEntrySurface(entryFile)` resolves the names reachable from one `exports` target. The gate also checks the host-builder size budget (step 5).
      - Enforcement rows: `package.json` `workspaces` already globs `packages/hosts/*` (verified, no change); `scripts/package-truth.mjs` note and regenerated `scripts/package-truth.json`, `README.md`, `docs/index.md`, `docs/release.md` (52 manifests: root plus 51); `src/__tests__/packaging.test.ts` (new `shipsData` flag and a data assertion) and `install-smoke.test.ts`; `scripts/independent-packages.json` (lockstep, recorded in its `$comment`; `packages` stays empty); `bun.lock` (19 lines, from `bun install --lockfile-only`); `scripts/e2e-coverage.json` (+1 surface) with `e2e-coverage.test.mjs` total 84 → 85; `phase24-truth.test.mjs` counts (52 / 51 / capability 39 / 51); `version-literal-gate.test.mjs` 51 → 52 manifests; `scripts/coverage-thresholds.json` (97 / 97 against a measured 100 / 100); `scripts/run-all-tests.mjs` `GATE_FILES`; `biome.json` ignores `packages/hosts/host-builder/data` (generated example copies are not linted); `package.json` `release:gate` runs `bun scripts/host-builder-index.mjs --check`; `docs/index.md` link under "Host libraries"; `roadmap.md` table row (Task 13 (a)) and the `hosts/{…,host-builder}/` line (the `acp · ag-ui …` diagram line also names it); `CHANGELOG.md`.
      - Budget: `budgets.json` `hostBuilder` = 379,140 packed / 1,956,683 unpacked / 131 files, tolerance 0.05 (the Task 13 estimate was ~0.6 MB / 3.0 MB; real values are lower because `api.json` holds entry-reachable names only). Kernel `packedBytes`/`unpackedBytes` ceilings rebaselined to 1,213,474 / 3,948,267 with a reason in the entry: the root tarball ships the CHANGELOG, `docs/index.md` and the regenerated inventory rows. About 716 / 1,716 bytes of that came from an uncommitted `docs/performance.md` edit by the plan 210 work in the same working tree.
    - **Baseline diff.** One new file, `scripts/compat-baseline/arnilo__prism-host-builder.txt` (16 rows: `HostBuilderError`, `loadHostBuilderIndex`, `readExampleSource` and the 13 type names the baseline model reads from the re-export statement). No other baseline changed (`bun scripts/release.mjs gate` passes across 52 packages). The package has no removals to attribute.
    - **Findings that affect later tasks.**
      - **Data is coupled to the docs, the examples and the host-builder source itself.** `api.json` records which docs mention each name, so any edit to `docs/*.md`, a package README or an example makes `--check` fail until regenerated (this happened mid-task when `docs/performance.md` changed). Every later task that edits those files must run `bun scripts/host-builder-index.mjs`. `errors.json` carries the package's own error codes with line numbers, so editing `src/errors.ts` also needs a regeneration. The standing rule in this plan's header should be read as including docs and examples edits.
      - **Task 15's error-code coverage rule.** `errors.json` has 531 codes (372 `ERR_PRISM_*` from the source scan, 159 short codes); 346 have `meaning`, a `sampleMessage` or both, and **185 have neither** (mostly codes that reach a throw site through a variable message, such as `ERR_PRISM_ACP_MCP`, the `ERR_PRISM_ARTIFACT_BODY_*` map and `ERR_PRISM_DIAGRAMS_*`). The generator prints `errorsWithoutMeaningOrSample`. Task 15 must apply the rule to the codes the skill and pitfalls reference, adding doc comments for those that fall in the 185, and must not apply it to all codes.
      - **Docs paths in the data are installed-tarball paths** (`node_modules/@arnilo/prism/docs/host.md`, `node_modules/@arnilo/<pkg>/README.md`), the form Task 15's check (2) resolves. The index excludes `docs/history/**` (it is not read at all), the `migrate-to-0.5`…`0.9`/`0.11` pages, `docs/migration.md`, `api-page-template.md` and the evidence pages.
      - **Examples in `data/examples/`:** 109 listed in `examples.json` (the top-level `examples/*.ts`; `docker-process-session.ts` is left out as `known-broken`) plus support files (adapters, sidecar sources, the `.mjs` hook). Markdown files and `tsconfig.json` are not copied: an example README links into the repo's docs and breaks the shipped-link check, and the packaging guard denies a tsconfig in any tarball. Task 15's typecheck of fenced blocks therefore uses `examples/tsconfig.json` from the repository, not from `data/`. The path stored in `examples.json` is the repository path (`examples/x.ts`), and the copy is at `data/examples/x.ts`.
      - **Secret scan.** Key-shaped patterns (`sk-` followed by 32 unbroken characters, `sk-ant-`/`sk-proj-`/`sk-or-v1-`, AWS, GitHub, Slack, Google, JWT, PEM, long Bearer values) plus `redactSecrets` over values of `*KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL*` environment variables and `scripts/live.env`. A bare `sk-` prefix is not flagged because five examples hold readable demo sentinels such as `sk-live-never-persist-this`.
      - **`api.json` is entry-reachable per subpath** (kernel: `.`, `./provider-kit`, `./driver-kit`, `./manifest`, `./testing` and the seven further subpaths), so it is smaller than the baseline union (4,565 names against 6,320 baseline rows). A package whose entry is only a default export (stores, `compaction`) lists just that, which is correct: `createJsonlSessionStore` is not importable.
      - **Pre-existing red suites seen while verifying, not caused by this task:** `phase24-truth` "peer policy Decision B" (`@arnilo/prism-evals` peers `@arnilo/prism-observability` at HEAD), `host-surface-gate` (`packages/hosts/mcp-server/src/skill-resources.ts` imports `Skill`, which is not allow-listed), `release-gate` "no_compat_baseline_without_workspace" (orphan `arnilo__prism-agent-sdk.txt`, `arnilo__prism-work.txt`), `tooling-gate` (`node:test` imports under `scripts/memory-bench`), `budget-gate` export counts and non-null rows, `e2e-full-surface` (context-engineering fold text), and the `phase23-coverage` artifact rows (the gitignored `coverage-summary.json` needs `bun run coverage:summary`). The Task 15 `host_builder_kit_matches_surface` gate should be run against the same list when it lands.
    - **Sweep.** No retired name or code was introduced or removed, so no repo-wide grep was due.
    - **Checks run.** `bun scripts/host-builder-index.mjs` and `--check` (fresh); `bun test scripts/host-builder-index.test.mjs` (7 pass: freshness on the tree and on a fixture, determinism, secret rejection, retired-doc exclusion, budget); `bun run --filter @arnilo/prism-host-builder test` (7 pass); package `tsc --noEmit`; `bun x tsc -p examples --noEmit`; `bun scripts/release.mjs gate` (passes, 52 packages, deny list and both size budgets); `src/__tests__/packaging.test.ts -t host-builder` (6 pass); `docs.test.ts` (shipped markdown links), `e2e-coverage`, `version-literal-gate`, `packaging-current`, `phase24-truth` (all pass except the pre-existing peer-policy test above); `biome check` on the new files.

- [x] Task 15: The `prism-host-builder` skill and the drift gate (was plan 212 Task 3)
  - Amended by Task 14 (2026-11-07), see its notes:
    - The tarball assertion for `skills/prism-host-builder/SKILL.md` moves here (`packaging.test.ts`, next to the `shipsData` assertion).
    - The error-code rule applies to the codes the skill and pitfalls reference, not to all 531: 185 codes have neither a `meaning` nor a `sampleMessage`. Add a doc comment for any referenced code among them.
    - Block typechecking uses the repository's `examples/tsconfig.json`; `data/` carries no tsconfig and no example Markdown.
    - Editing the skill, a docs page or an example changes the data; run `bun scripts/host-builder-index.mjs` in the same task.
  - Acceptance Criteria:
    - Functional:
      - `skills/prism-host-builder/SKILL.md` has:
        - a description that triggers on building, changing, upgrading or debugging a Prism host or package
        - a body of at most 8 KiB, covering the workflow (orient, choose, build, verify) and a map of the references
      - `references/`:
        - `choosing.md`: decision trees for the host library (headless, acp, ag-ui, mcp-server, channels, remote, devtools), store, compaction and slot owners, the experimental memory line (how to opt in with `@experimental`, and that it is outside the compatibility promise), approval and governance, and provider
        - `layout.md`: what belongs in the kernel, in a package, or in the host (from `apps/prism-agent/README.md`, "Where things go"); the public-surface rule
        - `recipes.md`: one entry per common change, each naming the CI-tested example to copy and the docs page, never restating the example's code
        - `pitfalls.md`: failure modes from Task 13 (c), with error codes and fixes
        - `security.md`: a condensed `docs/host-security.md` checklist; secret refs only; project trust
        - `verification.md`: typecheck, `inspect()`, `packageConformance`/`loopConformance`/`storeConformance`, the MCP tools
        - `upgrading.md`: how to read `docs/migrate-to-*.md`, the retired-name map
      - Every doc reference is a project-relative path into the installed tarballs (`node_modules/@arnilo/prism/docs/<page>.md`, `node_modules/@arnilo/<pkg>/README.md`), so a copied skill reads version-exact docs. The skill names the MCP tools as optional accelerators; every procedure also works without the server.
      - It passes Task 7's `package_skills_conform` as a package skill. The package does not register it into agents (it has no `setup`); the installer copies it.
      - `host_builder_kit_matches_surface` (`src/__tests__/host-builder-kit.test.ts`) checks:
        - (1) every fenced `ts` block in the skill and its references is extracted and typechecked against the workspace, with the `examples/tsconfig.json` settings; a block marked `<!-- no-check -->` must give its reason
        - (2) every `node_modules/@arnilo/<pkg>/<path>` reference exists in that package's packed file list
        - (3) every `examples/<path>` reference is in `data/examples.json`
        - (4) every `ERR_PRISM_*` or short error code mentioned exists in `data/errors.json`
        - (5) no name from `scripts/retired-tool-names.json` (Task 7) or the retired-name tables of `docs/migrate-to-0.13.md` appears outside `upgrading.md`'s from-columns

        It runs in `release:gate`.
      - Every `errors.json` code with `meaning: null` that the skill or a pitfall references gets a doc comment at its declaration in this task.
    - Performance: The gate runs in under 60 s (one `tsc --noEmit` over the extracted blocks).
    - Code Quality: The skill holds judgment and pointers; facts that change (signatures, options) live in the docs and the indexes and are linked, not copied. That is what keeps the drift surface small.
    - Security: The security reference never weakens a fail-closed rule. The gate scans the skill for secret-shaped literals.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/README.md`, `docs/host-security.md`, `docs/migrate-to-0.13.md`, `examples/README.md`, `templates/README.md`
      - Task 13 (c); Task 7 (authoring contract)
    - Options Considered:
      - **One large `SKILL.md`.** Rejected: progressive disclosure inside the skill (body plus `references/`) keeps the loaded cost small. Plan 190 Task 6 already makes `references/` readable.
      - **An `llms.txt` index.** Rejected: `docs/index.md` already ships in the tarball and serves as the index; the skill points to it.
      - **Restate example code in recipes.** Rejected: it duplicates tested code into untested text, which is the drift the gate exists to prevent.
    - Chosen Approach:
      - A judgment-and-pointer skill, with a gate that compiles its code and resolves its pointers.
    - API Notes and Examples:
      ```markdown
      ---
      name: prism-host-builder
      description: Use when building, changing, upgrading, or debugging a host or package on the Prism agent SDK (@arnilo/prism) — choosing packages, wiring createAgent, serving it, and verifying it.
      ---
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/skills/prism-host-builder/SKILL.md` and `references/*.md` (new)
      - `src/__tests__/host-builder-kit.test.ts` (new); the `release:gate` stage list
      - declaration files gaining doc comments (tentative: those Task 13 (b) flags)
      - `packages/hosts/host-builder/README.md`, `CHANGELOG.md`
    - References:
      - `examples/tsconfig.json`; `scripts/e2e-coverage.json`
  - Test Cases to Write:
    - `host_builder_kit_matches_surface`: passes on the tree. Fixture variants fail on:
      - a block importing a nonexistent export
      - a path missing from a tarball
      - an unindexed example
      - an unknown error code
      - a retired name outside `upgrading.md`
    - `host_builder_skill_conforms`: the skill passes `package_skills_conform`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published skill content.
    - Docs pages to create/edit: the package README ("The skill" section); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-07):
    - **What changed.**
      - `packages/hosts/host-builder/skills/prism-host-builder/SKILL.md` (4,431 B against the 8 KiB cap) and `references/{choosing,layout,recipes,pitfalls,security,verification,upgrading}.md`. The skill holds the workflow (orient, choose, build, verify, report), the non-negotiable rules and a reference map. Every doc path is `node_modules/@arnilo/<pkg>/…`; examples are cited as `examples/<file>` (the copy is at `node_modules/@arnilo/prism-host-builder/data/examples/<file>`). The MCP tools are named only as an optional accelerator, and no MCP tool name appears yet, because Task 16 has not fixed them.
      - `src/__tests__/host-builder-kit.test.ts`: `checkKit` is the gate (`host_builder_kit_matches_surface`) and the same function runs against fixture kits. Checks: (1) fenced `ts` blocks typechecked with `examples/tsconfig.json` (`<!-- no-check: reason -->`; a marker without a reason fails); (2) `node_modules/@arnilo/<pkg>/<path>` resolved against the package's `files` list (negations honoured), refusing `docs/history/**` and the retired `migrate-to-0.5`…`0.11` pages and `migration.md`; (3) `examples/<file>` in `examples.json` (examples or support); (4) `ERR_PRISM_*` anywhere plus every token in a table's `Code` column, which must be in `errors.json` with a `meaning`; (5) retired names from `scripts/retired-tool-names.json` and the left column of every table in `docs/migrate-to-0.13.md` (identifiers only, and only those that are not a current export or package in `api.json`), allowed in `upgrading.md` only in the left column of a table; (6) a secret-shape scan with the generator's `SECRET_SHAPES` (now exported from `scripts/host-builder-index.mjs`). The gate takes about 1.5 s here (the tsc over the blocks is native and fast), against the 60 s budget.
      - `scripts/package-skills-conformance.mjs`: a `packages/hosts/host-builder` fixture. The published package registers nothing, so the gate builds an inline package named `@arnilo/prism-host-builder` whose `setup` calls `prism.skills.addDir` on the skills directory, and the skill is then checked exactly like a package skill. `src/__tests__/package-skills.test.ts` now expects 13 shipped skills. `host_builder_skill_conforms` in the kit test runs the gate and asserts no failure for this package.
      - Wiring: `release:gate` runs `src/__tests__/host-builder-kit.test.ts` after the kernel-constraint tests (before the package-skills script). `packaging.test.ts` asserts the tarball holds `SKILL.md` and the seven references. Package README "The skill" section, package and root `CHANGELOG.md`.
      - `src/agent-session/model-errors.ts`: a doc comment on each `ModelErrorCode` member. The skill's pitfalls table references `model_required`, which had no meaning. `errorsWithoutMeaningOrSample` went 184 → 181, because the four model codes now carry a meaning. A single-line union with one comment gave every member the same meaning, which the formatter produces by default, so each member has its own comment on its own line.
      - `scripts/budgets.json` kernel ceilings rebaselined (1,214,663 packed / 3,951,691 unpacked / 40,414 source lines) with a reason on each. Source lines are +8 from the comments above. Part of the byte growth is the budget comment itself, which `budgets.json` ships in the kernel pack.
    - **Findings that affect later tasks.**
      - **`measureExportCounts` regex-matches `export` in any text under `src/`, including test strings.** An `export function checkKit` in a test file and an `export const x` inside a string literal each added one name to the kernel's `rootExports` (1521 against 1519). Test files under `src/__tests__` must not export, and strings that hold example TypeScript must not contain `export const|function`. Tasks 16–18 add tests under `src/__tests__`.
      - **Task 16 must keep tool names out of the gate's universe, or register them.** `package_skills_conform` check (4) scans workspace sources for `name: "snake_case"` literals in files that define `execute`. An MCP tool registered with `registerTool` does not define `execute`, so a backticked MCP tool name in `SKILL.md` is not flagged today. If Task 16 names the tools in `SKILL.md`, re-run `bun scripts/package-skills-conformance.mjs`; an MCP tool name that does match the scan fails as `unregistered_tool`. The names belong in `references/verification.md` (the references are not body-scanned for tools) and the SKILL body keeps pointing at them.
      - **Task 16–18 amend two places.** `SKILL.md` ("Where the facts are") and `references/verification.md` item 7 describe the MCP tools generically; Task 16 names them there, and Task 18's installer copies `skills/prism-host-builder` as a whole (SKILL.md and `references/`). `references/security.md` mentions `trustProject` only as a thing not to weaken; Task 17's `verify` tool passes `trustProject: () => false` and should be mentioned in `verification.md` item 6.
      - **The gate is stricter than the plan text on codes.** The Task 14 amendment said `meaning ?? sampleMessage` non-null; the Task 15 acceptance text says a referenced code with `meaning: null` gets a doc comment. The gate follows the second: a referenced code needs a `meaning`. All 21 codes the pitfalls reference have one now.
      - **Short codes are detected by convention.** Only tokens in a table whose first header is `Code` count, so prose can name a lowercase word freely. A pitfall written outside such a table is not checked. The README states this.
      - **Retired-name detection skips plain words** (`loop`, `context`, `permission`, `identity`, `middleware`, `store` …): the filter keeps only identifiers with a capital letter, `_`, `-` or `@` that are not current exports or packages. `upgrading.md` covers the plain ones in prose.
      - `bun scripts/host-builder-index.mjs` was re-run (the model-errors comments and the README change `errors.json` and `api.json`); `--check` is fresh. Editing a `SKILL.md` or reference does not change `data/`, because the generator reads `docs/`, the READMEs and `examples/` only.
    - **Baseline diff.** None: no export moved. `scripts/compat-baseline/arnilo__prism-host-builder.txt` is unchanged (the package exports no new name).
    - **Sweep.** No name, error code or config was retired or renamed in this task; no repo-wide grep was due.
    - **Checks run.** `bun test` on `host-builder-kit.test.ts` (15 pass: the tree, the 8 KiB body cap and the reference map, `host_builder_skill_conforms`, and 12 fixture kits each failing one rule: nonexistent export, no-check without reason, no-check with reason skipped, missing tarball path, retired contract page, unindexed example, unknown `ERR_PRISM_*`, unknown short code in a `Code` column, retired tool outside `upgrading.md`, retired migration name outside it, retired name in its right column, secret-shaped literal), `package-skills.test.ts` (20 pass), `scripts/host-builder-index.test.mjs`, `docs.test.ts` (shipped-link check), `model-less-agent.test.ts` (115 pass across the five), `packaging.test.ts -t host-builder` (6 pass), `e2e-coverage` and `version-literal-gate`; `bun scripts/package-skills-conformance.mjs` (clean); `bun scripts/host-builder-index.mjs --check`; `bun scripts/release.mjs gate` (exit 0, both size budgets and the 52 baselines); root `tsc -p tsconfig.json --noEmit`, `tsc -p examples --noEmit` and the package `tsc` (all clean); `biome check` on the files this task wrote (clean).
    - **Not run.** The full `bun run test`, `bun run lint` and `release:gate` end to end (the other stages need the whole workspace and are unchanged by this task), and `bun scripts/release.mjs gate` against a clean checkout. The pre-existing red suites listed in the Task 14 note were not re-measured.

- [x] Task 16: The MCP server — lookup tools, docs resources, prompts (was plan 212 Task 4)
  - Acceptance Criteria:
    - Functional:
      - `prism-host-builder mcp [--root <dir>]` serves over stdio through `servePrismMcpStdio` (`packages/hosts/mcp-server/src/server.ts:205`). Tools:
        - `prism_api({ symbol?, query?, package? })`: an exact symbol lookup, or a lexical query over names and signatures; returns signature, package, subpath, docs pages and examples
        - `prism_errors({ code })`: meaning, owning package, declaring `file:line`, related docs, and fixes from `pitfalls.md` when listed
        - `prism_examples({ query?, package? })`: ranked examples; `{ path }` returns the source
        - `prism_docs({ query })`: lexical search over the installed `node_modules/@arnilo/prism/docs/*.md` and `node_modules/@arnilo/*/README.md` under `--root`, returning heading-anchored excerpts
      - Resources: `prism-docs://<package>/<path>` for each installed docs page and README.
      - Prompts:
        - `build-host`: load the skill, choose with `choosing.md`, verify
        - `add-capability`
        - `upgrade-host`: read the installed version, the migration notes, the retired-name check
      - **Version check.** Each tool call resolves the `@arnilo/prism` version installed under `--root` and compares it with the indexes' `prismVersion`. On mismatch, or when Prism is not installed, the call returns a tool error (`ERR_PRISM_HOST_BUILDER_VERSION`) naming both versions and the fix (`bun add -d @arnilo/prism-host-builder@<installed>`). `--allow-version-mismatch` turns the error into a warning field on every result.
      - Every result is bounded (proposed 64 KiB, set in Task 13) and truncation is marked. Unknown symbols, codes or paths return a "not found" result with the nearest matches, never an exception.
    - Performance: Indexes load once, lazily. A lookup answers in under 50 ms after load (measured). The docs search builds its lexical index on first use and caches it for the process.
    - Code Quality: Plain functions in `src/lookup/*.ts`, so tests call them without MCP. `src/server.ts` only registers them. No embeddings and no model calls (the same rule as memory, release-decisions 2026-10-24). No network.
    - Security:
      - Read-only.
      - Docs resources resolve only inside `<root>/node_modules/@arnilo/` after `realpath`; a symlink escaping it is refused.
      - The `path` argument of `prism_examples` resolves only to entries in `examples.json`; anything else is "not found".
      - No tool reads arbitrary project files.
  - Approach:
    - Documentation Reviewed:
      - Task 13 (e) (MCP SDK 2.0.0 tool, resource and prompt API, via find-docs)
      - `packages/hosts/mcp-server/src/server.ts:205`, `packages/integrations/mcp/README.md` (client side, for Task 19)
    - Options Considered:
      - **A docs-only MCP server.** Rejected: it would be worse than the files the agent can already read. The server earns its place with version checks and exact lookups.
      - **Streamable HTTP.** Rejected: stdio is local with no listener, and every target agent supports it.
      - **Ranking the docs search with embeddings.** Rejected: no embeddings by project rule, and lexical search suffices for API names.
    - Chosen Approach:
      - Thin MCP registration over pure, tested lookup functions.
    - API Notes and Examples:
      ```json
      { "mcpServers": { "prism": { "command": "bunx", "args": ["prism-host-builder", "mcp"] } } }
      ```
      ```ts
      // prism_api({ symbol: "createAgent" }) →
      // { package: "@arnilo/prism", signature: "createAgent(config: AgentConfig): Promise<Agent>", docs: ["node_modules/@arnilo/prism/docs/agent.md#…"], examples: ["examples/sdk-basics.ts", …] }
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/{server.ts,lookup/api.ts,lookup/errors.ts,lookup/examples.ts,lookup/docs.ts,version.ts}` (new)
      - `packages/hosts/host-builder/bin/prism-host-builder.ts`: the `mcp` subcommand
      - `src/__tests__/{lookup,server,version}.test.ts` (new)
      - `scripts/compat-baseline/arnilo__prism-host-builder.txt`: regenerated if `src/index.ts` exports change (diff in the note)
      - README, `CHANGELOG.md`
    - References:
      - `packages/hosts/mcp-server/src/__tests__` (in-process transport pattern)
  - Test Cases to Write:
    - `prism_api_exact_and_query`, `prism_errors_known_and_unknown`, `prism_examples_path_outside_index_not_found`, `prism_docs_returns_anchored_excerpt`.
    - `version_mismatch_fails_closed` and `version_mismatch_allowed_warns`.
    - `docs_resource_symlink_escape_refused`.
    - `results_bounded_and_marked`.
    - `server_lists_tools_resources_prompts`: an in-process MCP client sees exactly the declared set.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the bin's MCP surface.
    - Docs pages to create/edit: README ("MCP server": tools, resources, prompts, version rule, bounds); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-07):
    - **What changed.** `prism-host-builder mcp [--root <dir>] [--allow-version-mismatch]` serves over stdio through `servePrismMcpStdio` (the bin imports the MCP SDK only for this subcommand, so `info` and `--help` stay light; stdin EOF, SIGINT and SIGTERM close it; a bad option exits 2).
      - Pure lookups in `src/lookup/{api,errors,examples,docs,bound,text}.ts`; `src/server.ts` only registers them (`createHostBuilderMcpServer({ root, allowVersionMismatch?, dataDir? })`, internal: `src/index.ts` exports nothing new, so there is no baseline diff); `src/version.ts` holds the version rule. The server identity reads `package.json` (the `version-literal-gate` rejects a literal).
      - Tools (all `readOnlyHint`): `prism_api({ symbol?, query?, package? })`, `prism_errors({ code })`, `prism_examples({ query?, package?, path? })`, `prism_docs({ query })`. Resources `prism-docs://<unscoped package>/<path>` (every installed `@arnilo/*` README plus the kernel's `docs/*.md`, minus the same retired pages the generator skips; the kernel README is included). Prompts `build-host({ goal? })`, `add-capability({ capability })`, `upgrade-host`.
      - `prism_errors` returns the pitfall row (what happened, fix) for a code in `references/pitfalls.md` by parsing the shipped file, so the tool and the skill cannot disagree.
      - New code `ERR_PRISM_HOST_BUILDER_VERSION` (`HostBuilderError.code` union grows). New dependencies on the package: `@modelcontextprotocol/server` 2.0.0 and `zod` ^4.6.2 (the pins `@arnilo/prism-mcp-server` uses; its entry did not re-export them) and devDependency `@modelcontextprotocol/client` 2.0.0. `bun.lock` was edited by hand for the workspace entry; `bun install --frozen-lockfile --dry-run` accepts it.
      - `references/verification.md` item 7 now names the four tools, the version rule and the prompts; the `SKILL.md` body still names no tool (Task 15's finding about `package_skills_conform` check 4). `packages/hosts/host-builder/{README,CHANGELOG}.md` and the root `CHANGELOG.md` carry the entries; `e2e-coverage.json` lists the three new suites; `data/` regenerated (532 codes; `errorsWithoutMeaningOrSample` still 181); `budgets.json` `hostBuilder` rebaselined to 404513 packed / 2037388 unpacked (Task 15's skill growth had been inside the 5% tolerance, and the data and sources now push past it).
    - **Findings for later tasks.**
      - **Path rule differs a little from the plan text.** A page is read only when its real path is a regular file inside the real `<root>/node_modules` **and** inside the real directory of its own package. A package directory that is itself a symlink is allowed if it lands inside `node_modules` (Bun's isolated linker puts packages under `node_modules/.bun/`). A workspace link that leaves `node_modules` (this repository's own `node_modules/@arnilo/*` → `packages/*`) is refused: resources are listed but a read fails, and the search skips them. Tests use a fixture root with real files.
      - **Task 17 should add tools to `createHostBuilderMcpServer`**, with its targets as new options (`HostBuilderMcpOptions`), and extend `mcp` argument parsing in `bin/prism-host-builder.ts` (`mcp()`), which currently rejects any unknown option with exit 2. The shared `answer()` wrapper in `src/server.ts` runs the version check first; check tools need it too (`checkVersion` throws `ERR_PRISM_HOST_BUILDER_VERSION`), but the check runner needs the installed version, not the index.
      - **Task 17's `entry`/`package` paths must resolve under `--root`**, which `mcp` already normalises with `resolve`. `--root` defaults to the cwd, and `installedPrismVersion(root)` reads `<root>/node_modules/@arnilo/prism/package.json`.
      - **Task 18's MCP entry** is `{ "command": "bunx", "args": ["prism-host-builder", "mcp"] }`; add `--root` only if the agent's cwd is not the project.
      - **Gate state in the shared tree (not this task).** `bun scripts/release.mjs gate` now reports the kernel `packedBytes`, `unpackedBytes`, `rootExports` and `sourceLines` ceilings as exceeded (+1931 / +6014 / +1 / +107). About 1.1 KB of the unpacked growth is this task's root CHANGELOG entry; the rest, the export and all source lines come from plan 210's uncommitted kernel edits (`src/agent-session/session/provider-round.ts` and neighbours, which also left the kernel with a missing `Message` import for a few minutes while this task ran). I did not rebaseline the kernel ceilings for another plan's growth; plan 210 owns that line. The `compat (experimental, not gated)` line about `@arnilo/prism-memory-core` is plan 209/210 too.
      - The stale `packaging.test.ts` package count (51) predated this task (Task 14 added the 52nd package); it now says 52.
    - **Baseline diff.** None. `arnilo__prism-host-builder.txt` is unchanged: the package root exports no new name.
    - **Sweep.** No name, code or config was retired or renamed; no repo-wide grep was due.
    - **Measured.** Warm lookups: exact symbol 2.2 ms, a four-word query 14.7 ms, a miss with nearest names 5.2 ms (the indexes load in about 4 ms, once); the test asserts under 50 ms. Coverage of the package: 98.6% functions, 99.6% lines (threshold 97/97).
    - **Checks run.** The package suite (41 pass: lookup, version, server over an in-memory client, and the bin over a real stdio client plus exit 2 for bad options; the in-memory test asserts exactly four tools, three prompts and the fixture's resources, the version error on all four tools, the allowed-mismatch warning, a symlink-escape read refused, and bounded/marked results), the package `tsc`, `biome check` on the package (clean), `host-builder-kit.test.ts` and `package-skills.test.ts` (35 pass), `bun scripts/package-skills-conformance.mjs`, `bun scripts/host-builder-index.mjs --check` (fresh), `host-builder-index.test.mjs` (run with `--timeout=120000`; the freshness test needs about 13 s and fails at bun's 5 s default), `version-literal-gate`, `e2e-coverage`, `packaging.test.ts` (287 pass), `bun install --frozen-lockfile --dry-run`.
    - **Not run.** The full `bun run test`, `bun run lint`, `release:gate` end to end (the budget stage is red for the reason above), and any run with a real coding agent connected. Still red from before this task: `phase24-truth` "peer policy Decision B" and `host-surface-gate` (`mcp-server/src/skill-resources.ts` imports `Skill`).

- [x] Task 17: Checking the host's own code — inspect, manifest, conformance (was plan 212 Task 5)
  - Acceptance Criteria:
    - Functional:
      - The server takes check targets only from its start flags, never from tool arguments:
        - `--entry <file>#<export>`, repeatable: an async function returning an `Agent`
        - `--package <file>#<export>`, repeatable: a package factory or definition
        - `--trust-project`
      - Tools:
        - `prism_inspect_host({ entry })`: `entry` is one of the configured names. The tool runs the factory in a child `bun` process and returns `agent.inspect()` (packages, tools, skills with `requiresTools`, hooks, slot owners, status notes) and `dispose()`s the agent.
        - `prism_check_manifest()`: runs the manifest verification `prism verify` performs, respecting `--trust-project`, and returns the structured result.
        - `prism_check_package({ package })`: runs `packageConformance` from `@arnilo/prism/testing` on the configured package and returns each check's result.
      - The child runner sets `PRISM_HOST_BUILDER_CHECK=1`. The README documents the convention that an inspection factory uses the mock provider (`mockProvider` from `@arnilo/prism/testing`) so no model is called. A run that emits any model request event fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL`.
      - When no targets are configured, these tools list as available but return a result saying how to configure targets. They never guess an entry.
    - Performance:
      - Each check is one child process with a default 30 s timeout (cap 120 s, flag `--check-timeout`) and a 1 MiB output cap.
      - On timeout the child is killed and the result says so.
      - No process outlives the call (asserted).
      - Cost knob: a check builds the host's agent once per call, at whatever cost its setup has, and this is stated in the README.
    - Code Quality: One runner (`src/check/runner.ts`) shared by the three tools. Results are typed, and the runner adds no shape of its own beyond `{ ok, result | error, timedOut, truncated }`.
    - Security:
      - **Executing host code is the trust boundary.** It happens only for paths the user passed at server start, each `realpath`ed inside `--root`. A path outside the root, or a symlink escaping it, is refused at start with `ERR_PRISM_HOST_BUILDER_ENTRY`.
      - The child's environment is an allowlist: `PATH`, `HOME`, `TMPDIR`, `PRISM_HOME` and `--pass-env NAME` additions; provider keys are absent by default.
      - Every result passes `redactSecrets` (`src/index.ts:365`). A test plants a secret in the factory's config and asserts it never appears in the result.
  - Approach:
    - Documentation Reviewed:
      - Task 13 (f); `docs/agent.md` (`inspect()`, `src/__tests__` for `AgentInspection`), `docs/testing.md` (`packageConformance`), `docs/manifest.md` (`verify`)
      - `packages/hosts/devtools/README.md` (reads `inspect()` without starting runs)
    - Options Considered:
      - **Import the entry in the server process.** Rejected: host code could hang, leak handles or mutate globals, and one bad call would take down the server.
      - **Accept entry paths as tool arguments.** Rejected: that lets any MCP caller make the server execute any file. Configuration at start keeps the user in control.
      - **Reuse devtools' JSON API.** Rejected: it needs a running agent and a listener. A one-shot child is simpler and leaves nothing running.
    - Chosen Approach:
      - User-configured targets, a bounded child process, an environment allowlist, and redacted typed results.
    - API Notes and Examples:
      ```bash
      bunx prism-host-builder mcp --entry src/agent.ts#createInspectionAgent --package src/my-package.ts#default
      ```
      ```ts
      // src/agent.ts (host convention)
      export async function createInspectionAgent() {
        return createAgent({ model: "mock/demo", packages: [mockProvider(), ...hostPackages()] });
      }
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/check/{runner.ts,child.ts,inspect.ts,manifest.ts,conformance.ts}` (new); `src/server.ts`; `bin/prism-host-builder.ts` (flags)
      - `src/__tests__/check-*.test.ts` and fixtures (new)
      - README ("Checking your host"), `CHANGELOG.md`
    - References:
      - `src/testing/index.ts` (`packageConformance`, `mockProvider`); `src/cli-manifest.ts` (`verify`)
  - Test Cases to Write:
    - `inspect_host_returns_inspection`, `inspect_host_secret_never_in_result`.
    - `inspect_host_timeout_kills_child`: a fixture factory hangs.
    - `entry_outside_root_refused_at_start`, `entry_not_configured_returns_guidance`.
    - `check_model_call_fails`: a fixture factory runs a turn on a real-shaped provider stub.
    - `check_env_allowlist`: a variable outside the allowlist is absent in the child.
    - `check_package_reports_conformance_failures`, `check_manifest_respects_trust_flag`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — bin flags and three tools.
    - Docs pages to create/edit: README ("Checking your host": the factory convention, flags, environment allowlist, cost); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-07):
    - **What changed.** `prism-host-builder mcp` takes `--entry`/`--package` (`<file>#<export>`, repeatable), `--trust-project`, `--check-timeout <seconds>` and `--pass-env <NAME>` (repeatable); a bad value exits 2, a bad target exits 1 with `ERR_PRISM_HOST_BUILDER_ENTRY` before the server starts. `createHostBuilderMcpServer` gains `entries`, `packages`, `trustProject`, `checkTimeoutSeconds`, `passEnv` (internal: `src/index.ts` exports nothing new, so no baseline diff) and registers `prism_inspect_host({ entry })`, `prism_check_manifest()` and `prism_check_package({ package })`. They list always and return a `guidance` field naming the flag when no target is configured; an unknown name returns the configured names. The four lookup tools stay `readOnlyHint`; the three check tools declare `readOnlyHint: false, openWorldHint: true` and say in their descriptions that they execute host code.
      - New files `src/check/{runner,child,targets,inspect,manifest,conformance}.ts`. `runner.ts` (`runCheck`, `childEnv`) is the one runner: `{ ok, result | error, timedOut, truncated }` and nothing else. The child is `bun src/check/child.ts <kind> <resultFile> [<file> <export>]`, spawned `detached` with cwd = `--root`, so the whole process group is killed on timeout and again after exit (asserted with a `sleep` grandchild). The result returns through a temp file, so host stdout cannot corrupt it; stdout/stderr and the file are capped at 1 MiB and the cap sets `truncated`. The child resolves `@arnilo/prism/testing` and `/manifest` from the **project** (`createRequire(<root>/noop.js)`), so a check uses the host's installed kernel.
      - Model-call refusal: the kernel has no global event tap an outside observer can use, so the child (1) replaces `globalThis.fetch` with a function that records the URL (query stripped) and throws, and (2) after the factory returns, counts `agent.sessions.list()`; either fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL` and the agent is still disposed. A provider that reaches a model without `fetch` and without a session is not caught; the README says the factory must run nothing.
      - `ERR_PRISM_HOST_BUILDER_ENTRY` and `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL` are new `HostBuilderError` codes. `src/errors.ts` now declares each code as a documented constant (the generator reads a meaning from a doc comment on a `const X = "ERR_PRISM_…"` line; a multi-line union put the quoted codes outside its five-line window, and the kit test failed with "has no meaning"). `data/` regenerated (534 codes).
      - `references/verification.md` items 6 and 7 name the three tools, the start flags, the mock-provider rule and the result shape. README has "Checking your host" and the Security bullets; both CHANGELOGs carry the entry; `e2e-coverage.json` lists the two new suites.
    - **Decisions that differ from the research note (f).**
      - **No `--allow-exec`.** Task 17's criteria make the start flag the consent (a path is executable only if the user passed it at start, inside `--root`), so there is no second flag.
      - **`HOME` is the real one**, not a throwaway directory: the criteria's allowlist names `HOME`, and `prism_check_manifest` needs the user scope (`~/.prism`, or `PRISM_HOME`). The consequence is that a host factory can read the user's home; the README says the allowlist bounds the child and does not sandbox it.
      - **Timeout unit.** `--check-timeout` is seconds.
      - **Redaction** masks the `--pass-env` values (length ≥ 6) with `redactSecrets` in every returned string, on top of the agent's own redaction (secret fields show their ref). Other secrets in host code are not known to the runner.
      - `prism_check_package` on a package that fails conformance is `ok: true` with `result.ok: false` and the failing checks (the check ran); a package whose config schema is itself invalid surfaces as `ok: false` with the kernel's error code (`config_schema_unsupported`).
    - **Findings for later tasks.**
      - **Task 18/19:** the MCP entry the installer writes needs no check flags (they are optional and user-chosen); Task 19's demo that spawns the server with start flags can pass `--entry src/agent.ts#createInspectionAgent`. Tests that run a check need a project whose `node_modules/@arnilo/prism` resolves to the kernel; `src/__tests__/fixture.ts` `checkRoot()` symlinks it to the repository.
      - **Budget.** The tarball is 414,633 packed / 2,070,782 unpacked / 153 files, +2.5% / +1.6% over the Task 16 baseline and inside the 5% tolerance, so `budgets.json` `hostBuilder` was not rebaselined.
    - **Baseline diff.** None (`arnilo__prism-host-builder.txt` unchanged: the package root exports no new name).
    - **Sweep.** No name, code or config was retired or renamed; no repo-wide grep was due.
    - **Checks run.** Package suite (57 pass: runner env allowlist, timeout kill with a grandchild, leftover process kill, output cap, early-exit tail with masked value, oversized result, ENTRY failures, inspection, planted-secret redaction, entries outside root/symlink/missing refused, guidance without targets, model-call and fetch refusal, conformance failures, manifest trust flag with a real project install, and the bin over stdio with the new flags plus exit 2 for bad ones); package `tsc`; `biome check` on the package (clean); coverage 97.8% functions / 98.8% lines (threshold 97/97; the child file runs in a subprocess so it is not counted); `host-builder-kit.test.ts` and `package-skills.test.ts`; `scripts/package-skills-conformance.mjs`; `host-builder-index.mjs --check` (fresh) and `host-builder-index.test.mjs`; `e2e-coverage.test.mjs`; `version-literal-gate.test.mjs`; `packaging.test.ts` (287 pass).
    - **Not run.** The full `bun run test`, `bun run lint`, `release:gate` end to end, and any run with a real coding agent connected or a real provider-backed host. Still red from before this task: `phase24-truth` "peer policy Decision B" and `host-surface-gate` (`mcp-server/src/skill-resources.ts` imports `Skill`).

- [x] Task 18: The installer (was plan 212 Task 6)
  - Acceptance Criteria:
    - Functional:
      - `prism-host-builder install --target <t> [--mcp] [--root <dir>] [--force] [--dry-run]`. Targets come from Task 13 (d): `claude`, `codex`, `cursor`, `agents` (generic `.agents/skills`, which Prism's `contextFiles` also discovers), and `prism`.
      - It copies `skills/prism-host-builder/` into the target's project skill directory.
      - With `--mcp` and a JSON config target, it merges `{ prism: { command: "bunx", args: ["prism-host-builder", "mcp"] } }` under the target's server key, preserving every other key and the file's formatting style (2-space JSON). For a non-JSON target it prints the exact snippet and the file it belongs in, and writes nothing.
      - For `prism`, it prints the `@arnilo/prism-context-files` and `@arnilo/prism-mcp` packages a Prism builder agent lists (the config has no `skills.dirs`; the default `skills.roots` already include `.agents/skills`).
      - Each install writes a `.prism-host-builder.json` stamp next to the copied skill (version and content hash). A re-install of the same version is a no-op. A different version replaces the skill only if the on-disk files still match the old stamp's hash, so local edits are never silently overwritten; otherwise it fails with `ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT` unless `--force` is given.
      - An existing `prism` server entry in the config that differs is a conflict under the same rule.
      - `--dry-run` prints the plan and writes nothing.
    - Performance: Local file copies only; under 1 s.
    - Code Quality: Targets are a table of `{ skillDir, config?: { file, key, format } }` in one file, so adding a target is one row. No TOML or YAML dependency.
    - Security:
      - Writes only inside `--root` (realpath-checked).
      - Never writes user-global config.
      - Never writes a secret: the entry has no env and no token.
      - A malformed existing JSON config is refused (`ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG`), never rewritten.
  - Approach:
    - Documentation Reviewed:
      - Task 13 (d) (target conventions, dated); plan 190 Task 5 (`contextFiles` skill roots)
    - Options Considered:
      - **Kernel `prism skills install`.** Rejected: the kernel CLI manages the package manifest; copying a third package's skill into vendor agents' config is that package's job, and kernel growth needs proof that a package cannot do it.
      - **Write user-global config (`~/.claude`, `~/.codex`).** Rejected: the kit is version-exact per project, and a global install would serve one project's version to all of them.
    - Chosen Approach:
      - A project-scoped, table-driven installer with conflict detection by content stamp.
    - API Notes and Examples:
      ```bash
      bunx prism-host-builder install --target claude --mcp
      bunx prism-host-builder install --target codex --mcp --dry-run   # prints the TOML snippet if Codex config is TOML
      ```
    - Files to Create/Edit:
      - `packages/hosts/host-builder/src/install/{targets.ts,install.ts}` (new); `bin/prism-host-builder.ts`
      - `src/__tests__/install.test.ts` (new)
      - README ("Installing into your coding agent"), `CHANGELOG.md`
    - References:
      - `packages/context/files/src/skills.ts:47` (Prism's discovery roots)
  - Test Cases to Write:
    - `install_copies_skill_per_target`.
    - `install_merges_mcp_json_preserving_entries`.
    - `install_non_json_target_prints_snippet_writes_nothing`.
    - `install_same_version_noop`, `install_upgrade_replaces_unmodified`, `install_local_edits_conflict`, `install_force_overwrites`.
    - `install_malformed_config_refused`, `install_outside_root_refused`, `install_dry_run_writes_nothing`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a CLI subcommand that writes files.
    - Docs pages to create/edit: README; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-07):
    - **What changed.** `prism-host-builder install --target <claude|codex|cursor|agents|prism> [--mcp] [--root <dir>] [--force] [--dry-run]`. New `src/install/targets.ts` (the table: `{ skillDir, config?: { file, format, key } }`, one row per target, plus `SERVER_NAME = "prism"` and `SERVER_ENTRY`) and `src/install/install.ts` (`installHostBuilder`, `describeInstall`); `bin/prism-host-builder.ts` gains `install` (bad or missing option/target exits 2; an `ERR_PRISM_HOST_BUILDER_INSTALL_*` failure exits 1). Neither is exported from `src/index.ts`, so no baseline diff.
      - Targets: `claude` → `.claude/skills` + `.mcp.json`; `cursor` → `.agents/skills` + `.cursor/mcp.json`; `codex` → `.agents/skills` + `.codex/config.toml` (snippet only); `agents` and `prism` → `.agents/skills`, no config. `prism` always prints the packages snippet; `agents --mcp` prints that it has no MCP configuration.
      - The stamp `.prism-host-builder.json` holds `{ package, version, contentHash, files }`. The hash covers the shipped files (path, size, bytes), and "unmodified" means the files the stamp lists still hash to the stamp's value. Same version and hash is a no-op (a locally edited copy is left alone, `--force` overwrites it). A different version replaces the copy only if unmodified, removes files the old stamp listed and the new skill dropped, and writes the stamp last. A directory with no stamp (and not empty) is a conflict; `--force` overwrites the files it ships and deletes nothing else.
      - JSON merge parses the file, adds `mcpServers.prism`, re-serialises with the detected indent, line ending and trailing newline, and re-parses the result to check that only that key changed (the "parse check after"). Plain JSON only: comments, an empty file, a non-object root or a non-object `mcpServers` are `ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG` and the file is untouched.
      - Containment: `containedPath` walks the project-relative path component by component, resolves each symlink and requires the result inside the root's realpath; a dangling symlink is refused. Conflicts for the skill and the config are all found before the first write (asserted: a config conflict leaves no `.claude/`).
      - Three new `HostBuilderError` codes: `ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT`, `_INSTALL_CONFIG`, `_INSTALL_ROOT` (the plan named the first two; a path outside the root needed its own). `data/` regenerated (537 codes).
      - README "Installing into your coding agent" (target table, stamp rules, boundaries); both `CHANGELOG.md` files; `scripts/e2e-coverage.json` lists `install.test.ts`.
    - **Decisions that differ from the plan text.**
      - **`skills.dirs` does not exist.** The context-files config key is `skills.roots`, and its defaults already include `.agents/skills`, so the `prism` target prints the `contextFiles` and `mcp` packages and no skills config. The criterion was amended above.
      - **One copy under realpath, a warning across directories.** `.claude/skills` → `.agents/skills` resolves to one directory, so installing both targets shares a copy and reports `unchanged`. Two distinct directories can both hold a copy (Claude Code reads only `.claude/skills`, so refusing would break it); the second install adds a note that Cursor will list the skill twice. It does not block.
      - **Formatting is "re-serialised with the file's indent", not byte-preserving.** An array that the file wrote on one line is expanded by `JSON.stringify`. Keys, values and order are kept. A byte-exact splice was judged not worth the parser.
    - **Findings for later tasks.**
      - **Task 19:** the MCP entry has no check flags; the demo adds `--entry` by hand (README says so). The installer is callable as `bunx prism-host-builder install --target prism --root <dir>` for the example's walkthrough, and `describeInstall`'s snippet for `prism` is the shape the example can quote.
      - The tarball is 155 files at about 2.1 MB unpacked, inside the `hostBuilder` budget tolerance (not rebaselined; the pack's listed size moved with the installer sources and README).
    - **Baseline diff.** None for `@arnilo/prism-host-builder` (`src/index.ts` exports nothing new).
    - **Sweep.** No name, code or config was retired or renamed; no repo-wide grep was due.
    - **Checks run.** `install.test.ts` (20 tests: copy per target, JSON merge with a 4-space file, missing config, identical/different entry, TOML snippet, `prism`/`agents`, same-version no-op, upgrade with a dropped file, local-edit conflict, force, malformed configs including comments and empty, symlink and dangling-link outside the root, in-root symlink, duplicate warning, dry run, conflict-before-write, target table, and the bin: exit 0, exit 2, exit 1 with code, `--dry-run`); package suite 77 pass; package `tsc`; `biome check` clean; coverage 98.05% functions / 98.86% lines (threshold 97/97); `host-builder-index.mjs --check` fresh after regenerating; `host-builder-index.test.mjs`, `e2e-coverage.test.mjs`; `host-builder-kit.test.ts`, `package-skills.test.ts`, `packaging.test.ts` (322 pass); `package-skills-conformance.mjs`.
    - **Not run.** The full `bun run test`, `bun run lint`, `release:gate` end to end, and an install driven by a real Claude Code, Codex or Cursor session. Red from before this task and unchanged: `phase24-truth` "peer policy Decision B" and `host-surface-gate` (`mcp-server/src/skill-resources.ts` imports `Skill`). The `host_builder_index_is_fresh` test passes with `--timeout=60000`; under the default 5 s it timed out once in a parallel run.

- [x] Task 19: A Prism agent as the builder — example and walkthrough (was plan 212 Task 7)
  - Acceptance Criteria:
    - Functional:
      - `examples/host-builder-agent.ts` builds a Prism agent on the mock provider with:
        - `tools-coding` (root: a temp copy of `examples/example-workspace` or a new fixture workspace)
        - `contextFiles`, which discovers the installed `prism-host-builder` skill under `.agents/skills`
        - `@arnilo/prism-mcp`, connected to `prism-host-builder mcp` over stdio
      - A scripted turn loads the skill, calls `prism_api({ symbol: "createAgent" })` and `prism_inspect_host`, and prints the results.
      - `apps/prism-agent/README.md` gains a short "Building a host with an agent" section pointing to the package and the example. The reference host's code does not change.
      - Root `README.md` gains one line under its host-building section linking the package.
    - Performance: The example spawns one MCP server and one check child and exits within the example gate's timeout.
    - Code Quality: Public surface only. The example is listed in `examples/README.md` and `scripts/e2e-coverage.json`.
    - Security: No secret in output (`examples_demos_run_to_completion_and_emit_no_secret`). The MCP server is spawned with the start flags of Task 17, never from model output.
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/mcp/README.md` (stdio client config, trust), `packages/context/files/README.md`, `examples/connected-slack-mcp.ts`, `examples/mcp-trust.ts`
    - Options Considered:
      - **Make the reference host itself a builder.** Rejected: the reference host proves the SDK for product-shaped hosts; a builder is a developer workflow, and an example demonstrates it without widening the host.
    - Chosen Approach:
      - One example under the execution gate, plus pointers from the two guides hosts already read.
    - API Notes and Examples:
      ```bash
      timeout 180 bun examples/host-builder-agent.ts
      ```
    - Files to Create/Edit:
      - `examples/host-builder-agent.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`
      - `apps/prism-agent/README.md`, `README.md`
      - `packages/hosts/host-builder/data/examples.json` (regenerated: the new example)
      - `CHANGELOG.md`
    - References:
      - `examples/mcp-server.ts`, `examples/discover-skills.ts`
  - Test Cases to Write:
    - The example runs under the execution gate.
    - `host_builder_index_is_fresh` stays green after regeneration.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API.
    - Docs pages to create/edit: `apps/prism-agent/README.md`, `README.md`, `examples/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no (the walkthrough and package are already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-07):
    - **What changed.** New `examples/host-builder-agent.ts`. It builds a temp host project (a `src/agent.ts` factory on the mock provider, `node_modules/@arnilo/prism` symlinked to the repository, as `checkRoot()` does in the package tests), runs `prism-host-builder install --target prism --root <dir>` through the bin, then builds the builder agent: `toolsCoding({ root })`, `contextFiles({ root })` and `mcp({ servers: [{ id: "host-builder", transport: "stdio", command: <bun>, args: [<bin>, "mcp", "--root", <dir>, "--entry", "src/agent.ts#createInspectionAgent"], allow: "stdio" }] })`. A scripted mock turn calls `load_skill("prism-host-builder")`, `mcp:host-builder:prism_api({ symbol: "createAgent" })` and `mcp:host-builder:prism_inspect_host({ entry })`; the demo asserts the skill was discovered, the three results are real (skill text, `found` with `createAgent`, `ok` inspection) and prints a compact JSON summary. The whole run takes about 1 s with one MCP server and one check child. The MCP command, root and `--entry` are fixed in host code, never from model output.
    - Docs: `apps/prism-agent/README.md` "Building a host with an agent" (the reference host's code is unchanged), a link line in the root `README.md` "Where next" (there is no separate host-building section), `examples/README.md`, `CHANGELOG.md`.
    - Wiring: the example joins the `demos` list in `src/__tests__/docs.test.ts` (`examples_demos_run_to_completion_and_emit_no_secret`) with a result assertion, and `scripts/e2e-coverage.json` lists it under `@arnilo/prism-host-builder`. `bun scripts/host-builder-index.mjs` regenerated `data/examples.json` (110 examples); `--check` is fresh.
    - **Findings for later tasks.**
      - **Task 20:** the `skill+mcp` arm can reuse this wiring as is (`mcp` stdio entry with the bin path, `contextFiles`, `toolsCoding`); `allow: "stdio"` is enough for a code-sourced server, so no host-ui prompt is involved. The example resolves the bin with `createRequire(import.meta.url).resolve("@arnilo/prism-host-builder")` because the package exports only `.`.
      - `--target prism` prints the packages snippet and copies only the skill. The MCP server is wired by the host, as the example shows, not by the installer.
    - **Baseline diff.** None (no export added).
    - **Sweep.** No name, code or config was retired or renamed; no repo-wide grep was due.
    - **Checks run.** The example directly (`bun examples/host-builder-agent.ts`) and under the gate (`examples_demos_run_to_completion_and_emit_no_secret` plus the examples README listing test, 2 pass); `tsc -p examples/tsconfig.json`; `biome check` on the example, the docs test and `e2e-coverage.json`; `host-builder-index.mjs --check` (fresh); `host-builder-index.test.mjs`, `e2e-coverage.test.mjs`, `host-builder-kit.test.ts`, `indexes.test.ts`.
    - **Not run.** The full `bun run test`, `bun run lint`, `release:gate` end to end, and a run with a real provider. Red from before this task and unchanged: `phase24-truth` "peer policy Decision B" and `host-surface-gate`.

- [x] Task 20: Builder evaluation and claims (owner gate, paid) (was plan 212 Task 8)
  - Acceptance Criteria:
    - Functional:
      - `scripts/host-builder-evals/criteria.json` is committed before any paid run. It defines:
        - 6–8 fixture tasks under `scripts/host-builder-evals/workspaces/`, from Task 13 (c), for example:
          - create a minimal headless host
          - gate coding writes with approval
          - add SQLite persistence with resume
          - serve the agent over ACP
          - add `memory-compaction` with the `compaction` slot assigned (the experimental memory packages are left out of builder claims; the skill's `choosing.md` names them as experimental)
          - write a package with a conformance test
          - upgrade a 0.12-shaped host to 0.13
        - per task, hidden acceptance tests the builder never sees
        - scorers:
          - `typecheck_passes`
          - `acceptance_tests_pass`
          - `public_surface_only` (the reference-host allowlist check applied to the workspace)
          - `no_retired_names`
          - tool-call and token cost
        - arms: `none`, `skill`, `skill+mcp`
        - the builder: a Prism agent with `tools-coding` (shell enabled inside the workspace), `contextFiles`, and `@arnilo/prism-mcp` in the `skill+mcp` arm
        - trials: 3 per item
        - claim rules:
          - a claim ("the skill improves X", "the MCP server improves X over the skill") is published only when `compareExperiments` shows a significant improvement at alpha .05
          - a significant regression in any arm against `none` blocks the plan until that component is fixed and re-measured once; if it still regresses, the owner decides and the decision is recorded
      - `scripts/host-builder-evals/run.mjs` runs offline (scripted provider: checks fixtures, hidden tests and scorer wiring) and live. The live run uses Hyper and OpenCode Go only, after the owner approves a dry-run cost estimate recorded in the task note.
      - The evidence is written to `docs/_evidence/host-builder/212/`. The README's "What it changes" states only the passed claims, each linked to its evidence.
    - Performance: The offline suite runs in under 120 s. The live run reports cost and wall time per arm.
    - Code Quality: Reuses `@arnilo/prism-evals` (`runExperiment`, `compareExperiments`) and Task 11's skill-eval runner structure, with no new statistics code. Workspaces are fixtures, outside every tarball.
    - Security: Builders run in temp copies of the workspaces with `tools-coding` rooted there and approval auto-allowing only inside the root. No network tool is loaded. Keys come from `scripts/live.env` refs, and the evidence passes a no-secret assertion.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md` ("Experiments", "Comparing two runs", "Gating a release"); Task 11; `docs/live-testing.md`
    - Options Considered:
      - **Use Claude Code or Codex as the builder.** Rejected for the gate: it needs a vendor adapter Prism does not ship (roadmap §2.12, hosts write adapters) and a user subscription. A Prism builder on the release providers is reproducible. The kit itself targets those agents through the installer.
      - **No eval; ship on review.** Rejected: the repo publishes no capability claim without measured evidence.
    - Chosen Approach:
      - Hidden-test grading on fixture workspaces, three arms, pre-registered claim rules.
    - API Notes and Examples:
      ```bash
      timeout 600 bun scripts/host-builder-evals/run.mjs --offline
      timeout 3600 bun scripts/host-builder-evals/run.mjs --live --providers hyper,opencode-go
      ```
    - Files to Create/Edit:
      - `scripts/host-builder-evals/{criteria.json,run.mjs,run.test.mjs}` (new), `scripts/host-builder-evals/workspaces/**` (new)
      - `docs/_evidence/host-builder/212/*` (new, evidence)
      - `packages/hosts/host-builder/README.md` (claims), `docs/live-testing.md`, `CHANGELOG.md`
    - References:
      - `scripts/host-surface-allowlist.json`, `src/__tests__/reference-host-boundary.test.ts` (`public_surface_only`)
  - Test Cases to Write:
    - `host_builder_eval_criteria_preregistered`.
    - `host_builder_eval_offline_runs_every_workspace`.
    - `hidden_tests_not_in_builder_workspace`: the builder's copy contains no acceptance test file.
    - `host_builder_eval_evidence_contains_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; published claims.
    - Docs pages to create/edit: package README (claims with evidence links); `docs/live-testing.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Progress (2026-11-07, harness built; the paid run waits for the owner, so this task stays open):
    - **Done.** `scripts/host-builder-evals/` holds `criteria.json` (7 tasks, arms `none`/`skill`/`skill+mcp`, scorers, trials 3, seed 212, claim rules at alpha .05, Hyper and OpenCode Go), `criteria.lock.json` (registered 2026-11-07; pins the criteria hash and the hashes of the workspaces, hidden tests, oracle solutions, the skill and the indexes), `lib.mjs`, `run.mjs`, `run.test.mjs`, `README.md`, `workspaces/` (`_common` plus one seed per task), `hidden/<task>.test.ts` and `solutions/<task>/`. `docs/live-testing.md` has a "Host-builder evaluation" section and `CHANGELOG.md` an entry. `scripts/skill-evals/run.mjs` now exports `liveProvider`, which `run.mjs` reuses with `allowedProviders`, `sealEvidence` and `fullRunEstimate`; no new statistics code (`runExperiment`, `compareExperiments`).
    - **Tasks.** `headless-host`, `approval-ask`, `sqlite-resume`, `acp-serve`, `compaction-slot` (the seed already holds a package that claims `compaction`, so the builder must assign the slot), `package-conformance` (the builder also writes and passes its own test) and `upgrade-0-12`. Each seed fails its hidden test and each oracle solution passes all four scorers (`host_builder_eval_graders_reject_a_do_nothing_builder_and_accept_the_oracle`).
    - **Checks run.** `bun test scripts/host-builder-evals/run.test.mjs`: 14 pass in about 20 s (`host_builder_eval_criteria_preregistered`, `host_builder_eval_offline_runs_every_workspace` under 120 s, `hidden_tests_not_in_builder_workspace`, `host_builder_eval_evidence_contains_no_secret`, plus the arm-difference, shell-sees-no-key, surface and retired-name rules, three claim-rule tests, arguments and evidence shape). `--offline` takes about 14 s and the oracle passes every scorer in all three arms, with the skill loaded in 7/7 runs of each skill arm and the MCP lookup used in 7/7 of `skill+mcp`. The test file is in `run-all-tests.mjs` `GATE_FILES` and `e2e-coverage.json`. `run-all-tests`, `e2e-coverage`, `live-matrix`, `live-doc-check`, `scan-secrets`, `import-hygiene` and `host-builder-index` tests, `docs.test.ts` and `host-builder-kit.test.ts` pass; `biome lint` is clean on the new files.
    - **Findings that shaped the harness.**
      - The coding tools refuse a path that resolves outside the project, including through a symlinked `node_modules/@arnilo/prism`, so a builder could not read the docs. Each trial gets a staged install: real copies of the kernel and every published package (without tests and `docs/_evidence`), and symlinks to the other dependencies. The `none` arm's tree has no host-builder package, so the arms differ only by the kit.
      - `tsc` also reports errors inside the installed TypeScript sources (`store-sqlite`, `acp`) under the project's stricter settings. `typecheck_passes` ignores diagnostics inside `node_modules`.
      - The `tool.call` hook payload field is `args`, not `arguments`; a denied call surfaces as a tool-result error and not as a `tool.completed` event. The hidden tests read the request the provider received.
      - The builder's shell inherits no key from the process (`pickSpawnEnv` allow-list); a test sets fake keys and asserts the shell's `env` shows none.
    - **Choices for the owner to confirm.**
      - **Providers.** The task text says Hyper and OpenCode Go only; Task 11's later owner decision (2026-11-05) also allowed the free OpenRouter, Kilo and Command Code models. The harness follows the task text. Widening the set means a `providers` entry in `criteria.json` and a re-register.
      - **Natural loading.** The builder is not told to load the skill (the skill arm lists it in the catalog). The evidence reports how often it loaded the skill and used the MCP tools and splits acceptance by loading. Task 11 found natural recall low, so `skill` may show no effect for that reason; a `--preload` variant like Task 11's can be added before the run if the owner wants that question answered.
      - **MCP server flags.** `skill+mcp` starts the server without `--entry`, so the lookup tools are measured and the check tools are not.
      - **Cost.** 7 tasks x 3 arms x 3 trials = 63 builder runs per provider, each a multi-turn coding session (limits: 50 tool rounds, 2M input tokens, 15 min). The dry run (`headless-host`, `acp-serve`, `upgrade-0-12`, one trial, three arms) scales to a per-arm full-run estimate in `docs/_evidence/host-builder/212/<provider>.dry-run.md`.
    - **Remaining (needs the owner).** (1) Commit `scripts/host-builder-evals`, `docs/live-testing.md`, the skill and indexes as registered. (2) Approve the dry run on Hyper, run it, record the estimate here. (3) Approve the full cost; run `--live --providers hyper,opencode-go`; if any arm regresses against `none`, fix that component and re-measure once (`--round 2`). (4) Write the passed claims into `packages/hosts/host-builder/README.md` "What it changes", each linked to its evidence file, and mark this task `[x]`. Until then the README states no claim.

  - Dry run and preload variant (2026-11-07, owner decisions: free models of OpenRouter, Kilo and Command Code for the dry run; `Qwen/Qwen3.7-Flash` (paid, Command Code) only if the free models leave a comparison undecidable; a preload variant for the skill):
    - **Harness changes.** `criteria.json` lists Hyper, OpenCode Go, OpenRouter, Kilo and Command Code (re-registered; the lock now pins this version), `builder.preloadInstruction` and a `loadings` section. `run.mjs --preload` tells the `skill` and `skill+mcp` builders to load the skill first (the `none` arm is unchanged); evidence gets the `.preload` suffix and a `loading` field. A live run now goes through a rate-limit-aware `fetch` (`installRateLimitedFetch`: 3.2 s spacing on `openrouter.ai`, waits for `Retry-After` or `X-RateLimit-Reset` on a 429 and retries, gives up on a wait over 90 s, i.e. a daily cap). The evidence table shows the error text of unscored runs. Tests: 17 pass in `run.test.mjs` (preload only on the skill arms, provider allow-list, rate-limit wrapper).
    - **Defect found and fixed in `@arnilo/prism-context-files`.** A `grep` or `glob` whose `path` named a single file made the nested-`AGENTS.md` hook `stat('<file>/AGENTS.md')`, which throws `ENOTDIR` and failed the run with a `context.build` hook error. It ended 5 of 9 Kilo builder runs and the whole OpenRouter skill arm of the first dry run. The hook now uses the file's directory for these tools and treats `ENOTDIR` as absent (`nested.ts`; regression test `nested_grep_or_glob_on_a_file_uses_its_directory_and_never_fails_the_run` fails without the fix; package suite 52 pass; both CHANGELOGs).
    - **Providers.**
      - Command Code: `reflection/beam:free` cannot be used (400 `Missing required parameter: messages[n].reasoning_content` after the first tool round: the model needs every earlier assistant message's reasoning replayed). `stealth/glyph-cluster:free` completes real runs and is the registered default. All 9 dry-run builder runs scored in both loadings.
      - OpenRouter: `nvidia/nemotron-3-ultra-550b-a55b:free` is limited to 20 requests a minute (the first dry run lost every skill-arm run to 429s); with the throttle and the context-files fix all 9 runs scored. No daily cap was hit in about 600 requests.
      - Kilo: `nvidia/nemotron-3.5-super-vl:free` is capped at **200 requests per hour** (429, the wait is longer than 90 s). The run needs about 60 requests per builder run, so 63 runs per mode is about 3,800 requests, roughly 19 hours. Kilo's evidence (`kilo.dry-run.*`) predates the context-files fix and is inconclusive (4 runs hit the bug, 3 hit the hourly cap); it was not re-run. Recommendation: drop Kilo from the scored run.
    - **Dry-run results (3 tasks x 3 arms x 1 trial each; n is too small to read effects, it proves the harness and sizes the run).**
      | Provider, loading | none / skill / skill+mcp acceptance | Skill loaded | MCP used | Verdict |
      | --- | --- | --- | --- | --- |
      | Command Code glyph, natural | 3/3 / 2/3 / 3/3 | 3/3, 3/3 | 3/3 | no-claims |
      | Command Code glyph, preload | 2/3 / 2/3 / 1/3 | 3/3, 3/3 | 3/3 | no-claims |
      | OpenRouter nemotron-ultra, natural | 0/3 / 0/3 / 1/3 | 0/3, 0/3 | 2/3 | no-claims |
      | Kilo nemotron-3.5-super, natural | pre-fix, 4 of 9 unscored | | | inconclusive |
      The harness discriminates: failing builders import `@arnilo/prism/src/...` internals (`public_surface_only` 0.33) and write tests with an undeclared `test` global. Natural loading differs by model: glyph loaded the skill every time, nemotron never did, which is why the preload variant matters.
    - **Full-run size (21 builder runs per arm, 63 per provider and loading; scaled from the dry runs, all free so cost is 0).**
      | Provider, loading | Input tokens (cached) | Output tokens | Wall time at concurrency 1 |
      | --- | --- | --- | --- |
      | Command Code glyph, natural | 24M (20M) | 0.56M | about 3.6 h |
      | Command Code glyph, preload | 34M (31M) | 0.60M | about 3.8 h |
      | OpenRouter nemotron-ultra, natural | 91M (81M) | 0.33M | about 2.9 h (throttle included) |
      Qwen3.7-Flash has no price in the provider's static catalog and none in the Task 11 evidence, so its cost cannot be stated from the repository; the token volumes above are what it would be priced on (expect 25-35M input, mostly cached, 0.6M output per mode).
    - **Remaining (needs the owner).** (1) Commit `scripts/host-builder-evals`, `docs/live-testing.md`, the context-files fix and the dry-run evidence. (2) Approve the scored runs: Command Code glyph and OpenRouter nemotron-ultra, each natural and preload (`--live --providers commandcode,openrouter [--preload]`, about 13 h of wall time in all, free), Kilo dropped. (3) If a comparison stays undecidable on the free models, approve `Qwen/Qwen3.7-Flash` (paid) on Command Code and its price. (4) Round 2 if a regression blocks, then the README "What it changes" with the passed claims, and mark the task `[x]`.

  - Update 2026-11-08 (free tiers ruled out; owner switched to Ollama Cloud):
    - **What happened to the scored free runs.** The first scored attempts (OpenRouter nemotron, Command Code glyph, natural and preload) produced no usable evidence and their files were deleted: OpenRouter's free tier allows 1,000 requests a day (51 of 54 builder runs came back 429 "Daily quota exhausted"), Command Code's free Glyph Cluster allows 1,000 a day (all 54 runs of both modes 429), and the dry runs, a smoke and one killed attempt had already used both quotas. A scored mode needs about 3,800 requests, so no free tier can carry it in under days; Kilo's 200 an hour was already out. The runs were also lost once to a session restart; later runs are started with `setsid` so they outlive the session.
    - **Owner decision (2026-11-08).** Do not use `Qwen/Qwen3.7-Flash` (it would run out too). Use three paid Ollama Cloud models: `gpt-oss` (taken as `gpt-oss:120b`, the 20b is also listed), `beam` and `gemma4:31b`. `criteria.json` registers them as `ollama-gpt-oss`, `ollama-beam` and `ollama-gemma4` on the `ollama-cloud` provider (`OLLAMA_API_KEY`); OpenRouter, Kilo and Command Code were removed from the allowed set (their dry-run evidence stays). `scripts/skill-evals/run.mjs` `liveProvider` now accepts an entry that names its provider package, so one provider carries several models. Lock re-registered.
    - **Ollama Cloud dry runs** (3 tasks x 3 arms x 1 trial, natural loading; `docs/_evidence/host-builder/212/ollama-*.dry-run.*`). A builder run takes about a minute, so a mode of 63 runs is about an hour per model.
      | Model | none / skill / skill+mcp acceptance | Skill loaded | MCP used | Note |
      | --- | --- | --- | --- | --- |
      | `gemma4:31b` | 0/3, 2/3, 2/3 | 3/3, 3/3 | 3/3 | the clearest signal, typecheck 3/3 everywhere |
      | `beam` | 0/3 in every arm | 3/3, 1/3 | 1/3 | explores for ~19 turns, then ends without writing the file (a transcript confirms this is the model, not the harness) |
      | `gpt-oss:120b` | 0/2, 0/3, 0/3 | 0/3, 0/3 | 1/3 | one run lost to a transient `Internal Server Error` (unscored, so the verdict is inconclusive) |
      Models differ widely in whether they finish the task; a weak model can floor every arm at 0 and leave nothing to compare, which the claim rules report as no claim rather than hide.
    - **Remaining.** (1) Commit the changes made since the last commit (`criteria.json`, the lock, the docs, the Ollama dry-run evidence, `scripts/skill-evals/run.mjs`); a `--live` run refuses to start otherwise. (2) Run `--live --providers ollama-gemma4,ollama-beam,ollama-gpt-oss` (one process per model, in parallel), natural and then `--preload`; read the verdicts; round 2 if a regression blocks. (3) Write the passed claims into `packages/hosts/host-builder/README.md` "What it changes" with evidence links and mark this task `[x]`.

  - Closing note (2026-11-08, owner decision: close as no claims; scored runs on `gemma4:31b` only for kit-v2):
    - **Why the skill and MCP did not help in kit-v1 (owner asked for the investigation).** Compared each failing task with what the kit says and read builder transcripts:
      - Builders open the examples the skill names but rarely read `references/*.md` (1 of 5 loaded runs did), so a fact that lives only in a reference is effectively unseen.
      - `data/api.json` listed interfaces as `export interface X` with no members (2,168 interfaces, 187 classes), so `prism_api` could not say `args` and not `arguments`. `gemma4` wrote `call.arguments` in all six skill-arm `package-conformance` trials.
      - The word `principal` appeared nowhere in the skill. Tools with durable effects fail closed without one, `tsc` cannot see it, and deleting a retired `identity` field (what `tsc` asks for) leaves `shell` failing at run time.
      - `references/upgrading.md` listed `identity` among still-valid config names; `AgentConfig` has no such field.
      - `beam` wrote no files in most runs (a model floor); `gpt-oss:120b` lost 12 records to server errors and never loaded the skill unprompted.
    - **Kit-v2 fixes (general, none encodes a fixture or hidden test).** `members` on every interface and class in `data/api.json` and in `prism_api` (tarball 404 KB to 515 KB, budget rebaselined with a reason in `scripts/budgets.json`); `SKILL.md` "Mistakes the compiler cannot catch"; the upgrade map rows (`extensions`, `provider`/`model`, `tools.use`, `identity`, `store`) and the `identity` correction; a coding-tools recipe, hook payload and conformance-helper guidance, and the `compaction` slot rule in `recipes.md`; `ERR_PRISM_CODING_PRINCIPAL_REQUIRED` in `pitfalls.md` (and a doc comment at its declaration); a runtime-check step in `verification.md`; the principal note in `docs/migrate-to-0.13.md`. Pre-registration: `criteria.json` `kitRevisions` lists both kits, the changes and the rule that kit-v2 results do not drive further kit edits; the lock was re-registered; kit-v1 evidence moved to `docs/_evidence/host-builder/212/kit-v1/`.
    - **Results** (acceptance, `gemma4:31b`, 21 records per arm):
      | Run | none | skill | skill+mcp | Verdict |
      | --- | --- | --- | --- | --- |
      | kit-v1 natural | 0.19 | 0.57 | 0.52 | no claims |
      | kit-v1 preload | 0.43 | 0.52 | 0.43 | no claims |
      | kit-v2 natural | 0.24 | 0.67 | 0.62 | no claims: skill over none +0.43, CI [+0.24, +0.67], q 0.125 |
      | kit-v2 preload, attempt 2 | 0.29 | 0.57 | 0.67 | inconclusive: 2 of 63 unscored (timeout, `ECONNRESET`), complete cells q 0.25 or above |
      kit-v2 preload attempt 1 (also inconclusive, 2 timeouts) is kept in `attempts/`. `beam` and `gpt-oss:120b` have kit-v1 natural runs only (no usable comparison); they were not rerun on kit-v2. `skill+mcp` over `skill` was never significant. The kit-v2 upgrade task went from 0/3 (`none`) to 3/3 (`skill`), the `identity` to `principal` fix.
    - **Cost.** Per full mode of 63 builder runs: about 55-60M input tokens (about 95% cached) and 0.2M output on `gemma4:31b`, about 2 hours at concurrency 1. Seven full modes were run or attempted (kit-v1: 3 models, kit-v2: 3 attempts, plus a stopped diagnostic of 9 runs); the Ollama allowance is shared with plan 210 C-1, so billed cost is read from `/api/usage`, not recorded here.
    - **Outcome.** No claim passes, so the package README "What it changes" states none and links the evidence. A significant regression against `none` did not occur (no comparison favored `none`), so round 2 did not apply. Raising the trial count (3 to about 8) would likely power the natural-loading effect but is a new pre-registration after seeing the result; the owner chose not to.
    - **Verification.** `bun test scripts/host-builder-evals/run.test.mjs` 18 pass; `bun test src/__tests__/host-builder-kit.test.ts` 15 pass; `bun test scripts/host-builder-index.test.mjs` 7 pass; `packages/hosts/host-builder` 78 pass; `packages/tools/coding` 626 pass; `host-builder-index --check` fresh; offline eval passes every scorer with the oracle in all arms.

### Part D — prompt-cache parity with pi (ex-plan 184)

- [x] Task 21: Reference harness check: pi headless (read-only) (was plan 184 Task 1)
  - Acceptance Criteria:
    - Functional: The task note records, for pi (`pi --version`, 1.3.0 on 2026-10-16, dated):
      - (a) **Routing pi through the proxy without editing `~/.pi`.** How to point pi's `hyper` and `opencode-go` providers at a custom base URL for one run: a run-scoped agent/config directory, a run-scoped models file, or an `--extension`. Verify against pi's docs (find-docs) and the installed source. The run must leave `~/.pi/agent/*` unchanged; Task 23 checks this with a checksum before and after. If pi can only take a base URL from a config that also holds credentials, record that and choose the option that passes the key through env (`--api-key` is rejected because it puts the key in process arguments).
      - (b) **The headless command.** `pi -p --mode json --no-session --model <provider>/<id> --thinking <level> "<task>"`, run in the fixture workdir with built-in tools (`read`, `bash`, `edit`, `write`). It runs without approval prompts. For a reproducible baseline it also disables the owner's personal extras: `--no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve`. The note records which of these change pi's request prefix, and the comparison runs with all of them.
      - (c) **What pi sends and receives.** From the proxy log of one short run per provider and route model: the endpoint and format pi uses for each test model (Chat Completions or Anthropic Messages); where it places `cache_control` markers; whether it sends a session or affinity header (for example `x-opencode-session`) or a `prompt_cache_key`. Also whether pi's `--mode json` output reports per-request usage. If it does, Task 23 cross-checks it against the proxy as a second source.
      - (d) **Model ids.** pi's catalog ids can differ from Prism's (pi lists `hyper/deepseek-v4-pro-0813` where Prism's catalog has `deepseek-v4-pro`). Map each test model to the same upstream id on both sides, using the upstream `model` field in the proxy log, not the display name.
      - (e) **Differences Prism should match.** Any marker placement or affinity header pi uses that Prism does not. This becomes Task 24's first investigation list.
      - (f) **OpenRouter cell:** verify the pinned `anthropic/claude-haiku-4.5` model on both sides and pi's `--provider openrouter` command, using the same isolation/base-URL procedure. Source-only lever evidence already exists in plan 203; no paid wire run unless the owner authorizes it and `PRISM_LIVE_OPENROUTER_PAID=1`. Record `unmeasurable` with that reason while authorization is limited to the random free router.
    - Functional: The note fixes the test matrix (one model per provider and route, from plan 183 Task 1 (e), which pi also lists), the workload (Task 23), and the cell budget.
    - Performance: n/a — read-only; at most one short pi run per provider.
    - Code Quality: Every config fact cites pi's docs URL and date, or the installed source path and version.
    - Security: No pi config file with a key is written inside the repository; `~/.pi/agent/auth.json` is never read by the runner or quoted in the note.
  - Approach:
    - Documentation Reviewed:
      - `pi --help` (1.3.0: `--print`, `--mode json`, `--no-session`, `--model provider/id`, `--thinking`, the `--no-*` switches), `pi --list-models hyper|opencode-go`, pi's docs on custom providers and base URLs (find-docs), plan 182 Task 5 (`scripts/wire-proxy.mjs`), plan 183 Task 1.
    - Options Considered:
      - Crush for Hyper and OpenCode for OpenCode Go. Replaced by the owner on 2026-10-16: pi is installed with both providers configured, and one reference for both providers keeps the comparison simpler.
      - Read pi's session files for usage. Rejected: `--no-session` keeps runs ephemeral, and the proxy measures both harnesses the same way.
      - Run pi with the owner's normal extensions and MCP servers. Rejected: they add tools and prompts that differ between machines and change the prefix; the baseline is pi's own coding-agent behaviour.
    - Chosen Approach:
      - Check pi's headless and base-URL facts first, so the runner is built on them.
    - API Notes and Examples:
      ```bash
      bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 --usage-log /tmp/pi-hyper.jsonl
      # base-URL override per Task 21 (a); then, in the fixture workdir:
      pi -p --mode json --no-session --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve \
         --model hyper/<id> --thinking medium "$(cat scripts/cache-parity/task.md)"
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - owner decisions 2026-10-16 (cache parity; pi as the reference, run headless).
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08, read-only; no repository file changed except this plan). **Scope amendment (owner, 2026-11-08): the parity cells are Command Code (three wires) and Ollama Cloud, because those accounts have balances. Hyper, OpenCode Go and OpenRouter are deferred to after 0.13.0 (their accounts are out of credit or at their limit).** Scratch work lives in the session scratchpad, outside the repository. pi is `@earendil-works/pi-coding-agent` **1.5.0** (the task text said 1.3.0 on 2026-10-16); extensions are `pi-commandcode-provider` **0.8.0** (plan 205 recorded 0.7.10) and `pi-ollama-cloud` **0.13.1**. Docs cited are the installed pi 1.5.0 docs (`docs/models.md`, `models-configuration.md`, `environment-variables.md`, `configuration.md`) and the extensions' source under `~/.pi/agent/npm/node_modules/`.
    - **(a) Routing pi through the proxy without touching `~/.pi`.** Verified by running it. Common to every cell: a run-scoped `PI_CODING_AGENT_DIR=<scratch>/agent-<cell>` (holds `settings.json` = `{}`); the extension loaded with `-e <path>/index.ts` under `--no-extensions` (explicit `-e` still works); keys through env only (`COMMAND_CODE_API_KEY`, `OLLAMA_API_KEY`; no `--api-key`, no `auth.json`). `~/.pi/agent` was checksummed before and after all runs (sha256 of every file except `sessions/` and `web-search-cache/`, size and mtime for `auth.json`): **identical**. 0 occurrences of any key value in the recorded exchanges.
      - **Command Code: documented env override, no patch.** `COMMANDCODE_API_BASE=http://127.0.0.1:<port>/provider/v1` and `COMMANDCODE_MODELS_CACHE=<scratch>/agent-cc/commandcode-models.json` (a copy of the owner's catalog, which holds `version` and `models` and no credentials; without it a fresh agent dir has no catalog). The proxy runs with `--upstream https://api.commandcode.ai`, so the `/provider/v1` prefix is kept. All three wires (`/provider/v1/chat/completions`, `/responses`, `/messages?beta=true`) went through it. pi's catalog assigns the wire per model: `minimax/minimax-m3.1-flash` `openai-completions`, `gpt-5.6-luna` `openai-responses`, `claude-haiku-5-5` `anthropic-messages`.
      - **Ollama Cloud: the extension ignores `OLLAMA_API_BASE` and a `models.json` `baseUrl` did not take effect.** `pi-ollama-cloud` hard-codes `CLOUD_BASE_URL = "https://ollama.com"` (`models.ts:47`; the env var only prints a warning), and registers through the legacy `registerProvider(..., {models})` form, which a `models.json` provider entry did not override: the first attempt with `{"providers": {"ollama-cloud": {"baseUrl": ...}}}` went straight to `ollama.com` (no proxy exchange; about 4k tokens billed on `gemma4:31b`). What works: a run-scoped **copy** of the extension with only that one constant changed to the proxy URL, plus a `node_modules` symlink next to the copy so its imports resolve (`sed` on the copy, `ln -s ~/.pi/agent/npm/node_modules <scratch>/node_modules`). The proxy runs with `--upstream https://ollama.com`; pi then calls `/v1/chat/completions`. The copy changes the URL and nothing else, so models, compat and request building are the extension's own. Task 23 must say so in its evidence.
      - **Catalog/tool set.** Ollama Cloud's extension adds `ollama_web_search` and `ollama_web_fetch` (6 tools); pass `--exclude-tools ollama_web_search,ollama_web_fetch` to get the same 4 tools (`read`, `bash`, `edit`, `write`) as every other cell (verified: 4 tools in the body). Every Command Code body carries the same 4 tools.
    - **(b) The headless command.** Verified: `pi -p --mode json --no-session --no-extensions -e <extension> --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve --model <provider>/<id> --thinking <level> "<task>"` with `cwd` = the fixture workdir. It exits 0 with no prompts and prints one JSON event per line (`session`, `agent_start`, `turn_start`, `message_start/end`, `turn_end`, `agent_end`, `agent_settled`). Switches that change the prefix: `--no-context-files` (drops `AGENTS.md`/`CLAUDE.md`), `--no-skills`, `--no-prompt-templates`, `--no-extensions` and `--no-mcp` (drop their tools and sections); the comparison runs with all of them. A fresh `--thinking low` produced `reasoning_effort: low` on Command Code but `medium` on `gemma4:31b` (pi maps the level through the model's `thinkingLevelMap`; the evidence records the effective value from the body).
    - **(c) What pi sends and receives** (a 2-request run per route: one tool call, then the answer):
      | Route | Model | pi `api` | Endpoint | Cache markers / key | Affinity |
      | --- | --- | --- | --- | --- | --- |
      | Command Code chat | `minimax/minimax-m3.1-flash` | `openai-completions` | `/provider/v1/chat/completions`; `stream_options.include_usage`, `reasoning_effort`, `max_tokens` | none | none (the proxy found no key) |
      | Command Code Responses | `gpt-5.6-luna` | `openai-responses` | `/provider/v1/responses`; `store: false`, `include: ["reasoning.encrypted_content"]`, `reasoning: {effort, summary: "auto"}` | **`prompt_cache_key` = the session uuid** (same on both requests) | the key above; the proxy log cannot show request headers other than a cache-key name list |
      | Command Code Messages | `claude-haiku-5-5` | `anthropic-messages` | `/provider/v1/messages?beta=true`; `thinking: {type: "adaptive"}`, `output_config.effort` | `cache_control: {type: "ephemeral"}` on the **system block** and on the **last block of the last message** (2 markers; **none on tools**, the extension sets `supportsCacheControlOnTools: false`); no `ttl` | none |
      | Ollama Cloud | `gemma4:31b` | `openai-completions` | `/v1/chat/completions`; system as role `system`, `reasoning_effort` | none | none |
      - Source for the rules: pi's `openai-completions` builder sends `prompt_cache_key` only for `api.openai.com` or long retention (default retention is `short`; `PI_CACHE_RETENTION=long` changes it), adds `cache_control` only where `cacheControlFormat: "anthropic"` (OpenRouter `anthropic/*` ids), and affinity headers only where `sendSessionAffinityHeaders` is set (OpenRouter by default; `gemma4:31b` sets it `false`). The Command Code Messages and Responses behaviour comes from the extension's compat entries (`index.ts:157-165`) and was confirmed on the wire above.
      - **pi's `--mode json` usage is usable as a second source.** Each assistant `message_end` has `usage: {input, output, cacheRead, cacheWrite, totalTokens, cost}` with **disjoint** buckets: `input` excludes cached tokens. It matched the proxy on every route: Ollama `input 21 + cacheRead 1888` = proxy `prompt_tokens 1909`; Command Code chat `48 + 1626` = `1674`; Responses `3 + cacheRead 1050 + cacheWrite 53` = `1106`; Messages `2 + 2172 + 60`, matching `input_tokens 2`, `cache_read 2172`, `cache_creation 60`. Task 23's cross-check can use `input + cacheRead + cacheWrite` as the inclusive prompt total.
      - **Caches carry over between runs.** The second Ollama run got `cached_tokens: 1888` on its first request because an earlier run had sent the same prefix. Task 23 must salt the fixture's system prompt per run (a fresh run id), as plans 203 and 206 do, or the first request's hit rate is meaningless.
    - **(d) Model ids.** pi sends the catalog id verbatim as the upstream `model`; the proxy log shows `minimax/minimax-m3.1-flash`, `gpt-5.6-luna`, `claude-haiku-5-5` and `gemma4:31b`, the same ids Prism's packages use (plan 205 probes). pi's selector adds the provider prefix (`commandcode/minimax/minimax-m3.1-flash`, `ollama-cloud/gemma4:31b`); Task 23 asserts the proxy log's `model` is equal for both harnesses.
    - **(e) Differences Prism should match (Task 24's first investigation list).** Prism's side was not run here; these are the pi levers to compare against Prism's bodies in Task 23, with what plans 205 and 206 already established:
      1. **Responses `prompt_cache_key`.** pi sends the session uuid; Prism's route clamps `cacheKey`/`sessionId` into `prompt_cache_key` and `x-client-request-id` (`packages/providers/commandcode/src/provider.ts:13-51`). The value must stay constant across a run.
      2. **Messages markers.** pi marks system and last message only, none on tools, no `ttl`. Prism's Command Code Anthropic route is declared with the generic breakpoint set; check that it does not mark tools (the extension turned that off for this upstream) and does not send `ttl: "1h"`.
      3. **Chat route.** pi sends no lever. Prism must send none that changes the prefix (plan 205 found no lever gap).
      4. **Ollama Cloud.** Both harnesses send no cache lever (plan 206 `cache-levers.test.ts` captured the same); the parity result is decided by prefix stability, which Task 22 covers.
      5. **Reasoning field.** pi sends `thinking: adaptive` + `output_config.effort` on Messages and `reasoning.effort` on Responses; a Prism difference changes the body but not the cached prefix on these upstreams unless it moves earlier segments.
    - **Test matrix, workload and budget.**
      | Cell | Model | pi side | Prism side |
      | --- | --- | --- | --- |
      | Command Code chat | `minimax/minimax-m3.1-flash` | works | `commandcode` (in tree, publishes after 0.13.0) |
      | Command Code Responses | `gpt-5.6-luna` | works | same |
      | Command Code Messages | `claude-haiku-5-5` | works | same |
      | Ollama Cloud | `gemma4:31b` | works (patched copy, see (a)) | `ollama-cloud`, native route (and OpenAI-compatible as a second check) |
      Workload and budget are Task 23's (`scripts/cache-parity/task.md` over its fixture, 3 runs per cell, 120 requests per cell, about 480 in total). Measured cost of this task: 6 pi runs on these providers (one of them the unproxied Ollama attempt), 2 requests each, about 2k tokens per request.
    - **Deferred to after 0.13.0 (owner, 2026-11-08), with the facts found so the later run can start from them.**
      - **Hyper:** every request returned HTTP 402 (no credits), both routes. pi's `hyper` provider (extension `@charmland/pi-hyper-provider` 0.4.3) is `openai-completions` only; the base URL override works through `models.json` (`{"providers": {"hyper": {"baseUrl": "http://127.0.0.1:<port>"}}}`, `--upstream https://hyper.charm.land/v1`) with the catalog seeded from `~/.pi/agent/models-store.json`, and a Messages comparator needs a custom `hyper-anthropic` provider with `api: "anthropic-messages"`. pi sends no marker and no affinity header on Hyper chat, and three ephemeral markers (system, last tool, last message block) on Messages.
      - **OpenCode Go:** pi uses `https://opencode.ai/inference/go/openai/v1` and `.../inference/go/anthropic`, not Prism's `/zen/go/v1`; the Anthropic route returned 429 `GoUsageLimitError` (monthly), and `mimo-v2.5` returns 410 `ModelDeprecated` ("use `mimo-v2.6-flash`"). Prism still defaults to `mimo-v2.5` (`scripts/live-matrix.json:79,345,813,839,880`, `packages/providers/opencode-go/src/models.ts:204,292`). pi sends `x-opencode-session` (a per-run uuid, even with `--no-session`) and three markers on Messages.
      - **OpenRouter** (`anthropic/claude-haiku-4.5`): unchanged, `unmeasurable` without paid authorization; pi's `--list-models` lists the model, and pi turns on `cacheControlFormat: "anthropic"` and session-affinity headers for OpenRouter `anthropic/*`.
    - **Verification.** Read-only: no repository file changed apart from this plan. Probed pi against four Command Code and Ollama Cloud routes, each with a 2-request tool loop that returned 200, so request bodies, markers, keys and usage are observed. `~/.pi/agent` checksum unchanged; no key value in any recorded exchange; `auth.json` never opened.
- [x] Task 22: Wire-level prefix stability (was plan 184 Task 2)
  - Acceptance Criteria:
    - Functional: `prefixStabilityConformance` (`src/testing/prefix-stability-conformance.ts`) gains `encode?: (request: ProviderRequest) => Promise<JsonObject>`, plus `segments?: (body) => { tools?: unknown; system?: unknown; messages: unknown[] }` with defaults for the OpenAI Chat and Anthropic Messages formats. For each consecutive pair it asserts:
      - `JSON.stringify(tools)` is equal;
      - `JSON.stringify(system)` is equal;
      - `messages[i]` is byte-equal for every `i` below the earlier request's last index, allowing only cache markers to move. The comparison ignores `cache_control` on the earlier request's last block, and the default breakpoint is allowed to move forward (plan 182 Task 8).
      A failure names the segment, the index, and the first differing byte offset.
    - Functional: Each of `hyper` and `opencode-go` runs it for each route over a ten-turn tool loop on the replay harness. The run uses the package's real encoder with thinking replay on, and a skill load mid-session, which is the existing fixture's scenario. The kernel's built-in `openai-compatible` provider runs it too.
    - Performance: Each run is under 500 ms offline.
    - Code Quality: The encoder comes from the package (its exported route encoder or the routed provider's `encode` seam added in plan 182 Task 7); no re-implementation in the test.
    - Security: n/a — offline fixtures with no secrets.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/prefix-stability-conformance.ts:1-60` (request-level runner, `minContinuity`); plan 182 Tasks 7–8; `src/__tests__/prefix-stability-conformance.test.ts`.
    - Options Considered:
      - Compare the whole encoded body as a byte prefix. Rejected: JSON field order places `tools` after `messages` in the Chat body, so a growing message list always shifts later bytes. Segment equality is what the upstream cache keys on.
    - Chosen Approach:
      - Segment equality on the real encoder, in the existing conformance runner.
    - API Notes and Examples:
      ```ts
      await prefixStabilityConformance({
        host, skills,
        encode: (r) => hyperRouteEncoder("anthropic")(r),
        segments: anthropicSegments,
      });
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`, `src/__tests__/prefix-stability-conformance.test.ts`, `src/provider-kit/routed-provider.ts` (an `encode(request)` method on the returned provider, if plan 182 did not add one), `packages/providers/{hyper,opencode-go}/src/__tests__/prefix-stability.test.ts` (new), `scripts/compat-baseline/arnilo__prism.txt` (if `/testing` or kit signatures change), `docs/testing.md`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - plan 182 Tasks 7–8.
  - Test Cases to Write:
    - `wire_prefix_detects_reordered_tools`, `wire_prefix_detects_mutated_earlier_message`, `wire_prefix_detects_system_timestamp`, `wire_prefix_allows_moved_cache_marker`: each seeds one defect and fails on it.
    - `hyper_wire_prefix_stable_{openai,anthropic}`, `opencode_go_wire_prefix_stable_{openai,anthropic}`, `builtin_wire_prefix_stable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `/testing` option.
    - Docs pages to create/edit:
      - `docs/testing.md` (prefix stability, wire mode), `docs/provider-kit.md` ("Cache-friendly encoders").
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08).
    - **What changed.** `src/testing/prefix-stability-conformance.ts` gains `encode`, `segments` and `turns` options, a `wirePairs` result field, and the exports `anthropicSegments`, `openAIChatSegments`, `defaultWireSegments`, `assertWireSegmentsStable` and `WireSegments`. Segment rules are as specified: `tools` and `system` equal, messages below the earlier request's last index byte-equal with `cache_control` stripped (the marker is the only thing allowed to move), and a failure names the segment, the index and the first differing byte offset (bytes of the serialized segment). `createRoutedProvider` and `createOpenAICompatibleProvider` now return a new `RoutedProvider` (`ModelProvider` plus `encode(request)`), with route selection and body serialization extracted so `generate` and `encode` share them; `createHyperProvider` and `createOpenCodeGoProvider` return it too. New tests: `src/__tests__/prefix-stability-conformance.test.ts` (wire block: the four seeded-defect tests, `builtin_wire_prefix_stable`, and a `wirePairs === 0` check) and `packages/providers/{hyper,opencode-go}/src/__tests__/prefix-stability.test.ts` (`*_wire_prefix_stable_{openai,anthropic}`). Each wire run is about 10 ms offline against the 500 ms budget.
    - **Plan text corrected.** (1) The `encode` seam the task assumed "plan 182 added" did not exist, so this task added it (the Files list allowed for that). (2) "Ten-turn tool loop" is implemented as ten provider requests: the new `turns` option (default 2, so existing runs are unchanged) runs `turns: 5`, with the turns after the two skill loads calling a runner-owned no-op tool; the thinking-replay block rides on every tool round (`reasoningFixture: true`). (3) The runner's captured `request.model` is the fixture's stand-in, so the caller's `encode` swaps the real `ModelConfig` in (`provider.encode({ ...request, model })`); the docs show it.
    - **Findings for later tasks.** The real encoders were already stable on this fixture, so no codec fix was needed. The Task 23 runner (recorded bodies from the live cells) can reuse `assertWireSegmentsStable` with the same segment splitters; Command Code's Messages and Responses and Ollama Cloud's Chat routes are not covered by this task's offline tests (the task named hyper and opencode-go; both deferred from the live cells). Add `commandcode`/`ollama-cloud` wire tests the same way (their factories are routed providers) if Task 24 needs them.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`): `arnilo__prism.txt` +`anthropicSegments`, +`assertWireSegmentsStable`, +`defaultWireSegments`, +`openAIChatSegments`; `createRoutedProvider` and `createOpenAICompatibleProvider` return `ModelProvider` → `RoutedProvider`; +`extendSnapshot` (not this task's: plan 210 Task 0.3, already in the working tree). `arnilo__prism-provider-hyper.txt` and `...-opencode-go.txt`: the factory's return type `ModelProvider` → `RoutedProvider`. No removals.
    - **Budgets.** Kernel ceilings rebaselined with a comment in `scripts/budgets.json`: 1224853 packed / 3982898 unpacked / 40686 source lines / 1526 root exports (+7323 / +22894 / +163 / +7). Growth is this task's runner and seam plus the docs and CHANGELOG that ship; one of the seven root exports is plan 210's `extendSnapshot`.
    - **Checks.** `bun test src/provider-kit src/__tests__/prefix-stability-conformance.test.ts` and the hyper, opencode-go, openrouter, commandcode, ollama-cloud, kilo and litellm suites: 234 pass, 12 skip, 0 fail. The other conformance users (`packages/context/engineering` fold-batch, `packages/memory/observational`): 111 pass. `bun scripts/release.mjs gate` passes. Docs: `docs/testing.md` (new "Prefix stability" section), `docs/provider-kit.md` ("Cache-friendly encoders"), `CHANGELOG.md`.
    - **Not this task's, seen on the way.** `bun run typecheck` fails today only in files from concurrent work in the tree: `packages/memory/fabric/src/__tests__/removal-byte-identical.test.ts(72,121)` (untracked) and `examples/scoped-memory.ts` (imports `createScopedMemoryPolicy`, which the fabric working tree no longer exports); the gate printed a fabric "removed: Scoped…" experimental notice for the same reason. `--update-baseline` also rewrote `arnilo__prism-host-builder.txt`, `arnilo__prism-memory-core.txt` and `arnilo__prism-memory-fabric.txt` from that in-flight work; those three were left as written (reverting them was declined by the permission classifier), so review them before committing.

- [x] Task 23: The parity runner (was plan 184 Task 3)
  - **Amendment (owner, 2026-11-08, after Task 21).** The runner's live cells are **Command Code (chat, Responses, Messages) and Ollama Cloud** wherever the text below says Hyper and OpenCode Go; those two providers are deferred to after 0.13.0 (no balance). Facts from Task 21 that bind the runner: pi's base URL is set by `COMMANDCODE_API_BASE` (with `COMMANDCODE_MODELS_CACHE` pointing at a scratch copy of the catalog) for Command Code, and by a run-scoped patched copy of `pi-ollama-cloud` for Ollama Cloud (no env or `models.json` override works); the proxy `--upstream` is `https://api.commandcode.ai` and `https://ollama.com`; keys are `COMMAND_CODE_API_KEY` and `OLLAMA_API_KEY`; pi runs with `--exclude-tools ollama_web_search,ollama_web_fetch` on Ollama Cloud; the fixture's system prompt is salted per run; pi's `usage` is disjoint (`input + cacheRead + cacheWrite` = prompt total) and is the second-source cross-check. The Prism side must run through the reference host's default coding worker with `commandcode` / `ollama-cloud` selectable (both are in the tree); if the worker cannot select them, add that as a small prerequisite and note it. Offline tests (Task 22 and `run.test.mjs`) are unchanged.
  - Acceptance Criteria:
    - Functional: `scripts/cache-parity/` contains:
      - `fixture/`: a small git repository template (about 15 files, one failing unit test and a short README), so a coding agent needs several reads, an edit, and a test run.
      - `task.md`: one fixed prompt ("Make the failing test pass without changing the test; run the tests; stop when green").
      - `run.mjs --provider <hyper|opencode-go|openrouter> --model <id> [--runs 3] [--harness prism,pi]`. The OpenRouter cell requires `PRISM_LIVE_OPENROUTER_PAID=1` and the pinned Anthropic model; it must not select a router alias.

      For each run, the runner:
      1. copies the fixture into a temp dir;
      2. starts `wire-proxy.mjs` with `--usage-log`;
      3. runs the harness with its base URL pointed at the proxy: Prism through `apps/prism-agent`'s one-shot coding worker in its default configuration (no `memory`, so no experimental package; Task 3) (`hyper`/`opencode-go`/opt-in `openrouter` package, `baseUrl` override, `toolsCoding({ root })`, approval `allow`), and pi through the Task 21 headless command, with its base URL pointed at the proxy using the run-scoped override (never by editing `~/.pi`);
      4. stops at a turn ceiling (Prism `limits.maxTurns: 20`; for pi, a wall-clock timeout and a request ceiling enforced by the proxy (it returns 429 after the cell budget));
      5. records whether the fixture test passes at the end.
    - Functional: Metrics per run, from the proxy log only:
      - `requests`;
      - `promptTokens = Σ inputTokens`, using plan 182 Task 4's inclusive rule, applied by the proxy's own reader;
      - `cacheRead = Σ cacheReadTokens` and `cacheWrite = Σ cacheWriteTokens`;
      - `hitRate = cacheRead / promptTokens`;
      - `firstTurnExcludedHitRate`, the same over requests 2..n;
      - `taskSolved`.

      Report per cell: the median and spread over runs for each harness. A run where the task was not solved is reported, but excluded from the comparison only if *both* harnesses solved the task in at least 2 of 3 runs. Otherwise the cell is marked `inconclusive`.
    - Functional: Cross-check: for the Prism runs, the usage events Prism emitted (from the JSONL output) equal the proxy's figures per request. A mismatch fails the run with `usage_mismatch`, which is a Prism bug in the normalizer or codec.
    - Functional: Output is `docs/_evidence/cache-parity/<provider>-<model>-<date>.{json,md}` with Prism's commit and pi's version, model, route each harness used, per-run metrics, and medians. It contains no secret: the runner scans it with `assertNoSecretLeak` against the keys.
    - Performance: Budget per cell: at most 3 × 2 runs × 20 requests = 120 requests. The runner aborts a cell that exceeds it, reports `budget_exceeded`, and states the ceiling in `scripts/cache-parity/README.md` and the manifest row.
    - Code Quality: Pure metric functions, unit-tested; harness launch is behind an injected `spawn`, so `run.test.mjs` runs offline with a fake upstream and scripted harnesses. No new dependency.
    - Security:
      - The proxy listens on loopback only.
      - pi's run-scoped override files are written into the temp dir, never the repo. `~/.pi/agent` is checksummed before and after each run, and any change fails the run with `reference_config_mutated`.
      - Keys reach child processes through the environment, never as arguments (no `--api-key`).
      - Child stdout and stderr are scanned for the Prism keys before they are stored.
  - Approach:
    - Documentation Reviewed:
      - Task 21 (pi headless facts); plan 182 Task 5 (proxy); `apps/prism-agent/README.md` (one-shot JSONL mode, coding worker); `apps/prism-agent/src/{cli,scenarios}/*`.
    - Options Considered:
      - Compare Prism to the reference on synthetic prompts without tools. Rejected: cache behaviour in agent loops (tool results, thinking replay) is the claim being tested.
      - One run per harness. Rejected: harnesses are non-deterministic; three runs and medians are the minimum to separate noise from a real gap.
    - Chosen Approach:
      - A real coding task, same model, same proxy, medians over three runs.
    - API Notes and Examples:
      ```bash
      export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
      bun scripts/cache-parity/run.mjs --provider hyper --model qwen3.6-plus --runs 3
      # → docs/_evidence/cache-parity/hyper-qwen3.6-plus-2026-10-20.md
      #   prism      hitRate median 0.86 (0.84–0.88)  solved 3/3
      #   pi 1.3.0   hitRate median 0.83 (0.80–0.85)  solved 3/3
      ```
    - Files to Create/Edit:
      - `scripts/cache-parity/{run.mjs,metrics.mjs,harnesses.mjs,README.md,task.md}` (new; `harnesses.mjs` has two entries, `prism` and `pi`), `scripts/cache-parity/fixture/**` (new), `scripts/cache-parity/run.test.mjs` (new), `apps/prism-agent/src/cli/*` (a `--base-url` override for the provider package if the one-shot CLI lacks it; tentative until Task 21), `docs/live-testing.md` ("Cache parity"), `CHANGELOG.md`.
    - References:
      - plans 182, 183.
  - Test Cases to Write:
    - `metrics_compute_inclusive_hit_rate`, `metrics_exclude_unsolved_runs_only_when_both_solved`, `runner_marks_inconclusive_cell`, `runner_aborts_on_budget`, `runner_flags_usage_mismatch`, `runner_scans_outputs_for_keys`, `runner_writes_reference_config_outside_repo`, `runner_fails_if_pi_config_mutated`, `runner_never_passes_key_as_argument`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator tooling.
    - Docs pages to create/edit:
      - `docs/live-testing.md`, `scripts/cache-parity/README.md` (how to run, the budget, how to read the report).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08, offline only: no live request was made; the first live run is Task 24).
    - **What changed.** `scripts/cache-parity/` gains `run.mjs` (CLI, `runCell`, `executeRun`, report writer), `metrics.mjs` (pure: `runMetrics`, `cellVerdict`, `compareUsage`, `prismTurnUsages`, `piTurnUsages`, `requestBudget`), `harnesses.mjs` (the `prism` and `pi` entries plus the Command Code and Ollama Cloud provider table; each only *plans* a run so the plan is asserted offline), `prism-driver.ts` (Prism side), `task.md`, `fixture/` (17 files: an order-pricing library, one failing test `test/pricing.test.js` where tax is taken on the pre-discount subtotal), `README.md`, and `run.test.mjs` (16 tests, registered in `scripts/run-all-tests.mjs` `GATE_FILES`). `--provider` is `commandcode|ollama-cloud` (the amendment's cells); Hyper, OpenCode Go and OpenRouter are not accepted. `--route native|openai` is Ollama Cloud only (Prism's route; pi always uses the OpenAI-compatible one).
    - **Prerequisites added (small, noted per the task text).** (1) `scripts/wire-proxy.mjs --max-requests <n>` (and `startWireProxy({ maxRequests })`, `proxy.forwarded()`): past `n` forwarded requests the proxy answers 429 without contacting the upstream; test `max_requests_answers_429_without_contacting_the_upstream`. (2) `apps/prism-agent`: `HostDeps.limits` and `RunDeps.limits`, applied by `createCodingWorker` to `createAgent({ limits })`; test `coding_worker_applies_deps_limits`. Reason: the plan says `limits.maxTurns: 20`, but a run-scoped limit can only narrow the agent's, and the kernel defaults (16 turns, 8 tool rounds, 40k cumulative input tokens, 120 s) would end a Prism coding run before pi's, biasing the hit rate. The driver sets 20 turns, 20 tool rounds, 600 s and turns the token axes off; the proxy's 20-request ceiling is the bound for both harnesses. The CLI (`prism-agent run`) has no flag for it: the default worker is unchanged.
    - **Deviations from the task text.** `approval: "auto"` (the host's unattended mode; the text said `allow`). The host takes a model's limits from the config's model *object*, not the provider catalog (`context window` is needed by the compaction gate), so the driver copies `limits` from the provider's static catalog into the scratch `prism-agent.json`; the static catalog also avoids a `/models` discovery request through the proxy. Salt: the per-run id is a workspace `AGENTS.md` for Prism (the host loads it into the system prompt) and `--append-system-prompt` for pi. pi's `reference_config_mutated` check is a stat signature (path, size, mtime, excluding `sessions/` and `web-search-cache/`) so `auth.json` is never opened; the cell stops on it.
    - **Verification.** `bun test scripts/cache-parity/run.test.mjs scripts/wire-proxy.test.mjs scripts/run-all-tests.test.mjs scripts/live-doc-check.test.mjs`: 51 pass; `apps/prism-agent` `bun test src`: 62 pass, `tsc --noEmit` clean; `scan-secrets` over `scripts/cache-parity`: 0 findings. A keyless end-to-end smoke ran the real driver and the real coding worker against a local fake upstream through the proxy: the request reached `/provider/v1/chat/completions` with the catalog model, and `turn.completed` carried `usage {inputTokens: 1000, cacheReadTokens: 640}` exactly as the proxy logged it (so `compareUsage` reads the right fields, inclusive). `bun scripts/release.mjs gate` was not run: no export or baseline changed in this task.
    - **Findings for Task 24.** (1) The host's default coding worker sends **13 tools**; pi sends 4. This is the shipped product's prefix, not a defect, but a hit-rate gap on a cell must be read with it (the evidence report says so). (2) The proxy logs `model` verbatim; `executeRun` returns `model_mismatch` if it differs from `--model` for either harness (Task 21 (d)). (3) A run that reaches the 20-request ceiling is flagged `ceiling: true` and is probably unsolved; the cell then reads `inconclusive` unless the other runs solve it. (4) `bun test scripts/cache-parity` from the directory picks up `fixture/test` and fails by design (the fixture's test is the failing one); run the named test file, or `bun run test`, whose list is explicit. (5) `bun test scripts/truth-current.test.mjs` fails on "package-truth generated docs include current Phase 54 evidence" with a memory package-truth row diff; it is unrelated to this task (no package or export changed) and comes from the in-flight memory work in the tree.
    - **Not run.** No live cell. Task 24 owns the `release/cache-parity` manifest row, the gate, and the first run (`docs/_evidence/cache-parity-0.13.0.md`).

- [x] Task 24: The parity gate and the first run (was plan 184 Task 4)
  - **Amendment (owner, 2026-11-08, after Task 21).** The enabled cells are Command Code chat/Responses/Messages and Ollama Cloud (Task 21's matrix). Hyper, OpenCode Go and OpenRouter cells are recorded as `deferred` (post-0.13.0) with the Task 21 reasons, not `unmeasurable` failures; `release/cache-parity` requires `COMMAND_CODE_API_KEY`, `OLLAMA_API_KEY` and `pi` with both extensions installed instead of the Hyper and OpenCode Go keys. Command Code and Ollama Cloud do not gate 0.13.0 (their own plans 205 and 206 gate their releases), so a miss here is investigated and reported, and does not block the 0.13.0 publish unless it shows a defect in shared kit code.
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` gains `release/cache-parity`: `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_CACHE_PARITY", "HYPER_API_KEY", "OPENCODE_GO_API_KEY"]` plus `pi` on `PATH` with both providers ready (`pi auth` reports them; a missing binary or provider skips the cell with a reason, and strict mode fails it). Cells: Hyper chat route, Hyper Anthropic route, OpenCode Go chat route, OpenCode Go Anthropic route, with models from Task 21, plus the pinned OpenRouter Anthropic cell above. The row's `optional` list includes `PRISM_LIVE_OPENROUTER_PAID` and `OPENROUTER_API_KEY`; the runner enables that cell only for paid flag `1` and owner authorization, without gating the four existing cells on an OpenRouter key. Explicit paid opt-in with a missing key fails strict mode. `scope` lists all five cells; `cost` states 120 requests per enabled cell, and the separate provider probe's `turns` generation requests (default 4) plus catalog discovery. The OpenRouter cell invokes `pi -p --mode json --provider openrouter` with its pinned model and Task 21's isolation flags. While unauthorized, record the cell as `unmeasurable` with a reason; do not claim parity.
    - Functional: The gate passes when, for every conclusive cell, Prism's median `hitRate` is at least pi's median `hitRate`, and no Prism run reports `usage_mismatch`. An `inconclusive` cell fails strict mode and is rerun once.
    - Functional: The evidence file also carries the probe-cell table from this plan's release facts (OpenAI Codex, Command Code, Kilo, Ollama Cloud, LiteLLM), each with its evidence link and status. Probe cells are re-run only if their provider's lever code changed after the recorded run. The Kilo CLI headless reference owed on the plan-203 fixture runs once for the free-model Chat cell. Paid cells the owner has not authorized stay `unmeasured` with the reason, never `pass`.
    - Functional: The first run is recorded in `docs/_evidence/cache-parity-0.13.0.md`: commit, harness versions, a per-cell table, and a verdict. If Prism is behind on a cell, the executor investigates before changing code (`investigate-first` skill). The candidates, in order: the prefix segment that changed between requests (Task 22's runner on the recorded bodies), marker placement compared with pi's (Task 21 (c)), and a missing affinity header (Task 21 (d)). The fix lands in the owning plan 182 or 182 task, which is reopened with a note, and the cell is rerun. The evidence file keeps every run.
    - Performance: Record actual requests per cell against the ceiling.
    - Code Quality: The gate logic lives in `scripts/cache-parity/metrics.mjs`, not in the manifest runner.
    - Security: Same as Task 23.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.mjs` (row schema, strict mode); Task 23 report format; Task 30 (triage classes).
    - Options Considered:
      - Allow a tolerance (Prism within 2 points of the reference). Rejected: the owner asked for "at least equal". Noise is handled by medians and one rerun of an inconclusive cell, not by a margin.
    - Chosen Approach:
      - A strict per-cell comparison of medians, a recorded first run, and an investigation loop for any gap.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.json`, `docs/live-testing.md` (generated table), `scripts/cache-parity/metrics.mjs`, `docs/_evidence/cache-parity-0.13.0.md` (new), `docs/_evidence/cache-parity/*` (reports), `CHANGELOG.md`.
    - References:
      - owner requirement 2026-10-16 ("cache hit rate at least equal to the native harnesses").
  - Test Cases to Write:
    - `parity_gate_passes_when_prism_median_at_least_pi`, `parity_gate_fails_on_lower_median`, `parity_gate_fails_on_usage_mismatch`, `parity_gate_strict_fails_inconclusive`, `parity_row_skips_without_pi`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md` (generated row), evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08; live, paid accounts as authorized by the 2026-11-08 amendment: about 390 parity requests plus 11 Kilo CLI requests, one 3-request raw-usage probe and one 1-request probe against Command Code).
    - **Verdict.** After three defects were found and fixed (below), all four enabled cells **pass** on the final code: Command Code chat 0.848 vs pi 0.779, Responses 0.836 vs 0.739, Messages 0.742 vs 0.680 (Prism solved 2 of 3 runs, which is the comparability floor), Ollama Cloud 0.866 vs 0.860 (a tie in practice, ranges overlap). No cell was `inconclusive`, so no rerun was needed. The **first run did not pass** (Responses `usage_mismatch`, Messages `behind`); it and the two interim reruns are kept and explained run by run in `docs/_evidence/cache-parity-0.13.0.md` (the evidence file keeps every run; `docs/_evidence/cache-parity/` holds 14 reports and 4 gate summaries, and a repeated cell on one day gets a `-2`, `-3` suffix instead of overwriting). Requests per cell 28–50 against the 120 ceiling.
    - **What changed.** (1) `scripts/cache-parity/metrics.mjs`: `parityGate(cells, { strict })` (`behind`, `usage_mismatch`, `budget_exceeded`, `reference_config_mutated` fail always; `inconclusive` and `unmeasurable` fail only in strict mode; `deferred` never fails; no tolerance margin) and `shouldRerun` (a first `inconclusive` only). (2) `scripts/cache-parity/live.mjs` (new): the manifest command; `preflight` (`pi` on PATH, both extensions installed; a miss skips with a reason, strict mode fails it), `runGate` (one rerun of an inconclusive cell, every attempt kept), `PRISM_LIVE_PARITY_CELLS=<ids>` to rerun a subset, a `gate-<date>[-n].json` summary. (3) `scripts/live-matrix.json` row `release/cache-parity` (requires `PRISM_LIVE_PROVIDER_TESTS`, `PRISM_LIVE_CACHE_PARITY`, `COMMAND_CODE_API_KEY`, `OLLAMA_API_KEY`; four model envs; optional `PRISM_LIVE_OPENROUTER_PAID`, `OPENROUTER_API_KEY`; cost 120 requests per cell), `docs/live-testing.md` regenerated and a "Cache parity" section. (4) `scripts/cache-parity/kilo-cli-reference.mjs` (new): the owed Kilo CLI headless run on plan 203's fixture. (5) Tests: `live.test.mjs` (the five named gate tests plus rerun, abort, row, cells, Kilo summary, driver config) registered in `scripts/run-all-tests.mjs`.
    - **Findings from the live run, each fixed where all callers route** (investigated with recorded bodies and raw usage before any change; the Task 21 (e) candidates were all fine, the cause was elsewhere). (1) The reference host's `modelRef` (`apps/prism-agent/src/host/config.ts`) dropped `compat` and `cache` from a model object, so Command Code ran `gpt-5.6-luna` on Chat and `claude-haiku-5-5` with no `cache_control` marker; the host now passes `compat`, `cache` and `capabilities` through and the runner's driver copies them from the provider's static catalog (`scripts/cache-parity/host-model.ts`). **This is a real product defect for any host config that names a Command Code model by a plain object**; a host that builds the object from the catalog was never affected. (2) `scripts/wire-proxy.mjs` `normalizeUsageMetrics` read Command Code's Chat usage (top-level `cache_creation_input_tokens`) and OpenAI Responses usage as Anthropic's exclusive shape; it now detects `prompt_tokens`, then `input_tokens_details`, then Anthropic. **Any parity or probe number produced from a Responses wire or a Command Code Chat wire before this fix read cache as 0; the provider probes read the provider's own usage events, not the wire proxy, so they are unaffected.** (3) `mapOpenAIChatUsage` and `mapOpenAIResponsesUsage` (`src/provider-kit`) did not read the vendors' cache-write counts, so Prism's `cacheWriteTokens` was missing; fixed, tests in `provider-usage.test.ts`. Plans 182 and 205 carry a one-line reopen note. Other runner fixes: the `copyDir` filter skipped every file of an extension that lives under a `node_modules` path (the offline tests never saw it), a second report on a day no longer overwrites the first, and `harness_failed` records a secret-scanned stderr tail.
    - **Kilo CLI headless reference (owed).** Run once on the free model, Chat: reuse **0.858**, but on a 25 267-token first request (the CLI's own prompt and 24 tools) against Prism's probe at 8 570 tokens (0.506). The cached share rises with prefix size on this upstream, so the numbers are **not comparable and no parity or lead is claimed**; a same-prefix comparison was not run. The paid Kilo Responses and Messages cells stay `unmeasured` (402). Not part of the enabled gate.
    - **Probe cells re-recorded in the evidence file, not re-run.** OpenAI Codex (Prism 0.983; pi side `unmeasured`), Codex CLI (Prism leads), Kilo (0.506 / 0.506 / 0.337), LiteLLM (no cell); Command Code and Ollama Cloud are superseded by the full cells. This task's only shared-kit edits are two usage-mapper bodies, not a request lever, so no probe was repeated. Deferred (never failed): Hyper, OpenCode Go, paid OpenRouter.
    - **Verification.** `bun test` on `scripts/cache-parity/{run,live,provider-probe}.test.mjs`, `scripts/{wire-proxy,run-all-tests,live-doc-check,live-matrix}.test.mjs`: 94 pass. `src/__tests__/provider-usage.test.ts`, `openai-primitives`, `openai-responses-codec`: pass. `apps/prism-agent` `bun test src` 63 pass and `tsc --noEmit` clean; `packages/providers/commandcode` 27 pass. `bun run typecheck` clean. `bun scripts/generate-live-docs.mjs --check` in sync. `scan-secrets` over `scripts/cache-parity`, `docs/_evidence/cache-parity*` and `docs/_evidence/cache-probe`: 0 findings.
    - **Not green, and not from this task.** (a) `bun scripts/release.mjs gate` is red on compat lines for `createOpenAICompatibleProvider`, `createRoutedProvider`, `createHyperProvider`, `createOpenCodeGoProvider` (the in-flight `routed-provider.ts` / `openai-compatible.ts` return type `RoutedProvider`, present in the tree before this task) and on kernel size budgets (`packedBytes` +11 362, `sourceLines` +170, `rootExports` +7); neither mapper this task edited is listed. Both belong to Task 26/28 (baselines, budgets). (b) `src/__tests__/provider-kit.test.ts` `no_workspace_imports_prism_providers` fails on `packages/hosts/host-builder/skills/prism-host-builder/references/upgrading.md` naming the retired `@arnilo/prism-providers` package: the host-builder skill text, not this task.
    - **Findings for later tasks.** (1) Task 25/28 baseline regeneration starts from the red gate in (a); regenerate after the `RoutedProvider` change is settled. (2) Task 36 (CI): the `release/cache-parity` row needs `pi` and two extensions on the runner, so it stays manual-only (`workflow_dispatch`), never scheduled. (3) Task 11/12 host-builder kit: the `modelRef` finding means a kit that scaffolds a host config for Command Code should emit `compat`/`cache` from the catalog; worth a line in the host-builder reference, not done here. (4) Prism sends 13 tools against pi's 4 and takes more requests per task; the larger prefix is the shipped product's and is in the report, not a defect.

### Part E — surface reduction and shape freeze (ex-plan 185)

- [x] Task 25: Entry check against plan 179's review (read-only) (was plan 185 Task 1)
  - Acceptance Criteria:
    - Functional: The task note re-runs plan 179 Task 1's inventories on the current tree and records the differences:
      - (c) the root-surface table: rows whose callers vanished with the 17 provider packages (for example `pinnedFetch`'s `providers/alibaba` and `providers/openai/images` callers, `trimTrailingSlashes`' 39 provider files), and any export plan 182 added to the kit (`createRoutedProvider`, `normalizeUsage`, `replayFetch`, codec options);
        - **One caller is new since plan 179's review:** plan 193 Task 2 (executed 2026-10-24) created `packages/tools/web/src/native/fetch.ts`, which imports `assertSsrfAllowedUrl`, `defaultResolver`, `requestPinned` and `resolvePinnedAddress` from the root `@arnilo/prism` because `pinnedFetch` itself rejects 3xx responses and cannot serve its redirect loop. Task 26's sweep must rewrite the `defaultResolver`, `requestPinned` and `resolvePinnedAddress` imports to `@arnilo/prism/net` (only `assertSsrfAllowedUrl` stays at the root), which is why the file is named in this task's file list; plan 193 recorded the handoff in its own Further Actions.
      - (d) the retirement table: `resolveCredentialValue` / `CredentialValueSource` callers, now the six provider packages (including `liquid`, plan 196, and `packages/providers/openrouter`, plan 203), the kit (`routed-provider`, `systemone*`), `packages/tools/web`, and `packages/hosts/channels`; `toolCallStrictness: "legacy"`, whose only caller (`neuralwatt`) was deleted, so the union member may have no caller left;
      - each `graft callers <symbol> --depth all` result Tasks 26–27 will edit.
      - (f) the surface added since the superseded plan was written: `Skill.requiresTools` and `skill_unavailable` (Task 6), `skillResources` (Task 10), `@arnilo/prism-host-builder` (Tasks 14–19), observability's local telemetry types (Task 3), and the experimental classification of the five memory packages (Task 2), whose baselines are regenerated but whose changes never fail the gate.
      - (e) plan 189's surface deltas, recorded 2026-10-21 from the landed code — the freeze must describe the tree as it is, not as plan 179 saw it:
        - **Gone from `@arnilo/prism-tools-coding`:** the tools `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree`; the exports `createRepoListTool`, `ListToolOptions`, `createGitBranchTool`, `createGitWorktreeTool`, `createGitApplyTool`, `classifyGitBranchEffect`, `classifyGitWorktreeEffect`, `classifyGitApplyEffect`, `normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `createCodingPatchReviewManifest`, `assertCodingPatchAccepted`, `CodingPatchReviewError`, `resolveCodingReviewLimits`, the 14 `CodingPatchReview*`/`CodingReview*`/`ReviewDiagnosticSeverity` types, `DEFAULT_`/`HARD_MAX_REVIEW_REVISIONS`, `DEFAULT_`/`HARD_MAX_REVIEW_MANIFEST_BYTES`; the members `AppliedEditsResult.usedFuzzyMatch`, `EditToolDetails.fuzzy`, `ToolsOptions.list`, `GitToolsOptions.onEvent`, `GlobToolOptions.braceExpansion`; and the `repo_list` entry of `PATH_ARG_KEYS`.
        - **Added:** `grep` + `createGrepTool`/`GrepToolOptions` (replacing `repo_search`, with `literalMatcher`/`matchLines` on the agent surface and the `RepositoryFileMatcher` seam on `RepositorySearchRequest`), `compileGlob`, `generateChangedLinePreview`, `shell_output` + `createShellOutputTool` + `ShellOutputToolOptions`, `createBackgroundProcesses` + `BackgroundProcesses`/`BackgroundStartInput`/`BackgroundStarted`/`BackgroundRead`/`BackgroundReadInput`/`BackgroundProcessOptions`, `DEFAULT_MAX_BACKGROUND_PROCESSES`/`HARD_MAX_BACKGROUND_PROCESSES`/`HARD_MAX_BACKGROUND_WAIT_SECONDS`/`BACKGROUND_FIRST_OUTPUT_MS`, `diagnostics` + `createDiagnosticsTool`/`DiagnosticsToolHandle`/`DiagnosticsToolOptions`, `ToolsCodingLanguageConfig`/`ToolsCodingLanguageServerConfig`, `languageIdForPath`, `ToolsOptions.shellAvailable`, and the `diagnostics`/`shell_output` entries of `PATH_ARG_KEYS`.
        - **Kernel:** `serializeToolResultJson` → `serializeToolResultText` (new projection: `result` as-is, else `error.message`, else joined text blocks, else `""`), plus `OMITTED_TOOL_RESULT_IMAGE_NOTE`; Anthropic tool results can be `text`+`image` blocks with `is_error`, OpenAI tool images move to a following `user` message, and `assertMessagesSupportModelCapabilities` no longer rejects media in role `tool`.
        - **Baselines:** every `scripts/compat-baseline/*.txt` was regenerated on 2026-10-21 (15 files, +766/−967) and `bun scripts/release.mjs gate` is clean, so Task 28's regeneration starts from a post-189 baseline and must be format-only.
        - **What today's baselines do and do not freeze:** they record a name per line with either its `export declare function` signature or the `export type { … } from "…"` / `export { … } from "…"` statement that carries it, so a rename or removal is caught but an interface member change is not (that is this plan's Task 28). They also miss interfaces declared directly in a package's barrel: `ToolsOptions` is exported from `packages/tools/coding/src/agent/index.ts:580` yet absent from `scripts/compat-baseline/arnilo__prism-tools-coding.txt`, because `extractDeclaredSurface`'s declaration matcher requires `export declare interface` while a module `.d.ts` emits a bare `export interface`, and no `export type { … }` statement names it (there is not a single `interface` body in any baseline today). Task 28 must resolve each name to its declaration site, and the `ToolsOptions.shellAvailable` / `EditToolDetails` / `GitToolsOptions` member changes above are only shape-frozen once it does.
        - **`worktree_changed` is live again:** plan 189's Task 8 removed the `git_worktree` tool that emitted it, and the follow-up gave the kind a producer at the `workspace` service (`createWorkspaceService({ onEvent })` emits `add` on `worktree.create` and `remove` on dispose, through `createCodingLifecycleEmitter`). The kind, its ACP projection, and `scripts/phase10-freeze-manifest.json` are unchanged, so the freeze can treat it as a shipped, produced kind; only `WorkspaceServiceOptions` grew an optional field.
        - **Frozen lists and boundary gates reconciled 2026-10-21 (before this plan starts):** the plan 182/183 drift that made the root suite red is absorbed, so Task 28 freezes a green surface instead of a known-red one. `src/__tests__/provider-kit.test.ts`'s inventory gained the six kit names it lacked (`isLoopbackHost`, `isPlaintextRemote`, `plaintextRemoteOrigin`, `systemOneConformance`, `systemOneProviderPackage`, `warnIfPlaintextRemote`) and its provider-tree guard now compares against the package directories instead of `> 20` files (14 provider packages remain); `FROZEN_PROVIDER_KIT_EXPORTS` gained those six and `FROZEN_TESTING_EXPORTS` gained `DEFAULT_LIVE_CACHE_PREFIX`, `LIVE_WEATHER_TOOL`, `checkLayaServerReachable`, `executeProviderLiveScenarios`, `executeSystemOneLiveScenarios`, `runProviderLiveScenarios`, `runSystemOneLiveScenarios`; `scripts/host-surface-allowlist.json` `phase17` gained `RunResultStatus`; `src/__tests__/core-boundaries.test.ts` sanctions `src/testing/provider-live-scenarios.ts` as a provider-literal seam; `src/__tests__/network-free-guard.test.ts` matches live test files by basename instead of by a `live` path substring (which had flagged 23 `delivery/` files). `bun test --timeout=0 src/__tests__` is 4204 pass / 0 fail. Whatever these lists say now is the input to Task 28's baseline regeneration — do not re-add a name that is absent.
      - Verdict: Tasks 26–29 proceed as written with the updated tables, or the plan is re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every changed row cites `file:line`.
    - Security: n/a — read-only.
  - Approach:
    - Documentation Reviewed:
      - plan 179 Task 1 notes; plans 182–183 and 189 notes; `src/index.ts`; `src/provider-kit/index.ts`; `packages/tools/coding/src/index.ts`; `packages/tools/coding/src/agent/index.ts`.
    - Options Considered:
      - Run the moved tasks on the old tables. Rejected: plans 182–183 removed about 40 of the listed callers and added kit exports, so the tables are stale; plan 189 then renamed, added, and deleted coding-tool exports and renamed a provider-kit serializer, so the tables and the baselines are stale on both sides.
    - Chosen Approach:
      - Refresh the inventory once, then execute the moved tasks.
    - API Notes and Examples:
      ```bash
      graft callers CredentialValueSource --depth all
      graft callers resolveCredentialValue --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - plan 179 Task 1; plans 182–183; plan 189 (Task 25 (c)'s dead-module verdict and its task notes).
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08): read-only; no source edited. Inventories re-run on the current tree with `rg -lw` (non-test, non-`dist`, non-generated) cross-checked with `graft callers --depth all` where graft resolves the name (`CredentialValueSource` has two definitions, so graft reports none; `rg` is the source for it). **Verdict: Tasks 26–29 proceed as written; three amendments applied in place (Task 26 consumer list, Task 26 caller list, Task 27 provider list), one prerequisite recorded for Task 28 (finding 4), and none changes a task's premise.**

    **(c) Root-surface table, current tree.**

    | root export(s) | non-test callers now | change since plan 179 | decision |
    | --- | --- | --- | --- |
    | `pinnedFetch` | `integrations/mcp/transport`, `memory/rag` (`tei-reranker`, `connectors/google-drive`, `rerank-shared`), `policy/governance/opa`, `tools/openapi/specs`, `tools/work` (`document-reader/mistral-ocr`, `connectors/http`); `tools/web/native/fetch.ts` only in a comment | `providers/alibaba` ×2 and `providers/openai/images` gone with plan 182; `tools/work/connectors/http` is a second `tools/work` caller | move `/net` |
    | `requestPinned`, `resolvePinnedAddress` | `integrations/mcp/transport`, **`tools/web/native/fetch.ts:12-17` (new, plan 193)** | +1 each | move `/net` |
    | `defaultResolver` | `integrations/mcp/transport`, `tools/web/{obscura/web,obscura/cli,native/fetch}` | +`native/fetch.ts` | move `/net` |
    | `raceAbort`, `isLoopbackAddress` | `integrations/mcp/transport` only (`raceAbort` also `src/content.ts:467`, kernel-internal) | none | move `/net` |
    | `boundResponse` | `hosts/mcp-server/server`, `integrations/mcp/transport` | none | move `/net` |
    | `isLoopbackHostname` | `hosts/{devtools/serve,remote/transports/network}`, `integrations/mcp/{transport,oauth-metadata}` (the latter imports it from `./transport`), `tools/openapi/compile`, **`tools/web/transport.ts:1,60` (new)** | +`tools/web/transport` | move `/net` |
    | `normalizeHostname` | `integrations/mcp/transport`, `tools/web/{obscura/cli,domains}` (**`domains.ts:5,81` new**); kernel `content.ts`, `media-types.ts` | +`tools/web/domains` | move `/net` |
    | `PinnedFetchOptions` | 0 | none | move `/net` |
    | `assertSsrfAllowedUrl` | `memory/wiki/ingest`, `policy/governance/opa`, `integrations/mcp/transport`, `tools/work/mistral-ocr`, `tools/web/{index,firecrawl,obscura/cli,native/fetch}` | +`tools/web/{firecrawl,native/fetch}` | keep root |
    | `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` | 0 outside `src/` (`models/estimate.ts`, `usage-estimation.ts`, `contracts-core/usage.ts`) | none | delete from root |
    | `EventSubscriber`, `SubscriberOverflowError` | 0 outside `src/` (`agent-session/{session,create-agent}.ts`, `agents.ts`) | none | drop value export |
    | `RunLimitTracker` (value), `createRunLimitTracker` | 0 outside `src/`; `hosts/ag-ui/src/__tests__/public-api.test.ts:19` only lists the name in an allowlist array | the one test caller is now a name list, not a call | drop the value export; keep type and factory |
    | `trimTrailingSlashes` | kit (`routed-provider`, `systemone`, `systemone-provider`), `models/builtin.ts`, and every provider `models.ts`/`provider.ts` that builds a URL (`commandcode`, `hyper` ×2, `kilo`, `litellm` ×2, `ollama-cloud` ×2, `opencode-go`, `openai-codex`) | the 39 provider files collapsed to 10 | keep root |
    | artifacts (`ArtifactRecord`, `ArtifactBodyStore`, `ArtifactCitation`, `ArtifactRevision`, `ArtifactApproval`, `citationBindingDigest`, `HARD_CITATION_EXCERPT_BYTES`, rest) | `tools/work` (8 files, `ArtifactBodyStore`), `tools/web/normalize.ts`, `hosts/evals` (`citation-integrity`, `citations`), **`memory/rag/citations.ts` (new)**; `ArtifactRecord`, `ArtifactError`, `ArtifactBodyStoreError`, `artifactApprovalState`, `artifactCheckpointKey` have **0** outside `src/artifacts.ts` | `tools/coding` no longer consumes `ArtifactRecord` (plan 189 deleted the review manifest); `memory/rag` is a new consumer | move `/artifacts` |
    | `registerContextSources`, `withContextBlocks`, `ContextSource` | `memory/fabric/context`, `memory/rag/context`, `context/files/instructions`, examples | none | keep root |

    Kit additions from plan 182 and later (all via `export *` in `src/provider-kit/index.ts`): `createRoutedProvider` (`routed-provider.ts:86`), `normalizeUsage` (`usage.ts:35`), `replayFetch` and `assertRecordedStreamConforms` (`wire-replay.js`), the three codec modules (`codecs/{anthropic-messages,openai-chat,openai-responses}.js`), `systemone*`, `provider-request-policy`. The `src/content.ts:14` static `pinnedFetch` import that blocks `root_entry_does_not_import_node_http` is unchanged (`content.ts:434` still calls it).

    **(d) Retirement table, current tree.**

    | shape | definition | callers now | verdict |
    | --- | --- | --- | --- |
    | `resolveCredentialValue` | `src/credentials/legacy.ts:24`, root `src/index.ts:215` | 21 files: kit `routed-provider.ts`, `systemone.ts`; `tools/web/src/transport.ts:1`; the `models.ts`/`quota.ts`/`spend-logs.ts` model-listing helpers of `commandcode`, `hyper` ×2, `kilo`, `litellm` ×2, `ollama-cloud`, `openai-codex`, `opencode-go`, `openrouter`; tests `credentials-redaction`, `docs`, `public-export-contract`, `scripts/phase21-freeze*` | delete; Task 27 |
    | `CredentialValueSource` | `src/credentials/legacy.ts:8`, root `src/index.ts:214`; `channels/telegram.ts:31` is a **separate local type** with the same name | 37 files (35 non-test, one of them channels' separate type): **all 11** provider packages (`commandcode`, `hyper`, `kilo`, `laya`, `liquid`, `litellm`, `ollama-cloud`, `openai-codex`, `opencode-go`, `openrouter`, `typesafe`), kit `{openai-compatible,provider-package,routed-provider,systemone,systemone-provider}.ts`, `tools/web/types.ts`, `examples/custom-provider.ts`, `docs/{provider-kit,credentials-and-redaction}.md`, `litellm/README.md`, `scripts/phase21-freeze-manifest.json` | delete; Task 27 |
    | `CredentialRecord` | `src/credentials/legacy.ts:14`, root `src/index.ts:214` | `packages/credentials/keyring/src/{vault,file-store,encrypted-store}.ts` | keep; move to `record.ts` (as Task 27 says) |
    | `toolCallStrictness: "legacy"` | union member `src/contracts-core/content.ts:163` | no provider sets it (`neuralwatt` gone); the only mentions are `scripts/provider-toolcall-conformance.test.mjs:45,48` (fixture input) | drop the member; update that test |
    | `InputAssemblyLayout "legacy"` | `src/contracts-protocol.ts:58`; branches `src/input.ts:180,225` | tests `public-contracts.test.ts:143`, `input-pipeline.test.ts:140,667`, `invalidation-inventory.test.ts:102,163` use `"legacy"` | make `"cache_aware"` only; those tests move with it |
    | `AgentDefinition.create`, `activateAllCapabilities` | `src/contracts-core/agent.ts:42`, `:51` | 0 callers (only `docs/migration.md:188,321-350` and `docs/history`) | delete both; update the `docs/migration.md` rows |
    | `maxToolRounds` shim | `src/agent-session/session/assemble.ts:647-649` (moved from 600-602; it is a `TypeError` rejection of `RunOptions.maxToolRounds`, not a forwarding shim) | none; the `limits.maxToolRounds` axis stays (`run-limits.ts`, `contracts-core/run-limits.ts`) | delete the rejection only |
    | `ProductionPersistenceStore` | `src/contracts-core/persistence.ts` | `stores/{sqlite,postgres}/persistence`, `hosts/{evals,ag-ui}`, `src/testing/*-conformance.ts`, `examples/external-app-db-backed.ts` | keep (production contract) |
    | channels | `packages/hosts/channels/src/telegram.ts`: local `CredentialValueSource` `:31`, `botToken` `:68,:122,:578`, `webhookSecret: string` `:123`, validation `:1082,:1121`, options `:1191` | unchanged | ref-only as planned |

    Graft results Tasks 26–27 edit: `graft callers resolveCredentialValue --depth all` returns 41 files' worth of edges (the table's 21 plus transitive callers); `graft callers pinnedFetch --depth all` returns 56 files' worth. `CredentialValueSource` is ambiguous in graft (two definitions), so `rg -lw` is the inventory for it.

    **(f) Surface added since the superseded plan.** Confirmed in the tree: `Skill.requiresTools` and `skill_unavailable` (`src/skill-load.ts:7,110`, `src/skill-disclosure.ts:59-66`, `src/contribution-parsing.ts:492-543`); `skillResources` (`packages/hosts/mcp-server/src/skill-resources.ts`, exported from its `index.ts`); `@arnilo/prism-host-builder` (`packages/hosts/host-builder/src`: `check`, `install`, `lookup`, `server`, indexes); observability's local telemetry types (`createInMemoryTelemetry`, `DelegationTelemetry`, `EvaluationTelemetry`, `InMemoryTelemetry` in `packages/integrations/observability/src/index.ts`); experimental classification: `memory/{core,fabric,observational,rag,wiki}` are `0.13.0-experimental.0` and `memory/compaction` stays `0.13.0`. The gate prints `compat (experimental, not gated): @arnilo/prism-memory-core removed: readFileMap, writeFileMap; changed: renderIndexFile` and does not fail on it.

    **(e) Plan 189 deltas and the baseline state, re-checked.** (1) `ToolsOptions` is still declared at `packages/tools/coding/src/agent/index.ts:580`; the baseline format is unchanged, so Task 28's premise holds. (2) `bun scripts/release.mjs gate` is **red** exactly as Task 24 recorded: compat `changed` on `createOpenAICompatibleProvider` and `createRoutedProvider` (kernel), `createHyperProvider`, `createOpenCodeGoProvider` (the `RoutedProvider` return type), and kernel budgets `packedBytes` +11 586, `unpackedBytes` +35 190, `rootExports` +7, `sourceLines` +170. Task 28's regeneration therefore does **not** start from a clean post-189 baseline, and its "format-only" claim needs the four `changed` lines attributed to the `RoutedProvider` return type before regenerating. (3) The 52 baselines with no live workspace (`prism-agent-sdk`, `prism-code`, `prism-core`, `prism-memory`, `prism-provider-openai`, …) are **not orphans**: `scripts/release-gate.test.mjs:552-566` (`no_compat_baseline_without_workspace`) sanctions them as the symbol source of the 0.3.3 legacy-registry records. Task 28 and Task 35 must not delete them; Task 14's index already iterates live manifests only.

    **Findings that amend later tasks (1–3 applied in place; 4 is a prerequisite Task 28 must run first).** (1) Task 26: the artifacts consumers are `tools-work`, `tools-web`, `evals` and `memory-rag` (not `tools-coding`); five of its names have no caller outside `src/artifacts.ts`. (2) Task 26: the caller list gains `packages/tools/web/src/{transport,domains,obscura/web,obscura/cli}.ts`, `packages/hosts/{devtools,mcp-server,remote}`, and the generated copies `packages/hosts/host-builder/data/{api.json,examples/*}` (regenerate with Task 14's generator, never hand-edit) plus `scripts/phase16-freeze-manifest.json`, `phase21-freeze-manifest.json`, `phase21-baseline.json`, `host-surface-allowlist.json`. (3) Task 27: the provider set is the **11** packages above, not six; `typesafe` and `laya` do not appear in `models.ts` callers of `resolveCredentialValue` but do in `CredentialValueSource`. (4) Pre-Task 28 prerequisite: `src/__tests__/provider-kit.test.ts` `no_workspace_imports_prism_providers` is still red on `packages/hosts/host-builder/skills/prism-host-builder/references/upgrading.md` naming the retired `@arnilo/prism-providers` (Task 24 (b)); reword that file or sanction it as a negative guard before the freeze, so the freeze starts green. `public-export-contract` and `packaging` tests pass (336 pass, 1 fail across the three suites run).

- [x] Task 26: Reduce the root surface (was plan 185 Task 2)
  - Acceptance Criteria:
    - Functional: Apply plan 179 Task 1 (c)'s table:
      - `artifacts.ts` exports move to a new subpath `@arnilo/prism/artifacts` (plan 179 Task 1 (c): four consumers — `tools-work`, `tools-web`, `evals`, `memory-rag`; Task 25 found `tools-coding` no longer consumes it and `memory-rag/citations.ts` is new);
      - network plumbing moves to `@arnilo/prism/net`: `pinnedFetch`, `requestPinned`, `resolvePinnedAddress`, `defaultResolver`, `raceAbort`, `boundResponse`, `isLoopbackAddress`, `isLoopbackHostname`, `normalizeHostname`, `PinnedFetchOptions` (the root keeps `assertSsrfAllowedUrl`, which hosts call directly, unless plan 179 Task 1 finds otherwise). Callers include `packages/tools/web/src/native/fetch.ts` (added by plan 193 Task 2), which imports `assertSsrfAllowedUrl`, `defaultResolver`, `requestPinned` and `resolvePinnedAddress` from the root; after this task it takes the last three from `@arnilo/prism/net` and keeps `assertSsrfAllowedUrl` at the root;
      - zero-caller exports are removed from the root: `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` (if unused), the `EventSubscriber` and `RunLimitTracker` classes as values (their types stay exported where public signatures use them: `RunLimitTracker` stays a type export because `RunController.limits` names it; `EventSubscriber` appears in no public signature, so it leaves the surface entirely; `SubscriberOverflowError` stays a root value because hosts catch it from the iterator and `docs/events.md` documents it — Task 25's table row grouped it with `EventSubscriber`, the execution kept it);
      - `context-build.ts` (`registerContextSources`, `withContextBlocks`, `ContextSource`): **kept at the root** — plan 179 Task 1 (c) found three package groups consume it (`memory/fabric`, `memory/rag`, `context/files`) plus examples, so no single owning package exists.
    - Functional: Every caller in `packages/`, `apps/`, `examples/`, and tests is updated in this task; `bun run typecheck` is green at the end.
    - Functional: `package.json` `exports` gains `./artifacts` and `./net`; `src/__tests__/packaging.test.ts` and `public-export-contract.test.ts` list them; the freeze arrays drop the removed names deliberately.
    - Functional: Retirement sweep for each removed root name over `src/ packages/ apps/ scripts/ examples/ docs/`.
    - Performance: The root entry no longer pulls `node:http`/`node:https`. plan 179 Task 1 (c) found `src/content.ts:14` statically imports `pinnedFetch` from `./pinned-fetch.js`, so moving the root re-exports alone does not clear the edge: decouple `content.ts` (lazy `import("./pinned-fetch.js")` inside the default media fetch, or inject the fetch) and record the root import graph before and after (`scripts/phase16-tree-shake.mjs` or the kernel import-boundary test) in the note.
    - Code Quality: Subpath modules are thin re-export files under `src/artifacts/index.ts` and `src/net/index.ts`; no duplicate implementations.
    - Security: `@arnilo/prism/net` documents that it is the only supported SSRF-safe fetch; no security helper disappears without a subpath.
  - Approach:
    - Documentation Reviewed:
      - `src/index.ts`, `src/pinned-fetch.ts`, `src/artifacts.ts`, `src/context-build.ts`, `src/usage-estimation.ts`, `package.json` `exports`, roadmap §1.4 ("the kernel knows no package names") and §2 kernel scope.
    - Options Considered:
      - Leaving everything at the root. Rejected: every export is a permanent promise; domain modules contradict the kernel's stated scope.
      - Moving artifacts into `tools-work`. Rejected: `evals` would then depend on a tool package.
    - Chosen Approach:
      - Subpaths for multi-consumer plumbing and domain types; deletion for unused internals.
    - API Notes and Examples:
      ```ts
      import { pinnedFetch } from "@arnilo/prism/net";
      import type { ArtifactRecord } from "@arnilo/prism/artifacts";
      ```
    - Files to Create/Edit:
      - `src/index.ts`, `src/net/index.ts` (new), `src/artifacts/index.ts` (new; `src/artifacts.ts` moves under it), `src/content.ts` (lazy-import the pinned fetch, per the performance criterion), `package.json` `exports`.
      - callers from plan 179 Task 1 (c) in `packages/tools/{work,openapi,web}` (web: `transport.ts`, `domains.ts`, `obscura/{web,cli}.ts`), `packages/integrations/mcp`, `packages/memory/rag`, `packages/policy/governance`, `packages/hosts/{evals,remote,devtools,mcp-server}`, `apps/prism-agent`, `examples/`, the generated `packages/hosts/host-builder/data/{api.json,examples/*}` (regenerate with Task 14's generator), and the frozen lists `scripts/{phase16-freeze-manifest,phase21-freeze-manifest,phase21-baseline,host-surface-allowlist}.json` — plus `packages/tools/web/src/native/fetch.ts` explicitly (plan 193 Task 2's new caller of `defaultResolver`/`requestPinned`/`resolvePinnedAddress`/`assertSsrfAllowedUrl`), so the sweep cannot miss the file that did not exist when plan 179 ran.
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/kernel-constraints.test.ts` (import boundary).
      - `scripts/compat-baseline/arnilo__prism.txt` and each touched package's baseline: regenerated; the note lists removals attributed to this plan.
      - `docs/host-security.md` section "Outbound network: `@arnilo/prism/net`" (chosen over a new `docs/net.md`: the subpath is ten names with one security contract, and the page already owns the SSRF guidance), `docs/migrate-to-0.13.md`, `CHANGELOG.md`.
      - Found during execution: `src/__tests__/host-surface-gate.test.ts` (`PUBLIC_SUBPATHS` gains `net` and `artifacts`, since `evals`, `remote` and `devtools` now import them), `packages/integrations/mcp/src/{transport,oauth-metadata}.ts` (the unreachable `transport.ts` re-exports of seven pinned-fetch helpers are deleted), `src/__tests__/{run-limits,usage-estimation,usage-calibration,artifacts-coverage,install-smoke}.test.ts`, `scripts/phase21-security.test.mjs`, `scripts/budgets.json` (kernel ceilings).
    - References:
      - review finding "Domain and implementation code would be frozen into the kernel" (2026-10-15).
  - Test Cases to Write:
    - `root_surface_matches_reviewed_table`: the freeze arrays equal the plan 179 Task 1 table.
    - `net_subpath_exports_pinned_fetch`, `artifacts_subpath_exports_records`.
    - `net_subpath_sweep_leaves_no_root_network_import`: no file under `packages/`, `apps/`, `examples/` or `src/` still imports a moved network name from the root, and the sweep names `packages/tools/web/src/native/fetch.ts` first (plan 193's new caller).
    - `root_entry_does_not_import_node_http`: import graph of `src/index.ts` excludes `node:http`/`node:https`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exports move.
    - Docs pages to create/edit:
      - `docs/host-security.md` section (chosen; no new page).
      - `docs/migrate-to-0.13.md`: moved imports table.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no (no new page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed.** New subpaths `@arnilo/prism/net` (`src/net/index.ts`, a thin re-export of `src/pinned-fetch.ts`: `pinnedFetch`, `requestPinned`, `resolvePinnedAddress`, `defaultResolver`, `raceAbort`, `boundResponse`, `isLoopbackAddress`, `isLoopbackHostname`, `normalizeHostname`, `PinnedFetchOptions`; its doc comment states it is the only supported SSRF-safe fetch) and `@arnilo/prism/artifacts` (`src/artifacts/index.ts` over `src/artifacts/artifacts.ts`, moved with `git mv` from `src/artifacts.ts`, all 21 names). `package.json` `exports` gains `./net` and `./artifacts`. Root `src/index.ts` drops those 31 names plus `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` and the `EventSubscriber` value; `RunLimitTracker` becomes a type export (`createRunLimitTracker` stays). `assertSsrfAllowedUrl`, `trimTrailingSlashes`, `registerContextSources`/`withContextBlocks`/`ContextSource` and `SubscriberOverflowError` stay at the root. `src/content.ts` loads `./pinned-fetch.js` with a lazy `import()` inside the default media fetch.
    - **Callers rewritten (32 files):** `packages/tools/web/src/native/fetch.ts` (plan 193's caller: `defaultResolver`/`requestPinned`/`resolvePinnedAddress` from `/net`, `assertSsrfAllowedUrl` stays root), `tools/web/{transport,domains,normalize,obscura/cli}.ts`, `tools/work` (13 files incl. tests: `ArtifactBodyRef`/`ArtifactBodyStore` → `/artifacts`; `connectors/http`, `document-reader/mistral-ocr` → `/net`), `tools/openapi/specs.ts`, `integrations/mcp/{transport,oauth-metadata}.ts`, `memory/rag/{citations,rerank-shared,connectors/google-drive}.ts`, `policy/governance/policy/opa.ts` + test, `hosts/evals/{citations,citation-integrity}.ts` + test, `hosts/remote/transports/network.ts`, `hosts/devtools/serve.ts`; kernel tests `run-limits` (class from `../run-limits.js`), `usage-estimation`, `usage-calibration` (family table from `../usage-estimation.js`), `artifacts-coverage`, `install-smoke`; `scripts/phase21-security.test.mjs`. `apps/` and `examples/` had no caller. `@arnilo/prism-mcp`'s `transport.ts` re-exported seven pinned-fetch helpers that its `exports` (`.` only) never exposed; deleted (no alias), `oauth-metadata.ts` imports `isLoopbackHostname` from `/net`. `packages/hosts/mcp-server` has its own local `boundResponse` and needed no change.
    - **Tests added:** `root_surface_matches_reviewed_table`, `net_subpath_exports_pinned_fetch`, `artifacts_subpath_exports_records` (`public-export-contract.test.ts`, plus `net_surface_is_frozen` / `artifacts_surface_is_frozen` rows with `FROZEN_NET_EXPORTS` / `FROZEN_ARTIFACTS_EXPORTS`); `root_entry_does_not_import_node_http`, `net_subpath_sweep_leaves_no_root_network_import` (`kernel-constraints.test.ts`; the sweep reads `tools/web/src/native/fetch.ts` first); `packaging.test.ts` asserts the kernel tarball ships `src/net/index.ts`, `src/artifacts/{index,artifacts}.ts`, `src/pinned-fetch.ts`. Frozen root arrays drop the 35 removed names and move `RunLimitTracker` to the type list.
    - **Root import graph (runtime, static non-type imports):** before 129 modules with `node:http`/`node:https` reached through `content.ts` → `pinned-fetch.ts`; after 127 modules, builtins `node:crypto`, `node:dns/promises`, `node:net`, `node:timers/promises`, `node:fs/promises`, `node:path` only. `src/net/index.ts` still reaches `node:http` (asserted).
    - **Frozen lists / generated data:** `scripts/host-surface-allowlist.json` `phase11` drops `ArtifactCitation`, `ArtifactApproval`, `ArtifactRevision`, `citationBindingDigest`, `HARD_CITATION_EXCERPT_BYTES`, `isLoopbackHostname` (host libraries now import them from subpaths, which `host-surface-gate.test.ts` `PUBLIC_SUBPATHS` now allows). `scripts/phase16-freeze-manifest.json`, `phase21-freeze-manifest.json` and `phase21-baseline.json` name `pinnedFetch` as a module/primitive, not as a root import, so they are unchanged. `packages/hosts/host-builder/data/` regenerated with `bun scripts/host-builder-index.mjs` (`--check` fresh; the kernel entry now lists `./net` 10 and `./artifacts` 21 symbols).
    - **Baseline diff (`bun scripts/release.mjs gate --update-baseline`).** Attributed to this task: `arnilo__prism.txt` −`ModelFamilyTokens`; `BudgetExhaustionAttribution`, `RunLimitTrackerOptions` and `type PinnedFetchOptions` lines change only because their `export … from` statement text changed (`RunLimitTracker` added to the type statement, `../pinned-fetch.js` path); `arnilo__prism-mcp.txt` −7 (`boundResponse`, `defaultResolver`, `isLoopbackAddress`, `normalizeHostname`, `raceAbort`, `requestPinned`, `resolvePinnedAddress`, the deleted unreachable re-exports). Absorbed from earlier work, not this task: the `RoutedProvider` return type on `createOpenAICompatibleProvider`, `createRoutedProvider`, `createHyperProvider`, `createOpenCodeGoProvider` and the `anthropicSegments`/`openAIChatSegments`/`defaultWireSegments`/`assertWireSegmentsStable` additions (Task 22), `extendSnapshot` (plan 210 Task 0.3), `arnilo__prism-host-builder.txt` +40 (Tasks 14–19), and the experimental `memory-core`/`memory-fabric` lines (plan 210, never gated). The moved names otherwise stay in the kernel baseline: the extractor records every declaration in the package's `.d.ts` tree, not per entry, so a root → subpath move is invisible to it — Task 28 must key the baseline by entry point.
    - **Budgets.** `scripts/budgets.json` kernel ceilings rebaselined to 1231073 packed / 3999953 unpacked / 1526 root exports / 40705 source lines with a dated reason: this task's share is +12 source lines and about 2 KB of docs text; the rest is the Task 22/plan 210 growth Tasks 24–25 recorded. `bun scripts/release.mjs gate` is now **green** (it was red since Task 24).
    - **Sweep** for every removed root name over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`): no root import of a moved name remains (enforced by `net_subpath_sweep_leaves_no_root_network_import` for the network names). Remaining mentions are prose (`packages/tools/web/README.md`, `examples/open-connector-sidecar/README.md`, `docs/migrate-to-0.7.md`), the historical `packages/integrations/mcp/CHANGELOG.md` 0.2.1 entry, and `scripts/plan-review-gate.test.mjs`'s plan 104/112 evidence lists; all left as is.
    - **Checks.** `bun run typecheck` green (kernel, every workspace, examples). Suites: `public-export-contract`, `kernel-constraints`, `packaging`, `docs`, `run-limits`, `usage-*`, `artifacts-coverage`, `pinned-fetch`, `content*` 473 pass / 0 fail; packages `mcp` 101, `tools-web` 196, `tools-work` 278, `evals` 246, `rag` 100, `governance` 125, `openapi` 24, `remote` 77, `devtools` 39, `mcp-server` 53, all 0 fail. Whole `src/__tests__`: 5480 pass / 12 fail, none touched by this task: `host_libraries_import_only_allowlisted_kernel_names` (`mcp-server/skill-resources.ts` imports `Skill`; `host-builder/check/runner.ts` computed import), `no_workspace_imports_prism_providers` and `retired_wiki_names_absent_repo_wide` (`host-builder` `upgrading.md`, Task 25 finding 4), `core runtime has no provider-specific literals` (`anthropic`), the network-free guard (`provider-live-selection.test.ts`, `tools/web` `kagi.test.ts`), the release graph count (52 vs 51 packages), the codemod check, and the tools-browser/wiki metadata tests. `scripts/budget-gate.test.mjs` (stale per-package export ceilings for deleted 0.12 packages, biome allowlist rows) and `release-gate.test.mjs` `no_compat_baseline_without_workspace` (`prism-agent-sdk`, `prism-work`) are red for the same pre-existing reasons.
    - **Findings for later tasks.** (1) Task 28: the compat extractor is per package, not per entry, so it cannot see a subpath move; the shape freeze should key names by entry point (root, `./net`, `./artifacts`, `./provider-kit`, …). (2) Task 28/35: the 12 pre-existing `src/__tests__` reds above and the stale `budget-gate`/`release-gate` rows must be fixed or sanctioned before the freeze starts green. (3) `docs/events.md`'s `SubscriberOverflowError` reference is why it stays a root value; Task 29's compatibility page should list it with the host-facing errors.

- [x] Task 27: Retire migration-era shapes (was plan 185 Task 3)
  - Acceptance Criteria:
    - Functional: Credentials: `resolveCredentialValue` and `CredentialValueSource` are deleted from the kernel (`src/credentials/legacy.ts`). `CredentialRecord` is **kept** — plan 179 Task 1 (d) found `packages/credentials/keyring` imports it from `@arnilo/prism` and uses it in its public store API; move it out of `legacy.ts` (e.g. `src/credentials/record.ts`) and keep its export. Every low-level provider factory (`createAnthropicMessagesProvider`, the OpenAI family factories, and the rest from plan 179 Task 1 (d)) takes `apiKey?: SecretSource` where `SecretSource = () => Promise<string | undefined>` is exported from `@arnilo/prism/provider-kit` (the shape `refSource` already returns, `src/provider-kit/provider-package.ts:72`). A literal string `apiKey` no longer type-checks. Explicitly migrate `packages/providers/openrouter/src/provider.ts` (`createOpenRouterProvider`, `OpenRouterProviderOptions`) and `src/models.ts` (`listOpenRouterModels`, `ListOpenRouterModelsOptions`) to `SecretSource`, including discovery's `resolveCredentialValue` caller; the manifest-facing `openrouter({ apiKey: "env:OPENROUTER_API_KEY" })` remains ref-only, with `refSource` bridging to the low-level factory/discovery.
    - Functional: Channels: `webhookSecret` and the bot token accept `env:`/`keyring:` refs only (literal → `literal_secret`), resolved through the credentials slot; channels' private `CredentialValueSource` type is deleted.
    - Functional: Layout and strictness: `InputAssemblyLayout` becomes `"cache_aware"` only (or the option is removed if plan 179 Task 1 finds no other value planned); `toolCallStrictness` drops `"legacy"`. Every input-assembly test expecting `legacy` order is updated.
    - Functional: Agent definitions: `AgentDefinition.create` and `AgentDefinitionResolutionContext.activateAllCapabilities` are removed. (The 0.12 `CommandDefinition` family is retired earlier by plan 176 Task 5, which needs it gone to turn the kernel vocabulary gate green; this task only confirms the sweep stays empty.)
    - Functional: The `maxToolRounds` shim at `src/agent-session/session/assemble.ts:600-602` is deleted (0.1.5 removal is long past; the run-options type already rejects it). Leave the `maxToolRounds` *limit axis* (`src/run-limits.ts`, `src/contracts-core/run-limits.ts`) untouched — plan 179 Task 1 (d).
    - Functional: `ProductionPersistenceStore`: kept (plan 179 Task 1 (d) — it is the production persistence contract implemented by `packages/stores/{sqlite,postgres}`); its doc comment states which packages implement it.
    - Functional: Retirement sweep for every removed name and the string `"legacy"` in kernel contracts over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`; the MCP `protocolVersion: "legacy"` era is out of scope and stays).
    - Performance: n/a.
    - Code Quality: No aliases or deprecated re-exports; `docs/migrate-to-0.13.md` carries the replacement table.
    - Security: Every secret-bearing field in first-party packages is ref-only (asserted by a test that walks package config schemas and channel options for `secretRefProperty` or ref validation).
  - Approach:
    - Documentation Reviewed:
      - `src/credentials/legacy.ts`, `src/provider-kit/provider-package.ts:60-90`, `packages/hosts/channels/src/telegram.ts:25-40,115-130,1075-1125`, `src/input.ts:120-180`, `src/contracts-core/agent.ts:31-60,240-300`.
    - Options Considered:
      - Marking them `@deprecated` and removing in a later release. Rejected: after the freeze, removal is a breaking change, and the roadmap forbids compatibility aliases.
    - Chosen Approach:
      - Delete before the freeze, with one migration table.
    - API Notes and Examples:
      ```ts
      import { refSource } from "@arnilo/prism/provider-kit";
      createAnthropicMessagesProvider({ apiKey: refSource(resolve, "env:ANTHROPIC_API_KEY") });
      ```
    - Files to Create/Edit:
      - `src/credentials/legacy.ts` (delete `CredentialValueSource`/`resolveCredentialValue`; `CredentialRecord` moves to `src/credentials/record.ts` and stays exported), `src/credentials/index.ts`, `src/index.ts`, `src/provider-kit/*`.
      - the current eleven provider packages `packages/providers/{commandcode,hyper,kilo,laya,liquid,litellm,ollama-cloud,openai-codex,opencode-go,openrouter,typesafe}` and their tests (Task 25 refreshed the inventory: 35 non-test files name `CredentialValueSource`, 21 call `resolveCredentialValue`); explicitly `packages/providers/openrouter/src/{index,provider,models}.ts` and `src/__tests__/`; `packages/credentials/keyring/src/{vault,file-store,encrypted-store}.ts`; `packages/hosts/channels/src/{telegram,signal,secret-ref}.ts` and tests.
      - `src/input.ts`, `src/contracts-protocol.ts`, `src/contracts-core/content.ts`, `src/contracts-core/agent.ts`, `src/agent-session/session/assemble.ts` and affected tests.
      - `src/__tests__/public-export-contract.test.ts`; all affected `scripts/compat-baseline/*.txt` regenerated; removals listed in the note.
      - `docs/provider-kit.md`, `docs/credentials-and-redaction.md`, `docs/migrate-to-0.13.md`, `packages/hosts/channels/README.md`, `CHANGELOG.md`.
      - Found during execution: `src/provider-kit/conformance.ts` (`systemOneConformance` typed its factory's `apiKey` as `unknown`, which hid literal keys); `packages/providers/kilo/src/provider.ts` (`KiloProviderOptions.apiKey` was a literal `string`); `packages/providers/ollama-cloud/src/native.ts` (`resolveProviderApiKey` caller); `packages/tools/web/src/{types,transport,index}.ts` and its tests (`WebCredentialSource`); `packages/tools/coding/src/config.ts` (`forge.token` was pattern-validated, not `x-prism-secret`); `scripts/host-surface-allowlist.json` (`phase11` gains `CredentialResolver`, `createEnvRefCredentialResolver` for channels); `docs/host-security.md`, `docs/settings-auth-trust-security.md`, `docs/migration.md`, `docs/testing.md`, `packages/providers/litellm/README.md`; `src/__tests__/{docs,agents,session-subscriber-ownership,provider-conformance,provider-live-scenarios,install-smoke}.test.ts`; `scripts/{phase21-security,provider-toolcall-conformance}.test.mjs`, `scripts/cache-parity/provider-probe.test.mjs`, `scripts/fixtures/e2e-full-surface-journey.mjs`; `examples/{custom-provider,cache-aware-prompt-assembly,web-research}.ts`; `templates/provider/src/provider.ts.tmpl`; `scripts/budgets.json`; the generated `packages/hosts/host-builder/data/` (regenerated).
    - References:
      - review finding "Leftover migration surface would also be frozen" (2026-10-15).
  - Test Cases to Write:
    - `provider_factories_reject_literal_keys` (type-level test file plus runtime check on a manifest-built instance); explicitly cover OpenRouter's low-level factory and discovery, with ref-only manifest config still accepted.
    - `channels_secret_fields_are_ref_only`.
    - `all_first_party_secret_fields_are_refs`.
    - `input_layout_has_no_legacy`.
    - `retired_names_absent` (sweep as a test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removals.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`, `docs/credentials-and-redaction.md`, `docs/migrate-to-0.13.md`, `packages/hosts/channels/README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed — credentials.** `src/credentials/legacy.ts` is deleted (`git rm`); `CredentialRecord` moves to `src/credentials/record.ts` and stays a root type export (keyring unchanged). `resolveCredentialValue` and `CredentialValueSource` leave the root. `src/provider-kit/provider-package.ts` exports `type SecretSource = () => Promise<string | undefined>` next to `refSource`/`optionalRefSource`. Every kit factory option (`RoutedProviderOptions`, `OpenAICompatibleProviderOptions`, `SystemOneClientOptions`, `SystemOneDecisionProviderOptions`, `SystemOneProviderPackageSpec`) and all eleven provider packages' factory, discovery, quota and spend-log options take `apiKey?: SecretSource`; call sites read `await options.apiKey?.()`. `resolveProviderApiKey(source, resolveCustom?, request?)` drops its unused `providerId`. The SystemOne decision provider resolves the key once per call (for redaction) and hands the client a source over that value. Kilo's `KiloProviderOptions.apiKey` was a literal `string` (the package itself only uses `resolveApiKey`); it is a `SecretSource` now. `@arnilo/prism-tools-web` `WebCredentialSource` is the same lazy shape (local type, no provider-kit import). OpenRouter: `createOpenRouterProvider` and `listOpenRouterModels` take `SecretSource`; the manifest `openrouter({ apiKey: "env:…" })` stays ref-only with `refSource` bridging.
    - **Channels.** The channels-local `CredentialValueSource` and `resolveTokenValue` are deleted; `createTelegramAdapter` / `createTelegramWebhookHandler` take `botToken` and `webhookSecret` as `ChannelSecretSource` (`() => Promise<string>`, exported from the root and `./telegram`); the handler rejects a non-function `webhookSecret` at construction and validates the resolved value on first request (fails closed). `connectTelegram({ webhookSecret })` is a ref resolved by `resolveChannelSecretRef` and added to the channel redactor (`createChannelRedactor` accepts several secrets). `resolveChannelSecretRef` now resolves through the agent's directly assigned credentials slot, else `createEnvRefCredentialResolver()`; its old keyring branch read `.secret` instead of `Secret.value`, so `keyring:` channel refs never resolved (fixed, tested). **Deviation:** a literal still fails with the existing `ChannelTokenLiteralError` (`ERR_PRISM_CHANNEL_TOKEN_LITERAL`), not the `literal_secret` code the criterion names — that code belongs to package config and `@arnilo/prism-remote`, and renaming a shipped channels error was out of scope.
    - **Layout, strictness, agent definitions, shim, persistence.** `InputAssemblyLayout = "cache_aware"` (option kept, per Task 25's verdict; the internal layout plumbing and the legacy branches in `src/input.ts` are gone). `toolCallStrictness` is `"strict" | "lenient"`. `AgentDefinition.create` and `AgentDefinitionResolutionContext.activateAllCapabilities` are removed. The `RunOptions.maxToolRounds` `TypeError` in `assemble.ts` is deleted; the `limits.maxToolRounds` axis is untouched. `ProductionPersistenceStore`'s doc comment names `@arnilo/prism-store-sqlite`, `@arnilo/prism-store-postgres` and the `@arnilo/prism/testing` conformance suites.
    - **Tests added.** `provider_factories_reject_literal_keys` (`packages/providers/openrouter/src/__tests__/openrouter.test.ts`: `@ts-expect-error` on a literal for the factory and discovery, runtime rejection of a literal manifest `apiKey`, discovery resolving an `env:` ref). `channels_secret_fields_are_ref_only` (`packages/hosts/channels/src/__tests__/connect.test.ts`). `input_layout_has_no_legacy` plus `@ts-expect-error` guards for `create`/`activateAllCapabilities` (`src/__tests__/public-contracts.test.ts`). `all_first_party_secret_fields_are_refs` and `retired_names_absent` (new `src/__tests__/retired-shapes.test.ts`): the walk imports every workspace package definition and requires `x-prism-secret` on every string config key ending in `apiKey|token|secret|password|passphrase|credential` (21 fields across 16 packages), plus a source check that channels' connect options go through `resolveChannelSecretRef`; the sweep reads `src/ packages/ apps/ scripts/ examples/ templates/ docs/` (minus `dist`, `history`, `_evidence`) and sanctions only migration guides, changelogs, the type-level guards, `scripts/phase<N>-(freeze|security)*`, compat baselines and `scripts/budgets.json`. The walk found one real gap: `@arnilo/prism-tools-coding` `forge.token` was pattern-validated but not `x-prism-secret` (so no `literal_secret` code or config redaction); it is now. Removed tests: the two legacy-order input tests, the legacy layout-parity case (rewritten as a cache_aware-only case), `external agent definition can create runtime agent`, `rejects legacy RunOptions.maxToolRounds`; `stream() terminates on a run that fails before its first event` now fails preflight on an invalid `promptVersion`.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`, then the memory-core/observational files restored — their diffs belong to the concurrent memory work, not this task): `arnilo__prism.txt` −`CredentialValueSource` (2 lines), −`resolveCredentialValue`, `CredentialRecord` lines re-pointed at `./record.js`, `resolveProviderApiKey` signature (`SecretSource`, no `providerId`); `arnilo__prism-channels.txt` `createChannelRedactor` signature, +`type ChannelSecretSource`. The provider baselines did not change: the extractor records interface heads and `export type {…} from` statements, not members or plain type aliases, so `SecretSource`, `InputAssemblyLayout` and every `apiKey` member change are invisible to it (Task 28's shape freeze). `bun scripts/release.mjs gate` is **green** after the budget rebaseline.
    - **Budgets.** `scripts/budgets.json` kernel `packedBytes` 1231073 → 1231974, `unpackedBytes` 3999953 → 4001554, with a dated reason: kernel source shrank; the growth is the rewritten credential docs, the migration rows and the CHANGELOG entry.
    - **Docs.** `docs/credentials-and-redaction.md` (What it does → Extension notes) and the credentials parts of `docs/host-security.md` and `docs/settings-auth-trust-security.md` described 0.12 helpers that no longer exist (`createExplicitCredentialResolver`, `createEnvCredentialResolver`, `createMemoryCredentialStore`, `createChainedCredentialResolver`); they now describe the credentials slot, `env:`/`keyring:` refs, `SecretSource`/`refSource`, and `docs.test.ts`'s phrase lists follow. `docs/provider-kit.md`, `docs/testing.md`, `docs/migration.md` (the `activateAllCapabilities` row, shim example and bullet), `packages/hosts/channels/README.md`, `packages/providers/litellm/README.md`, `docs/migrate-to-0.13.md` (eight replacement rows plus a `SecretSource` example under "Secrets are refs") and `CHANGELOG.md` updated. `packages/hosts/host-builder/data/` regenerated with `bun scripts/host-builder-index.mjs` (`--check` fresh).
    - **Sweep** over `src/ packages/ apps/ scripts/ examples/ templates/ docs/` (minus `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`): enforced by `retired_names_absent`; the remaining mentions are the sanctioned set above. MCP `protocolVersion: "legacy"` untouched.
    - **Checks.** `bun run typecheck`: every workspace outside the memory/knowledge family is clean, as are the examples outside rag/wiki; the remaining errors (`memory-observational`, `memory-core`, `memory-fabric`, `prism-wiki`, `prism-rag`, `context-engineering`, `prism-agent` `scenarios/ontology-memory.ts`, `examples/{rag,drive-rag-sync,revocation-propagation,scanned-document-rag,three-tier-memory}.ts`) come from a concurrent, uncommitted session moving `packages/memory/{rag,wiki}` to `packages/knowledge/` and reshaping fabric, not from this task. Package suites all 0 fail: the eleven providers (278 tests), `tools-web` 196, `channels` 120, `keyring` 42, `host-builder` 78, `tools-coding` `task5` 12. Kernel suites touched by the task (public-contracts, input-pipeline, invalidation-inventory, agents, session-subscriber-ownership, credentials-redaction, systemone*, routed-provider, openai-compatible, provider-kit, provider-conformance, provider-live-scenarios, public-export-contract, packaging, kernel-constraints, templates, package-config, manifest-*, retired-shapes): all pass except the pre-existing `host_libraries_import_only_allowlisted_kernel_names` (same two violations Task 26 recorded), `no_workspace_imports_prism_providers` (Task 25 finding 4) and the packaging memory-family guard (concurrent move). `scripts/phase21-security.test.mjs` 6/6 (its one-character `"t"` key is now redacted out of error text, so it uses a distinct key), `provider-toolcall-conformance`, `cache-parity/provider-probe` pass. `docs.test.ts` 67/70; the three failures (`migrate-to-0.9.md` link to `packages/memory/rag`, `migrate-to-0.13.md:137` naming `@arnilo/prism-memory-wiki`, examples emit) are the concurrent move.
    - **Findings for later tasks.** (1) Task 28: the extractor misses plain type aliases and interface members, so this task's `SecretSource` migration left provider baselines byte-identical; the shape freeze must record them. (2) Out of this task's scope (it names provider factories): `@arnilo/prism-rag`'s `createOpenAiCompatibleReranker` / `createVoyageReranker` and `@arnilo/prism-tools-work`'s `createMistralOcrParser` still take a literal `apiKey: string` at the low-level factory (their package config is ref-only); a follow-up should move them to the lazy source shape before the freeze, or Task 28 freezes them as is. (3) Doc rot outside this task: `docs/credentials-and-redaction.md`'s subscription-OAuth paragraph names `createOpenAICodexOAuthProvider` / `createXaiOAuthProvider` (neither exists); `docs/migration.md` still shows the deleted `resolveAgentDefinition`; `docs/settings-auth-trust-security.md` still lists `createStaticSettingsProvider` (deleted per the 0.13 migration table) — Task 29's docs pass should catch these. (4) Several `.mjs` live scripts (`scripts/memory-bench/*`, `scripts/context-rot/run.mjs`, `scripts/cache-parity/provider-probe.mjs`) pass a sync `() => key`; that still works at runtime (`await` accepts a value) but is not a `SecretSource` by type.

- [x] Task 28: Freeze the shape of the surface (was plan 185 Task 4)
  - Acceptance Criteria:
    - Functional: `extractDeclaredSurface` records, per exported name, the full normalized declaration: interface and class bodies (members sorted, whitespace collapsed, comments stripped), type alias right-hand sides, function overload signatures, and enum members. A re-exported name resolves to its declaration in the package's declaration graph instead of recording the `export … from` statement.
    - Functional: Names are keyed by entry point (`.`, `./net`, `./artifacts`, `./provider-kit`, `./driver-kit`, `./manifest`, `./testing`, …), resolved from each `exports` target, so a move between the root and a subpath shows up as a removal plus an addition. Task 26 found that today's extractor records every declaration in a package's `.d.ts` tree, so its root → `/net` and `/artifacts` moves left the kernel baseline almost unchanged (amended 2026-11-08 from Task 26's note).
    - Functional: The gate reports, per name, `removed`, `changed` (with a unified diff of the normalized text), and `added`. Changes that are additive by rule are classified `compatible` and do not fail: a new optional interface member, a new union member on a type the kernel only produces (listed in a `PRODUCER_ONLY_TYPES` table in `scripts/compat-shape.mjs`, re-exported by `scripts/release-gates.mjs`: `AgentEventPayload`, `AgentEvent`, `AgentEventType`, `AgentFinishReason`, `HostUiRequest`), a new overload. Everything else fails unless `--allow-break` and a migration note.
    - Functional: Baselines for the kernel and every package are regenerated in the new format with `bun scripts/release.mjs gate --update-baseline`; the note records that every diff line is format-only (no surface change). Explicitly include `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt`, resolving its factory/discovery option types to their full declarations after Task 27's `SecretSource` migration. The regeneration starts from the post-plan-189 baselines (Task 25 (e)) plus subsequently landed provider baselines, so the note also confirms that no name deleted by plan 189 (`repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree`, `fuzzyFindText`, `normalizeForFuzzyMatch`, the review exports, `serializeToolResultJson`) reappears, and that `serializeToolResultText` and `OMITTED_TOOL_RESULT_IMAGE_NOTE` are recorded.
    - Performance: The gate's declaration emit runs once per package as today; record total gate time before and after in the note (budget: ≤ +20%).
    - Code Quality: The normalizer is a pure function with unit tests; no TypeScript compiler API beyond what `declarationDir` already uses (plan 179 Task 1 confirms; using `typescript`'s printer is allowed if the emit already loads it). Execution: the repo's `typescript` is 7.0.2 (the native compiler), which ships no JavaScript AST or printer API, so the normalizer is a stdlib-only scanner over the emitted `.d.ts` text (strings, template literals, comments, bracket depth).
    - Security: n/a — tooling.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release-gates.mjs:29-230`, `scripts/release-gate.test.mjs`, `docs/release.md` (compat gate).
    - Options Considered:
      - API Extractor. Rejected: a new heavy dev dependency and a build step for a TypeScript-source package; the existing emit already produces `.d.ts`.
      - Snapshotting whole `.d.ts` files. Rejected: any comment or reorder would fail the gate; per-name normalized declarations are stable.
    - Chosen Approach:
      - Extend the existing extractor to full, normalized, resolved declarations with an additive-change classifier.
    - API Notes and Examples:
      ```text
      AgentConfig	interface AgentConfig { readonly compaction?: false | CompactionOptions; readonly disable?: AgentDisable; … }
      ```
    - Files to Create/Edit:
      - `scripts/compat-shape.mjs` (new: scanner, normalizer, resolver, classifier, line diff), `scripts/release-gates.mjs` (wiring), `scripts/release-gate.test.mjs`.
      - `scripts/compat-baseline/*.txt` (all, regenerated), explicitly `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt`.
      - `docs/release.md`: compat gate rules; `CHANGELOG.md`.
      - Found during execution: `scripts/phase25-compat-diff.mjs` (one-off helper; reads the new format), `scripts/budgets.json` (kernel byte ceilings, docs growth), the orphan `scripts/compat-baseline/arnilo__prism-{agent-sdk,work}.txt` (deleted, Task 26 finding 2), `src/__tests__/provider-kit.test.ts` (Task 25 finding 4 prerequisite).
    - References:
      - review finding "The freeze test checks names only, not shapes" (2026-10-15).
  - Test Cases to Write:
    - `compat_detects_member_change`: removing `AgentConfig.disable` in a fixture fails the gate.
    - `compat_detects_type_alias_change`: narrowing `ToolCapabilityKind` fails.
    - `compat_allows_optional_member_add`: adding an optional field passes as `compatible`.
    - `compat_allows_producer_union_growth`: a new `AgentEventPayload` member passes.
    - `compat_resolves_reexports`: a re-exported interface's body is recorded.
    - `normalizer_is_stable`: comments and member order do not change the output.
    - `compat_coding_surface_has_no_plan189_removals`: the `@arnilo/prism-tools-coding` baseline contains none of Task 25 (e)'s removed names and records `compileGlob` and `createBackgroundProcesses`; the kernel baseline records `serializeToolResultText` and `OMITTED_TOOL_RESULT_IMAGE_NOTE` and no `serializeToolResultJson`; every live baseline is keyed by entry. (Amended at execution: `shell_output` and `diagnostics` are tool names registered inside `createCodingTools`, not exports, and `generateChangedLinePreview` is internal to `agent/edit.ts`, unreachable from the package's only entry `.`. The union extractor recorded them by accident; the test asserts `generateChangedLinePreview` is not frozen.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling.
    - Docs pages to create/edit:
      - `docs/release.md`: compat gate section.
      - `CHANGELOG.md`: tooling entry.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed.** New `scripts/compat-shape.mjs` (stdlib-only). It scans each emitted `.d.ts` into top-level statements, normalizes every declaration, and resolves exports per entry point. Normalizing drops `export`/`declare`/`default`, strips comments, collapses whitespace, and sorts interface, class and enum members. Resolution follows `export {…} from`, `export *`, `export * as`, `import … ; export {…}` and default exports through relative specifiers. A cross-package re-export records `reexport X from "<pkg>"`, and a value exported only as a type gets `[type-only export]`. `extractPackageSurface(declRoot, manifest)` walks every code target in `exports`, skipping JSON and wildcard targets, keys lines `<entry> <name>`, and reports any entry whose declaration file is missing. `classifyChange` marks three changes compatible: an interface/class with the same header and only new optional members, a type alias in `PRODUCER_ONLY_TYPES` whose union only grew, and a new function overload. Everything else breaks, including a new type-only marker and a required member. `shapeDiff` prints a one-line-context LCS diff with bodies expanded one member per line. `release-gates.mjs`: `declarationDir` also returns `declRoot`; `runGates` uses `extractPackageSurface`; `diffSurface` gains `compatible` and `diffs`; the new `describeBreak` prints the shape diff. Additive changes are logged as `compat (additive)`, and breaks keep the old message text with root names shown bare and subpath names as `./net#name`. `extractDeclaredSurface`, `parseDeclarationFile` and `extractEntrySurface` stay as they are for `phase54-package-map.mjs` and the host-builder index (`--check` fresh).
    - **Tests.** `release-gate.test.mjs` gains `normalizer_is_stable`, `compat_resolves_reexports`, `compat_detects_type_alias_change`, `compat_allows_optional_member_add`, `compat_allows_producer_union_growth`, `compat_detects_member_change` and `compat_coding_surface_has_no_plan189_removals`. `compat_detects_member_change` runs the real gate on an emitted fixture: an added optional member passes, and removing `AgentConfig.disable` fails with the diff line `- readonly disable?: AgentDisable;`. The compat fixture and the "baselines are current" test now use the new format. The two emit-backed fixture tests get a 30 s timeout: under this machine's load (avg 13–20) four `tsc` emits overran bun's 5 s default even before this change. Suite: 37 pass / 0 fail. The orphan baselines `arnilo__prism-agent-sdk.txt` and `arnilo__prism-work.txt` are deleted (`git rm`; nothing read them; both packages are in `scripts/deprecations-0.13.json`), which turns `no_compat_baseline_without_workspace` green (Task 26 finding 2).
    - **Prerequisite (Task 25 finding 4).** `provider-kit.test.ts` `no_workspace_imports_prism_providers` was still red: `packages/hosts/host-builder/skills/prism-host-builder/references/upgrading.md` names `@arnilo/prism-providers` in its 0.12 → 0.13 replacement table. It is now sanctioned in `allowedDocs` as the skill-side twin of `docs/migrate-to-0.13.md`, not reworded, because the row is the migration guidance. `provider-kit`, `public-export-contract` and `packaging` give 343 pass / 1 fail. The one failure is the packaging memory-family guard, from the concurrent `packages/knowledge/` move Task 27 recorded.
    - **Baselines regenerated** (`bun scripts/release.mjs gate --update-baseline`, all 52 live packages; 52 files changed, +5601/−6338 lines with the two deletions). The diff is format-only for every stable package. The gate run just before this task was green for all stable packages, the source did not change, and every per-name difference is one of two kinds. (a) Names the old union extractor recorded but no `exports` entry reaches, now dropped: 237 in the kernel, such as `HookBus`, `KERNEL_VERSION`, `MODEL_FAMILY_TOKENS` and `EventSubscriber`, and 137 in `tools-coding`. (b) Names it never saw because tsc emits them as `export interface` / `export type` without `declare`, now recorded: 358 in the kernel (`AgentConfig`, `AgentDisable`, `AgentEvent`, …). The old file had also keyed named type re-exports as `type X`, which is gone. The experimental `memory-fabric`, `memory-observational` and `wiki` baselines also absorb the concurrent memory session's drift that the pre-task gate reported (not gated; plan 210's track). Kernel: 1236 lines (`.` 1180 plus the subpaths, `./net` 10). The `SecretSource` migration is now frozen: `arnilo__prism-provider-openrouter.txt` records `OpenRouterProviderOptions` and `ListOpenRouterModelsOptions` with `readonly apiKey?: SecretSource`, and `RunLimitTracker` carries `[type-only export]`. Plan 189 check: no `repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree`, `fuzzyFindText`, `normalizeForFuzzyMatch`, review exports or `serializeToolResultJson` reappears. `serializeToolResultText` and `OMITTED_TOOL_RESULT_IMAGE_NOTE` are recorded (asserted by the test).
    - **Performance.** On the same emits across all 52 packages, `tsc` emit took 20.4 s total. Extraction went from 95 ms with the old union extractor to 413 ms with the new one, about +1.6% of the compat leg and inside the ≤ +20% budget. Whole gate wall clock: 17 s before (lower load) and 24–25 s after at load average ~13. The difference is machine load, not the extractor.
    - **Budgets.** `scripts/budgets.json` kernel `packedBytes` 1231974 → 1233295 and `unpackedBytes` 4001554 → 4004949, with a dated reason. Kernel source is unchanged; the growth is the new `docs/release.md` section and its CHANGELOG entry. `bun scripts/release.mjs gate` is **green**; only the experimental fabric/wiki packages report drift, from the concurrent session's `MemoryLtmPort`/`LtmPort` edits.
    - **Docs.** `docs/release.md` gains "The compat gate" (line format, entry keys, normalization, the three compatible rules, `PRODUCER_ONLY_TYPES`, `--allow-break`, update procedure, legacy-registry baselines left alone). `CHANGELOG.md` has a Changed entry. `docs.test.ts` shows the same 2 pre-existing failures and no new offenders.
    - **Other suites.** The 15 historical `phase1*/phase2*-freeze` tests, `phase54-package-map`, `retired-command-names`, `provider-kit`, `retired-shapes`, `docs`, fabric `package` and wiki `retired-names` give 285 pass / 52 fail with the new baselines and **the identical failure list** with the old baselines restored. None of these reds comes from this task; they are long-standing rot in historical phase tests, for Tasks 35/36.
    - **Findings for later tasks.** (1) Task 29: the compatibility page should cite `docs/release.md` "The compat gate" for what counts as breaking, and list `PRODUCER_ONLY_TYPES` as the unions hosts must handle with a default branch. (2) Known limits, recorded instead of fixed: members of nested object type literals are not sorted, only top-level bodies; a namespace body is frozen as collapsed text; adding a required class method counts as breaking (conservative). (3) Task 27 finding 2 stands: `@arnilo/prism-rag` `createOpenAiCompatibleReranker`/`createVoyageReranker` and `@arnilo/prism-tools-work` `createMistralOcrParser` are now frozen with a literal `apiKey: string`, so moving them to the lazy source shape after the freeze is a recorded break. (4) Tasks 35/36: the 52 pre-existing reds in the historical freeze tests above and `docs.test.ts`'s two link/retired-name failures.

- [x] Task 29: Compatibility promise and forward-compatibility rules (was plan 185 Task 5)
  - Acceptance Criteria:
    - Functional: `docs/compatibility.md` (API page structure) states:
      - what is stable (the root exports, every subpath in `exports`, the hook catalog, slot contracts, `PackageAPI`, `HostPort`, event payloads, the manifest format, the session entry schema);
      - what may change in a minor release (additive changes per Task 28's classifier) and what needs a new API level;
      - host rules: ignore unknown `AgentEvent` types and unknown fields; answer an unknown `HostUi` request kind with `{ status: "unavailable" }`; treat unknown `stopReason`/`finishReason` values as opaque strings;
      - package rules: never exhaustively switch on producer-only unions without a default; declare `requires.api`;
      - store rules: persist and return entries of unknown kinds unchanged; never reject a session because of one.
    - Functional: The kernel follows its own rule: the host-UI dispatcher (`src/host/*`) passes any response through validation that maps an unexpected `status` to `unavailable` (fail closed), and `isKnownAgentEventType(type)` is exported for hosts that want to filter.
    - Functional: JSONL store: a line with an unknown `kind` and a valid envelope (`id`, `sessionId`, `parentId`, `timestamp`) is kept and returned as an opaque entry; `schemaVersion` greater than `SESSION_ENTRY_SCHEMA_VERSION` is returned unchanged and the store emits a one-time warn through its logger; a structurally invalid line is still an error.
    - Functional: The store conformance suite (`src/testing/store-conformance.ts`) gains `unknown_entry_kind_round_trips`, and the SQLite, Postgres, JSONL, and memory stores pass it.
    - Functional: `docs/host.md`, `docs/events.md`, `docs/packages.md` link to the page.
    - Performance: n/a.
    - Code Quality: The opaque-entry shape is the existing `SessionEntry` with its `kind` widened to `SessionEntryKind | (string & {})` in the store-facing type only if plan 179 Task 1 shows that is compatible; otherwise the JSONL store keeps unknown kinds in a `data` envelope. The review decides; the note records it.
    - Security: Unknown entries never reach `session.messages()` or a provider request (asserted).
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/session.ts:15-40`, `packages/stores/jsonl/src/jsonl-store.ts:480-560`, `src/testing/store-conformance.ts`, `src/host/*`, `docs/host.md`, `docs/events.md`.
    - Options Considered:
      - A `HostUi.kinds` capability declaration. Deferred to Further Actions: it is additive and can ship in a minor release under Task 28's rules.
    - Chosen Approach:
      - Document the rules, make the kernel and stores follow them, and enforce stores through conformance.
    - API Notes and Examples:
      ```ts
      for await (const event of session.stream(input)) {
        switch (event.type) {
          case "message.delta": render(event); break;
          default: break; // unknown types are expected in later minors
        }
      }
      ```
    - Files to Create/Edit:
      - `docs/compatibility.md` (new) and its `docs/index.md` entry and `apiPages` entry in `src/__tests__/docs.test.ts`.
      - `src/host/*`, `src/index.ts` (`isKnownAgentEventType`), `src/__tests__/public-export-contract.test.ts`, `scripts/compat-baseline/arnilo__prism.txt` (regenerated; one addition).
      - `packages/stores/jsonl/src/jsonl-store.ts` and tests; `src/testing/store-conformance.ts`; `packages/stores/{sqlite,postgres}` conformance runs.
      - `docs/host.md`, `docs/events.md`, `docs/packages.md`, `CHANGELOG.md`.
      - Found during execution: `src/host/response.ts` (new, internal: the single answer validator; `src/host/*` held only types), its call sites `src/packages/loader.ts` (`hostFor`, `askSecret`), `src/agent-session/session/assemble.ts` (tool approval) and `src/driver-kit/profiles.ts` (login); `src/contracts-core/session.ts` (`kind`/`schemaVersion` widening) and `src/session-stores.ts` (one cast it needed); `packages/stores/codecs/src/index.ts` (kept only `schema_version === 1`); `scripts/compat-shape.mjs` (`SessionEntryKind` joins `PRODUCER_ONLY_TYPES`); `docs/agent.md` (said "a store rejects an unknown kind"); `docs/release.md` and the five experimental READMEs plus the three graduation sections (Task 4's link handoff); `scripts/budgets.json`; `packages/hosts/host-builder/data/{api,errors}.json` (regenerated); `packages/stores/{jsonl,codecs}/CHANGELOG.md`.
    - References:
      - review finding "Closed lists that hosts implement or switch on" (2026-10-15).
  - Test Cases to Write:
    - `unknown_entry_kind_round_trips` (conformance, all stores). Executed as the `unknown-entry-kind` leg of `STORE_CONFORMANCE_STEPS` (legs are kebab-case); its failure messages start `unknown_entry_kind_round_trips:`.
    - `unknown_entry_never_reaches_provider`.
    - `future_schema_version_is_readable_with_warning` (JSONL).
    - `unexpected_host_ui_status_is_unavailable`.
    - `docs_compatibility_page_indexed` (docs suite).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a published stability promise and store behavior.
    - Docs pages to create/edit:
      - `docs/compatibility.md` (new).
      - `docs/host.md`, `docs/events.md`, `docs/packages.md` (links), `CHANGELOG.md`.
    - `docs/index.md` update: yes — "What stays stable across releases and how hosts, packages, and stores stay compatible with later minors."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Opaque-entry shape (the review call).** `SessionEntry.kind` widens to `SessionEntryKind | (string & {})` and `SessionEntry.schemaVersion` from `1` to `number`, in the shared type rather than a `data` envelope. Reason: the envelope cannot return an entry "unchanged", which the store rule and the conformance leg require, and a closed type would make the promise untypeable. Fallout was one line in the kernel (`src/session-stores.ts` search `kind` filter, a cast) and none in the 51 workspaces or `examples`. `SessionEntry` is not a discriminated union, so no narrowing is lost. `SessionEntryKind` joins `PRODUCER_ONLY_TYPES`, so a later new kind passes the gate as additive.
    - **Host UI.** New internal `src/host/response.ts`: `validateHostUiResponse(request, response)` and `requestHostUi(ui, request)`. An unknown `status`, a non-object answer, or an `answered` value of the wrong shape for its kind (non-boolean `confirm`, non-string `input`, `select` not matching `multiple`, `terminal` without an integer `exitCode`, non-string `secret`) becomes `unavailable`. `notify`/`open-url` answers carry no value back. Every kernel call site goes through it: package `host.ui.request` and `secret` (`loader.ts`), the tool-approval prompt (`assemble.ts`) and driver login (`driver-kit/profiles.ts`). This closed a real hole: before, a host answering a tool approval `{ status: "answered", value: "yes" }` (truthy, not boolean) **allowed** the call; the test asserts it now suspends.
    - **`isKnownAgentEventType(type: unknown)`** in `contracts-protocol.ts`, backed by a table typed `{ [K in AgentEvent["type"]]: true }`, so a new event type fails the build until listed (23 types; `docs/events.md` "Extension notes" says so). Root export; `public-export-contract.test.ts` list updated.
    - **JSONL store.** A line with a valid envelope and an unknown `kind`, or with an integer `schemaVersion` above `SESSION_ENTRY_SCHEMA_VERSION`, is returned as is (no per-kind checks). A non-integer or lower version, and a line without a valid envelope, are still errors. New `JsonlSessionStoreOptions.logger?: Pick<Logger, "warn">`, which warns once per store instance; the package passes `prism.log`. Tests `unknown_entry_kind_is_kept_as_opaque_entry` and `future_schema_version_is_readable_with_warning` replace "quarantines unknown entry kinds" and "rejects unsupported schemaVersion", whose behavior this task reverses. The SQL row codec now keeps any numeric `schema_version`; before, it dropped everything but `1`.
    - **Conformance.** `unknown-entry-kind` leg after `suspended-run`: append an unknown-kind entry with `data` and `metadata`, then require it unchanged from `list` (undefined fields dropped and keys sorted, because SQL rows map absent columns to `undefined`), from `get`, and as the `readBranchPath` tip. The `restart` leg re-checks it after reopen. Passing: the kernel memory store (`conformance-helpers.test.ts`, 25), JSONL (43), SQLite (48), and Postgres (50 pass, run against a throwaway local `initdb` cluster on 127.0.0.1:55432 via `PRISM_TEST_POSTGRES_URL`). No store needed a code change for unknown kinds: `kind` is free `TEXT`, and the memory store never checked it.
    - **Tests.** `src/__tests__/compatibility.test.ts` (new): `unknown_entry_never_reaches_provider` (an unknown entry that even carries `message`/`summary` is absent from `session.messages()` and the provider request, and stays in the store) and `is_known_agent_event_type`. `host-ui.test.ts`: `unexpected_host_ui_status_is_unavailable` (six odd answers to a package, five pass-through cases, and the tool-approval path for `{status:"approved"}` and a truthy string). `docs.test.ts`: `docs_compatibility_page_indexed`, plus `docs/compatibility.md` in `apiPages` (required headings).
    - **Docs.** New `docs/compatibility.md` (API page structure). It covers the stable surfaces table, what is out of scope (experimental line, `apps/prism-agent`, deep imports, message text), additive versus new-API-level changes from Task 28's classifier with `PRODUCER_ONLY_TYPES`, cites `docs/release.md` "The compat gate", lists `SubscriberOverflowError` with the host-facing errors (Task 26 finding 3), and gives the host, package and store rules plus what the kernel and stores do. `docs/index.md` entry as specified. `host.md` ("Responses"), `events.md` ("Extension notes") and `packages.md` link it. `docs/agent.md`'s "a store rejects an unknown kind" is corrected. `docs/release.md`'s `PRODUCER_ONLY_TYPES` list gains `SessionEntryKind`. **Task 4 handoff done:** the notice template now links "[stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md)". The link is absolute because the notice ships in npm READMEs, where `../../../docs` does not resolve; one README already used that form. The five experimental READMEs (`packages/memory/{core,observational,fabric}`, `packages/knowledge/{wiki,rag}`, moved by the concurrent memory session) changed with it, and `experimental_packages_carry_notice` passes. The three `## Compatibility (the contract from graduation)` sections link it too. `CHANGELOG.md` and the jsonl and codecs changelogs have entries.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`, then `gate` green). Kernel: `. SessionEntry` changed (`kind: SessionEntryKind | (string & {})`, `schemaVersion?: number`), `./testing STORE_CONFORMANCE_STEPS` changed (adds `"unknown-entry-kind"`), `. isKnownAgentEventType` added. No removals. `@arnilo/prism-store-jsonl`: `JsonlSessionStoreOptions` gains `logger?` (classified additive). The two kernel changes are breaking by the classifier and taken deliberately before the 0.13.0 publish, with no `--allow-break`, by regenerating the baseline. The same regeneration absorbed the concurrent memory session's experimental drift (`MemoryLtmPort`/`LtmPort` `scopeId`, not gated).
    - **Budgets.** `scripts/budgets.json` kernel ceilings rebaselined with a dated reason. Most of the growth is `docs/compatibility.md`, plus one new file and the export. The tree also carries the concurrent memory session's uncommitted kernel edits, so the deltas are net of those.
    - **Checks.** `bun run typecheck`: kernel, stores and `examples` clean. The only errors are the concurrent memory session's (`prism-memory-observational` `root-exports.test.ts` imports three removed names; `prism-memory-core` `./trust.js` is missing). The affected kernel suites give 634 pass / 4 fail. All four failures are outside this task: the packaging memory-family guard (Task 28 noted it) and three `docs.test.ts` reds (the broken `migrate-to-0.9.md` link to `packages/memory/rag`, the retired `@arnilo/prism-memory-wiki` in `migrate-to-0.13.md`, and `migration_note_names_every_removed_export`, which wants seven fabric/wiki/rag names from the concurrent memory work). `scripts/budget-gate.test.mjs` has the pre-existing per-package export-count and non-null rows (Task 4 noted them). Biome: the two new files are formatted. The touched files' other format and organize-imports findings predate this task (an untouched `codecs/src/evaluations.ts` fails the same way) and are left for Task 35.
    - **Findings for later tasks.** (1) Tasks 35/36: the reds above. Also, Task 27's doc-rot finding was handed to this task and is **not** fixed, because it is outside the acceptance criteria and needs page rewrites, not a link. `docs/settings-auth-trust-security.md` and `docs/host-security.md` still document the deleted `createStaticSettingsProvider`/`createChainedSettingsProvider` and a `@arnilo/prism/node/settings` subpath that `exports` does not list. `docs/migration.md` still shows `resolveAgentDefinition`. `docs/credentials-and-redaction.md:91` names `createOpenAICodexOAuthProvider`/`createXaiOAuthProvider` (neither exists) and `createOAuthCredentialStoreAdapter` as if it were a kernel API (it is in `@arnilo/prism-keyring`). (2) Remote hosts (`packages/hosts/remote`) already validated answers with their own `validAnswer`; the kernel now does the same, so the remote copy is defense in depth, not dead code. (3) Hosts that persist and replay `SessionEntry` through their own code (channels, AG-UI) were not audited for an exhaustive `switch (entry.kind)`; a repo grep found none.

### Part F — live release acceptance (ex-plan 186)

- [x] Task 30: The release acceptance methodology (was plan 186 Task 1)
  - Acceptance Criteria:
    - Functional: `docs/live-testing.md` gains a section "Release acceptance on live providers" with these parts:
      - **Tiers.** T0 hermetic (`bun run test`, mock provider and recorded wire fixtures). T1 wire scenarios per shipped provider (the ten gating rows in this plan's release facts: `providers/{hyper,opencode-go,typesafe,laya,liquid,liquid-local,openrouter,openai-codex,kilo,litellm}`), including the `decide` rows of plans 195–196; `providers/{commandcode,ollama-cloud}` run but do not gate 0.13.0. T2 the SDK journey on Hyper *and* OpenCode Go (`release/journey-*`). T2c cache parity against pi run headless (`release/cache-parity`, Tasks 21–24). T3 packed post-publish smoke (`scripts/post-publish-smoke.mjs`). Experimental packages (the memory line) are covered by T0 only and have no live row. A release needs T0, T1 for all ten gating rows (nine packages; `liquid` has hosted and local rows), T2 on both providers, and T2c green before the tag, and T3 green after publish.
      - **Entry criteria.** T0 green on the release commit; plans blocking the release closed; `bun scripts/live-preflight.mjs --suite release/` passes; spend caps set on every key; `bun scripts/live-preflight.mjs --suite providers/` passes, including `providers/openrouter` and `OPENROUTER_API_KEY`; owner authorization covers each selected model (stop rather than silently substituting `openrouter/free` for the pinned default); `laya-serve` reachable for the Laya row; `llama-server` serving `d1-3B` reachable for the `liquid-local` row.
      - **Credentials.**
        - One env file outside the repo (`~/.config/prism/live.env`, `chmod 600`), loaded with `export PRISM_LIVE_ENV_FILE=…`.
        - One least-privilege, spend-capped key per provider.
        - Keys never go in shell history (`read -s` example), chat, CI logs, or reports.
        - Rotate a key after a suspected leak and after the release run.
        - The cache-parity reference (pi) uses the provider credentials already configured on the dev machine; the runner never reads, copies, or edits `~/.pi`.
      - **Budget.** The journey's request and token ceilings per provider (Task 32), plans 183, 196, and 203's tier-1 counts (OpenRouter's paid-cache leg remains separately opted in), Task 23's per-cell ceiling, all enforced in the tests themselves, plus the operator-side spend caps.
      - **Procedure.** Exact commands: preflight for both `providers/` and `release/` → `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live` → `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live` → `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live` → read `docs/_evidence/live-matrix-report.md` → write the acceptance evidence file.
      - **Model selection.** `PRISM_LIVE_HYPER_JOURNEY_MODEL` and `PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`, each with a manifest default. Pick a model that supports tool calls, and the cheapest one that passes its T1 tool-loop scenario.
      - **Provider-agnostic rule.** The journey's assertions are about Prism behaviour. A scenario that passes on one provider and fails on the other is triaged: `prism` if the difference is in Prism's handling (codec, usage, routing), and `provider-behavior` only if the recorded wire shows the model did not do what it was told.
      - **Triage and flake policy.**
        - A scenario failure is classified as `transport` (network, 5xx, 429, classified with `isTransientErrorInfo`), `provider-behavior` (the model did not call the tool it was told to call), or `prism` (an assertion on Prism behaviour failed).
        - Only `transport` may be retried, once, by the runner.
        - `provider-behavior` gets one rerun with the same prompt and is then recorded as a provider issue.
        - A `prism` failure is never retried and blocks the release.
        - Any secret-leak finding stops the run, blocks the release, and triggers key rotation.
      - **Evidence and sign-off.** What the evidence file holds: commit; per provider, the model ids, per-scenario status and request counts, durations, and leak-scan result; the T1 summary; the cache-parity table; the operator. The release owner signs it in the Task 39 note.
    - Functional: `scripts/live.env.example` is corrected for Bun (it still shows `node --env-file` and `dist/…` paths). It documents `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `OPENROUTER_API_KEY`, `PRISM_LIVE_OPENROUTER_MODEL`, the separately opt-in `PRISM_LIVE_OPENROUTER_PAID` and `PRISM_LIVE_OPENROUTER_CACHE_MODEL`, `LAYA_BASE_URL`, `PRISM_LIVE_LAYA`, `PRISM_LIVE_LLAMA_SERVER_URL`, `PRISM_LIVE_CACHE_PARITY`, and the two journey model variables.
    - Performance: n/a — documentation.
    - Code Quality: The section follows the API page structure where it applies (What it does, When to use it, Inputs, Outputs, Security and performance notes).
    - Security: The procedure never asks the operator to print, echo, or paste a key; every example uses env files or `read -s`.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md` (current tiers, skip-not-fail contract, strict mode, generated table), `scripts/live-matrix.mjs`, `scripts/live.env.example`, `docs/release.md`, `packages/providers/hyper/src/__tests__/live.test.ts:14-60`, `src/models/retry.ts` (`isTransientErrorInfo`), plans 183 Task 5 and Task 24 of this plan.
    - Options Considered:
      - Run the SDK journey on one provider only. Rejected by the owner (2026-10-16): acceptance on two gateways with different wire details is what shows the SDK is provider-agnostic.
      - Make T1 optional for unchanged providers. Rejected: all six shipped provider packages need T1, including OpenRouter; the owner's rule is that none ships untested.
      - Keep the methodology in this plan only. Rejected: operators run it every release, so it belongs in the docs page.
    - Chosen Approach:
      - Extend the live-testing page with a release section built on the existing runner and strict mode.
    - API Notes and Examples:
      ```bash
      install -m 600 /dev/null ~/.config/prism/live.env
      printf 'PRISM_LIVE_PROVIDER_TESTS=1\nPRISM_LIVE_RELEASE_JOURNEY=1\n' >> ~/.config/prism/live.env
      read -rs HYPER_API_KEY && printf 'HYPER_API_KEY=%s\n' "$HYPER_API_KEY" >> ~/.config/prism/live.env && unset HYPER_API_KEY
      read -rs OPENCODE_GO_API_KEY && printf 'OPENCODE_GO_API_KEY=%s\n' "$OPENCODE_GO_API_KEY" >> ~/.config/prism/live.env && unset OPENCODE_GO_API_KEY
      export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
      bun scripts/live-preflight.mjs --suite providers/
      bun scripts/live-preflight.mjs --suite release/
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      ```
    - Files to Create/Edit:
      - `docs/live-testing.md`: new section.
      - `scripts/live.env.example`: Bun commands and the variables above.
      - `docs/release.md`: link the acceptance section from the release checklist. Executed as a new `## Live acceptance` section, because the page has no checklist heading.
      - `CHANGELOG.md`.
      - Found during execution: `scripts/live-matrix.mjs` (`SECRET_SHAPED` exported for the template test) and `scripts/live-matrix.test.mjs` (the test).
    - References:
      - owner request and credential choice (2026-10-15); owner decisions 2026-10-16 (four providers; acceptance on Hyper and OpenCode Go; cache parity).
  - Test Cases to Write:
    - `live-doc-check` (existing `scripts/live-doc-check.test.mjs`) stays green after the new section.
    - `live_env_example_has_no_values`: the template holds names and placeholders only (the manifest validator's secret-shape rule applied to the file).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator methodology.
    - Docs pages to create/edit:
      - `docs/live-testing.md`, `docs/release.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no — the page is already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Docs.** `docs/live-testing.md` has a new section, "Release acceptance on live providers", placed after "Security and performance notes". It uses the API page structure: What it does; When to use it; Inputs (a tiers table, entry criteria, credentials with the `read -rs` example, model selection, budget, the provider-agnostic rule); Procedure (the exact commands, with T0 first); Outputs (a triage table and the evidence contents); and Security and performance notes. The "Running the matrix" commands now use `bun` (they used `npm`/`node`), and "Extension and configuration notes" describes the template rule. `docs/release.md` gains `## Live acceptance`, which links the section. `CHANGELOG.md` has an entry.
    - **T2c gating, reconciled with the 2026-11-08 amendment.** The acceptance criterion says "T2c green before the tag". The enabled parity cells are now only Command Code and Ollama Cloud, and neither provider gates 0.13.0; the `release/cache-parity` row's notes already say a miss does not block 0.13.0. So the page says T2c runs in strict mode with its verdict recorded. A missed cell blocks 0.13.0 only when it shows a `prism` defect in shared code (the kernel, the provider kit, or the reference host's coding worker); otherwise it gates that provider's own release. Tasks 34 and 39 should read T2c this way.
    - **`~/.pi` wording.** The acceptance criterion says the runner "never reads" `~/.pi`. The Task 23 runner takes a stat signature of `~/.pi/agent` (path, size, mtime) and opens no file, so the page says "never reads, copies, or edits `~/.pi`; it only compares a stat signature".
    - **`scripts/live.env.example` rewrite (larger than "corrected for Bun").** The old template had three defects beyond its `node --env-file … dist/` example:
      - Its inline comments were not comments to the loader. `parseEnvFile` keeps `PRISM_LIVE_PROVIDER_TESTS=1   # …` as the whole value, which is not `"1"`, so a verbatim copy silently disabled every switch.
      - Its uncommented placeholders (`OPENAI_API_KEY=sk-...`) became "present" keys in a copy.
      - It listed 14 deleted providers' variables and missed 45 variables that the manifest reads.
    - **The new template.** Every assignment is a commented `# NAME=` entry, with comments on their own lines. Secret variables are empty. URL credentials are `<placeholders>`; the Postgres DSN had `user:pass`, and the old webhook secret example had a literal value. The template documents every manifest variable, plus the Task 30 list (`PRISM_LIVE_RELEASE_JOURNEY`, the two journey model variables, `LAYA_BASE_URL`, and the OpenRouter paid and cache variables). Variables that only the retired providers' baselines or the freeze manifest still name were dropped: `CLINE`, `DEEPSEEK`, `XAI` (+ OAuth), DashScope's `PRISM_LIVE_*`, Azure, Bedrock, Vertex, local Ollama, AI SDK, and the never-built OIDC, webhook and S3 legs. `PRISM_TEST_OPA_URL` stays, because `opa-live.test.ts` reads it.
    - **Test.** `live_env_example_has_no_values` in `scripts/live-matrix.test.mjs` (already in `bun run test`) checks that:
      - `parseEnvFile(template)` is `{}`, and there is no `node --env-file`/`dist/`;
      - every `# NAME=value` entry has no inline comment, matches no `SECRET_SHAPED` value, has an empty value when the name ends in `KEY|TOKEN|SECRET|PASSWORD`, and uses `<placeholders>` for URL credentials;
      - every env name in the manifest's `requires`/`requiresAny`/`optional`/`model[].env` is in the template.
      `SECRET_SHAPED` is exported from `scripts/live-matrix.mjs` for it.
    - **Checks.** These all pass:
      - `scripts/live-matrix.test.mjs` (16, including the new test), `scripts/live-doc-check.test.mjs` and `scripts/scan-secrets.test.mjs`: 25 pass.
      - `src/__tests__/docs.test.ts`: 68 pass.
      - `bun scripts/live-matrix.mjs --check`.
      - Biome on the two scripts.
      No kernel or package code changed, so typecheck and the compat gate are unaffected.
    - **Findings for later tasks.**
      1. Task 31: the page says `scripts/live-preflight.mjs` "lands with plan 215 Tasks 31–33" and that, until then, preflight is a manual check of the same list. Task 31 replaces that sentence with the preflight reference.
      2. Task 33: any env name a new manifest row adds must also be a `# NAME=` entry in `scripts/live.env.example`, or `live_env_example_has_no_values` fails. The journey variables are already there. The journey's OpenCode Go default model (from plan 183 Task 1 (e)) is left blank in the template; Task 33 fills it in with the manifest row.
      3. Task 32: the page states the journey budget (36 requests and 80k input tokens per provider). If Task 32 changes it, update the page.

- [x] Task 31: Live pre-flight check (was plan 186 Task 2)
  - Acceptance Criteria:
    - Functional: `scripts/live-preflight.mjs --suite <id-or-prefix>` (repeatable) reads every matching row's `requires`/`requiresAny` from `scripts/live-matrix.json`. It prints one row per check:
      - the env file resolved from `PRISM_LIVE_ENV_FILE` (or the manifest default) exists, is a regular file, and has mode `0600` or stricter;
      - the env file is outside the repository, or inside it and ignored by git (`git check-ignore`);
      - each required variable is present and non-empty (reported by name only);
      - no required variable's value appears in `git grep` over tracked files (a committed key fails);
      - each required binary is on `PATH` (`pi` for `release/cache-parity`), and the pi extension of each enabled cache-parity cell's provider is installed (`pi-commandcode-provider`, `pi-ollama-cloud`; amended 2026-11-08: the Hyper and OpenCode Go cells are deferred, and the row's own `preflight()` in `scripts/cache-parity/live.mjs` is the readiness rule), without printing credentials;
      - selecting `--suite providers/` includes `providers/openrouter`, its required `OPENROUTER_API_KEY`, `providers/kilo`, its required `KILO_API_KEY`, `providers/litellm`, its required `LITELLM_API_KEY` and preflight check that `scripts/litellm/up.mjs` has run, and the existing per-row requirements. Checking only `--suite release/` does not prove T1 readiness; the procedure checks both prefixes.
      - with `--probe`, one authenticated discovery request per provider using that provider package's own function (`listHyperModels`, `listOpenCodeGoModels`, `listOpenRouterModels` for `providers/openrouter`, `listKiloModels` for `providers/kilo`, `listLiteLLMModels` for `providers/litellm`, one `GET /models` with no generation or paid-cache leg; the OpenRouter and Kilo personal catalogs are public, so this proves catalog readiness, not key validity — authenticated evidence comes from the owner-authorized T1 run; for Laya, one reachability request to `LAYA_BASE_URL`; for Jev and hosted Liquid, the cheapest documented authenticated call; for `liquid-local`, one reachability request to `PRISM_LIVE_LLAMA_SERVER_URL`), so the request path is the shipped one.
    - Functional: Exit 0 only when every check passes; exit 2 on any failure. Output never contains a variable's value: a test seeds fake keys and scans stdout and stderr.
    - Performance: Without `--probe`, no network; with it, one request per provider.
    - Code Quality: Pure check functions with injected fs/env/exec/fetch, so they are unit-tested offline; reuses `resolveSuiteState()` from `scripts/live-matrix.mjs`.
    - Security: The script is the enforcement point for the methodology's credential rules.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.mjs` (`resolveSuiteState`, env file loading), `scripts/live-matrix.json` schema, `packages/providers/{hyper,opencode-go,openrouter,kilo}/src/models.ts` (discovery functions; `listOpenRouterModels` and `listKiloModels` for their probes).
    - Options Considered:
      - Folding the checks into `live-matrix.mjs`. Rejected: the pre-flight must run before an operator decides to spend money, and its output is a checklist, not a test report.
    - Chosen Approach:
      - A separate, offline-testable script with an opt-in probe per provider.
    - API Notes and Examples:
      ```text
      check                               status  detail
      env file mode                       pass    0600
      env file outside repo               pass    ~/.config/prism/live.env
      HYPER_API_KEY present               pass    (value hidden)
      OPENCODE_GO_API_KEY present         pass    (value hidden)
      keys not committed                  pass
      pi on PATH                          pass    pi 1.3.0
      pi providers ready                  pass    hyper, opencode-go
      probe hyper (GET /models)           pass    200, 14 models
      probe opencode-go (GET /models)     pass    200, 16 models
      probe openrouter (GET /models)      pass    discovery succeeded (key hidden)
      probe laya (127.0.0.1:8000)         pass    reachable
      probe liquid-local (127.0.0.1:8080) pass    reachable
      ```
    - Files to Create/Edit:
      - `scripts/live-preflight.mjs` (new), `scripts/live-preflight.test.mjs` (new).
      - `package.json`: `"test:live:preflight": "bun scripts/live-preflight.mjs"`.
      - `docs/live-testing.md`: preflight reference (from Task 30's section). Replace the sentence that says the preflight "lands with plan 215 Tasks 31–33" (Task 30 finding 1).
      - Found during execution: `scripts/run-all-tests.mjs` (registers the test in `bun run test`), `CHANGELOG.md`.
    - References:
      - Task 30 methodology.
  - Test Cases to Write:
    - `preflight_rejects_world_readable_env_file`, `preflight_rejects_tracked_env_file`, `preflight_reports_missing_vars_by_name`, `preflight_detects_committed_key`, `preflight_never_prints_values`, `preflight_probe_uses_provider_package` (injected fetch, one per provider, explicitly `providers/openrouter` through `listOpenRouterModels`; no completion request or claim that public catalog success validates a key), `preflight_prefix_selects_all_release_rows`, `preflight_reports_missing_binary`, `preflight_reports_pi_provider_not_ready`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator tooling.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: preflight usage.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Script.** `scripts/live-preflight.mjs` exports pure, injectable check functions (`selectSuites`, `checkEnvFile`, `checkVariables`, `secretValues`, `checkCommittedKeys`, `checkPrerequisites`, `runProbes`, `runPreflight`, `main`) over injected `fs`/`exec`/`fetch`/`load`. It reuses `loadMatrix`/`parseEnvFile` from `scripts/live-matrix.mjs`, the cache-parity row's own `preflight()`/`CELLS` from `scripts/cache-parity/live.mjs`, and `scratchDir()` from `scripts/litellm/up.mjs`. Selection is "active row whose id equals or starts with a selector"; `--suite` is repeatable; no match exits 2. The presence check uses the runner's merge (`{ ...envFile, ...process.env }`), so it agrees with what `test:live` will see. `resolveSuiteState()` was not reused: it returns one skip reason per row, and the preflight needs one named row per variable.
    - **Checks as built.**
      - Env file: exists and is a regular file; mode `& 0o077 === 0`; outside the repo by `realpath` + `relative`, else `git check-ignore -q` must succeed (a tracked file is not ignored, so it fails). A parse error fails with the loader's `path:line` message (no content).
      - Variables: one row per unique `requires` name (detail names the rows that need it) and one per `requiresAny` group.
      - Committed keys: values of selected rows' variables named `*KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL` and at least 8 characters long go to `git grep -l -F -f -` on **stdin**, never argv; a hit names the variable and the files. Flags and URLs are not scanned (they appear in docs legitimately).
      - Prerequisites: `release/cache-parity` → `pi --version`, then the pi extension per enabled cell provider (`pi-commandcode-provider`, `pi-ollama-cloud`). `providers/litellm` → the pool's rendered `compose.yaml` in `scratchDir()` exists (offline proof that `up.mjs` ran; `--probe` then proves the proxy answers).
      - Probes (`--probe` only), selected by the trigger variable a chosen row requires, so each provider is probed once: `listHyperModels`, `listOpenCodeGoModels`, `listOpenRouterModels`, `listKiloModels`, `listLiteLLMModels` (`PRISM_LIVE_LITELLM_BASE_URL`, default loopback 4000), `listCommandCodeModels`, `listOllamaCloudModels`; Jev and hosted Liquid via one single-`noul`-question `decide` through `createTypeSafeProvider`/`createLiquidProvider` (`maxRetries: 0`); Laya via the suite's own `checkLayaServerReachable`; `liquid-local` via `GET /health`. Hyper, OpenRouter and Kilo details say "public catalog; key not validated". `openai-codex` has no probe (keyring grant; its T1 row proves it). 15 s timeout per probe.
      - Output: every detail is scrubbed of every known credential value before printing (defence in depth over provider error redaction). Exit 0 only when every row passes, else 2; usage errors exit 2.
    - **Amendment (acceptance criterion).** `pi auth reports the hyper and opencode-go providers ready` was replaced by the pi-extension check: after the 2026-11-08 amendment the parity cells are Command Code and Ollama Cloud, run through pi extensions with the key passed in the child env, so "pi provider ready" means the extension is installed (the rule `scripts/cache-parity/live.mjs` itself applies). The criterion text is updated.
    - **Tests.** `scripts/live-preflight.test.mjs` (registered in `scripts/run-all-tests.mjs` after `live-matrix.test.mjs`), 11 tests, all offline: the nine named ones, plus a full-pass case and a usage/unmatched-suite exit-2 case. `preflight_probe_uses_provider_package` runs every probe for `providers/` through the real provider packages with an injected fetch and asserts the package's own URLs (OpenRouter exactly one `GET https://openrouter.ai/api/v1/models`), the Jev Bearer header, no generation endpoint, and one probe per provider. `preflight_never_prints_values` seeds fake keys, makes every probe error echo them, commits one, and asserts no value appears in stdout/stderr and that `[redacted]` does. `preflight_prefix_selects_all_release_rows` also asserts every probe trigger is a real manifest requirement.
    - **Checks.** `scripts/live-preflight.test.mjs`, `scripts/live-matrix.test.mjs`, `scripts/live-doc-check.test.mjs`, `scripts/run-all-tests.test.mjs`, `scripts/scan-secrets.test.mjs`: 53 pass. `bun scripts/live-matrix.mjs --check` passes; Biome clean on the new scripts. A real no-probe run against the owner's `~/.config/prism/live.env` (`--suite providers/ --suite release/cache-parity`) exits 2 with only genuine gaps (TypeSafe, Liquid, Laya, `llama-server`, keychain and cache-parity switches unset; the LiteLLM pool not started); env file mode 0600, outside repo, 7 keys not committed, `pi 1.5.0` and both extensions ready. No `--probe` run was made: it would spend owner credentials and belongs to Task 34. `src/__tests__/docs.test.ts` has 6 failures, all from the uncommitted `packages/memory/observational → packages/memory/system` rename in the working tree (missing `packages/memory/observational/README.md` links and an examples emit), none from this task's files. No kernel or package code changed, so typecheck and the compat gate are unaffected.
    - **Docs.** `docs/live-testing.md`: the "lands with plan 215 Tasks 31–33" sentence is replaced by a **Pre-flight check** reference (a table of checks and what passes), the entry criterion and the Procedure now run `--probe` and preflight `release/journey-` + `release/cache-parity` (with `PRISM_LIVE_CACHE_PARITY=1`, which the row requires). `package.json` gains `test:live:preflight`. `CHANGELOG.md` has an entry.
    - **Findings for later tasks.**
      1. `--suite release/` also selects the manual-only rows `release/context-rot`, `release/skill-evals`, `release/memory-bench` and `release/eval-gate`, whose switches an acceptance run does not set, so it can never pass in the acceptance procedure. Tasks 34 and 39 and the whole-plan verification are amended (2026-11-08) to `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe`. Task 30's acceptance text above keeps its original wording as executed history.
      2. Task 33: once the `release/journey-*` rows exist, `--suite release/journey-` selects them and the Hyper/OpenCode Go probes follow from their `requires`; no preflight change is needed. If a journey row requires a provider key that has no entry in `PROBES`, add one; no test catches a missing probe.
      3. Task 34: the owner's env file currently lacks `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `PRISM_LIVE_LAYA`, `PRISM_LIVE_LLAMA_SERVER_URL` and `PRISM_TEST_KEYCHAIN`, and the LiteLLM pool has not been rendered; the preflight will name each of these.

- [x] Task 32: The provider-agnostic SDK journey (was plan 186 Task 3)
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` skips with a reason unless all of these are set: `PRISM_LIVE_PROVIDER_TESTS=1`, `PRISM_LIVE_RELEASE_JOURNEY=1`, `PRISM_LIVE_JOURNEY_PROVIDER` (`hyper` | `opencode-go`), and that provider's key. The fixture maps the provider name to its package instance (`hyper({ apiKey: "env:HYPER_API_KEY" })` or `opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`) and its model variable. Nothing else in the suite names a provider. Agents are built only through `createAgent` and first-party packages, in a temp git repository, with these scenarios:
      1. **Stream contract.** One text run: event order `run.started → turn.started → message.delta* → turn.completed → message.completed → run.completed` (amended 2026-11-08: the kernel settles the provider attempt before it appends the message); usage reported (`usage.estimated !== true`) and following the inclusive usage rule (plan 182 Task 4: `cacheReadTokens + cacheWriteTokens ≤ inputTokens`).
      2. **Tool loop.** `toolsCoding({ root })` + `approvalPackage({ mode: "ask", rules: [{ tool: "read" }] })` (a static allow for `read`); the model is told to read `README.md` and quote its first line; the transcript contains the line and a `tool.completed { status: "finished" }`. The second provider request carries the replayed thinking (plan 182 Tasks 6–7) and is accepted.
      3. **Approval suspend and resume across processes.** `sqliteStore({ path })` + the same approval config, so `write` asks; no host UI → `run.suspended`; a second `bun` subprocess opens `agent.session({ id })` over the same database and resumes `allow_once`; the file exists with the requested content.
      4. **Gate integrity, live.** In the same setup, resume with `modifiedArguments` pointing outside the root → `tool.completed { status: "blocked" }`, no file written (plan 177 Task 3).
      5. **Rewrite re-gate, live.** A test package rewrites the model's `write` path outside the root → denied by the coding hard-deny (plan 177 Task 2).
      6. **Ownership isolation.** One agent, two sessions under `{ userId: "a" }` and `{ userId: "b" }`; B's run on A's session id → `SessionNotFoundError`, and A's transcript text never appears in any of B's events (plan 177 Task 4).
      7. **Limits.** `limits: { maxToolRounds: 1 }` on a prompt that needs two chained reads (`POINTER.md` names a file the model cannot guess) → clean stop with `stopReason: "turn_limit"` (amended 2026-11-08: a `maxTurns` overrun is a `run.failed` limit breach by design, and `maxToolRounds` has a minimum of 1); a token budget breach → `run.failed` with `limit`.
      8. **Compaction.** `memory-compaction` with a low threshold over a three-turn session → `compaction.completed` with a summary produced by the live model through `prism.models.client`, and the next turn still answers a question about turn one.
      9. **Remote host, two principals.** `serveAgent` on loopback WebSocket with an `authenticate` that maps two tokens to two principals; principal B cannot open A's session and receives none of A's approval requests (plan 178 Task 2).
      10. **Abort.** `session.abort()` during a streaming turn → `run.failed` with an abort code within 5 s, and the session accepts the next run.
      Scenario 11 of the superseded plan (memory across sessions, plan 188.11 Task 7) is **dropped by owner decision 2026-11-04**: the memory packages are experimental in 0.13.0, so no live release row depends on them. The offline `apps/prism-agent/src/scenarios/conversational-memory.ts` stays in `bun run test`. The live two-principal memory leg returns with the memory track (plan 210 Task 9).
    - Functional: Leak scan: after every scenario, the `assertNoSecretLeak` substring rule (amended 2026-11-08: the helper lives on `@arnilo/prism/provider-kit`, which the reference host may not import, so the fixture applies the same rule locally) runs over every event, `agent.inspect()`, every SQLite row (`SELECT *` of every table), the remote wire frames, subprocess stdout/stderr, and thrown error messages, with that provider's key as the needle.
    - Functional: API level: the suite asserts each listed package is `loaded` in `agent.inspect()` and its definition declares `requires.api === KERNEL_API_LEVEL` (plan 179 Task 2). Amended 2026-11-08: `inspect()` does not report `requires`, so the level is read from the listed instance and joined to `inspect()` by name.
    - Functional: OpenCode Go's required session correlation is satisfied by the kernel default (`applyDefaultProviderRequestOptions` stamps `sessionId`); the journey does not set it by hand, which proves the default works.
    - Performance: Budget per provider: at most 36 provider requests and 80k input tokens per full run, enforced by `limits` on every run plus a counting `model.call` hook and a counting `fetch` passed to the provider package (amended 2026-11-08: the compaction summary call goes through `prism.models.client`, which fires no `model.call`), either of which fails the suite on overrun; the one-time catalog lookup is counted separately as `catalogRequests`; per-scenario timeout 120 s; each provider's suite ≤ 15 min. The `apps/prism-agent` README and the manifest rows state the budget.
    - Code Quality: Scenarios share one fixture module. Prompts are fixed strings with a deterministic instruction ("call the read tool with path README.md, then answer with its first line only"). Assertions check Prism behaviour, and model-text assertions are limited to substring presence. The two providers run the same file; a provider-specific branch in a scenario is not allowed (a test greps the scenario file for provider names).
    - Security: Keys are referenced only as `env:` refs; the test reads `process.env.<KEY>` only to seed the leak scan.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/package.json` (already depends on approval, coding, sqlite, remote, compaction, headless), `apps/prism-agent/src/scenarios/*`, `packages/providers/{hyper,opencode-go}/src/index.ts`, plan 183 Task 5 (tier-1 scenarios), `src/testing/index.ts` (`assertNoSecretLeak`), plans 177–178, 179 Task 2, 182–183, and 185.
    - Options Considered:
      - A new `scripts/live-journey.test.ts` at the repo root. Rejected: the reference host is the roadmap's end-to-end proof (§2.13) and already wires every package the journey needs.
      - Two journey files, one per provider. Rejected: one parameterized file is what proves the journey is provider-agnostic.
    - Chosen Approach:
      - A tier-2 suite in the reference host, provider injected through one fixture, with hard request ceilings, run once per provider.
    - API Notes and Examples:
      ```ts
      const live = journeyProvider(process.env.PRISM_LIVE_JOURNEY_PROVIDER); // { pkg, model, keyEnv }
      const agent = await createAgent({
        model: live.model,           // e.g. "hyper/deepseek-v4-pro" | "opencode-go/kimi-k3"
        packages: [live.pkg, toolsCoding({ root }), approvalPackage({ mode: "ask", rules: [{ tool: "read" }] }), sqliteStore({ path })],
        limits: { maxTurns: 6, maxInputTokens: 20_000 },
      });
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` (new), `apps/prism-agent/src/__tests__/live/fixture.ts` (new), `apps/prism-agent/src/__tests__/live/resume-child.ts` (new, the second process).
      - `apps/prism-agent/package.json`: `devDependencies` for `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-provider-commandcode`, and `@arnilo/prism-provider-ollama-cloud` (`workspace:*`); Hyper is already a runtime dependency.
      - Found during execution: `src/loop/run-controller.ts` + `src/__tests__/resume-gate-integrity.test.ts` (blocked `tool.completed`), `packages/tools/coding/src/{hard-deny.ts,security/path-containment.ts,__tests__/hard-deny.test.ts}` (nested create), `docs/live-testing.md` (budget and model text), `scripts/live.env.example` (journey model variables).
      - `apps/prism-agent/README.md`: live journey section with the budget and the provider switch.
    - References:
      - plans 177 (Tasks 31–34), 178 (Task 31), 179 (Task 31), 182 (Tasks 33, 6–7), 183 (Tasks 31–32, 5), 185.
  - Test Cases to Write:
    - The ten scenarios above, named `live_journey_<n>_<slug>`, run per provider.
    - `live_journey_skips_without_credentials`: runs in `bun run test`; asserts a clean skip and zero network.
    - `live_journey_budget_guard_trips`: hermetic, with the mock provider forced past the request ceiling.
    - `live_journey_scenarios_name_no_provider`: the scenario module contains no provider id or package name.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tests.
    - Docs pages to create/edit:
      - `apps/prism-agent/README.md`: live journey section.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Suite.** `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` holds the ten scenarios (`live_journey_<n>_<slug>`) and three hermetic tests that run in `bun run test`: `live_journey_skips_without_credentials` (each missing switch or key yields a named reason; a throwing `fetch` spy proves zero network), `live_journey_budget_guard_trips` (mock provider past the request ceiling, then past the token ceiling, then the counting transport refusing a request), and `live_journey_scenarios_name_no_provider` (the scenario file and the resume child contain no provider id, package name, key variable, or model variable; the needles come from the fixture table, so the test file names none). `live/fixture.ts` is the only module that names a provider. `live/resume-child.ts` is the second process: it builds the identical agent (the resume fingerprint must match) over the same SQLite file and prints one JSON line with its events and spend, which the parent folds into the budget and leak-scans. On failure, a scenario prints a compact trail of `run.*` / `tool.completed` / `decision.*` / `compaction.*` events that have already passed the leak scan.
    - **Fixture choices.** Agents carry `principal: { kind: "user", id: "journey" }` and `ownership: { tenantId: "journey" }`, because `write` is a durable effect (`ERR_PRISM_CODING_PRINCIPAL_REQUIRED` otherwise). `toolsCoding` pins no principal id, so a remote principal may write (scenario 9 failed with `ERR_PRISM_CODING_PRINCIPAL_MISMATCH` while it was pinned). Six unused coding tools are `disable`d (`edit`, `grep`, `glob`, `delete`, `move`, `ask_user_decision`), cutting each request by ~2k input tokens; shell, git, todo and worktrees are off in config.
    - **Owner direction (2026-11-08).** Asked to authorize the validation spend on Hyper and OpenCode Go, the owner directed the runs to Command Code (`Qwen/Qwen3.7-Flash`) and Ollama Cloud (`gemma4:31b`). The fixture table therefore has four providers: `hyper` (`deepseek-v4-pro`), `opencode-go` (`mimo-v2.5`, the T1 chat default from plan 183 Task 1 (e)), `commandcode`, and `ollama-cloud`. Hyper and OpenCode Go were not run live in this task.
    - **Live results (final code, except as noted).**
      - Command Code `Qwen/Qwen3.7-Flash`: 13 pass, 0 fail. 25/36 requests (this run predates the catalog split, so 1 catalog request is included) and 14,711/80,000 input tokens. Per scenario (requests / input tokens / ms): 1: 1/639/3026; 2: 2/1365/9518 (thinking produced and replayed); 3: 2/1404/3666; 4: 2/1411/5769; 5: 2/1414/9783; 6: 2/1307/4564; 7: 3/2017/4622; 8: 6/3101/33016; 9: 2/1395/3126; 10: 2/658/27286.
      - Ollama Cloud `gemma4:31b`: 13 pass, 0 fail. 28/36 requests, 12,287/80,000 input tokens, 27 catalog requests. Per scenario: 1: 1/409/635; 2: 2/888/1291 (no thinking produced, so the replay assertion is vacuous for this model); 3: 2/923/2398; 4: 2/933/3212; 5: 6/3736/7435; 6: 2/847/3175; 7: 3/1312/4910; 8: 6/1896/6669; 9: 2/915/1871; 10: 2/428/2174.
      - No leak-scan finding on either provider.
    - **`prism` defects found and fixed in this task** (each with a test that fails on the old code):
      1. **Gate denials emitted no event.** `RunController.executeTools` returned a `hook_denied` result for a `tool.call` deny (or an ask the host refused) with no `tool.completed`, on fresh and resumed runs alike, against `docs/events.md` ("a tool call that … is blocked … is one `tool.completed` carrying its `status`"). The fix is a `blocked()` helper in `dispatchOne` (`src/loop/run-controller.ts`) that emits `tool.completed { status: "blocked", reason, error }` through the same redacted `emit`. Test: `gate_denied_call_settles_as_blocked_tool_completed` in `src/__tests__/resume-gate-integrity.test.ts` (resume with out-of-root `modifiedArguments`, and a fresh-run deny).
      2. **Creates under new directories were hard-denied.** The coding hard-deny (`realTarget`) and `isPathInsideReal` realpath'd only the immediate parent, so `write notes/x.txt` with no `notes/` was refused as "outside coding roots". The new `realpathNearest` in `security/path-containment.ts` realpaths the nearest existing ancestor and re-appends the missing tail, which cannot hold a symlink because it does not exist. Any non-`ENOENT` error still fails closed, and both checks now use it. Test: `hard_deny_allows_create_under_new_directories` (one and several new directories are inside; a symlinked ancestor and `..` still escape).
    - **Checks.** The hermetic journey tests pass: 3 pass, 1 skip. `resume-gate-integrity.test.ts`: 7 pass. Coding package: 625 pass; the one failure, the `200 spawn/exit cycles` leak test timing out at 5 s, fails identically without this change. `reference-host-boundary.test.ts` passes after the fixture stopped importing `@arnilo/prism/provider-kit`. `apps/prism-agent` typecheck shows no error in the journey files. The kernel `bun test src` run, the app typecheck, and `scripts/live-matrix.test.mjs` / `live-doc-check.test.mjs` all have failures. Each was confirmed pre-existing or caused by the uncommitted working-tree state, none from this task's files: `@arnilo/prism-memory-fabric` is unresolvable during the in-progress memory rename; `network-free-guard` names `provider-live-selection.test.ts` and `kagi.test.ts`; `host-surface-gate`, `core-boundaries` ("anthropic"), the manifest-validation test, and the peer-dependencies doc test. No export moved, so there is no baseline diff. `run-controller.ts` was already out of Biome format at HEAD (the uncommitted `biome.json` change), so only the new lines were added and the file was not reformatted.
    - **Findings for later tasks.**
      1. Task 33: the manifest rows as written are `release/journey-hyper` and `release/journey-opencode-go`, but the owner directed the validation runs to Command Code and Ollama Cloud. Before adding rows, confirm with the owner which providers gate T2. The suite supports all four, and `scripts/live.env.example` already documents all four journey model variables (OpenCode Go's default `mimo-v2.5` is filled in). Command Code and Ollama Cloud rows would need `COMMAND_CODE_API_KEY` / `OLLAMA_API_KEY` in `requires` and preflight probes, which `PROBES` already has. The suite needs no longer runner timeout: the slowest full run took about 2 minutes.
      2. Task 33 / Task 34: the T2 command needs `PRISM_LIVE_RELEASE_JOURNEY=1` and the provider switch. A full run is ≤ 28 generation requests and ≤ 15k input tokens on the two tested models, well inside the 36 / 80k budget, so the budget stands unchanged.
      3. Backlog: a durable-effect principal refusal (`ERR_PRISM_CODING_PRINCIPAL_MISMATCH`) settles as `tool.completed { status: "finished" }` with the error in the result value, not as `error` or `blocked`. It was seen live in scenario 9 before the fixture fix. It is not a journey assertion, so it is recorded, not fixed here.
      4. Task 34: scenario 2's thinking-replay assertion holds only when the model produces thinking. `gemma4:31b` produced none. A journey model chosen for T2 should be a thinking model on at least one provider, or that leg proves nothing.

- [x] Task 33: Register the suites and wire them into the release (was plan 186 Task 4)
  - Acceptance Criteria:
    - Amendment (2026-11-08, Task 32 finding 1): before adding the rows below, confirm with the owner which providers gate T2. The Task 32 validation runs were directed to Command Code and Ollama Cloud, and the suite accepts `hyper`, `opencode-go`, `commandcode`, and `ollama-cloud`. The OpenCode Go journey default is `mimo-v2.5`, and the template already lists all four model variables.
    - Owner decision (2026-11-08, asked in this task): T2 is gated on **Command Code and Ollama Cloud**. The rows are `release/journey-commandcode` and `release/journey-ollama-cloud`; Hyper and OpenCode Go keep fixture entries for ad-hoc runs but get no release row. The original row text below is kept as history; the executed rows are in the notes.
    - Functional (as originally written): `scripts/live-matrix.json` gains two rows. `release/journey-hyper`: `package: "@arnilo/prism-agent"`, `status: "active"`, `cwd: "apps/prism-agent"`, `command: "PRISM_LIVE_JOURNEY_PROVIDER=hyper bun test --timeout=0 src/__tests__/live-provider-journey.test.ts"`, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_RELEASE_JOURNEY", "HYPER_API_KEY"]`, `model: [{ env: "PRISM_LIVE_HYPER_JOURNEY_MODEL", default: "deepseek-v4-pro", wired: true }]`, `scope`, and `cost` from Task 32. `release/journey-opencode-go` is the same with `OPENCODE_GO_API_KEY` and `PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`; its default model comes from plan 183 Task 1 (e).
    - Functional: `node scripts/generate-live-docs.mjs --write` refreshes the table; `scripts/live-doc-check.test.mjs` and `scripts/live-matrix.test.mjs` pass.
    - Functional: `scripts/e2e-coverage.json` records the journey as covering the kernel root, `/testing`, both provider packages, and the packages it loads.
    - Functional: Task 39's pre-flight lists as required steps before the owner confirmation: the strict run of `providers/` and `release/` (both journeys and cache parity), and the evidence file. It is edited in this task if not already present.
    - Performance: n/a.
    - Code Quality: No runner changes beyond the manifest rows unless Task 32 needs a longer suite timeout (`PRISM_LIVE_SUITE_TIMEOUT_MS` per-suite override, if the runner lacks one).
    - Security: Each row's `scope` names the least-privilege key and spend cap; the manifest validator's secret-shape rule passes.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.json` (row schema), `scripts/generate-live-docs.mjs`, `scripts/e2e-coverage.json`, Task 39.
    - Options Considered:
      - A separate release-only runner. Rejected: strict mode plus a filter already expresses "these suites must run".
    - Chosen Approach:
      - Two manifest rows and one Task 39 pre-flight line.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      ```
    - Files to Create/Edit:
      - `scripts/live.env.example`: every env name the new rows add, as a `# NAME=` entry (`live_env_example_has_no_values`, Task 30 finding 2); fill in the OpenCode Go journey default.
      - `scripts/live-matrix.json`, `docs/live-testing.md` (generated table), `scripts/e2e-coverage.json`, `plans/187-Phase-11-Part-N-Retired-Name-Sweep-Publish-And-Deprecation.md` (Task 31 pre-flight, if not already edited).
      - Found during execution: `apps/prism-agent/package.json` (two `test:live:journey:<provider>` scripts, because the manifest validator requires `command` to start with `bun ` and the runner wraps it in `with-build-lock.mjs`, so an `ENV=x bun test` prefix is not allowed), `apps/prism-agent/README.md` (release rows and the strict command). Plan 187 is superseded; its pre-flight lives in this plan's Task 39.
    - References:
      - Task 32; plans 183 Task 6 and Task 24 of this plan (their rows).
  - Test Cases to Write:
    - `live-matrix > manifest validates` and `live-doc-check` (existing, green with the rows).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: generated table rows.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **Owner decision.** Asked per the Task 32 amendment, the owner chose Command Code + Ollama Cloud to gate T2 (the providers Task 32 validated live, and the cache-parity row's keys).
    - **Manifest rows** (`scripts/live-matrix.json`, after `release/cache-parity`): `release/journey-commandcode` and `release/journey-ollama-cloud`. `package: "@arnilo/prism-agent"`, `status: "active"`, `cwd: "apps/prism-agent"`, `source: apps/prism-agent/src/__tests__/live-provider-journey.test.ts`, `command: "bun run test:live:journey:<provider>"`, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_RELEASE_JOURNEY", "COMMAND_CODE_API_KEY" | "OLLAMA_API_KEY"]`, `model: [{ env: "PRISM_LIVE_COMMANDCODE_JOURNEY_MODEL", default: "Qwen/Qwen3.7-Flash" } | { env: "PRISM_LIVE_OLLAMA_CLOUD_JOURNEY_MODEL", default: "gemma4:31b" }]` (both `wired: true`). `scope` names the ten scenarios, the leak-scan needle, and the least-privilege key with a provider-side spend cap; `cost` states the 36-request / 80k-token hard budget, the 120 s / 15 min timeouts, and the Task 32 measurement.
    - **Runner.** No runner change. `validateMatrix` requires `command` to start with `bun `, and the runner wraps it in `with-build-lock.mjs`, so the provider switch cannot be an env prefix. Instead, `apps/prism-agent/package.json` gains `test:live:journey:commandcode` and `test:live:journey:ollama-cloud`, which set `PRISM_LIVE_JOURNEY_PROVIDER` and run the one journey file. No longer suite timeout is needed (Task 32: about 2 min per provider, against the 600 s default).
    - **Env template.** `scripts/live.env.example` already lists all four journey model variables and `PRISM_LIVE_RELEASE_JOURNEY` (Task 32), so it needed no change.
    - **Coverage.** `scripts/e2e-coverage.json` lists the journey under `@arnilo/prism` `.` and `./testing`, all four fixture providers (`commandcode`, `ollama-cloud`, `hyper`, `opencode-go`: the fixture imports each one), `approval`, `tools-coding`, `store-sqlite`, `remote`, and `memory-compaction`. That is 11 entries. `@arnilo/prism-agent` is private and has no exports surface.
    - **Docs.** `node scripts/generate-live-docs.mjs --write` regenerated the table. `docs/live-testing.md`'s T2 row and journey model-selection paragraph name the new rows and scripts. `apps/prism-agent/README.md` names the release rows and gives the strict command (`PRISM_LIVE_STRICT=1 PRISM_LIVE_RELEASE_JOURNEY=1 PRISM_LIVE_FILTER=release/journey- bun run test:live`).
    - **Task 39 pre-flight.** Already present: the preflight, the strict `providers/`, `release/journey-` and `release/cache-parity` runs, and the evidence file. Only its provider names were amended, Hyper and OpenCode Go → Command Code and Ollama Cloud. Task 34's prerequisites now name the journey keys.
    - **Checks.** `bun scripts/live-matrix.mjs --check` validates and lists both rows (skipping on `PRISM_LIVE_RELEASE_JOURNEY` in the owner env). `bun scripts/live-preflight.mjs --suite release/journey-` selects both rows; `COMMAND_CODE_API_KEY` and `OLLAMA_API_KEY` are present, and only the `PRISM_LIVE_RELEASE_JOURNEY` switch is missing, which the acceptance run sets. `PROBES` already covers both providers. `bun run test:live:journey:commandcode` in `apps/prism-agent`, without the switch: 3 pass, 1 skip, no network. `apps/prism-agent` `tsc --noEmit`: 0 errors. `live-matrix.test.mjs`, `live-preflight.test.mjs` and `live-doc-check.test.mjs`'s generated-table test pass; `bun scripts/e2e-coverage-gate.mjs` passes (82/86 covered, baseline mode). No live spend was incurred.
    - **Failures from other work, not this task.** These come from the uncommitted memory rename in the working tree (`memory-observational` + `memory-fabric` → `memory-system`): `live-doc-check.test.mjs` has two peer-dependency matrix tests (Task 32 saw them too), and `e2e-coverage.test.mjs` expects 87 surfaces and finds 86, because the merged packages lost a surface. The owner of the memory rename (plan 216 onward) must update the count and the peer rows. No export moved, so there is no baseline diff.

- [x] Task 34: First acceptance run and evidence (owner provides the keys) (was plan 186 Task 5)
  - Acceptance Criteria:
    - Functional: Prerequisites: Tasks 1–33 of this plan are complete; the owner confirms that `~/.config/prism/live.env` holds the seven keys (`HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `OPENROUTER_API_KEY`, `KILO_API_KEY`, `LITELLM_API_KEY`) with spend caps, confirms authorization for the selected OpenRouter and Kilo models (paid cache remains separately gated), and approves the Kilo device-login verification URL; the journey keys `COMMAND_CODE_API_KEY` and `OLLAMA_API_KEY` and the switch `PRISM_LIVE_RELEASE_JOURNEY=1` are set (amended 2026-11-08 by Task 33: T2 is gated on Command Code and Ollama Cloud); `scripts/litellm/up.mjs` runs the local LiteLLM proxy; `laya-serve` and `llama-server` (`d1-3B`) are running on the dev machine; `pi` is installed with Hyper and OpenCode Go configured. The executor then:
      1. runs `bun scripts/live-preflight.mjs --suite providers/ --probe` and `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe` (amended 2026-11-08 by Task 31: `--suite release/` also selects the manual-only release rows), including the OpenRouter, Kilo, and LiteLLM discovery/key checks before their strict T1 runs;
      2. runs the strict `providers/` run, both journeys, and the cache-parity row;
      3. writes `docs/_evidence/live-release-acceptance-0.13.0.md`: commit; per provider, the model ids, per-scenario status, request counts, input tokens, durations, and leak-scan result; failure classifications; the T1 summary (linking `docs/_evidence/provider-live-0.13.0.md`); the cache-parity table (linking `docs/_evidence/cache-parity-0.13.0.md`); the operator.

      The file contains no secret: the task runs `assertNoSecretLeak` over it with every key.
    - Functional: Any `prism`-class failure, on either provider, reopens the owning plan's task; the run is repeated after the fix, and the evidence file records every run.
    - Performance: Record actual request counts against each budget.
    - Code Quality: The evidence file follows the existing `docs/_evidence/` conventions.
    - Security: The executor never prints or asks for a key in chat; if the preflight fails on credentials, the executor stops and asks the owner to fix the env file.
  - Approach:
    - Documentation Reviewed:
      - Task 30 procedure, `docs/_evidence/live-matrix-report.md` format, plans 183 Task 6 and Task 24 of this plan evidence files.
    - Options Considered:
      - Waiting for the publish task to run it the first time. Rejected: a failure found during publish pre-flight delays the release more than one found now.
    - Chosen Approach:
      - One full acceptance run as soon as the fixes land; Task 39 repeats it on the release commit.
    - API Notes and Examples:
      ```bash
      bun scripts/live-preflight.mjs --suite providers/ --probe
      PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live
      PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
      ```
    - Files to Create/Edit:
      - `docs/_evidence/live-release-acceptance-0.13.0.md` (new), `docs/_evidence/live-matrix-report.{json,md}` (regenerated by the runner).
    - References:
      - Tasks 30–33; plans 183, 184.
  - Test Cases to Write:
    - n/a — an execution task; its proof is the evidence file and the strict runs' exit codes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/_evidence/live-release-acceptance-0.13.0.md` (evidence, excluded from the published tarball by the root `files` rule `!docs/_evidence`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08 → 2026-11-09):
    - **Outcome.** The first acceptance run is done and recorded in `docs/_evidence/live-release-acceptance-0.13.0.md`, with each runner report in `docs/_evidence/live-release-acceptance-0.13.0/` (`01`–`10`, in run order). **It is not green.** No `prism`-class failure occurred, so no owning plan task is reopened. What remains is account state plus one gate question, both carried to Task 39 below.
    - **Owner scope decision (2026-11-08).** The offline preflight named the gaps this note's original prerequisites listed (TypeSafe and Liquid keys, `laya-serve`, `llama-server`, `PRISM_TEST_KEYCHAIN`, the LiteLLM pool). Asked how to proceed, the owner answered: "Use clef from ollama cloud for decision models. Ignore the rest."
      - Decision-model coverage therefore comes from Ollama Cloud `clef:27b` through the shared System One scenarios.
      - `providers/{typesafe,liquid,laya,liquid-local,openai-codex,litellm}` were not run.
      - The executed preflight and strict runs cover `providers/{ollama-cloud,hyper,opencode-go,openrouter,commandcode,kilo}` one filter at a time (the runner's filter is a substring), plus `release/journey-` and `release/cache-parity`. Both `--probe` preflights passed.
    - **Results.**
      - `providers/ollama-cloud`: 18/18, including the five `clef` System One scenarios.
      - `providers/openrouter`: 5 pass, 1 gated skip.
      - `providers/commandcode`: green on rerun, 20 pass, 3 by-design skips.
      - `release/journey-commandcode`: 13/13, 26/36 requests, 16,555/80k input tokens; thinking replayed.
      - `release/journey-ollama-cloud`: 13/13, 26/36 requests, 10,757/80k input tokens.
      - `release/cache-parity`: the three Command Code cells pass (Messages on its one allowed rerun after `inconclusive`). Ollama Cloud is `behind`: inclusive 0.850 against 0.890, with overlapping ranges; first-turn-excluded 0.943 against 0.925, so Prism leads warm. 192 requests in total.
      - No leak-scan finding in any scenario. `assertNoSecretLeak` over the evidence file and all reports, with every env value of at least 8 characters (12 needles): no hit.
    - **Failures, classified.**
      - `env/operator`: Hyper (HTTP 402 `billing_error`, no credits), Kilo (HTTP 402 `usage_limit_exceeded`, negative balance), OpenCode Go (HTTP 429 `GoUsageLimitError`, monthly).
      - `vendor`: the Command Code ZDR fixture model `poolside/laguna-s-2.1-free` was retired on 2026-11-04 (HTTP 403), so it was replaced and rerun green. OpenCode Go retired `mimo-v2.5` (HTTP 410, replacement `mimo-v2.6-flash`), and `qwen3.6-plus` is gone from its catalog.
      - `gate/metric`: the Ollama Cloud parity cell.
      - The preflight's Hyper, OpenRouter and Kilo probes read public catalogs ("key not validated"), so account balance surfaced only in the strict runs.
    - **Changes made in this task.**
      - `packages/providers/ollama-cloud/src/__tests__/live.test.ts`: a `runSystemOneLiveScenarios` block over `PRISM_LIVE_OLLAMA_CLOUD_DECISION_MODEL` (default `clef:27b`).
      - `packages/providers/commandcode/src/__tests__/live-agent.test.ts`: the non-ZDR fixture is now `PRISM_LIVE_COMMANDCODE_NON_ZDR_MODEL` (default `stealth/glyph-cluster:free`). Both free catalog models answered 422 `cmd_zdr_no_providers` on 2026-11-09.
      - Both variables are added to `scripts/live-matrix.json` (model list; the Ollama Cloud scope and cost name the decision leg) and to `scripts/live.env.example`. `docs/live-testing.md` is regenerated.
      - `src/testing/provider-live-scenarios.ts`: the text and tool-loop assertions append the provider's terminal `error` message, masked with the suite's secrets, through a module-private `terminalErrorSuffix`. Before this, a billing refusal read "live text response was empty". The test `live_scenarios_name_the_provider_error_instead_of_an_empty_answer` in `src/__tests__/provider-live-scenarios.test.ts` fails on the old code.
    - **Checks.** `src/__tests__/provider-live-scenarios.test.ts`: 4 pass. `scripts/live-matrix.test.mjs`, `live-doc-check.test.mjs` and `live-preflight.test.mjs`: 32 pass. `bun scripts/live-matrix.mjs --check` validates. Root `tsc --noEmit` shows no error in the changed file. Biome is clean on the changed files. No export moved (the helper is module-private), so there is no baseline diff.
    - **Request counts against budgets.**
      - Journeys: 26/36 requests on each provider, as above.
      - Cache parity, per cell against the 120 ceiling: 44, 38, 30 + 30, and 50.
      - Provider rows: the runner does not count requests. The evidence reports usage-bearing requests (Ollama Cloud 9, OpenRouter 4, Command Code 10) next to the manifest `cost` budgets.
    - **Findings for later tasks.**
      1. **Task 39 (owner):** top up or renew Hyper, Kilo and OpenCode Go before the release-commit run. The three refusals happen before any Prism behaviour is exercised.
      2. **Task 39 (owner):** either provide the six out-of-scope rows or record the same scope decision; a strict `providers/` run selects all twelve rows. Task 39's pre-flight text is amended below.
      3. **Task 39 / plan 206 (owner decision):** the Ollama Cloud parity cell is `behind` at parity-level variance (Task 24: pass at 0.866 against 0.860). The inclusive hit rate rises with run length, and pi's median run went from 6 to 8 requests. Options: keep the rule and accept the variance (plans 205 and 206 gate these providers on their own releases), gate this no-lever route on the first-turn-excluded rate, or rerun at Task 39.
      4. **Backlog (OpenCode Go package):** the static catalog (`packages/providers/opencode-go/src/models.ts`, `mimo-v2.5`, `mimo-v2.5-pro`, `qwen3.6-plus`) and the manifest defaults (`PRISM_LIVE_OPENCODE_GO_CHAT_MODEL=mimo-v2.5`, `…_MESSAGES_MODEL=qwen3.6-plus`, journey default `mimo-v2.5`) name retired models. The live catalog now lists `mimo-v2.6-flash`, `mimo-v2.6-pro` and `qwen3.7-plus`. The new ids could not be verified live while the account was over its monthly limit.
      5. **Backlog (Hyper):** the live catalog no longer lists `deepseek-v4-pro` or `qwen3.6-plus` (it lists `deepseek-v4-pro-0813` and `qwen3.8-*`). Re-check the defaults when the account has credits.
      6. **Runner:** the Kilo row's wall time was 7,545.6 s while its tests summed to about 75 s. This is most likely a host suspend, because the runner's 600 s kill timer never fired. Run long live sessions as `systemd --user` units with the machine kept awake.

### Part G — retired-name sweep, CI and registry cleanup, trusted publishing, and publish (ex-plan 187, plus Tasks 36–38 added 2026-11-04)

- [x] Task 35: The final retired-name sweep and the post-train references (was plan 187 Task 1)
  - Acceptance Criteria:
    - Functional: `scripts/retired-names.json` lists every name the train retired: the export names and subpaths from the 0.12.1 → 0.13.0 baseline diff, the retired package names, the retired error codes and classes recorded in plans 143–174, and the CLI flags. `scripts/retired-names.test.mjs` greps `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `node_modules/`, `plans/`, `docs/history/`, `docs/_evidence/`, `CHANGELOG.md`, `docs/migrate-to-0.13.md`, `scripts/retired-names.json`, `scripts/deprecations-0.13.json`, and the compat baselines' history) and fails on any hit. It runs in `bun run test`. (Amended 2026-11-09 at execution: the sweep also skips the other migration guides (`docs/migrate-to-*.md`, `docs/migration.md`), tests, the frozen `scripts/phase<N>-*` evidence, Markdown removal sections and removal sentences, and JSON history comments. It matches uses a reader would follow, not bare words; the Notes give the matchers.)
    - Functional: The planning and execution skill references describe the post-0.13 world:
      - `.agents/skills/create-plan/references/prism.md` §1 drops the `apps/prism-code` lab row in favor of the reference host (`apps/prism-agent`), and §5 drops assumptions the train retired
      - `prism-wiki.md`'s "Where docs go during the 0.13.0 train" becomes "Where docs go": kernel pages in `/docs` (written with the API), package READMEs, and `CHANGELOG.md`
      - `.agents/skills/prism-execution/references/release.md` "Today" describes independent versioning after 0.13.0

      This resolves plan 174 Task 1 (j).
    - Functional: `roadmap.md` and `PRODUCT.md` are consistent with the published state. `roadmap.md` stays the target document: this task updates facts and adds no phases. (Amended 2026-11-09 at execution: the criterion "the roadmap's 'Shipped baseline' line names 0.13.0" moved to Task 39, because 0.13.0 is published there; until then 0.12.1 is the published state.)
    - Performance: The sweep test runs in under 5 s, using `rg`, or a Bun walk if `rg` is absent in CI.
    - Code Quality: The retired-name list is generated from the baseline diff plus a hand-curated error list, not maintained by hand alone. The generator is in the same script.
    - Security: n/a — a repository scan.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Release bullet ("a grep over `scripts/`, `examples/`, and every workspace for retired names and error strings"); `.agents/skills/create-plan/SKILL.md` "Task writing rules" (retirement sweep); plan 080 (retired errors left in tests)
    - Options Considered:
      - A one-off grep recorded in the task note. Rejected: a standing test keeps retired names from coming back after 0.13.0.
    - Chosen Approach:
      - Generate the list, run a standing sweep test, and update the references.
    - API Notes and Examples:
      ```bash
      bun scripts/retired-names.mjs --generate --from scripts/compat-baseline@v0.12.1
      bun test scripts/retired-names.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/retired-names.mjs` (new), `scripts/retired-names.json` (new), `scripts/retired-names.test.mjs` (new)
      - `.agents/skills/create-plan/references/{prism.md,prism-wiki.md}`, `.agents/skills/prism-execution/references/release.md`, `.agents/skills/prism-execution/SKILL.md` (if it names the train)
      - `roadmap.md` (header facts only), `PRODUCT.md` (if plan 175 Task 4 left a train reference)
    - References:
      - plan 173 Task 8 (Prism Code sweep)
  - Test Cases to Write:
    - `no_retired_name_in_live_tree`: fails on any hit, naming the file and the name.
    - `retired_names_cover_baseline_removals`: every removal in the 0.12.1 → 0.13.0 baseline diff is in the list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: the skill references; the `roadmap.md` header
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-09):
    - **The sweep.** `scripts/retired-names.mjs` (new) generates `scripts/retired-names.json` (new) from the v0.12.1 → working-tree compat-baseline diff: `bun scripts/retired-names.mjs --generate [--from v0.12.1]`. Run without flags, it sweeps and exits 1 on any hit. The list holds 57 packages, 19 subpaths, 2,887 exports, 148 `ERR_*` codes and 30 `prism` CLI flags.
      - Packages: the v0.12.1 baselines, the stale baseline files, and `scripts/deprecations-0.13.json`, minus live workspaces.
      - Subpaths: the tag's `package.json` `exports` of packages still live, minus their live `exports` (for example `@arnilo/prism/node/{config,settings,trust}` and `@arnilo/prism/providers/*`).
      - Error codes: `ERR_*` in the tag's non-test `src/` + `packages/`, minus codes in live non-test source; a prefix literal ending in `_` is skipped.
      - CLI flags: flag literals in the tag's `src/cli*.ts`, minus today's.
      - Hand-curated keys that survive regeneration: `vocabulary` (7 names that stay ordinary words, each with a reason, such as the `agentId` field and the `CheckpointStore` `saveCheckpoint`/`loadCheckpoint` methods) and `allow` (2 paths: the phase54 legacy-registry fixture and the `upgrade-0-12` host-builder eval workspace).
      - Retired tool names stay in `scripts/retired-tool-names.json` (Task 7), which the sweep reads.
      - The compat baselines of retired packages are left in place: Task 1 (e)(3) records them as the legacy-registry symbol source.
    - **Matchers (amended from the plan's single grep).** A raw word grep of 2,887 names hits 3,007 files: `session`, `json` and `type` are 0.12 exports, and many un-exported helpers keep their names internally. So each matcher flags a *use a reader would follow*:
      - a retired package specifier anywhere;
      - a retired subpath anywhere;
      - a retired export imported from any `@arnilo/*` specifier;
      - in Markdown and `examples/`, a name imported from a live specifier that does not export it;
      - a retired export in Markdown backticks, only if the name has a capital letter or `_` (code-level uses are covered by `bun run typecheck`);
      - a retired error code anywhere;
      - a retired tool name in Markdown backticks or as a quoted string in source;
      - a retired flag on a `prism …` command line.
    - **Exemptions.**
      - Excluded paths: the plan's set plus all `docs/migrate-to-*.md` and `docs/migration.md` (era records, as plan 175 Task 3 already treated them), tests (`__tests__/`, `*.test.*`: they pin absence, and typecheck catches live imports), the frozen `scripts/phase<N>-*` evidence (immutable per `run-all-tests.mjs`), and binaries.
      - Markdown sections headed Removed / Retired / Migration / Upgrading / a 0.x line.
      - A Markdown sentence that states the removal ("removed", "replaced", "the 0.12 …").
      - JSON `$comment` / `reason` / `note` history lines.
    - **Tests.** `scripts/retired-names.test.mjs` (new, added to `GATE_FILES` in `scripts/run-all-tests.mjs`): 6 pass.
      - `no_retired_name_in_live_tree`: zero hits, about 150 ms on 2,066 files, under the 5 s bound. It failed with 155, then 181, hits before the fixes below.
      - `retired_names_cover_baseline_removals`: list ⊇ a fresh generation. It is skipped when `v0.12.1` does not resolve: PR CI checks out without tags, and `release.yml` uses `fetch-depth: 0`.
      - `retired_names_are_not_live`.
      - `sweep_flags_each_kind_of_retired_name`: one planted hit per matcher kind.
      - `sweep_skips_removal_statements_history_and_tests`.
      - `removal_sections_end_at_the_next_heading_of_the_same_level`.
    - **Hits fixed (live tree).**
      - Retired to `docs/history/`: `docs/node-filesystem-config.md` → `history/node-filesystem-config-0.12.md` (`@arnilo/prism/node/config` is gone) and `docs/run-bundle.md` → `history/run-bundle-0.12.md` (`snapshotRunBundle` is gone). Both are listed in `docs/history/README.md` and unlinked from `docs/index.md`; `docs.test.ts` `apiPages` drops the first, and the `migrate-to-0.8.md` link is repointed.
      - Rewritten lines in `settings-auth-trust-security.md` (`SettingsProvider` is host-implemented; `createPathTrustPolicy` is a root export), `host-security.md` (`storeConformance()`, `session.resume`, `serveMcp`; the docs.test pin `assertSessionStoreConforms()` became `storeConformance()`), `resource-loading.md` (no `loadManifestResource`; the manifest is `@arnilo/prism/manifest`), `coding-security.md` (host `ExecutionPolicy` from `@arnilo/prism-tools-coding`, `humanGate`, `startWorkflow`), `credentials-and-redaction.md` (Codex `openAICodexAuth`; xAI removed), `operations.md` (coordinator, operator and saga section removed), `disaster-recovery.md` (the drill's 0.2-era stores named as removed), and `performance.md` (0.13 example, the `provider-kit` `BoundedStreamLimits`).
      - READMEs: `memory-core` (`createMemoryVectorStore`), `mcp` (`serveMcp`), `approval` (no Prism Code), `store-sqlite` (example imports), `tools-work/golden`.
      - Source comments: `src/artifacts/artifacts.ts`, `src/testing/state-concurrency-conformance.ts`, `governance/src/field-policy.ts`, `mcp/src/auth.ts`.
      - `scripts/budgets.json` `exportCounts` lost its six retired-package rows (acp-agent, memory, work, coding-tools, core, web-tools).
      - The host-builder index was regenerated: `api.json`, plus concurrent memory-system surface and `examples/memory-system.ts`.
      - `CHANGELOG.md` `[Unreleased]` has the entry.
    - **Post-train references** (resolves plan 174 Task 1 (j)).
      - `create-plan/references/prism.md`: §1 already had no `apps/prism-code` row. §5 "Tooling assumptions the train must change" became "Standing gates a change must update", and the §3 retirement probe and the `create-plan/SKILL.md` rule now point at the standing sweep.
      - `prism-wiki.md` already read "Where docs go" (`create-plan/SKILL.md`'s pointer to it was updated).
      - `prism-execution/SKILL.md` invariant and `references/release.md` (publish step = this plan's Task 39; "Retired error or name"; a new "Version lines" bullet describing the experimental line and independent versioning after Task 39) are updated.
      - `PRODUCT.md` has no train reference.
      - The roadmap "Shipped baseline" stays 0.12.1, the published state, and moves to Task 39 (criterion amended above, Task 39 amended).
    - **Checks.** `bun run typecheck` clean. `docs.test.ts` 68/68. `retired-names`, `retired-providers` and `run-all-tests` tests pass. `host-builder-index --check` fresh. Biome is clean on the touched code. No export moved, so there is no baseline diff.
    - **Failures from other work, not this task.**
      - `phase24-truth`: package count 51 vs 52, and the peer policy now lists `prism-evals` → `prism-observability`.
      - `truth-current`: Phase 54 evidence is stale because the package count changed.
      - `budget-gate`: kernel bytes +5/+13 since the last rebaseline; `@arnilo/prism` exports +75, `mcp` +2, `channels` +33 over their `exportCounts` ceilings.
    - **Findings for later tasks.**
      1. **Task 36:** the `budget-gate` non-null rows still list pre-consolidation paths (`packages/prism-core/src`, `packages/memory/src`, …) and miss about 30 live `biome.json` allowlist paths. `exportCounts` needs a rebaseline for `@arnilo/prism`, `mcp` and `channels`. Path rows are not names, so the sweep does not see them.
      2. **Task 36 (h):** `no_retired_name_in_live_tree` runs in `bun run test` through `GATE_FILES`.
      3. **Task 39:** flip the roadmap "Shipped baseline" line after publish. When moving packages into `independent-packages.json` `packages`, run `bun scripts/retired-names.mjs --generate` against the new baselines.

- [x] Task 36: Release pipeline, release gates and CI tests — review and cleanup (added 2026-11-04, owner)
  - Acceptance Criteria:
    - Input from Task 1 (b), 2026-11-05: `release.yml:6,148,205,265` each enumerate release tags up to `v0.12.1`, and a `v0.13.0` ref skips `codeql-release` and `publish`. Replace the enumerations with one pattern or one computed output, and lock it with a case that a `v0.13.0` ref selects the intended jobs (amended on execution: the check is `release_publish_path_for_v0_13_0` in `scripts/workflow-liveness.test.mjs`).
    - Functional: **Inventory**, recorded in the task note.
      - **Workflows.** For each of the ten workflows in `.github/workflows/` (1,117 lines on 2026-11-04), record:
        - triggers;
        - jobs and what each one runs;
        - permissions and secrets;
        - environments;
        - action pins;
        - median wall time over the last ten runs (`gh run list`).
      - **Release gate and its chain.** Record each step of `release:gate`: the eight `package.json` steps, then the stages of `scripts/release.mjs gate` / `scripts/release-gates.mjs`. Do the same for the `sdk:ready` chain.
      - **Script tests.** Record which of the 90 `scripts/*.test.mjs` files and 98 `scripts/phase*` files are reached by `bun run test` (`scripts/run-all-tests.mjs`), `release:gate`, or a workflow, and which nothing reaches.
    - Functional: **Classify** every item as `keep`, `fix`, `merge` or `remove`, with a reason. Known findings to confirm:
      - (a) `canary-providers.yml:31` defaults its matrix to `["openai"]`, a provider package plan 182 deleted. The default must name shipped providers, or the job must read the gating T1 set.
      - (b) The `release.yml` publish step (`:266`) puts lockstep tags in a branch that ends at `v0.12.1`, so a `v0.13.0` tag takes the independent path (Task 1 (b)). Decide the path, and add a test that pins it (`release-gate.test.mjs`).
      - (c) CodeQL and supply-chain jobs exist in both `security.yml` and `release.yml`, and Postgres integration exists in both `integration-postgres.yml` and `release.yml`. Merge them into one reusable job, or record why both are needed.
      - (d) `coding-journey.yml` is still titled "0.2.6, plan 026", and the historical tag list in `release.yml:6` and `:266` still names versions back to `v0.3.0`.
      - (e) Two `actions/checkout` pins are in use (v7.0.1 ×18, v5 ×1). Pick one.
      - (f) The `live-matrix.yml` `memory-bench` job serves the experimental line. Keep it manual-only, and record it as memory-track tooling.
      - (g) `NPM_TOKEN` is used in `release.yml:263` and `npm-deprecate.yml:49`. Task 38 removes both; this task only records them.
      - (h) Gates this plan adds must run in `bun run test` or `release:gate`. Assert each one:
        - `stable_packages_never_depend_on_experimental`
        - `package_skills_conform`
        - `host_builder_kit_matches_surface`
        - the prefix-stability conformance tests
        - `no_retired_name_in_live_tree`
        - `experimental_packages_carry_notice`
      - (i) Pull-request CI: the `verify` job must run the same `sdk:ready` steps as the release gate, minus live and Postgres. Record any divergence.
    - Functional: **Cleanup**, applied in this task.
      - Fix every `fix` item.
      - Merge every `merge` item.
      - Delete every `remove` item: an orphaned or era-only script or test, together with its fixtures. Run a repo-wide sweep for each removed file name and npm script over `src/ packages/ apps/ scripts/ examples/ docs/ .github/`, excluding `docs/history/`, `docs/_evidence/` and `plans/`.
      - Era evidence a test still reads (for example `scripts/phase12-freeze-manifest.json`) is kept only if a live test reads it.
    - Functional: New CI-integrity checks, run in `bun run test` (amended on execution: they live in `scripts/workflow-liveness.test.mjs`, which already held two of the six — see the note), check:
      - `ci_workflows_reference_existing_files`: every script path or `bun run <name>` in a workflow `run:` exists;
      - `ci_workflow_filters_name_workspaces`: every `--filter` names an existing workspace;
      - `ci_actions_pinned_by_sha`: every `uses:` is pinned by commit SHA, with a version comment;
      - `ci_jobs_declare_permissions`: every job declares `permissions` or inherits a read-only top-level block;
      - `ci_checkout_does_not_persist_credentials`;
      - `release_gate_runs_plan_gates`: the gates in (h).
    - Functional: `docs/release.md` "What the gate runs" matches `package.json` and `release-gates.mjs` exactly. A docs test compares them.
    - Performance: Record pull-request CI wall time and `release:gate` time before and after. Neither may increase, and the note reports the saving from merged jobs and removed tests.
    - Code Quality:
      - Removals are whole: no skipped tests, no commented-out jobs.
      - A merged job is a reusable workflow (`workflow_call`) or one job, never two copies.
    - Security:
      - Least privilege per job, with `contents: read` by default.
      - No secret reaches a `pull_request`-triggered job.
      - Live and publish jobs run in protected GitHub environments.
      - Every action is pinned by SHA.
      - The review never weakens a release gate to make it pass. A failing gate is fixed at its cause, or its owner task is reopened.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/*.yml`; `package.json` scripts (`release:gate`, `sdk:ready`, `test`); `scripts/run-all-tests.mjs`; `scripts/release-gates.mjs`; `docs/release.md`
      - GitHub Actions docs on `permissions`, environments and reusable workflows, via find-docs (record sources and dates)
    - Options Considered:
      - **Review only, and fix later.** Rejected: the owner wants the cleanup done before 0.13.0, and an unfixed finding would ship in the release pipeline.
      - **Rewrite the CI from scratch.** Rejected: the gates encode years of release lessons (plans 080, 083, 142, 164). Cleanup keeps what is still reached and correct.
    - Chosen Approach:
      - An evidence-based inventory, a per-item verdict, then removal or repair, locked in by a CI integrity test.
    - API Notes and Examples:
      ```bash
      timeout 60 gh run list --workflow release.yml --limit 10 --json conclusion,createdAt,updatedAt
      timeout 120 bun test --timeout=0 scripts/workflow-liveness.test.mjs
      ```
    - Files to Create/Edit:
      - `.github/workflows/*.yml` (per verdict)
      - `scripts/workflow-liveness.test.mjs` (the CI-integrity checks; amended on execution from a new `scripts/ci-integrity.test.mjs`); `scripts/run-all-tests.mjs` (if wiring changes); removed `scripts/phase*` and `scripts/*.test.mjs` files (per verdict)
      - `package.json` (`release:gate`, `sdk:ready`, per verdict), `scripts/release-gates.mjs`, `scripts/release-gate.test.mjs`
      - `docs/release.md`, `src/__tests__/docs.test.ts` (gate-list comparison), `CHANGELOG.md`
    - References:
      - Task 1 (b); Tasks 2, 3, 7, 15, 22, 35 (gates added by this plan)
  - Test Cases to Write:
    - `ci_workflows_reference_existing_files`: fails on a fixture workflow that names a deleted script.
    - `ci_workflow_filters_name_workspaces`, `ci_actions_pinned_by_sha`, `ci_jobs_declare_permissions`, `ci_checkout_does_not_persist_credentials`.
    - `release_gate_runs_plan_gates`.
    - `release_publish_path_for_v0_13_0` (finding (b)).
    - `docs_release_gate_list_matches_scripts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — CI and release tooling.
    - Docs pages to create/edit: `docs/release.md` ("What the gate runs", CI overview); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08):
    - **What changed.**
      - **`release.yml`: no workflow names a version any more** (finding (b), and the Task 1 input). `on.push.tags` is `["v*", "@arnilo/*@*"]`; `publish` and the security job gate on `startsWith(github.ref, 'refs/tags/')`; the publish step branches on the `v` prefix (`"${GITHUB_REF_NAME#v}" != "$GITHUB_REF_NAME"`) instead of an 18-version `||` chain. A `v0.13.0` tag therefore runs `verify`, `postgres-integration`, `security-release`, `office-validation` and `publish` on the lockstep path — before this, the trigger had `v0.13.0` added by hand while all three `if:` chains stopped at `v0.12.1`, so the tag ran `verify` and published nothing. `publish` now also runs in an `npm-publish` environment (see Security).
      - **One body per duplicated gate** (finding (c)). `postgres-integration` and `security-release` are now `uses: ./.github/workflows/{integration-postgres,security}.yml`; both called files gained `workflow_call` and `release.yml` lost their copies (the Postgres job body, `codeql-release`, `supply-chain` — 66 lines). `publish.needs` is `[verify, postgres-integration, office-validation, security-release]`. `security.yml`'s `supply-chain` job declares `permissions: contents: read` explicitly, so the caller's `security-events: write` grant (needed by `codeql`) does not widen it.
      - **Merged Postgres bodies, not just moved.** `integration-postgres.yml` now runs the union that release used to run separately: pgvector `pg16` (the durable memory legs need the extension), `bun run build`, `bun run test:postgres` (store + channels + phase 7/22 conformance, and the evidence `release:gate` reads), then the migration drill. The old push-only body ran `--filter @arnilo/prism-store-postgres test:postgres` and `build:core`, which is a subset of the same list.
      - **`canary-providers.yml` matrix default** (finding (a)): `["openai"]` → the nine gating T1 provider packages. `packages/providers/openai` was deleted by plan 182, so every scheduled run died on a `packages/providers/openai/src/__tests__/live.test.ts` that does not exist (4 of the last 10 runs).
      - **Finding (d):** `coding-journey.yml`'s job is `protected real coding-agent journey` (the `0.2.6` era text is gone), and the historical tag lists in `release.yml:6` and `:266` are gone with the pattern. The release-evidence row name `protected coding journey (0.2.6, plan 026)` in `scripts/release-skip-manifest.mjs` and `scripts/blocked-gate.mjs` is unchanged on purpose: it keys the evidence surfaces, not the job title.
      - **Finding (e):** `sandbox-browser.yml` moved its `actions/checkout` from v5 to the v7.0.1 SHA every other workflow uses. All 20 checkout steps are now one pin.
      - **Finding (f), recorded:** `live-matrix.yml`'s `memory-bench` job stays `workflow_dispatch`-only with an explicit `inputs.filter == 'release/memory-bench'` guard; it installs Python deps and runs `scripts/memory-bench/live.mjs`, whose outputs are the memory track's evidence (`docs/_evidence/memory-bench/**`). It is memory-track tooling, not a 0.13.0 gate.
      - **Finding (g), recorded for Task 38:** `NPM_TOKEN` is read in exactly two places, `release.yml`'s publish step (`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, one occurrence) and `npm-deprecate.yml`'s apply step. Both are tag/dispatch-only jobs; neither is `pull_request`-triggered. `gh secret list` shows `NPM_TOKEN` as a repository secret, not an environment secret.
      - **Finding (i):** the `verify` job runs every `sdk:ready` step in order plus one extra, `security:threat-suites` (which `sdk:ready` does not chain). That divergence is now asserted and documented instead of implicit.
      - **The CI-integrity checks went into `scripts/workflow-liveness.test.mjs`, not a new `scripts/ci-integrity.test.mjs`.** Two of the six the plan named already live there (`ci_workflows_reference_existing_files` = "every scripts/*.mjs a workflow names exists", `ci_actions_pinned_by_sha` = "every workflow action is pinned") and a second file would need the same helpers and would register the shared tests twice. Renamed to the plan's names and extended:
        - `ci_workflow_filters_name_workspaces` (unchanged body), `ci_workflows_reference_existing_files`, `ci_actions_pinned_by_sha` (now also requires a `# vX.Y.Z` comment beside every external pin; a local `uses: ./.github/workflows/…` needs none);
        - new `ci_jobs_declare_permissions` (every job declares `permissions:` or inherits a read-only top-level block), `ci_checkout_does_not_persist_credentials` (all 20 checkouts already passed), `release_publish_path_for_v0_13_0` (no version literal in `release.yml`; `publish` and `security-release` evaluate true for `refs/tags/v0.13.0`, `v0.14.2` and `@arnilo/prism-wiki@0.13.0-experimental.1`, false for a branch and a PR ref; the condition evaluator throws on any shape other than `startsWith(github.ref, '…')`, so an enumerated list cannot come back unnoticed), `release_gate_runs_plan_gates` (the six gates this plan adds resolve to a home in `bun run test` or `release:gate`), `canary_provider_matrix_names_shipped_providers` (the fix for (a) cannot regress), `ci_verify_runs_sdk_ready_steps` (`sdk:ready` ⊆ the verify phases; extras must be on a recorded allowlist).
      - **Docs.** `docs/release.md`: "What the gate runs" is a numbered list of the ten `release:gate` steps, and a new "CI workflows" section is one row per workflow (triggers, what it runs) plus the reusable-job relation, the tag-pattern rule, the `npm-publish` environment note and the CI-integrity pointer. `src/__tests__/docs.test.ts` gains `docs_release_gate_list_matches_scripts`: every `&&` step of `package.json`'s `release:gate` must be named in that section (by script, package, example or npm script), and the four `scripts/release.mjs gate` stages (version-range, compat-baseline, deny list, size budget) must be named; a step the docs omit is reported (positive control). `CHANGELOG.md` has the entry.
      - **Removed** (each with a repo-wide sweep over `src/ packages/ apps/ scripts/ examples/ docs/ .github/`, excluding `docs/history/`, `docs/_evidence/` and `plans/`; zero hits):
        - `scripts/package-truth.test.mjs` — already failing on the plan 216 rename (`packages/memory/observational must be a workspace`), and its subject stays covered by `scripts/phase24-truth.test.mjs` ("committed artifact equals generator output") and `scripts/truth-current.test.mjs`.
        - `scripts/phase40-release-dry-run.mjs` — plan 040, `@arnilo/prism-dev` 0.0.1, and it drives `npm publish --dry-run`; npm is retired (plan 175 Task 8).
        - `scripts/work-sandbox-image.test.mjs` — resolved `packages/prism-work`, deleted; `describe.skipIf(PRISM_TEST_WORK_SANDBOX)` meant it never ran anyway.
      - **Wired** (were green but nothing reached them; now in `GATE_FILES`): `scripts/wire-proxy.test.mjs`, `scripts/provider-login.test.mjs`, `scripts/document-ingestion-packed.test.mjs`. The last one shelled out to `npm pack -w @arnilo/prism-tools-work`; it now runs `bun pm pack --quiet --destination` in `packages/tools/work`, so no test invokes npm.
      - **Kept, with the reason recorded:** the `phase<N>-(freeze|release).test.mjs` set (`truth-current.test.mjs` requires those files to exist as immutable release evidence and forbids them in `bun run test`), the blocked-gate legs `phase26-pty-protected` and `phase26-recovery-conformance` (registered in `scripts/blocked-gate.mjs`, from which `release-skip-manifest` derives its manual rows), and the credentialed live legs `e2e-cli-live` and `usage-calibration-live` (skip with a reason without `PRISM_LIVE_PROVIDER_TESTS` plus a vendor key).
      - **Two red gates fixed at their cause.**
        - `scripts/drill-migration-rollback.mjs` hard-coded "9 applied migrations" and inverted `010_session_links` while the store ships 11 steps, so `integration-postgres.yml` failed on **every** push for weeks ("expected 9 applied migrations, got 11") — and the merged release job would have inherited the failure. The step count now comes from `createPersistenceMigrationContract()`, the drill inverts the newest step (`011_evaluations`' two tables), and it fails closed with a named message when a new migration lands without retargeting it. Verified end-to-end against a local `pgvector/pgvector:pg16` on port 55432: `ok: true`, `apply-all → seed → downgrade-last → verify-compat → re-apply → checksum-fail-closed`, and the SQLite leg likewise.
        - `bun audit --audit-level=moderate` failed `security.yml`'s supply-chain job with 9 advisories. Fixed the six MCP SDK ones (`@modelcontextprotocol/{client,server}` `2.0.0` → `^2.3.0` in `packages/integrations/mcp`, `packages/hosts/mcp-server`, `packages/hosts/host-builder`; their suites pass 101/53/78 and all three typecheck), the zod one (workspace `^4.6.2` → `4.6.7`) and `fast-uri` (`3.1.9`). **One high advisory remains and is not fixable in range:** `@ag-ui/{client,core}@0.0.59` pin `zod ^3.22.4`, and the advisory (`GHSA-mrhx-c7xc-m3w5`) is fixed only in zod ≥ 4.6.6. `@ag-ui/core@1.0.4` moves zod to a peer (`^3.25.18 || ^4.0.0`), but the 1.x API drops `EventSchemas`, `AgentCapabilitiesSchema` and `RunAgentInputSchema` and changes the message content types, which fails `@arnilo/prism-ag-ui`'s typecheck in 8 places. Porting the adapter is a separate task (see Findings).
      - **`scripts/budgets.json`**: kernel `packedBytes` 1252136 → 1254428 and `unpackedBytes` 4062540 → 4069240, with the attribution in both `$comment`s. This task's share is shipped text (the `docs/release.md` rewrite and the CHANGELOG entry); the rest is the package-inventory/version blocks that had drifted, regenerated here (see below). No kernel source, export, file-count or dependency change from this task.
      - `bun scripts/package-truth.mjs --emit-docs` was run: `truth-current`'s "Phase 54 evidence is stale" failure was committed-artifact drift from the plan 216 renames. The regenerated blocks are the only content change in `docs/operations.md`, `docs/performance.md`, `docs/resource-loading.md`, `docs/settings-auth-trust-security.md`, `docs/packages.md`, `docs/migrate-to-0.13.md` and `docs/peer-dependencies.md`.
    - **Inventory.**
      - **Workflows.** 10 files, 1,117 lines before and 1,089 after. Every one is `ubuntu-latest`, `permissions: contents: read` at the top, and `oven-sh/setup-bun` with `bun-version: "1.4.2"`; every checkout sets `persist-credentials: false`. Action pins in use (all 40-hex with a `# vX.Y.Z` comment): `actions/checkout` v7.0.1, `oven-sh/setup-bun` v2.2.0, `actions/upload-artifact` v6, `actions/attest-build-provenance` v4.1.1, `actions/cache` v4.3.0, `actions/dependency-review-action` v5.0.0, `github/codeql-action/{init,analyze}` v4.37.6. `dependabot.yml` bumps the actions weekly.
        | workflow | triggers | jobs | environment | secrets | median wall time (last 10, `gh run list`) |
        | --- | --- | --- | --- | --- | --- |
        | `release.yml` | push main, any tag, PR, dispatch | `verify`, `postgres-integration` (call), `security-release` (call), `office-validation`, `publish` | `npm-publish` (publish) | `NPM_TOKEN` | 502 s (PR runs; the two short runs are 55 s and 64 s) |
        | `security.yml` | push main, PR, weekly Mon, dispatch, call | `dependency-review` (PR only), `codeql`, `supply-chain` | — | — | 172 s (29–33 s when only `dependency-review` applies) |
        | `integration-postgres.yml` | push main, dispatch, call | `postgres` | — | — | 32 s |
        | `integration-office.yml` | push main, dispatch | `office` | — | — | 18 s |
        | `sandbox-browser.yml` | push main, weekly Wed, dispatch | `protected-matrix` | `sandbox-browser` | — | 19 s |
        | `canary-providers.yml` | nightly, dispatch | `smoke` (provider matrix), `report` | `live-canaries` | 9 provider keys | 19 s |
        | `live-canaries.yml` | weekly Tue, dispatch | `canaries` | `live-canaries` | 7 (`PRISM_CANARY_*`, Brave) | 12 s |
        | `live-matrix.yml` | weekly Thu, dispatch | `matrix`, `context-rot`, `memory-bench` | `live-canaries` | `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HYPER_API_KEY`, `OPENCODE_GO_API_KEY` | 22 s |
        | `coding-journey.yml` | weekly Thu, dispatch | `protected-coding-journey` | `coding-journey` | `HYPER_API_KEY`, `PRISM_CODING_PROVIDER_API_KEY`, `PRISM_CODING_FORGE_TOKEN` | 50 s |
        | `npm-deprecate.yml` | dispatch | `deprecate` | — | `NPM_TOKEN` | 16 s (n=2) |
      - **`release:gate` chain** (`package.json`, verified equal to the docs by the new test): `release-skip-manifest.mjs` → `host-builder-index.mjs --check` → `check-client-neutrality.mjs` → `@arnilo/prism-agent test` → `@arnilo/prism-driver-process test` → `examples/adapters/conformance.ts` → `bun test` of `driver-kit-vendor-neutral`/`kernel-constraints`/`host-builder-kit` → `package-skills-conformance.mjs` → `install-idempotence.test.mjs` → `scripts/release.mjs gate` (version-range drift → per-entry compat surface vs `scripts/compat-baseline/` → tarball deny list + kernel pack → kernel size budget). **`sdk:ready` chain:** `typecheck` → `lint` → `format:check` → `test` → `test:coverage` → `pack:dry-run` → `release:gate`.
      - **Script tests.** 153 test files under `scripts/` (92 top-level `*.test.mjs`, 61 in subdirectories) and 97 `scripts/phase*` files. 62 are in `GATE_FILES` and therefore in `bun run test`; 4 more are named directly by `release:gate`/a workflow; the rest reached nothing. That last group was 19 test files before this task, now 14, all classified above (removed, wired, or kept as release evidence / blocked-gate legs / credentialed live legs).
    - **Classification.** (a) `fix` — done. (b) `fix` — done, pinned. (c) `merge` — done for CodeQL, supply-chain and Postgres. (d) `fix` — done. (e) `fix` — done. (f) `keep` — recorded as memory-track tooling. (g) `keep` — Task 38 owns the OIDC switch. (h) `keep` — asserted by `release_gate_runs_plan_gates`; all six already ran in `bun run test` (the `src/__tests__` set) or `release:gate`, so no gate needed moving. (i) `keep` — asserted by `ci_verify_runs_sdk_ready_steps`. Per-workflow: `release` fix, `security` merge, `integration-postgres` merge, `canary-providers` fix, `coding-journey` fix, `sandbox-browser` fix, `integration-office` keep (hermetic packed office suite), `live-canaries` keep (credentialed), `live-matrix` keep (credentialed, manual rows), `npm-deprecate` keep (dispatch-only, one-way, Task 38 owns the token).
    - **Checks run.** `bun test scripts/workflow-liveness.test.mjs` 15/15. `bun test src/__tests__/docs.test.ts` 69/69 at the end of the task (68/69 earlier: `examples_demos_run_to_completion_and_emit_no_secret` failed while the concurrent memory session's examples still used the retired fabric API — see below), and the four files together 111/111. `bun test scripts/run-all-tests.test.mjs scripts/truth-current.test.mjs` 26/27 then 10/10 after the doc regeneration. `bun test scripts/release-gate.test.mjs scripts/tooling-gate.test.mjs scripts/import-hygiene.test.mjs` 47/51 (the 4 failures are in-flight work, below). `bun scripts/release.mjs gate` exits 0: `{"packages": 51}`, the only reported diffs being the two experimental packages' not-gated changes. `bunx tsc --noEmit -p tsconfig.json` clean; biome clean on every file this task touched; all ten workflow YAML files parse and their job graphs check out (`release.yml` reuse: `postgres-integration` unconditional, `security-release` tag-gated). `bun scripts/drill-migration-rollback.mjs --url …` and `--self-test` pass. `PRISM_TEST_POSTGRES_URL=… bun run test:postgres` 57/57 (writes `scripts/postgres-evidence.json`). `release:gate` was **not** runnable end-to-end on this tree (`host-builder-index --check` reports stale generated files from the in-flight memory work, below).
    - **Performance.** `bun scripts/release.mjs gate` measured 23.7 s and 56.6 s on two runs on this machine (Task 2 recorded 14.1–14.8 s on a different tree state). The chain steps and the gate's inputs are unchanged by this task — the new docs test asserts the chain, and the only gate-input file touched is `scripts/budgets.json` (two ceilings) — so the delta is the tree (declaration emit for 51 packages, which the in-flight kernel work grew) and host load, not this task. `release:gate`'s own step list is byte-identical (no step added, removed or reordered), so its run time is a function of the tree. Pull-request CI wall time before: `release.yml` median 502 s, of which `verify` dominates; after, the `verify` steps are unchanged, `security-release` replaces two parallel jobs with the same two (so the pipeline's critical path is unchanged) and `postgres-integration` grows from the store-only leg to the union (≈ +1 min on a job that runs in parallel with a 500 s `verify`). The saving from the merge is 66 duplicated lines and 3 duplicated job bodies, not wall time. The post-change CI measurement needs a pushed branch; the "after" numbers belong to the first run of that branch.
    - **Security.** Every job keeps `contents: read` by default and `ci_jobs_declare_permissions` now enforces it; `codeql`/`dependency-review` declare their narrow writes; `supply-chain` narrows itself back to `contents: read` under the release caller's `security-events: write` grant. No secret reaches a `pull_request`-triggered job: the only secret-reading jobs are `publish` (tag-gated), `npm-deprecate` (dispatch), and the four live workflows (schedule/dispatch, all in named environments). Live and coding-journey jobs already ran in protected environments; `publish` now names `npm-publish`, which GitHub creates with no rules — **the owner must add required reviewers there** for that criterion to mean anything. All 20 action references are SHA-pinned with a version comment. No gate was weakened to pass: the tag-gated jobs now run for *more* refs, the audit gate was fixed by dependency updates and left failing on the one advisory that needs a real port, and the budget ceilings were raised only after attributing every byte.
    - **Failures from other work, not this task.** This working tree is shared with a concurrent memory-track session, so the set below moved while the task ran (`examples/working-semantic-memory.ts` was deleted and renamed `semantic-memory.ts` mid-task, which made `examples/` and `examples_demos_run_to_completion_and_emit_no_secret` pass). Recorded as observed; each owner plan fixes its own:
      - `@arnilo/prism-memory-system` typecheck: `src/ltm/lifecycle/__tests__/merge.test.ts` uses `episodes` on `ResolvedMergeConfig`.
      - `examples/` typecheck: `memory-lifecycle.ts` (`episodesMerged`) and `working-semantic-memory.ts` (`workingMemoryTemplate`, `updateWorking`, `createWorkingMemoryProcessor`, `getWorking`, `includeWorking`) still use the retired fabric API. This is also the `examples_demos_run_to_completion_and_emit_no_secret` failure.
      - `scripts/import-hygiene.test.mjs` "no live node:test imports": 6 files, including `src/testing/provider-live-scenarios.ts` and two `scripts/memory-bench/*.test.mjs`.
      - `scripts/tooling-gate.test.mjs` "release tooling is Bun-only": one false positive, the string `npm test", is retired (plan 125 Task 5)` inside `scripts/memory-bench/work-outcome/personas.mjs`; and "no Bun.hash on a security path".
      - `scripts/release-gate.test.mjs` `reference_host_suite_has_no_skips` (the reference host's skip ledger).
      - `bun run lint`: 40+ biome findings across `apps/prism-agent`, `packages/context/files`, `packages/hosts/evals` and an evidence script.
      - `bun scripts/host-builder-index.mjs --check`: stale generated files (`api.json`, `examples/long-term-memory.ts`, `examples/memory-lifecycle.ts`, then `examples.json` with `missing examples/semantic-memory.ts` / `extra examples/working-semantic-memory.ts` after the concurrent rename) — the generator copies `examples/**` into the published kit, so regenerating it here would publish another session's in-flight example under this task's name. `bun scripts/host-builder-index.mjs` is the one command; the memory track runs it with its rename.
    - **Decision on `bun run test` being green** (asked by Task 2's note): yes — `bun run test`, `sdk:ready` and `release:gate` are expected to be green on the release commit, and neither this task nor its gates may be relaxed to make them so. Today's red set is entirely the in-flight memory work above plus one dependency advisory; Task 39's pre-flight (`bun run sdk:ready` exits 0, `release:gate` exits 0) will not pass until those land. The CI pipeline's own red set was 7 of 10 workflows failing every run; this task fixes the two that were pipeline bugs (`release`'s tag enumeration, `canary-providers`' retired provider) and the one that was a stale constant in the drill (`integration-postgres`), and records the remaining four as credential-gated by design (`coding-journey`, `live-canaries`, `live-matrix`), operator-variable-gated (`sandbox-browser`: `PRISM_TEST_DOCKER_IMAGE`/`_USER` and the capability evidence it asserts are repository variables the owner has not set, which makes the job fail closed on every scheduled run), and the audit advisory.
    - **Findings for later tasks.**
      1. **Task 38:** `publish` now expects an `npm-publish` environment; create it with required reviewers, or the protection is nominal. `NPM_TOKEN` is still a repository secret read by two jobs (`release.yml` publish, `npm-deprecate.yml` apply).
      2. **Task 39:** the `v0.13.0` publish path is the lockstep branch (`v*`), pinned by `release_publish_path_for_v0_13_0`; the security job that must gate it is now called `security-release` (it ran as `codeql-release` + `supply-chain`), so the dry-run evidence names the new id. `bun audit` still fails on `@ag-ui`'s zod 3 pin, which blocks `publish` through `security-release` until the adapter is ported.
      3. **New task (owner):** port `@arnilo/prism-ag-ui` to `@ag-ui/{core,client}` 1.x (zod as a peer, `EventSchemas`/`AgentCapabilitiesSchema`/`RunAgentInputSchema` gone, message content types changed; 8 typecheck sites). Until then `bun audit --audit-level=moderate` cannot pass and the release pipeline's supply-chain gate stays red.
      4. **Memory track (plans 216–223):** the memory package's own `test:postgres` legs are not in `test:postgres:run` (it runs store, channels and the phase 7/22 conformance), so the pgvector image in `integration-postgres.yml` is provisioned but the memory legs still do not run in CI. Whoever owns the durable memory surface should add them or record why not.
      5. `bun-version` is pinned to `1.4.2` in all ten workflows while the documented and installed toolchain is 1.4.4 (`docs/release.md`, `bun --version`). One pin, one bump, when the owner wants it.

- [x] Task 37: Registry cleanup — delete the deprecated `@arnilo` packages (owner-run, irreversible; added 2026-11-04, owner)
  - Acceptance Criteria:
    - Functional: **Inventory.**
      - `scripts/registry-cleanup.mjs --inventory` makes anonymous registry GETs and writes `docs/_evidence/registry/arnilo-scope-<date>.json`.
      - For every `@arnilo` package it records:
        - the versions;
        - the deprecated-version count;
        - dist-tags;
        - maintainers;
        - last-week downloads (`api.npmjs.org/downloads/point/last-week/<name>`);
        - which other `@arnilo` packages depend on it, from their published manifests.
      - The name list is the union of three sources:
        - `scripts/deprecations-0.13.json`;
        - registry search;
        - a scope listing (`npm access list packages @arnilo --json`). Registry search hides fully deprecated packages (npm docs, "Unpublish policy", read 2026-11-04), so search alone is incomplete. Amended on execution: the endpoint behind that command, `GET /-/org/arnilo/package`, answers anonymously and lists all 68 names including the deprecated ones, so the tool reads it directly and the owner supplies nothing; search returns `total: 0` for this scope.
    - Functional: **Classification**, starting from the 2026-11-04 anonymous inventory:
      - (a) **Fully deprecated, delete.** 20 names have every version deprecated: `@arnilo/prism-all`, `-evals`, `-workflows`, `-model-router`, and the 16 `@arnilo/prism-provider-{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}`. `@arnilo/prism-code` has 42 of 44 versions deprecated, so its last two are deprecated or deleted with it.
      - (b) **On the 0.13 deprecation list but not deprecated yet.**
        - Whole-package names: `@arnilo/prism-agent-sdk`, `-acp-agent`, `-providers`, `-coding-tools`, `-web-tools`, `-memory`, `-core`, `-work`, `-hooks`. Default: delete.
        - Reused names: `@arnilo/prism-mcp`, `-ag-ui`, `-channels`. Their `<0.13.0` line is deleted.
        - The owner confirms each name.
      - (c) **On no list.** `@arnilo/prism-antigravity-agent` (0.4.0), `@arnilo/prism-office` (0.7.0), and `@arnilo/liveframe` (0.2.3; not a Prism package). Default: keep. The owner decides each one. Amended on execution: the live scope has 31 such names, not three — 26 of them are the 0.3-era set already deprecated in September (`prism-base`, `prism-sdk`, `prism-server`, `prism-session-store-*`, `prism-compaction*`, `prism-policy`, and the rest), so `--plan --include-unlisted` puts them in one reviewable file for that decision, deletes a shipped name's fully deprecated old line rather than the name, and is what unblocks three of the six policy refusals.
      - (d) `@arnilo/prism` and every name 0.13.0 publishes keep their entries. For a reused name, only versions `<0.13.0` are touched.
    - Functional: **Policy and order.**
      - **Unpublish policy** (https://docs.npmjs.com/policies/unpublish/, read 2026-11-04): after 72 hours a package can be unpublished only when no registry package depends on it, it had fewer than 300 downloads last week, and it has a single maintainer. A name that fails any condition is deprecated instead.
      - **Delete in dependency order:** dependents first (for example `prism-all` before what it depends on), from the inventory's in-scope graph.
      - **Reused names** (`prism-provider-openrouter`, `prism-evals`, `prism-workflows`, `prism-model-router`, `prism-mcp`, `prism-ag-ui`, `prism-channels`):
        - unpublishing every version blocks the name for 24 hours, so this task completes at least 24 hours before Task 39's tag push;
        - removed version numbers can never be reused, which does not conflict, because 0.13.0 was never published under these names.
    - Functional: **Execution (owner).**
      - The script's `--plan` prints the ordered commands (`npm unpublish <name> --force`, or `npm unpublish <name>@<version>` for a reused name's old line, or `npm deprecate …` for an ineligible name). It never runs npm and never reads credentials.
      - **The executor stops and asks the owner to confirm the printed list.** The owner then runs it locally, signed in with 2FA (npm prompts for the one-time password).
      - The executor never handles a credential or an OTP.
    - Functional: **After execution.**
      - `--inventory` is re-run. The evidence file records each name's final state (`404`, `deprecated`, `kept`) and every policy refusal with its reason.
      - `scripts/deprecations-0.13.json` shrinks to the names still needing a deprecation, and `scripts/registry-deprecate.test.mjs` / `retired-providers.test.mjs` counts follow it.
      - `docs/migrate-to-0.13.md` states which 0.12-era packages were removed from npm, since installs of their old versions now fail, and names each successor.
      - Task 39's deprecation step applies only what remains.
    - Performance: n/a — registry operations; the inventory makes one GET per name plus one downloads call per name.
    - Code Quality: `scripts/registry-cleanup.mjs` reuses `scripts/registry-deprecate.mjs`'s name list and registry reader. Its plan and classification are pure functions with offline tests and injected fetch.
    - Security:
      - Irreversible: an unpublished version never comes back.
      - Nothing runs without the owner's explicit confirmation of the exact list.
      - No token is created, stored or used in CI.
      - The inventory and evidence contain no credential (asserted with `assertNoSecretLeak`).
  - Approach:
    - Documentation Reviewed:
      - npm "Unpublish policy" and `npm-unpublish` (npm CLI v12 docs), via Context7 `/websites/npmjs`, read 2026-11-04
      - `scripts/deprecations-0.13.json` (33 entries), `scripts/registry-deprecate.mjs`, `.github/workflows/npm-deprecate.yml`
    - Options Considered:
      - **Deprecate everything (the old plan).** Rejected by the owner (2026-11-04): the scope should be clean for 0.13.0, and deprecation needs a long-lived token in CI, which Task 38 removes.
      - **Unpublish from CI.** Rejected: unpublish is not an OIDC trusted-publishing operation, it is irreversible, and it should carry the owner's 2FA.
    - Chosen Approach:
      - A generated, owner-confirmed, owner-executed plan, with before and after evidence.
    - API Notes and Examples:
      ```bash
      timeout 300 bun scripts/registry-cleanup.mjs --inventory
      timeout 60 bun scripts/registry-cleanup.mjs --plan > /tmp/arnilo-cleanup.sh   # owner reviews, then runs with 2FA
      timeout 60 bun scripts/registry-cleanup.mjs --plan --include-unlisted         # the owner's sweep option (see (c))
      ```
    - Files to Create/Edit:
      - `scripts/registry-cleanup.mjs`, `scripts/registry-cleanup.test.mjs` (new)
      - `scripts/deprecations-0.13.json`, `scripts/registry-deprecate.test.mjs`, `scripts/retired-providers.test.mjs` (tentative: if its counts move)
      - `docs/_evidence/registry/*` (new evidence), `docs/migrate-to-0.13.md`, `docs/release.md` ("Registry hygiene"), `CHANGELOG.md`
    - References:
      - plan 175 Task 8 (deprecation tooling), plan 182 Task 2 (deleted providers)
  - Test Cases to Write:
    - `cleanup_plan_orders_dependents_first`.
    - `cleanup_plan_deprecates_policy_ineligible_names`: 300 or more weekly downloads, more than one maintainer, or an external dependent.
    - `cleanup_plan_touches_only_old_line_of_reused_names`: no `0.13.x` version or kept name appears in the plan.
    - `cleanup_plan_never_invokes_npm`: the script has no spawn of npm.
    - `cleanup_evidence_contains_no_secret`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed npm packages.
    - Docs pages to create/edit: `docs/migrate-to-0.13.md` (removed packages and successors), `docs/release.md` ("Registry hygiene"), `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-08 and 2026-11-09; **the registry run is complete — see the Result note**):
    - **Tooling.** `scripts/registry-cleanup.mjs` is the plan generator; `scripts/registry-cleanup.test.mjs` (7 tests, in `GATE_FILES` so `bun run test` runs it) is its proof. It reads the registry anonymously and prints commands; it has no `child_process` import, no `NPM_TOKEN`, no `authorization` header — `cleanup_plan_never_invokes_npm` scans the source for all four. The classify, refuse, order and render steps are pure functions (`classifyName`, `policyRefusals`, `orderDependentsFirst`, `buildPlan`, `renderPlan`) over an injected `fetch`, so the suite is offline.
    - **The scope is 68 names, and the plan's third source did not need the owner.** `GET /-/org/arnilo/package` answers anonymously and lists every name in the scope, deprecated ones included; the owner-run `npm access list packages @arnilo --json` is the same endpoint. Registry search is indeed useless here — `/-/v1/search?text=scope:arnilo` returns `total: 0`, which is how the plan predicted it hides fully deprecated names. The name universe is the union of that listing, `scripts/deprecations-0.13.json` (33 names) and the names the tree ships (52: the root `@arnilo/prism` plus 51 workspace packages), and the inventory records all 68 with versions, deprecated-version count, dist-tags, maintainers, last-week downloads and in-scope dependents from the published manifests. `docs/_evidence/registry/arnilo-scope-2026-11-08.json` is that record.
    - **Classification, re-verified against the live registry (2026-11-08) — two of the plan's counts were low.**
      - **(a) confirmed.** The 20 fully deprecated names have every version deprecated: `prism-all` 45/45, `prism-evals` 41/41, `prism-workflows` 43/43, `prism-model-router` 34/34, and the sixteen `prism-provider-*` (`ai-sdk` 42, `alibaba` 33, `anthropic` 36, `azure` 34, `bedrock` 34, `clinepass` 3, `deepseek` 3, `google` 36, `kimi` 46, `neuralwatt` 45, `ollama` 33, `openai` 46, `openrouter` 46, `vertex` 34, `xai` 3, `zai` 46 — each fully). `prism-code` is 42/44, and its two undeprecated versions are exactly `0.4.0` and `0.4.1` (its latest), so deleting the name covers them.
      - **(b) confirmed, with the reused set understated.** The nine whole-package names are `agent-sdk` (1 version), `acp-agent` (22), `providers` (63), `coding-tools` (17), `web-tools` (56), `memory` (59), `core` (17), `work` (7), `hooks` (5); all are unpublished-or-retired but none is fully deprecated except by range, which is why the plan deletes the name rather than deprecating. **Ten published names are reused by 0.13.0, not seven:** beyond the list's `reused: true` seven, `@arnilo/prism` (64 versions, latest `0.12.1`, none deprecated), `@arnilo/prism-wiki` (3), `@arnilo/prism-rag` (43) and `@arnilo/prism-provider-opencode-go` (46) are shipped by the tree and still carry an old line. They keep their entries and their old versions are only removed under `--include-unlisted` (see below).
      - **(c) is 31 names off every list, not 3.** The 0.3-era set is still on the registry and already deprecated, with `migrate-to-0.4.md` messages dated 2026-09-01: `prism-base`, `prism-browser`, `prism-caveman`, `prism-coding-agent`, `prism-coding-security`, `prism-compaction`, `prism-compaction-llm`, `prism-compaction-observational-memory`, `prism-credentials-node`, `prism-document-reader`, `prism-enterprise-postgres`, `prism-graft`, `prism-impeccable`, `prism-obscura`, `prism-observability-opentelemetry`, `prism-openapi-tools`, `prism-policy`, `prism-ponytail`, `prism-sdk`, `prism-server`, `prism-session-store-{codecs,nats,postgres,sqlite}`, `prism-supervisor`, `prism-tool-validator-json-schema`, `prism-work-tools`, `prism-computer-use-linux` (26 fully deprecated, all dead), plus the plan's `antigravity-agent` (2 versions, undeprecated), `office` (10, undeprecated) and `liveframe` (16, `0.2.3`, 988 downloads/week — not a Prism package; the only name in the scope over npm's 300/week threshold).
      - **(d) confirmed.** `@arnilo/prism` and every name 0.13.0 publishes keep their entries; a reused name loses only its `<0.13.0` line, and `versionInRange` (the same predicate `registry-deprecate.mjs` uses) keeps `0.13.0-*` prereleases out of that line.
    - **Policy.** Every one of the 33 listed names has a single maintainer (`arnilo`) and fewer than 300 downloads last week — the highest is `prism-providers` at 187, and the sixteen providers run 12–74. So no name is refused for downloads or maintainers, and the only refusals are dependents that stay published.
    - **The plan (default, the classification the task authorises): 27 names, 128 commands, 6 refused, 35 kept**, written to `docs/_evidence/registry/arnilo-cleanup-plan-2026-11-08.sh` for review. Order is dependents first from the published manifests: `prism-all` (the aggregator, nothing depends on it) leads, `prism-code` precedes all ten of its dependencies, and `prism-acp-agent` precedes `core`/`coding-tools`/`providers`/`ag-ui`. **104 of the 128 commands are per-version.** npm 12's `lib/commands/unpublish.js` throws "Tags and ranges are not supported" unless the spec is one exact version or `*`, so a reused name's old line is one command per version: of the seven reused names, the plan deletes `ag-ui`'s 51, `channels`' 7 and `provider-openrouter`'s 46 that way, and the other four (`mcp` 59, `workflows` 43, `evals` 41, `model-router` 34 — 177 versions) are refused, so 281 versions in total are one command each when the refusals clear. Each of those removes every published version of the name, which puts it under npm's 24-hour republish block — the task's own ordering requirement, satisfied by Task 39 being later than this.
    - **The six refusals, and why they are the interesting part.** `coding-tools`, `core` and `mcp` are blocked by `@arnilo/prism-antigravity-agent` (undeprecated, off every list); `evals` and `model-router` by `@arnilo/prism-enterprise-postgres`; `workflows` by `@arnilo/prism-sdk`; `mcp` additionally by `sdk`. All three blockers are 0.3-era fully deprecated names except `antigravity-agent`, so `--plan --include-unlisted` (61 names, 366 commands, **3 refusals**, 4 kept) is what turns the deprecated 26 into deletions and unblocks three of the six. The remaining three are blocked by `antigravity-agent` and by `coding-tools` itself (refused, so `core` stays refused behind it) — a chain the owner can only break by deciding `antigravity-agent`'s fate. `--include-unlisted` never deletes a shipped name: `prism-wiki`, `prism-rag` and `provider-opencode-go` get only their old versions, and `@arnilo/prism` (no deprecated version) is untouched.
    - **Not executed: the registry run is the owner's, and npm's passkey flow cannot be driven from here.** `npm login` now authenticates (`npm whoami` returns `arnilo`), but the account is `tfa.mode = auth-and-writes`, and npm 12's `otplease` (`/usr/lib/node_modules/npm/lib/utils/auth.js:8`) throws `EOTP` instead of starting the browser handshake whenever `stdin`/`stdout` is not a TTY: `if (!process.stdin.isTTY || !process.stdout.isTTY) throw err`. A passkey cannot be relayed like a six-digit code, and no token is stored here, so every write is a human browser approval. One probe (`npm unpublish @arnilo/prism-all --force`) confirmed the `EOTP` and deleted nothing. The task is owner-run by design, so this is the expected stopping point rather than a workaround to find: the owner gets `docs/_evidence/registry/arnilo-delete-list-2026-11-08.md`, generated from the same evidence as the plan — 24 whole-name deletes with their version and never-deprecated counts, the three reused names' 104 per-version deletes, the six refusals with their deprecate commands, and the 35 names that stay, grouped into shipped (4), deprecated-but-unlisted (28) and neither (3). **Still to do after the owner runs it:** re-run `--inventory` and record each name's final state (`404` / `deprecated` / `kept`) plus every policy refusal the registry reports; shrink `scripts/deprecations-0.13.json` to the names still needing a deprecation and let `scripts/registry-deprecate.test.mjs` / `retired-providers.test.mjs` counts follow; and state in `docs/migrate-to-0.13.md` which 0.12-era packages are gone from npm, naming each successor. That statement is deliberately not written yet — it is false until the commands have run.
    - **Result (2026-11-09): the scope is 2 names, the other 66 are gone.** Four owner-run passes: 24 whole-name deletes, the 9 reused names' old lines, the 11 that were refused until `prism-ag-ui` went first, and `prism-office`. `@arnilo/prism` (64 versions, `0.12.1` latest) and `@arnilo/liveframe` (16, 982 downloads a week, nothing retires it and no 0.13 package replaces it) are what the scope reads now. `docs/_evidence/registry/` holds the before inventory (68 names), the after inventory (2), both command lists and the delete-list documents; `arnilo-cleanup-plan-2026-11-09.sh` keeps the executed commands as comments so re-running it does nothing. Every reused name returns at 0.13.0 after npm's 24-hour block.
    - **Three tool defects the run exposed, each fixed with a test.** (i) A `delete-old-line` step emitted one command per version even when every version was retired, so 314 passkey approvals stood where 9 belonged: `buildPlan` now collapses to a single `delete-name` command in that case and keeps the per-version form for a name that has a version outside the range (`cleanup_plan_collapses_a_name_whose_every_version_is_retired`). (ii) A name retired before 0.13 (`prism-office`, retired in 0.8 toward `prism-tools-work`) is named by no 0.13 list and had no deprecated versions, so it looked unlisted and was kept: the classifier now also reads the repo's own `scripts/retired-names.json` through `ledgerRetiredNames()`, while a name 0.13 ships still wins (`cleanup_plan_deletes_a_name_retired_before_0_13`). (iii) `registry-deprecate.mjs` treated a 404 as a failure, so after the cleanup `--generate` and `--dry-run` both went red on all 33 targets: an absent name is now reported `unpublished` and counted as done, in both paths (`deprecate_treats_an_unpublished_name_as_done`).
    - **`scripts/deprecations-0.13.json` is deliberately not shrunk.** All 33 of its names are gone from the registry, so it no longer drives any deprecation — but it is also the successor mapping behind `scripts/retired-names.mjs --generate`, the `retired-names.json` ledger that `no_retired_name_in_live_tree` enforces, `retired-providers.test.ts`, `provider-kit.test.ts` and `docs/migrate-to-0.13.md`. Emptying it would erase the record of what 0.13 retired and what replaced each name, and would empty the ledger that stops a retired name reappearing in the live tree, while deleting the packages is what removed the need to run deprecations at all. The file stays as the retirement ledger; `npm-deprecate.yml` and its `NPM_TOKEN` are Task 38's, and `--dry-run` now reports `33 unpublished, 0 problem(s)` if it is ever run.
    - **Docs.** `docs/migrate-to-0.13.md` gains "The retired names are unpublished from npm" under the package map: the 66 names, the two that stay, the reused names that return at 0.13.0, and where the evidence lives — the statement the 2026-11-08 note refused to write before the commands ran. `docs/release.md`'s Registry hygiene section records the outcome, the whole-name collapse rule and the ledger source. CHANGELOG carries the entry.
    - **First owner pass, 2026-11-09.** The owner deleted the 24 whole-name targets by hand; the fresh inventory (`docs/_evidence/registry/arnilo-scope-2026-11-09.json`) reads `44` names left, down from `68`, and every one of the 24 is gone. The three version-only names from the first list were not touched: `ag-ui` still holds all 51 retired versions, `channels` 7, `provider-openrouter` 46. Dependency chains also unblocked two of the six refusals — `prism-evals`, `prism-model-router` and `prism-workflows` are now deletable because `prism-sdk` and `prism-enterprise-postgres` are gone or scheduled, leaving only `prism-coding-tools`, `prism-core` and `prism-mcp`, all blocked by `@arnilo/prism-antigravity-agent`.
    - **Second pass list, `docs/_evidence/registry/arnilo-delete-list-2026-11-09.md`** (+ `arnilo-cleanup-plan-2026-11-09.sh`, 342 commands): the 28 fully deprecated names that no 0.13 retirement list mentions — the 0.3 family the owner asked about (`compaction`, `compaction-llm`, `compaction-observational-memory`, `base`, `sdk`, `server`, `supervisor`, `caveman`, `ponytail`, `impeccable`, `browser`, `policy`, `session-store-*`, `enterprise-postgres`, `credentials-node`, `observability-opentelemetry`, `tool-validator-json-schema`, `work-tools`, `openapi-tools`, `document-reader`, `coding-agent`, `coding-security`, `computer-use-linux`, `graft`, `obscura`) — plus the nine reused names' retired version lines. **Answer to the owner's usage question: nothing in the current tree uses any of them.** No workspace carries those names (the live compaction package is `@arnilo/prism-memory-compaction`), `src/` mentions `caveman`/`ponytail`/`impeccable` only as `// ponytail:` shortcut comments, and the remaining references are era ledgers (`scripts/phase54-package-map.mjs`, `phase29-frozen-manifest.json`, `phase24-truth.test.ts`, `retired-names.json`) plus `docs.test.ts` retired-name lists. All 28 are already deprecated at 100% of their versions, though every deprecation message still points at a 0.4-era name that was itself deleted (`@arnilo/prism-coding-tools/*`, `@arnilo/prism-core/*`, `@arnilo/prism-memory/compaction/*`), which is why the second list maps each to today's successor by hand.
    - **`--include-unlisted` never touches `@arnilo/prism` itself.** Checked on the 2026-11-09 evidence: the plan has zero `unpublish @arnilo/prism@` commands, so the kernel's 64 published versions — including the whole `0.12.x` line — stay. That guard is what makes the sweep safe to hand to the owner, because deleting the kernel name would take every published version and block the 0.13.0 publish for 24 hours.
    - **The three refused names clear with one more delete.** `@arnilo/prism-antigravity-agent` (2 versions, `0.3.0` and `0.4.0`, never deprecated, 14 downloads a week, no dependents, no repo reference — the `antigravity` hits in `roadmap.md` are the `agy` host driver) is the last published package depending on `prism-mcp` and `prism-coding-tools`, and `prism-coding-tools` is what holds `prism-core`. Simulated against the 2026-11-09 evidence with that one name removed and its edges dropped: `buildPlan(..., { includeUnlisted: true })` returns `refusals: []` and emits `prism-coding-tools` → `prism-core` → `prism-mcp`'s 59 versions, 62 commands in total, recorded as section C of `arnilo-delete-list-2026-11-09.md`. Two of the three were never deprecated either, so the removal is the first thing their 0.12 consumers see. `prism-mcp` stays a reused name: its 59 versions go one at a time and 0.13.0 republishes it after the 24-hour block.
    - **The per-version form was needless while no 0.13.0 exists.** `buildPlan` now collapses a `delete-old-line` step into one `delete-name` command whenever every published version is inside the retired range — the same end state npm reaches anyway, one command instead of one per version. A version outside the range (the case after the 0.13.0 republish) keeps the per-version form, so the name still survives; that boundary is pinned by `cleanup_plan_collapses_a_name_whose_every_version_is_retired`. The owner's second pass then dropped the scope from 44 to **14** names: `ag-ui` (51), `channels` (7), `evals` (41), `model-router` (34), `provider-openrouter` (46), `workflows` (43), `provider-opencode-go` (46), `rag` (43), `wiki` (3), plus `coding-tools` and `core`, which the registry now allows because `ag-ui` goes first in the same list — **eleven whole-name deletes, eleven commands**, no refusals, in `arnilo-delete-list-2026-11-09.md`. `@arnilo/prism` (64 versions) and `@arnilo/liveframe` (16) stay, and the sweep provably emits nothing against the kernel name.
    - **One name was retired before 0.13, so no 0.13 list could name it.** With the scope down to three names, `@arnilo/prism-office` was the only unexpected survivor: `docs/migrate-to-0.13.md:81` retires it in 0.8 toward `@arnilo/prism-tools-work`, `src/__tests__/packaging.test.ts` asserts the office package must be absent, its `/documents`, `/sheets` and `/diagrams` subpaths now live on `@arnilo/prism-tools-work`, and the registry still had 10 unde­precated versions because the 0.13 deprecation pass only covers names live at 0.13. `scripts/registry-cleanup.mjs` read just `scripts/deprecations-0.13.json`, so the name looked unlisted and unowned. It now reads the repo's own `scripts/retired-names.json` through `ledgerRetiredNames()`: a name the ledger retires and no workspace ships is a delete, while a name 0.13 ships is still a keep (pinned by `cleanup_plan_deletes_a_name_retired_before_0_13`). That leaves one command, `npm unpublish @arnilo/prism-office --force`, and after it the scope holds `@arnilo/prism` and `@arnilo/liveframe`. `liveframe` is the only name nothing retires and no 0.13 package replaces, with 982 downloads a week, so it stays the owner's call rather than the sweep's. The stale `phase54-package-map.mjs` row that still calls `@arnilo/prism-office` a new 0.13 family is frozen 0.8-era evidence and contradicts the migrate doc; it is not edited here.
    - **Checks run.** `bun scripts/release.mjs gate` exits 0 after a rebaseline of `scripts/budgets.json` (+1238 packed / +3362 unpacked, attributed there to the `docs/release.md` section and the CHANGELOG entry; `scripts/**` and `docs/_evidence/**` do not pack). `bun test scripts/registry-cleanup.test.mjs` 7/7 (`cleanup_plan_orders_dependents_first` including a cycle that must throw, `cleanup_plan_deprecates_policy_ineligible_names` for the three refusal classes plus unknown downloads, `cleanup_plan_touches_only_old_line_of_reused_names`, `cleanup_plan_never_invokes_npm`, `cleanup_evidence_contains_no_secret`, plus the shipped-name and render cases). `bun test scripts/retired-names.test.mjs scripts/import-hygiene.test.mjs scripts/truth-current.test.mjs` 19/19 with the new evidence files and the new docs section in place. `bun test src/__tests__/docs.test.ts -t docs_release_gate_list_matches_scripts` passes; biome clean on both new files and on `scripts/run-all-tests.mjs`.
    - **Performance.** Two reads per name and one listing, nothing cached: 68 packuments plus 68 downloads points, which takes under two minutes with the 250 ms spacing the downloads API's rate limiter needs (it answers 429 otherwise, and the bulk POST endpoint is behind Cloudflare too). `--plan` re-reads the registry, so the committed plan and the committed inventory come from the same read of the scope; the run is once per release, by hand.
    - **Security.** Anonymous reads only; no token is read, no OTP is handled, nothing runs in CI. The evidence goes through `assertNoSecretLeak` (reused from `scripts/cache-parity/run.mjs`, which also supplies `secretValues`), so a credential-shaped value anywhere in the inventory aborts the write instead of being committed — the test injects one to prove it. Irreversibility is stated in the plan header the owner reads before running anything.
    - **Findings for later tasks.**
      0. **Never-deprecated delete targets.** Eight of the 24 whole-name deletes still carry versions the registry never marked deprecated (`prism-memory` 59, `prism-providers` 63, `prism-web-tools` 56, `prism-acp-agent` 22, `prism-hooks` 5, `prism-work` 7, `prism-agent-sdk` 1, `prism-code` 2), and so do the refused `prism-coding-tools` and `prism-core` (17 each). The plan 175 deprecate pass evidently never ran for them, so nothing warned 0.12 consumers before the delete. Deletion covers the first eight; for the two refused names the deprecate command in section 3 of the list is their first deprecation, not a re-issue.
      1. **Task 37 remainder + Task 38:** no token is set in `~/.npmrc` here (the executor never stores one), so the plan needs the owner's browser-authenticated shell; the same 2FA requirement will hit `npm-deprecate.yml` and `release.yml`'s publish step — `npm-deprecate.yml` and `release.yml`'s publish step — which is one more argument for Task 38's OIDC switch and for deleting the `NPM_TOKEN` secret rather than rotating it.
      2. **Task 39:** `@arnilo/prism` itself (64 versions, none deprecated) is not on any deprecation list, so `0.12.1` stays undeprecated after 0.13.0 publishes. If the 0.12 line should warn on install, `@arnilo/prism@<0.13.0` needs a `reused` entry in `scripts/deprecations-0.13.json` — a one-line addition, and a decision this task did not take on its own.
      3. **Owner decision:** the 26 fully deprecated 0.3-era names are the largest remaining gap between "clean scope" and today. `--include-unlisted` deletes all of them in one reviewable file; `antigravity-agent` (`0.4.0`) and `office` (`0.7.0`) are undeprecated and off every list, and they are what still blocks `coding-tools`, `core` and `mcp`.

- [x] Task 38: Trusted publishing — replace the npm token with OIDC (added 2026-11-04, owner)
  - Acceptance Criteria:
    - Functional: **Review**, recorded in the task note, with sources and dates (find-docs).
      - **Known requirements**, verified 2026-11-04 via Context7 `/websites/npmjs` against https://docs.npmjs.com/trusted-publishers/:
        - npm CLI ≥ 11.5.1 and Node ≥ 22.14.0;
        - `permissions: id-token: write` on the publishing job;
        - a trusted-publisher entry per package naming the GitHub owner, the repository, the workflow file name (`release.yml`), an optional environment, and the allowed actions (`npm stage publish` always; direct `npm publish` and `npm dist-tag` independently);
        - OIDC dist-tag operations need npm ≥ 11.21.0 or ≥ 12.2.0;
        - commands other than publish, stage-publish and dist-tag (for example `deprecate`, `unpublish`, `access`) still need traditional authentication.
      - **To verify:**
        - (1) whether the installed Bun's `bun publish` supports OIDC trusted publishing; if not, the pipeline publishes the packed tarballs with `npm publish <tarball>`;
        - (2) whether trusted publishing produces the npm provenance statement automatically;
        - (3) whether `--tag experimental` on a publish needs the dist-tag permission;
        - (4) **first publish of a never-published name.** Most 0.13.0 names do not exist yet (`@arnilo/prism-tools-coding`, `-provider-hyper`, `-memory-fabric` and `-memory-compaction` returned 404 on 2026-11-04). Record whether a trusted publisher can be configured before a package exists, and the bootstrap this implies.
    - Functional: **Pipeline.**
      - `publishArgs` (`scripts/release.mjs:401`) builds `npm publish <release-artifacts/tarball> --access public --tag <latest|experimental>` (Task 2's tag rule), or the `bun publish` equivalent if (1) allows it. The published bytes are still the packed, attested tarballs, and resume by registry GET is unchanged.
      - `.github/workflows/release.yml`'s publish job:
        - runs only on tag refs;
        - runs in a protected GitHub environment `npm-publish`, with the owner as required reviewer, which is the human approval gate;
        - declares `permissions: { contents: read, id-token: write, attestations: write }`;
        - pins `actions/setup-node` by SHA, with Node and npm at or above the review's minimums;
        - loses the "wire registry auth" step (`:255-259`) and every `NODE_AUTH_TOKEN` reference.
      - `.github/workflows/npm-deprecate.yml` is deleted, because deprecation cannot use OIDC. `scripts/registry-deprecate.mjs` keeps `--generate` and `--dry-run` and prints the `npm deprecate` commands for the owner to run locally with 2FA. Its `--apply` path and its token read are removed.
      - The 2FA posture is the owner's choice, recorded in the note:
        - **direct publish behind environment approval**, the recommended default: one approval per release covers about 55 packages;
        - **stage-only**: every CI publish is staged and the owner approves each package with 2FA (`npm stage approve`, which is not OIDC-capable). This is the stricter option, at one approval per package.
      - **Bootstrap**, per review (4). If a publisher cannot be configured for a name that does not exist, the owner performs the first publish of each new name locally with 2FA, from the CI-packed tarballs, after checking them against the pack step's `SHA256SUMS`. The note records that those first versions carry the build attestation but no npm provenance statement. The trusted publisher is configured right after. From then on, OIDC is the only publish path.
    - Functional: **Owner setup**, checklisted in the note and in `docs/release.md`:
      - configure the trusted publisher on every published `@arnilo` name (`scripts/registry-cleanup.mjs --trusted-publishers` prints the list and the exact settings);
      - enable "Require two-factor authentication and disallow tokens" on each package;
      - delete the `NPM_TOKEN` secret from the repository and organization;
      - revoke the token on npmjs.com.
      The executor verifies with an anonymous registry GET after the first OIDC publish that the new version shows trusted-publisher provenance.
    - Functional: `docs/release.md`'s pipeline section describes trusted publishing, the environment approval, the bootstrap, verification (`npm audit signatures` plus `gh attestation verify`), and that no long-lived npm token exists.
    - Performance: n/a — the publish step's request count is unchanged.
    - Code Quality: One publish code path. No fallback to a token. No duplicate `.npmrc` handling.
    - Security:
      - No long-lived npm credential anywhere in CI.
      - Publish happens only from `release.yml`, on a tag, inside the protected environment.
      - Tokens are disallowed on every package.
      - The build attestation and the `SHA256SUMS` check stay.
      - A test fails if any workflow references `NPM_TOKEN`, `NODE_AUTH_TOKEN` or `_authToken`.
  - Approach:
    - Documentation Reviewed:
      - npm "Trusted publishing for npm packages", "Configuring trusted publishing", "Managing dist-tags with trusted publishing", "Generating provenance statements" (Context7 `/websites/npmjs`, read 2026-11-04)
      - `.github/workflows/release.yml:200-278`, `scripts/release.mjs:401-470`, `.github/workflows/npm-deprecate.yml`
    - Options Considered:
      - **Keep the token and add 2FA-for-writes.** Rejected: a CI automation token bypasses 2FA by design, which is exactly the owner's concern.
      - **Stage-only for every package.** Kept as the owner's alternative (see criteria), not the default, because of its per-package approval load.
    - Chosen Approach:
      - OIDC trusted publishing from the one release workflow, gated by a protected environment, with tokens disallowed on the registry.
    - API Notes and Examples:
      ```yaml
      publish:
        environment: npm-publish
        permissions: { contents: read, id-token: write, attestations: write }
        steps:
          - uses: actions/setup-node@<sha> # node >= 22.14, npm >= 11.5.1
          - run: bun run release:publish -- --resume --report release-artifacts/publish-report.json
      ```
    - Files to Create/Edit:
      - `.github/workflows/release.yml`; `.github/workflows/npm-deprecate.yml` (deleted)
      - `scripts/release.mjs`, `src/__tests__/release.test.ts`, `scripts/release-gate.test.mjs`
      - `scripts/registry-deprecate.mjs` and its test (`--apply` removed); `scripts/registry-cleanup.mjs` (`--trusted-publishers`)
      - `scripts/workflow-liveness.test.mjs` (the no-token assertion; the plan's `scripts/ci-integrity.test.mjs` became this file — see Task 36's note)
      - `docs/release.md`, `CHANGELOG.md`
    - References:
      - plan 164 Task 8.4 (attested publish); Task 36 (CI integrity); Task 37 (registry state)
  - Test Cases to Write:
    - `publish_args_npm_tarball_with_tag` covers `latest` and `experimental`.
    - `workflows_reference_no_npm_token`: fails on any `NPM_TOKEN`, `NODE_AUTH_TOKEN` or `_authToken`.
    - `publish_job_requires_environment_and_id_token`.
    - `publish_job_meets_trusted_publishing_minimums`: the pinned Node and npm versions.
    - `registry_deprecate_has_no_apply_path`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; the release pipeline and its security posture.
    - Docs pages to create/edit: `docs/release.md` (pipeline, owner setup, verification), `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-09; **the code path is done, the registry-side setup is the owner's**):
    - **Review, re-verified 2026-11-09** against npm's docs (`/websites/npmjs` through Context7, plus a direct read of https://docs.npmjs.com/trusted-publishers/): `id-token: write` and a GitHub-hosted runner are required; `npm publish --provenance` turns OIDC into a sigstore statement; the trusted-publisher entry names owner, repository, workflow filename, optional environment and the allowed actions, where `npm stage publish` is always allowed and `npm publish` / `npm dist-tag` are independent opt-ins; and the config must complete its first successful publish within 2 days or it expires.
    - **Answers to the four open verifications.**
      - **(1) `bun publish` has no OIDC path.** Bun's publish docs cover tokens (`NPM_CONFIG_TOKEN`) and `--otp` only; there is no `--provenance` and no trusted-publishing support. The pipeline therefore publishes with `npm publish <tarball> --access public --tag <tag> --provenance`, and the published bytes are still the ones Bun packed and the workflow attested.
      - **(2) Provenance is automatic on the OIDC path.** `--provenance` plus `id-token: write` on a GitHub-hosted runner produces npm's sigstore statement for the version; a first publish also needs `--access public`. Both attestations now ship: npm's statement on the version, GitHub's on the tarball.
      - **(3) `--tag experimental` is a publish argument, not a dist-tag call.** `npm dist-tag add/rm` is the operation that needs the separate dist-tag permission (npm ≥ 11.21.0 / ≥ 12.2.0). Because a future release may fix a dist-tag, the owner checklist enables both `npm publish` and `npm dist-tag`.
      - **(4) A trusted publisher cannot be configured before a name exists, and there is no pending-publisher mechanism.** npm's settings page and the package record only exist after a first version; the documented flow assumes an existing package, npm's own documentation issue npm/documentation#1926 tracks the gap, and the workaround every consumer of the feature uses is one manual first publish. Together with the 2-day validation window this sets the bootstrap below.
    - **Pipeline (executor work, done).** `.github/workflows/release.yml`: the publish job keeps `environment: npm-publish`, `id-token: write`, `attestations: write` and its tag condition, adds `actions/setup-node@949feb2… # v7.1.0` with Node 24.10.0 (bundled npm 11.6.2, above the 11.5.1 floor), drops the `.npmrc` auth step and the last `NODE_AUTH_TOKEN`/`secrets.NPM_TOKEN` reference, and bumps `bun-version` 1.4.2 → 1.4.4 to match the repo (the drift Task 36 recorded). `scripts/release.mjs`: `publishArgs` gains `--provenance` (CI only, never on a dry run) and the publisher spawns `npm` with the `release-host registry toolchain` boundary comment, so `tooling-gate`'s npm census still passes. `.github/workflows/npm-deprecate.yml` is deleted; `scripts/registry-deprecate.mjs` loses `--apply`, its token read, its `PUT` and its write mode, keeps `--generate` and `--dry-run`, and gains `--commands`, which prints the `npm deprecate` lines; `--apply` exits 2 with the reason. `scripts/registry-cleanup.mjs` gains `--trusted-publishers`, which reads `remote.origin.url` from `.git/config` (no child process — the no-npm invariant scans for one) and prints the settings plus the shipped names, marking each name npm has never seen for the bootstrap.
    - **Tests.** New: `workflows_reference_no_npm_token`, `publish_job_requires_environment_and_id_token`, `publish_job_meets_trusted_publishing_minimums`, `registry_deprecate_has_no_apply_path`, `deprecate_commands_are_the_owner_run_lines`, `trusted_publishers_render_lists_names_and_settings`. Inverted from the plan 164 Task 8.4 world: `release.test.ts`'s workflow test (pattern-only tags, npm spawn, `--provenance`), `docs.test.ts`'s publish test and its token assertion, `tooling-gate.test.mjs`'s npm census assertions, and `workflow-liveness`'s "no Node leg" rule, which now allows setup-node in the publish job only. `nonBunCommandProblems` accepts exactly one npm form, `npm install -g npm@<exact>`, and the workflow no longer needs even that because Node 24 ships a compliant npm.
    - **2FA posture: direct publish behind environment approval**, as recommended in the criteria — one approval per release covers every package. Stage-only is documented as the stricter alternative in `docs/release.md`; it was not chosen because its cost is one approval per package per release, and staging cannot be approved from OIDC.
    - **Bootstrap for 0.13.0.** Because Task 37 deleted the legacy names, 51 of the 52 published names have no registry record at all, so their first 0.13.0 version cannot be published by OIDC: the owner publishes the first version of each name locally with 2FA from the tarballs CI packed (verifying `SHA256SUMS`), then adds the trusted publisher and the token ban per name, and every later cut is OIDC. Those first versions carry the GitHub attestation but no npm provenance statement. `@arnilo/prism` is the one name with a settings page today, and its trusted-publisher entry must be created close to the publish because it expires in 2 days.
    - **Owner checklist, also in `docs/release.md`.** (1) create the `npm-publish` environment with the owner as required reviewer; (2) run `bun scripts/registry-cleanup.mjs --trusted-publishers` and configure each name (owner, repo, `release.yml`, `npm-publish`, `npm publish` + `npm dist-tag`); (3) set Publishing access to "Require two-factor authentication and disallow tokens" per name; (4) delete the `NPM_TOKEN` secret from the repository and the organization and revoke the token on npmjs.com; (5) after the first OIDC publish, verify with `npm view <name>@<version> dist.attestations --json`, `npm audit signatures`, and `gh attestation verify <tarball> --owner <owner>`.
    - **Checks run.** `bun scripts/release.mjs gate` rc=0 after rebaselining the kernel budget (+686 packed / +2094 unpacked, attributed to the docs and CHANGELOG text plus the concurrent session's tree). `docs.test.ts` 69 pass, `release.test.ts` 19 pass, `registry-cleanup` 10 pass, `registry-deprecate` 7 pass, `workflow-liveness` 17 pass. Biome clean on every touched script and test. Pre-existing reds left alone: `workflow-liveness`'s `every @arnilo/* import in scripts/` (`scripts/memory-bench/work-outcome/long-session.mjs` imports the retired `@arnilo/prism-memory-observational` — the concurrent memory session's edit) and `tooling-gate`'s Bun.hash, node:test and `personas.mjs` failures.

- [ ] Task 39: Publish 0.13.0, apply the deprecations, switch to independent versioning, and record Phase 11 Done (owner-gated) (was plan 187 Task 2) — **Dropped by plan 224 (2026-11-09): moved to plan 224 Task 10, which publishes seven npm packages (the kernel plus six bundles) instead of 52, on the owner's package-consolidation decision. The criteria below are kept as history.**
  - Acceptance Criteria:
    - Prerequisite (recorded 2026-10-15, after plan 175 Task 8; satisfied — plans 176 and 177 are complete): plans 176 (Phase 11 Part C — tool-gate integrity, narrow-only ownership, fail-closed dispose) and 177 (Phase 11 Part D — host isolation and security hardening) both **block this task**. They reopen the surface frozen by plan 174 Task 9 and change kernel and host-library contracts, so they must complete and regenerate the compat baselines before the 0.13.0 tag is pushed. The version cut itself (plan 175 Task 7) stands.
    - Inputs from Task 1 (2026-11-05): (1) the `v0.13.0` ref skips the CodeQL job and `publish` until Task 36 fixes the tag lists — Task 36 did, so the dry run must show the security job (now `security-release`, which calls `security.yml`) and `publish` running for that ref; (2) `scripts/post-publish-smoke.mjs:31,88-89,161` install and import the memory packages at `--version 0.13.0`, so the smoke's memory legs move to an `@experimental` spec; (3) whether the registry sets `latest` on a first `--tag experimental` publish is unverified, so record each memory package's resulting dist-tags (anonymous registry GET) in the note.
    - Functional: Pre-flight, on a clean tree at the release commit:
      - `bun run sdk:ready` exits 0
      - `PRISM_TEST_POSTGRES_URL=… bun run release:gate` exits 0
      - `bun scripts/release.mjs pack --destination release-artifacts` packs every package, and the task note records the package list
      - `bun scripts/registry-deprecate.mjs --generate && --dry-run` prints the planned deprecations
      - plans 176–183, 188–207, 213 and 214 are `complete` or `closed` in `plans/README.md`; plan 208 Task 8 (portable `wiki_ingest` schema) has landed, and 208 Task 5 may still be running from its pinned worktree; plans 184–187, 211 and 212 are `superseded by 215`; plans 209–210 are the post-0.13.0 memory track; Tasks 1–38 of this plan are checked
      - the publish path for the `v0.13.0` tag is the one Task 1 (b) recorded: `.github/workflows/release.yml`'s publish step either gains `v0.13.0` in its lockstep branch or the note shows why the independent path publishes the same set (amended on execution: Task 36 removed the version list entirely — any `v*` tag takes the lockstep branch and any other tag the independent one, pinned by `release_publish_path_for_v0_13_0` in `scripts/workflow-liveness.test.mjs`)
      - `bun scripts/release.mjs pack` packs the five experimental packages at `0.13.0-experimental.0` and `publishArgs` gives them `--tag experimental` (dry run output recorded)
      - `bun scripts/live-preflight.mjs --suite providers/ --probe` and `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe` pass (amended 2026-11-08 by Task 31), then the strict runs of `providers/` (all nine shipped provider packages, ten rows with `liquid-local`; amended 2026-10-17, 2026-10-25 for `openrouter` by plan 203, 2026-10-28 for `openai-codex` by plan 204, 2026-10-31 for `kilo` by plan 213, and 2026-10-31 for `litellm` by plan 214; the in-tree `providers/commandcode` row runs with plan 205 Task 5 and is not a 0.13.0 gate), `release/journey-` (Command Code and Ollama Cloud; amended 2026-11-08 by Task 33, owner decision), and `release/cache-parity` pass on the release commit (plan 186's methodology), and `docs/_evidence/live-release-acceptance-0.13.0.md` records them; the owner signs it in this task's note (amended 2026-10-16 by plans 182–186). Amended 2026-11-09 by Task 34:
        - Hyper, Kilo and OpenCode Go must have credit or quota (Task 34 found all three refusing on account state).
        - The rows the owner scoped out of Task 34 (`typesafe`, `liquid`, `laya`, `liquid-local`, `openai-codex`, `litellm`; decision models covered by Ollama Cloud `clef`) are either provided or carried with the same recorded owner scope.
        - The Ollama Cloud cache-parity `behind` verdict gets the owner's decision (Task 34 finding 3) before the run.

      **The executor stops here and asks the owner to confirm** pushing the `v0.13.0` tag.
    - Functional: After confirmation, the tag push runs `.github/workflows/release.yml`: verify, the Postgres, office, CodeQL, and supply-chain gates, pack, attest, then the OIDC trusted-publishing publish (Task 38) in dependency order, after the owner approves the `npm-publish` environment. The note records the workflow run URL. The five experimental memory packages are published by the same attested CI path after the kernel (their `@arnilo/<name>@0.13.0-experimental.0` tags, or the lockstep run if Task 2's tooling includes them there), each with dist-tag `experimental`. The note records every name's dist-tags from an anonymous registry `GET` (and, per Task 1 (c), whether `latest` also points at the prerelease because no stable version exists). `bun scripts/post-publish-smoke.mjs` passes against the registry: it installs `@arnilo/prism@0.13.0` and a native package into a temp project and runs the README quickstart on the mock provider.
    - Functional: **The executor stops again and asks the owner to confirm** the remaining deprecations: the names Task 37 left in `scripts/deprecations-0.13.json` (ineligible for unpublish, or kept by owner choice). `npm-deprecate.yml` no longer exists (Task 38), so the owner runs the commands `bun scripts/registry-deprecate.mjs --dry-run` prints, locally with 2FA. The note records each name's resulting `deprecated` field (anonymous `GET`), and `--dry-run` reports nothing left to apply. If Task 37 removed every listed name, this step records that nothing is left.
    - Functional: The post-publish smoke gains an experimental leg: it installs `@arnilo/prism@0.13.0` with `@arnilo/prism-memory-fabric@experimental` into a temp project and runs one fabric example on the mock provider. A stable install without the tag resolves no experimental package as a dependency.
    - Functional: `scripts/independent-packages.json` lists every 0.13.0 native package and host library as independently versioned (Part 3: "After that, each is versioned independently"), except `@arnilo/prism-host-builder`, which stays on the kernel's line because its indexes describe one kernel version (Task 14). The `experimental` list keeps the five memory packages until they graduate (plan 210 Task 10). Its `$comment` records the Phase 11 cut. `release.test.ts` and `release-gate.test.mjs` pin the new shape.
    - Functional: The Phase 11 Done record in this task's Notes lists each Done criterion with its proof:
      - `@arnilo/prism` 0.13.0 and the native packages are published, including `driver-kit` (a kernel subpath), `prism-driver-process`, `prism-workflows`, `serveTools` (in `prism-mcp-server`), `prism-remote`, `prism-headless`, and `prism-tools-research`; registry `GET` versions recorded
      - a new reader builds an agent from `README.md` alone (`readme_quickstart_runs_on_mock_provider` plus the post-publish smoke)
      - `release:gate` is green (run output)
      - the memory packages are published on the experimental line with their dist-tags recorded, and graduation is assigned to plan 210 Task 10
    - Functional: `plans/README.md` marks plans 174 and 175 complete. After the registry `GET`s succeed, this task flips the roadmap's "Shipped baseline" line to 0.13.0 (amended 2026-11-09 by Task 35, which could not record an unpublished version as shipped).
    - Performance: Record the publish wall time and each tarball's size against the `kernel` budget.
    - Code Quality: No manual publish from a laptop, except the one-time first-publish bootstrap of never-published names that Task 38 may require. Every other publish goes only through the attested OIDC CI path.
    - Security: No long-lived npm token exists (Task 38); `workflows_reference_no_npm_token` passes on the release commit. The attestation (`actions/attest-build-provenance`) is verified for `@arnilo/prism` with `gh attestation verify`, per `docs/release.md`. Published tarball bytes match the SHA256SUMS from the pack step.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Done and Part 3; `docs/release.md` (promoted from `docs/next/release.md`: pipeline, resume, verification); `.github/workflows/release.yml` (OIDC publish, Task 38); `scripts/post-publish-smoke.mjs`; `scripts/release.mjs:413-481` (`runRelease`, `--resume`)
    - Options Considered:
      - Publishing and deprecating in one unattended step. Rejected: both are one-way registry operations, and the owner confirms each one (system rule for outward-facing actions).
      - Deprecating before publishing. Rejected: reused names need 0.13.0 published first, or the range-scoped deprecation would leave the name with no live line. plan 175 Task 8 fails closed on this.
    - Chosen Approach:
      - Pre-flight, then owner confirmation, then the tag, publish, and smoke; then owner confirmation again before the deprecations; then the independent-versioning switch and the Done record.
    - API Notes and Examples:
      ```bash
      git tag v0.13.0 && git push origin v0.13.0        # after owner confirmation only
      gh run watch
      bun scripts/post-publish-smoke.mjs --version 0.13.0
      bun scripts/registry-deprecate.mjs --dry-run   # prints the remaining npm deprecate commands; the owner runs them locally with 2FA
      ```
    - Files to Create/Edit:
      - `scripts/independent-packages.json`, `src/__tests__/release.test.ts`, `scripts/release-gate.test.mjs`
      - `.github/workflows/release.yml` (the `v0.13.0` publish path, per Task 1 (b)), `scripts/post-publish-smoke.mjs` (experimental leg)
      - `plans/README.md` (status), this plan (Done record), `plans/backlog.md` (plan end, per SKILL.md)
    - References:
      - plan 164 Task 8.4 (attested `bun publish`); plan 140 Task 6 (deprecation workflow)
  - Test Cases to Write:
    - `independent_packages_after_0_13`: every publishable workspace except the kernel and `@arnilo/prism-host-builder` is listed, and the `experimental` list is a subset of it. It fails when a new package is added without a versioning decision.
    - The post-publish smoke (an existing script, run against the registry).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the release itself.
    - Docs pages to create/edit: `CHANGELOG.md` (the publish date on `## [0.13.0]`)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 300 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun test --timeout=0 src/__tests__/experimental-boundary.test.ts src/__tests__/skill-availability.test.ts src/__tests__/package-skills.test.ts src/__tests__/host-builder-kit.test.ts src/__tests__/prefix-stability-conformance.test.ts src/__tests__/package-loader.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts src/__tests__/kernel-constraints.test.ts src/__tests__/release.test.ts src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/release-gate.test.mjs scripts/package-truth.test.mjs scripts/version-literal-gate.test.mjs scripts/host-builder-index.test.mjs scripts/cache-parity/run.test.mjs scripts/live-preflight.test.mjs scripts/live-matrix.test.mjs scripts/live-doc-check.test.mjs scripts/retired-names.test.mjs scripts/registry-deprecate.test.mjs`
- `timeout 600 bun run --filter '@arnilo/prism-tools-*' --filter '@arnilo/prism-provider-*' --filter '@arnilo/prism-memory-*' --filter @arnilo/prism-observability --filter @arnilo/prism-delegate --filter @arnilo/prism-mcp-server --filter @arnilo/prism-host-builder test`
- `timeout 600 bun run --filter @arnilo/prism-store-jsonl --filter @arnilo/prism-store-sqlite --filter @arnilo/prism-channels --filter @arnilo/prism-agent test`
- `timeout 300 bun scripts/package-skills-conformance.mjs --json`
- `timeout 120 bun scripts/host-builder-index.mjs --check`
- `timeout 300 bun scripts/skill-evals/run.mjs --offline` and `timeout 600 bun scripts/host-builder-evals/run.mjs --offline`
- `timeout 120 bun examples/package-skills.ts` and `timeout 180 bun examples/host-builder-agent.ts`
- `timeout 1800 bun run test`
- `timeout 1800 bun scripts/release.mjs gate` (with `--update-baseline` only inside the tasks that name it)
- Owner-run live legs, in order (owner env file; `pi` installed with Hyper and OpenCode Go):
  - `bun scripts/live-preflight.mjs --suite providers/ --probe` and `PRISM_LIVE_CACHE_PARITY=1 bun scripts/live-preflight.mjs --suite release/journey- --suite release/cache-parity --probe`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live`
- `timeout 300 bun test --timeout=0 scripts/workflow-liveness.test.mjs scripts/registry-cleanup.test.mjs`
- After publish: `bun scripts/post-publish-smoke.mjs --version 0.13.0` (including the experimental leg) and `bun scripts/registry-deprecate.mjs --dry-run` (nothing left to apply)

## Compromises Made

- Task 39 moved to plan 224 Task 10 and executed there: 0.13.0 published 2026-11-11; deprecations declined by the owner 2026-11-12. The live scope and the Ollama Cloud cache verdict are recorded in `docs/_evidence/live-release-acceptance-0.13.0.md`.
- Nine memory and kernel files edited after candidate `2cd2b553` are not in 0.13.0 (plan 224 Task 10 notes).

## Further Actions

- Carried to `plans/backlog.md` from plan 224 Task 10: the release snapshot decision, the `latest` tag on the experimental names, the deprecations, the `0.0.0-stage` version, and the failing `scripts/` suites.
- **`HostUi.kinds` capability declaration** (from Task 29, priority low): a host declares the request kinds it implements, so a package can pick a fallback before asking instead of after an `unavailable`. It is an optional member, so it ships in a minor release under Task 28's rules; `docs/compatibility.md` "Extension and configuration notes" already says so.
