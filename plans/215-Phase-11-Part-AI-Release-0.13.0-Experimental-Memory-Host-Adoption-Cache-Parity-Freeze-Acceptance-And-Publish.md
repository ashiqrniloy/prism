# Phase 11 Part AI — release 0.13.0: experimental memory, host adoption, cache parity, surface freeze, live acceptance and publish

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
- A reviewed and cleaned CI and release gate locked by `scripts/ci-integrity.test.mjs`; the deprecated `@arnilo` packages deleted from npm (or deprecated where npm's unpublish policy refuses), with before/after evidence; publishing through npm trusted publishing (OIDC) behind a protected environment, with no npm token in CI and tokens disallowed on every package.
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
- **`SecretSource` migration (Task 27):** ten provider packages, `{hyper, opencode-go, typesafe, laya, liquid, openrouter, kilo, litellm, commandcode, ollama-cloud}`, plus the kit, `packages/tools/web` and `packages/hosts/channels`. `openai-codex` already resolves through the credentials slot and needs no migration. Its `CredentialRefNotWritableError` and `CredentialStoreUnavailableError` kernel exports are frozen. Kilo's request path keeps `resolveApiKey`. Observability's `propagateTraceContext` and `usageMetadata` config additions (plan 214) are frozen.

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

The gate is: Prism's median `hitRate` ≥ pi's on every enabled conclusive cell, with no `usage_mismatch`. The full three-run coding-task runner (Task 23) covers the Hyper and OpenCode Go cells. The other cells are four-request probe diagnostics (`scripts/cache-parity/provider-probe.mjs`) recorded by their provider plans. Task 24 re-records their status in the evidence file and does not re-run them unless their lever code changed.

| Cell | Prism | Reference | Status carried in |
| --- | --- | --- | --- |
| Hyper Chat / Hyper Messages | `hyper`, Task 21 model | pi, same upstream model | to run (Task 24), 120 requests per cell |
| OpenCode Go Chat / Messages | `opencode-go`, Task 21 model | pi, same upstream model | to run (Task 24), 120 requests per cell |
| OpenRouter Anthropic | `openrouter`, `anthropic/claude-haiku-4.5` | `pi -p --mode json --provider openrouter` | `unmeasurable` unless the owner authorizes paid use and sets `PRISM_LIVE_OPENROUTER_PAID=1` |
| OpenAI Codex (sanctioned route) | `openai-codex`, `gpt-6.1-sol` | pi `--provider openai` (Sign in with ChatGPT) | Prism probe reuse 0.983 (`docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json`). The pi side is `unmeasured` while `pi auth check --provider openai` is `not_ready`. |
| OpenAI Codex (first-party) | measured | `codex exec` and `codex exec resume` | Prism leads in every measured shape (0.981 vs 0.481–0.842; `docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json`) |
| Command Code Chat / Responses / Messages | `commandcode` | pi-commandcode-provider 0.7.10 | Prism ≈ pi, no lever gap (plan 205). Not a 0.13.0 gate. |
| Kilo Chat / Responses / Messages | `kilo` | Kilo CLI 7.8.18 | Probe on the free model: Chat and Responses 0.506, Messages 0.337. The paid Responses and Messages cells are `unmeasured` (402 on the reference account). The CLI headless run on the plan-203 fixture is still owed (Task 24). |
| Ollama Cloud | `ollama-cloud`, `gemma4:31b` | pi-ollama-cloud 0.13.1 | pass on both routes (`docs/_evidence/206-task3-cache-parity.md`). Not a 0.13.0 gate. |
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
        - whether `observationalCompactAtFor` is used anywhere except OM's config;
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
      - `observational({ context: { compactAt: observationalCompactAtFor(…) } })` is unconditional at `coding.ts:48` (the plan said `:47`) and `research.ts:55`. The `compaction` slot is assigned at `coding.ts:37` and `research.ts:35`.
      - **New finding: `memoryRag(…)` is also unconditional in the research worker (`research.ts:48`)**, so the research default path loads **two** experimental packages, and Task 3's criterion "with `memory` unset, `inspect().packages` of every default agent contains no experimental package" fails unless rag is gated too. `memory-rag` is also the package that provides `rag_search` and the embeddings service, and its config is `config.embeddings`. Task 3 is amended below to load it only when `config.embeddings` is set (a recommended default: it keeps the existing opt-in config as the switch and adds no new option). The owner can override at review time.
      - **Tests asserting OM on the default path: one file.** `apps/prism-agent/src/__tests__/context.test.ts:50-51` (coding worker, `observational.context` deepEqual) and `:99-102` (unlisted model). `:80,98` assert only `memory-compaction` and stay valid. `long-session.ts` has no OM reference. It mocks `packages` at `:115`, and the plan 194 context-budget tests live in `context.test.ts`. `one-shot-golden.ts` runs mock packages and `fixtures/one-shot.golden.jsonl` has zero memory or observational mentions, so no golden changes. `research.test.ts` and the `research-citations` scenario were not read for rag use: Task 3 checks them when it gates `memoryRag`.
      - **`observationalCompactAtFor`** is defined at `context-budgets.ts:41` and used only at `coding.ts:48` and `research.ts:55`, i.e. only for OM config. It moves under the `memory` branch with OM. `context-budgets.ts` and its tests stay otherwise unchanged.
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
        - `observationalCompactAtFor` is used only on the memory path;
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
        : [memoryFabric({ preset: config.memory, tools: { root } }), observational({ context: { compactAt: observationalCompactAtFor(model) } })]),
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
      - **Reference host.** `coding.ts` and `research.ts` load `observational(...)` only in the `config.memory` branch next to the fabric, and `research.ts` loads `memoryRag(...)` only when `config.embeddings` is set. The `compaction` slot assignment stays. `observationalCompactAtFor` is now referenced only inside the memory branch. `ontologyPackages` is unchanged, so `ontology` without `memory` still fails with `needs memory`.
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
- [ ] Task 12: Example, reference host, and hand-off to the parity tasks (was plan 211 Task 9)
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

### Part C — host adoption: the host-builder kit (ex-plan 212)

- [ ] Task 13: Phase review (read-only) (was plan 212 Task 1)
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

- [ ] Task 14: The package and its generated reference indexes (was plan 212 Task 2)
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
    - `packaging.test.ts` lists the package; the tarball contains `data/api.json` and `skills/prism-host-builder/SKILL.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new published package and bin.
    - Docs pages to create/edit:
      - `packages/hosts/host-builder/README.md`: package page structure. Install (as a dev dependency); bin usage; what it serves; cost (no model calls, no network); security (what it executes and where it writes)
      - `docs/index.md`: one link under "Host libraries"
      - `CHANGELOG.md`
    - `docs/index.md` update: yes — "`@arnilo/prism-host-builder`: Skill, MCP server, and installer that help coding agents build and change Prism hosts against the installed version."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 15: The `prism-host-builder` skill and the drift gate (was plan 212 Task 3)
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

- [ ] Task 16: The MCP server — lookup tools, docs resources, prompts (was plan 212 Task 4)
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

- [ ] Task 17: Checking the host's own code — inspect, manifest, conformance (was plan 212 Task 5)
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

- [ ] Task 18: The installer (was plan 212 Task 6)
  - Acceptance Criteria:
    - Functional:
      - `prism-host-builder install --target <t> [--mcp] [--root <dir>] [--force] [--dry-run]`. Targets come from Task 13 (d): `claude`, `codex`, `cursor`, `agents` (generic `.agents/skills`, which Prism's `contextFiles` also discovers), and `prism`.
      - It copies `skills/prism-host-builder/` into the target's project skill directory.
      - With `--mcp` and a JSON config target, it merges `{ prism: { command: "bunx", args: ["prism-host-builder", "mcp"] } }` under the target's server key, preserving every other key and the file's formatting style (2-space JSON). For a non-JSON target it prints the exact snippet and the file it belongs in, and writes nothing.
      - For `prism`, it prints the `skills.dirs` and `@arnilo/prism-mcp` config a Prism builder agent needs.
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

- [ ] Task 19: A Prism agent as the builder — example and walkthrough (was plan 212 Task 7)
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

- [ ] Task 20: Builder evaluation and claims (owner gate, paid) (was plan 212 Task 8)
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

### Part D — prompt-cache parity with pi (ex-plan 184)

- [ ] Task 21: Reference harness check: pi headless (read-only) (was plan 184 Task 1)
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

- [ ] Task 22: Wire-level prefix stability (was plan 184 Task 2)
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

- [ ] Task 23: The parity runner (was plan 184 Task 3)
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

- [ ] Task 24: The parity gate and the first run (was plan 184 Task 4)
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

### Part E — surface reduction and shape freeze (ex-plan 185)

- [ ] Task 25: Entry check against plan 179's review (read-only) (was plan 185 Task 1)
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

- [ ] Task 26: Reduce the root surface (was plan 185 Task 2)
  - Acceptance Criteria:
    - Functional: Apply plan 179 Task 1 (c)'s table:
      - `artifacts.ts` exports move to a new subpath `@arnilo/prism/artifacts` (plan 179 Task 1 (c): four consumers — `tools-work`, `tools-coding`, `tools-web`, `evals`);
      - network plumbing moves to `@arnilo/prism/net`: `pinnedFetch`, `requestPinned`, `resolvePinnedAddress`, `defaultResolver`, `raceAbort`, `boundResponse`, `isLoopbackAddress`, `isLoopbackHostname`, `normalizeHostname`, `PinnedFetchOptions` (the root keeps `assertSsrfAllowedUrl`, which hosts call directly, unless plan 179 Task 1 finds otherwise). Callers include `packages/tools/web/src/native/fetch.ts` (added by plan 193 Task 2), which imports `assertSsrfAllowedUrl`, `defaultResolver`, `requestPinned` and `resolvePinnedAddress` from the root; after this task it takes the last three from `@arnilo/prism/net` and keeps `assertSsrfAllowedUrl` at the root;
      - zero-caller exports are removed from the root: `MODEL_FAMILY_TOKENS`, `ModelFamilyTokens`, `resolveModelFamily` (if unused), the `EventSubscriber` and `RunLimitTracker` classes as values (their types stay exported where public signatures use them);
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
      - callers from plan 179 Task 1 (c) in `packages/tools/{work,openapi,web}`, `packages/integrations/mcp`, `packages/memory/rag`, `packages/policy/governance`, `packages/hosts/evals`, `packages/hosts/remote`, `apps/prism-agent`, `examples/` — plus `packages/tools/web/src/native/fetch.ts` explicitly (plan 193 Task 2's new caller of `defaultResolver`/`requestPinned`/`resolvePinnedAddress`/`assertSsrfAllowedUrl`), so the sweep cannot miss the file that did not exist when plan 179 ran.
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/kernel-constraints.test.ts` (import boundary).
      - `scripts/compat-baseline/arnilo__prism.txt` and each touched package's baseline: regenerated; the note lists removals attributed to this plan.
      - `docs/net.md` (new API page) or a section in `docs/host-security.md` (the review picks; a new page needs its `docs/index.md` link and the `apiPages` entry in `src/__tests__/docs.test.ts`), `docs/migrate-to-0.13.md`, `CHANGELOG.md`.
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
      - `docs/net.md` (new, API page structure) or `docs/host-security.md` section.
      - `docs/migrate-to-0.13.md`: moved imports table.
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes if `docs/net.md` is created — one-sentence entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 27: Retire migration-era shapes (was plan 185 Task 3)
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
      - the current six provider packages `packages/providers/{hyper,opencode-go,typesafe,laya,liquid,openrouter}` and their tests (Task 25 refreshes plan 179's now-retired 36-file inventory); explicitly `packages/providers/openrouter/src/{index,provider,models}.ts` and `src/__tests__/`; `packages/credentials/keyring/src/{vault,file-store,encrypted-store}.ts`; `packages/hosts/channels/src/{telegram,signal,secret-ref}.ts` and tests.
      - `src/input.ts`, `src/contracts-protocol.ts`, `src/contracts-core/content.ts`, `src/contracts-core/agent.ts`, `src/agent-session/session/assemble.ts` and affected tests.
      - `src/__tests__/public-export-contract.test.ts`; all affected `scripts/compat-baseline/*.txt` regenerated; removals listed in the note.
      - `docs/provider-kit.md`, `docs/credentials-and-redaction.md`, `docs/migrate-to-0.13.md`, `packages/hosts/channels/README.md`, `CHANGELOG.md`.
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

- [ ] Task 28: Freeze the shape of the surface (was plan 185 Task 4)
  - Acceptance Criteria:
    - Functional: `extractDeclaredSurface` records, per exported name, the full normalized declaration: interface and class bodies (members sorted, whitespace collapsed, comments stripped), type alias right-hand sides, function overload signatures, and enum members. A re-exported name resolves to its declaration in the package's declaration graph instead of recording the `export … from` statement.
    - Functional: The gate reports, per name, `removed`, `changed` (with a unified diff of the normalized text), and `added`. Changes that are additive by rule are classified `compatible` and do not fail: a new optional interface member, a new union member on a type the kernel only produces (listed in a `producerOnlyTypes` table in `scripts/release-gates.mjs`: `AgentEventPayload`, `HostUiRequest`, `AgentFinishReason`, …), a new overload. Everything else fails unless `--allow-break` and a migration note.
    - Functional: Baselines for the kernel and every package are regenerated in the new format with `bun scripts/release.mjs gate --update-baseline`; the note records that every diff line is format-only (no surface change). Explicitly include `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt`, resolving its factory/discovery option types to their full declarations after Task 27's `SecretSource` migration. The regeneration starts from the post-plan-189 baselines (Task 25 (e)) plus subsequently landed provider baselines, so the note also confirms that no name deleted by plan 189 (`repo_list`, `repo_search`, `git_branch`, `git_apply`, `git_worktree`, `fuzzyFindText`, `normalizeForFuzzyMatch`, the review exports, `serializeToolResultJson`) reappears, and that `serializeToolResultText` and `OMITTED_TOOL_RESULT_IMAGE_NOTE` are recorded.
    - Performance: The gate's declaration emit runs once per package as today; record total gate time before and after in the note (budget: ≤ +20%).
    - Code Quality: The normalizer is a pure function with unit tests; no TypeScript compiler API beyond what `declarationDir` already uses (plan 179 Task 1 confirms; using `typescript`'s printer is allowed if the emit already loads it).
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
      - `scripts/release-gates.mjs`, `scripts/release-gate.test.mjs`.
      - `scripts/compat-baseline/*.txt` (all, regenerated), explicitly `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt`.
      - `docs/release.md`: compat gate rules; `CHANGELOG.md`.
    - References:
      - review finding "The freeze test checks names only, not shapes" (2026-10-15).
  - Test Cases to Write:
    - `compat_detects_member_change`: removing `AgentConfig.disable` in a fixture fails the gate.
    - `compat_detects_type_alias_change`: narrowing `ToolCapabilityKind` fails.
    - `compat_allows_optional_member_add`: adding an optional field passes as `compatible`.
    - `compat_allows_producer_union_growth`: a new `AgentEventPayload` member passes.
    - `compat_resolves_reexports`: a re-exported interface's body is recorded.
    - `normalizer_is_stable`: comments and member order do not change the output.
    - `compat_coding_surface_has_no_plan189_removals`: the `@arnilo/prism-tools-coding` baseline contains none of Task 25 (e)'s removed names and records `shell_output`, `diagnostics`, `compileGlob`, `generateChangedLinePreview`, and `createBackgroundProcesses`; the kernel baseline records `serializeToolResultText` and `OMITTED_TOOL_RESULT_IMAGE_NOTE` and no `serializeToolResultJson`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling.
    - Docs pages to create/edit:
      - `docs/release.md`: compat gate section.
      - `CHANGELOG.md`: tooling entry.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 29: Compatibility promise and forward-compatibility rules (was plan 185 Task 5)
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
    - References:
      - review finding "Closed lists that hosts implement or switch on" (2026-10-15).
  - Test Cases to Write:
    - `unknown_entry_kind_round_trips` (conformance, all stores).
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

### Part F — live release acceptance (ex-plan 186)

- [ ] Task 30: The release acceptance methodology (was plan 186 Task 1)
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
      - `docs/release.md`: link the acceptance section from the release checklist.
      - `CHANGELOG.md`.
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

- [ ] Task 31: Live pre-flight check (was plan 186 Task 2)
  - Acceptance Criteria:
    - Functional: `scripts/live-preflight.mjs --suite <id-or-prefix>` reads every matching row's `requires`/`requiresAny` from `scripts/live-matrix.json`. It prints one row per check:
      - the env file resolved from `PRISM_LIVE_ENV_FILE` (or the manifest default) exists, is a regular file, and has mode `0600` or stricter;
      - the env file is outside the repository, or inside it and ignored by git (`git check-ignore`);
      - each required variable is present and non-empty (reported by name only);
      - no required variable's value appears in `git grep` over tracked files (a committed key fails);
      - each required binary is on `PATH` (`pi` for `release/cache-parity`), and `pi auth` reports the `hyper` and `opencode-go` providers ready, without printing credentials;
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
      - `docs/live-testing.md`: preflight reference (from Task 30's section).
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

- [ ] Task 32: The provider-agnostic SDK journey (was plan 186 Task 3)
  - Acceptance Criteria:
    - Functional: `apps/prism-agent/src/__tests__/live-provider-journey.test.ts` skips with a reason unless all of these are set: `PRISM_LIVE_PROVIDER_TESTS=1`, `PRISM_LIVE_RELEASE_JOURNEY=1`, `PRISM_LIVE_JOURNEY_PROVIDER` (`hyper` | `opencode-go`), and that provider's key. The fixture maps the provider name to its package instance (`hyper({ apiKey: "env:HYPER_API_KEY" })` or `opencodeGo({ apiKey: "env:OPENCODE_GO_API_KEY" })`) and its model variable. Nothing else in the suite names a provider. Agents are built only through `createAgent` and first-party packages, in a temp git repository, with these scenarios:
      1. **Stream contract.** One text run: event order `run.started → turn.started → message.delta* → message.completed → turn.completed → run.completed`; usage reported (`usage.estimated !== true`) and following the inclusive usage rule (plan 182 Task 4: `cacheReadTokens + cacheWriteTokens ≤ inputTokens`).
      2. **Tool loop.** `toolsCoding({ root })` + `approvalPackage({ mode: "ask", rules: [{ tool: "read" }] })` (a static allow for `read`); the model is told to read `README.md` and quote its first line; the transcript contains the line and a `tool.completed { status: "finished" }`. The second provider request carries the replayed thinking (plan 182 Tasks 6–7) and is accepted.
      3. **Approval suspend and resume across processes.** `sqliteStore({ path })` + the same approval config, so `write` asks; no host UI → `run.suspended`; a second `bun` subprocess opens `agent.session({ id })` over the same database and resumes `allow_once`; the file exists with the requested content.
      4. **Gate integrity, live.** In the same setup, resume with `modifiedArguments` pointing outside the root → `tool.completed { status: "blocked" }`, no file written (plan 177 Task 3).
      5. **Rewrite re-gate, live.** A test package rewrites the model's `write` path outside the root → denied by the coding hard-deny (plan 177 Task 2).
      6. **Ownership isolation.** One agent, two sessions under `{ userId: "a" }` and `{ userId: "b" }`; B's run on A's session id → `SessionNotFoundError`, and A's transcript text never appears in any of B's events (plan 177 Task 4).
      7. **Limits.** `limits: { maxTurns: 1 }` on a prompt that needs a tool → clean stop with `stopReason: "turn_limit"`; a token budget breach → `run.failed` with `limit`.
      8. **Compaction.** `memory-compaction` with a low threshold over a three-turn session → `compaction.completed` with a summary produced by the live model through `prism.models.client`, and the next turn still answers a question about turn one.
      9. **Remote host, two principals.** `serveAgent` on loopback WebSocket with an `authenticate` that maps two tokens to two principals; principal B cannot open A's session and receives none of A's approval requests (plan 178 Task 2).
      10. **Abort.** `session.abort()` during a streaming turn → `run.failed` with an abort code within 5 s, and the session accepts the next run.
      Scenario 11 of the superseded plan (memory across sessions, plan 188.11 Task 7) is **dropped by owner decision 2026-11-04**: the memory packages are experimental in 0.13.0, so no live release row depends on them. The offline `apps/prism-agent/src/scenarios/conversational-memory.ts` stays in `bun run test`. The live two-principal memory leg returns with the memory track (plan 210 Task 9).
    - Functional: Leak scan: after every scenario, `assertNoSecretLeak` from `@arnilo/prism/testing` runs over every event, `agent.inspect()`, every SQLite row (`SELECT *` of every table), the remote wire frames, subprocess stdout/stderr, and thrown error messages, with that provider's key as the needle.
    - Functional: API level: the suite asserts each loaded package reports `requires.api === KERNEL_API_LEVEL` in `agent.inspect()` (plan 179 Task 2).
    - Functional: OpenCode Go's required session correlation is satisfied by the kernel default (`applyDefaultProviderRequestOptions` stamps `sessionId`); the journey does not set it by hand, which proves the default works.
    - Performance: Budget per provider: at most 36 provider requests and 80k input tokens per full run, enforced by `limits` on every run plus a counting `model.call` hook that fails the suite on overrun; per-scenario timeout 120 s; each provider's suite ≤ 15 min. The `apps/prism-agent` README and the manifest rows state the budget.
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
      - `apps/prism-agent/package.json`: `devDependencies` for `@arnilo/prism-provider-hyper` and `@arnilo/prism-provider-opencode-go` (`workspace:*`).
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

- [ ] Task 33: Register the suites and wire them into the release (was plan 186 Task 4)
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` gains two rows. `release/journey-hyper`: `package: "@arnilo/prism-agent"`, `status: "active"`, `cwd: "apps/prism-agent"`, `command: "PRISM_LIVE_JOURNEY_PROVIDER=hyper bun test --timeout=0 src/__tests__/live-provider-journey.test.ts"`, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_RELEASE_JOURNEY", "HYPER_API_KEY"]`, `model: [{ env: "PRISM_LIVE_HYPER_JOURNEY_MODEL", default: "deepseek-v4-pro", wired: true }]`, `scope`, and `cost` from Task 32. `release/journey-opencode-go` is the same with `OPENCODE_GO_API_KEY` and `PRISM_LIVE_OPENCODE_GO_JOURNEY_MODEL`; its default model comes from plan 183 Task 1 (e).
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
      - `scripts/live-matrix.json`, `docs/live-testing.md` (generated table), `scripts/e2e-coverage.json`, `plans/187-Phase-11-Part-N-Retired-Name-Sweep-Publish-And-Deprecation.md` (Task 31 pre-flight, if not already edited).
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

- [ ] Task 34: First acceptance run and evidence (owner provides the keys) (was plan 186 Task 5)
  - Acceptance Criteria:
    - Functional: Prerequisites: Tasks 1–33 of this plan are complete; the owner confirms that `~/.config/prism/live.env` holds the seven keys (`HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`, `LIQUID_API_KEY`, `OPENROUTER_API_KEY`, `KILO_API_KEY`, `LITELLM_API_KEY`) with spend caps, confirms authorization for the selected OpenRouter and Kilo models (paid cache remains separately gated), and approves the Kilo device-login verification URL; `scripts/litellm/up.mjs` runs the local LiteLLM proxy; `laya-serve` and `llama-server` (`d1-3B`) are running on the dev machine; `pi` is installed with Hyper and OpenCode Go configured. The executor then:
      1. runs `bun scripts/live-preflight.mjs --suite providers/ --probe` and `bun scripts/live-preflight.mjs --suite release/ --probe`, including the OpenRouter, Kilo, and LiteLLM discovery/key checks before their strict T1 runs;
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
      bun scripts/live-preflight.mjs --suite release/ --probe
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

### Part G — retired-name sweep, CI and registry cleanup, trusted publishing, and publish (ex-plan 187, plus Tasks 36–38 added 2026-11-04)

- [ ] Task 35: The final retired-name sweep and the post-train references (was plan 187 Task 1)
  - Acceptance Criteria:
    - Functional: `scripts/retired-names.json` lists every name the train retired: the export names and subpaths from the 0.12.1 → 0.13.0 baseline diff, the retired package names, the retired error codes and classes recorded in plans 143–174, and the CLI flags. `scripts/retired-names.test.mjs` greps `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `node_modules/`, `plans/`, `docs/history/`, `docs/_evidence/`, `CHANGELOG.md`, `docs/migrate-to-0.13.md`, `scripts/retired-names.json`, `scripts/deprecations-0.13.json`, and the compat baselines' history) and fails on any hit. It runs in `bun run test`.
    - Functional: The planning and execution skill references describe the post-0.13 world:
      - `.agents/skills/create-plan/references/prism.md` §1 drops the `apps/prism-code` lab row in favor of the reference host (`apps/prism-agent`), and §5 drops assumptions the train retired
      - `prism-wiki.md`'s "Where docs go during the 0.13.0 train" becomes "Where docs go": kernel pages in `/docs` (written with the API), package READMEs, and `CHANGELOG.md`
      - `.agents/skills/prism-execution/references/release.md` "Today" describes independent versioning after 0.13.0

      This resolves plan 174 Task 1 (j).
    - Functional: `roadmap.md` and `PRODUCT.md` are consistent with the published state. The roadmap's "Shipped baseline" line names 0.13.0. `roadmap.md` stays the target document: this task updates facts and adds no phases.
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

- [ ] Task 36: Release pipeline, release gates and CI tests — review and cleanup (added 2026-11-04, owner)
  - Acceptance Criteria:
    - Input from Task 1 (b), 2026-11-05: `release.yml:6,148,205,265` each enumerate release tags up to `v0.12.1`, and a `v0.13.0` ref skips `codeql-release` and `publish`. Replace the enumerations with one pattern or one computed output, and lock it in `scripts/ci-integrity.test.mjs` with a case that a `v0.13.0` ref selects the intended jobs.
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
    - Functional: New `scripts/ci-integrity.test.mjs`, run in `bun run test`, checks:
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
      timeout 120 bun test --timeout=0 scripts/ci-integrity.test.mjs
      ```
    - Files to Create/Edit:
      - `.github/workflows/*.yml` (per verdict)
      - `scripts/ci-integrity.test.mjs` (new); `scripts/run-all-tests.mjs` (if wiring changes); removed `scripts/phase*` and `scripts/*.test.mjs` files (per verdict)
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

- [ ] Task 37: Registry cleanup — delete the deprecated `@arnilo` packages (owner-run, irreversible; added 2026-11-04, owner)
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
        - a scope listing the owner supplies (`npm access list packages @arnilo --json`, run by the owner). Registry search hides fully deprecated packages (npm docs, "Unpublish policy", read 2026-11-04), so search alone is incomplete.
    - Functional: **Classification**, starting from the 2026-11-04 anonymous inventory:
      - (a) **Fully deprecated, delete.** 20 names have every version deprecated: `@arnilo/prism-all`, `-evals`, `-workflows`, `-model-router`, and the 16 `@arnilo/prism-provider-{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,deepseek,google,kimi,neuralwatt,ollama,openai,openrouter,vertex,xai,zai}`. `@arnilo/prism-code` has 42 of 44 versions deprecated, so its last two are deprecated or deleted with it.
      - (b) **On the 0.13 deprecation list but not deprecated yet.**
        - Whole-package names: `@arnilo/prism-agent-sdk`, `-acp-agent`, `-providers`, `-coding-tools`, `-web-tools`, `-memory`, `-core`, `-work`, `-hooks`. Default: delete.
        - Reused names: `@arnilo/prism-mcp`, `-ag-ui`, `-channels`. Their `<0.13.0` line is deleted.
        - The owner confirms each name.
      - (c) **On no list.** `@arnilo/prism-antigravity-agent` (0.4.0), `@arnilo/prism-office` (0.7.0), and `@arnilo/liveframe` (0.2.3; not a Prism package). Default: keep. The owner decides each one.
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

- [ ] Task 38: Trusted publishing — replace the npm token with OIDC (added 2026-11-04, owner)
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
      - `scripts/ci-integrity.test.mjs` (the no-token assertion)
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

- [ ] Task 39: Publish 0.13.0, apply the deprecations, switch to independent versioning, and record Phase 11 Done (owner-gated) (was plan 187 Task 2)
  - Acceptance Criteria:
    - Prerequisite (recorded 2026-10-15, after plan 175 Task 8; satisfied — plans 176 and 177 are complete): plans 176 (Phase 11 Part C — tool-gate integrity, narrow-only ownership, fail-closed dispose) and 177 (Phase 11 Part D — host isolation and security hardening) both **block this task**. They reopen the surface frozen by plan 174 Task 9 and change kernel and host-library contracts, so they must complete and regenerate the compat baselines before the 0.13.0 tag is pushed. The version cut itself (plan 175 Task 7) stands.
    - Inputs from Task 1 (2026-11-05): (1) the `v0.13.0` ref skips `codeql-release` and `publish` until Task 36 fixes the tag lists, so the dry run must show both jobs running for that ref; (2) `scripts/post-publish-smoke.mjs:31,88-89,161` install and import the memory packages at `--version 0.13.0`, so the smoke's memory legs move to an `@experimental` spec; (3) whether the registry sets `latest` on a first `--tag experimental` publish is unverified, so record each memory package's resulting dist-tags (anonymous registry GET) in the note.
    - Functional: Pre-flight, on a clean tree at the release commit:
      - `bun run sdk:ready` exits 0
      - `PRISM_TEST_POSTGRES_URL=… bun run release:gate` exits 0
      - `bun scripts/release.mjs pack --destination release-artifacts` packs every package, and the task note records the package list
      - `bun scripts/registry-deprecate.mjs --generate && --dry-run` prints the planned deprecations
      - plans 176–183, 188–207, 213 and 214 are `complete` or `closed` in `plans/README.md`; plan 208 Task 8 (portable `wiki_ingest` schema) has landed, and 208 Task 5 may still be running from its pinned worktree; plans 184–187, 211 and 212 are `superseded by 215`; plans 209–210 are the post-0.13.0 memory track; Tasks 1–38 of this plan are checked
      - the publish path for the `v0.13.0` tag is the one Task 1 (b) recorded: `.github/workflows/release.yml`'s publish step either gains `v0.13.0` in its lockstep branch or the note shows why the independent path publishes the same set; `release-gate.test.mjs` pins the choice
      - `bun scripts/release.mjs pack` packs the five experimental packages at `0.13.0-experimental.0` and `publishArgs` gives them `--tag experimental` (dry run output recorded)
      - `bun scripts/live-preflight.mjs --suite release/ --probe` passes, then the strict runs of `providers/` (all nine shipped provider packages, ten rows with `liquid-local`; amended 2026-10-17, 2026-10-25 for `openrouter` by plan 203, 2026-10-28 for `openai-codex` by plan 204, 2026-10-31 for `kilo` by plan 213, and 2026-10-31 for `litellm` by plan 214; the in-tree `providers/commandcode` row runs with plan 205 Task 5 and is not a 0.13.0 gate), `release/journey-` (Hyper and OpenCode Go), and `release/cache-parity` pass on the release commit (plan 186's methodology), and `docs/_evidence/live-release-acceptance-0.13.0.md` records them; the owner signs it in this task's note (amended 2026-10-16 by plans 182–186)

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
    - Functional: `plans/README.md` marks plans 174 and 175 complete. The roadmap header records 0.13.0 as shipped (Task 35).
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
  - `bun scripts/live-preflight.mjs --suite providers/ --probe` and `bun scripts/live-preflight.mjs --suite release/ --probe`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=release/journey- bun run test:live`
  - `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live`
- `timeout 300 bun test --timeout=0 scripts/ci-integrity.test.mjs scripts/registry-cleanup.test.mjs`
- After publish: `bun scripts/post-publish-smoke.mjs --version 0.13.0` (including the experimental leg) and `bun scripts/registry-deprecate.mjs --dry-run` (nothing left to apply)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
