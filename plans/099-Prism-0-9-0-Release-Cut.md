# 0.9.0 Release Cut

Release: 0.9.0 (this plan). Ships plans 086–098 plus plan 100 (live stream terminal semantics, which delivers this line's `budget_exhausted` attribution to live subscribers). Plan [101](101-Cache-Stability-Follow-Ups.md) is a post-cut follow-up to 088 and is deliberately **not** part of this cut. Precedent: plan 085's 0.8.0 cut.

## Objectives
- Cut @arnilo/prism 0.9.0 with all 086–098 features behind their documented options, defaults preserving 0.8 behavior.
- Green `release:gate` with a deliberately regenerated compatibility baseline (plans 086–098 add public symbols; no removals are planned — any that appear must be listed here first).
- Migration notes, CHANGELOG, docs index consistent before publish.

## Expected Outcome
- `npm publish` artifacts green; hosts (clay 0.7→0.9 pin, synapta 0.7→0.9 pin) can adopt without behavior change until they opt into each new surface.
- `docs/migrate-to-0.9.md` covers every new option/event in one page.

## Tasks

- [x] Task 0: Pre-release budget rebaseline (export ceiling, tarball diet, non-null assertions)
  - Acceptance Criteria:
    - Functional: `scripts/budget-gate.test.mjs` is green before the version bump. The three regressed ceilings are either reduced or rebaselined with the measured value and a dated `$comment` reason naming the plan(s) that caused the growth: `@arnilo/prism` export surface (measured 1445 vs ceiling 1400, +45), root artifact diet (packedBytes 1412699 vs baseline 1320080, unpackedBytes 4643130 vs baseline 4356107, fileCount 533 vs baseline 505 — all over the +5% limit), and non-null assertions (`src` 551 vs 537, `examples` 33 vs 29, total 2205 vs ceiling 2176). Growth is first checked for dead exports (`scripts/dead-exports.mjs`, `node scripts/sweep-unused.mjs`) and removable tarball weight; anything left standing is rebaselined in one commit, not raised per-plan as work lands.
    - Performance: `budget-gate` runtime unchanged; `startup.importMsCeiling` and the benchmark rows are only rebaselined if measured over the ceiling on CI hardware (no local-machine raise).
    - Code Quality: every raised ceiling carries the measured number in its reason string; `src/__tests__/public-export-contract.test.ts` `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` already list the 086–098 + 100 additions, so the rebaseline commit only touches numbers, not the export contract; `docs/_evidence/phase54-package-map.md` regenerated so the recorded export count matches the gate.
    - Security: tarball diet never moves tests or scripts into the published tarballs (plan 026 rule); no secrets in the regenerated evidence.
  - Notes (executed 2026-09-19):
    - Dead exports: `node scripts/dead-exports.mjs` reported 0 actionable candidates (11 zero-ref exports stay keep-classified) and `node scripts/sweep-unused.mjs` found only 5 pre-existing test-local diagnostics, so no export was deleted to offset the growth.
    - Tarball diet checked before rebaselining: `docs/history/**` (~513 KiB of the 4.6 MiB unpacked pack, 19 files) and `CHANGELOG.md` (170 KiB) are the only large removables, and both are deliberate shipped traceability — dropping the archive needs link surgery across the 10 docs pages that link into it plus the `docs/index.md` archive entry, so it is recorded as a follow-up instead of done in this cut. No test, script, plan, or source file entered the pack; `docs/_evidence/**` stays excluded.
    - Measured at rebaseline: root **1414295 packed / 4647338 unpacked / 533 files** (the plan's 1412699/4643130 predate the plan-098 doc edits and this task's own `docs/release-and-install.md` bullet, which is itself part of the final measurement); exports **`@arnilo/prism` 1445 / `@arnilo/prism-memory` 892** (the plan named only the root +45 — memory was also over, +21 from plan 098 shared work scope); non-null assertions **src 551, examples 33, `packages/memory/src` 221** (also over, +12 from plan 098's `shared-scopes.test.ts`), total 2217 — `packages/prism-core/src` measured 414 against its 435 allowance, so that row stayed.
    - `docs/_evidence/phase54-package-map.md` regenerated with `node scripts/package-truth.mjs --emit-docs`; its section 9 now carries the gate's own count in a **Budget-Gated Exports (src)** column beside the dist/compat-baseline column, so the recorded number equals `scripts/budgets.json` by construction (generator change in `scripts/phase54-package-map.mjs`).
    - `startup.importMsCeiling` and the benchmark medians were not touched: the startup leg passed off-load on this machine, so no local-machine raise.
    - Plan 100 Task 1 was still unchecked at rebaseline time, so its documented `@arnilo/prism` +1 is not in the measured 1445; that task must keep its addition inside the new ceiling or re-run this rebaseline when it lands (called out in the budgets.json reason). `src/__tests__/public-export-contract.test.ts` already lists the 086–098 additions and passes unchanged — no export-contract edit in the rebaseline commit.
    - Checks: `node --test scripts/budget-gate.test.mjs` 19/19 green (was 3 failing legs); `node --test scripts/truth-current.test.mjs scripts/phase54-package-map.test.mjs` 17/17; `dist/__tests__/public-export-contract.test.js` + `dist/__tests__/packaging.test.js` 293/293; `dist/__tests__/docs.test.js` 155/155.
  - Approach:
    - Documentation Reviewed: `scripts/budgets.json` dated-`$comment` rebaseline convention, `scripts/budget-gate.test.mjs` / `scripts/budget-gates.mjs` (`assertAll` naming the delta), plan 058 export-ceiling design, plan 066/061/055 rebaseline precedents, `docs/release-and-install.md` budget section.
    - Options Considered: (a) rebaseline once after 086–098 + 100 stop moving the numbers ← chosen; (b) raise each ceiling as its plan lands — rejected, it absorbs unreviewed exports and hides dead ones; (c) shrink the root tarball by packing tests/scripts — forbidden by plan 026; (d) leave the gate red into the cut — rejected, Task 1 cannot be green with a red gate.
    - Chosen Approach: measure once, delete dead exports and dead tarball weight where cheap, then rebaseline the rest with reasons in a single evidence commit ahead of the bump.
    - API Notes and Examples:
      ```bash
      node --test scripts/budget-gate.test.mjs   # names every delta
      node scripts/dead-exports.mjs              # candidates to delete before raising a ceiling
      npm pack --dry-run --json                  # root tarball packed/unpacked/fileCount
      ```
    - Files to Create/Edit: `scripts/budgets.json` (ceilings + dated reasons); `docs/_evidence/phase54-package-map.md` (regenerated); `docs/release-and-install.md` (budget paragraphs name the 0.9.0 baselines instead of the plan 066 ones).
    - References: plan 058 (export ceilings), plan 026 (tarball rule), plan 096 Compromises Made (why the rebaseline was deferred to the cut).
  - Test Cases to Write:
    - `node --test scripts/budget-gate.test.mjs` exits 0 (export, artifact-diet, non-null-assertion legs).
    - `docs/_evidence/phase54-package-map.md` regenerated from the live tree and its export count equals the gate's measured value.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (budgets and evidence only).
    - Docs pages to create/edit: `docs/release-and-install.md` (export-count and offline-test budget paragraphs re-dated to the 0.9.0 baselines).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 1: Version bump + workspace-wide type/test/lint green
  - Acceptance Criteria:
    - Functional: All workspace packages bumped to 0.9.0 per release script conventions; full test suite, lint, typecheck pass.
    - Performance: CI budget unchanged.
    - Code Quality: No `skip` flags introduced by the cut.
    - Security: `npm audit` clean or explained in release notes.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, plan 085 cut task.
    - Options Considered: n/a.
    - Chosen Approach: Standard release plumbing.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump 0.9.0
      ```
    - Files to Create/Edit: package.json versions via script.
    - References: `docs/release-and-install.md`.
  - Test Cases to Write:
    - Existing suites (cut adds none beyond regression runs).
  - Notes (executed 2026-09-19):
    - Bump: `node scripts/release.mjs bump --from 0.8.0 --to 0.9.0 --ranges caret` rewrote all 11 manifests, rewrote the 10 internal dependency ranges to `^0.9.0`, and regenerated `package-lock.json`. The three hand-claim surfaces the version-literal gate checks were then moved by hand: `src/index.ts` `version` constant, `docs/index.md` banner + `current **0.9.0**` bullet, and `.github/workflows/release.yml` (tag list, both `if:` tag conditions, the publish-step shell tag test).
    - Deviation from the task's "docs pages to create/edit: none": `docs/release-and-install.md` is a claim surface — the plan 025–029/085 freeze tests assert the live root version as `@arnilo/prism@^<version>` and `arnilo-prism-<version>.tgz` in it, so its current-line paragraph, lockstep paragraph, tarball-filename list, Node row, and required-peer bullet now read 0.9.0. `docs/index.md`, `README.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, and `docs/_evidence/phase54-package-map.md` were regenerated with `node scripts/package-truth.mjs --emit-docs`.
    - The 085 release-contract test was refactored version-agnostic (`assert.equal(version, "0.8.0")` dropped; banner split now uses the live version; the messaging-channels blurb is asserted on the page, not on the live current-line slice) so the 0.9.0 cut keeps the gate instead of bypassing it — the same treatment `071_release_0_6_0_contract_is_documented` got at 0.7.0/0.8.0. `docs/index.md` current-line bullets still describe the 0.8.0 line under the 0.9.0 banner; Task 3 rewrites that section (the banner is gate-enforced, the blurbs are not).
    - Two pre-existing reds blocked the task's green acceptance and were fixed:
      - `packages/memory/src/rag/__tests__/local-reranker.test.ts` hand-patched the global fetch, violating the network-free guard (plan 089 shipped it; plan 094 had already recorded it as a pre-existing failure). Replaced with `t.mock.method(globalThis, "fetch", …)`, which Node restores automatically — the guard's rule and plan 009's earlier debt fix both point the same way.
      - `npm run format:check` was red on 11 files from plans 086–098 (biome format), and `sdk:ready` — the CI verify leg — runs it, so the cut could not have published. Formatted those 11 (cosmetic only: line joining/wrapping, no semantic change, verified file by file) and deleted `packages/prism-core/probe2.mjs`, an unreferenced scratch probe accidentally committed in the WIP commit `6413b0e3`.
    - Release evidence: `scripts/release-evidence.json` (gitignored) regenerated — release `0.9.0`, 43 surfaces, `blocked=true` locally, which is the documented state under plain `npm test`; Task 2's `release:gate` enforces zero blocked after the full `sdk:ready`.
    - Checks: `npm run typecheck` 0, `npm run lint` 0, `npm run format:check` 0, `npm audit` 0 vulnerabilities, `npm test` 6/6 stages (root suites 24.7s, gate 59.8s, workspace 42.8s). Budget gate green at **1414316 packed / 4647354 unpacked / 533 files** (baseline 1414295 / 4647338 / 533; +21 packed from the version-string and formatting churn, inside the +5% band, so no rebaseline). The workspace stage flaked once on the known `packages/memory/dist/wiki/__tests__/cli.test.js` IPC deserialization error (VENT 4×); the unchanged rerun passed.
  - Documentation/Wiki Assessment (executed): docs pages edited — `docs/index.md`, `docs/release-and-install.md`, `README.md`, `docs/provider-packages.md` (all generated blocks + the release-page version claims listed above); no new pages, so no index additions.

- [x] Task 2: Compatibility baseline regeneration + gate
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; `release:gate` green; diff reviewed so additions (attention trigger union, stop-reason/budget events, cache usage fields, toolNarrowing, estimation exports, guardrail packs, spawn lifetime options, checkpoint metadata/restore hooks, searchSessions, no-model turns, trajectory export, shared scopes, the terminal-event predicate from plan 100) are intentional; **any removals or signature breaks are listed in this task before regeneration** — planned: none.
    - Performance: Gate runtime within existing budget.
    - Code Quality: Baseline diff committed atomically with the version bump.
    - Security: Baseline contains no secrets (script guarantee, spot-checked).
  - Approach:
    - Documentation Reviewed: plan 083/084 lesson (baseline left unregenerated → gate red for every later plan); `scripts/compat-baseline/` current files.
    - Options Considered: Hand-edit baseline — forbidden; script-only regeneration.
    - Chosen Approach: Regenerate + human-reviewed diff.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline && npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (script-written).
    - References: plans 083/084 baseline incident notes.
  - Test Cases to Write:
    - `release:gate` exit 0.
  - Notes (executed 2026-09-19):
    - Pre-regeneration review (the acceptance's "list removals or signature breaks before regeneration"): **zero removals** in all 11 packages — every name in the checked-in baselines is still in the current dist surface (name-set comparison through the gate's own extractor), so nothing was regenerated away. Eight declaration-level changes, all additive/optional or the release identity itself:
      - `@arnilo/prism` `version` `"0.8.0"` → `"0.9.0"` — the cut's own literal.
      - `providerDone(usage?, stopReason?)` optional param (087); `resolveRunAttentionCompiler(…, runInputBudget?)` optional param (086).
      - `generateProviderTurn` / `generateWithRetry`: the `recordUsage` callback's return type widened `Promise<void>` → `Promise<Usage | undefined>` (091); `recordProviderUsage` gained `request?` and returns `Promise<Usage | undefined>`. The callback widening is the only change a host can feel at the type level (a hand-written `recordUsage` that returned `void` no longer satisfies the parameter type), so it is handed to Task 3's migration page.
      - `@arnilo/prism-memory`: `collectInvalidationIds(…, options?)` (089), `recallObservationalMemory(…, options?: RecallMemoryOptions)` (098).
    - Regeneration: throwaway `pgvector/pgvector:pg16` on 127.0.0.1:5432 (`docker run -d --name prism-099-pg -p 127.0.0.1:5432:5432 -e POSTGRES_USER=prism -e POSTGRES_PASSWORD=prism -e POSTGRES_DB=prism pgvector/pgvector:pg16`), then, exporting only `PRISM_TEST_POSTGRES_URL=postgres://prism:prism@127.0.0.1:5432/prism` (085's recipe):
      - `npm run test:postgres` → 579 tests, 575 pass, 0 fail, 20.6s; `scripts/postgres-evidence.json` (gitignored) `gitHead` = HEAD `08c792ba` — this-tree evidence, not a stale phase baseline.
      - `node scripts/release-skip-manifest.mjs` → 43 surfaces, `blocked: false`, postgres row `pass` (12 pass / 31 protected).
      - `node scripts/release.mjs gate --lockstep --version 0.9.0 --update-baseline` → `{ "version": "0.9.0", "updated": true, "packages": 11 }` in 5.6s. `--lockstep --version 0.9.0` is required: gate mode defaults to independent and `--independent` + `--version` are mutually exclusive (same invocation shape as 085 Task 7); without the postgres evidence above, `checkReleaseEvidence` fails closed first.
      - `npm run release:gate` → exit 0 in 5.5s. (A plain `npm run release:gate` after a bump fails on the blocked postgres surface until the recipe above is run; that failure is the gate working, not a regression.) Re-run after this task's baseline commit, at HEAD `85dbe0a3`: 575 postgres pass, `blocked: false`, exit 0 in 6.4s. The postgres surface is HEAD-keyed — every later commit re-blocks it until `npm run test:postgres` runs again at the new HEAD, which is why Task 4 has to repeat this recipe on the commit it publishes.
    - Post-regeneration diff: 3 of 63 files changed — `@arnilo/prism` +49 names (981 → 1030), `@arnilo/prism-memory` +60 (740 → 800), `@arnilo/prism-core` +10 (1281 → 1291); every other baseline is byte-identical. 119 added names, 0 removed, 124 replaced lines = 116 shared barrel re-export statements that gained a name + the 8 declarations above. The additions map to plans 086–098 (attention trigger union and compiler options, stop-reason/budget events, cache usage fields, `toolNarrowing`, usage-estimation exports, guardrail packs, spawn lifetime options, checkpoint metadata/restore hooks, `searchLinearSessions`, no-model turns, trajectory export, shared scopes plus deletion/repoint).
    - **Plan 100's terminal-event predicate is not in this baseline.** Plan 100 Task 1 is still unchecked, so `isTerminalAgentEventType` and its barrel line are absent; that plan's own file expects "its Task 2 baseline regeneration covers the new export", meaning this task's gate commands must be re-run when it lands (expected +1 root name, 0 removals) — otherwise `release:gate` goes red for it exactly as plans 083/084 left the baseline stale.
    - Gate fidelity found while reviewing (not fixed here): `collapse()` stores every signature truncated to 500 chars, so long barrel statements and long declarations (`recallObservationalMemory` is cut mid-parameter-list on both sides) are compared on their first 500 chars — a name inserted early in a long statement marks every name on that statement changed (124 "changed" for 8 real declaration changes), and an edit past the cap is invisible. `extractDeclaredSurface` also merges subpath entry points first-wins, so a name moving between `@arnilo/prism-web-tools` subpaths would not register. Removals stay exact because they are name-set based, so the property the gate exists for held.
    - Security: baselines are declaration text only; the three changed files have zero credential-shaped matches (`sk-…`, `Bearer`, `password`, `secret=`, `token=`, `api-key`).
  - Documentation/Wiki Assessment (executed): docs pages edited — none (gate mechanics). The only consumer-visible change in the diff (`recordUsage` callback return widening) is queued for Task 3's migration page. `docs/index.md` update: no.

- [x] Task 3: Migration page, CHANGELOG, docs index
  - Acceptance Criteria:
    - Functional: `docs/migrate-to-0.9.md` lists every new option/event with 3-line before/after snippets, defaults statement ("all 0.9.0 surfaces default off / default to 0.8 behavior"), and per-knob sizing lines from plans 086/093/094/095/098; `CHANGELOG.md` 0.9.0 section summarizes features (no narrative duplication inside API pages — history rule); `docs/index.md` entries reviewed: new pages added if any plan created one, descriptions current-contract one-sentence style.
    - Functional (behavior notes): the migration page records the two 0.9.0 behavior changes that are not opt-in surfaces — a limit death now delivers `run_limit_exceeded` → `budget_exhausted` → `error` to live subscribers (plan 100; hosts that stopped at the first breach record should keep reading), and `provider_turn_finished` carries `stopReason`/`budgets` (plan 087).
    - Performance: n/a.
    - Code Quality: Index grouped under live headings; no plan numbers or version narrative in API pages.
    - Security: Migration examples use no secrets.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (current-line vs history, index style)
      - plans 086–098 Documentation sections (the page list to reconcile)
      - `docs/migrate-to-0.8.md` as structural precedent.
    - Options Considered: Skip migration page (defaults unchanged) — rejected; hosts need one map of new surfaces.
    - Chosen Approach: One migration page + changelog + index reconciliation sweep.
    - API Notes and Examples:
      ```bash
      ls docs/migrate-to-0.9.md && grep -c "0.9" CHANGELOG.md
      ```
    - Files to Create/Edit:
      - `docs/migrate-to-0.9.md`: new.
      - `CHANGELOG.md`: 0.9.0 section.
      - `docs/index.md`: reconcile (additions only where new pages exist).
    - References: prism-wiki requirements file.
  - Test Cases to Write:
    - Docs link check (existing docs tooling) green.
  - Notes (executed 2026-09-19):
    - `docs/migrate-to-0.9.md` (new): opens with the lockstep statement and "nothing was removed — every new surface defaults to 0.8 behavior", then **four behavior deltas inside existing surfaces** (the acceptance's two plus the two a host feels without opting in): §1 limit deaths deliver `run_limit_exceeded` → `budget_exhausted` → `error` and only the outcome record is terminal, with the before/after subscribe loop and the `isTerminalAgentEventType` check (plan 100); §2 `provider_turn_finished` gained `stopReason`/`budgets`/`tools`/`cache` and `agent_finished` gained `finishReason`/`stopDetail` (087/088), for consumers that deep-equal metadata; §3 progressive disclosure is cache-stable (088), with the `runPrefixStabilityConformance({ minContinuity: 0.95 })` assertion; §4 `AgentConfig.usageEstimation` defaults to `"fallback"`, so a usage-less provider is charged a labeled estimate (091) with `usageEstimation: "off"` as the escape hatch. Then nine additive sections (086, 090, 092, 093, 094, 095, 096, 098, 089), each with the option names, a 3-line snippet, and the sizing line the acceptance asked for: 086 — one session-store write per fold (not per turn), folding default off, `durable: true` throws `AgentRunStateError` without a checkpoint store; 093 — child events 256/4096 per delegation, 32 KiB/256 KiB, 10/1000 per second (default/hard) and defaults `lifetime: "task"` / `report: "on-complete"` / no share; 094 — 4 KiB fixed metadata cap (redacted unconditionally, no `maxStateBytes` charge) and a 10 s per-hook default timeout (`DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`); 095 — index is 18.8% of transcript page bytes on the 100k-turn fixture, query p95 38 ms against the 100 ms ceiling, linear caps overridable only within their hard bounds; 098 — 1,024 principals / 256-character ids plus the existing 256 scopes / depth 8 / 4,096 binds / 512-character labels, one branch read and fold per participating branch per resolve. Closes with operator honesty (baseline `+119` / 0 removals, the `recordUsage` return-type change, budgets, HEAD-keyed Postgres evidence, version literals), six upgrade steps, and a rollback section listing the options to drop.
    - `CHANGELOG.md`: 0.9.0 section matching the 0.8.0 shape (banner with the eleven-package statement and predecessor, then Added 12 / Changed 6 / Fixed 3 / Security 4 bullets), every bullet pointing at its owning docs page and none at a plan file; the four behavior deltas carry the migration-page link. The lockstep bullet records the version surfaces the literal gate checks.
    - `docs/migration.md`: new `0.8.0 → 0.9.0` era section above the 0.7 line, with the lockstep/no-removal statement, the four checks a 0.8.0 host must make, and the additive list.
    - `docs/index.md`: reviewed and reconciled — the two pages this line created were already indexed by their plans ([Prefix stability conformance](prefix-stability-conformance.md) and [Scoped agent memory](scoped-agent-memory.md)), so the only edit is the release-section entry `Migrate 0.8 → 0.9` above the 0.7 entry; the top-of-page banner already reads 0.9.0 (updated in Task 1) and the migration guide remains reachable from the release section as that banner claims.
    - **Plan 097 (trajectory export) is 0/2 and unimplemented**, so the page and the changelog document plans 086–096, 098, and 100 only. Plan 099's own header says the cut "ships plans 086–098", which makes this a cut-scope decision rather than a documentation omission: either 097 lands before Task 4 publishes, or the scope sentence is amended and 0.9.0 ships without it. Recorded as a high-priority Further Action because publishing a cut with an unimplemented P2 plan contradicts the plan text, not the shipped docs (both are accurate about what exists).
    - Verification: `dist/__tests__/docs.test.js` 155 pass; `scripts/version-literal-gate.test.mjs`, `phase24-truth.test.mjs`, `live-doc-check.test.mjs`, `truth-current.test.mjs`, `phase54-package-map.test.mjs`, `packaging-current.test.mjs`, `plan-review-gate.test.mjs` 76 pass; full `npm test` run in this session (green).
    - Security: every snippet uses placeholders (`head`, `hostStatus`, `store.list`) and no credential-shaped value; the page carries no plan numbers and no version narrative in the owning API pages — the release narrative lives in the migration page and changelog, which is what the history rule requires.
  - Documentation/Wiki Assessment (executed): pages created — `docs/migrate-to-0.9.md`. Pages edited — `CHANGELOG.md`, `docs/migration.md`, `docs/index.md` (release-section entry). `docs/index.md` update: yes. Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4: Publish + post-publish verification
  - Acceptance Criteria:
    - Functional: Packages published; `npm view @arnilo/prism version` → 0.9.0; smoke install in a temp project resolving imports for the headline exports (attention trigger union, searchSessions, guardrailPacks).
    - Performance: n/a.
    - Code Quality: Tag `v0.9.0` cut after publish verification.
    - Security: Publish via existing credential path; no tokens in logs.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`.
    - Options Considered: n/a.
    - Chosen Approach: Standard publish + smoke.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs publish && npm view @arnilo/prism version
      ```
    - Files to Create/Edit: none.
    - References: prior releases.
  - Test Cases to Write:
    - Smoke: temp project imports resolve, `createSession` with one new option works.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

## Compromises Made
- The rebaseline commit carries one non-numeric change: `scripts/phase54-package-map.mjs` now renders the gate's `measureExportCounts` value as a Budget-Gated Exports column so the evidence doc and `scripts/budgets.json` cannot disagree. Without it the task's "recorded export count equals the gate's measured value" case was unverifiable — the pre-existing column counts the built dist surface, a different metric (root 1030 vs the gate's 1445).
- Executed measurements differ from the plan's recorded ones (packed 1414294 not 1412699, unpacked 4647338 not 4643130), and two over-budget rows the task did not name were raised: `@arnilo/prism-memory` exports 871 → 892 and `packages/memory/src` non-null assertions 209 → 221, both from plan 098. The plan text keeps the pre-execution figures as the record of what was estimated; `scripts/budgets.json` carries the executed numbers in its reasons.
- `docs/history/**` eviction from the tarball was rejected for this cut (link surgery across 10 docs pages + `docs/index.md`) and deferred to Further Actions, so the artifact diet ceiling was raised instead of lowered.
- Plan 100 Task 1 was still unchecked, so the 1445 root export ceiling does not include its documented +1; that task's own budget step stays the owner rather than pre-raising a ceiling for code that does not exist.
- Task 1 carries three changes that are not literally "version plumbing", because the task's own green acceptance required them: the release-page version claims (the freeze tests assert the live version against that page), the network-free-guard fix in the plan 089 local-reranker test (the root suite fails on the guard violation), and the biome format pass over 11 plan 086–098 files (CI's `sdk:ready` verify leg fails on `format:check`). The format pass is cosmetic-only and the scratch probe deletion is unreferenced code, so no behavior ships with the bump.
- The 0.9.0 manifests were bumped while plan 100 Task 1 is still open (0/1), so the version does not yet carry the `budget_exhausted` live-delivery surface the plan header lists. Landing plan 100 after the bump means its documented `@arnilo/prism` +1 must fit inside the 1445 ceiling and its own budget step runs against a 0.9.0 manifest set; Task 2's compat baseline regeneration must come after it or the frozen baseline misses the terminal-event predicate.
- `docs/index.md`'s current-line bullets still describe 0.8.0 under the new 0.9.0 banner (the banner is version-literal-gate enforced, the bullet content is not); Task 3 owns the rewrite, so this intermediate state is committed rather than fixed twice.
- The baseline regeneration landed one commit after the version bump (`08c792ba`) instead of inside it, deviating from Task 2's "committed atomically with the version bump": Task 1 had already been committed and reported as its own reviewed unit, and rewriting that commit to fold in a second task's work was not worth discarding the hash. Both are adjacent commits of the same cut with no other plan work between them and the baseline was regenerated exactly once, so the 083/084 failure mode (baseline left behind for later plans) is not repeated — only the commit boundary differs.
- Task 2's acceptance names the plan 100 terminal-event predicate among the expected additions; it is absent because plan 100 Task 1 is unimplemented (0/1). Regenerating for 086–098 now keeps the cut's gate green and costs one more scripted regeneration when plan 100 lands, which is cheaper than the alternative: implementing another plan's feature inside a gate task would smuggle behavior into a baseline commit. The re-run is a high-priority Further Action, not an acceptable omission.
- `--update-baseline` skips diffing entirely, so the 8 declaration changes are accepted without a `docs/migration.md` note and no gate will ask for one: the `recordUsage` callback return widening (`Promise<void>` → `Promise<Usage | undefined>`) is consumer-visible for hosts that returned void, and Task 3 has to carry it in the migration page by hand. **Done in Task 3**: `docs/migrate-to-0.9.md`"s operator-honesty section names it, and the page's upgrade steps point compile errors at it.
- The migration page documents four behavior deltas inside existing surfaces rather than the two the acceptance named, adding §3 (cache-stable progressive disclosure) and §4 (usage-less providers charged a labeled estimate). Both are felt without opting into anything — prompt bytes change for hosts with progressive disclosure, and usage rows that used to be zero now carry an estimate — so covering only the two named ones would have made the page incomplete about its own release. The extra sections cost lines, not correctness, and both name their escape hatch.
- `docs/migrate-to-0.9.md` and the 0.9.0 changelog section document the shipped set (086–096, 098, 100) and **not plan 097** (trajectory export, 0/2). This is a real cut-scope deviation from the plan header's "ships plans 086–098": the docs are accurate about what exists, but Task 4 must not publish until either 097 lands or the scope sentence is amended. Documenting an unimplemented export format would have been worse than the deviation, so the page stays honest and the decision moves to the publish gate.

## Further Actions
- The 0.9.0 CHANGELOG section is dated `2026-09-19` while the cut is still unpublished; re-stamp the date (and only then move any `[Unreleased]` content) in Task 4's publish commit, so the section's date matches the registry write rather than the working session. Priority: medium (release honesty).
- Task 3's migration page is the only place the 0.9.0 behavior deltas are collected; keep it that way — when a follow-up plan (101–109) changes one of them, edit the owning API page and add one line here instead of restating the contract. Priority: low.
- Land plan 100 Task 1 before Task 4's publish, then re-run this task's regeneration (`npm run test:postgres` with a throwaway postgres for this-tree evidence, then `node scripts/release.mjs gate --lockstep --version 0.9.0 --update-baseline` + `npm run release:gate`) and commit the additive baseline line — expect exactly `isTerminalAgentEventType` (+1 root name, 0 removals). Without it `release:gate` fails on the missing baseline entry and the terminal-event predicate ships unattested. Priority: high (release ordering).
- Compat gate fidelity: `collapse()` truncates every stored signature at 500 chars and `extractDeclaredSurface` merges subpath entry points first-wins, so long-statement churn reads as 124 "changed" for 8 real changes while an edit past the cap — or a name moving between subpaths — is invisible. Store full statements (or key barrel lines by their name set) and diff per entry point. Priority: medium (no release risk today because removals stay exact; it costs review time and hides post-cap edits).
- Evict `docs/history/**` (~513 KiB unpacked, the only large measured diet left) from the root tarball by moving the archive out of the shipped `docs/` tree and rewriting the 18 links in 10 pages plus the `docs/index.md` archive entry; would absorb future docs growth without raising the ceiling again. Priority: medium (docs-only, needs the docs link check green before a cut).
- Add `npm run format:check` (and a `release-evidence.json` freshness check) to the per-plan execution checklist, not just the cut: eleven files from plans 086–098 sat unformatted until Task 1 ran the full sdk:ready chain, and a red format gate is invisible to `npm test`/`lint`. Priority: medium (one line in the execution skill beats finding it at the cut).
- `docs/performance.md` still records the 2026-08-27 pack numbers (923,045 / 3,149,665 / 375) as historical evidence; if a current-line number is wanted there, generate that paragraph from `scripts/budgets.json#root`. Priority: low (frozen evidence page).
